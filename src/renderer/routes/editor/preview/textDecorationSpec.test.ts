import { describe, expect, it } from 'vitest'
import {
  bubbleRect,
  drawDecorationBackground,
  drawDecorationRules,
  drawHighlightBars,
  hasBackground,
  hasHighlightBars,
  hasRules,
  highlightBarBoxes,
  resolveDecoration,
  resolveRule,
  ruleThickness,
  strikeGeometry,
  underlineGeometry,
  type ResolvedBackground,
  type ResolvedHighlightBar
} from './textDecorationSpec'
import { drawPresetCaption, presetToTextDrawSpec, type TextDrawSpec } from './captionTextRender'
import { defaultCaptionPreset } from '../../../../shared/captionPreset'
import { layoutGlyphBoxes, type GlyphBox } from './textLayout'
import { DECORATION_RENDER_ORDER } from './textDecorationSpec'
import type { EffectsPass } from './textPaintPipeline'

// ---------------------------------------------------------------------------
// bubbleRect — PURE padding-expansion + radius-clamp math (P7.8).
// ---------------------------------------------------------------------------
describe('bubbleRect', () => {
  const box: GlyphBox = { x: -100, y: -20, width: 200, height: 40 }

  it('expands the text box by padding on every side', () => {
    const r = bubbleRect(box, 16, 8, 0)
    // width += 2·paddingX, height += 2·paddingY; top-left shifts out by padding.
    expect(r.w).toBe(200 + 32)
    expect(r.h).toBe(40 + 16)
    expect(r.x).toBe(-100 - 16)
    expect(r.y).toBe(-20 - 8)
  })

  it('keeps the bubble centered when the box is centered', () => {
    const r = bubbleRect(box, 10, 10, 0)
    // box centered on origin → bubble centered on origin too.
    expect(r.x + r.w / 2).toBeCloseTo(0, 9)
    expect(r.y + r.h / 2).toBeCloseTo(0, 9)
  })

  it('clamps the radius to half the min dimension (pill, never invalid)', () => {
    // h becomes 40 + 0 = 40 → min(w,h)=40 → radius clamps to 20 even at 999.
    const r = bubbleRect(box, 0, 0, 999)
    expect(r.r).toBe(20)
  })

  it('passes a radius through unchanged when it fits', () => {
    expect(bubbleRect(box, 0, 0, 8).r).toBe(8)
  })

  it('floors negative padding/radius to 0', () => {
    const r = bubbleRect(box, -5, -5, -5)
    expect(r.w).toBe(200)
    expect(r.h).toBe(40)
    expect(r.r).toBe(0)
  })

  it('handles a degenerate (zero-size) box without an invalid rect', () => {
    const r = bubbleRect({ x: 0, y: 0, width: 0, height: 0 }, 4, 4, 10)
    expect(r.w).toBe(8)
    expect(r.h).toBe(8)
    expect(r.r).toBe(4) // clamped to half of 8
  })
})

// ---------------------------------------------------------------------------
// resolveDecoration — PURE bag → typed resolve (color baked at opacity, etc.).
// ---------------------------------------------------------------------------
describe('resolveDecoration', () => {
  it('bakes the background color at its opacity', () => {
    const d = resolveDecoration({ background: { color: '#102030', opacity: 0.5, padding: 12, radius: 8 } })
    expect(d.background).not.toBeNull()
    expect(d.background?.color).toBe('rgba(16, 32, 48, 0.5)')
    expect(d.background?.paddingX).toBe(12)
    expect(d.background?.paddingY).toBe(12)
    expect(d.background?.radius).toBe(8)
    expect(hasBackground(d)).toBe(true)
  })

  it('returns no background when decoration is absent/malformed (backward compat)', () => {
    expect(resolveDecoration(undefined).background).toBeNull()
    expect(resolveDecoration(null).background).toBeNull()
    expect(resolveDecoration('nope').background).toBeNull()
    expect(resolveDecoration({}).background).toBeNull()
    expect(resolveDecoration({ background: 'x' }).background).toBeNull()
    expect(hasBackground(resolveDecoration(undefined))).toBe(false)
  })

  it('treats a zero-opacity background as no bubble', () => {
    expect(resolveDecoration({ background: { color: '#fff', opacity: 0 } }).background).toBeNull()
  })

  it('defaults a missing opacity + invalid color to the safe defaults', () => {
    const d = resolveDecoration({ background: { padding: 4 } })
    // default opacity 0.5, default hex black.
    expect(d.background?.color).toBe('rgba(0, 0, 0, 0.5)')
    expect(d.background?.paddingX).toBe(4)
  })

  it('honors explicit paddingX/paddingY over the symmetric padding', () => {
    const d = resolveDecoration({
      background: { color: '#fff', opacity: 1, padding: 10, paddingX: 20, paddingY: 4 }
    })
    expect(d.background?.paddingX).toBe(20)
    expect(d.background?.paddingY).toBe(4)
  })

  it('resolves underline/strike/highlight-bar (stable shape)', () => {
    const d = resolveDecoration({
      underline: true,
      strike: true,
      highlightBar: { mode: 'word', color: '#ffe600', opacity: 0.8, padding: 4, radius: 4 }
    })
    // underline/strike resolve to a rule (color null = use glyph fill, no override).
    expect(d.underline).toEqual({ color: null, thickness: null })
    expect(d.strike).toEqual({ color: null, thickness: null })
    expect(d.highlight).toEqual({
      color: 'rgba(255, 230, 0, 0.8)',
      mode: 'word',
      paddingX: 4,
      paddingY: 4,
      radius: 4
    })
    expect(d.background).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// drawDecorationBackground — thin canvas draw (paths a rounded rect, fills it).
// A recording ctx logs path/fill ops so order + values are assertable.
// ---------------------------------------------------------------------------
interface Op {
  op: string
  args: number[]
  fillStyle?: string
}

function recordingCtx(): { ctx: CanvasRenderingContext2D; ops: Op[] } {
  const ops: Op[] = []
  let fillStyle = ''
  const log = (op: string, ...args: number[]): void => {
    ops.push({ op, args, fillStyle })
  }
  const ctx = {
    save: () => log('save'),
    restore: () => log('restore'),
    beginPath: () => log('beginPath'),
    moveTo: (x: number, y: number) => log('moveTo', x, y),
    arcTo: (x1: number, y1: number, x2: number, y2: number, r: number) => log('arcTo', x1, y1, x2, y2, r),
    closePath: () => log('closePath'),
    fill: () => log('fill'),
    fillText: (_t: string, x: number, y: number) => log('fillText', x, y)
  }
  Object.defineProperty(ctx, 'fillStyle', { get: () => fillStyle, set: (v: string) => (fillStyle = v) })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops }
}

describe('drawDecorationBackground', () => {
  const box: GlyphBox = { x: -50, y: -10, width: 100, height: 20 }
  const bg: ResolvedBackground = { color: 'rgba(0, 0, 0, 0.5)', paddingX: 8, paddingY: 4, radius: 6 }

  it('paths a rounded rect and fills it in the background color', () => {
    const { ctx, ops } = recordingCtx()
    drawDecorationBackground(ctx, bg, box)
    const fill = ops.find((o) => o.op === 'fill')
    expect(fill).toBeDefined()
    expect(fill?.fillStyle).toBe('rgba(0, 0, 0, 0.5)')
    // The path begins before it fills (rounded-rect path → fill).
    const beginIdx = ops.findIndex((o) => o.op === 'beginPath')
    const fillIdx = ops.findIndex((o) => o.op === 'fill')
    expect(beginIdx).toBeGreaterThanOrEqual(0)
    expect(fillIdx).toBeGreaterThan(beginIdx)
  })

  it('is a no-op when the background is null', () => {
    const { ctx, ops } = recordingCtx()
    drawDecorationBackground(ctx, null, box)
    expect(ops).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Draw ORDER + reconciliation: the bubble paints BEFORE the glyph fill in the
// shared thumbnail path (which uses the same resolver as preview/export).
// ---------------------------------------------------------------------------
function orderRecordingCtx(): { ctx: CanvasRenderingContext2D; ops: string[] } {
  const ops: string[] = []
  const ctx = {
    setTransform() {},
    clearRect() {},
    fillRect() {},
    save() {},
    restore() {},
    translate() {},
    scale() {},
    beginPath: () => ops.push('beginPath'),
    moveTo() {},
    arcTo() {},
    closePath() {},
    fill: () => ops.push('rectFill'),
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: (s: string) => ({ width: s.length * 10 }),
    fillText: () => ops.push('glyphFill'),
    strokeText: () => ops.push('glyphStroke')
  }
  Object.defineProperties(ctx, {
    fillStyle: { get: () => '', set() {} },
    strokeStyle: { get: () => '', set() {} },
    lineWidth: { get: () => 0, set() {} },
    lineJoin: { get: () => '', set() {} },
    miterLimit: { get: () => 0, set() {} },
    shadowColor: { get: () => 'transparent', set() {} },
    shadowBlur: { get: () => 0, set() {} },
    shadowOffsetX: { get: () => 0, set() {} },
    shadowOffsetY: { get: () => 0, set() {} },
    globalCompositeOperation: { get: () => 'source-over', set() {} },
    font: { get: () => '', set() {} },
    textAlign: { get: () => '', set() {} },
    textBaseline: { get: () => '', set() {} },
    letterSpacing: { get: () => '', set() {} }
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops }
}

describe('background bubble draw order (shared thumbnail path = preview/export)', () => {
  it('fills the bubble rect BEFORE the first glyph op', () => {
    const spec: TextDrawSpec = {
      font: 'normal 40px Inter',
      fontSizePx: 40,
      lineHeight: 1.2,
      letterSpacing: 0,
      fill: { type: 'solid', color: '#fff' },
      stroke: [],
      shadow: null,
      background: { color: 'rgba(0, 0, 0, 0.5)', paddingX: 16, paddingY: 16, radius: 12 }
    }
    const { ctx, ops } = orderRecordingCtx()
    drawPresetCaption(ctx, spec, { width: 1000, height: 500, lines: ['Hello', 'World'] })
    const rectFillIdx = ops.indexOf('rectFill')
    const firstGlyphIdx = ops.findIndex((o) => o === 'glyphFill' || o === 'glyphStroke')
    expect(rectFillIdx).toBeGreaterThanOrEqual(0)
    expect(firstGlyphIdx).toBeGreaterThan(rectFillIdx)
  })

  it('draws ONE block bubble (not one per line) for a multi-line block', () => {
    const spec: TextDrawSpec = {
      font: 'normal 40px Inter',
      fontSizePx: 40,
      lineHeight: 1.2,
      letterSpacing: 0,
      fill: { type: 'solid', color: '#fff' },
      stroke: [],
      shadow: null,
      background: { color: 'rgba(0, 0, 0, 0.5)', paddingX: 8, paddingY: 8, radius: 4 }
    }
    const { ctx, ops } = orderRecordingCtx()
    drawPresetCaption(ctx, spec, { width: 1000, height: 500, lines: ['One', 'Two', 'Three'] })
    expect(ops.filter((o) => o === 'rectFill')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Reconciliation: the thumbnail's preset → spec uses the SHARED background shape.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// P7.9 — underline + strikethrough: rule resolve + baseline-aware geometry.
// ---------------------------------------------------------------------------
describe('resolveRule (underline / strike)', () => {
  it('true → an ON rule with no color + no thickness override', () => {
    expect(resolveRule(true)).toEqual({ color: null, thickness: null })
  })

  it('false / absent / junk → null (backward compat — no rule)', () => {
    expect(resolveRule(false)).toBeNull()
    expect(resolveRule(undefined)).toBeNull()
    expect(resolveRule(null)).toBeNull()
    expect(resolveRule('x')).toBeNull()
    expect(resolveRule(0)).toBeNull()
  })

  it('an object is ON unless enabled:false', () => {
    expect(resolveRule({})).toEqual({ color: null, thickness: null })
    expect(resolveRule({ enabled: true })).toEqual({ color: null, thickness: null })
    expect(resolveRule({ enabled: false })).toBeNull()
    expect(resolveRule({ enabled: false, color: '#f00' })).toBeNull()
  })

  it('bakes a valid hex color to opaque rgba; keeps null for an invalid color', () => {
    expect(resolveRule({ color: '#ff0000' })).toEqual({ color: 'rgba(255, 0, 0, 1)', thickness: null })
    expect(resolveRule({ color: 'nope' })).toEqual({ color: null, thickness: null })
  })

  it('keeps a positive thickness override; ignores 0 / negative / non-finite', () => {
    expect(resolveRule({ thickness: 3 })?.thickness).toBe(3)
    expect(resolveRule({ thickness: 0 })?.thickness).toBeNull()
    expect(resolveRule({ thickness: -2 })?.thickness).toBeNull()
    expect(resolveRule({ thickness: Number.NaN })?.thickness).toBeNull()
  })
})

describe('ruleThickness — scales with font size', () => {
  it('derives ~size/16, floored at 1px', () => {
    expect(ruleThickness(16)).toBe(1)
    expect(ruleThickness(40)).toBeCloseTo(2.5, 9)
    expect(ruleThickness(160)).toBe(10)
    // A tiny font still draws a visible 1px line.
    expect(ruleThickness(4)).toBe(1)
  })

  it('scales monotonically with size', () => {
    expect(ruleThickness(80)).toBeGreaterThan(ruleThickness(40))
  })

  it('an explicit override bypasses the size derivation', () => {
    expect(ruleThickness(40, 6)).toBe(6)
    expect(ruleThickness(40, 0)).toBeCloseTo(2.5, 9) // 0 → fall back to size
    expect(ruleThickness(40, null)).toBeCloseTo(2.5, 9)
  })
})

describe('underlineGeometry — below baseline, spans the line, scales with size', () => {
  // A centered line box: 200 wide, one 48px line-height slot centered on origin.
  const lineBox = { x: -100, y: -24, width: 200, height: 48 }

  it('sits BELOW the baseline (below the slot midpoint)', () => {
    const g = underlineGeometry(lineBox, 40)
    const middle = lineBox.y + lineBox.height / 2 // 0
    expect(g.y).toBeGreaterThan(middle)
  })

  it('spans the measured line box width at the box left edge', () => {
    const g = underlineGeometry(lineBox, 40)
    expect(g.x).toBe(lineBox.x)
    expect(g.w).toBe(lineBox.width)
  })

  it('thickness scales with font size (≈size/16)', () => {
    expect(underlineGeometry(lineBox, 16).thickness).toBe(1)
    expect(underlineGeometry(lineBox, 80).thickness).toBe(5)
  })

  it('the y-offset below the midpoint scales with font size', () => {
    const middle = lineBox.y + lineBox.height / 2
    const small = underlineGeometry(lineBox, 20).y - middle
    const big = underlineGeometry(lineBox, 60).y - middle
    expect(big).toBeGreaterThan(small)
    // roughly proportional to size (3× size → ~3× offset, allowing the thickness term).
    expect(big / small).toBeGreaterThan(2.5)
  })

  it('an override thickness wins', () => {
    expect(underlineGeometry(lineBox, 40, 7).thickness).toBe(7)
  })
})

describe('strikeGeometry — through the mid / x-height', () => {
  const lineBox = { x: -100, y: -24, width: 200, height: 48 }

  it('sits at the line MIDDLE region (above the underline, near center)', () => {
    const middle = lineBox.y + lineBox.height / 2 // 0
    const s = strikeGeometry(lineBox, 40)
    const u = underlineGeometry(lineBox, 40)
    // strike crosses near the middle; underline is clearly below it.
    expect(Math.abs(s.y - middle)).toBeLessThan(u.y - middle)
    expect(s.y).toBeLessThan(u.y)
  })

  it('spans the measured line box width (alignment-aware via the box)', () => {
    const s = strikeGeometry(lineBox, 40)
    expect(s.x).toBe(lineBox.x)
    expect(s.w).toBe(lineBox.width)
  })

  it('thickness scales with size', () => {
    expect(strikeGeometry(lineBox, 16).thickness).toBe(1)
    expect(strikeGeometry(lineBox, 80).thickness).toBe(5)
  })
})

describe('alignment — rule span follows the line box x/width', () => {
  it('a left-aligned (shorter) line gets a rule flush to its left edge', () => {
    // Left-aligned short line inside a wider block: box.x is the block left edge.
    const leftBox = { x: -150, y: -24, width: 80, height: 48 }
    const g = underlineGeometry(leftBox, 40)
    expect(g.x).toBe(-150)
    expect(g.w).toBe(80)
  })

  it('a right-aligned line gets a rule flush to its right edge', () => {
    const rightBox = { x: 70, y: -24, width: 80, height: 48 }
    const g = strikeGeometry(rightBox, 40)
    expect(g.x + g.w).toBe(150)
  })
})

describe('drawDecorationRules — per-line spans + color default vs override', () => {
  function ruleRecordingCtx(): {
    ctx: CanvasRenderingContext2D
    rects: { x: number; y: number; w: number; h: number; fill: string }[]
  } {
    const rects: { x: number; y: number; w: number; h: number; fill: string }[] = []
    let fillStyle = ''
    const ctx = {
      save() {},
      restore() {},
      fillRect: (x: number, y: number, w: number, h: number) => rects.push({ x, y, w, h, fill: fillStyle })
    }
    Object.defineProperty(ctx, 'fillStyle', { get: () => fillStyle, set: (v: string) => (fillStyle = v) })
    return { ctx: ctx as unknown as CanvasRenderingContext2D, rects }
  }

  const boxes = [
    { x: -100, y: -60, width: 200, height: 40 },
    { x: -80, y: -20, width: 160, height: 40 }
  ]

  it('draws ONE underline per visual line (multi-line → one each)', () => {
    const { ctx, rects } = ruleRecordingCtx()
    drawDecorationRules(ctx, { color: null, thickness: null }, null, boxes, 32, 'rgba(0,0,0,1)')
    expect(rects).toHaveLength(2)
    // Each rule spans its own line box width.
    expect(rects[0].w).toBe(200)
    expect(rects[1].w).toBe(160)
  })

  it('draws BOTH an underline and a strike per line when both on (2 lines → 4 rects)', () => {
    const { ctx, rects } = ruleRecordingCtx()
    drawDecorationRules(
      ctx,
      { color: null, thickness: null },
      { color: null, thickness: null },
      boxes,
      32,
      'rgba(0,0,0,1)'
    )
    expect(rects).toHaveLength(4)
  })

  it('defaults the rule color to the glyph FILL when unset', () => {
    const { ctx, rects } = ruleRecordingCtx()
    drawDecorationRules(ctx, { color: null, thickness: null }, null, [boxes[0]], 32, 'rgba(10,20,30,1)')
    expect(rects[0].fill).toBe('rgba(10,20,30,1)')
  })

  it('uses an explicit rule color OVERRIDE over the fill', () => {
    const { ctx, rects } = ruleRecordingCtx()
    drawDecorationRules(ctx, { color: 'rgba(255,0,0,1)', thickness: null }, null, [boxes[0]], 32, 'rgba(10,20,30,1)')
    expect(rects[0].fill).toBe('rgba(255,0,0,1)')
  })

  it('disabled / absent rules → no draw', () => {
    const { ctx, rects } = ruleRecordingCtx()
    drawDecorationRules(ctx, null, null, boxes, 32, 'rgba(0,0,0,1)')
    expect(rects).toHaveLength(0)
  })

  it('skips zero-width line boxes (empty lines get no rule)', () => {
    const { ctx, rects } = ruleRecordingCtx()
    const withEmpty = [boxes[0], { x: 0, y: 0, width: 0, height: 40 }]
    drawDecorationRules(ctx, { color: null, thickness: null }, null, withEmpty, 32, 'rgba(0,0,0,1)')
    expect(rects).toHaveLength(1)
  })

  it('hasRules reflects whether any rule is present', () => {
    expect(hasRules(resolveDecoration({ underline: true }))).toBe(true)
    expect(hasRules(resolveDecoration({ strike: true }))).toBe(true)
    expect(hasRules(resolveDecoration({}))).toBe(false)
    expect(hasRules(resolveDecoration(undefined))).toBe(false)
  })
})

describe('presetToTextDrawSpec background reconciliation', () => {
  it('a preset with no decoration yields no background', () => {
    const preset = defaultCaptionPreset() // no decoration
    expect(presetToTextDrawSpec(preset).background).toBeNull()
  })

  it('a preset background maps to the shared ResolvedBackground shape', () => {
    const preset = {
      ...defaultCaptionPreset(),
      decoration: { background: { color: '#101820', opacity: 0.55, padding: 14, radius: 10 } }
    }
    const bg = presetToTextDrawSpec(preset).background
    expect(bg?.color).toBe('rgba(16, 24, 32, 0.55)')
    expect(bg?.paddingX).toBe(14)
    expect(bg?.paddingY).toBe(14)
    expect(bg?.radius).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// P7.10 — highlight BARS (marker/highlighter, per-word or full-line).
// ---------------------------------------------------------------------------
describe('resolveDecoration → highlight bar (P7.10, distinct from PresetHighlight)', () => {
  it('per-word is the default mode; bakes color at its opacity', () => {
    const d = resolveDecoration({ highlightBar: { color: '#ff0000', opacity: 0.5 } })
    expect(d.highlight).toEqual({
      color: 'rgba(255, 0, 0, 0.5)',
      mode: 'word',
      paddingX: 0,
      paddingY: 0,
      radius: 0
    })
  })

  it('honors full-line mode + symmetric padding + radius', () => {
    const d = resolveDecoration({ highlightBar: { mode: 'line', padding: 6, radius: 3, opacity: 1 } })
    expect(d.highlight?.mode).toBe('line')
    expect(d.highlight?.paddingX).toBe(6)
    expect(d.highlight?.paddingY).toBe(6)
    expect(d.highlight?.radius).toBe(3)
  })

  it('explicit paddingX/paddingY override the symmetric padding', () => {
    const d = resolveDecoration({ highlightBar: { padding: 2, paddingX: 8, paddingY: 1 } })
    expect(d.highlight?.paddingX).toBe(8)
    expect(d.highlight?.paddingY).toBe(1)
  })

  it('defaults a missing opacity + invalid color to the highlighter defaults', () => {
    const d = resolveDecoration({ highlightBar: { color: 'nope' } })
    // #ffe600 @ 0.4 default.
    expect(d.highlight?.color).toBe('rgba(255, 230, 0, 0.4)')
  })

  it('disabled / zero-opacity / absent → no bars (backward compat)', () => {
    expect(resolveDecoration({ highlightBar: { enabled: false } }).highlight).toBeNull()
    expect(resolveDecoration({ highlightBar: { opacity: 0 } }).highlight).toBeNull()
    expect(resolveDecoration({}).highlight).toBeNull()
    expect(resolveDecoration(undefined).highlight).toBeNull()
  })

  it('reads a legacy `highlight` key, but `highlightBar` wins when both present', () => {
    expect(resolveDecoration({ highlight: { color: '#00ff00', opacity: 1 } }).highlight?.color).toBe(
      'rgba(0, 255, 0, 1)'
    )
    const both = resolveDecoration({
      highlight: { color: '#00ff00', opacity: 1 },
      highlightBar: { color: '#0000ff', opacity: 1 }
    })
    expect(both.highlight?.color).toBe('rgba(0, 0, 255, 1)')
  })

  it('does NOT collide with the caption active-word PresetHighlight (separate key)', () => {
    // A clip decoration carries the marker bar; the caption active-word highlight is a
    // preset concern resolved elsewhere — resolveDecoration never reads `preset.highlight`.
    const preset = { ...defaultCaptionPreset(), highlight: { enabled: true, color: '#ff00ff' } }
    // The preset's active-word highlight does NOT leak into the decoration bar.
    expect(presetToTextDrawSpec(preset as never).highlight).toBeNull()
  })
})

// `layoutGlyphBoxes` boxes a measurer where width = chars * 10 (matches the order ctx).
const measure10 = (s: string): number => s.length * 10

describe('highlightBarBoxes — selects run/word vs line boxes', () => {
  const layout = layoutGlyphBoxes(
    ['one two', 'three'],
    { fontSizePx: 40, lineHeightMult: 1.2, align: 'center' },
    measure10
  )

  it('per-word mode → one box per non-empty WORD box at run bounds', () => {
    const boxes = highlightBarBoxes('word', layout.lines)
    // 'one','two','three' → 3 word boxes.
    expect(boxes).toHaveLength(3)
    // Each word box matches the layout's word box exactly (run bounds).
    expect(boxes[0]).toEqual(layout.lines[0].words[0].box)
    expect(boxes[2]).toEqual(layout.lines[1].words[0].box)
  })

  it('full-line mode → one box per non-empty LINE box', () => {
    const boxes = highlightBarBoxes('line', layout.lines)
    expect(boxes).toHaveLength(2)
    expect(boxes[0]).toEqual(layout.lines[0].box)
    expect(boxes[1]).toEqual(layout.lines[1].box)
  })

  it('drops blank lines / zero-width boxes (no stray bar)', () => {
    const blank = layoutGlyphBoxes(['hi', ''], { fontSizePx: 40, lineHeightMult: 1.2, align: 'center' }, measure10)
    expect(highlightBarBoxes('line', blank.lines)).toHaveLength(1)
    expect(highlightBarBoxes('word', blank.lines)).toHaveLength(1)
  })
})

describe('drawHighlightBars — reuses bubbleRect per box, bakes color', () => {
  const layout = layoutGlyphBoxes(['a b'], { fontSizePx: 40, lineHeightMult: 1.2, align: 'center' }, measure10)

  it('per-word → one filled rounded rect per word box at box + padding', () => {
    const bar: ResolvedHighlightBar = {
      color: 'rgba(255, 230, 0, 0.4)',
      mode: 'word',
      paddingX: 4,
      paddingY: 2,
      radius: 3
    }
    const { ctx, ops } = recordingCtx()
    drawHighlightBars(ctx, bar, layout.lines)
    const fills = ops.filter((o) => o.op === 'fill')
    expect(fills).toHaveLength(2) // 'a' and 'b'
    // The fill uses the baked color.
    expect(fills[0].fillStyle).toBe('rgba(255, 230, 0, 0.4)')
    // The first word box, expanded by padding (bubbleRect), drives the first moveTo.
    const word0 = layout.lines[0].words[0].box
    const rect = bubbleRect(word0, 4, 2, 3)
    const firstMove = ops.find((o) => o.op === 'moveTo')
    expect(firstMove?.args[0]).toBeCloseTo(rect.x + rect.r)
    expect(firstMove?.args[1]).toBeCloseTo(rect.y)
  })

  it('full-line → one filled rounded rect per line box', () => {
    const bar: ResolvedHighlightBar = {
      color: 'rgba(0, 0, 255, 1)',
      mode: 'line',
      paddingX: 0,
      paddingY: 0,
      radius: 999 // huge radius → clamped to a pill, never invalid
    }
    const { ctx, ops } = recordingCtx()
    drawHighlightBars(ctx, bar, layout.lines)
    expect(ops.filter((o) => o.op === 'fill')).toHaveLength(1)
    // Radius is clamped to half the smaller dimension (no invalid path).
    const arc = ops.find((o) => o.op === 'arcTo')
    const lineBox = layout.lines[0].box
    const maxR = Math.min(lineBox.width, lineBox.height) / 2
    expect(arc?.args[4]).toBeLessThanOrEqual(maxR + 1e-6)
  })

  it('null highlight → no-op', () => {
    const { ctx, ops } = recordingCtx()
    drawHighlightBars(ctx, null, layout.lines)
    expect(ops).toHaveLength(0)
  })

  it('hasHighlightBars sugar tracks the resolved highlight', () => {
    expect(hasHighlightBars(resolveDecoration({ highlightBar: { opacity: 1 } }))).toBe(true)
    expect(hasHighlightBars(resolveDecoration({}))).toBe(false)
  })
})

describe('highlight bar draw ORDER (shared thumbnail path = preview/export)', () => {
  function specWith(highlight: ResolvedHighlightBar | null, background: TextDrawSpec['background']): TextDrawSpec {
    return {
      font: 'normal 40px Inter',
      fontSizePx: 40,
      lineHeight: 1.2,
      letterSpacing: 0,
      fill: { type: 'solid', color: '#fff' },
      stroke: [],
      shadow: null,
      background,
      highlight
    }
  }

  it('fills the bars BEFORE the first glyph op (above the bubble, below glyphs)', () => {
    const bar: ResolvedHighlightBar = {
      color: 'rgba(255, 230, 0, 0.4)',
      mode: 'word',
      paddingX: 2,
      paddingY: 2,
      radius: 2
    }
    const { ctx, ops } = orderRecordingCtx()
    drawPresetCaption(ctx, specWith(bar, null), { width: 1000, height: 500, lines: ['hi there'] })
    const firstRectFill = ops.indexOf('rectFill')
    const firstGlyph = ops.findIndex((o) => o === 'glyphFill' || o === 'glyphStroke')
    expect(firstRectFill).toBeGreaterThanOrEqual(0)
    expect(firstGlyph).toBeGreaterThan(firstRectFill)
  })

  it('paints the bubble BEFORE the highlight bars (bubble → bars → glyphs)', () => {
    const bar: ResolvedHighlightBar = {
      color: 'rgba(255, 230, 0, 0.4)',
      mode: 'line',
      paddingX: 2,
      paddingY: 2,
      radius: 2
    }
    const bg = { color: 'rgba(0, 0, 0, 0.5)', paddingX: 16, paddingY: 16, radius: 12 }
    const { ctx, ops } = orderRecordingCtx()
    drawPresetCaption(ctx, specWith(bar, bg), { width: 1000, height: 500, lines: ['one'] })
    // bubble (1) + line bar (1) = 2 rect fills, ALL before the first glyph.
    const rectFills = ops.filter((o) => o === 'rectFill')
    expect(rectFills).toHaveLength(2)
    const lastRectFill = ops.lastIndexOf('rectFill')
    const firstGlyph = ops.findIndex((o) => o === 'glyphFill' || o === 'glyphStroke')
    expect(firstGlyph).toBeGreaterThan(lastRectFill)
  })

  it('absent highlight → no extra rect fills (backward compat)', () => {
    const { ctx, ops } = orderRecordingCtx()
    drawPresetCaption(ctx, specWith(null, null), { width: 1000, height: 500, lines: ['one'] })
    expect(ops.filter((o) => o === 'rectFill')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// P7.12 — the LOCKED decoration render order. One clip with bubble + highlight bar
// + underline + an effect, drawn through the SHARED path, must hit each layer in
// the canonical order: bubble & bar BEFORE the glyphs; effect WITHIN the glyph
// passes (after fill); underline AFTER the fill — all beneath effects, above bg.
// ---------------------------------------------------------------------------
describe('DECORATION_RENDER_ORDER — the canonical, documented order (one place)', () => {
  it('lists the layers in ascending step order, beneath effects + above clip bg', () => {
    const o = DECORATION_RENDER_ORDER
    // Background-type decorations are above the clip bg and below the glyph layer.
    expect(o.clipBackground).toBeLessThan(o.backgroundBubble)
    expect(o.backgroundBubble).toBeLessThan(o.highlightBars)
    expect(o.highlightBars).toBeLessThan(o.glyphFill)
    // Underline/strike ride with the glyphs (after fill) but beneath the effect composite.
    expect(o.glyphFill).toBeLessThan(o.effects)
    expect(o.effects).toBeLessThan(o.underlineStrike)
    // The active-word karaoke overlay is last (a preset concern, not a decoration).
    expect(o.underlineStrike).toBeLessThan(o.activeWordHighlight)
  })
})

describe('full decoration draw order (bubble + bar + underline + effect)', () => {
  // A recording ctx that timestamps EACH layer-distinguishing op into one ordered
  // log. The bubble + bars are rounded-rect FILLS (`fill()` → 'rectFill'); the
  // underline/strike rules are `fillRect` (→ 'ruleFill', a filled span); the glyph
  // body is `fillText` (→ 'glyphFill'); the injected effects pass marks itself with
  // `rotate` (→ 'effect'), which NEITHER drawPresetCaption NOR the glyph pipeline
  // ever call — so each layer is uniquely observable.
  function fullOrderCtx(): { ctx: CanvasRenderingContext2D; ops: string[] } {
    const ops: string[] = []
    const ctx = {
      setTransform() {},
      clearRect() {},
      fillRect: () => ops.push('ruleFill'), // underline / strike spans
      rotate: () => ops.push('effect'), // the injected effects pass marker
      save() {},
      restore() {},
      translate() {},
      scale() {},
      beginPath: () => ops.push('beginPath'),
      moveTo() {},
      arcTo() {},
      closePath() {},
      fill: () => ops.push('rectFill'), // bubble + highlight bars (rounded rects)
      createLinearGradient: () => ({ addColorStop() {} }),
      measureText: (s: string) => ({ width: s.length * 10 }),
      fillText: () => ops.push('glyphFill'),
      strokeText: () => ops.push('glyphStroke')
    }
    Object.defineProperties(ctx, {
      fillStyle: { get: () => '', set() {} },
      strokeStyle: { get: () => '', set() {} },
      lineWidth: { get: () => 0, set() {} },
      lineJoin: { get: () => '', set() {} },
      miterLimit: { get: () => 0, set() {} },
      shadowColor: { get: () => 'transparent', set() {} },
      shadowBlur: { get: () => 0, set() {} },
      shadowOffsetX: { get: () => 0, set() {} },
      shadowOffsetY: { get: () => 0, set() {} },
      globalCompositeOperation: { get: () => 'source-over', set() {} },
      globalAlpha: { get: () => 1, set() {} },
      font: { get: () => '', set() {} },
      textAlign: { get: () => '', set() {} },
      textBaseline: { get: () => '', set() {} },
      letterSpacing: { get: () => '', set() {} }
    })
    return { ctx: ctx as unknown as CanvasRenderingContext2D, ops }
  }

  // An effect pass that marks its compositing with `rotate`. It runs at pass 5 of
  // `paintGlyphPasses`, i.e. AFTER the glyph fill and BEFORE the per-line rules.
  const markerEffect: EffectsPass = (c) => {
    c.rotate(0)
  }

  it('draws bubble + bar BEFORE glyphs; effect after fill; underline after the effect', () => {
    const spec: TextDrawSpec = {
      font: 'normal 40px Inter',
      fontSizePx: 40,
      lineHeight: 1.2,
      letterSpacing: 0,
      fill: { type: 'solid', color: '#fff' },
      stroke: [],
      shadow: null,
      background: { color: 'rgba(0, 0, 0, 0.5)', paddingX: 12, paddingY: 12, radius: 8 },
      highlight: { color: 'rgba(255, 230, 0, 0.4)', mode: 'line', paddingX: 2, paddingY: 2, radius: 2 },
      underline: { color: null, thickness: null },
      effects: markerEffect
    }
    const { ctx, ops } = fullOrderCtx()
    drawPresetCaption(ctx, spec, { width: 1000, height: 500, lines: ['one'] })

    const glyphIdx = ops.indexOf('glyphFill')
    const effectIdx = ops.indexOf('effect')
    const underlineIdx = ops.indexOf('ruleFill')
    // Layer 1+2: bubble AND bar are the two rounded-rect fills, BOTH before the glyph.
    const preGlyphBars = ops.slice(0, glyphIdx).filter((o) => o === 'rectFill')
    expect(preGlyphBars).toHaveLength(2)
    expect(glyphIdx).toBeGreaterThan(0)
    // No rounded-rect bar fill leaks AFTER the glyph (bubble + bars are all pre-glyph).
    expect(ops.slice(glyphIdx).filter((o) => o === 'rectFill')).toHaveLength(0)
    // Layer 7: the effect composites AFTER the glyph fill (pass 5 of the pipeline).
    expect(effectIdx).toBeGreaterThan(glyphIdx)
    // Layer 8: the underline rule is drawn AFTER the effect.
    expect(underlineIdx).toBeGreaterThan(effectIdx)
  })

  it('omitting the effect still paints bubble → bar → glyph → underline in order', () => {
    const spec: TextDrawSpec = {
      font: 'normal 40px Inter',
      fontSizePx: 40,
      lineHeight: 1.2,
      letterSpacing: 0,
      fill: { type: 'solid', color: '#fff' },
      stroke: [],
      shadow: null,
      background: { color: 'rgba(0, 0, 0, 0.5)', paddingX: 12, paddingY: 12, radius: 8 },
      highlight: { color: 'rgba(255, 230, 0, 0.4)', mode: 'line', paddingX: 2, paddingY: 2, radius: 2 },
      underline: { color: null, thickness: null }
    }
    const { ctx, ops } = fullOrderCtx()
    drawPresetCaption(ctx, spec, { width: 1000, height: 500, lines: ['one'] })
    // No effect → no `rotate` marker.
    expect(ops).not.toContain('effect')
    const glyphIdx = ops.indexOf('glyphFill')
    const preGlyphBars = ops.slice(0, glyphIdx).filter((o) => o === 'rectFill')
    const underlineIdx = ops.indexOf('ruleFill')
    expect(preGlyphBars).toHaveLength(2) // bubble + bar
    expect(underlineIdx).toBeGreaterThan(glyphIdx) // underline after fill
  })
})

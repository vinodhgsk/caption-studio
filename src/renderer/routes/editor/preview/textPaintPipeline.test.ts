import { describe, expect, it } from 'vitest'
import {
  NO_EFFECTS,
  paintGlyphPasses,
  runEffectsHook,
  type GlyphToken
} from './textPaintPipeline'
import type { ResolvedTextShadow } from './textShadowSpec'
import type { ResolvedTextStroke } from './textStrokeSpec'
import { drawPresetCaption, type TextDrawSpec } from './captionTextRender'

// ---------------------------------------------------------------------------
// A recording canvas stub: logs the SEQUENCE of paint ops + the state each op
// was issued with, so a test can assert the canonical P6.15 pass order
// (shadow set before stroke, stroke widest-first before fill, inner shadow after
// fill, effects after that, highlight last). Each char measures 10px wide.
// ---------------------------------------------------------------------------
interface Op {
  op: 'fillText' | 'strokeText'
  text: string
  /** True when a shadow was live (color !== transparent) at the moment of the op. */
  shadowed: boolean
  shadowColor: string
  /** The strokeStyle / fillStyle in effect for this op. */
  style: string
  lineWidth: number
  composite: string
}

function recordingCtx(): { ctx: CanvasRenderingContext2D; ops: Op[] } {
  const ops: Op[] = []
  const state = {
    shadowColor: 'transparent',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    fillStyle: '' as string | CanvasGradient,
    strokeStyle: '',
    lineWidth: 0,
    lineJoin: '',
    miterLimit: 0,
    globalCompositeOperation: 'source-over',
    font: '',
    textAlign: '',
    textBaseline: '',
    letterSpacing: ''
  }
  const live = (): boolean => state.shadowColor !== 'transparent'
  const ctx = {
    setTransform() {},
    clearRect() {},
    fillRect() {},
    save() {},
    restore() {},
    translate() {},
    scale() {},
    rotate() {},
    beginPath() {},
    moveTo() {},
    arcTo() {},
    closePath() {},
    fill() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: (s: string) => ({ width: s.length * 10 }),
    fillText(text: string) {
      ops.push({
        op: 'fillText',
        text,
        shadowed: live(),
        shadowColor: state.shadowColor,
        style: String(state.fillStyle),
        lineWidth: state.lineWidth,
        composite: state.globalCompositeOperation
      })
    },
    strokeText(text: string) {
      ops.push({
        op: 'strokeText',
        text,
        shadowed: live(),
        shadowColor: state.shadowColor,
        style: String(state.strokeStyle),
        lineWidth: state.lineWidth,
        composite: state.globalCompositeOperation
      })
    }
  }
  // Back the styled props with the state object so reads/writes are observable.
  Object.defineProperties(ctx, {
    shadowColor: { get: () => state.shadowColor, set: (v) => (state.shadowColor = v) },
    shadowBlur: { get: () => state.shadowBlur, set: (v) => (state.shadowBlur = v) },
    shadowOffsetX: { get: () => state.shadowOffsetX, set: (v) => (state.shadowOffsetX = v) },
    shadowOffsetY: { get: () => state.shadowOffsetY, set: (v) => (state.shadowOffsetY = v) },
    fillStyle: { get: () => state.fillStyle, set: (v) => (state.fillStyle = v) },
    strokeStyle: { get: () => state.strokeStyle, set: (v) => (state.strokeStyle = v) },
    lineWidth: { get: () => state.lineWidth, set: (v) => (state.lineWidth = v) },
    lineJoin: { get: () => state.lineJoin, set: (v) => (state.lineJoin = v) },
    miterLimit: { get: () => state.miterLimit, set: (v) => (state.miterLimit = v) },
    globalCompositeOperation: {
      get: () => state.globalCompositeOperation,
      set: (v) => (state.globalCompositeOperation = v)
    },
    font: { get: () => state.font, set: (v) => (state.font = v) },
    textAlign: { get: () => state.textAlign, set: (v) => (state.textAlign = v) },
    textBaseline: { get: () => state.textBaseline, set: (v) => (state.textBaseline = v) },
    letterSpacing: { get: () => state.letterSpacing, set: (v) => (state.letterSpacing = v) }
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops }
}

const TOKEN: GlyphToken = { text: 'Ab', x: 0, y: 0 }

function dropShadow(): ResolvedTextShadow {
  return {
    kind: 'drop',
    color: 'rgba(0, 0, 0, 0.6)',
    blur: 3,
    offset: { x: 2, y: 2 },
    angleDeg: 45,
    distance: 3
  }
}
function innerShadow(): ResolvedTextShadow {
  return { ...dropShadow(), kind: 'inner', color: 'rgba(0, 0, 0, 0.8)' }
}
function longShadow(): ResolvedTextShadow {
  return { ...dropShadow(), kind: 'long', color: 'rgba(0, 0, 0, 1)', distance: 2 }
}
function twoLayerStroke(): ResolvedTextStroke {
  // Already resolved WIDEST-first (the resolver guarantees this order).
  return {
    layers: [
      { color: 'rgba(0, 0, 0, 1)', width: 6 },
      { color: 'rgba(255, 255, 255, 1)', width: 2 }
    ],
    hollow: false
  }
}

describe('paintGlyphPasses — canonical P6.15 pass order', () => {
  it('drop shadow → stroke (widest-first) → fill, then highlight LAST', () => {
    const { ctx, ops } = recordingCtx()
    paintGlyphPasses({
      ctx,
      token: TOKEN,
      shadow: dropShadow(),
      stroke: twoLayerStroke(),
      fill: (c, tk) => {
        c.fillStyle = 'rgba(255, 0, 0, 1)'
        c.fillText(tk.text, tk.x, tk.y)
      },
      highlight: (c, tk) => {
        c.fillStyle = 'rgba(0, 255, 0, 1)'
        c.fillText(tk.text, tk.x, tk.y)
      }
    })

    // 1) The FIRST op is the shadow cast: a transparent stroke of the WIDEST layer
    //    issued while a shadow is live.
    expect(ops[0].op).toBe('strokeText')
    expect(ops[0].shadowed).toBe(true)
    expect(ops[0].style).toBe('rgba(0, 0, 0, 0)') // transparent — only the shadow lands
    expect(ops[0].lineWidth).toBe(6) // widest layer carries the shadow

    // 2) Then the visible STROKE layers, widest-first, with NO live shadow.
    const strokeOps = ops.filter((o) => o.op === 'strokeText' && o.style !== 'rgba(0, 0, 0, 0)')
    expect(strokeOps.map((o) => o.lineWidth)).toEqual([6, 2]) // widest → thinnest
    expect(strokeOps.every((o) => !o.shadowed)).toBe(true) // exactly one shadow cast

    // 3) Then the FILL, after the strokes, with no live shadow.
    const fillIdx = ops.findIndex((o) => o.op === 'fillText' && o.style === 'rgba(255, 0, 0, 1)')
    const lastStrokeIdx = ops.map((o) => o.op).lastIndexOf('strokeText')
    expect(fillIdx).toBeGreaterThan(lastStrokeIdx)
    expect(ops[fillIdx].shadowed).toBe(false)

    // 6) The HIGHLIGHT overlay is the VERY LAST op (above effects + everything).
    const last = ops[ops.length - 1]
    expect(last.op).toBe('fillText')
    expect(last.style).toBe('rgba(0, 255, 0, 1)')

    // The fill is strictly before the final (highlight) op.
    expect(fillIdx).toBeLessThan(ops.length - 1)
  })

  it('inner shadow paints AFTER the fill (over the body), with source-atop', () => {
    const { ctx, ops } = recordingCtx()
    paintGlyphPasses({
      ctx,
      token: TOKEN,
      shadow: innerShadow(),
      stroke: null,
      fill: (c, tk) => {
        c.fillStyle = 'rgba(255, 0, 0, 1)'
        c.fillText(tk.text, tk.x, tk.y)
      }
    })
    // The body fill comes first (no inner pre-pass behind the glyph).
    const bodyIdx = ops.findIndex((o) => o.style === 'rgba(255, 0, 0, 1)')
    expect(bodyIdx).toBe(0)
    // The inner-shadow technique paints AFTER the body, and at least one of its ops
    // runs under the `source-atop` composite (the clipped offset copy).
    const afterBody = ops.slice(bodyIdx + 1)
    expect(afterBody.length).toBeGreaterThan(0)
    expect(afterBody.some((o) => o.composite === 'source-atop')).toBe(true)
  })

  it('long shadow casts a SOLID trail behind the glyph, before stroke/fill', () => {
    const { ctx, ops } = recordingCtx()
    paintGlyphPasses({
      ctx,
      token: TOKEN,
      shadow: longShadow(),
      stroke: twoLayerStroke(),
      fill: (c, tk) => {
        c.fillStyle = 'rgba(255, 0, 0, 1)'
        c.fillText(tk.text, tk.x, tk.y)
      }
    })
    // The trail is solid fillTexts in the shadow color, BEFORE any stroke/body op,
    // and crisp (no live canvas shadow*).
    const firstStroke = ops.findIndex((o) => o.op === 'strokeText')
    const trail = ops.slice(0, firstStroke)
    expect(trail.length).toBeGreaterThan(0)
    expect(trail.every((o) => o.op === 'fillText')).toBe(true)
    expect(trail.every((o) => o.style === 'rgba(0, 0, 0, 1)')).toBe(true)
    expect(trail.every((o) => !o.shadowed)).toBe(true) // crisp — no blur
  })

  it('HOLLOW skips the fill AND the inner shadow (outline only)', () => {
    const { ctx, ops } = recordingCtx()
    let filled = false
    paintGlyphPasses({
      ctx,
      token: TOKEN,
      shadow: innerShadow(),
      stroke: { ...twoLayerStroke(), hollow: true },
      fill: () => {
        filled = true
      }
    })
    expect(filled).toBe(false) // the fill callback is never invoked
    // Only stroke ops (shadow-cast stroke + the two visible layers); no fillText body.
    expect(ops.every((o) => o.op === 'strokeText')).toBe(true)
  })

  it('no shadow + no stroke → just the fill (degenerate path)', () => {
    const { ctx, ops } = recordingCtx()
    paintGlyphPasses({
      ctx,
      token: TOKEN,
      shadow: null,
      stroke: null,
      fill: (c, tk) => {
        c.fillStyle = 'rgba(1, 2, 3, 1)'
        c.fillText(tk.text, tk.x, tk.y)
      }
    })
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ op: 'fillText', style: 'rgba(1, 2, 3, 1)', shadowed: false })
  })

  it('empty token paints nothing', () => {
    const { ctx, ops } = recordingCtx()
    let filled = false
    paintGlyphPasses({
      ctx,
      token: { text: '', x: 0, y: 0 },
      shadow: dropShadow(),
      stroke: twoLayerStroke(),
      fill: () => {
        filled = true
      }
    })
    expect(filled).toBe(false)
    expect(ops).toHaveLength(0)
  })
})

describe('effects hook (Phase 7 insertion point)', () => {
  it('runEffectsHook runs between fill+inner and the highlight overlay', () => {
    const { ctx } = recordingCtx()
    const phases: string[] = []
    paintGlyphPasses({
      ctx,
      token: TOKEN,
      shadow: null,
      stroke: null,
      fill: () => phases.push('fill'),
      effects: () => phases.push('effects'),
      highlight: () => phases.push('highlight')
    })
    expect(phases).toEqual(['fill', 'effects', 'highlight'])
  })

  it('NO_EFFECTS is a no-op and is the default when no effects pass is given', () => {
    const { ctx, ops } = recordingCtx()
    // Direct: the default no-op draws nothing.
    runEffectsHook(ctx, TOKEN, { shadow: null, stroke: null })
    expect(ops).toHaveLength(0)
    // NO_EFFECTS itself does not throw and touches no canvas.
    expect(() => NO_EFFECTS(ctx, TOKEN, { shadow: null, stroke: null })).not.toThrow()
    expect(ops).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Integration: the thumbnail renderer (straight-line branch equivalent) must
// follow the SAME canonical order through drawPresetCaption.
// ---------------------------------------------------------------------------
describe('drawPresetCaption — canonical order via the shared pipeline', () => {
  const spec = (over: Partial<TextDrawSpec>): TextDrawSpec => ({
    font: 'normal 40px Inter',
    fontSizePx: 40,
    lineHeight: 1.2,
    letterSpacing: 0,
    fill: { type: 'solid', color: 'rgba(255, 0, 0, 1)' },
    stroke: [
      { color: 'rgba(0, 0, 0, 1)', width: 6 },
      { color: 'rgba(255, 255, 255, 1)', width: 2 }
    ],
    shadow: dropShadow(),
    background: null,
    ...over
  })

  it('casts the shadow first, strokes widest-first, then fills', () => {
    const { ctx, ops } = recordingCtx()
    drawPresetCaption(ctx, spec({}), { width: 1000, height: 500, lines: ['Hi'] })

    // First op: the shadow-cast transparent stroke of the widest layer.
    expect(ops[0]).toMatchObject({ op: 'strokeText', shadowed: true, lineWidth: 6 })

    // Visible strokes, widest → thinnest, no live shadow.
    const visibleStrokes = ops.filter((o) => o.op === 'strokeText' && o.style !== 'rgba(0, 0, 0, 0)')
    expect(visibleStrokes.map((o) => o.lineWidth)).toEqual([6, 2])
    expect(visibleStrokes.every((o) => !o.shadowed)).toBe(true)

    // The fill comes after the last stroke.
    const fillIdx = ops.findIndex((o) => o.op === 'fillText')
    const lastStrokeIdx = ops.map((o) => o.op).lastIndexOf('strokeText')
    expect(fillIdx).toBeGreaterThan(lastStrokeIdx)
  })

  it('inner shadow on a thumbnail paints after the fill (source-atop)', () => {
    const { ctx, ops } = recordingCtx()
    drawPresetCaption(ctx, spec({ shadow: innerShadow(), stroke: [] }), {
      width: 1000,
      height: 500,
      lines: ['Hi']
    })
    const bodyIdx = ops.findIndex((o) => o.style === 'rgba(255, 0, 0, 1)')
    expect(bodyIdx).toBeGreaterThanOrEqual(0)
    const after = ops.slice(bodyIdx + 1)
    expect(after.some((o) => o.composite === 'source-atop')).toBe(true)
  })
})

/**
 * Tests for the built-in RETRO/VINTAGE effect renderer (P7.4 — Doc 04; skill `text-render`).
 *
 * A retro look = warm PALETTE tint (graded toward the effect `color`) + deterministic
 * film GRAIN (seeded speckle, count scaled by grain*intensity) + a SLIGHT CHROMA shift
 * (small R/B split, smaller than the glitch split for comparable params).
 *
 * Covers:
 *   - PURE resolvers: palette-tint alpha/color scales with intensity (moves toward
 *     `color`); grain speckles are DETERMINISTIC (same seed → same; count = floor(
 *     grain*intensity*GRAIN_DENSITY)); chroma offsets are a small R/B split STRICTLY
 *     SMALLER than the glitch split (resolveChannelOffsets) for the same params;
 *   - the renderer: grain 0 + chroma 0 → just the tint (intensity > 0); intensity 0 →
 *     full no-op; disabled → composed pass undefined; ctx restored; deterministic
 *     (preview == export); stacks in order with other effects;
 *   - reuses the glitch seeded PRNG (mulberry32 + hashSeed) keyed by token.text;
 * all driven by a recording ctx (headless, no real canvas).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  GRAIN_DENSITY,
  RETRO_CHROMA_FACTOR,
  hashSeed,
  registerBuiltinEffects,
  resolveChannelOffsets,
  resolveChromaOffsets,
  resolveGrainSpeckles,
  resolvePaletteTintAlpha,
  resolvePaletteTintColor
} from './textEffectsBuiltin'
import {
  composeEffectsPass,
  hasEffectRenderer,
  unregisterEffectRenderer
} from './textEffectsPipeline'
import type { GlyphToken } from './textPaintPipeline'
import { defaultTextEffect, type TextEffect, type TextEffectType } from '../../../../shared/textEffect'

const TOKEN: GlyphToken = { text: 'Ab', x: 10, y: 20 }
const ALL_TYPES: TextEffectType[] = ['glow', 'neon', 'glitch', '3d', 'retro', 'blur', 'echo']

interface PaintOp {
  kind: 'fill' | 'stroke' | 'rect'
  text: string
  x: number
  y: number
  w: number
  h: number
  alpha: number
  fillStyle: string
  composite: string
}

/** Recording ctx that snapshots fill/rect position + composite mode + alpha + style. */
function recordingCtx(): {
  ctx: CanvasRenderingContext2D
  ops: PaintOp[]
  saveDepth: () => number
} {
  const ops: PaintOp[] = []
  let depth = 0
  const s = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    shadowColor: 'transparent',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
    filter: 'none',
    font: ''
  }
  const snap = (
    kind: 'fill' | 'stroke' | 'rect',
    text: string,
    x: number,
    y: number,
    w = 0,
    h = 0
  ): PaintOp => ({
    kind,
    text,
    x,
    y,
    w,
    h,
    alpha: s.globalAlpha,
    fillStyle: s.fillStyle,
    composite: s.globalCompositeOperation
  })
  const ctx = {
    save() {
      depth += 1
    },
    restore() {
      depth -= 1
    },
    fillText(text: string, x: number, y: number) {
      ops.push(snap('fill', text, x, y))
    },
    strokeText(text: string, x: number, y: number) {
      ops.push(snap('stroke', text, x, y))
    },
    fillRect(x: number, y: number, w: number, h: number) {
      ops.push(snap('rect', '', x, y, w, h))
    },
    beginPath() {},
    clip() {},
    measureText(text: string) {
      // Deterministic synthetic metrics so the grain box is stable in tests.
      return {
        width: text.length * 10,
        actualBoundingBoxAscent: 12,
        actualBoundingBoxDescent: 3
      } as TextMetrics
    }
  }
  Object.defineProperties(ctx, {
    globalAlpha: { get: () => s.globalAlpha, set: (v) => (s.globalAlpha = v) },
    globalCompositeOperation: {
      get: () => s.globalCompositeOperation,
      set: (v) => (s.globalCompositeOperation = v)
    },
    shadowColor: { get: () => s.shadowColor, set: (v) => (s.shadowColor = v) },
    shadowBlur: { get: () => s.shadowBlur, set: (v) => (s.shadowBlur = v) },
    shadowOffsetX: { get: () => s.shadowOffsetX, set: (v) => (s.shadowOffsetX = v) },
    shadowOffsetY: { get: () => s.shadowOffsetY, set: (v) => (s.shadowOffsetY = v) },
    fillStyle: { get: () => s.fillStyle, set: (v) => (s.fillStyle = v) },
    strokeStyle: { get: () => s.strokeStyle, set: (v) => (s.strokeStyle = v) },
    lineWidth: { get: () => s.lineWidth, set: (v) => (s.lineWidth = v) },
    lineJoin: { get: () => s.lineJoin, set: (v) => (s.lineJoin = v) },
    filter: { get: () => s.filter, set: (v) => (s.filter = v) },
    font: { get: () => s.font, set: (v) => (s.font = v) }
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops, saveDepth: () => depth }
}

/** Render a single effect through the composed pass (mirrors the pipeline path). */
function render(ctx: CanvasRenderingContext2D, effect: TextEffect, token: GlyphToken = TOKEN): void {
  const pass = composeEffectsPass([effect])
  if (pass) pass(ctx, token, { shadow: null, stroke: null })
}

function retro(overrides: Partial<TextEffect> = {}): TextEffect {
  return { ...defaultTextEffect('retro'), ...overrides } as TextEffect
}

beforeEach(() => {
  for (const t of ALL_TYPES) unregisterEffectRenderer(t)
  registerBuiltinEffects()
})
afterEach(() => {
  for (const t of ALL_TYPES) unregisterEffectRenderer(t)
  registerBuiltinEffects()
})

// ───────────────────────────────────────────────────────────────────────────
describe('resolvePaletteTintAlpha / Color (PURE)', () => {
  it('tint alpha scales with intensity', () => {
    expect(resolvePaletteTintAlpha(0)).toBe(0)
    expect(resolvePaletteTintAlpha(1)).toBeGreaterThan(0)
    expect(resolvePaletteTintAlpha(1)).toBeGreaterThan(resolvePaletteTintAlpha(0.5))
  })

  it('tint alpha is a translucent WASH (< 1) even at full intensity', () => {
    // The glyph keeps its body — the tint grades TOWARD the palette, not an opaque recolor.
    expect(resolvePaletteTintAlpha(1)).toBeLessThan(1)
  })

  it('intensity 0 → no tint', () => {
    expect(resolvePaletteTintAlpha(0)).toBe(0)
  })

  it('palette color moves the fill toward `color` by intensity', () => {
    // Higher intensity → higher tint alpha in the rgba() → glyph grades further toward color.
    const lo = resolvePaletteTintColor('#f4e7c5', 0.3, 1)
    const hi = resolvePaletteTintColor('#f4e7c5', 0.9, 1)
    const aLo = Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(lo)![1])
    const aHi = Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(hi)![1])
    expect(aHi).toBeGreaterThan(aLo)
    // It IS the palette color's rgb (244,231,197 for #f4e7c5).
    expect(hi).toMatch(/^rgba\(244, 231, 197,/)
  })

  it('palette tint color folds in the base (opacity) alpha', () => {
    const full = resolvePaletteTintColor('#f4e7c5', 1, 1)
    const half = resolvePaletteTintColor('#f4e7c5', 1, 0.5)
    const aFull = Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(full)![1])
    const aHalf = Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(half)![1])
    expect(aHalf).toBeCloseTo(aFull * 0.5, 3)
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('resolveGrainSpeckles (deterministic film grain, parity-safe)', () => {
  it('same seed → identical speckles; different seed → different', () => {
    const a = resolveGrainSpeckles(111, 0.5, 1)
    const b = resolveGrainSpeckles(111, 0.5, 1)
    const c = resolveGrainSpeckles(222, 0.5, 1)
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
  })

  it('count = floor(grain * intensity * GRAIN_DENSITY)', () => {
    expect(resolveGrainSpeckles(1, 1, 1)).toHaveLength(GRAIN_DENSITY)
    expect(resolveGrainSpeckles(1, 0.5, 1)).toHaveLength(Math.floor(0.5 * GRAIN_DENSITY))
    expect(resolveGrainSpeckles(1, 1, 0.5)).toHaveLength(Math.floor(0.5 * GRAIN_DENSITY))
    // grain * intensity together: 0.5 * 0.5 = 0.25
    expect(resolveGrainSpeckles(1, 0.5, 0.5)).toHaveLength(Math.floor(0.25 * GRAIN_DENSITY))
  })

  it('count scales with BOTH grain and intensity', () => {
    expect(resolveGrainSpeckles(1, 1, 1).length).toBeGreaterThan(
      resolveGrainSpeckles(1, 0.5, 1).length
    )
    expect(resolveGrainSpeckles(1, 1, 1).length).toBeGreaterThan(
      resolveGrainSpeckles(1, 1, 0.5).length
    )
  })

  it('grain 0 → no speckles', () => {
    expect(resolveGrainSpeckles(1, 0, 1)).toHaveLength(0)
  })

  it('intensity 0 → no speckles', () => {
    expect(resolveGrainSpeckles(1, 1, 0)).toHaveLength(0)
  })

  it('speckles are within the unit box with bounded alpha', () => {
    const sp = resolveGrainSpeckles(7, 1, 1)
    expect(sp.length).toBeGreaterThan(0)
    expect(sp.every((s) => s.fx >= 0 && s.fx < 1 && s.fy >= 0 && s.fy < 1)).toBe(true)
    expect(sp.every((s) => s.alpha >= 0 && s.alpha <= 1)).toBe(true)
  })

  it('uses the SAME seeded PRNG as glitch (hashSeed keyed by token text)', () => {
    // hashSeed is shared; same token text → same seed → same speckle pattern.
    const fromText = resolveGrainSpeckles(hashSeed('Ab'), 1, 1)
    const fromSameSeed = resolveGrainSpeckles(hashSeed('Ab'), 1, 1)
    expect(fromText).toEqual(fromSameSeed)
    expect(resolveGrainSpeckles(hashSeed('Ab'), 1, 1)).not.toEqual(
      resolveGrainSpeckles(hashSeed('Zz'), 1, 1)
    )
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('resolveChromaOffsets (SLIGHT split, smaller than glitch)', () => {
  it('produces a small R/B split (green centered)', () => {
    const offs = resolveChromaOffsets(10, 1, 0)
    const r = offs.find((o) => o.channel === 'r')!
    const g = offs.find((o) => o.channel === 'g')!
    const b = offs.find((o) => o.channel === 'b')!
    expect(r.dx).toBeGreaterThan(0)
    expect(g.dx).toBe(0)
    expect(b.dx).toBe(-r.dx)
  })

  it('is STRICTLY SMALLER than the glitch split for the same params', () => {
    const retroR = resolveChromaOffsets(10, 1, 0).find((o) => o.channel === 'r')!.dx
    const glitchR = resolveChannelOffsets(10, 1, 0).find((o) => o.channel === 'r')!.dx
    expect(retroR).toBeLessThan(glitchR)
    // And exactly the documented fraction of the glitch split.
    expect(retroR).toBeCloseTo(glitchR * RETRO_CHROMA_FACTOR, 3)
    expect(RETRO_CHROMA_FACTOR).toBeLessThan(1)
  })

  it('chroma 0 → no split', () => {
    expect(resolveChromaOffsets(0, 1, 0).every((o) => o.dx === 0 && o.dy === 0)).toBe(true)
  })

  it('intensity 0 → no split', () => {
    expect(resolveChromaOffsets(10, 0, 0).every((o) => o.dx === 0 && o.dy === 0)).toBe(true)
  })

  it('deterministic: identical calls match', () => {
    expect(resolveChromaOffsets(5, 0.7, 30)).toEqual(resolveChromaOffsets(5, 0.7, 30))
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('retro renderer', () => {
  it('registers through registerBuiltinEffects', () => {
    expect(hasEffectRenderer('retro')).toBe(true)
  })

  it('grain 0 + chroma 0 → JUST the palette tint (one fill stamp toward color)', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, retro({ params: { grain: 0, chroma: 0, color: '#f4e7c5' }, intensity: 1 }))
    expect(ops).toHaveLength(1)
    expect(ops[0].kind).toBe('fill')
    expect(ops[0].x).toBe(TOKEN.x)
    expect(ops[0].y).toBe(TOKEN.y)
    // Tint is the palette color (244,231,197) at a fractional alpha.
    expect(ops[0].fillStyle).toMatch(/^rgba\(244, 231, 197,/)
  })

  it('palette tint moves toward `color` more as intensity rises', () => {
    const lo = recordingCtx()
    const hi = recordingCtx()
    render(lo.ctx, retro({ params: { grain: 0, chroma: 0, color: '#f4e7c5' }, intensity: 0.3 }))
    render(hi.ctx, retro({ params: { grain: 0, chroma: 0, color: '#f4e7c5' }, intensity: 0.9 }))
    const aLo = Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(lo.ops[0].fillStyle)![1])
    const aHi = Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(hi.ops[0].fillStyle)![1])
    expect(aHi).toBeGreaterThan(aLo)
  })

  it('grain produces deterministic speckle rects (rect ops), count scaled by grain*intensity', () => {
    const a = recordingCtx()
    const b = recordingCtx()
    const eff = retro({ params: { grain: 1, chroma: 0, color: '#f4e7c5' }, intensity: 1 })
    render(a.ctx, eff)
    render(b.ctx, eff)
    const aRects = a.ops.filter((o) => o.kind === 'rect')
    expect(aRects).toHaveLength(GRAIN_DENSITY)
    // Deterministic: same token + params → identical speckle stream (preview == export).
    expect(a.ops.map((o) => [o.kind, o.x, o.y, o.fillStyle])).toEqual(
      b.ops.map((o) => [o.kind, o.x, o.y, o.fillStyle])
    )
  })

  it('grain count scales with grain*intensity', () => {
    const full = recordingCtx()
    const half = recordingCtx()
    render(full.ctx, retro({ params: { grain: 1, chroma: 0, color: '#f4e7c5' }, intensity: 1 }))
    render(half.ctx, retro({ params: { grain: 0.5, chroma: 0, color: '#f4e7c5' }, intensity: 1 }))
    expect(full.ops.filter((o) => o.kind === 'rect')).toHaveLength(GRAIN_DENSITY)
    expect(half.ops.filter((o) => o.kind === 'rect')).toHaveLength(Math.floor(0.5 * GRAIN_DENSITY))
  })

  it('different token text → different grain (seed keyed by token.text)', () => {
    const a = recordingCtx()
    const b = recordingCtx()
    const eff = retro({ params: { grain: 1, chroma: 0, color: '#f4e7c5' }, intensity: 1 })
    render(a.ctx, eff, { text: 'Ab', x: 10, y: 20 })
    render(b.ctx, eff, { text: 'Zz', x: 10, y: 20 })
    const ax = a.ops.filter((o) => o.kind === 'rect').map((o) => o.x)
    const bx = b.ops.filter((o) => o.kind === 'rect').map((o) => o.x)
    expect(ax).not.toEqual(bx)
  })

  it('slight chroma split is present and SMALLER than glitch for comparable params', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, retro({ params: { grain: 0, chroma: 10, color: '#f4e7c5' }, intensity: 1 }))
    const red = ops.find((o) => /rgba\(255, 0, 0/.test(o.fillStyle))!
    const blue = ops.find((o) => /rgba\(0, 0, 255/.test(o.fillStyle))!
    expect(red).toBeTruthy()
    expect(blue).toBeTruthy()
    // The retro red offset is the glitch offset * RETRO_CHROMA_FACTOR (smaller).
    const retroDx = red.x - TOKEN.x
    const glitchDx = resolveChannelOffsets(10, 1, 0).find((o) => o.channel === 'r')!.dx
    expect(retroDx).toBeLessThan(glitchDx)
    expect(retroDx).toBeCloseTo(glitchDx * RETRO_CHROMA_FACTOR, 3)
    // Chroma stamps composite additively (lighter), like glitch.
    expect(red.composite).toBe('lighter')
  })

  it('intensity 0 → full no-op', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, retro({ intensity: 0 }))
    expect(ops).toHaveLength(0)
  })

  it('opacity rides globalAlpha into the tint alpha', () => {
    const full = recordingCtx()
    const half = recordingCtx()
    render(full.ctx, retro({ opacity: 1, params: { grain: 0, chroma: 0, color: '#f4e7c5' }, intensity: 1 }))
    render(half.ctx, retro({ opacity: 0.5, params: { grain: 0, chroma: 0, color: '#f4e7c5' }, intensity: 1 }))
    const aFull = Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(full.ops[0].fillStyle)![1])
    const aHalf = Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(half.ops[0].fillStyle)![1])
    expect(aHalf).toBeCloseTo(aFull * 0.5, 2)
    expect(half.ops[0].alpha).toBeCloseTo(0.5)
  })

  it('disabled → composed pass is undefined', () => {
    expect(composeEffectsPass([retro({ enabled: false })])).toBeUndefined()
  })

  it('restores ctx after — composite + alpha back to entry values, depth balanced', () => {
    const { ctx, ops, saveDepth } = recordingCtx()
    render(ctx, retro({ params: { grain: 0.5, chroma: 4, color: '#f4e7c5' }, intensity: 1 }))
    expect(ops.length).toBeGreaterThan(0)
    expect(saveDepth()).toBe(0)
    expect(ctx.globalAlpha).toBe(1)
    expect((ctx as unknown as { globalCompositeOperation: string }).globalCompositeOperation).toBe(
      'source-over'
    )
  })

  it('deterministic: same token + params → identical op stream (preview == export)', () => {
    const a = recordingCtx()
    const b = recordingCtx()
    const eff = retro({ params: { grain: 0.7, chroma: 5, color: '#f4e7c5' }, intensity: 0.8 })
    render(a.ctx, eff)
    render(b.ctx, eff)
    expect(a.ops).toEqual(b.ops)
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('stacking preserves ORDER and isolation', () => {
  it('retro then glow: retro ops first, glow ops after, no composite leak', () => {
    const { ctx, ops } = recordingCtx()
    const pass = composeEffectsPass([
      retro({ params: { grain: 0.5, chroma: 6, color: '#f4e7c5' }, intensity: 1 }),
      { ...defaultTextEffect('glow'), params: { radius: 10, color: '#ffffff' } }
    ])!
    pass(ctx, TOKEN, { shadow: null, stroke: null })
    // Retro's additive chroma stamps precede the glow's source-over stamps.
    const lastLighter = ops.map((o) => o.composite).lastIndexOf('lighter')
    const lastSourceOver = ops.map((o) => o.composite).lastIndexOf('source-over')
    expect(lastLighter).toBeGreaterThanOrEqual(0)
    expect(lastSourceOver).toBeGreaterThan(lastLighter)
  })

  it('after a retro+glow stack the ctx state is clean', () => {
    const { ctx } = recordingCtx()
    const pass = composeEffectsPass([retro(), defaultTextEffect('glow')])!
    pass(ctx, TOKEN, { shadow: null, stroke: null })
    expect(ctx.globalAlpha).toBe(1)
    expect((ctx as unknown as { globalCompositeOperation: string }).globalCompositeOperation).toBe(
      'source-over'
    )
  })
})

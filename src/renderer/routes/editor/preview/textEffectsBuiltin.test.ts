/**
 * Tests for the built-in GLOW + NEON effect renderers (P7.2 — Doc 04; skill
 * `text-render`). Covers the pure param→canvas helpers, that each renderer sets the
 * right shadow blur (proportional to radius*intensity) in the right color, draws a
 * core (neon), restores ctx state, honors opacity, no-ops at intensity 0 / disabled
 * / radius 0, registers + dispatches through the registry, and stacks in order with
 * the proof `blur` effect — all driven by a recording ctx (headless, no real canvas).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clamp01,
  registerBuiltinEffects,
  resolveGlowBlur,
  resolveNeonBlur,
  resolveNeonCore,
  withAlpha
} from './textEffectsBuiltin'
import {
  composeEffectsPass,
  hasEffectRenderer,
  unregisterEffectRenderer
} from './textEffectsPipeline'
import type { GlyphToken } from './textPaintPipeline'
import { defaultTextEffect, type TextEffect, type TextEffectType } from '../../../../shared/textEffect'

const TOKEN: GlyphToken = { text: 'Ab', x: 0, y: 0 }
const ALL_TYPES: TextEffectType[] = ['glow', 'neon', 'glitch', '3d', 'retro', 'blur', 'echo']

interface PaintOp {
  kind: 'fill' | 'stroke'
  text: string
  alpha: number
  shadowColor: string
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  fillStyle: string
  strokeStyle: string
  lineWidth: number
}

/**
 * Recording ctx that snapshots the FULL relevant state at each fillText/strokeText
 * and tracks save/restore depth (so a test can assert the renderer balanced them).
 */
function recordingCtx(): {
  ctx: CanvasRenderingContext2D
  ops: PaintOp[]
  saveDepth: () => number
} {
  const ops: PaintOp[] = []
  let depth = 0
  let maxDepth = 0
  const s = {
    globalAlpha: 1,
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
  const snap = (kind: 'fill' | 'stroke', text: string): PaintOp => ({
    kind,
    text,
    alpha: s.globalAlpha,
    shadowColor: s.shadowColor,
    shadowBlur: s.shadowBlur,
    shadowOffsetX: s.shadowOffsetX,
    shadowOffsetY: s.shadowOffsetY,
    fillStyle: s.fillStyle,
    strokeStyle: s.strokeStyle,
    lineWidth: s.lineWidth
  })
  const ctx = {
    save() {
      depth += 1
      maxDepth = Math.max(maxDepth, depth)
    },
    restore() {
      depth -= 1
    },
    fillText(text: string) {
      ops.push(snap('fill', text))
    },
    strokeText(text: string) {
      ops.push(snap('stroke', text))
    }
  }
  Object.defineProperties(ctx, {
    globalAlpha: { get: () => s.globalAlpha, set: (v) => (s.globalAlpha = v) },
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
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    ops,
    saveDepth: () => depth
  }
}

/** Render a single effect through the composed pass (mirrors the pipeline path). */
function render(ctx: CanvasRenderingContext2D, effect: TextEffect): void {
  const pass = composeEffectsPass([effect])
  if (pass) pass(ctx, TOKEN, { shadow: null, stroke: null })
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
describe('pure param→canvas helpers', () => {
  it('clamp01 clamps + guards NaN', () => {
    expect(clamp01(-1)).toBe(0)
    expect(clamp01(0.5)).toBe(0.5)
    expect(clamp01(2)).toBe(1)
    expect(clamp01(Number.NaN)).toBe(0)
  })

  it('resolveGlowBlur = radius*intensity, floored at 0', () => {
    expect(resolveGlowBlur(12, 1)).toBe(12)
    expect(resolveGlowBlur(12, 0.5)).toBe(6)
    expect(resolveGlowBlur(12, 0)).toBe(0)
    expect(resolveGlowBlur(0, 1)).toBe(0)
    expect(resolveGlowBlur(-5, 1)).toBe(0)
  })

  it('resolveNeonBlur matches resolveGlowBlur', () => {
    expect(resolveNeonBlur(16, 0.5)).toBe(resolveGlowBlur(16, 0.5))
  })

  it('resolveNeonCore = core*intensity, floored at 0', () => {
    expect(resolveNeonCore(4, 1)).toBe(4)
    expect(resolveNeonCore(4, 0.25)).toBe(1)
    expect(resolveNeonCore(4, 0)).toBe(0)
    expect(resolveNeonCore(-2, 1)).toBe(0)
  })

  it('withAlpha folds the alpha into the rgba (and multiplies an existing hex alpha)', () => {
    expect(withAlpha('#ffffff', 1)).toBe('rgba(255, 255, 255, 1)')
    expect(withAlpha('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)')
    expect(withAlpha('#0f0', 1)).toBe('rgba(0, 255, 0, 1)')
    // #rrggbbaa: existing alpha 0x80≈0.5, multiplied by 0.5 ≈ 0.25
    expect(withAlpha('#ff000080', 0.5)).toMatch(/rgba\(255, 0, 0, 0\.2/)
    // unparseable → passthrough
    expect(withAlpha('not-a-color', 0.5)).toBe('not-a-color')
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('glow renderer', () => {
  it('registers through registerBuiltinEffects', () => {
    expect(hasEffectRenderer('glow')).toBe(true)
  })

  it('sets a shadow blur proportional to radius*intensity in the effect color', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, { ...defaultTextEffect('glow'), params: { radius: 20, color: '#ff0000' }, intensity: 0.5 })
    // Halo passes carry a non-zero blur; effective base = 20*0.5 = 10.
    const blooms = ops.filter((o) => o.shadowBlur > 0)
    expect(blooms.length).toBeGreaterThanOrEqual(1)
    expect(Math.max(...blooms.map((o) => o.shadowBlur))).toBe(10)
    // The bloom color is the effect color folded with alpha (red).
    expect(blooms[0].shadowColor).toMatch(/rgba\(255, 0, 0/)
    // No offset — the halo is even all around.
    expect(blooms.every((o) => o.shadowOffsetX === 0 && o.shadowOffsetY === 0)).toBe(true)
  })

  it('re-stamps the glyph body LAST with the shadow cleared (text stays legible)', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, defaultTextEffect('glow'))
    const last = ops[ops.length - 1]
    expect(last.kind).toBe('fill')
    expect(last.text).toBe('Ab')
    expect(last.shadowBlur).toBe(0)
    expect(last.shadowColor).toBe('transparent')
  })

  it('restores ctx after — shadow + alpha back to entry values', () => {
    const { ctx, ops, saveDepth } = recordingCtx()
    render(ctx, defaultTextEffect('glow'))
    expect(ops.length).toBeGreaterThan(0)
    expect(saveDepth()).toBe(0)
    expect(ctx.shadowColor).toBe('transparent')
    expect(ctx.shadowBlur).toBe(0)
    expect(ctx.globalAlpha).toBe(1)
  })

  it('opacity scales the bloom alpha', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, { ...defaultTextEffect('glow'), opacity: 0.4, params: { radius: 12, color: '#ffffff' } })
    const bloom = ops.find((o) => o.shadowBlur > 0)!
    // globalAlpha (0.4) folded into the halo color.
    expect(bloom.shadowColor).toBe('rgba(255, 255, 255, 0.4)')
    expect(bloom.alpha).toBeCloseTo(0.4)
  })

  it('intensity 0 → no-op (no paint ops at all)', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, { ...defaultTextEffect('glow'), intensity: 0 })
    expect(ops).toHaveLength(0)
  })

  it('radius 0 → no-op', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, { ...defaultTextEffect('glow'), params: { radius: 0, color: '#fff' } })
    expect(ops).toHaveLength(0)
  })

  it('disabled → composed pass is undefined (no work)', () => {
    expect(composeEffectsPass([{ ...defaultTextEffect('glow'), enabled: false }])).toBeUndefined()
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('neon renderer', () => {
  it('registers through registerBuiltinEffects', () => {
    expect(hasEffectRenderer('neon')).toBe(true)
  })

  it('draws an outer colored bloom AND a bright core stroke', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, { ...defaultTextEffect('neon'), params: { radius: 20, color: '#00eaff', core: 3 }, intensity: 1 })
    // Outer bloom: a fill under a non-zero colored shadow.
    const bloom = ops.find((o) => o.kind === 'fill' && o.shadowBlur > 0)
    expect(bloom).toBeDefined()
    expect(bloom!.shadowColor).toMatch(/rgba\(0, 234, 255/)
    expect(bloom!.shadowBlur).toBe(20)
    // Bright core: a sharp (no-shadow) white stroke.
    const core = ops.find((o) => o.kind === 'stroke' && o.shadowBlur === 0)
    expect(core).toBeDefined()
    expect(core!.strokeStyle).toBe('#ffffff')
    expect(core!.lineWidth).toBe(3) // core*intensity
  })

  it('paints the neon-colored body fill LAST with shadow cleared (legible)', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, { ...defaultTextEffect('neon'), params: { radius: 16, color: '#00eaff', core: 2 } })
    const last = ops[ops.length - 1]
    expect(last.kind).toBe('fill')
    expect(last.shadowBlur).toBe(0)
    expect(last.shadowColor).toBe('transparent')
    expect(last.fillStyle).toMatch(/rgba\(0, 234, 255/)
  })

  it('restores ctx after', () => {
    const { ctx, saveDepth } = recordingCtx()
    render(ctx, defaultTextEffect('neon'))
    expect(saveDepth()).toBe(0)
    expect(ctx.shadowColor).toBe('transparent')
    expect(ctx.shadowBlur).toBe(0)
    expect(ctx.globalAlpha).toBe(1)
  })

  it('opacity scales the bloom + body alpha', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, { ...defaultTextEffect('neon'), opacity: 0.5, params: { radius: 16, color: '#00ff00', core: 2 } })
    const bloom = ops.find((o) => o.kind === 'fill' && o.shadowBlur > 0)!
    expect(bloom.shadowColor).toBe('rgba(0, 255, 0, 0.5)')
    const body = ops[ops.length - 1]
    expect(body.fillStyle).toBe('rgba(0, 255, 0, 0.5)')
  })

  it('intensity 0 → no-op (bloom + core both collapse to 0)', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, { ...defaultTextEffect('neon'), intensity: 0 })
    expect(ops).toHaveLength(0)
  })

  it('radius 0 but a core still draws the tube (degrades gracefully)', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, { ...defaultTextEffect('neon'), params: { radius: 0, color: '#00eaff', core: 2 } })
    // No bloom (radius 0) but the core stroke + body fill still paint.
    expect(ops.some((o) => o.kind === 'stroke')).toBe(true)
    expect(ops.some((o) => o.shadowBlur > 0)).toBe(false)
  })

  it('radius 0 AND core 0 → no-op', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, { ...defaultTextEffect('neon'), params: { radius: 0, color: '#00eaff', core: 0 } })
    expect(ops).toHaveLength(0)
  })

  it('disabled → composed pass is undefined', () => {
    expect(composeEffectsPass([{ ...defaultTextEffect('neon'), enabled: false }])).toBeUndefined()
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('stacking glow + neon preserves ORDER and isolation', () => {
  it('glow then neon paints glow ops first, neon ops second; no shadow leaks between', () => {
    const { ctx, ops } = recordingCtx()
    const pass = composeEffectsPass([
      { ...defaultTextEffect('glow'), params: { radius: 10, color: '#ff0000' } },
      { ...defaultTextEffect('neon'), params: { radius: 16, color: '#00eaff', core: 2 } }
    ])!
    pass(ctx, TOKEN, { shadow: null, stroke: null })
    // The glow's final body re-stamp (red is NOT involved in its fillStyle, but its
    // bloom is red) precedes any cyan neon op. Assert the FIRST cyan bloom comes
    // after the LAST red bloom.
    const lastRedBloom = ops.map((o) => o.shadowColor).lastIndexOf('rgba(255, 0, 0, 1)')
    const firstCyan = ops.findIndex((o) => /rgba\(0, 234, 255/.test(o.shadowColor) || /rgba\(0, 234, 255/.test(o.fillStyle))
    expect(lastRedBloom).toBeGreaterThanOrEqual(0)
    expect(firstCyan).toBeGreaterThan(lastRedBloom)
  })

  it('neon then glow reverses the op order', () => {
    const { ctx, ops } = recordingCtx()
    const pass = composeEffectsPass([
      { ...defaultTextEffect('neon'), params: { radius: 16, color: '#00eaff', core: 2 } },
      { ...defaultTextEffect('glow'), params: { radius: 10, color: '#ff0000' } }
    ])!
    pass(ctx, TOKEN, { shadow: null, stroke: null })
    const firstCyan = ops.findIndex((o) => /rgba\(0, 234, 255/.test(o.shadowColor) || /rgba\(0, 234, 255/.test(o.fillStyle))
    const firstRed = ops.findIndex((o) => o.shadowColor === 'rgba(255, 0, 0, 1)')
    expect(firstCyan).toBeGreaterThanOrEqual(0)
    expect(firstRed).toBeGreaterThan(firstCyan)
  })

  it('after a glow+neon stack the ctx shadow state is clean (no leak to highlight)', () => {
    const { ctx } = recordingCtx()
    const pass = composeEffectsPass([defaultTextEffect('glow'), defaultTextEffect('neon')])!
    pass(ctx, TOKEN, { shadow: null, stroke: null })
    expect(ctx.shadowBlur).toBe(0)
    expect(ctx.shadowColor).toBe('transparent')
    expect(ctx.globalAlpha).toBe(1)
  })
})

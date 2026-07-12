/**
 * Tests for the built-in BLUR (real Gaussian) + ECHO/double-exposure renderers
 * (P7.6 — Doc 04; skill `text-render`).
 *
 * Covers:
 *   - PURE resolveBlurRadius (px = radius*intensity, floored), blurFallbackOffsets
 *     (deterministic low-alpha ring samples, empty at radius 0);
 *   - PURE echoCopies: count = floor(count*intensity), offset stepped along `angle`
 *     (same axis-aligned geometry as extrudeSteps/longShadowSteps), FARTHEST-first,
 *     alpha DECAYING per copy by falloff (falloff^k), bounded 0..1, distance 0 / count 0
 *     / intensity 0 / falloff 0 → empty, deterministic;
 *   - the blur renderer: FILTER path sets blur(Npx) + re-stamps once, resets filter,
 *     no-op at radius/intensity 0, opacity, ctx restored, behind the face (dest-over);
 *   - the echo renderer: paints decaying copies behind the face (dest-over), restores
 *     ctx, no-op at count/distance/intensity 0, opacity scales, stacks in order;
 * all driven by a recording ctx (headless, no real canvas).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  blurFallbackOffsets,
  echoCopies,
  registerBuiltinEffects,
  resolveBlurRadius
} from './textEffectsBuiltin'
import {
  composeEffectsPass,
  hasEffectRenderer,
  unregisterEffectRenderer
} from './textEffectsPipeline'
import { extrudeSteps } from './textEffectsBuiltin'
import type { GlyphToken } from './textPaintPipeline'
import { defaultTextEffect, type TextEffect, type TextEffectType } from '../../../../shared/textEffect'

const TOKEN: GlyphToken = { text: 'Ab', x: 10, y: 20 }
const ALL_TYPES: TextEffectType[] = ['glow', 'neon', 'glitch', '3d', 'retro', 'blur', 'echo']

interface PaintOp {
  kind: 'fill' | 'stroke'
  text: string
  x: number
  y: number
  alpha: number
  filter: string
  composite: string
}

/** Recording ctx that snapshots fill position + alpha + filter + composite mode. */
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
    filter: 'none',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: ''
  }
  const snap = (kind: 'fill' | 'stroke', text: string, x: number, y: number): PaintOp => ({
    kind,
    text,
    x,
    y,
    alpha: s.globalAlpha,
    filter: s.filter,
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
    }
  }
  Object.defineProperties(ctx, {
    globalAlpha: { get: () => s.globalAlpha, set: (v) => (s.globalAlpha = v) },
    globalCompositeOperation: {
      get: () => s.globalCompositeOperation,
      set: (v) => (s.globalCompositeOperation = v)
    },
    filter: { get: () => s.filter, set: (v) => (s.filter = v) },
    fillStyle: { get: () => s.fillStyle, set: (v) => (s.fillStyle = v) },
    strokeStyle: { get: () => s.strokeStyle, set: (v) => (s.strokeStyle = v) },
    lineWidth: { get: () => s.lineWidth, set: (v) => (s.lineWidth = v) },
    font: { get: () => s.font, set: (v) => (s.font = v) },
    shadowColor: { get: () => 'transparent', set: () => {} },
    shadowBlur: { get: () => 0, set: () => {} },
    shadowOffsetX: { get: () => 0, set: () => {} },
    shadowOffsetY: { get: () => 0, set: () => {} }
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops, saveDepth: () => depth }
}

/** Render a single effect through the composed pass (mirrors the pipeline path). */
function render(ctx: CanvasRenderingContext2D, effect: TextEffect, token: GlyphToken = TOKEN): void {
  const pass = composeEffectsPass([effect])
  if (pass) pass(ctx, token, { shadow: null, stroke: null })
}

function blur(overrides: Partial<TextEffect> = {}): TextEffect {
  return { ...defaultTextEffect('blur'), ...overrides } as TextEffect
}
function echo(overrides: Partial<TextEffect> = {}): TextEffect {
  return { ...defaultTextEffect('echo'), ...overrides } as TextEffect
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
describe('resolveBlurRadius (PURE)', () => {
  it('= radius * intensity, floored at 0', () => {
    expect(resolveBlurRadius(4, 1)).toBe(4)
    expect(resolveBlurRadius(10, 0.5)).toBe(5)
    expect(resolveBlurRadius(4, 0)).toBe(0)
    expect(resolveBlurRadius(0, 1)).toBe(0)
    expect(resolveBlurRadius(-3, 1)).toBe(0)
    expect(resolveBlurRadius(Number.NaN, 1)).toBe(0)
  })
})

describe('blurFallbackOffsets (PURE)', () => {
  it('radius 0 → empty (no-op)', () => {
    expect(blurFallbackOffsets(0)).toHaveLength(0)
    expect(blurFallbackOffsets(-5)).toHaveLength(0)
    expect(blurFallbackOffsets(Number.NaN)).toHaveLength(0)
  })

  it('a positive radius produces a center sample + ring samples', () => {
    const samples = blurFallbackOffsets(6)
    expect(samples.length).toBeGreaterThan(1)
    // The center sample is at the origin.
    expect(samples[0]).toMatchObject({ x: 0, y: 0 })
    // Every sample is a LOW alpha (< 1) so the copies sum into a soft blob.
    expect(samples.every((s) => s.alpha > 0 && s.alpha < 1)).toBe(true)
  })

  it('ring samples sit within the radius', () => {
    const r = 8
    for (const s of blurFallbackOffsets(r)) {
      // Within the radius (allow tiny round3 dust on the outer ring).
      expect(Math.hypot(s.x, s.y)).toBeLessThanOrEqual(r + 0.01)
    }
  })

  it('deterministic: identical calls match (no random)', () => {
    expect(blurFallbackOffsets(7)).toEqual(blurFallbackOffsets(7))
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('echoCopies (PURE copy generator)', () => {
  it('count = count when intensity 1; each copy stepped along +x for angle 0', () => {
    const copies = echoCopies(3, 6, 0, 0.5, 1)
    expect(copies).toHaveLength(3)
    // Farthest-first: first is the farthest (k = 3 → 18px), last is nearest (k = 1 → 6px).
    expect(copies[0]).toMatchObject({ x: 18, y: 0 })
    expect(copies[copies.length - 1]).toMatchObject({ x: 6, y: 0 })
  })

  it('count scales with intensity: floor(count * intensity)', () => {
    expect(echoCopies(8, 4, 0, 0.5, 1)).toHaveLength(8)
    expect(echoCopies(8, 4, 0, 0.5, 0.5)).toHaveLength(4)
    expect(echoCopies(8, 4, 0, 0.5, 0.25)).toHaveLength(2)
    // floor: 8 * 0.3 = 2.4 → 2
    expect(echoCopies(8, 4, 0, 0.5, 0.3)).toHaveLength(2)
  })

  it('ordered FARTHEST-first (back-to-front)', () => {
    const copies = echoCopies(4, 5, 0, 0.6, 1)
    const xs = copies.map((c) => c.x)
    // Strictly DESCENDING offset along +x (farthest → nearest).
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeLessThan(xs[i - 1])
    expect(xs).toEqual([20, 15, 10, 5])
  })

  it('alpha DECAYS per copy by falloff (falloff^k); nearest brightest, farthest faintest', () => {
    const copies = echoCopies(3, 6, 0, 0.5, 1)
    // Painted farthest-first → alpha ASCENDS through the list (nearest is last, brightest).
    const alphas = copies.map((c) => c.alpha)
    // k = 3 → 0.5^3 = 0.125, k = 2 → 0.25, k = 1 → 0.5
    expect(alphas).toEqual([0.125, 0.25, 0.5])
    // Strictly increasing toward the front.
    for (let i = 1; i < alphas.length; i++) expect(alphas[i]).toBeGreaterThan(alphas[i - 1])
  })

  it('every alpha is bounded to 0..1', () => {
    for (const c of echoCopies(5, 3, 30, 0.9, 1)) {
      expect(c.alpha).toBeGreaterThanOrEqual(0)
      expect(c.alpha).toBeLessThanOrEqual(1)
    }
  })

  it('angle direction: 90 → +y (down), -90 → -y (up), 180 → -x (left)', () => {
    const down = echoCopies(3, 2, 90, 1, 1)
    expect(down.map((c) => [c.x, c.y])).toEqual([
      [0, 6],
      [0, 4],
      [0, 2]
    ])
    const up = echoCopies(2, 3, -90, 1, 1)
    expect(up.map((c) => [c.x, c.y])).toEqual([
      [0, -6],
      [0, -3]
    ])
    const left = echoCopies(2, 4, 180, 1, 1)
    expect(left.map((c) => [c.x, c.y])).toEqual([
      [-8, 0],
      [-4, 0]
    ])
  })

  it('angle 45 → equal x/y down-right components', () => {
    const copies = echoCopies(2, 10, 45, 1, 1)
    for (const c of copies) expect(c.x).toBeCloseTo(c.y, 6)
  })

  it('mirrors the extrude/long-shadow axis-aligned geometry (same offset directions)', () => {
    // Same unit-direction math as the 3D wall for a 3-step trail at angle 0, distance 1.
    const ec = echoCopies(3, 1, 0, 1, 1).map((c) => [c.x, c.y])
    const ex = extrudeSteps(0, 3, 1).map((s) => [s.x, s.y])
    expect(ec).toEqual(ex)
  })

  it('distance 0 → empty (no echo)', () => {
    expect(echoCopies(3, 0, 0, 0.5, 1)).toHaveLength(0)
  })

  it('count 0 → empty', () => {
    expect(echoCopies(0, 6, 0, 0.5, 1)).toHaveLength(0)
  })

  it('intensity 0 → empty', () => {
    expect(echoCopies(8, 6, 0, 0.5, 0)).toHaveLength(0)
  })

  it('falloff 0 → empty (every copy invisible)', () => {
    expect(echoCopies(3, 6, 0, 0, 1)).toHaveLength(0)
  })

  it('non-finite / negative inputs → empty', () => {
    expect(echoCopies(Number.NaN, 6, 0, 0.5, 1)).toHaveLength(0)
    expect(echoCopies(3, -6, 0, 0.5, 1)).toHaveLength(0)
  })

  it('deterministic (no random): identical calls match', () => {
    expect(echoCopies(4, 7, 33, 0.7, 0.8)).toEqual(echoCopies(4, 7, 33, 0.7, 0.8))
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('blur renderer', () => {
  it('registers through registerBuiltinEffects', () => {
    expect(hasEffectRenderer('blur')).toBe(true)
  })

  it('FILTER path: one re-stamp under blur(Npx), N = radius*intensity', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, blur({ params: { radius: 10 }, intensity: 0.5 }))
    expect(ops).toHaveLength(1)
    expect(ops[0].text).toBe('Ab')
    expect(ops[0].filter).toBe('blur(5px)')
  })

  it('paints the blurred copy BEHIND the face (destination-over)', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, blur({ params: { radius: 4 } }))
    expect(ops.every((o) => o.composite === 'destination-over')).toBe(true)
    expect((ctx as unknown as { globalCompositeOperation: string }).globalCompositeOperation).toBe(
      'source-over'
    )
  })

  it('resets ctx.filter to none after (no leak)', () => {
    const { ctx } = recordingCtx()
    render(ctx, blur({ params: { radius: 4 } }))
    expect((ctx as unknown as { filter: string }).filter).toBe('none')
  })

  it('opacity rides globalAlpha into the blurred stamp', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, blur({ opacity: 0.4, params: { radius: 6 } }))
    expect(ops[0].alpha).toBeCloseTo(0.4)
  })

  it('intensity 0 → no-op', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, blur({ intensity: 0 }))
    expect(ops).toHaveLength(0)
  })

  it('radius 0 → no-op', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, blur({ params: { radius: 0 } }))
    expect(ops).toHaveLength(0)
  })

  it('disabled → composed pass is undefined', () => {
    expect(composeEffectsPass([blur({ enabled: false })])).toBeUndefined()
  })

  it('restores ctx after — alpha + composite back to entry, depth balanced', () => {
    const { ctx, ops, saveDepth } = recordingCtx()
    render(ctx, blur({ params: { radius: 5 } }))
    expect(ops.length).toBeGreaterThan(0)
    expect(saveDepth()).toBe(0)
    expect(ctx.globalAlpha).toBe(1)
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('echo renderer', () => {
  it('registers through registerBuiltinEffects', () => {
    expect(hasEffectRenderer('echo')).toBe(true)
  })

  it('stamps `count` copies, stepped along angle, back-to-front (farthest-first)', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, echo({ params: { count: 3, distance: 6, angle: 0, falloff: 0.5 }, intensity: 1 }))
    expect(ops).toHaveLength(3)
    const xs = ops.map((o) => o.x)
    expect(xs).toEqual([TOKEN.x + 18, TOKEN.x + 12, TOKEN.x + 6])
    expect(ops.every((o) => o.y === TOKEN.y)).toBe(true)
  })

  it('paints the copies BEHIND the face (destination-over)', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, echo({ params: { count: 3, distance: 5, angle: 45, falloff: 0.6 } }))
    expect(ops.length).toBeGreaterThan(0)
    expect(ops.every((o) => o.composite === 'destination-over')).toBe(true)
    expect((ctx as unknown as { globalCompositeOperation: string }).globalCompositeOperation).toBe(
      'source-over'
    )
  })

  it('alpha decays per copy (farthest faintest, nearest brightest)', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, echo({ params: { count: 3, distance: 6, angle: 0, falloff: 0.5 }, intensity: 1 }))
    // farthest-first: alpha ascends — 0.125, 0.25, 0.5.
    expect(ops[0].alpha).toBeCloseTo(0.125)
    expect(ops[ops.length - 1].alpha).toBeCloseTo(0.5)
    for (let i = 1; i < ops.length; i++) expect(ops[i].alpha).toBeGreaterThan(ops[i - 1].alpha)
  })

  it('opacity scales each copy alpha (folded with the decay)', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, echo({ opacity: 0.5, params: { count: 2, distance: 6, angle: 0, falloff: 0.5 }, intensity: 1 }))
    // nearest copy alpha 0.5 (falloff^1) * opacity 0.5 = 0.25.
    expect(ops[ops.length - 1].alpha).toBeCloseTo(0.25)
  })

  it('intensity scales the number of copies', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, echo({ params: { count: 8, distance: 4, angle: 0, falloff: 0.7 }, intensity: 0.5 }))
    expect(ops).toHaveLength(4)
  })

  it('intensity 0 → no-op', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, echo({ intensity: 0 }))
    expect(ops).toHaveLength(0)
  })

  it('distance 0 → no-op', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, echo({ params: { count: 3, distance: 0, angle: 0, falloff: 0.5 } }))
    expect(ops).toHaveLength(0)
  })

  it('count 0-effective (count*intensity floors to 0) → no-op', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, echo({ params: { count: 1, distance: 6, angle: 0, falloff: 0.5 }, intensity: 0.4 }))
    expect(ops).toHaveLength(0)
  })

  it('disabled → composed pass is undefined', () => {
    expect(composeEffectsPass([echo({ enabled: false })])).toBeUndefined()
  })

  it('restores ctx after — alpha + composite back to entry, depth balanced', () => {
    const { ctx, ops, saveDepth } = recordingCtx()
    render(ctx, echo({ params: { count: 4, distance: 5, angle: 30, falloff: 0.6 } }))
    expect(ops.length).toBeGreaterThan(0)
    expect(saveDepth()).toBe(0)
    expect(ctx.globalAlpha).toBe(1)
    expect((ctx as unknown as { globalCompositeOperation: string }).globalCompositeOperation).toBe(
      'source-over'
    )
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('stacking blur + echo preserves ORDER and isolation', () => {
  it('echo then blur: echo ops first, blur ops second; ctx clean after', () => {
    const { ctx, ops } = recordingCtx()
    const pass = composeEffectsPass([
      echo({ params: { count: 2, distance: 6, angle: 0, falloff: 0.5 } }),
      blur({ params: { radius: 4 } })
    ])!
    pass(ctx, TOKEN, { shadow: null, stroke: null })
    // The echo copies have no filter; the blur stamp carries blur(4px). The first
    // filtered op comes AFTER the last non-filtered echo op.
    const lastEcho = ops.map((o) => o.filter).lastIndexOf('none')
    const firstBlur = ops.findIndex((o) => o.filter === 'blur(4px)')
    expect(firstBlur).toBeGreaterThan(lastEcho)
    expect((ctx as unknown as { globalCompositeOperation: string }).globalCompositeOperation).toBe(
      'source-over'
    )
    expect((ctx as unknown as { filter: string }).filter).toBe('none')
    expect(ctx.globalAlpha).toBe(1)
  })

  it('deterministic: stacking the same effects twice yields the same op stream', () => {
    const build = (): PaintOp[] => {
      const { ctx, ops } = recordingCtx()
      composeEffectsPass([
        blur({ params: { radius: 5 } }),
        echo({ params: { count: 3, distance: 4, angle: 20, falloff: 0.6 } })
      ])!(ctx, TOKEN, { shadow: null, stroke: null })
      return ops
    }
    expect(build()).toEqual(build())
  })
})

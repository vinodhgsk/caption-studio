/**
 * Tests for the built-in 3D DEPTH effect renderer (P7.4 — Doc 04; skill `text-render`).
 *
 * Covers:
 *   - the PURE step generator extrudeSteps: count = floor(depth*intensity), per-step
 *     offset stepped along `angle` (the same axis-aligned geometry as longShadowSteps),
 *     FARTHEST-first (back-to-front) order, shade rising with depth (front lighter),
 *     depth 0 / intensity 0 / non-finite → empty (no wall), angle direction
 *     (0/90/180/-90/45) correct;
 *   - shadeColor: darkens the side color by the shade factor, folds in alpha;
 *   - the renderer: paints the wall BEHIND the face (destination-over), restores ctx,
 *     intensity 0 / disabled / depth 0 no-op, opacity honored, stacks in order with
 *     other effects preserving order;
 * all driven by a recording ctx (headless, no real canvas).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  EXTRUDE_STEP_PX,
  extrudeSteps,
  registerBuiltinEffects,
  shadeColor
} from './textEffectsBuiltin'
import {
  composeEffectsPass,
  hasEffectRenderer,
  unregisterEffectRenderer
} from './textEffectsPipeline'
import { longShadowSteps } from './textShadowSpec'
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
  fillStyle: string
  composite: string
}

/** Recording ctx that snapshots fill position + composite mode + alpha + style. */
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
  const snap = (kind: 'fill' | 'stroke', text: string, x: number, y: number): PaintOp => ({
    kind,
    text,
    x,
    y,
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

function threeD(overrides: Partial<TextEffect> = {}): TextEffect {
  return { ...defaultTextEffect('3d'), ...overrides } as TextEffect
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
describe('extrudeSteps (PURE step generator)', () => {
  it('count = depth when intensity 1; each step offset along +x for angle 0', () => {
    const steps = extrudeSteps(0, 5, 1)
    expect(steps).toHaveLength(5)
    // Farthest-first: first entry is the farthest (k = count = 5).
    expect(steps[0]).toMatchObject({ x: 5 * EXTRUDE_STEP_PX, y: 0 })
    expect(steps[steps.length - 1]).toMatchObject({ x: 1 * EXTRUDE_STEP_PX, y: 0 })
  })

  it('count scales with intensity: floor(depth * intensity)', () => {
    expect(extrudeSteps(0, 8, 1)).toHaveLength(8)
    expect(extrudeSteps(0, 8, 0.5)).toHaveLength(4)
    expect(extrudeSteps(0, 8, 0.25)).toHaveLength(2)
    // floor: 8 * 0.3 = 2.4 → 2
    expect(extrudeSteps(0, 8, 0.3)).toHaveLength(2)
  })

  it('ordered FARTHEST-first (back-to-front) so the caller paints back-to-front', () => {
    const steps = extrudeSteps(0, 4, 1)
    const xs = steps.map((s) => s.x)
    // Strictly DESCENDING offset along +x (farthest → nearest).
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeLessThan(xs[i - 1])
    expect(xs).toEqual([4, 3, 2, 1])
  })

  it('shade RISES with depth (back darkest, front fullest); nearest = 1', () => {
    const steps = extrudeSteps(0, 4, 1)
    const shades = steps.map((s) => s.shade)
    // Painted farthest-first so shade ASCENDS through the list; last (nearest) = 1.
    expect(shades).toEqual([0.25, 0.5, 0.75, 1])
    expect(shades[shades.length - 1]).toBe(1)
  })

  it('single-step wall gets shade 1', () => {
    const steps = extrudeSteps(0, 1, 1)
    expect(steps).toHaveLength(1)
    expect(steps[0].shade).toBe(1)
  })

  it('depth 0 → empty (no wall)', () => {
    expect(extrudeSteps(0, 0, 1)).toHaveLength(0)
  })

  it('intensity 0 → empty (no wall)', () => {
    expect(extrudeSteps(0, 8, 0)).toHaveLength(0)
  })

  it('non-finite / negative depth → empty', () => {
    expect(extrudeSteps(0, Number.NaN, 1)).toHaveLength(0)
    expect(extrudeSteps(0, -5, 1)).toHaveLength(0)
  })

  it('angle direction: 90 → +y (down), -90 → -y (up), 180 → -x (left)', () => {
    const down = extrudeSteps(90, 3, 1)
    expect(down.map((s) => [s.x, s.y])).toEqual([
      [0, 3],
      [0, 2],
      [0, 1]
    ])
    const up = extrudeSteps(-90, 2, 1)
    expect(up.map((s) => [s.x, s.y])).toEqual([
      [0, -2],
      [0, -1]
    ])
    const left = extrudeSteps(180, 2, 1)
    expect(left.map((s) => [s.x, s.y])).toEqual([
      [-2, 0],
      [-1, 0]
    ])
  })

  it('angle 45 → equal x/y down-right components', () => {
    const steps = extrudeSteps(45, 2, 1)
    const c = Math.SQRT1_2 // cos45 = sin45
    expect(steps[steps.length - 1].x).toBeCloseTo(c, 2)
    expect(steps[steps.length - 1].y).toBeCloseTo(c, 2)
    // x and y equal (down-right diagonal).
    for (const s of steps) expect(s.x).toBeCloseTo(s.y, 6)
  })

  it('mirrors longShadowSteps geometry (same axis-aligned offset directions)', () => {
    // Same unit-direction math: a 3-step extrude at angle 0 lands on the same x/y
    // offsets as a long-shadow trail of length 3, step 1 (both farthest-first).
    const ex = extrudeSteps(0, 3, 1).map((s) => [s.x, s.y])
    const ls = longShadowSteps(0, 3, EXTRUDE_STEP_PX).map((s) => [s.x, s.y])
    expect(ex).toEqual(ls)
  })

  it('deterministic (no random): identical calls match', () => {
    expect(extrudeSteps(33, 7, 0.8)).toEqual(extrudeSteps(33, 7, 0.8))
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('shadeColor (PURE)', () => {
  it('shade 1 → side color unchanged at alpha', () => {
    expect(shadeColor('#ffffff', 1, 1)).toBe('rgba(255, 255, 255, 1)')
    expect(shadeColor('#3366cc', 1, 1)).toBe('rgba(51, 102, 204, 1)')
  })

  it('shade DARKENS the rgb toward black', () => {
    expect(shadeColor('#ffffff', 0.5, 1)).toBe('rgba(128, 128, 128, 1)')
    expect(shadeColor('#ffffff', 0, 1)).toBe('rgba(0, 0, 0, 1)')
  })

  it('folds the alpha in', () => {
    expect(shadeColor('#ffffff', 1, 0.4)).toBe('rgba(255, 255, 255, 0.4)')
  })

  it('darker shade for farther steps (depth shading)', () => {
    // back of the wall (low shade) is darker than the front (high shade).
    const back = shadeColor('#00ff00', 0.25, 1)
    const front = shadeColor('#00ff00', 1, 1)
    expect(back).toBe('rgba(0, 64, 0, 1)')
    expect(front).toBe('rgba(0, 255, 0, 1)')
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('3d renderer', () => {
  it('registers through registerBuiltinEffects', () => {
    expect(hasEffectRenderer('3d')).toBe(true)
  })

  it('stamps depth copies of the wall, stepped along angle, back-to-front', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, threeD({ params: { depth: 4, angle: 0, color: '#000000' }, intensity: 1 }))
    expect(ops).toHaveLength(4)
    // Each stamp offset along +x by its step distance; farthest-first (descending x).
    const xs = ops.map((o) => o.x)
    expect(xs).toEqual([TOKEN.x + 4, TOKEN.x + 3, TOKEN.x + 2, TOKEN.x + 1])
    expect(ops.every((o) => o.y === TOKEN.y)).toBe(true)
  })

  it('paints the wall BEHIND the face (destination-over composite)', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, threeD({ params: { depth: 3, angle: 45, color: '#222222' } }))
    expect(ops.length).toBeGreaterThan(0)
    expect(ops.every((o) => o.composite === 'destination-over')).toBe(true)
    // After the renderer the composite is reset (no leak).
    expect((ctx as unknown as { globalCompositeOperation: string }).globalCompositeOperation).toBe(
      'source-over'
    )
  })

  it('darkens farther copies (shade rises front-ward)', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, threeD({ params: { depth: 4, angle: 0, color: '#ffffff' }, intensity: 1 }))
    // farthest-first: first stamp is darkest (shade 0.25), last is full white.
    expect(ops[0].fillStyle).toBe('rgba(64, 64, 64, 1)')
    expect(ops[ops.length - 1].fillStyle).toBe('rgba(255, 255, 255, 1)')
  })

  it('opacity rides globalAlpha into each side color', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, threeD({ opacity: 0.5, params: { depth: 2, angle: 0, color: '#ffffff' }, intensity: 1 }))
    // nearest step shade 1 → full white at the folded-in alpha.
    expect(ops[ops.length - 1].fillStyle).toBe('rgba(255, 255, 255, 0.5)')
    expect(ops[ops.length - 1].alpha).toBeCloseTo(0.5)
  })

  it('intensity scales the number of copies', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, threeD({ params: { depth: 8, angle: 0, color: '#000000' }, intensity: 0.5 }))
    expect(ops).toHaveLength(4)
  })

  it('intensity 0 → no-op', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, threeD({ intensity: 0 }))
    expect(ops).toHaveLength(0)
  })

  it('depth 0 → no-op', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, threeD({ params: { depth: 0, angle: 0, color: '#000000' } }))
    expect(ops).toHaveLength(0)
  })

  it('disabled → composed pass is undefined', () => {
    expect(composeEffectsPass([threeD({ enabled: false })])).toBeUndefined()
  })

  it('restores ctx after — composite + alpha back to entry values, depth balanced', () => {
    const { ctx, ops, saveDepth } = recordingCtx()
    render(ctx, threeD({ params: { depth: 4, angle: 30, color: '#112233' } }))
    expect(ops.length).toBeGreaterThan(0)
    expect(saveDepth()).toBe(0)
    expect(ctx.globalAlpha).toBe(1)
    expect((ctx as unknown as { globalCompositeOperation: string }).globalCompositeOperation).toBe(
      'source-over'
    )
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('stacking preserves ORDER and isolation', () => {
  it('3d then glow: 3d wall ops first (destination-over), glow ops after, no leak', () => {
    const { ctx, ops } = recordingCtx()
    const pass = composeEffectsPass([
      threeD({ params: { depth: 3, angle: 0, color: '#000000' } }),
      { ...defaultTextEffect('glow'), params: { radius: 10, color: '#ffffff' } }
    ])!
    pass(ctx, TOKEN, { shadow: null, stroke: null })
    const lastDestOver = ops.map((o) => o.composite).lastIndexOf('destination-over')
    const firstSourceOver = ops.findIndex((o) => o.composite === 'source-over')
    expect(lastDestOver).toBeGreaterThanOrEqual(0)
    expect(firstSourceOver).toBeGreaterThan(lastDestOver)
  })

  it('after a 3d+glow stack the ctx state is clean', () => {
    const { ctx } = recordingCtx()
    const pass = composeEffectsPass([threeD(), defaultTextEffect('glow')])!
    pass(ctx, TOKEN, { shadow: null, stroke: null })
    expect(ctx.globalAlpha).toBe(1)
    expect((ctx as unknown as { globalCompositeOperation: string }).globalCompositeOperation).toBe(
      'source-over'
    )
  })
})

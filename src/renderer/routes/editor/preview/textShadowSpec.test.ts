import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEXT_SHADOW,
  LONG_SHADOW_DISTANCE_FACTOR,
  LONG_SHADOW_STEP_PX,
  applyDropShadow,
  clearShadow,
  hasShadow,
  longShadowLength,
  longShadowSteps,
  resolveTextShadow,
  shadowOffset,
  type ResolvedTextShadow
} from './textShadowSpec'

/** A minimal `ctx` stub capturing only the `shadow*` props applyDropShadow sets. */
function shadowCtxStub(): {
  shadowColor: string
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
} {
  return { shadowColor: '', shadowBlur: -1, shadowOffsetX: -1, shadowOffsetY: -1 }
}

const close = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps

describe('shadowOffset — PURE angle(±180°) + distance → canvas offset', () => {
  it('REQUIREMENT: 0° → shadow to the RIGHT (+x, 0)', () => {
    const o = shadowOffset(0, 10)
    expect(close(o.x, 10)).toBe(true)
    expect(close(o.y, 0)).toBe(true)
  })

  it('REQUIREMENT: 90° → shadow DOWN (0, +y) [canvas y grows down]', () => {
    const o = shadowOffset(90, 10)
    expect(close(o.x, 0)).toBe(true)
    expect(close(o.y, 10)).toBe(true)
  })

  it('REQUIREMENT: -90° → shadow UP (0, -y)', () => {
    const o = shadowOffset(-90, 10)
    expect(close(o.x, 0)).toBe(true)
    expect(close(o.y, -10)).toBe(true)
  })

  it('REQUIREMENT: 180° → shadow LEFT (-x, 0), exact (snapped, no float dust)', () => {
    const o = shadowOffset(180, 10)
    expect(o.x).toBe(-10)
    expect(o.y).toBe(0)
  })

  it('-180° → shadow LEFT (same as 180°)', () => {
    const o = shadowOffset(-180, 10)
    expect(o.x).toBe(-10)
    expect(o.y).toBe(0)
  })

  it('REQUIREMENT: 45° → DOWN-RIGHT (+x, +y), equal magnitudes', () => {
    const o = shadowOffset(45, Math.SQRT2)
    expect(close(o.x, 1)).toBe(true)
    expect(close(o.y, 1)).toBe(true)
  })

  it('REQUIREMENT: -135° → UP-LEFT (-x, -y), equal magnitudes', () => {
    const o = shadowOffset(-135, Math.SQRT2)
    expect(close(o.x, -1)).toBe(true)
    expect(close(o.y, -1)).toBe(true)
  })

  it('REQUIREMENT: distance 0 → no offset (0, 0)', () => {
    expect(shadowOffset(45, 0)).toEqual({ x: 0, y: 0 })
    expect(shadowOffset(123, -5)).toEqual({ x: 0, y: 0 })
  })

  it('REQUIREMENT: offsets are correct across the FULL ±180° range', () => {
    // Sweep every 15° and assert offsetX=d·cos, offsetY=d·sin.
    const d = 7
    for (let a = -180; a <= 180; a += 15) {
      const o = shadowOffset(a, d)
      const rad = (a * Math.PI) / 180
      expect(close(o.x, d * Math.cos(rad))).toBe(true)
      expect(close(o.y, d * Math.sin(rad))).toBe(true)
    }
  })

  it('all four quadrants have the expected sign pattern', () => {
    expect(Math.sign(shadowOffset(30, 5).x)).toBe(1) // Q: right-down
    expect(Math.sign(shadowOffset(30, 5).y)).toBe(1)
    expect(Math.sign(shadowOffset(150, 5).x)).toBe(-1) // left-down
    expect(Math.sign(shadowOffset(150, 5).y)).toBe(1)
    expect(Math.sign(shadowOffset(-150, 5).x)).toBe(-1) // left-up
    expect(Math.sign(shadowOffset(-150, 5).y)).toBe(-1)
    expect(Math.sign(shadowOffset(-30, 5).x)).toBe(1) // right-up
    expect(Math.sign(shadowOffset(-30, 5).y)).toBe(-1)
  })

  it('a non-finite angle defaults to 0° (offset along +x)', () => {
    const o = shadowOffset(Number.NaN, 4)
    expect(close(o.x, 4)).toBe(true)
    expect(close(o.y, 0)).toBe(true)
  })
})

describe('resolveTextShadow — clip.text.shadow bag → resolved drop shadow', () => {
  it('REQUIREMENT: color is baked at the opacity (hex + opacity → rgba)', () => {
    const r = resolveTextShadow({ color: '#ff0000', opacity: 0.5, blur: 0, angle: 0, distance: 3 })
    expect(r).not.toBeNull()
    expect((r as ResolvedTextShadow).color).toBe('rgba(255, 0, 0, 0.5)')
  })

  it('REQUIREMENT: blur passes through verbatim', () => {
    const r = resolveTextShadow({ color: '#000000', opacity: 1, blur: 12, angle: 0, distance: 3 })
    expect((r as ResolvedTextShadow).blur).toBe(12)
  })

  it('REQUIREMENT: angle+distance resolve to the canvas offset (45° / 10px)', () => {
    const r = resolveTextShadow({ color: '#000000', opacity: 1, blur: 0, angle: 90, distance: 10 })
    const o = (r as ResolvedTextShadow).offset
    expect(close(o.x, 0)).toBe(true)
    expect(close(o.y, 10)).toBe(true)
    expect((r as ResolvedTextShadow).angleDeg).toBe(90)
    expect((r as ResolvedTextShadow).distance).toBe(10)
  })

  it('REQUIREMENT: distance 0 → null (no shadow / the off state)', () => {
    expect(resolveTextShadow({ color: '#000000', opacity: 1, blur: 4, angle: 45, distance: 0 })).toBeNull()
    expect(resolveTextShadow({ color: '#000000', opacity: 1, blur: 4, angle: 45, distance: -3 })).toBeNull()
  })

  it('REQUIREMENT: a missing / absent shadow resolves to null (legacy clip)', () => {
    expect(resolveTextShadow(undefined)).toBeNull()
    expect(resolveTextShadow(null)).toBeNull()
    expect(resolveTextShadow('nope')).toBeNull()
    expect(resolveTextShadow({})).toBeNull() // no distance → null
  })

  it('REQUIREMENT: a legacy shadow missing opacity uses the default opacity', () => {
    const r = resolveTextShadow({ color: '#000000', angle: 0, distance: 4 })
    // default opacity 0.6 baked into the color.
    expect((r as ResolvedTextShadow).color).toBe(`rgba(0, 0, 0, ${DEFAULT_TEXT_SHADOW.opacity})`)
  })

  it('an invalid / missing color falls back to the default hex', () => {
    const r = resolveTextShadow({ color: 'not-a-color', opacity: 1, angle: 0, distance: 4 })
    expect((r as ResolvedTextShadow).color).toBe('rgba(0, 0, 0, 1)') // default black
    const r2 = resolveTextShadow({ opacity: 1, angle: 0, distance: 4 })
    expect((r2 as ResolvedTextShadow).color).toBe('rgba(0, 0, 0, 1)')
  })

  it('a missing / non-positive blur resolves to 0 (crisp offset shadow)', () => {
    expect((resolveTextShadow({ angle: 0, distance: 2 }) as ResolvedTextShadow).blur).toBe(0)
    expect((resolveTextShadow({ blur: -5, angle: 0, distance: 2 }) as ResolvedTextShadow).blur).toBe(0)
  })

  it('REQUIREMENT: the resolved spec carries the canvas shadow params (kind=drop)', () => {
    const r = resolveTextShadow({ color: '#112233', opacity: 0.8, blur: 6, angle: 0, distance: 5 })
    expect(r).toMatchObject({
      kind: 'drop',
      color: 'rgba(17, 34, 51, 0.8)',
      blur: 6
    })
    expect((r as ResolvedTextShadow).offset).toBeDefined()
  })

  it('REQUIREMENT (P6.14): inner flag → kind "inner"', () => {
    const r = resolveTextShadow({ color: '#000000', opacity: 0.6, blur: 4, angle: 45, distance: 4, inner: true })
    expect((r as ResolvedTextShadow).kind).toBe('inner')
    // geometry is still resolved (offset reused by the inner pass)
    expect((r as ResolvedTextShadow).offset).toBeDefined()
  })

  it('REQUIREMENT (P6.14): long flag → kind "long"', () => {
    const r = resolveTextShadow({ color: '#000000', opacity: 0.6, blur: 4, angle: 45, distance: 4, long: true })
    expect((r as ResolvedTextShadow).kind).toBe('long')
    expect((r as ResolvedTextShadow).angleDeg).toBe(45)
    expect((r as ResolvedTextShadow).distance).toBe(4)
  })

  it('REQUIREMENT (P6.14): neither flag → kind "drop" (backward compatible)', () => {
    const r = resolveTextShadow({ color: '#000000', opacity: 0.6, blur: 4, angle: 45, distance: 4 })
    expect((r as ResolvedTextShadow).kind).toBe('drop')
    const r2 = resolveTextShadow({ color: '#000000', opacity: 0.6, angle: 45, distance: 4, inner: false, long: false })
    expect((r2 as ResolvedTextShadow).kind).toBe('drop')
  })

  it('long WINS over inner when (illegally) both flags are set', () => {
    const r = resolveTextShadow({ color: '#000000', opacity: 0.6, angle: 45, distance: 4, inner: true, long: true })
    expect((r as ResolvedTextShadow).kind).toBe('long')
  })

  it('REQUIREMENT (P6.14): a type switch round-trips through the flags', () => {
    // drop → inner → long → drop, each via the flag combo the panel writes.
    const drop = resolveTextShadow({ angle: 0, distance: 5, inner: false, long: false })
    expect((drop as ResolvedTextShadow).kind).toBe('drop')
    const inner = resolveTextShadow({ angle: 0, distance: 5, inner: true, long: false })
    expect((inner as ResolvedTextShadow).kind).toBe('inner')
    const long = resolveTextShadow({ angle: 0, distance: 5, inner: false, long: true })
    expect((long as ResolvedTextShadow).kind).toBe('long')
    const backToDrop = resolveTextShadow({ angle: 0, distance: 5, inner: false, long: false })
    expect((backToDrop as ResolvedTextShadow).kind).toBe('drop')
  })

  it('the angle is honored across the full ±180° range in the resolved offset', () => {
    for (const angle of [-180, -135, -90, -45, 0, 45, 90, 135, 180]) {
      const r = resolveTextShadow({ color: '#000000', opacity: 1, blur: 0, angle, distance: 10 })
      const o = (r as ResolvedTextShadow).offset
      const rad = (angle * Math.PI) / 180
      expect(close(o.x, 10 * Math.cos(rad))).toBe(true)
      expect(close(o.y, 10 * Math.sin(rad))).toBe(true)
    }
  })
})

describe('hasShadow — presence guard', () => {
  it('narrows a non-null resolved shadow to present', () => {
    expect(hasShadow(null)).toBe(false)
    expect(hasShadow(resolveTextShadow({ angle: 0, distance: 3 }))).toBe(true)
  })
})

describe('applyDropShadow / clearShadow — the single canvas apply point', () => {
  it('applyDropShadow sets all four ctx.shadow* from a resolved spec', () => {
    const ctx = shadowCtxStub()
    const r = resolveTextShadow({ color: '#ff0000', opacity: 0.5, blur: 8, angle: 90, distance: 10 })
    applyDropShadow(ctx as unknown as CanvasRenderingContext2D, r as ResolvedTextShadow)
    expect(ctx.shadowColor).toBe('rgba(255, 0, 0, 0.5)')
    expect(ctx.shadowBlur).toBe(8)
    expect(close(ctx.shadowOffsetX, 0)).toBe(true)
    expect(close(ctx.shadowOffsetY, 10)).toBe(true)
  })

  it('clearShadow zeroes the shadow so subsequent ops cast none (no doubling)', () => {
    const ctx = shadowCtxStub()
    const r = resolveTextShadow({ color: '#000000', opacity: 1, blur: 5, angle: 0, distance: 4 })
    applyDropShadow(ctx as unknown as CanvasRenderingContext2D, r as ResolvedTextShadow)
    clearShadow(ctx as unknown as CanvasRenderingContext2D)
    expect(ctx.shadowColor).toBe('transparent')
    expect(ctx.shadowBlur).toBe(0)
    expect(ctx.shadowOffsetX).toBe(0)
    expect(ctx.shadowOffsetY).toBe(0)
  })
})

describe('longShadowSteps — PURE long-shadow trail geometry (P6.14)', () => {
  it('REQUIREMENT: count = floor(length / stepPx) for an exact division', () => {
    // length 10, step 2 → 5 steps at 2,4,6,8,10.
    const steps = longShadowSteps(0, 10, 2)
    expect(steps).toHaveLength(5)
  })

  it('REQUIREMENT: count = floor(length / stepPx) for a non-exact division', () => {
    // length 11, step 2 → floor(5.5) = 5 steps (never overshoots length).
    const steps = longShadowSteps(0, 11, 2)
    expect(steps).toHaveLength(5)
    // farthest step lands at 5·2 = 10 (<= length), not past 11.
    expect(close(steps[0].x, 10)).toBe(true)
  })

  it('REQUIREMENT: 0° trail extends to the RIGHT (+x), farthest-first', () => {
    const steps = longShadowSteps(0, 6, 2) // 3 steps: 6,4,2
    expect(steps.map((s) => Math.round(s.x))).toEqual([6, 4, 2])
    expect(steps.every((s) => close(s.y, 0))).toBe(true)
  })

  it('REQUIREMENT: 45° trail is DOWN-RIGHT with equal x/y per step', () => {
    const steps = longShadowSteps(45, 3 * Math.SQRT2, Math.SQRT2) // 3 steps
    expect(steps).toHaveLength(3)
    for (const s of steps) expect(close(s.x, s.y)).toBe(true)
    // farthest step = 3·SQRT2 along 45° → (3,3).
    expect(close(steps[0].x, 3)).toBe(true)
    expect(close(steps[0].y, 3)).toBe(true)
  })

  it('REQUIREMENT: 180° / -180° trail extends LEFT (-x, 0), snapped clean', () => {
    const a = longShadowSteps(180, 6, 2)
    const b = longShadowSteps(-180, 6, 2)
    expect(a.map((s) => s.x)).toEqual([-6, -4, -2])
    expect(a.every((s) => s.y === 0)).toBe(true)
    expect(b.map((s) => s.x)).toEqual([-6, -4, -2])
    expect(b.every((s) => s.y === 0)).toBe(true)
  })

  it('REQUIREMENT: steps are ordered FARTHEST-first (paint back-to-front)', () => {
    const steps = longShadowSteps(0, 8, 2)
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i - 1].x).toBeGreaterThan(steps[i].x)
    }
  })

  it('-90° trail extends UP (0, -y)', () => {
    const steps = longShadowSteps(-90, 6, 2)
    expect(steps.map((s) => Math.round(s.y))).toEqual([-6, -4, -2])
    expect(steps.every((s) => close(s.x, 0))).toBe(true)
  })

  it('REQUIREMENT: degenerate inputs → empty trail (no steps)', () => {
    expect(longShadowSteps(45, 0, 2)).toEqual([]) // length 0
    expect(longShadowSteps(45, -5, 2)).toEqual([]) // negative length
    expect(longShadowSteps(45, 10, 0)).toEqual([]) // step 0
    expect(longShadowSteps(45, 10, -2)).toEqual([]) // negative step
    expect(longShadowSteps(Number.NaN, 10, 2).length).toBeGreaterThan(0) // angle defaults to 0
    expect(longShadowSteps(0, Number.NaN, 2)).toEqual([]) // non-finite length
  })

  it('a step >= length (with length > 0) yields a single step at length', () => {
    const steps = longShadowSteps(0, 4, 10)
    expect(steps).toHaveLength(1)
    expect(close(steps[0].x, 4)).toBe(true) // capped at length, never overshoots
  })

  it('the default step/length factor are exported + consistent', () => {
    expect(LONG_SHADOW_STEP_PX).toBeGreaterThan(0)
    expect(longShadowLength(4)).toBe(4 * LONG_SHADOW_DISTANCE_FACTOR)
    expect(longShadowLength(0)).toBe(0)
    expect(longShadowLength(-3)).toBe(0)
  })
})

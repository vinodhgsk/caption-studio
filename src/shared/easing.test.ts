/**
 * P8.1 — shared EASING library (keyframe-engine `ease(name,p)` registry).
 *
 * Asserts the curve contract every animation feature relies on:
 *   - ramp curves hit f(0)=0, f(1)=1, are monotonic non-decreasing, with known
 *     midpoints (linear 0.5, easeIn < 0.5, easeOut > 0.5, easeInOut = 0.5);
 *   - cubic-bezier endpoints + the `ease` named curve;
 *   - settling curves (bounce, elastic) hit f(0)=0, f(1)=1 but overshoot/oscillate
 *     in between (NOT monotonic);
 *   - input clamping (p<0 → 0, p>1 → 1) and determinism (pure).
 */
import { describe, expect, it } from 'vitest'
import {
  EASING_NAMES,
  clamp01,
  cubicBezier,
  ease,
  easeInCubic,
  easeInOutCubic,
  easeOutCubic,
  lerp,
  smoothstep,
  type EasingName
} from './easing'

const RAMPS: EasingName[] = [
  'linear',
  'ease',
  'easeIn',
  'easeOut',
  'easeInOut',
  'easeInQuad',
  'easeOutQuad',
  'easeInOutQuad',
  'easeInCubic',
  'easeOutCubic',
  'easeInOutCubic',
  'spring'
]

describe('ease — ramp curves endpoints', () => {
  it('every ramp curve has f(0)=0 and f(1)=1', () => {
    for (const name of RAMPS) {
      expect(ease(name, 0)).toBeCloseTo(0, 6)
      expect(ease(name, 1)).toBeCloseTo(1, 6)
    }
  })

  it('ramp curves are monotonic non-decreasing across [0,1]', () => {
    for (const name of RAMPS) {
      let prev = -Infinity
      for (let i = 0; i <= 20; i++) {
        const v = ease(name, i / 20)
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
        prev = v
      }
    }
  })
})

describe('ease — known midpoints + shape', () => {
  it('linear is the identity', () => {
    expect(ease('linear', 0.25)).toBeCloseTo(0.25, 6)
    expect(ease('linear', 0.5)).toBeCloseTo(0.5, 6)
    expect(ease('linear', 0.75)).toBeCloseTo(0.75, 6)
  })

  it('easeIn starts slow (mid < 0.5), easeOut ends slow (mid > 0.5)', () => {
    expect(ease('easeIn', 0.5)).toBeLessThan(0.5)
    expect(ease('easeOut', 0.5)).toBeGreaterThan(0.5)
  })

  it('easeInOut + smoothstep are symmetric (mid = 0.5)', () => {
    expect(ease('easeInOut', 0.5)).toBeCloseTo(0.5, 6)
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 6)
    // symmetry: f(p) + f(1-p) = 1
    expect(ease('easeInOut', 0.3) + ease('easeInOut', 0.7)).toBeCloseTo(1, 6)
  })

  it('bare easeIn/Out/InOut are QUADRATIC (back-compat with reveal/highlight)', () => {
    // p² and 1-(1-p)² — the curves the reveal evaluator shipped with.
    expect(ease('easeIn', 0.5)).toBeCloseTo(0.25, 6)
    expect(ease('easeOut', 0.5)).toBeCloseTo(0.75, 6)
    expect(ease('easeInOut', 0.5)).toBeCloseTo(0.5, 6)
  })

  it('explicit cubic curves resolve to their helpers', () => {
    expect(ease('easeInCubic', 0.4)).toBeCloseTo(easeInCubic(0.4), 6)
    expect(ease('easeOutCubic', 0.4)).toBeCloseTo(easeOutCubic(0.4), 6)
    expect(ease('easeInOutCubic', 0.4)).toBeCloseTo(easeInOutCubic(0.4), 6)
    expect(easeInCubic(0.5)).toBeCloseTo(0.125, 6)
  })
})

describe('cubicBezier', () => {
  it('endpoints are pinned to 0 and 1', () => {
    expect(cubicBezier(0.25, 0.1, 0.25, 1, 0)).toBe(0)
    expect(cubicBezier(0.25, 0.1, 0.25, 1, 1)).toBe(1)
  })

  it('a linear bezier (0,0,1,1) reproduces the input', () => {
    for (const p of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      expect(cubicBezier(0, 0, 1, 1, p)).toBeCloseTo(p, 4)
    }
  })

  it('ease() resolves a [x1,y1,x2,y2] tuple via cubicBezier', () => {
    expect(ease([0, 0, 1, 1], 0.5)).toBeCloseTo(0.5, 4)
  })

  it('ease() accepts a custom function', () => {
    expect(ease((p) => p * p, 0.5)).toBeCloseTo(0.25, 6)
  })
})

describe('settling curves — bounce + elastic', () => {
  it('bounce hits f(0)=0, f(1)=1 and stays within [0,1] but is NOT monotonic', () => {
    expect(ease('bounce', 0)).toBeCloseTo(0, 6)
    expect(ease('bounce', 1)).toBeCloseTo(1, 6)
    let increases = 0
    let decreases = 0
    let prev = ease('bounce', 0)
    for (let i = 1; i <= 40; i++) {
      const v = ease('bounce', i / 40)
      if (v > prev + 1e-6) increases++
      if (v < prev - 1e-6) decreases++
      expect(v).toBeGreaterThanOrEqual(-1e-6)
      expect(v).toBeLessThanOrEqual(1 + 1e-6)
      prev = v
    }
    // bounce rebounds — it must both rise and fall (non-monotonic).
    expect(increases).toBeGreaterThan(0)
    expect(decreases).toBeGreaterThan(0)
  })

  it('elastic hits f(0)=0, f(1)=1 and OVERSHOOTS 1 somewhere in between', () => {
    expect(ease('elastic', 0)).toBeCloseTo(0, 6)
    expect(ease('elastic', 1)).toBeCloseTo(1, 6)
    let overshot = false
    for (let i = 1; i < 40; i++) {
      if (ease('elastic', i / 40) > 1 + 1e-3) overshot = true
    }
    expect(overshot).toBe(true)
  })
})

describe('clamping + determinism + helpers', () => {
  it('clamps input progress to [0,1]', () => {
    expect(ease('linear', -0.5)).toBe(0)
    expect(ease('linear', 1.5)).toBe(1)
    expect(clamp01(2)).toBe(1)
    expect(clamp01(-3)).toBe(0)
    expect(clamp01(0.4)).toBe(0.4)
  })

  it('is deterministic (same input → same output)', () => {
    expect(ease('easeInOut', 0.37)).toBe(ease('easeInOut', 0.37))
    expect(ease('bounce', 0.62)).toBe(ease('bounce', 0.62))
  })

  it('unknown named curve falls back to linear', () => {
    expect(ease('nope' as EasingName, 0.42)).toBeCloseTo(0.42, 6)
  })

  it('lerp interpolates endpoints', () => {
    expect(lerp(10, 20, 0)).toBe(10)
    expect(lerp(10, 20, 1)).toBe(20)
    expect(lerp(10, 20, 0.5)).toBe(15)
  })
})

describe('EASING_NAMES (UI dropdown list)', () => {
  it('contains every ramp curve plus the settling curves, with no duplicates', () => {
    for (const name of RAMPS) expect(EASING_NAMES).toContain(name)
    expect(EASING_NAMES).toContain('bounce')
    expect(EASING_NAMES).toContain('bounceIn')
    expect(EASING_NAMES).toContain('elastic')
    expect(new Set(EASING_NAMES).size).toBe(EASING_NAMES.length)
  })
  it('every listed name resolves through ease() (no silent fallback)', () => {
    for (const name of EASING_NAMES) {
      expect(Number.isFinite(ease(name, 0.5))).toBe(true)
    }
  })
})

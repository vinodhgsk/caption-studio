/**
 * P8.8 — MOTION-PATH sampler tests (Doc 11; skill keyframe-engine).
 *
 * Proves the PURE parametric path evaluator: endpoints at progress 0 / 1, the
 * arc-length MIDPOINT at 0.5 (EVEN speed, not equal-time-per-segment), monotonic
 * progression, easing warps progress, a 2-point path = straight lerp, a single
 * point is constant, a closed path wraps back to the start, zero-length degenerate
 * paths, and absent / empty → null (identity offset). Plus the composable sample
 * + the full clip-sample compose order (keyframes → motion path → animation).
 */
import { describe, it, expect } from 'vitest'
import type { ClipMotionPath } from '../../../shared/project-schema'
import { ease } from '../../../shared/easing'
import { composeSamples, IDENTITY_SAMPLE, type AnimSample } from './clipAnimation'
import {
  sampleMotionPath,
  motionPathLength,
  cumulativeLengths
} from './motionPath'
import {
  motionPathSample,
  composeClipSample,
  sampleClipKeyframeSample
} from './keyframeSampler'

const path = (points: { x: number; y: number }[], extra?: Partial<ClipMotionPath>): ClipMotionPath => ({
  points,
  ...extra
})

const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps

describe('sampleMotionPath — endpoints + empty', () => {
  it('absent / empty path → null (identity offset)', () => {
    expect(sampleMotionPath(undefined, 0)).toBeNull()
    expect(sampleMotionPath(undefined, 0.5)).toBeNull()
    expect(sampleMotionPath(path([]), 0.5)).toBeNull()
  })

  it('single point → constant for all progress', () => {
    const p = path([{ x: 10, y: 20 }])
    expect(sampleMotionPath(p, 0)).toEqual({ x: 10, y: 20 })
    expect(sampleMotionPath(p, 0.37)).toEqual({ x: 10, y: 20 })
    expect(sampleMotionPath(p, 1)).toEqual({ x: 10, y: 20 })
  })

  it('progress 0 → first point, progress 1 → last point (open path)', () => {
    const p = path([
      { x: 0, y: 0 },
      { x: 50, y: 10 },
      { x: 100, y: 0 }
    ])
    expect(sampleMotionPath(p, 0)).toEqual({ x: 0, y: 0 })
    expect(sampleMotionPath(p, 1)).toEqual({ x: 100, y: 0 })
  })

  it('clamps progress outside [0,1] to the endpoints', () => {
    const p = path([
      { x: 0, y: 0 },
      { x: 100, y: 0 }
    ])
    expect(sampleMotionPath(p, -5)).toEqual({ x: 0, y: 0 })
    expect(sampleMotionPath(p, 9)).toEqual({ x: 100, y: 0 })
  })
})

describe('sampleMotionPath — 2-point path = straight lerp', () => {
  it('interpolates linearly between the two points', () => {
    const p = path([
      { x: 0, y: 0 },
      { x: 100, y: 200 }
    ])
    const q = sampleMotionPath(p, 0.25)!
    expect(near(q.x, 25)).toBe(true)
    expect(near(q.y, 50)).toBe(true)
    expect(sampleMotionPath(p, 0.5)).toEqual({ x: 50, y: 100 })
    const tq = sampleMotionPath(p, 0.75)!
    expect(near(tq.x, 75)).toBe(true)
    expect(near(tq.y, 150)).toBe(true)
  })
})

describe('sampleMotionPath — ARC-LENGTH (even speed)', () => {
  it('p=0.5 lands at the arc-length midpoint, NOT the middle segment', () => {
    // A path whose first segment is SHORT (10px) and second is LONG (90px). The
    // total length is 100; the arc-length midpoint (50px) is well inside the LONG
    // second segment — an equal-TIME-per-segment scheme would wrongly put 0.5 at
    // the JOINT (40,0). Even-speed parameterization puts it at x=50.
    const p = path([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 100, y: 0 }
    ])
    expect(motionPathLength(p)).toBe(100)
    const mid = sampleMotionPath(p, 0.5)!
    expect(near(mid.x, 50)).toBe(true)
    expect(near(mid.y, 0)).toBe(true)
  })

  it('equal progress increments cover equal DISTANCE (constant speed)', () => {
    const p = path([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 100, y: 0 }
    ])
    const xs = [0, 0.25, 0.5, 0.75, 1].map((t) => sampleMotionPath(p, t)!.x)
    // x advances by ~25 each quarter on a straight 0→100 even-speed walk.
    expect(near(xs[0], 0)).toBe(true)
    expect(near(xs[1], 25)).toBe(true)
    expect(near(xs[2], 50)).toBe(true)
    expect(near(xs[3], 75)).toBe(true)
    expect(near(xs[4], 100)).toBe(true)
  })

  it('progresses MONOTONICALLY along the path', () => {
    const p = path([
      { x: 0, y: 0 },
      { x: 30, y: 40 }, // segment length 50
      { x: 30, y: 100 } // segment length 60
    ])
    let prev = -1
    // Cumulative distance from the start should be non-decreasing as progress grows.
    const start = sampleMotionPath(p, 0)!
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const pt = sampleMotionPath(p, t)!
      const d = Math.hypot(pt.x - start.x, pt.y - start.y)
      expect(d).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = d
    }
  })

  it('cumulativeLengths matches segment geometry', () => {
    const verts = [
      { x: 0, y: 0 },
      { x: 3, y: 4 }, // +5
      { x: 3, y: 4 } // +0
    ]
    expect(cumulativeLengths(verts)).toEqual([0, 5, 5])
  })
})

describe('sampleMotionPath — easing warps progress', () => {
  it('easeIn pulls midpoint progress toward the start of the path', () => {
    const straight = path([
      { x: 0, y: 0 },
      { x: 100, y: 0 }
    ])
    const eased = path(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 }
      ],
      { ease: 'easeIn' }
    )
    // ease('easeIn', 0.5) = 0.25 (quadratic), so x = 25 not 50.
    expect(sampleMotionPath(straight, 0.5)!.x).toBe(50)
    expect(near(sampleMotionPath(eased, 0.5)!.x, 100 * ease('easeIn', 0.5))).toBe(true)
    expect(near(sampleMotionPath(eased, 0.5)!.x, 25)).toBe(true)
  })

  it('easing preserves the endpoints (0→first, 1→last)', () => {
    const p = path(
      [
        { x: 0, y: 0 },
        { x: 100, y: 50 }
      ],
      { ease: 'easeInOut' }
    )
    expect(sampleMotionPath(p, 0)).toEqual({ x: 0, y: 0 })
    expect(sampleMotionPath(p, 1)).toEqual({ x: 100, y: 50 })
  })
})

describe('sampleMotionPath — closed path wraps', () => {
  it('p=1 returns to the FIRST point and the closing segment is walked', () => {
    const p = path(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 }
      ],
      { closed: true }
    )
    // Closed square: perimeter 400. p=1 wraps back to the start.
    expect(motionPathLength(p)).toBe(400)
    expect(sampleMotionPath(p, 0)).toEqual({ x: 0, y: 0 })
    const end = sampleMotionPath(p, 1)!
    expect(near(end.x, 0)).toBe(true)
    expect(near(end.y, 0)).toBe(true)
    // 7/8 of the way is the midpoint of the closing (left) edge: (0, 50).
    const closing = sampleMotionPath(p, 7 / 8)!
    expect(near(closing.x, 0)).toBe(true)
    expect(near(closing.y, 50)).toBe(true)
  })
})

describe('sampleMotionPath — degenerate (zero length)', () => {
  it('all-coincident points → the first point for any progress', () => {
    const p = path([
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 }
    ])
    expect(motionPathLength(p)).toBe(0)
    expect(sampleMotionPath(p, 0)).toEqual({ x: 5, y: 5 })
    expect(sampleMotionPath(p, 0.5)).toEqual({ x: 5, y: 5 })
    expect(sampleMotionPath(p, 1)).toEqual({ x: 5, y: 5 })
  })
})

describe('motionPathSample — composable AnimSample', () => {
  it('absent path → IDENTITY_SAMPLE (no offset)', () => {
    expect(motionPathSample(undefined, 0.5)).toEqual(IDENTITY_SAMPLE)
    expect(motionPathSample(path([]), 0.5)).toEqual(IDENTITY_SAMPLE)
  })

  it('drives translate (tx/ty) only; opacity/scale/rotation stay identity', () => {
    const p = path([
      { x: 0, y: 0 },
      { x: 80, y: 40 }
    ])
    const s = motionPathSample(p, 0.5)
    expect(s).toEqual({ opacity: 1, tx: 40, ty: 20, scale: 1, rotation: 0 })
  })
})

describe('composeClipSample — compose order (keyframes → path → animation)', () => {
  it('path translate ADDS to keyframe translate and the animation sample', () => {
    const kf = { x: [{ t: 0, value: 100 }] } // constant x=100 keyframe lane
    const p = path([
      { x: 0, y: 0 },
      { x: 60, y: 0 }
    ])
    const animation: AnimSample = { opacity: 0.5, tx: 5, ty: 0, scale: 2, rotation: 0.1 }
    const out = composeClipSample({
      keyframes: kf,
      keyframeT: 0,
      motionPath: p,
      pathProgress: 0.5,
      animation
    })
    // keyframe tx=100, path tx=30 (arc-length midpoint of a 60px line), anim tx=5.
    expect(out.tx).toBe(100 + 30 + 5)
    expect(out.ty).toBe(0)
    // opacity/scale multiply through the animation sample; path is neutral there.
    expect(out.opacity).toBe(0.5)
    expect(out.scale).toBe(2)
    expect(near(out.rotation, 0.1)).toBe(true)
  })

  it('no path → equals keyframes ∘ animation (path is identity)', () => {
    const kf = { y: [{ t: 0, value: 7 }] }
    const animation: AnimSample = { opacity: 1, tx: 3, ty: 0, scale: 1, rotation: 0 }
    const withNoPath = composeClipSample({
      keyframes: kf,
      keyframeT: 0,
      motionPath: undefined,
      pathProgress: 0.5,
      animation
    })
    const expected = composeSamples(sampleClipKeyframeSample(kf, 0), animation)
    expect(withNoPath).toEqual(expected)
  })

  it('absent everything → identity', () => {
    const out = composeClipSample({
      keyframeT: 0,
      pathProgress: 0.5,
      animation: IDENTITY_SAMPLE
    })
    expect(out).toEqual(IDENTITY_SAMPLE)
  })
})

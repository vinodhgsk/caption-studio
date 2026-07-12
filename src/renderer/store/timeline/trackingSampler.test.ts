/**
 * P8.10 — motion-tracking ATTACH + smoothing tests (Doc 11; skill `motion-tracking`).
 *
 * Proves the PURE compositor pieces:
 *   - `sampleTrackPath` clamps/interpolates the per-frame path (P8.9 evaluator).
 *   - `trackingSample` offsets the text to STICK to the subject (motion relative to
 *     the picked targetBox), the MANUAL ANCHOR nudges the final position, and
 *     disabled / no-path / absent → IDENTITY (no offset).
 *   - `smoothTrackPath` reduces per-frame jitter (lower variance / bounded deltas)
 *     and is the identity for amount 0.
 *   - `composeClipSample` folds the tracking offset in the documented compose order
 *     (keyframes → motion-path → tracking → animation): the tracking tx/ty ADD.
 */
import { describe, expect, it } from 'vitest'
import type { ClipTracking } from '../../../shared/project-schema'
import type { TrackPath } from '../../../shared/tracking'
import { sampleTrackPath, smoothTrackPath } from '../../../shared/tracking'
import { IDENTITY_SAMPLE } from './clipAnimation'
import { composeClipSample } from './keyframeSampler'
import { trackingAnchor, trackingSample, trackingToPath } from './trackingSampler'

// A simple tracking attachment: subject starts at the picked box center (100,100)
// and moves +40px in x by t=2s. So at t=2 the text should be offset +40 in x.
const baseTracking: ClipTracking = {
  enabled: true,
  target: 'face',
  targetBox: { x: 100, y: 100, width: 50, height: 50, kind: 'face' },
  fps: 30,
  path: [
    { t: 0, x: 100, y: 100, scale: 1, rotation: 0, confidence: 1 },
    { t: 2, x: 140, y: 100, scale: 1, rotation: 0, confidence: 1 }
  ]
}

describe('sampleTrackPath (P8.9 evaluator)', () => {
  const path: TrackPath = { fps: 30, samples: baseTracking.path! }

  it('clamps to the first sample before the start', () => {
    expect(sampleTrackPath(path, -1)).toMatchObject({ x: 100, y: 100 })
  })

  it('clamps to the last sample after the end', () => {
    expect(sampleTrackPath(path, 99)).toMatchObject({ x: 140, y: 100 })
  })

  it('lerps the interior (midpoint is halfway)', () => {
    expect(sampleTrackPath(path, 1)).toMatchObject({ x: 120, y: 100 })
  })

  it('returns null for an empty path', () => {
    expect(sampleTrackPath({ fps: 30, samples: [] }, 0)).toBeNull()
  })
})

describe('trackingSample — subject-follow offset', () => {
  it('is ~zero offset at the pick time (text stays where placed)', () => {
    const s = trackingSample(baseTracking, 0)
    expect(s.tx).toBeCloseTo(0)
    expect(s.ty).toBeCloseTo(0)
    expect(s.opacity).toBe(1)
  })

  it('offsets by the subject displacement relative to the picked box', () => {
    const s = trackingSample(baseTracking, 2)
    expect(s.tx).toBeCloseTo(40) // 140 - 100
    expect(s.ty).toBeCloseTo(0)
  })

  it('halfway through, offsets by half the displacement', () => {
    const s = trackingSample(baseTracking, 1)
    expect(s.tx).toBeCloseTo(20)
  })

  it('rides the subject scale and rotation (deg→rad)', () => {
    const t: ClipTracking = {
      ...baseTracking,
      path: [{ t: 0, x: 100, y: 100, scale: 1.5, rotation: 90, confidence: 1 }]
    }
    const s = trackingSample(t, 0)
    expect(s.scale).toBeCloseTo(1.5)
    expect(s.rotation).toBeCloseTo(Math.PI / 2)
  })
})

describe('trackingSample — disabled / no-path → identity', () => {
  it('absent tracking → identity', () => {
    expect(trackingSample(undefined, 0)).toEqual(IDENTITY_SAMPLE)
  })

  it('enabled:false → identity (path preserved but not driving)', () => {
    expect(trackingSample({ ...baseTracking, enabled: false }, 2)).toEqual(IDENTITY_SAMPLE)
  })

  it('no path → identity', () => {
    expect(trackingSample({ enabled: true, targetBox: baseTracking.targetBox }, 2)).toEqual(
      IDENTITY_SAMPLE
    )
  })

  it('empty path → identity', () => {
    expect(trackingSample({ ...baseTracking, path: [] }, 2)).toEqual(IDENTITY_SAMPLE)
  })

  it('trackingToPath rebuilds {fps,samples} and returns undefined when empty', () => {
    expect(trackingToPath(baseTracking)).toEqual({ fps: 30, samples: baseTracking.path })
    expect(trackingToPath({ enabled: true })).toBeUndefined()
    expect(trackingToPath(undefined)).toBeUndefined()
  })
})

describe('trackingSample — MANUAL ANCHOR correction (req. 3)', () => {
  it('defaults to {dx:0,dy:0} when absent', () => {
    expect(trackingAnchor(baseTracking)).toEqual({ dx: 0, dy: 0 })
    expect(trackingAnchor(undefined)).toEqual({ dx: 0, dy: 0 })
  })

  it('the anchor nudges the FINAL position on top of the tracked offset', () => {
    const anchored: ClipTracking = { ...baseTracking, anchor: { dx: -30, dy: 12 } }
    const base = trackingSample(baseTracking, 2)
    const nudged = trackingSample(anchored, 2)
    // Same subject-follow offset, shifted by the anchor.
    expect(nudged.tx).toBeCloseTo(base.tx - 30)
    expect(nudged.ty).toBeCloseTo(base.ty + 12)
  })

  it('the anchor applies even at the pick time (pure additive nudge)', () => {
    const anchored: ClipTracking = { ...baseTracking, anchor: { dx: 5, dy: -7 } }
    const s = trackingSample(anchored, 0)
    expect(s.tx).toBeCloseTo(5)
    expect(s.ty).toBeCloseTo(-7)
  })
})

describe('smoothTrackPath — jitter smoothing (req. 4)', () => {
  /** Population variance of a numeric series. */
  function variance(xs: number[]): number {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length
    return xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length
  }

  // A noisy path: a smooth ramp + alternating +/- jitter on x.
  const noisy: TrackPath = {
    fps: 30,
    samples: Array.from({ length: 40 }, (_, i) => ({
      t: i / 30,
      x: i + (i % 2 === 0 ? 8 : -8),
      y: 50
    }))
  }

  it('is the identity for amount 0', () => {
    const out = smoothTrackPath(noisy, 0)
    expect(out.samples).toEqual(noisy.samples)
  })

  it('does not mutate the input (returns a fresh array)', () => {
    const out = smoothTrackPath(noisy, 0)
    expect(out.samples).not.toBe(noisy.samples)
    expect(out).not.toBe(noisy)
  })

  it('reduces the variance of a noisy series', () => {
    const raw = noisy.samples.map((s) => s.x)
    const smoothed = smoothTrackPath(noisy, 0.6).samples.map((s) => s.x)
    expect(variance(smoothed)).toBeLessThan(variance(raw))
  })

  it('a stronger amount smooths more (lower per-frame delta)', () => {
    const maxDelta = (xs: number[]): number => {
      let m = 0
      for (let i = 1; i < xs.length; i++) m = Math.max(m, Math.abs(xs[i] - xs[i - 1]))
      return m
    }
    const light = smoothTrackPath(noisy, 0.2).samples.map((s) => s.x)
    const heavy = smoothTrackPath(noisy, 0.9).samples.map((s) => s.x)
    expect(maxDelta(heavy)).toBeLessThanOrEqual(maxDelta(light))
  })

  it('keeps sample count + times, preserves confidence, fills absent optionals lazily', () => {
    const out = smoothTrackPath(noisy, 0.5)
    expect(out.samples.length).toBe(noisy.samples.length)
    expect(out.samples.map((s) => s.t)).toEqual(noisy.samples.map((s) => s.t))
    // y was constant 50 — smoothing leaves it 50.
    expect(out.samples.every((s) => Math.abs(s.y - 50) < 1e-9)).toBe(true)
  })

  it('the smoothed series stays bounded by the input range', () => {
    const raw = noisy.samples.map((s) => s.x)
    const lo = Math.min(...raw)
    const hi = Math.max(...raw)
    const smoothed = smoothTrackPath(noisy, 0.7).samples.map((s) => s.x)
    expect(smoothed.every((v) => v >= lo - 1e-9 && v <= hi + 1e-9)).toBe(true)
  })

  it('tracking smoothing flows through trackingSample (smoothed != raw mid-jitter)', () => {
    const t: ClipTracking = {
      enabled: true,
      targetBox: { x: 0, y: 50, width: 10, height: 10, kind: 'object' },
      fps: 30,
      path: noisy.samples,
      smoothing: 0.7
    }
    const tRaw: ClipTracking = { ...t, smoothing: 0 }
    // At an odd index the raw value dips by jitter; smoothing pulls it toward the ramp.
    const time = 5 / 30 // index 5 (odd → -8 jitter)
    expect(trackingSample(t, time).tx).not.toBeCloseTo(trackingSample(tRaw, time).tx)
  })
})

describe('composeClipSample — tracking in the compose order (req. 2)', () => {
  it('adds the tracking tx/ty into the composed sample', () => {
    const withTrack = composeClipSample({
      keyframeT: 0,
      pathProgress: 0,
      tracking: baseTracking,
      trackingT: 2,
      animation: IDENTITY_SAMPLE
    })
    expect(withTrack.tx).toBeCloseTo(40)
    expect(withTrack.ty).toBeCloseTo(0)
  })

  it('no tracking → identity composition (unchanged)', () => {
    const noTrack = composeClipSample({
      keyframeT: 0,
      pathProgress: 0,
      animation: IDENTITY_SAMPLE
    })
    expect(noTrack).toEqual(IDENTITY_SAMPLE)
  })

  it('tracking offset ADDS on top of a keyframed translate (associative compose)', () => {
    const composed = composeClipSample({
      keyframes: { x: [{ t: 0, value: 10 }] },
      keyframeT: 0,
      pathProgress: 0,
      tracking: baseTracking,
      trackingT: 2,
      animation: IDENTITY_SAMPLE
    })
    // keyframe x (10) + tracking tx (40) = 50.
    expect(composed.tx).toBeCloseTo(50)
  })

  it('disabled tracking contributes identity in compose', () => {
    const composed = composeClipSample({
      keyframeT: 0,
      pathProgress: 0,
      tracking: { ...baseTracking, enabled: false },
      trackingT: 2,
      animation: IDENTITY_SAMPLE
    })
    expect(composed).toEqual(IDENTITY_SAMPLE)
  })
})

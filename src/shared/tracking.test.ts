/**
 * P8.9 — motion-tracking SHARED contract tests (Doc 11; skill `motion-tracking`).
 *
 * Proves the pure {@link sampleTrackPath} evaluator the P8.10 compositor calls:
 * empty → null, clamp at the ends, linear interpolation between bracketing samples,
 * and that absent scale/rotation/confidence normalize to 1 / 0 / 1. Plus the
 * `TrackSample` / `TrackPath` shape and the target-kind constant.
 */
import { describe, expect, it } from 'vitest'
import {
  TRACK_TARGET_KINDS,
  sampleTrackPath,
  type TrackPath,
  type TrackSample
} from './tracking'

const path: TrackPath = {
  fps: 10,
  samples: [
    { t: 0, x: 0, y: 0, scale: 1, rotation: 0, confidence: 1 },
    { t: 1, x: 100, y: 50, scale: 2, rotation: 90, confidence: 0.5 }
  ]
}

describe('TRACK_TARGET_KINDS', () => {
  it('is the closed face/object set', () => {
    expect(TRACK_TARGET_KINDS).toEqual(['face', 'object'])
  })
})

describe('sampleTrackPath', () => {
  it('returns null for an absent or empty path (caller = identity)', () => {
    expect(sampleTrackPath(undefined, 0)).toBeNull()
    expect(sampleTrackPath({ fps: 30, samples: [] }, 0)).toBeNull()
  })

  it('clamps before the first sample to the first sample', () => {
    expect(sampleTrackPath(path, -5)).toMatchObject({ x: 0, y: 0, scale: 1, rotation: 0 })
  })

  it('clamps after the last sample to the last sample', () => {
    expect(sampleTrackPath(path, 99)).toMatchObject({ x: 100, y: 50, scale: 2, rotation: 90 })
  })

  it('linearly interpolates x/y/scale/rotation/confidence at an interior time', () => {
    const s = sampleTrackPath(path, 0.5)
    expect(s).not.toBeNull()
    expect(s?.x).toBeCloseTo(50)
    expect(s?.y).toBeCloseTo(25)
    expect(s?.scale).toBeCloseTo(1.5)
    expect(s?.rotation).toBeCloseTo(45)
    expect(s?.confidence).toBeCloseTo(0.75)
    expect(s?.t).toBeCloseTo(0.5)
  })

  it('normalizes absent scale → 1, rotation → 0, confidence → 1', () => {
    const bare: TrackPath = { fps: 30, samples: [{ t: 0, x: 10, y: 20 } as TrackSample] }
    const s = sampleTrackPath(bare, 0)
    expect(s).toMatchObject({ x: 10, y: 20, scale: 1, rotation: 0, confidence: 1 })
  })
})

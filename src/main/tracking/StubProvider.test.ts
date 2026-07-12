/**
 * P8.9 — deterministic STUB tracking-provider tests (Doc 11; skill `motion-tracking`).
 *
 * Proves the stub produces a DETERMINISTic path for a given target box + duration/fps:
 * the right sample COUNT (one per frame + the endpoint), the right time stamps, the
 * subject starting AT the box center, the orbit staying within the expected amplitude,
 * and full re-run reproducibility (no Math.random / Date). Also checks the provider
 * delegates to the pure builder and ignores the video args.
 */
import { describe, expect, it } from 'vitest'
import type { TargetBox } from '../../shared/tracking'
import { buildStubTrackPath, StubTrackingProvider, STUB_TRACKING_PROVIDER_ID } from './StubProvider'

const target: TargetBox = { x: 200, y: 100, width: 80, height: 40, kind: 'face' }

describe('buildStubTrackPath', () => {
  it('produces one sample per frame plus the endpoint over [0, duration]', () => {
    const path = buildStubTrackPath(target, { durationSec: 2, fps: 10 })
    // round(2 * 10) = 20 segments → 21 samples, last at t = 2.
    expect(path.fps).toBe(10)
    expect(path.samples).toHaveLength(21)
    expect(path.samples[0].t).toBeCloseTo(0)
    expect(path.samples[20].t).toBeCloseTo(2)
  })

  it('starts the subject exactly at the box center (text starts on target)', () => {
    const path = buildStubTrackPath(target, { durationSec: 1, fps: 30 })
    expect(path.samples[0].x).toBeCloseTo(target.x)
    expect(path.samples[0].y).toBeCloseTo(target.y)
    expect(path.samples[0].scale).toBe(1)
    expect(path.samples[0].rotation).toBe(0)
    expect(path.samples[0].confidence).toBe(0.9)
  })

  it('keeps the orbit within the box-size-scaled amplitude', () => {
    const path = buildStubTrackPath(target, { durationSec: 1, fps: 30 })
    const ampX = target.width * 0.15
    const ampY = target.height * 0.15
    for (const s of path.samples) {
      expect(Math.abs(s.x - target.x)).toBeLessThanOrEqual(ampX + 1e-9)
      // y orbits between 0 and 2*ampY above the center (1 - cos ∈ [0,2]).
      expect(s.y - target.y).toBeGreaterThanOrEqual(-1e-9)
      expect(s.y - target.y).toBeLessThanOrEqual(2 * ampY + 1e-9)
    }
  })

  it('is deterministic: same inputs → identical path', () => {
    const a = buildStubTrackPath(target, { durationSec: 1.5, fps: 24 })
    const b = buildStubTrackPath(target, { durationSec: 1.5, fps: 24 })
    expect(a).toEqual(b)
  })

  it('clamps a zero/negative duration to a single-segment (2-sample) path', () => {
    const path = buildStubTrackPath(target, { durationSec: 0, fps: 30 })
    expect(path.samples).toHaveLength(2)
  })
})

describe('StubTrackingProvider', () => {
  it('has the stub id', () => {
    expect(new StubTrackingProvider().id).toBe(STUB_TRACKING_PROVIDER_ID)
  })

  it('delegates to the pure builder, ignoring the bundle/video args', async () => {
    const provider = new StubTrackingProvider()
    const viaProvider = await provider.track('/abs/bundle', 'media/clip.mp4', target, {
      durationSec: 1,
      fps: 12
    })
    expect(viaProvider).toEqual(buildStubTrackPath(target, { durationSec: 1, fps: 12 }))
  })
})

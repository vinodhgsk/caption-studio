/**
 * P8.9 — tracking provider REGISTRY tests (Doc 11). Mirrors the STT registry tests:
 * default = stub, register + select a new provider, env override, explicit-wins, and
 * the throw for an unregistered id — proving the pluggability seam a real CV tracker
 * drops into.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { TargetBox, TrackOptions, TrackPath, TrackingProvider } from '../../shared/tracking'
import {
  DEFAULT_TRACKING_PROVIDER_ID,
  TRACKING_PROVIDER_ENV,
  getTrackingProvider,
  registerTrackingProvider,
  setActiveTrackingProvider
} from './registry'

/** A fake provider used to exercise registration + active-selection. */
class FakeTrackingProvider implements TrackingProvider {
  constructor(readonly id: string) {}
  async track(
    _bundlePath: string,
    _videoRef: string,
    target: TargetBox,
    _opts: TrackOptions
  ): Promise<TrackPath> {
    return { fps: 30, samples: [{ t: 0, x: target.x, y: target.y }] }
  }
}

describe('tracking provider registry', () => {
  afterEach(() => {
    setActiveTrackingProvider(null)
    delete process.env[TRACKING_PROVIDER_ENV]
  })

  it('resolves the stub provider by default', () => {
    setActiveTrackingProvider(null)
    expect(getTrackingProvider().id).toBe(DEFAULT_TRACKING_PROVIDER_ID)
    expect(getTrackingProvider().id).toBe('stub')
  })

  it('lets a new provider be registered and selected without changing callers', () => {
    registerTrackingProvider(new FakeTrackingProvider('opencv'))
    setActiveTrackingProvider('opencv')
    expect(getTrackingProvider().id).toBe('opencv')
  })

  it('honours the env override when no explicit id is set', () => {
    registerTrackingProvider(new FakeTrackingProvider('cloud'))
    setActiveTrackingProvider(null)
    process.env[TRACKING_PROVIDER_ENV] = 'cloud'
    expect(getTrackingProvider().id).toBe('cloud')
  })

  it('an explicit active id wins over the env override', () => {
    registerTrackingProvider(new FakeTrackingProvider('cloud'))
    process.env[TRACKING_PROVIDER_ENV] = 'cloud'
    setActiveTrackingProvider('opencv')
    registerTrackingProvider(new FakeTrackingProvider('opencv'))
    expect(getTrackingProvider().id).toBe('opencv')
  })

  it('throws for an unregistered provider id', () => {
    setActiveTrackingProvider('does-not-exist')
    expect(() => getTrackingProvider()).toThrow(/No tracking provider registered/)
  })
})

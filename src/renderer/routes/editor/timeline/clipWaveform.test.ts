import { describe, expect, it } from 'vitest'
import { barCountForWidth, peaksForClip, waveformCacheKey } from './clipWaveform'
import type { WaveformPeak } from './waveform'

describe('waveformCacheKey', () => {
  it('combines bundle path and mediaRef into a stable key', () => {
    expect(waveformCacheKey('/bundles/a', 'media/x.mp3')).toBe('/bundles/a::media/x.mp3')
  })

  it('is the same for the same bundle + ref (cache hit)', () => {
    expect(waveformCacheKey('/b', 'media/x.mp3')).toBe(waveformCacheKey('/b', 'media/x.mp3'))
  })

  it('differs when the same mediaRef lives in a different bundle', () => {
    expect(waveformCacheKey('/bundle-a', 'media/x.mp3')).not.toBe(
      waveformCacheKey('/bundle-b', 'media/x.mp3')
    )
  })

  it('differs across mediaRefs in the same bundle', () => {
    expect(waveformCacheKey('/b', 'media/x.mp3')).not.toBe(waveformCacheKey('/b', 'media/y.mp3'))
  })
})

describe('barCountForWidth', () => {
  it('divides width by pxPerBar and rounds', () => {
    expect(barCountForWidth(100, 2, 1024)).toBe(50)
    expect(barCountForWidth(101, 2, 1024)).toBe(51) // 50.5 -> 51
  })

  it('never returns fewer than one bar (sub-pixel clip)', () => {
    expect(barCountForWidth(0.4, 2, 1024)).toBe(1)
    expect(barCountForWidth(0, 2, 1024)).toBe(1)
  })

  it('clamps to the max bar count for very wide clips', () => {
    expect(barCountForWidth(100000, 2, 1024)).toBe(1024)
  })

  it('falls back to one bar for a non-positive pxPerBar', () => {
    expect(barCountForWidth(100, 0, 1024)).toBe(1)
  })
})

describe('peaksForClip', () => {
  // Source: 4 peaks over 4s, each peak owning 1s. Amplitudes ramp up per peak.
  const src: WaveformPeak[] = [
    { min: -0.1, max: 0.1 },
    { min: -0.2, max: 0.2 },
    { min: -0.3, max: 0.3 },
    { min: -0.4, max: 0.4 }
  ]

  it('returns exactly targetCount peaks', () => {
    expect(peaksForClip(src, 4, 0, 4, 8)).toHaveLength(8)
    expect(peaksForClip(src, 4, 0, 4, 2)).toHaveLength(2)
  })

  it('maps the full source window to all peaks (min/max preserved)', () => {
    // Two target buckets over the whole source: first half [peak0,peak1], second
    // half [peak2,peak3]. Each bucket keeps the loudest excursion in its range.
    const out = peaksForClip(src, 4, 0, 4, 2)
    expect(out[0]).toEqual({ min: -0.2, max: 0.2 })
    expect(out[1]).toEqual({ min: -0.4, max: 0.4 })
  })

  it('slices to the clip source window [in, out] (follows trims)', () => {
    // Window [2s, 4s] selects source peaks 2 and 3 only.
    const out = peaksForClip(src, 4, 2, 4, 2)
    expect(out[0]).toEqual({ min: -0.3, max: 0.3 })
    expect(out[1]).toEqual({ min: -0.4, max: 0.4 })
  })

  it('downsamples a finer source to the target bar count', () => {
    const many: WaveformPeak[] = Array.from({ length: 1000 }, (_, i) => ({
      min: -i / 1000,
      max: i / 1000
    }))
    const out = peaksForClip(many, 10, 0, 10, 50)
    expect(out).toHaveLength(50)
    // Last downsampled bucket holds the loudest source peaks (near max amplitude).
    expect(out[49].max).toBeGreaterThan(0.9)
  })

  it('returns flat peaks for a zero/negative-width window', () => {
    expect(peaksForClip(src, 4, 2, 2, 3)).toEqual([
      { min: 0, max: 0 },
      { min: 0, max: 0 },
      { min: 0, max: 0 }
    ])
  })

  it('returns flat peaks when there are no source peaks', () => {
    expect(peaksForClip([], 4, 0, 4, 2)).toEqual([
      { min: 0, max: 0 },
      { min: 0, max: 0 }
    ])
  })

  it('returns flat peaks for a non-positive source duration', () => {
    expect(peaksForClip(src, 0, 0, 4, 2)).toEqual([
      { min: 0, max: 0 },
      { min: 0, max: 0 }
    ])
  })

  it('returns [] for a non-positive target count', () => {
    expect(peaksForClip(src, 4, 0, 4, 0)).toEqual([])
  })

  it('clamps a window that runs past the source end', () => {
    // out=10s but source is only 4s: clamps to the last source peak.
    const out = peaksForClip(src, 4, 3, 10, 1)
    expect(out[0]).toEqual({ min: -0.4, max: 0.4 })
  })
})

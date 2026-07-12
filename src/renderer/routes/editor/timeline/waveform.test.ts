import { describe, expect, it } from 'vitest'
import { extractPeaks, mixToMono } from './waveform'

describe('extractPeaks', () => {
  it('returns exactly bucketCount peaks', () => {
    const samples = new Float32Array(1000).map((_, i) => Math.sin(i))
    expect(extractPeaks(samples, 64)).toHaveLength(64)
  })

  it('captures the min and max amplitude within each bucket', () => {
    // Two buckets over 4 samples: [-1, 0.5] and [-0.25, 1].
    const peaks = extractPeaks([-1, 0.5, -0.25, 1], 2)
    expect(peaks[0]).toEqual({ min: -1, max: 0.5 })
    expect(peaks[1]).toEqual({ min: -0.25, max: 1 })
  })

  it('returns flat peaks for empty input', () => {
    expect(extractPeaks([], 3)).toEqual([
      { min: 0, max: 0 },
      { min: 0, max: 0 },
      { min: 0, max: 0 }
    ])
  })

  it('returns [] for a non-positive bucket count', () => {
    expect(extractPeaks([1, 2, 3], 0)).toEqual([])
  })
})

describe('mixToMono', () => {
  it('returns the single channel unchanged', () => {
    const ch = new Float32Array([0.1, 0.2])
    expect(mixToMono([ch])).toBe(ch)
  })

  it('averages multiple channels sample-wise', () => {
    const mono = mixToMono([
      new Float32Array([1, -1, 0.5]),
      new Float32Array([0, 1, 0.5])
    ])
    expect(Array.from(mono as Float32Array)).toEqual([0.5, 0, 0.5])
  })

  it('returns [] for no channels', () => {
    expect(mixToMono([])).toEqual([])
  })
})

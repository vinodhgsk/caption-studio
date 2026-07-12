/**
 * Tests for energy-based vocal-activity detection (VAD phrase-sync).
 * Uses synthetic tone-burst-over-silence signals — deterministic and offline.
 */
import { describe, expect, it } from 'vitest'
import { detectVocalRegions, totalVocalDuration } from './vocalActivity'

const SR = 16000

/**
 * Build a mono signal where each `[start, end]` (seconds) segment is a 0.5-amplitude
 * sine tone and everything else is silence.
 */
function signalWithTones(durationSec: number, tones: Array<[number, number]>): Float32Array {
  const n = Math.round(durationSec * SR)
  const s = new Float32Array(n)
  for (const [start, end] of tones) {
    const a = Math.round(start * SR)
    const b = Math.round(end * SR)
    for (let i = a; i < b && i < n; i++) {
      s[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / SR)
    }
  }
  return s
}

describe('detectVocalRegions', () => {
  it('returns [] for empty / too-short / silent signals', () => {
    expect(detectVocalRegions(new Float32Array(0), SR)).toEqual([])
    expect(detectVocalRegions(new Float32Array(100), SR)).toEqual([])
    expect(detectVocalRegions(new Float32Array(SR), SR)).toEqual([]) // pure silence, 1s
    expect(detectVocalRegions(signalWithTones(1, [[0.2, 0.5]]), 0)).toEqual([])
  })

  it('finds two phrases separated by a clear silent gap', () => {
    // silence | tone 0.5–1.0 | silence | tone 1.5–2.0 | silence
    const sig = signalWithTones(2.5, [
      [0.5, 1.0],
      [1.5, 2.0]
    ])
    const regions = detectVocalRegions(sig, SR)
    expect(regions).toHaveLength(2)
    // Region bounds land near the tone edges (within padding + frame tolerance).
    expect(regions[0].start).toBeGreaterThan(0.3)
    expect(regions[0].start).toBeLessThan(0.6)
    expect(regions[0].end).toBeGreaterThan(0.9)
    expect(regions[0].end).toBeLessThan(1.15)
    expect(regions[1].start).toBeGreaterThan(1.3)
    expect(regions[1].end).toBeGreaterThan(1.9)
  })

  it('regions are sorted, non-overlapping, and within [0, duration]', () => {
    const sig = signalWithTones(3, [
      [0.4, 0.9],
      [1.4, 1.9],
      [2.3, 2.8]
    ])
    const regions = detectVocalRegions(sig, SR)
    for (let i = 0; i < regions.length; i++) {
      expect(regions[i].end).toBeGreaterThan(regions[i].start)
      expect(regions[i].start).toBeGreaterThanOrEqual(0)
      expect(regions[i].end).toBeLessThanOrEqual(3 + 1e-9)
      if (i > 0) expect(regions[i].start).toBeGreaterThanOrEqual(regions[i - 1].end - 1e-9)
    }
  })

  it('bridges a micro-gap (breath) shorter than minGapSec into one region', () => {
    // Two tones split by a 0.1s gap (< default minGapSec 0.25) → single region.
    const sig = signalWithTones(2, [
      [0.4, 0.9],
      [1.0, 1.5]
    ])
    const regions = detectVocalRegions(sig, SR)
    expect(regions).toHaveLength(1)
    expect(regions[0].start).toBeLessThan(0.6)
    expect(regions[0].end).toBeGreaterThan(1.4)
  })

  it('drops a region shorter than minRegionSec (click rejection)', () => {
    // A ~20ms click (realistic transient) surrounded by silence smears to well
    // under minRegionSec 0.15 even through the RMS window → dropped.
    const sig = signalWithTones(1.5, [[0.6, 0.62]])
    expect(detectVocalRegions(sig, SR)).toEqual([])
  })
})

describe('totalVocalDuration', () => {
  it('sums region durations', () => {
    expect(totalVocalDuration([{ start: 0, end: 1 }, { start: 2, end: 2.5 }])).toBeCloseTo(1.5, 6)
    expect(totalVocalDuration([])).toBe(0)
  })
})

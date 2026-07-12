import { describe, expect, it } from 'vitest'
import { detectBeats } from './beatDetect'

/**
 * Build a deterministic mono "metronome": a decaying-sine CLICK at each beat time
 * over a `durationSec` track at `sampleRate`, silence between. No randomness so the
 * detector's output is reproducible (skill `beat-sync`: deterministic).
 */
function metronome(
  beatTimesSec: number[],
  sampleRate: number,
  durationSec: number
): Float32Array {
  const out = new Float32Array(Math.round(durationSec * sampleRate))
  const clickLen = Math.round(0.03 * sampleRate) // 30ms transient
  for (const t of beatTimesSec) {
    const start = Math.round(t * sampleRate)
    for (let i = 0; i < clickLen && start + i < out.length; i++) {
      const env = Math.exp(-i / (clickLen * 0.3)) // sharp attack, quick decay
      out[start + i] = env * Math.sin((2 * Math.PI * 1000 * i) / sampleRate)
    }
  }
  return out
}

describe('detectBeats', () => {
  it('returns no beats for empty or silent input', () => {
    expect(detectBeats([], 44100)).toEqual([])
    expect(detectBeats(new Float32Array(44100), 44100)).toEqual([])
  })

  it('returns no beats for a non-positive sample rate', () => {
    const sig = metronome([0.5], 8000, 1)
    expect(detectBeats(sig, 0)).toEqual([])
  })

  it('detects clicks of a 120 BPM metronome at the right times (±50 ms)', () => {
    const sampleRate = 8000
    const expected = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5]
    const sig = metronome(expected, sampleRate, 4)

    const beats = detectBeats(sig, sampleRate, { windowSize: 256, hopSize: 128, minIntervalSec: 0.2 })

    // One beat per click (allow the detector to miss the very first/last edge frame).
    expect(beats.length).toBeGreaterThanOrEqual(expected.length - 1)
    expect(beats.length).toBeLessThanOrEqual(expected.length + 1)

    // Each expected click has a detected beat within 50 ms.
    for (const t of expected) {
      const near = beats.some((b) => Math.abs(b - t) <= 0.05)
      expect(near, `expected a beat near ${t}s in ${JSON.stringify(beats)}`).toBe(true)
    }
  })

  it('returns beats sorted ascending', () => {
    const sampleRate = 8000
    const sig = metronome([0.4, 0.9, 1.6, 2.2], sampleRate, 3)
    const beats = detectBeats(sig, sampleRate, { windowSize: 256, hopSize: 128, minIntervalSec: 0.2 })
    const sorted = [...beats].sort((a, b) => a - b)
    expect(beats).toEqual(sorted)
  })

  it('respects the minimum inter-onset interval (debounces close transients)', () => {
    const sampleRate = 8000
    // Two clicks 60 ms apart — with a 200 ms floor only one beat should survive.
    const sig = metronome([1.0, 1.06], sampleRate, 2)
    const beats = detectBeats(sig, sampleRate, { windowSize: 256, hopSize: 128, minIntervalSec: 0.2 })
    const inWindow = beats.filter((b) => b >= 0.9 && b <= 1.3)
    expect(inWindow.length).toBe(1)
  })

  it('is deterministic — identical input yields identical output', () => {
    const sampleRate = 8000
    const sig = metronome([0.5, 1.0, 1.5], sampleRate, 2)
    expect(detectBeats(sig, sampleRate)).toEqual(detectBeats(sig, sampleRate))
  })
})

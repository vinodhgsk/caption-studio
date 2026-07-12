/**
 * PURE beat detection (P8.11, Doc 11; skill `beat-sync`). Turns a mono PCM signal
 * into a list of BEAT/onset times (seconds) the timeline can snap to (P8.12) and the
 * ruler can mark. Deterministic + side-effect-free (no Math.random / Date / I/O) so
 * it is unit-testable against a synthetic metronome and gives identical results for
 * the same audio every run (preview = export reasoning).
 *
 * METHOD — short-time energy ONSET detection (a lightweight, dependency-free
 * spectral-flux analogue):
 *   1. Frame the signal into overlapping windows (`windowSize`, hop `hopSize`) and
 *      take each frame's RMS energy → an energy ENVELOPE.
 *   2. POSITIVE FLUX = the per-frame increase in energy (rises mark note/percussion
 *      onsets; decays are ignored).
 *   3. Pick PEAKS where the flux exceeds a LOCAL adaptive threshold (a moving mean of
 *      the flux × `sensitivity`) AND is a local maximum, gating out tiny ripples with
 *      a fraction of the global peak.
 *   4. Enforce a MINIMUM inter-onset interval so one transient yields one beat.
 *
 * This locks onto clear transients (claps, kicks, metronome clicks) well; it is not a
 * full tempo tracker, which is intentional — the feature snaps to detected onsets, it
 * does not infer a global BPM. A real beat-tracking provider can replace this behind
 * the same `number[]` (seconds) output later.
 */

/** Tunable parameters for {@link detectBeats}. All optional with sensible defaults. */
export interface BeatDetectOptions {
  /** Samples per analysis frame (energy window). Default 1024. */
  windowSize?: number
  /** Samples between successive frames (hop). Default 512. */
  hopSize?: number
  /** Minimum seconds between two detected beats (debounce). Default 0.18 (~333 BPM). */
  minIntervalSec?: number
  /**
   * Threshold multiplier over the local mean flux — higher = fewer, stronger beats.
   * Default 1.5.
   */
  sensitivity?: number
}

const DEFAULTS = {
  windowSize: 1024,
  hopSize: 512,
  minIntervalSec: 0.18,
  sensitivity: 1.5
} as const

/**
 * Detect beat/onset times (seconds, sorted ascending) in a mono PCM signal sampled at
 * `sampleRate` Hz. PURE + deterministic. Returns `[]` for an empty/too-short signal,
 * a non-positive sample rate, or when no transient clears the threshold.
 */
export function detectBeats(
  samples: ArrayLike<number>,
  sampleRate: number,
  opts: BeatDetectOptions = {}
): number[] {
  const windowSize = opts.windowSize ?? DEFAULTS.windowSize
  const hopSize = opts.hopSize ?? DEFAULTS.hopSize
  const minIntervalSec = opts.minIntervalSec ?? DEFAULTS.minIntervalSec
  const sensitivity = opts.sensitivity ?? DEFAULTS.sensitivity

  const n = samples.length
  if (n === 0 || sampleRate <= 0 || windowSize <= 0 || hopSize <= 0) return []
  if (n < windowSize) return []

  // 1. Energy envelope — RMS per frame.
  const numFrames = Math.floor((n - windowSize) / hopSize) + 1
  if (numFrames < 2) return []
  const energy = new Float64Array(numFrames)
  for (let f = 0; f < numFrames; f++) {
    const base = f * hopSize
    let sumSq = 0
    for (let i = 0; i < windowSize; i++) {
      const s = samples[base + i]
      sumSq += s * s
    }
    energy[f] = Math.sqrt(sumSq / windowSize)
  }

  // 2. Positive flux (energy increase vs the previous frame).
  const flux = new Float64Array(numFrames)
  let globalPeak = 0
  for (let f = 1; f < numFrames; f++) {
    const d = energy[f] - energy[f - 1]
    flux[f] = d > 0 ? d : 0
    if (flux[f] > globalPeak) globalPeak = flux[f]
  }
  if (globalPeak <= 0) return []

  // 3 + 4. Adaptive-threshold local-max peaks with a minimum inter-onset interval.
  // The local mean window spans ~0.3s of flux on each side (in frames).
  const meanRadius = Math.max(1, Math.round((0.3 * sampleRate) / hopSize))
  const minFloor = globalPeak * 0.1 // ignore ripples below 10% of the strongest onset
  const minFrameGap = (minIntervalSec * sampleRate) / hopSize

  const beats: number[] = []
  let lastBeatFrame = -Infinity
  for (let f = 1; f < numFrames - 1; f++) {
    const v = flux[f]
    if (v < minFloor) continue
    // Local mean of flux around f (adaptive threshold).
    let sum = 0
    let count = 0
    const lo = Math.max(0, f - meanRadius)
    const hi = Math.min(numFrames - 1, f + meanRadius)
    for (let k = lo; k <= hi; k++) {
      sum += flux[k]
      count++
    }
    const localMean = count > 0 ? sum / count : 0
    const threshold = localMean * sensitivity
    // Peak test: above threshold and a strict-ish local maximum.
    if (v >= threshold && v >= flux[f - 1] && v > flux[f + 1]) {
      if (f - lastBeatFrame >= minFrameGap) {
        // Frame center time → seconds.
        const sampleIndex = f * hopSize + windowSize / 2
        beats.push(sampleIndex / sampleRate)
        lastBeatFrame = f
      }
    }
  }
  return beats
}

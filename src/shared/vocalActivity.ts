/**
 * PURE vocal-activity detection (VAD) for lyrics-first forced alignment (Doc
 * `LYRICS_FIRST_FORCED_ALIGNMENT_CAPTIONING.md` §5.3, §9).
 *
 * Turns a mono PCM signal into a list of VOCAL REGIONS `{ start, end }` (seconds):
 * the intervals where a voice is actually singing, with the silent/instrumental
 * gaps between phrases excluded. The lyrics-first aligner snaps lyric lines onto
 * these regions instead of spreading text uniformly across the whole file, which
 * is what made timing drift on real songs (intro silence, breath pauses, held
 * notes, instrumental breaks).
 *
 * METHOD — short-time energy gating (a sibling of `beatDetect`'s onset detector):
 *   1. Frame the signal (`windowSize`, hop `hopSize`) and take each frame's RMS
 *      energy → an energy envelope.
 *   2. Derive an ADAPTIVE noise floor from a low percentile of frame energy, so
 *      quiet room tone / silence sits below threshold and sung notes sit above it.
 *   3. Mark frames above threshold as VOICED; merge contiguous voiced runs into
 *      regions.
 *   4. BRIDGE gaps shorter than `minGapSec` (a breath should not split one phrase).
 *   5. DROP regions shorter than `minRegionSec` (reject clicks/transients).
 *   6. Pad region edges by `padSec` so onsets/tails are not clipped.
 *
 * Deterministic + side-effect-free (no Math.random / Date / I/O), so it is
 * unit-testable against a synthetic tone-burst signal and yields identical output
 * for the same audio every run (preview = export reasoning).
 */

/** One interval (seconds) where vocals are present. */
export interface VocalRegion {
  start: number
  end: number
}

/** Tunable parameters for {@link detectVocalRegions}. All optional. */
export interface VocalActivityOptions {
  /** Samples per analysis frame (energy window). Default 1024. */
  windowSize?: number
  /** Samples between successive frames (hop). Default 512. */
  hopSize?: number
  /**
   * Percentile (0–1) of frame energy used as the silence baseline. Default 0.2
   * (20th percentile) — robust to a signal that is mostly voiced or mostly quiet.
   */
  floorPercentile?: number
  /**
   * Threshold = floor + `thresholdRatio` × (median − floor). Higher = stricter
   * (fewer, stronger voiced frames). Default 0.6.
   */
  thresholdRatio?: number
  /** Voiced gaps shorter than this (seconds) are bridged into one region. Default 0.35. */
  minGapSec?: number
  /** Regions shorter than this (seconds) are discarded as noise. Default 0.15. */
  minRegionSec?: number
  /** Symmetric padding (seconds) added to each region edge. Default 0.05. */
  padSec?: number
}

const DEFAULTS = {
  windowSize: 1024,
  hopSize: 512,
  floorPercentile: 0.2,
  thresholdRatio: 0.6,
  minGapSec: 0.35,
  minRegionSec: 0.15,
  padSec: 0.05
} as const

/** Value at a fractional percentile of an ascending-sortable copy of `arr`. */
function percentile(sorted: Float64Array, fraction: number): number {
  const n = sorted.length
  if (n === 0) return 0
  const idx = Math.min(n - 1, Math.max(0, Math.round(fraction * (n - 1))))
  return sorted[idx]
}

/**
 * Detect vocal regions (seconds, sorted, non-overlapping) in a mono PCM signal at
 * `sampleRate` Hz. PURE + deterministic. Returns `[]` for an empty/too-short
 * signal, a non-positive sample rate, or a signal with no energy above the floor
 * (pure silence). Callers treat `[]` as "no acoustic evidence" and fall back.
 */
export function detectVocalRegions(
  samples: ArrayLike<number>,
  sampleRate: number,
  opts: VocalActivityOptions = {}
): VocalRegion[] {
  const windowSize = opts.windowSize ?? DEFAULTS.windowSize
  const hopSize = opts.hopSize ?? DEFAULTS.hopSize
  const floorPercentile = opts.floorPercentile ?? DEFAULTS.floorPercentile
  const thresholdRatio = opts.thresholdRatio ?? DEFAULTS.thresholdRatio
  const minGapSec = opts.minGapSec ?? DEFAULTS.minGapSec
  const minRegionSec = opts.minRegionSec ?? DEFAULTS.minRegionSec
  const padSec = opts.padSec ?? DEFAULTS.padSec

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

  // 2. Adaptive threshold from the energy distribution. Interpolate between a
  // quiet baseline (low percentile) and a loud reference (90th percentile), and
  // never drop below a fraction of the global peak — otherwise a signal that is
  // mostly silence (median ≈ 0) would set the threshold to 0 and mark silence as
  // voiced. The comparison is strict so exact-zero silence never counts.
  const sorted = Float64Array.from(energy).sort()
  const globalPeak = sorted[sorted.length - 1]
  if (globalPeak <= 0) return []
  const quiet = percentile(sorted, floorPercentile)
  const loud = percentile(sorted, 0.9)
  const relThreshold = quiet + thresholdRatio * Math.max(0, loud - quiet)
  const threshold = Math.max(relThreshold, globalPeak * 0.1)

  // Frame-time helpers: use the frame's start time so region bounds line up with
  // the sample window (padding is applied after merging).
  const frameStartSec = (f: number): number => (f * hopSize) / sampleRate
  const frameEndSec = (f: number): number => (f * hopSize + windowSize) / sampleRate
  const totalSec = n / sampleRate

  // 3. Contiguous voiced runs → raw regions (frame indices).
  const raw: Array<{ start: number; end: number }> = []
  let runStart = -1
  for (let f = 0; f < numFrames; f++) {
    const voiced = energy[f] > threshold
    if (voiced && runStart < 0) {
      runStart = f
    } else if (!voiced && runStart >= 0) {
      raw.push({ start: frameStartSec(runStart), end: frameEndSec(f - 1) })
      runStart = -1
    }
  }
  if (runStart >= 0) raw.push({ start: frameStartSec(runStart), end: frameEndSec(numFrames - 1) })
  if (raw.length === 0) return []

  // 4. Bridge short gaps (breaths) between consecutive voiced runs.
  const bridged: Array<{ start: number; end: number }> = [raw[0]]
  for (let i = 1; i < raw.length; i++) {
    const prev = bridged[bridged.length - 1]
    const cur = raw[i]
    if (cur.start - prev.end < minGapSec) {
      prev.end = cur.end
    } else {
      bridged.push({ ...cur })
    }
  }

  // 5 + 6. Drop tiny regions, pad edges, clamp to [0, totalSec].
  const out: VocalRegion[] = []
  for (const r of bridged) {
    if (r.end - r.start < minRegionSec) continue
    const start = Math.max(0, r.start - padSec)
    const end = Math.min(totalSec, r.end + padSec)
    // Merge into the previous region if padding caused an overlap.
    const last = out[out.length - 1]
    if (last !== undefined && start <= last.end) {
      last.end = Math.max(last.end, end)
    } else {
      out.push({ start, end })
    }
  }
  return out
}

/** Total voiced time (seconds) across all regions. */
export function totalVocalDuration(regions: readonly VocalRegion[]): number {
  return regions.reduce((sum, r) => sum + Math.max(0, r.end - r.start), 0)
}

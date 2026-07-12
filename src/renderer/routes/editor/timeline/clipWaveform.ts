/**
 * Pure helpers for rendering a decoded {@link Waveform} INSIDE a timeline clip
 * block (P4.2 — Doc 02 "show waveform on the timeline").
 *
 * Constraint C (headless): NO DOM / React / electron imports — pure number-array
 * math so it is unit-testable in the vitest `node` env. The actual decode lives
 * in the impure `decodeWaveform`; the per-media cache lives in `waveformCache`.
 *
 * Two concerns live here:
 *  - `waveformCacheKey`: the stable per-media identity used to cache a decoded
 *    waveform so it is decoded ONCE per bundle+mediaRef (not on every render or
 *    scroll). The key is bundle-scoped because the same `mediaRef` ("media/x.mp3")
 *    can point at different files in different bundles.
 *  - `peaksForClip`: map the source-time window a clip exposes (`[in, out]`) onto
 *    the decoded peaks, then DOWNSAMPLE to the clip's rendered pixel width so the
 *    draw cost is bounded by on-screen size, not clip length or source resolution.
 */

import type { WaveformPeak } from './waveform'

/**
 * Stable cache key for a decoded waveform: the bundle path + the clip's
 * `mediaRef`, joined by `::`. Two clips referencing the same source file in the
 * same bundle share one decode; the same `mediaRef` in a different bundle is a
 * distinct key.
 */
export function waveformCacheKey(bundleAbs: string, mediaRef: string): string {
  return bundleAbs + '::' + mediaRef
}

/**
 * Slice + downsample decoded `peaks` (the WHOLE source) to exactly `targetCount`
 * peaks covering only the clip's exposed source window `[inSec, outSec]` within a
 * source of `sourceDurationSec`. This makes the rendered waveform follow trims
 * (left/right edge) AND keeps bar count bounded to the clip's pixel width.
 *
 * - `peaks` are evenly spaced over `[0, sourceDurationSec)`; we pick the source
 *   sub-range `[inSec, outSec]` and re-bucket it to `targetCount` even buckets.
 * - Aggregation is min/max so a downsampled bucket keeps the loudest excursion in
 *   its range (no amplitude is lost when many source peaks collapse into one bar).
 * - A bucket that maps to no source peak is flat (`{0,0}`), so degenerate inputs
 *   (zero/negative width, empty peaks) still return `targetCount` flat bars.
 *
 * Pure + deterministic.
 */
export function peaksForClip(
  peaks: readonly WaveformPeak[],
  sourceDurationSec: number,
  inSec: number,
  outSec: number,
  targetCount: number
): WaveformPeak[] {
  if (targetCount <= 0) return []
  const flat = (): WaveformPeak[] => {
    const out: WaveformPeak[] = new Array(targetCount)
    for (let i = 0; i < targetCount; i++) out[i] = { min: 0, max: 0 }
    return out
  }
  if (peaks.length === 0 || sourceDurationSec <= 0 || outSec <= inSec) return flat()

  // Map the source-time window onto fractional peak indices, clamped to range.
  const total = peaks.length
  const toIndex = (sec: number): number => {
    const frac = sec / sourceDurationSec
    return Math.min(total, Math.max(0, frac * total))
  }
  const lo = toIndex(inSec)
  const hi = toIndex(outSec)
  const span = hi - lo
  if (span <= 0) return flat()

  const out: WaveformPeak[] = new Array(targetCount)
  const per = span / targetCount
  for (let b = 0; b < targetCount; b++) {
    const begin = Math.floor(lo + b * per)
    const end = Math.min(total, Math.max(begin + 1, Math.floor(lo + (b + 1) * per)))
    let min = Infinity
    let max = -Infinity
    for (let i = begin; i < end; i++) {
      const p = peaks[i]
      if (p === undefined) continue
      if (p.min < min) min = p.min
      if (p.max > max) max = p.max
    }
    out[b] = min === Infinity ? { min: 0, max: 0 } : { min, max }
  }
  return out
}

/**
 * Bar count to render for a clip block `widthPx` wide, given a per-bar pixel
 * budget (`pxPerBar`). Clamped to `[1, maxBars]` so a sub-pixel-wide clip still
 * draws one bar and a very wide clip never explodes the bar count. Pure.
 */
export function barCountForWidth(
  widthPx: number,
  pxPerBar: number,
  maxBars: number
): number {
  if (pxPerBar <= 0) return Math.max(1, Math.min(maxBars, 1))
  const n = Math.round(widthPx / pxPerBar)
  return Math.max(1, Math.min(maxBars, n))
}

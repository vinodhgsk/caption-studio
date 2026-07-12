import type { Clip, ProjectTrack } from '../../../shared/storage'

/**
 * PURE mapping from a clip's persisted SOURCE-time beats (`clip.audio.beats`, in
 * media seconds) to TIMELINE seconds (P8.11/P8.12, Doc 11; skill `beat-sync`).
 *
 * A clip shows its source window `[in, out]` at timeline position `start`, so a beat
 * at source time `b` lands on the timeline at `start + (b - in)` — but ONLY when the
 * beat falls inside the trimmed window `in ≤ b ≤ out` (beats trimmed off the clip do
 * not appear). Because beats are stored in source time, moving (`start`) or trimming
 * (`in`/`out`) the clip re-maps them correctly with no re-detection.
 */
export function clipBeatTimelineTimes(clip: Clip): number[] {
  const beats = clip.audio?.beats
  if (beats === undefined || beats.length === 0) return []
  const out: number[] = []
  for (const b of beats) {
    if (b < clip.in || b > clip.out) continue
    out.push(clip.start + (b - clip.in))
  }
  return out
}

/**
 * Collect every clip's beats as DISTINCT, sorted TIMELINE-second markers across all
 * tracks (the snap-target + ruler-marker source for P8.12). Near-duplicate beats from
 * overlapping clips are merged within a 1 ms epsilon so the snapping target list stays
 * clean. PURE.
 */
export function collectBeatMarkers(tracks: readonly ProjectTrack[]): number[] {
  const all: number[] = []
  for (const track of tracks) {
    for (const clip of track.clips) {
      for (const t of clipBeatTimelineTimes(clip)) all.push(t)
    }
  }
  all.sort((a, b) => a - b)
  const EPS = 0.001
  const merged: number[] = []
  for (const t of all) {
    if (merged.length === 0 || t - merged[merged.length - 1] > EPS) merged.push(t)
  }
  return merged
}

/**
 * The beat NEAREST to `t` (timeline seconds) within `toleranceSec`, or `null` when the
 * closest beat is farther than the tolerance or there are no beats. PURE — used by beat
 * snapping (P8.12). `beats` need not be sorted.
 */
export function nearestBeat(
  beats: readonly number[],
  t: number,
  toleranceSec: number
): number | null {
  let best: number | null = null
  let bestDist = Infinity
  for (const b of beats) {
    const d = Math.abs(b - t)
    if (d < bestDist) {
      bestDist = d
      best = b
    }
  }
  return best !== null && bestDist <= toleranceSec ? best : null
}

/**
 * Snap a trim preview's moving EDGE to the nearest beat within `toleranceSec` (P8.12,
 * Doc 11; skill `beat-sync`). PURE — returns the input unchanged when no beat is in
 * range or the snap would make the clip invalid (`in < 0` or `start >= out`):
 *
 *   - `edge: 'start'` (left edge) moves `in` AND `start` together, so the timeline
 *     `start` is snapped to a beat and `in` shifts by the same delta (kept frames stay
 *     anchored).
 *   - `edge: 'end'` (right edge) snaps `out` to a beat.
 *
 * `beats` are TIMELINE seconds (e.g. from {@link collectBeatMarkers}).
 */
export function snapTrimEdgeToBeat(
  next: { in: number; out: number; start: number },
  edge: 'start' | 'end',
  beats: readonly number[],
  toleranceSec: number
): { in: number; out: number; start: number } {
  if (edge === 'start') {
    const beat = nearestBeat(beats, next.start, toleranceSec)
    if (beat === null) return next
    const adj = beat - next.start
    const candidate = { in: next.in + adj, out: next.out, start: beat }
    if (candidate.in < 0 || candidate.start >= candidate.out) return next
    return candidate
  }
  const beat = nearestBeat(beats, next.out, toleranceSec)
  if (beat === null || beat <= next.start) return next
  return { in: next.in, out: beat, start: next.start }
}

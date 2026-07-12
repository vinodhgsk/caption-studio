/**
 * Pure DRAG-TRIM clamp math for the timeline (P3.6).
 *
 * Constraint C (headless / determinism): NO DOM / React / electron imports and
 * NO Math.random / Date.now / performance.now — every function here is a pure,
 * node-importable map from inputs to outputs, unit-tested in `trim.test.ts`.
 *
 * This is the SINGLE source of truth for "given a clip edge and a requested
 * delta, what is the resulting in/out/start after clamping?". BOTH the pure
 * reducer (`trimClip`) and the UI live preview (`TimelineClip`) call
 * `clampTrim` so the preview a user sees and the value committed on pointerup
 * are computed by identical math (no drift).
 *
 * MEDIA-BOUNDS MODEL (P3.6):
 *   - LEFT edge ('start'): moving by Δ sets `in' = in + Δ` and `start' = start +
 *     Δ` together, so the kept frames stay anchored on the timeline. Clamps:
 *       • `in' >= 0` (cannot trim before the source's start), and because
 *         `start' = start + (in' - in)`, this also keeps `start' >= 0` whenever
 *         `start >= in` (true for imported clips where start>=0, in=0).
 *       • `out - in' >= MIN_CLIP_SEC` (cannot collapse below the minimum length),
 *         i.e. the left edge cannot pass `out - MIN_CLIP_SEC`.
 *   - RIGHT edge ('end'): moving by Δ sets `out' = out + Δ`. Clamps:
 *       • `out' - in >= MIN_CLIP_SEC` (minimum length).
 *       • UPPER bound = the source's intrinsic end. We do NOT know it yet
 *         (ffprobe lands in Phase 4), so when `sourceDurationSec` is undefined we
 *         allow `out'` to extend freely. When provided, `out' <= sourceDurationSec`.
 *         TODO(P4): always pass the probed source duration so the right edge is
 *         clamped to the real media end instead of extending freely.
 */

/**
 * Minimum clip length, in seconds: one frame at 30fps (~0.0333s). A clip can
 * never be trimmed shorter than this on either edge, so it always stays visible
 * and selectable. Documented constant (no magic numbers inline).
 */
export const MIN_CLIP_SEC = 1 / 30

/** Which edge of a clip a trim drag is adjusting. */
export type TrimEdge = 'start' | 'end'

/** The clip fields a trim reads/writes. Subset of `Clip` so this stays pure. */
export interface TrimBounds {
  in: number
  out: number
  start: number
}

/** The clamped result of a trim: the new in/out/start to apply. */
export interface TrimResult {
  in: number
  out: number
  start: number
}

/**
 * Clamp a requested trim of `edge` by `deltaSec` against the media-bounds model
 * above, returning the resulting in/out/start. Pure + deterministic.
 *
 * `sourceDurationSec` is the source's intrinsic length (Phase 4 / ffprobe). When
 * undefined the right edge may extend freely (today's case).
 */
export function clampTrim(
  bounds: TrimBounds,
  edge: TrimEdge,
  deltaSec: number,
  sourceDurationSec?: number
): TrimResult {
  const { in: srcIn, out: srcOut, start } = bounds

  if (edge === 'start') {
    // Left edge: in and start move together. Allowed window for in':
    //   lower = 0 (source start), upper = out - MIN_CLIP_SEC (min length).
    const requestedIn = srcIn + deltaSec
    const upper = srcOut - MIN_CLIP_SEC
    const nextIn = Math.min(Math.max(requestedIn, 0), upper)
    const appliedDelta = nextIn - srcIn
    return { in: nextIn, out: srcOut, start: start + appliedDelta }
  }

  // Right edge: only out moves. Allowed window for out':
  //   lower = in + MIN_CLIP_SEC (min length), upper = sourceDurationSec (if known).
  const requestedOut = srcOut + deltaSec
  const lower = srcIn + MIN_CLIP_SEC
  let nextOut = Math.max(requestedOut, lower)
  if (sourceDurationSec !== undefined) {
    nextOut = Math.min(nextOut, sourceDurationSec)
  }
  return { in: srcIn, out: nextOut, start }
}

/**
 * Frame-accuracy helpers (constraint A — single rAF playhead, fps-throttled).
 *
 * Pure, headless-safe (no DOM): reused by the timeline slice's playhead, the
 * P3.8 clock, and seek. Frame math is `frame = round(t * fps)` per the
 * timeline-engine skill — seek snaps to the nearest frame boundary.
 */

/** Convert a time in seconds to the nearest whole frame index at `fps`. */
export function secondsToFrame(t: number, fps: number): number {
  return Math.round(t * fps)
}

/** Convert a whole frame index back to its start time in seconds. */
export function frameToSeconds(frame: number, fps: number): number {
  return frame / fps
}

/** Snap an arbitrary time to the nearest frame boundary at `fps`. */
export function snapToFrame(t: number, fps: number): number {
  return frameToSeconds(secondsToFrame(t, fps), fps)
}

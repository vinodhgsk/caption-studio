/**
 * FPS throttle utility (P13.4 — Performance Pass).
 *
 * Pure: no DOM / electron imports. Uses `performance.now()` which is available
 * in both browser and Node ≥ 16 environments (via the global `performance`).
 */

/**
 * Returns `true` at most once per `1000 / fps` milliseconds, recording the
 * accepted timestamp in `lastTimestampRef.current`.
 *
 * Typical usage:
 * ```ts
 * const lastTs = useRef(0)
 * function onRaf(now: number) {
 *   if (!throttleToFps(30, lastTs)) return   // skip frame
 *   drawFrame()
 * }
 * ```
 *
 * @param fps - Target frames per second (must be > 0; treated as 1 when ≤ 0).
 * @param lastTimestampRef - Mutable ref holding the timestamp of the last
 *   accepted call. Initialise to `{ current: 0 }` before first use.
 * @returns `true` when this call is within the allowed time budget (i.e. the
 *   frame should be rendered), `false` when it should be skipped.
 */
export function throttleToFps(
  fps: number,
  lastTimestampRef: { current: number }
): boolean {
  const safeFps = fps > 0 ? fps : 1
  const intervalMs = 1000 / safeFps
  const now = performance.now()
  if (now - lastTimestampRef.current < intervalMs) return false
  lastTimestampRef.current = now
  return true
}

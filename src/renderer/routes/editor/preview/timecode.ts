/**
 * Pure timecode formatting for the transport bar (P3.10).
 *
 * Constraint C (headless): NO DOM / React imports — node-importable and
 * unit-tested in `timecode.test.ts`.
 */

import { secondsToFrame } from '@/store/timeline'

/**
 * Format a time (seconds) as `MM:SS:FF` where `FF` is the frame index within
 * the current second at `fps`. The total frame count is computed as
 * `round(seconds * fps)` (matching the frame-snap convention), then split into
 * minutes / seconds / frames so frame rollover never shows e.g. `00:00:30` at
 * 30 fps — it rolls to `00:01:00`. Negative inputs clamp to zero. A non-finite
 * or non-positive `fps` falls back to 30.
 */
export function formatTimecode(seconds: number, fps: number): string {
  const safeFps = Number.isFinite(fps) && fps > 0 ? Math.round(fps) : 30
  const totalFrames = Math.max(0, secondsToFrame(seconds, safeFps))

  const frames = totalFrames % safeFps
  const totalSeconds = Math.floor(totalFrames / safeFps)
  const secs = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60)

  return [minutes, secs, frames].map((n) => String(n).padStart(2, '0')).join(':')
}

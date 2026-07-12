/**
 * Pure time <-> pixel scale + ruler-tick helpers for the timeline (P3.2).
 *
 * Constraint C (headless): NO DOM / React / electron imports — this module is
 * node-importable and unit-tested in `scale.test.ts`. All timeline geometry math
 * lives here, never inline in JSX, so the same scale drives the ruler, the lanes,
 * and (later, P3.4) clip virtualization windows.
 */

import type { Clip } from '../../../../shared/project-schema'
import { clipDuration } from '../../../../shared/project-schema'
import type { ProjectTrack } from '../../../../shared/storage'

/** Convert a time in seconds to a horizontal pixel offset at `pxPerSec`. */
export function timeToPx(t: number, pxPerSec: number): number {
  return t * pxPerSec
}

/** Convert a horizontal pixel offset back to a time in seconds at `pxPerSec`. */
export function pxToTime(px: number, pxPerSec: number): number {
  return pxPerSec === 0 ? 0 : px / pxPerSec
}

/** Exact project duration (seconds) = the max clip end across all tracks. */
export function exactProjectDurationSec(tracks: readonly ProjectTrack[]): number {
  let max = 0
  for (const track of tracks) {
    for (const clip of track.clips) {
      const end = clipEndSec(clip)
      if (end > max) max = end
    }
  }
  return max
}

/**
 * Project duration (seconds) = the max clip end across all tracks, floored at
 * `minSec` so an empty project still shows a usable ruler. A clip ends at
 * `start + (out - in)`.
 */
export function projectDurationSec(tracks: readonly ProjectTrack[], minSec = 10): number {
  return Math.max(exactProjectDurationSec(tracks), minSec)
}

/**
 * Duration to RENDER on the timeline: use the exact media span once clips exist,
 * otherwise fall back to a small empty-project ruler.
 */
export function timelineRenderDurationSec(
  tracks: readonly ProjectTrack[],
  emptySec = 10
): number {
  const exact = exactProjectDurationSec(tracks)
  return exact > 0 ? exact : emptySec
}

/** On-timeline end time (seconds) of a clip: `start + (out - in)`. */
export function clipEndSec(clip: Clip): number {
  return clip.start + clipDuration(clip)
}

/** A single ruler tick: its time (seconds), pixel offset, and whether it is major. */
export interface Tick {
  /** Time of the tick, in seconds. */
  t: number
  /** Pixel offset of the tick at the active `pxPerSec`. */
  px: number
  /** Major ticks carry a time label; minor ticks are bare lines. */
  major: boolean
}

/** "Nice" tick intervals (seconds) we choose from, ascending. */
const NICE_INTERVALS_SEC = [
  1 / 60, 1 / 30, 1 / 24, 1 / 10, 1 / 5, 1 / 2, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600
] as const

/** Aim for roughly this many pixels between minor ticks before stepping up. */
const TARGET_MINOR_PX = 80

/**
 * Pick a "nice" minor tick interval (seconds) so ticks are ~`TARGET_MINOR_PX`
 * apart at the current `pxPerSec`. Below 1s, never go finer than one frame at
 * `fps` (so high zoom shows frame-sensible spacing, not arbitrary sub-frames).
 */
export function chooseTickIntervalSec(pxPerSec: number, fps: number): number {
  const frameSec = fps > 0 ? 1 / fps : 1 / 30
  const minInterval = Math.max(frameSec, NICE_INTERVALS_SEC[0])
  for (const interval of NICE_INTERVALS_SEC) {
    if (interval < minInterval) continue
    if (timeToPx(interval, pxPerSec) >= TARGET_MINOR_PX) return interval
  }
  return NICE_INTERVALS_SEC[NICE_INTERVALS_SEC.length - 1]
}

/**
 * Generate ruler ticks from 0 to `durationSec` (inclusive of the final boundary).
 * Every 5th minor tick is promoted to major (label-bearing). Pure + deterministic
 * so it is unit-tested in node.
 */
export function generateTicks(
  durationSec: number,
  pxPerSec: number,
  fps: number
): Tick[] {
  const interval = chooseTickIntervalSec(pxPerSec, fps)
  if (interval <= 0 || durationSec <= 0) return [{ t: 0, px: 0, major: true }]

  const ticks: Tick[] = []
  const count = Math.floor(durationSec / interval + 1e-9)
  for (let i = 0; i <= count; i++) {
    const t = i * interval
    ticks.push({ t, px: timeToPx(t, pxPerSec), major: i % 5 === 0 })
  }
  return ticks
}

/** Format a tick time as `m:ss` (>= 1 min), `s.s` (sub-minute, sub-second steps), or whole `s`. */
export function formatTickLabel(t: number): string {
  if (t >= 60) {
    const minutes = Math.floor(t / 60)
    const seconds = Math.round(t - minutes * 60)
    return `${minutes}:${String(seconds).padStart(2, '0')}`
  }
  // Show one decimal only when the value is not a whole second.
  if (Math.abs(t - Math.round(t)) > 1e-6) return `${t.toFixed(1)}s`
  return `${Math.round(t)}s`
}

/** Inclusive visible time window (seconds) for a horizontal scroll viewport. */
export interface ViewWindow {
  startSec: number
  endSec: number
}

/**
 * Visible time window for a lane given its horizontal `scrollLeft` and the
 * `viewportPx` width, at the active `pxPerSec`. This is the seam P3.4 reads to
 * virtualize clips (`visibleClips(track, window)`) — it intentionally lives in a
 * pure helper so the lane component only wires scroll/size into it.
 */
export function visibleWindow(
  scrollLeftPx: number,
  viewportPx: number,
  pxPerSec: number
): ViewWindow {
  return {
    startSec: pxToTime(scrollLeftPx, pxPerSec),
    endSec: pxToTime(scrollLeftPx + viewportPx, pxPerSec)
  }
}

/**
 * Map a pointer's viewport clientX to a time on the timeline (seconds) for
 * scrubbing (P3.8). `clientX` is the pointer's viewport x; `rectLeft` is the
 * scroll container's `getBoundingClientRect().left`; `scrollLeftPx` is the
 * container's current horizontal scroll. The local content x is
 * `(clientX - rectLeft) + scrollLeftPx`, then converted with `pxToTime`. The
 * result is floored at 0; frame-snapping is applied by the caller (`seek`).
 */
export function pointerToTime(
  clientX: number,
  rectLeft: number,
  scrollLeftPx: number,
  pxPerSec: number
): number {
  const localX = clientX - rectLeft + scrollLeftPx
  return Math.max(0, pxToTime(localX, pxPerSec))
}

/** Clamp a candidate `pxPerSec` zoom into the timeline's allowed range. */
export function clampZoom(pxPerSec: number): number {
  return Math.min(ZOOM_MAX_PX_PER_SEC, Math.max(ZOOM_MIN_PX_PER_SEC, pxPerSec))
}

/**
 * Pixels-per-second so the whole project (`durationSec`) fits a viewport of
 * `viewportPx` width (P3.10 zoom-to-fit), clamped into the allowed zoom range.
 * Guards against a zero/negative duration or viewport (returns the min zoom so
 * the result is always a valid, usable scale).
 */
export function zoomToFitPxPerSec(durationSec: number, viewportPx: number): number {
  if (durationSec <= 0 || viewportPx <= 0) return ZOOM_MIN_PX_PER_SEC
  return clampZoom(viewportPx / durationSec)
}

/**
 * Timeline default visible window (seconds): cap at `defaultWindowSec` but when
 * the total timeline is shorter, show the whole timeline.
 */
export function defaultVisibleWindowSec(
  totalDurationSec: number,
  defaultWindowSec: number
): number {
  if (defaultWindowSec <= 0) return 0
  if (totalDurationSec > 0 && totalDurationSec <= defaultWindowSec) return totalDurationSec
  return defaultWindowSec
}

/** Label for the current auto-view mode shown in the timeline toolbar. */
export function autoViewModeLabel(totalDurationSec: number, emptyLabel = '6m'): string {
  return totalDurationSec > 0 ? 'Fit media' : emptyLabel
}

/** Minimum timeline zoom (px per second) — very zoomed out. */
export const ZOOM_MIN_PX_PER_SEC = 1
/** Maximum timeline zoom (px per second) — very zoomed in. */
export const ZOOM_MAX_PX_PER_SEC = 400

/**
 * Timeline clip-virtualization visibility check (P13.4 — Performance Pass).
 *
 * Returns `true` when the clip's time range `[clipStart, clipEnd)` overlaps the
 * current scroll viewport `[viewportStart, viewportEnd]`. A clip is visible as
 * long as it starts before the viewport ends AND ends after the viewport starts
 * (open-interval check on the clip end so a zero-length clip at exactly the
 * viewport edge is still treated as invisible from the right side).
 *
 * Pure: no DOM / React / electron imports — unit-testable in node.
 *
 * @param clipStart    - Clip's timeline start, in seconds.
 * @param clipEnd      - Clip's timeline end (`start + duration`), in seconds.
 * @param viewportStart - Left edge of the visible window, in seconds.
 * @param viewportEnd   - Right edge of the visible window, in seconds.
 */
export function isClipVisible(
  clipStart: number,
  clipEnd: number,
  viewportStart: number,
  viewportEnd: number
): boolean {
  return clipStart < viewportEnd && clipEnd > viewportStart
}

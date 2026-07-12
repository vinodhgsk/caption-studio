/**
 * Pure drag-move SNAPPING math for the timeline (P3.5).
 *
 * Constraint C (headless / determinism): NO DOM / React / electron imports and
 * NO Math.random / Date.now / performance.now — every function here is a pure,
 * node-importable map from inputs to outputs, unit-tested in `snapping.test.ts`.
 * All pixel<->second conversion and snap selection lives here so the dragging
 * component (`TimelineClip`) only wires pointer events and never does math in JSX.
 *
 * Snap targets considered for a dragged clip:
 *   - the playhead time,
 *   - EVERY OTHER clip's start AND end across ALL tracks (the moving clip is
 *     excluded so it never snaps to itself),
 *   - any markers (accepted as an array; defaults to [] until markers land).
 *
 * Decision (documented): we gather targets from ALL tracks, not just the moving
 * clip's own track. CapCut-style editors let a clip align to edges on other lanes
 * (e.g. an overlay snapping to the cut beneath it), which is the more useful
 * behaviour and avoids a per-track gather seam in the component.
 */

import type { ProjectTrack } from '../../../../shared/storage'
import { clipEndSec } from './scale'

/** A single resolved snap: which target time was hit and the resulting clip start. */
export interface SnapResult {
  /** The (possibly snapped) clip start, in seconds. */
  start: number
  /** The target time that was snapped to, or `null` when no snap applied. */
  snappedTo: number | null
}

/**
 * Gather candidate snap-target times (seconds) from the project, EXCLUDING the
 * moving clip so it cannot snap to its own edges. Targets are every other clip's
 * `start` and `end` (across all tracks), the `playhead`, and all `markers`.
 *
 * The result is intentionally unsorted and may contain duplicates — `snapStart`
 * only cares about the nearest within tolerance, so de-duping would be wasted
 * work. Pure + deterministic.
 */
export function gatherSnapTargets(
  tracks: readonly ProjectTrack[],
  playhead: number,
  movingClipId: string,
  markers: readonly number[] = []
): number[] {
  const targets: number[] = [playhead]
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (clip.id === movingClipId) continue
      targets.push(clip.start)
      targets.push(clipEndSec(clip))
    }
  }
  for (const m of markers) targets.push(m)
  return targets
}

/**
 * Snap a dragged clip's START to the nearest target within `snapPx`.
 *
 * Both the clip's START and its END (`start + duration`) are tested against
 * every target; the closest match (by absolute pixel distance) wins. When the
 * END snaps to a target `T`, the resulting start is `T - duration`. The tolerance
 * is expressed in pixels and converted to seconds via `pxPerSec`, so the snap
 * "feel" is constant on screen at any zoom.
 *
 * Returns the (possibly snapped) start and the target time that was hit (for
 * drawing a guide line), or `{ start: candidateStartSec, snappedTo: null }` when
 * nothing is within tolerance. Pure — no clamping happens here (the caller owns
 * `start >= 0`), so snapping and clamping stay independently testable.
 */
export function snapStart(
  candidateStartSec: number,
  clipDurationSec: number,
  snapTargetsSec: readonly number[],
  snapPx: number,
  pxPerSec: number
): SnapResult {
  if (pxPerSec <= 0 || snapPx <= 0 || snapTargetsSec.length === 0) {
    return { start: candidateStartSec, snappedTo: null }
  }

  const toleranceSec = snapPx / pxPerSec
  const candidateEndSec = candidateStartSec + clipDurationSec

  let bestStart = candidateStartSec
  let bestTarget: number | null = null
  let bestDistSec = toleranceSec

  for (const target of snapTargetsSec) {
    // Start-side candidate: align the clip's left edge to the target.
    const startDist = Math.abs(target - candidateStartSec)
    if (startDist <= bestDistSec) {
      bestDistSec = startDist
      bestStart = target
      bestTarget = target
    }
    // End-side candidate: align the clip's right edge to the target.
    const endDist = Math.abs(target - candidateEndSec)
    if (endDist < bestDistSec) {
      bestDistSec = endDist
      bestStart = target - clipDurationSec
      bestTarget = target
    }
  }

  return { start: bestStart, snappedTo: bestTarget }
}

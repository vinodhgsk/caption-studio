/**
 * Pure alignment-snap math for canvas drag-to-move (P3.11, Doc 01).
 *
 * NO DOM / electron import — pure data transformation so it unit-tests in the
 * vitest `node` env and is reusable by the interaction overlay.
 *
 * `transform.x` / `transform.y` are CENTER-RELATIVE offsets in project-resolution
 * units (see `computeDrawTransform`: the clip center is drawn at
 * `resolution/2 + transform.{x,y}`). Snapping therefore reasons about where the
 * clip's CENTER lands relative to the canvas, and snaps the offset so the center
 * aligns to the canvas center, edges, or quarter (half-of-center) lines.
 */

/** A guide line identifier. Vertical guides constrain X, horizontal constrain Y. */
export type SnapGuideId =
  | 'cx' // canvas center, vertical line  (x offset → 0)
  | 'cy' // canvas center, horizontal line (y offset → 0)
  | 'left' // clip center on the left edge
  | 'right' // clip center on the right edge
  | 'top' // clip center on the top edge
  | 'bottom' // clip center on the bottom edge
  | 'qx-left' // left quarter (x = -resolution.w/4)
  | 'qx-right' // right quarter
  | 'qy-top' // top quarter
  | 'qy-bottom' // bottom quarter

/** Result of snapping a candidate center-offset: the snapped offset + hit guides. */
export interface SnapResult {
  x: number
  y: number
  guides: SnapGuideId[]
}

/** A single candidate snap target on one axis: the offset value + its guide id. */
interface AxisTarget {
  value: number
  guide: SnapGuideId
}

/**
 * Snap a candidate center-offset `{x, y}` to canvas alignment lines when within
 * `thresholdCanvasPx` (in project-resolution units). Each axis is snapped
 * INDEPENDENTLY to its nearest in-threshold target; the closest target wins per
 * axis. Returns the snapped offset and the list of guide ids that were engaged
 * (empty when nothing snapped).
 *
 * `clipSize` ([w,h] of the drawn clip in canvas units) is accepted for future
 * edge-of-clip snapping; the current targets are canvas-relative (center/edges/
 * quarters), which is robust regardless of clip size.
 *
 * Targets (x):  0 (center), ±w/2 (edges), ±w/4 (quarters).
 * Targets (y):  0 (center), ±h/2 (edges), ±h/4 (quarters).
 */
export function snapTransformXY(
  candidate: { x: number; y: number },
  clipSize: readonly [number, number],
  resolution: readonly [number, number],
  thresholdCanvasPx: number
): SnapResult {
  void clipSize
  const [resW, resH] = resolution

  const xTargets: AxisTarget[] = [
    { value: 0, guide: 'cx' },
    { value: -resW / 2, guide: 'left' },
    { value: resW / 2, guide: 'right' },
    { value: -resW / 4, guide: 'qx-left' },
    { value: resW / 4, guide: 'qx-right' }
  ]
  const yTargets: AxisTarget[] = [
    { value: 0, guide: 'cy' },
    { value: -resH / 2, guide: 'top' },
    { value: resH / 2, guide: 'bottom' },
    { value: -resH / 4, guide: 'qy-top' },
    { value: resH / 4, guide: 'qy-bottom' }
  ]

  const guides: SnapGuideId[] = []
  const snappedX = snapAxis(candidate.x, xTargets, thresholdCanvasPx)
  const snappedY = snapAxis(candidate.y, yTargets, thresholdCanvasPx)
  if (snappedX !== null) guides.push(snappedX.guide)
  if (snappedY !== null) guides.push(snappedY.guide)

  return {
    x: snappedX === null ? candidate.x : snappedX.value,
    y: snappedY === null ? candidate.y : snappedY.value,
    guides
  }
}

/** Snap a value to its nearest in-threshold target, or null when none qualifies. */
function snapAxis(
  value: number,
  targets: readonly AxisTarget[],
  threshold: number
): AxisTarget | null {
  let best: AxisTarget | null = null
  let bestDist = threshold
  for (const target of targets) {
    const dist = Math.abs(value - target.value)
    if (dist <= bestDist) {
      bestDist = dist
      best = target
    }
  }
  return best
}

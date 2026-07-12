/**
 * Pure layer-ordering math (P3.13, Doc 01) for the `transform.z` key.
 *
 * NO DOM / store import — every helper here is a pure number transform so it
 * unit-tests in the vitest `node` env and is reused by both the UI controls and
 * (potentially) headless tooling.
 *
 * COMPETITION SCOPE — SAME TRACK ONLY:
 *   The compositor (`visibleClipsAt`) sorts the draw list by TRACK ORDER first,
 *   then by `transform.z`. Cross-track stacking is therefore FIXED by track
 *   order and `z` can only reorder clips WITHIN the same track's draw grouping.
 *   So "bring forward / send back" operates on the OTHER clips on the SAME
 *   TRACK as the selected clip — `peerZs` is the list of those peers' z values
 *   (the selected clip's own z is NOT included). This matches the intuitive
 *   CapCut behaviour: raising a clip only changes its order relative to clips it
 *   actually overlaps in the same layer band.
 *
 * Z-RUNAWAY: we keep it simple with a ±1 relative step. `bringForward` /
 * `sendBackward` step PAST the nearest peer (peer ± 1), and the to-front /
 * to-back helpers use max+1 / min-1. Because each move is computed relative to
 * the current peer set (not an ever-growing global counter) and the helpers
 * no-op when already at the extreme, z stays bounded by the number of clips on
 * the track — no unbounded growth from repeated clicks at an extreme.
 */

/** Step between adjacent z layers. Integer keeps z values clean/stable. */
const Z_STEP = 1

/**
 * New z to bring `currentZ` one layer FORWARD (towards the front / drawn later).
 * Finds the nearest peer strictly above `currentZ` and returns just above it.
 * No-op (returns `currentZ`) when there are no peers above (already on top).
 */
export function bringForwardZ(currentZ: number, peerZs: readonly number[]): number {
  const above = peerZs.filter((z) => z > currentZ)
  if (above.length === 0) return currentZ // already frontmost among peers
  const nearestAbove = Math.min(...above)
  return nearestAbove + Z_STEP
}

/**
 * New z to send `currentZ` one layer BACKWARD (towards the back / drawn first).
 * Finds the nearest peer strictly below `currentZ` and returns just below it.
 * No-op (returns `currentZ`) when there are no peers below (already at back).
 */
export function sendBackwardZ(currentZ: number, peerZs: readonly number[]): number {
  const below = peerZs.filter((z) => z < currentZ)
  if (below.length === 0) return currentZ // already backmost among peers
  const nearestBelow = Math.max(...below)
  return nearestBelow - Z_STEP
}

/**
 * New z to bring the clip ALL THE WAY to the front: above every peer.
 * Returns `max(peerZs) + step`, or `0` when there are no peers (single clip → a
 * stable neutral z; effectively a no-op for stacking).
 */
export function bringToFrontZ(peerZs: readonly number[]): number {
  if (peerZs.length === 0) return 0
  return Math.max(...peerZs) + Z_STEP
}

/**
 * New z to send the clip ALL THE WAY to the back: below every peer.
 * Returns `min(peerZs) - step`, or `0` when there are no peers (single clip).
 */
export function sendToBackZ(peerZs: readonly number[]): number {
  if (peerZs.length === 0) return 0
  return Math.min(...peerZs) - Z_STEP
}

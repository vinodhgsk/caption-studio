/**
 * Pure rotation math for the canvas rotation handle (P3.12, Doc 01).
 *
 * NO DOM / electron import — pure data transforms so they unit-test in the
 * vitest `node` env and are reusable by the interaction overlay AND by
 * rotation-aware hit-testing.
 *
 * `transform.rotation` is stored in DEGREES (computeDrawTransform converts
 * deg→rad). Canvas `ctx.rotate(theta)` is CLOCKWISE-positive in screen space
 * (y grows downward), so the angle helpers here adopt the SAME convention: an
 * angle measured from the +x axis turning toward +y (down) is positive.
 */

/** Normalize an angle in degrees into the half-open range [0, 360). */
export function normalizeDeg(deg: number): number {
  const m = deg % 360
  return m < 0 ? m + 360 : m
}

/**
 * Angle in DEGREES from a center point (`cx`,`cy`) to a point (`px`,`py`),
 * measured from the +x axis turning toward +y (clockwise on screen, matching
 * `ctx.rotate`). Normalized to [0, 360). Straight right = 0, down = 90, left =
 * 180, up = 270.
 */
export function angleFromCenterDeg(cx: number, cy: number, px: number, py: number): number {
  const rad = Math.atan2(py - cy, px - cx)
  return normalizeDeg((rad * 180) / Math.PI)
}

/**
 * Snap an angle (degrees) to the nearest multiple of `stepDeg` when `stepDeg`
 * is positive; otherwise return the angle normalized only. The result is
 * normalized to [0, 360). A step of 0 (or negative) means "no snap".
 */
export function snapRotationDeg(deg: number, stepDeg: number): number {
  if (stepDeg <= 0) return normalizeDeg(deg)
  return normalizeDeg(Math.round(deg / stepDeg) * stepDeg)
}

/**
 * Rotate a point (`px`,`py`) by `-deg` about a center (`cx`,`cy`): i.e. map a
 * screen-space point INTO the clip's local (un-rotated) frame so an
 * axis-aligned bounds test can be applied. Uses the same clockwise-positive
 * convention as `ctx.rotate`; the inverse rotation is therefore counter the
 * stored rotation.
 */
export function rotatePointInverse(
  px: number,
  py: number,
  cx: number,
  cy: number,
  deg: number
): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = px - cx
  const dy = py - cy
  // Inverse of [cos -sin; sin cos] is [cos sin; -sin cos] (rotate by -deg).
  return {
    x: cx + dx * cos + dy * sin,
    y: cy - dx * sin + dy * cos
  }
}

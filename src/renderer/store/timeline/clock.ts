/**
 * Pure clock math for the single rAF playhead (P3.8, constraint A).
 *
 * Headless-safe (no DOM / rAF / React): the rAF hook owns the loop and timing;
 * this module owns the arithmetic so it is unit-testable in node. Advancing the
 * playhead is just "add elapsed wall-clock seconds, clamp at the project end".
 */

/** Result of advancing the playhead by a wall-clock delta. */
export interface Advance {
  /** New playhead time, in seconds (never past `durationSec`). */
  next: number
  /** True once the playhead reaches/exceeds the duration (clock should pause). */
  atEnd: boolean
}

/**
 * Advance `prev` (seconds) by `deltaSec` of real elapsed time, clamped to
 * `[0, durationSec]`. Reports `atEnd` when the result lands at or past the
 * duration so the caller pauses without overshooting. A non-positive or
 * non-finite delta leaves the playhead unchanged.
 */
export function advancePlayhead(prev: number, deltaSec: number, durationSec: number): Advance {
  const safeDelta = Number.isFinite(deltaSec) && deltaSec > 0 ? deltaSec : 0
  const raw = prev + safeDelta
  if (raw >= durationSec) return { next: durationSec, atEnd: true }
  return { next: raw, atEnd: false }
}

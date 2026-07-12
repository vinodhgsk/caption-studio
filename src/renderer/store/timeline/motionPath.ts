/**
 * Pure MOTION-PATH sampler (P8.8 — Doc 11; skill `keyframe-engine`).
 *
 * The user DRAWS a path on the preview; the capture records its vertices into
 * `clip.motionPath = { points, closed?, ease? }` (canvas px). THIS module is the
 * pure EVALUATOR: given that path and a clip-local PROGRESS `p ∈ [0,1]`, it returns
 * the {x,y} OFFSET the clip should sit at, so the clip travels ALONG the drawn path
 * over its duration (req. 2 + req. 3).
 *
 * PARAMETERIZATION — ARC LENGTH (even speed): a naive "lerp the i-th segment by
 * `p * segmentCount`" makes the clip SPEED UP over long segments and CRAWL over
 * short ones (each segment gets equal TIME regardless of LENGTH). Instead we walk
 * the polyline by DISTANCE: we precompute the cumulative length to each vertex and,
 * for a target distance `p * totalLength`, find the bracketing segment and lerp
 * within it. So equal increments of `p` cover equal DISTANCE — the clip moves at a
 * constant speed along the path, which is what a hand-drawn motion path expects.
 *
 * PATH TYPE: a POLYLINE (straight lines between captured points). A hand-drawn
 * stroke is already densely sampled, so linear interpolation between its points is
 * visually smooth; arc-length parameterization is exact for a polyline (closed-form
 * segment lengths), which keeps the sampler deterministic + cheap. (A Catmull-Rom
 * spline could smooth a SPARSE control polygon; we chose the polyline because the
 * draw capture is dense and the math stays exact + testable. Smoothing is a future
 * pre-pass that resamples `points` before this sampler — the sampler is unchanged.)
 *
 * EASING: `path.ease` (a shared {@link EasingName}, default `linear`) warps PROGRESS
 * before the arc-length lookup, so the clip can ease IN/OUT along the path (slow
 * start/finish) without changing the geometry. `ease('linear', p) === p`, so an
 * un-eased path samples by raw progress.
 *
 * EDGE CASES (req. 5):
 *   - absent / empty points → `null` (caller treats as identity: no offset).
 *   - single point          → that point, constant for all progress.
 *   - 2 points              → a straight lerp (the degenerate arc-length case).
 *   - zero total length (all points coincident) → the first point.
 *   - closed path           → an extra closing segment (last→first) is walked, so
 *                             `p=1` returns to the FIRST point (the loop wraps).
 * Progress is CLAMPED to [0,1] (caller may pass raw `localTime/duration`).
 *
 * HEADLESS-SAFE + PURE: no DOM / canvas / electron / node / Date. The preview, a
 * vitest engine, and the export path sample identically (preview = export).
 */
import type { ClipMotionPath, MotionPathPoint } from '../../../shared/project-schema'
import { ease, lerp, clamp01, type EasingSpec } from '../../../shared/easing'

/** Euclidean distance between two points. */
function dist(a: MotionPathPoint, b: MotionPathPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * The ordered vertex list to walk for a path: the raw `points`, plus the first
 * point appended again when `closed` so the closing segment (last→first) is part
 * of the arc length and `p=1` lands back at the start. PURE.
 */
function pathVertices(path: ClipMotionPath): MotionPathPoint[] {
  const pts = path.points
  if (path.closed === true && pts.length >= 2) {
    return [...pts, pts[0]]
  }
  return pts.slice()
}

/**
 * Cumulative arc length to each vertex (`cumulative[i]` = distance from vertex 0 to
 * vertex `i` along the polyline). `cumulative[0] === 0`; the last entry is the total
 * path length. PURE.
 */
export function cumulativeLengths(vertices: readonly MotionPathPoint[]): number[] {
  const out: number[] = new Array(vertices.length)
  let acc = 0
  out[0] = 0
  for (let i = 1; i < vertices.length; i++) {
    acc += dist(vertices[i - 1], vertices[i])
    out[i] = acc
  }
  return out
}

/**
 * The total arc length of a motion path (0 for an absent / single-point / coincident
 * path). Exported for tests + UI (path-length readouts). PURE.
 */
export function motionPathLength(path: ClipMotionPath | undefined): number {
  if (path === undefined || path.points.length < 2) return 0
  const verts = pathVertices(path)
  const cum = cumulativeLengths(verts)
  return cum[cum.length - 1]
}

/**
 * PURE motion-path sampler: the {x,y} position at clip-local progress `p ∈ [0,1]`,
 * ARC-LENGTH parameterized so the clip moves at EVEN speed along the drawn polyline,
 * with optional `path.ease` warping progress first.
 *
 *   - `p=0` → the FIRST point; `p=1` → the LAST point (open) / the FIRST again (closed).
 *   - interior `p` → the point at arc-length `ease(path.ease, p) * totalLength`.
 *
 * Returns `null` when there is no path / no points (the caller treats `null` as the
 * identity offset {0,0}). A single point is constant; a zero-length path is its first
 * point. The returned x/y are an ADDITIVE translate offset (canvas px). Deterministic.
 */
export function sampleMotionPath(
  path: ClipMotionPath | undefined,
  p: number
): MotionPathPoint | null {
  if (path === undefined) return null
  const verts = pathVertices(path)
  const n = verts.length
  if (n === 0) return null
  if (n === 1) return { x: verts[0].x, y: verts[0].y }

  const cum = cumulativeLengths(verts)
  const total = cum[n - 1]
  // All points coincident (zero length) → sit at the first point for all progress.
  if (!(total > 0)) return { x: verts[0].x, y: verts[0].y }

  // Warp progress by the path easing (default linear), then clamp to [0,1].
  const eased = ease((path.ease ?? 'linear') as EasingSpec, clamp01(p))
  const target = eased * total

  // Clamp the ends exactly (avoids float drift past the last vertex).
  if (target <= 0) return { x: verts[0].x, y: verts[0].y }
  if (target >= total) return { x: verts[n - 1].x, y: verts[n - 1].y }

  // Find the segment [i, i+1] whose cumulative span contains `target`.
  let i = 0
  while (i < n - 1 && cum[i + 1] < target) i++
  const segStart = cum[i]
  const segLen = cum[i + 1] - segStart
  const a = verts[i]
  const b = verts[i + 1]
  // Degenerate (zero-length) segment — snap to its end (no division by zero).
  if (!(segLen > 0)) return { x: b.x, y: b.y }
  const localT = (target - segStart) / segLen
  return {
    x: lerp(a.x, b.x, localT),
    y: lerp(a.y, b.y, localT)
  }
}

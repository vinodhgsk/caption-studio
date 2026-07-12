/**
 * Pure compositor math (P3.9, preview-compositor skill).
 *
 * NO DOM / electron import — every function here is a pure transformation of
 * data so it unit-tests in the vitest `node` env AND is reusable headless for
 * export (parity contract: the same pipeline, no preview-only shortcuts).
 *
 * The drawing surface (`PreviewCanvas.tsx`) consumes these helpers; it owns the
 * imperative `<canvas>` / `<video>` side-effects, this module owns the math.
 */
import type { Clip, ClipTransform } from '../../../../shared/project-schema'
import { clipDuration } from '../../../../shared/project-schema'
import type { ProjectTrack } from '../../../../shared/storage'
import { rotatePointInverse } from './rotate'

/** Visual track types the compositor draws. Audio is never drawn. */
const DRAWN_TRACK_TYPES: ReadonlySet<ProjectTrack['type']> = new Set(['video', 'text', 'effect'])

/** A clip plus the track it belongs to, in resolved draw order. */
export interface DrawItem {
  clip: Clip
  track: ProjectTrack
  /** Index of the track in the project (lower = drawn first / further back). */
  trackIndex: number
}

/**
 * Collect the clips visible at playhead time `t`, in DRAW order.
 *
 * Visibility: `start <= t < start + dur` where `dur = out - in`. Audio tracks
 * are excluded (not drawn). Ordering is track order first (earlier tracks draw
 * behind), then `transform.z` within/across the flattened set (higher z =
 * front). The returned list is back-to-front so the canvas paints in order.
 *
 * TRANSITION INTEGRATION POINT (P9.1): When two adjacent clips on the same
 * track overlap in the transition window, the canvas draw loop should:
 *   1. Detect the overlap: clipA.start + clipDuration(clipA) > clipB.start
 *   2. Resolve the transition ref: `resolveTransition(clipA.transitions?.out)`
 *   3. Call `evaluateTransition({ ref, clipAEnd: clipA.start + dur, t })` to
 *      get a `TransitionSample`.
 *   4. Apply `sample.aOpacity` / `sample.aTx` / `sample.aTy` / `sample.aScale`
 *      to clip A's draw call (via `ctx.globalAlpha` + `ctx.translate` + `ctx.scale`),
 *      and the `b*` fields to clip B's draw call.
 *
 * This pure evaluator + the xfade mapping in `transitionExport.ts` together
 * form the parity guarantee: preview and export apply the same blend logic.
 * Full canvas compositing (saving/restoring context state per clip) is out of
 * scope for this phase; the evaluator is the source of truth.
 */
export function visibleClipsAt(tracks: readonly ProjectTrack[], t: number): DrawItem[] {
  const items: DrawItem[] = []
  tracks.forEach((track, trackIndex) => {
    if (!DRAWN_TRACK_TYPES.has(track.type)) return
    for (const clip of track.clips) {
      const dur = clipDuration(clip)
      if (t >= clip.start && t < clip.start + dur) {
        items.push({ clip, track, trackIndex })
      }
    }
  })

  // Stable back-to-front sort: track order, then z. Equal keys keep insertion
  // order (Array.prototype.sort is stable in modern engines).
  return items.sort((a, b) => {
    if (a.trackIndex !== b.trackIndex) return a.trackIndex - b.trackIndex
    return a.clip.transform.z - b.clip.transform.z
  })
}

/**
 * Source-media time for a clip at playhead `t`: `clip.in + (t - clip.start)`.
 * This is where a video element should be seeked / an image is timeless.
 */
export function clipSourceTime(clip: Clip, t: number): number {
  return clip.in + (t - clip.start)
}

/** An affine draw transform in canvas (project-resolution) pixel space. */
export interface DrawTransform {
  /** Translation of the clip's CENTER, in canvas pixels. */
  translateX: number
  translateY: number
  /** Composite scale (uniform `transform.scale`, sign carries flip). */
  scaleX: number
  scaleY: number
  /** Rotation in RADIANS (CSS/CCW-from-x positive, matching canvas rotate). */
  rotation: number
  /** Source alpha in [0,1] for `ctx.globalAlpha`. */
  alpha: number
}

/**
 * Translate a clip `transform` into a canvas-space draw transform at the given
 * project `resolution` ([w,h]).
 *
 * APPLICATION ORDER (skill: transform applied to the whole group):
 *   1. translate to the canvas CENTER, then by `transform.x` / `transform.y`
 *   2. rotate by `transform.rotation` (degrees → radians)
 *   3. scale by `transform.scale`, with `flipH`/`flipV` as NEGATIVE axis scale
 *   4. `transform.opacity` becomes `globalAlpha`
 *
 * The caller draws the media centered on the origin (offset by half its size)
 * after applying this transform.
 */
export function computeDrawTransform(
  transform: ClipTransform,
  resolution: readonly [number, number]
): DrawTransform {
  const [w, h] = resolution
  return {
    translateX: w / 2 + transform.x,
    translateY: h / 2 + transform.y,
    scaleX: transform.scale * (transform.flipH ? -1 : 1),
    scaleY: transform.scale * (transform.flipV ? -1 : 1),
    rotation: (transform.rotation * Math.PI) / 180,
    alpha: clamp01(transform.opacity)
  }
}

/** An axis-aligned destination rect for drawing media centered on the origin. */
export interface DrawRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Destination rect for drawing a source of `sourceW`×`sourceH` centered on the
 * transform origin, **scaled to contain within** `canvasW`×`canvasH` so that
 * `transform.scale = 1` means "fit the media inside the project resolution" —
 * the expected behavior for any video editor (like CapCut). Returns the
 * top-left-anchored rect so a `drawImage(img, x, y, w, h)` paints the source
 * centered at (0,0) after the caller's translate/scale/rotate.
 */
export function computeDrawRect(
  sourceW: number,
  sourceH: number,
  canvasW?: number,
  canvasH?: number
): DrawRect {
  let w = sourceW
  let h = sourceH
  if (canvasW !== undefined && canvasH !== undefined && sourceW > 0 && sourceH > 0) {
    const fitScale = Math.min(canvasW / sourceW, canvasH / sourceH)
    w = sourceW * fitScale
    h = sourceH * fitScale
  }
  return { x: -w / 2, y: -h / 2, width: w, height: h }
}

/** A letterbox fit: the largest rect of `canvasW:canvasH` inside the viewport. */
export interface LetterboxFit {
  width: number
  height: number
  offsetX: number
  offsetY: number
  scale: number
}

/**
 * Fit a `canvasW`×`canvasH` surface into `viewportW`×`viewportH` preserving
 * aspect (no distortion), centered with letterbox bars. Used for CSS sizing of
 * the canvas element within the stage.
 */
export function letterboxFit(
  canvasW: number,
  canvasH: number,
  viewportW: number,
  viewportH: number
): LetterboxFit {
  if (canvasW <= 0 || canvasH <= 0 || viewportW <= 0 || viewportH <= 0) {
    return { width: 0, height: 0, offsetX: 0, offsetY: 0, scale: 0 }
  }
  const scale = Math.min(viewportW / canvasW, viewportH / canvasH)
  const width = canvasW * scale
  const height = canvasH * scale
  return {
    width,
    height,
    offsetX: (viewportW - width) / 2,
    offsetY: (viewportH - height) / 2,
    scale
  }
}

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/** An axis-aligned clip bounds rect in canvas (project-resolution) pixel space. */
export interface ClipBounds {
  /** Left edge (canvas px). */
  left: number
  /** Top edge (canvas px). */
  top: number
  /** Right edge (canvas px). */
  right: number
  /** Bottom edge (canvas px). */
  bottom: number
}

/**
 * The clip's UN-ROTATED, scaled bounds in canvas (project-resolution) space,
 * given the clip's intrinsic source size. Reuses the same `computeDrawTransform`
 * / `computeDrawRect` math the compositor draws with: the rect is sized by
 * `|scale|` (flip sign does not change extent) and centered at the transform's
 * translate point.
 *
 * These are the bounds in the clip's LOCAL frame (before `transform.rotation`
 * is applied). For rotation-aware geometry, rotate the four corners about the
 * center by `transform.rotation`, or inverse-rotate a test point into this frame
 * first (see {@link hitTestClip} / {@link rotatedClipCorners}). For an unrotated
 * clip (rotation = 0) the box is already axis-aligned and this is exact.
 */
export function clipBoundsAt(
  transform: ClipTransform,
  sourceW: number,
  sourceH: number,
  resolution: readonly [number, number]
): ClipBounds {
  const dt = computeDrawTransform(transform, resolution)
  const [canvasW, canvasH] = resolution
  const fitScale = sourceW > 0 && sourceH > 0
    ? Math.min(canvasW / sourceW, canvasH / sourceH)
    : 1
  const halfW = (sourceW * fitScale * Math.abs(dt.scaleX)) / 2
  const halfH = (sourceH * fitScale * Math.abs(dt.scaleY)) / 2
  return {
    left: dt.translateX - halfW,
    top: dt.translateY - halfH,
    right: dt.translateX + halfW,
    bottom: dt.translateY + halfH
  }
}

/** True when point (`px`,`py`) in canvas space lies within `bounds` (inclusive). */
export function pointInBounds(bounds: ClipBounds, px: number, py: number): boolean {
  return px >= bounds.left && px <= bounds.right && py >= bounds.top && py <= bounds.bottom
}

/** The center (canvas px) of a clip's drawn bounds. */
export function clipCenter(bounds: ClipBounds): { x: number; y: number } {
  return { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 }
}

/**
 * Rotation-aware containment: true when the canvas-space point (`px`,`py`) lies
 * inside the clip's drawn box ACCOUNTING FOR `transform.rotation`. The point is
 * inverse-rotated about the clip center into the clip's local (un-rotated) frame
 * (pure math in `rotate.ts`), then tested against the axis-aligned `bounds`.
 * For rotation = 0 this reduces exactly to `pointInBounds`.
 */
export function pointInRotatedBounds(
  bounds: ClipBounds,
  rotationDeg: number,
  px: number,
  py: number
): boolean {
  const c = clipCenter(bounds)
  const local = rotatePointInverse(px, py, c.x, c.y, rotationDeg)
  return pointInBounds(bounds, local.x, local.y)
}

/** The four corners (canvas px) of a clip's drawn box AFTER `transform.rotation`. */
export function rotatedClipCorners(
  bounds: ClipBounds,
  rotationDeg: number
): { x: number; y: number }[] {
  const c = clipCenter(bounds)
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const corners = [
    { x: bounds.left, y: bounds.top },
    { x: bounds.right, y: bounds.top },
    { x: bounds.right, y: bounds.bottom },
    { x: bounds.left, y: bounds.bottom }
  ]
  // Forward rotation by +deg about the center (clockwise on screen).
  return corners.map((p) => {
    const dx = p.x - c.x
    const dy = p.y - c.y
    return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos }
  })
}

/** A clip's intrinsic source size, for hit-testing its drawn bounds. */
export interface ClipSize {
  clipId: string
  width: number
  height: number
}

/**
 * Topmost visible clip whose drawn bounds contain the canvas-space point
 * (`px`,`py`). `items` MUST be in back-to-front draw order (as
 * `visibleClipsAt` returns); the LAST matching item is the topmost (drawn last,
 * on top). Clips whose source size is unknown (not in `sizes`) are skipped.
 * Returns the clip id, or null when the point hits no clip.
 *
 * ROTATION-AWARE (P3.12): the test respects `transform.rotation` — the point is
 * inverse-rotated into each clip's local frame before the bounds test (see
 * {@link pointInRotatedBounds}). A point inside a clip's axis-aligned box but
 * outside its rotated box correctly misses.
 */
export function hitTestClip(
  items: readonly DrawItem[],
  sizes: ReadonlyMap<string, { width: number; height: number }>,
  px: number,
  py: number,
  resolution: readonly [number, number]
): string | null {
  let hit: string | null = null
  for (const { clip } of items) {
    const size = sizes.get(clip.id)
    if (size === undefined) continue
    const bounds = clipBoundsAt(clip.transform, size.width, size.height, resolution)
    if (pointInRotatedBounds(bounds, clip.transform.rotation, px, py)) hit = clip.id
  }
  return hit
}

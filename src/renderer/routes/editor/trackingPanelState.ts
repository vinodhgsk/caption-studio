import type { Project } from '../../../shared/storage'
import type { ClipTracking } from '../../../shared/project-schema'
import type { TargetBox, TrackTargetKind } from '../../../shared/tracking'

/**
 * PURE state projections for the Motion Tracking section of the Animation panel
 * (P8.10, Doc 11; skill `motion-tracking`). The panel UI is a thin wiring layer
 * over the already-built, undoable `timelineStore` tracking commands
 * (`trackTarget`, `setTrackingEnabled`, `setTrackingAnchor`, `setTrackingSmoothing`,
 * `clearTracking`) and the compositor evaluator (`trackingSampler`). These helpers
 * derive the editable lane state from a clip's persisted `clip.tracking`, build a
 * sensible default target box, and clamp the user-tunable knobs — kept here, free of
 * React/DOM, so they are unit-testable in isolation (mirrors `animationPanelState`).
 *
 * COORDINATE SPACE: `TargetBox.x/y` is the box CENTER in project-resolution
 * (canvas) px — the same space the preview overlay projects through the letterbox
 * fit, and the same space `trackingSample` takes the subject displacement relative
 * to (so the absolute origin cancels; the text follows the subject's motion).
 */

/** Upper bound of the jitter-smoothing knob (0 = raw path, 1 = strongest low-pass). */
export const SMOOTHING_MAX = 1

/** One click of the manual anchor nudge, in project-resolution px. */
export const ANCHOR_NUDGE_PX = 8

/** Target-kind choices for the picker dropdown (closed set from the shared contract). */
export const TRACK_TARGET_KIND_OPTIONS: readonly { id: TrackTargetKind; label: string }[] = [
  { id: 'face', label: 'Face' },
  { id: 'object', label: 'Object' }
]

/** The editable Motion Tracking lane state derived from a clip's `tracking`. */
export interface TrackingLaneState {
  /** True once a (non-empty) tracked path has been produced for the clip. */
  hasTracking: boolean
  /** Whether the attachment currently drives the clip transform (`tracking.enabled`). */
  enabled: boolean
  /** Jitter-smoothing amount ∈ [0, SMOOTHING_MAX]. */
  smoothing: number
  /** Manual anchor-correction offset (project-resolution px), defaulting to 0. */
  anchor: { dx: number; dy: number }
  /** The picked subject kind (face/object); defaults to 'face'. */
  kind: TrackTargetKind
  /** Number of per-frame samples on the tracked path (0 when untracked). */
  sampleCount: number
}

/** Clamp `v` into `[0, SMOOTHING_MAX]`; NaN → 0. PURE. */
export function clampSmoothing(v: number): number {
  if (Number.isNaN(v)) return 0
  return v < 0 ? 0 : v > SMOOTHING_MAX ? SMOOTHING_MAX : v
}

/**
 * Project a clip's persisted {@link ClipTracking} (or `undefined`) onto the editable
 * lane state the panel renders. PURE — absent fields fall back to neutral defaults
 * (disabled, no smoothing, zero anchor, face kind), so a clip with no tracking still
 * yields a well-formed lane the panel can drive a first "Track" from.
 */
export function deriveTrackingLane(tracking: ClipTracking | undefined): TrackingLaneState {
  const sampleCount = tracking?.path?.length ?? 0
  return {
    hasTracking: sampleCount > 0,
    enabled: tracking?.enabled ?? false,
    smoothing: clampSmoothing(tracking?.smoothing ?? 0),
    anchor: { dx: tracking?.anchor?.dx ?? 0, dy: tracking?.anchor?.dy ?? 0 },
    kind: tracking?.target ?? tracking?.targetBox?.kind ?? 'face',
    sampleCount
  }
}

/**
 * A sensible DEFAULT target box centered on the canvas, sized to ~30% of the
 * project resolution (min 16 px each side). The user can refine it on the preview
 * overlay before tracking. PURE.
 */
export function defaultTargetBox(
  resolution: readonly [number, number],
  kind: TrackTargetKind
): TargetBox {
  const [w, h] = resolution
  return {
    x: w / 2,
    y: h / 2,
    width: Math.max(16, Math.round(w * 0.3)),
    height: Math.max(16, Math.round(h * 0.3)),
    kind
  }
}

/**
 * Clamp a (possibly user-dragged) target box so its CENTER stays within the canvas
 * and its size is at least 16 px on each side. PURE — keeps the picked region usable
 * regardless of where the pointer went.
 */
export function clampTargetBox(box: TargetBox, resolution: readonly [number, number]): TargetBox {
  const [w, h] = resolution
  const width = Math.max(16, Math.min(box.width, w))
  const height = Math.max(16, Math.min(box.height, h))
  return {
    x: box.x < 0 ? 0 : box.x > w ? w : box.x,
    y: box.y < 0 ? 0 : box.y > h ? h : box.y,
    width,
    height,
    kind: box.kind
  }
}

/** Add a nudge to the anchor offset (manual correction). PURE. */
export function nudgeAnchor(
  anchor: { dx: number; dy: number },
  dx: number,
  dy: number
): { dx: number; dy: number } {
  return { dx: anchor.dx + dx, dy: anchor.dy + dy }
}

/** A selectable source video to analyze (a distinct video-clip `mediaRef`). */
export interface VideoSourceOption {
  /** Bundle-relative media path passed to `trackTarget` as the `videoRef`. */
  ref: string
  /** Short, human-readable label (the file name). */
  label: string
}

/**
 * The DISTINCT source videos available to track against — every non-empty
 * `mediaRef` on a `video` track, de-duplicated, in track/clip order. The panel lets
 * the user pick which video the selected text clip should follow. PURE.
 */
export function videoSourceOptions(project: Project): VideoSourceOption[] {
  const seen = new Set<string>()
  const out: VideoSourceOption[] = []
  for (const track of project.tracks) {
    if (track.type !== 'video') continue
    for (const clip of track.clips) {
      const ref = clip.mediaRef
      if (ref.length > 0 && !seen.has(ref)) {
        seen.add(ref)
        out.push({ ref, label: ref.split('/').pop() ?? ref })
      }
    }
  }
  return out
}

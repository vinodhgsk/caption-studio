/**
 * MOTION-TRACKING attach + sampler for the compositor (P8.10 — Doc 11; skill
 * `motion-tracking`). The renderer-side glue that turns a clip's persisted
 * {@link ClipTracking} attachment into a composable {@link AnimSample} the preview
 * (and export) fold onto the clip transform — exactly like `motionPathSample`
 * (P8.8) folds a drawn path, via the SAME `composeSamples` primitive.
 *
 * WHAT IT DOES (PURE, deterministic — no DOM / electron / Date):
 *   1. Reconstructs a {@link TrackPath} (`{fps, samples}`) from the inlined
 *      `clip.tracking.fps` + `clip.tracking.path` (the schema stores the samples
 *      flat; the shared {@link sampleTrackPath} / {@link smoothTrackPath} evaluators
 *      take a `TrackPath`).
 *   2. JITTER SMOOTHING: pre-processes the path through {@link smoothTrackPath} by
 *      `clip.tracking.smoothing` (0 → raw; higher → smoother). PURE.
 *   3. Samples the (smoothed) path at CLIP-LOCAL time `t` via {@link sampleTrackPath}.
 *   4. OFFSETS the text so it STICKS to the subject: the path's absolute subject
 *      center is converted to a translate DELTA relative to where the target was
 *      PICKED (`targetBox.x/y`), so at the pick time the offset is ~0 (the text stays
 *      where the user placed it) and it then moves WITH the subject. The subject's
 *      `scale`/`rotation` ride along so the text scales/rotates with it.
 *   5. MANUAL ANCHOR CORRECTION (`clip.tracking.anchor = {dx,dy}`): added on top of
 *      the tracked offset so the user can nudge where the text sits relative to the
 *      subject (e.g. above a face). PURE — applied here, persisted as data.
 *
 * DISABLED / NO PATH → {@link IDENTITY_SAMPLE} (no offset), so a clip with tracking
 * cleared or `enabled:false` renders exactly as before. Composes in the documented
 * order alongside keyframes / motion-path / animation (see {@link composeClipSample}).
 */
import type { ClipTracking } from '../../../shared/project-schema'
import type { TrackPath, TrackSample } from '../../../shared/tracking'
import { sampleTrackPath, smoothTrackPath } from '../../../shared/tracking'
import { IDENTITY_SAMPLE, type AnimSample } from './clipAnimation'

/** Degrees → radians — tracked `rotation` is degrees; `AnimSample.rotation` is radians. */
const DEG_TO_RAD = Math.PI / 180

/**
 * Reconstruct a {@link TrackPath} from a {@link ClipTracking} attachment (the schema
 * inlines `fps` + `samples` as `fps` + `path`). Returns `undefined` when there is no
 * usable path (absent / empty), so callers fall back to identity. PURE.
 */
export function trackingToPath(tracking: ClipTracking | undefined): TrackPath | undefined {
  if (tracking === undefined) return undefined
  const samples = tracking.path
  if (samples === undefined || samples.length === 0) return undefined
  return { fps: tracking.fps ?? 30, samples }
}

/**
 * The anchor (manual-correction) offset of a tracking attachment, defaulting to
 * `{dx:0, dy:0}` when absent. PURE. Exported for tests / UI.
 */
export function trackingAnchor(tracking: ClipTracking | undefined): { dx: number; dy: number } {
  const a = tracking?.anchor
  return { dx: a?.dx ?? 0, dy: a?.dy ?? 0 }
}

/**
 * The PURE attach evaluator: the composable {@link AnimSample} delta a tracked text
 * clip gets at CLIP-LOCAL time `t` (seconds). It is {@link IDENTITY_SAMPLE} when:
 *   - `tracking` is absent, or
 *   - `tracking.enabled` is false, or
 *   - there is no (non-empty) `path`.
 *
 * Otherwise it returns:
 *   - `tx` = (smoothed subject X at `t`) − targetBox.x + anchor.dx
 *   - `ty` = (smoothed subject Y at `t`) − targetBox.y + anchor.dy
 *   - `scale`    = subject scale at `t` (1 when the tracker is translate-only)
 *   - `rotation` = subject rotation at `t`, DEG → RAD (AnimSample.rotation is radians)
 *   - `opacity`  = 1 (tracking never changes opacity)
 *
 * The subject motion is taken RELATIVE to the picked `targetBox` center so the text
 * stays where the user placed it at the pick time and then follows the subject's
 * displacement (req. 2). The manual `anchor` nudge is ADDED on top (req. 3). Jitter
 * smoothing by `tracking.smoothing` is applied as a path pre-process (req. 4).
 * Deterministic — same inputs → same output.
 */
export function trackingSample(tracking: ClipTracking | undefined, t: number): AnimSample {
  if (tracking === undefined || tracking.enabled !== true) return IDENTITY_SAMPLE
  const rawPath = trackingToPath(tracking)
  if (rawPath === undefined) return IDENTITY_SAMPLE

  const smoothing = tracking.smoothing ?? 0
  const path = smoothing > 0 ? smoothTrackPath(rawPath, smoothing) : rawPath

  const sample: TrackSample | null = sampleTrackPath(path, t)
  if (sample === null) return IDENTITY_SAMPLE

  // Subject motion relative to where the target was picked (so pick-time offset ≈ 0).
  const box = tracking.targetBox
  const baseX = box?.x ?? sample.x
  const baseY = box?.y ?? sample.y
  const { dx, dy } = trackingAnchor(tracking)

  return {
    opacity: 1,
    tx: sample.x - baseX + dx,
    ty: sample.y - baseY + dy,
    scale: sample.scale ?? 1,
    rotation: (sample.rotation ?? 0) * DEG_TO_RAD
  }
}

/**
 * Motion-tracking shared contract (P8.9 / PROMPT 11.3, Doc 11 — keyframes & motion;
 * skill `motion-tracking`). The headless interface the renderer, preload, and main
 * all agree on: pick a TARGET on a source clip → produce a per-frame TRANSFORM PATH
 * (`TrackPath`) that text sticks to (P8.10 attaches the text clip to it).
 *
 * Pure TYPES + small PURE helpers ONLY. NO electron / node / DOM imports leak here
 * so the renderer wrapper, the preload bridge, and the main-process provider
 * registry can all import this module without rework (master plan §3 / Doc 00 §3 —
 * headless). Deterministic + side-effect-free (no Math.random / Date) so the stub
 * provider's path and the sampler are unit-testable.
 *
 * Mirrors the STT contract (`src/shared/stt.ts`): a pluggable {@link TrackingProvider}
 * interface, a deterministic STUB now, and the SAME interface a real face/object CV
 * tracker drops in behind later (like whisper.cpp behind the STT stub). The provider
 * output (`TrackPath`) is persisted to `clip.tracking` (see {@link ClipTracking} in
 * `project-schema.ts`) and feeds the P8.10 compositor.
 */

/**
 * The kind of subject the user picks to track (Doc 11 UI/UX: "pick target
 * (face/object)"). `'face'` / `'object'` are HINTS to a CV provider about what to
 * lock onto inside {@link TargetBox}; the deterministic stub ignores the kind (it
 * tracks the box itself). Closed set — extend deliberately.
 */
export const TRACK_TARGET_KINDS = ['face', 'object'] as const
export type TrackTargetKind = (typeof TRACK_TARGET_KINDS)[number]

/**
 * The TARGET region the user draws/selects on the source clip to track. A box in
 * PROJECT-RESOLUTION (canvas) px — the SAME coordinate space as `transform.x/y` and
 * the motion-path points — so the produced path's x/y are directly an additive
 * translate the compositor (P8.10) applies. `(x,y)` is the box CENTER (matching the
 * transform convention: center-relative); `width`/`height` size it. `kind` hints
 * what a CV provider should lock onto inside the box.
 */
export interface TargetBox {
  /** Box center X, project-resolution px (same space as `transform.x`). */
  x: number
  /** Box center Y, project-resolution px (same space as `transform.y`). */
  y: number
  /** Box width, px. */
  width: number
  /** Box height, px. */
  height: number
  /** What to lock onto inside the box (provider hint). */
  kind: TrackTargetKind
}

/**
 * A single TRACKED transform sample — where the subject is at one instant, and thus
 * the transform the attached text should follow (skill: `{t,x,y,scale,rotation,confidence}`).
 *
 * TIME CONVENTION: `t` is CLIP-LOCAL seconds (offset from the clip's `start`),
 * matching the keyframe lane convention so moving the clip never invalidates its
 * track. Samples are time-SORTED ascending. `x`/`y` are the subject's center in
 * project-resolution px (additive translate for the text). `scale` (1 = original
 * subject size) and `rotation` (degrees) are OPTIONAL — a translate-only tracker
 * omits them; the sampler treats absent `scale` as 1 and absent `rotation` as 0.
 * `confidence` ∈ [0,1] is OPTIONAL: a low value marks a segment a manual anchor
 * (P8.10 correction) should override/blend.
 */
export interface TrackSample {
  /** Clip-local time of the sample, in seconds. */
  t: number
  /** Subject center X, project-resolution px. */
  x: number
  /** Subject center Y, project-resolution px. */
  y: number
  /** Subject scale multiplier (1 = original). Absent → 1. */
  scale?: number
  /** Subject rotation, degrees. Absent → 0. */
  rotation?: number
  /** Tracker confidence ∈ [0,1]. Absent → treated as fully confident (1). */
  confidence?: number
}

/**
 * The full PATH a provider returns: the frame rate it sampled at plus the
 * time-sorted {@link TrackSample}[] (skill: `{ fps, path:[...] }`). `fps` records the
 * cadence the samples were produced at (one per video frame for a real CV tracker)
 * so the UI can show/redraw it; the {@link sampleTrackPath} evaluator interpolates
 * BETWEEN samples, so the compositor (P8.10) can query ANY clip-local time — it is
 * not limited to frame boundaries.
 */
export interface TrackPath {
  /** Frames per second the samples were produced at (the cadence of `samples`). */
  fps: number
  /** Time-sorted per-frame transform samples (clip-local seconds). */
  samples: TrackSample[]
}

/**
 * Options for a {@link TrackingProvider.track} request. `durationSec` bounds the
 * range to track (clip-local, from 0); a provider produces ⌈durationSec * fps⌉ + 1
 * samples covering `[0, durationSec]`. `fps` pins the sampling cadence (defaults to
 * the project fps, supplied by the caller). Future options (search-radius, model)
 * can be added without changing the channel shape.
 */
export interface TrackOptions {
  /** Clip-local duration to track, in seconds (the clip's length). */
  durationSec: number
  /** Sampling cadence; one sample per frame. Defaults supplied by caller. */
  fps: number
}

/**
 * The pluggable MOTION-TRACKING provider interface (P8.9, Doc 11; skill
 * `motion-tracking`: `track(videoRef, target, range) -> { fps, path }`). A provider
 * analyzes the video referenced by `videoRef` (a BUNDLE-RELATIVE path such as
 * `media/clip1.mp4`), locks onto `target`, and returns a {@link TrackPath} of
 * per-frame transforms over `[0, opts.durationSec]`.
 *
 * IMPORTANT (mirrors {@link import('./stt').SttProvider}): the provider receives the
 * bundle-relative `videoRef` PLUS the resolved absolute `bundlePath` (so a CV
 * provider can read/decode frames in MAIN); NO frame bytes ever cross IPC
 * (constraint: keep media bytes out of IPC payloads). The deterministic STUB ignores
 * the video entirely and derives a synthetic path from `target` + `opts`, so the
 * feature works end-to-end and is testable without real CV. A real face/object
 * tracker drops in behind this SAME interface (like whisper.cpp behind the STT stub).
 */
export interface TrackingProvider {
  /** Stable id used by the registry/factory (e.g. `'stub'`, `'opencv'`). */
  readonly id: string
  /**
   * Track `target` through the video at `videoRef` within the bundle rooted at
   * `bundlePath`, over `[0, opts.durationSec]` at `opts.fps`. Resolves to the
   * {@link TrackPath}. Rejects on failure (the IPC wrapper converts a throw to
   * `{ ok:false, error }`).
   */
  track(
    bundlePath: string,
    videoRef: string,
    target: TargetBox,
    opts: TrackOptions
  ): Promise<TrackPath>
}

/** The IPC request shape for `tracking:run` (mirrored in the IPC contract). */
export interface TrackingRunRequest {
  /** Bundle-relative source video to analyze (e.g. `media/clip1.mp4`). */
  videoRef: string
  /** The picked target region (project-resolution px) + kind hint. */
  target: TargetBox
  /** Clip-local duration to track, in seconds. */
  durationSec: number
  /** Sampling cadence (one sample/frame); typically the project fps. */
  fps: number
}

/** Linear interpolation between `a` and `b` by `t ∈ [0,1]`. PURE. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Clamp `v` into `[lo, hi]`. PURE. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * PURE JITTER SMOOTHING (P8.10, Doc 11; skill `motion-tracking` — "jitter smoothing").
 * A windowed MOVING-AVERAGE low-pass over the path's `x`/`y` (and `scale`/`rotation`)
 * channels to suppress per-frame tracker jitter, parameterized by `amount ∈ [0,1]`:
 *
 *   - `amount <= 0`  → returns the path UNCHANGED (identity — same reference is fine,
 *                      but a fresh object is returned so callers never mutate input).
 *   - larger amount  → a WIDER averaging window (`radius = round(amount * MAX_RADIUS)`),
 *                      so more neighbouring samples are blended in → smoother, less jitter.
 *
 * The window is symmetric and CLAMPED at the ends (edge samples average fewer
 * neighbours), so the smoothed series stays bounded by the input range and the
 * endpoints barely move — the path still starts/ends where the subject did. `t` and
 * `confidence` are PRESERVED per sample (only the spatial channels are filtered). The
 * result has the SAME sample count + times as the input, so {@link sampleTrackPath}
 * over it behaves identically apart from reduced jitter. Deterministic + side-effect-free.
 */
export function smoothTrackPath(path: TrackPath, amount: number): TrackPath {
  const a = clamp(amount, 0, 1)
  const s = path.samples
  if (a <= 0 || s.length <= 2) {
    // No smoothing (or too few samples to average) — copy through unchanged.
    return { fps: path.fps, samples: s.map((k) => ({ ...k })) }
  }
  // Map amount → window half-width. MAX_RADIUS bounds how aggressive max smoothing is.
  const MAX_RADIUS = 8
  const radius = Math.max(1, Math.round(a * MAX_RADIUS))

  const smoothed: TrackSample[] = s.map((k, i) => {
    const lo = Math.max(0, i - radius)
    const hi = Math.min(s.length - 1, i + radius)
    let sx = 0
    let sy = 0
    let sScale = 0
    let sRot = 0
    let n = 0
    for (let j = lo; j <= hi; j++) {
      sx += s[j].x
      sy += s[j].y
      sScale += s[j].scale ?? 1
      sRot += s[j].rotation ?? 0
      n++
    }
    const out: TrackSample = {
      t: k.t,
      x: sx / n,
      y: sy / n
    }
    // Preserve presence of optional channels (only filter what the sample carried).
    if (k.scale !== undefined) out.scale = sScale / n
    if (k.rotation !== undefined) out.rotation = sRot / n
    if (k.confidence !== undefined) out.confidence = k.confidence
    return out
  })
  return { fps: path.fps, samples: smoothed }
}

/**
 * PURE evaluator: the tracked transform at clip-local time `t` seconds, INTERPOLATED
 * between the two bracketing {@link TrackSample}s (so the compositor can sample at
 * any time, not just frame boundaries). This is what P8.10 calls to offset the text
 * clip's transform by the subject's motion at `t`.
 *
 *   - empty path           → `null` (caller treats as identity: no offset).
 *   - `t` ≤ first sample   → the first sample (clamped; no extrapolation).
 *   - `t` ≥ last sample    → the last sample (clamped).
 *   - interior `t`         → linear blend of the bracketing samples (x/y/scale/rotation
 *                            and confidence all interpolated).
 *
 * The result ALWAYS carries concrete `scale` (absent → 1) and `rotation` (absent →
 * 0) so the caller composes a full transform without re-checking optionals.
 * Deterministic; assumes `samples` is time-sorted ascending (as providers produce).
 */
export function sampleTrackPath(path: TrackPath | undefined, t: number): TrackSample | null {
  if (path === undefined) return null
  const s = path.samples
  if (s.length === 0) return null

  const normalize = (k: TrackSample): TrackSample => ({
    t: k.t,
    x: k.x,
    y: k.y,
    scale: k.scale ?? 1,
    rotation: k.rotation ?? 0,
    confidence: k.confidence ?? 1
  })

  if (t <= s[0].t) return normalize(s[0])
  const last = s[s.length - 1]
  if (t >= last.t) return normalize(last)

  // Find the segment [i, i+1] bracketing `t`.
  let i = 0
  while (i < s.length - 1 && s[i + 1].t <= t) i++
  const a = s[i]
  const b = s[i + 1]
  const span = b.t - a.t
  const localT = span > 0 ? (t - a.t) / span : 0
  return {
    t,
    x: lerp(a.x, b.x, localT),
    y: lerp(a.y, b.y, localT),
    scale: lerp(a.scale ?? 1, b.scale ?? 1, localT),
    rotation: lerp(a.rotation ?? 0, b.rotation ?? 0, localT),
    confidence: lerp(a.confidence ?? 1, b.confidence ?? 1, localT)
  }
}

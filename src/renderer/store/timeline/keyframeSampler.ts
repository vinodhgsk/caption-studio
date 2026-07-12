/**
 * Pure KEYFRAME SAMPLER + preview composition (P8.7 — Doc 11; skill `keyframe-engine`).
 *
 * P8.6 built the keyframe DATA MODEL + lane edit ops (`keyframes.ts`): one
 * time-sorted `Keyframe[]` lane per animatable prop (`x`/`y`/`scale`/`rotation`/
 * `opacity`) on `clip.keyframes`, each `Keyframe = { t (CLIP-LOCAL seconds),
 * value, ease? }` where `ease` governs the segment LEAVING that keyframe.
 *
 * THIS module is the EVALUATOR: given the lanes and a CLIP-LOCAL time, it samples
 * each lane to a single value (`sampleKeyframes`), and folds that into the preview
 * transform as an {@link AnimSample} delta (`keyframeSample`) that COMPOSES with
 * the clip's static transform and the in/out/loop animation sample via the SAME
 * `composeSamples` primitive the rest of the animation stack uses. So the keyframe
 * motion, the entrance/exit/loop preset, and the base transform stack predictably
 * (req. 2). With NO keyframes the sample is {@link IDENTITY_SAMPLE} — identity, the
 * existing rendering is unchanged (req. 4 — persist stays in P8.6; this is wiring).
 *
 * INTERPOLATION (per lane, req. 1):
 *   - empty lane            → prop ABSENT from the result (no override)
 *   - before the first kf   → first keyframe's value (clamp-hold)
 *   - after the last kf     → last keyframe's value (clamp-hold)
 *   - single kf             → that value, constant for all time
 *   - between kf i & i+1    → lerp(value_i, value_{i+1}, ease(kf_i.ease, localProgress))
 *                             where localProgress = (t - t_i) / (t_{i+1} - t_i) and
 *                             `kf_i.ease` (the LEAVING ease) defaults to `linear`.
 * Lanes are assumed already SORTED ascending by `t` (P8.6 invariant); the sampler
 * does NOT re-sort (callers use `getLane` if they hold unsorted data).
 *
 * UNITS / SEMANTICS (req. 3) — the keyframe value units MIRROR `clip.transform`:
 *   - `x` / `y`    canvas px, ADD to the translate (same units as `transform.x/y`).
 *   - `scale`      uniform multiplier, MULTIPLIES the clip scale (1 = unchanged).
 *   - `rotation`   DEGREES (same as `transform.rotation`), ADDED after converting
 *                  to RADIANS — because the preview composes rotation in radians
 *                  (`AnimSample.rotation` is radians; `computeDrawTransform` already
 *                  converts `transform.rotation` deg→rad). `keyframeSample` does the
 *                  deg→rad conversion so the composed `AnimSample.rotation` is radians.
 *   - `opacity`    0..1, MULTIPLIES the clip alpha (1 = unchanged).
 *
 * HEADLESS-SAFE + PURE: no DOM / canvas / electron / node / Date. Same inputs →
 * same output, so preview, a vitest engine, and the export path sample identically.
 */
import type {
  ClipKeyframes,
  ClipMotionPath,
  ClipTracking,
  Keyframe,
  KeyframeProp
} from '../../../shared/project-schema'
import { ease, lerp, type EasingSpec } from '../../../shared/easing'
import {
  composeSamples,
  IDENTITY_SAMPLE,
  type AnimSample
} from './clipAnimation'
import { sampleMotionPath } from './motionPath'
import { trackingSample } from './trackingSampler'

/** Degrees → radians (keyframe `rotation` is stored in degrees, like `transform.rotation`). */
const DEG_TO_RAD = Math.PI / 180

/**
 * The sampled keyframe values at a clip-local time. ONLY props that have a lane
 * appear (a prop with no lane is `undefined` → no override). Values are in the
 * lane's native units (rotation in DEGREES, matching `transform.rotation` and the
 * stored keyframe value — `keyframeSample` converts to radians when composing).
 */
export type KeyframeSampleValues = Partial<Record<KeyframeProp, number>>

/**
 * Sample ONE already-sorted lane at clip-local time `t`. Returns `undefined` for
 * an empty lane (so the prop is omitted). Clamp-holds before the first / after the
 * last keyframe; a single keyframe is constant; an interior time eases between the
 * bracketing keyframes using the LEAVING keyframe's `ease` (default `linear`). PURE.
 */
export function sampleLane(lane: readonly Keyframe[], t: number): number | undefined {
  const n = lane.length
  if (n === 0) return undefined
  if (n === 1) return lane[0].value
  // Clamp-hold outside the keyframed range.
  if (t <= lane[0].t) return lane[0].value
  if (t >= lane[n - 1].t) return lane[n - 1].value

  // Find the segment [i, i+1] containing `t` (lane sorted ascending by `t`).
  let i = 0
  while (i < n - 1 && !(t < lane[i + 1].t)) i++
  const a = lane[i]
  const b = lane[i + 1]
  const span = b.t - a.t
  // Degenerate (duplicate-time) segment — the P8.6 ops dedupe times, but guard
  // anyway so a hand-built lane can't divide by zero. Snap to the later value.
  if (span <= 0) return b.value
  const localProgress = (t - a.t) / span
  const eased = ease((a.ease ?? 'linear') as EasingSpec, localProgress)
  return lerp(a.value, b.value, eased)
}

/**
 * PURE keyframe sampler: evaluate every lane of `keyframes` at CLIP-LOCAL time `t`,
 * returning only the props that HAVE a lane. `undefined`/absent `keyframes` → `{}`
 * (no overrides). Lanes are assumed sorted ascending by `t` (P8.6 invariant).
 * Deterministic — the same inputs always give the same values. (req. 1)
 */
export function sampleKeyframes(
  keyframes: ClipKeyframes | undefined,
  t: number
): KeyframeSampleValues {
  if (keyframes === undefined) return {}
  const out: KeyframeSampleValues = {}
  for (const prop of Object.keys(keyframes) as KeyframeProp[]) {
    const lane = keyframes[prop]
    if (lane === undefined || lane.length === 0) continue
    const v = sampleLane(lane, t)
    if (v !== undefined) out[prop] = v
  }
  return out
}

/**
 * Convert sampled keyframe values into an {@link AnimSample} DELTA that composes
 * with the clip transform + animation sample via {@link composeSamples}:
 *   - `x`/`y`     → `tx`/`ty` (ADD, px)
 *   - `scale`     → `scale`   (MULTIPLY)
 *   - `rotation`  → `rotation` (ADD), converted DEGREES → RADIANS
 *   - `opacity`   → `opacity` (MULTIPLY, 0..1)
 * Absent props leave the identity neutral (0 add / 1 multiply), so an empty sample
 * is {@link IDENTITY_SAMPLE} — composing it changes nothing (req. 2 + req. 4). PURE.
 */
export function keyframeSample(values: KeyframeSampleValues): AnimSample {
  return {
    opacity: values.opacity ?? 1,
    tx: values.x ?? 0,
    ty: values.y ?? 0,
    scale: values.scale ?? 1,
    rotation: (values.rotation ?? 0) * DEG_TO_RAD
  }
}

/**
 * Convenience: sample `clip.keyframes` at clip-local time `t` and return the
 * composable {@link AnimSample} in one step. With no keyframes this is
 * {@link IDENTITY_SAMPLE} (a cheap fast-path). PURE.
 *
 * COMPOSE ORDER (req. 2) — the preview folds, in this order:
 *   base transform (`computeDrawTransform`) → KEYFRAMES (this sample) → ANIMATION
 *   (in/out/loop). Because translate/rotation ADD and scale/opacity MULTIPLY, the
 *   order is associative & commutative for these channels, so the documented order
 *   is for reasoning clarity; the math is order-independent. The keyframe sample is
 *   composed BEFORE the in/out/loop animation sample (so a fade-in still multiplies
 *   on top of a keyframed opacity, a "pop" scale multiplies a keyframed scale, etc.).
 */
export function sampleClipKeyframeSample(
  keyframes: ClipKeyframes | undefined,
  t: number
): AnimSample {
  if (keyframes === undefined) return IDENTITY_SAMPLE
  return keyframeSample(sampleKeyframes(keyframes, t))
}

/**
 * Compose the KEYFRAME sample (at clip-local time) with the in/out/loop ANIMATION
 * sample, in the documented order (keyframes → animation). The result is the single
 * {@link AnimSample} the draw path folds onto the base transform. PURE.
 */
export function composeKeyframeWithAnimation(
  keyframeSampleValue: AnimSample,
  animationSample: AnimSample
): AnimSample {
  return composeSamples(keyframeSampleValue, animationSample)
}

/**
 * Sample a clip's MOTION PATH (P8.8) at clip-local PROGRESS `p ∈ [0,1]` and return
 * the composable {@link AnimSample} DELTA — the drawn path's {x,y} ADDED to the
 * translate (`tx`/`ty`), everything else identity. With no path (or no points) this
 * is {@link IDENTITY_SAMPLE} (no offset). The path drives translate ONLY; it composes
 * with the keyframe + in/out/loop samples via the SAME `composeSamples` primitive
 * (translate ADDS), so a motion path + a keyframed x/y + a wiggle loop all stack.
 * PURE — the same `sampleMotionPath` the export path uses.
 */
export function motionPathSample(path: ClipMotionPath | undefined, p: number): AnimSample {
  const pt = sampleMotionPath(path, p)
  if (pt === null) return IDENTITY_SAMPLE
  return { opacity: 1, tx: pt.x, ty: pt.y, scale: 1, rotation: 0 }
}

/**
 * Convenience: the full per-clip transform DELTA at the playhead — the KEYFRAME
 * sample, the MOTION-PATH sample, and the in/out/loop ANIMATION sample, composed in
 * the documented order.
 *
 * COMPOSE ORDER (P8.10, req. 3) — the preview folds, in this order:
 *   base transform (`computeDrawTransform`) → KEYFRAMES → MOTION PATH → TRACKING →
 *   ANIMATION (in/out/loop). Because translate/rotation ADD and scale/opacity
 *   MULTIPLY, the order is associative for these channels (the math is
 *   order-independent); the documented order is for reasoning. The motion path
 *   contributes translate ONLY and is composed AFTER keyframes (so a keyframed x/y and
 *   the path offset ADD); the MOTION-TRACKING sample (the subject-follow offset +
 *   scale/rotation + manual anchor) is composed AFTER the motion path and BEFORE the
 *   in/out/loop sample (so an entrance/loop still applies on top of tracked text).
 *
 * `keyframeT`/`trackingT` are CLIP-LOCAL seconds (`playhead - clip.start`);
 * `pathProgress` is the CLIP-LOCAL 0→1 progress. Tracking absent / disabled / no
 * path → identity (no offset), so an untracked clip composes exactly as before.
 * PURE + deterministic.
 */
export function composeClipSample(opts: {
  keyframes?: ClipKeyframes
  keyframeT: number
  motionPath?: ClipMotionPath
  pathProgress: number
  tracking?: ClipTracking
  trackingT?: number
  animation: AnimSample
}): AnimSample {
  const kf = sampleClipKeyframeSample(opts.keyframes, opts.keyframeT)
  const path = motionPathSample(opts.motionPath, opts.pathProgress)
  const track = trackingSample(opts.tracking, opts.trackingT ?? opts.keyframeT)
  return composeSamples(
    composeSamples(composeSamples(kf, path), track),
    opts.animation
  )
}

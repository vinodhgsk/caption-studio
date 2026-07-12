/**
 * Pure keyframe-lane operations (P8.6, Doc 11 — keyframe-engine skill).
 *
 * These are the PURE, headless, immutable array ops behind the timeline keyframe
 * lane UX: add/move/delete a keyframe and set a keyframe's per-segment easing,
 * for ONE animatable prop lane (`x`/`y`/`scale`/`rotation`/`opacity`), plus the
 * project-level reducers that thread them onto `clip.keyframes`.
 *
 * INVARIANTS every op upholds:
 *   - Lanes are ALWAYS sorted ascending by `t` (so the P8.7 sampler can walk
 *     adjacent keyframes without re-sorting).
 *   - `t` is CLIP-LOCAL seconds, CLAMPED into `[0, clipDurationSec]` (a keyframe
 *     never lands outside the clip it animates).
 *   - DUPLICATE TIMES: adding/moving a keyframe ONTO an existing keyframe's time
 *     REPLACES that keyframe (one keyframe per time per lane) — the lane stays a
 *     function of time, which the sampler relies on.
 *   - Immutable: the input keyframe arrays / project are never mutated; a NEW
 *     array / Project is returned.
 *
 * Headless-safe: NO DOM / electron / node imports, NO Math.random / Date.now.
 * The `EasingName` set is the shared `ease` registry (so a lane easing is always
 * a valid curve the sampler can resolve). Proven by node-env vitest.
 */

import type { Project, ProjectTrack } from '../../../shared/storage'
import type {
  Clip,
  ClipKeyframes,
  Keyframe,
  KeyframeProp
} from '../../../shared/project-schema'
import { clipDuration } from '../../../shared/project-schema'
import type { EasingName } from '../../../shared/easing'

/** Tolerance (seconds) within which two keyframe times are the SAME time (dedupe). */
const SAME_TIME_EPSILON = 1e-6

/** Clamp `t` (clip-local seconds) into `[0, durationSec]`. */
function clampTime(t: number, durationSec: number): number {
  if (t < 0) return 0
  if (t > durationSec) return durationSec
  return t
}

/** True when two clip-local times are the same keyframe time (within epsilon). */
function sameTime(a: number, b: number): boolean {
  return Math.abs(a - b) <= SAME_TIME_EPSILON
}

/** Return a NEW lane sorted ascending by `t` (stable; never mutates `lane`). */
export function sortLane(lane: readonly Keyframe[]): Keyframe[] {
  return [...lane].sort((a, b) => a.t - b.t)
}

/**
 * Insert (or, on a duplicate time, REPLACE) a keyframe into a lane, returning a
 * NEW sorted lane. `t` is CLAMPED into `[0, durationSec]`. If a keyframe already
 * exists at the (clamped) time, it is replaced by the new `{t,value,ease}` — one
 * keyframe per time. PURE + immutable.
 */
export function addKeyframeToLane(
  lane: readonly Keyframe[],
  t: number,
  value: number,
  durationSec: number,
  ease: EasingName = 'linear'
): Keyframe[] {
  const ct = clampTime(t, durationSec)
  const kf: Keyframe = { t: ct, value, ease }
  const without = lane.filter((k) => !sameTime(k.t, ct))
  return sortLane([...without, kf])
}

/**
 * Move the keyframe at `index` to `newTime` (clamped to `[0, durationSec]`) and,
 * if `newValue` is given, to that value too. The lane is RE-SORTED, so the moved
 * keyframe's position in the array can change. If the new time collides with a
 * DIFFERENT existing keyframe, that other keyframe is REPLACED (dropped) so the
 * lane stays one-per-time. Out-of-range `index` → the lane is returned unchanged
 * (sorted copy). PURE + immutable.
 */
export function moveKeyframeInLane(
  lane: readonly Keyframe[],
  index: number,
  newTime: number,
  durationSec: number,
  newValue?: number
): Keyframe[] {
  if (index < 0 || index >= lane.length) return sortLane(lane)
  const target = lane[index]
  const ct = clampTime(newTime, durationSec)
  const moved: Keyframe = {
    t: ct,
    value: newValue ?? target.value,
    ...(target.ease !== undefined ? { ease: target.ease } : {})
  }
  // Drop the original AND any DIFFERENT keyframe now sharing the moved time.
  const rest = lane.filter((k, i) => i !== index && !sameTime(k.t, ct))
  return sortLane([...rest, moved])
}

/**
 * Delete the keyframe at `index`, returning a NEW lane (sorted copy if `index`
 * is out of range — no throw). PURE + immutable.
 */
export function deleteKeyframeFromLane(lane: readonly Keyframe[], index: number): Keyframe[] {
  if (index < 0 || index >= lane.length) return sortLane(lane)
  return sortLane(lane.filter((_, i) => i !== index))
}

/**
 * Set the per-segment `ease` on the keyframe at `index` (the easing that governs
 * the segment LEAVING this keyframe toward the next), returning a NEW lane.
 * Out-of-range `index` → unchanged (sorted copy). PURE + immutable.
 */
export function setKeyframeEaseInLane(
  lane: readonly Keyframe[],
  index: number,
  ease: EasingName
): Keyframe[] {
  if (index < 0 || index >= lane.length) return sortLane(lane)
  return sortLane(lane.map((k, i) => (i === index ? { ...k, ease } : k)))
}

// ---------------------------------------------------------------------------
// Project-level reducers — thread the lane ops onto `clip.keyframes[prop]`.
// ---------------------------------------------------------------------------

/** Locate the track index owning `clipId`, or -1. */
function findTrackIndexByClip(project: Project, clipId: string): number {
  return project.tracks.findIndex((t) => t.clips.some((c) => c.id === clipId))
}

/** Replace the track at `trackIndex`'s clips, returning a new Project. */
function withTrackClips(project: Project, trackIndex: number, nextClips: Clip[]): Project {
  const tracks = project.tracks.map((t, i): ProjectTrack =>
    i === trackIndex ? { ...t, clips: nextClips } : t
  )
  return { ...project, tracks }
}

/**
 * Read a clip's lane for `prop` (empty array when the clip / lane is absent).
 * Always returns a SORTED copy so callers/UX walk keyframes in time order.
 */
export function getLane(clip: Clip, prop: KeyframeProp): Keyframe[] {
  return sortLane(clip.keyframes?.[prop] ?? [])
}

/**
 * Write `nextLane` to `clip.keyframes[prop]` immutably. An EMPTY `nextLane`
 * removes that prop's lane; if no lanes remain, the `keyframes` key is dropped
 * entirely (so an undo back to a keyframe-less clip is exact). PURE.
 */
function withClipLane(clip: Clip, prop: KeyframeProp, nextLane: Keyframe[]): Clip {
  const merged: ClipKeyframes = { ...clip.keyframes }
  if (nextLane.length === 0) {
    delete merged[prop]
  } else {
    merged[prop] = nextLane
  }
  if (Object.keys(merged).length === 0) {
    const rest = { ...clip } as Partial<Clip>
    delete rest.keyframes
    return rest as Clip
  }
  return { ...clip, keyframes: merged }
}

/** Apply a pure lane transform to the clip's `prop` lane, returning a new Project. */
function mapClipLane(
  project: Project,
  clipId: string,
  prop: KeyframeProp,
  transform: (lane: Keyframe[], clip: Clip) => Keyframe[]
): Project {
  const trackIndex = findTrackIndexByClip(project, clipId)
  if (trackIndex === -1) return project
  const track = project.tracks[trackIndex]
  return withTrackClips(
    project,
    trackIndex,
    track.clips.map((c) => {
      if (c.id !== clipId) return c
      const lane = sortLane(c.keyframes?.[prop] ?? [])
      return withClipLane(c, prop, transform(lane, c))
    })
  )
}

/**
 * Add a keyframe to `clipId`'s `prop` lane at clip-local time `t` with `value`
 * (and optional `ease` for the segment leaving it; defaults `linear`). Time is
 * clamped to the clip; a keyframe at the same time is replaced. No-op (returns
 * the project unchanged) when the clip is absent. Pure + immutable.
 */
export function addKeyframe(
  project: Project,
  clipId: string,
  prop: KeyframeProp,
  t: number,
  value: number,
  ease: EasingName = 'linear'
): Project {
  return mapClipLane(project, clipId, prop, (lane, clip) =>
    addKeyframeToLane(lane, t, value, clipDuration(clip), ease)
  )
}

/**
 * Move the keyframe at `index` of `clipId`'s `prop` lane to `newTime` (clamped
 * to the clip), optionally to `newValue`; the lane re-sorts. No-op when the clip
 * is absent. Pure + immutable.
 */
export function moveKeyframe(
  project: Project,
  clipId: string,
  prop: KeyframeProp,
  index: number,
  newTime: number,
  newValue?: number
): Project {
  return mapClipLane(project, clipId, prop, (lane, clip) =>
    moveKeyframeInLane(lane, index, newTime, clipDuration(clip), newValue)
  )
}

/**
 * Delete the keyframe at `index` of `clipId`'s `prop` lane. Removing the last
 * keyframe drops the lane (and `keyframes` entirely if it was the only lane).
 * No-op when the clip is absent. Pure + immutable.
 */
export function deleteKeyframe(
  project: Project,
  clipId: string,
  prop: KeyframeProp,
  index: number
): Project {
  return mapClipLane(project, clipId, prop, (lane) => deleteKeyframeFromLane(lane, index))
}

/**
 * Set the per-segment `ease` on the keyframe at `index` of `clipId`'s `prop`
 * lane (the easing governing the segment LEAVING it). No-op when the clip is
 * absent. Pure + immutable.
 */
export function setKeyframeEasing(
  project: Project,
  clipId: string,
  prop: KeyframeProp,
  index: number,
  ease: EasingName
): Project {
  return mapClipLane(project, clipId, prop, (lane) => setKeyframeEaseInLane(lane, index, ease))
}

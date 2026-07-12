/**
 * Command factories — wrap each pure timeline reducer as an undoable `Command`
 * ({label, apply, invert}) so timeline edits flow through the EXISTING
 * `projectStore.runCommand` / command stack.
 *
 * Invert restores prior state. Where the inverse cannot be expressed as a
 * mirror reducer (move/trim, where the old value is unknown to the caller),
 * the factory captures the pre-edit value by reading it from the Project the
 * caller passes in at factory time — keeping `apply`/`invert` themselves pure
 * (no closures over mutable state, no Date.now/Math.random).
 *
 * Headless-safe: no DOM / electron imports.
 */

import type { Command } from '../commandStack'
import type { Project, ProjectTrack } from '../../../shared/storage'
import type {
  Clip,
  ClipAnimation,
  ClipAudio,
  ClipMotionPath,
  ClipText,
  ClipTracking,
  ClipTransform,
  Keyframe,
  KeyframeProp
} from '../../../shared/project-schema'
import type { EasingName } from '../../../shared/easing'
import {
  addKeyframe,
  deleteKeyframe,
  getLane,
  moveKeyframe,
  setKeyframeEasing
} from './keyframes'
import {
  addClip,
  addTrack,
  moveClip,
  moveClipToTrack,
  moveClipToNewTrack,
  removeClip,
  removeTrack,
  replaceTrackClips,
  rippleDelete,
  rippleInsert,
  setClipAnimation,
  setClipAudio,
  setClipMotionPath,
  setClipText,
  setClipTracking,
  setClipTransform,
  splitAtPlayhead,
  trimClip
} from './reducers'
import {
  CAPTION_TRACK_ID,
  CAPTION_TRACK_TYPE,
  setCaptionFontSizeOnClips,
  setCaptionFontFamilyOnClips,
  setCaptionLetterSpacingOnClips,
  setCaptionLineHeightOnClips,
  setCaptionPositionOnClips,
  setCaptionFillOnClips,
  setCaptionShadowOnClips,
  setCaptionGlowOnClips,
  setCaptionStrokeOnClips,
  stampPresetOntoClips,
  wrapCaptionClipsByWords
} from './captionTrack'
import type { CaptionPreset, LayoutAnchor, PresetFill, PresetShadow, PresetStrokeLayer } from '../../../shared/captionPreset'
import { rippleRemoveRanges, type TimeRange } from './removeSilence'

/** Find a clip and the id of the track that owns it. */
function locateClip(
  project: Project,
  clipId: string
): { clip: Clip; trackId: string } | null {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId)
    if (clip !== undefined) return { clip, trackId: track.id }
  }
  return null
}

/** Replace the clips of the track with `trackId`, returning a new Project. */
function restoreTrackClips(project: Project, trackId: string, clips: Clip[]): Project {
  return {
    ...project,
    tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, clips } : t))
  }
}

/**
 * Add a new empty track (caller-supplied `trackId`); invert removes it. Used by
 * media import (P3.3) when no track of the needed type exists yet.
 */
export function addTrackCommand(trackId: string, type: ProjectTrack['type']): Command {
  return {
    label: 'Add track',
    apply: (p) => addTrack(p, trackId, type),
    invert: (p) => removeTrack(p, trackId)
  }
}

/**
 * Remove a whole track (row) and its clips (CapCut-style "delete track"); invert
 * restores the exact track at its original index. The removed track snapshot is
 * captured at factory time so undo re-inserts it (with all its clips) in place.
 * No-op apply/invert when the track is absent.
 */
export function removeTrackCommand(project: Project, trackId: string): Command {
  const index = project.tracks.findIndex((t) => t.id === trackId)
  const removed = index === -1 ? null : project.tracks[index]
  return {
    label: 'Delete track',
    apply: (p) => removeTrack(p, trackId),
    invert: (p) => {
      if (removed === null) return p
      // Re-insert the removed track at its original position.
      const tracks = [...p.tracks]
      const clamped = Math.min(index, tracks.length)
      tracks.splice(clamped, 0, removed)
      return { ...p, tracks }
    }
  }
}

/** Add a clip to a track; invert removes it. */
export function addClipCommand(trackId: string, clip: Clip): Command {
  return {
    label: 'Add clip',
    apply: (p) => addClip(p, trackId, clip),
    invert: (p) => removeClip(p, clip.id)
  }
}

/**
 * Remove a clip; invert restores the owning track's exact pre-edit clip array
 * (snapshot captured at factory time) so ordering and values are identical.
 */
export function removeClipCommand(project: Project, clipId: string): Command {
  const found = locateClip(project, clipId)
  const trackId = found?.trackId ?? null
  const priorClips =
    trackId === null ? null : (project.tracks.find((t) => t.id === trackId)?.clips ?? null)
  return {
    label: 'Remove clip',
    apply: (p) => removeClip(p, clipId),
    invert: (p) =>
      trackId === null || priorClips === null ? p : restoreTrackClips(p, trackId, priorClips)
  }
}

/**
 * Move a clip to `start`; invert restores the prior `start` captured at factory
 * time from `project`.
 */
export function moveClipCommand(project: Project, clipId: string, start: number): Command {
  const found = locateClip(project, clipId)
  const prevStart = found?.clip.start ?? start
  return {
    label: 'Move clip',
    apply: (p) => moveClip(p, clipId, start),
    invert: (p) => moveClip(p, clipId, prevStart)
  }
}

/**
 * Move a clip to another track (CapCut-style vertical drag) AND set its `start`
 * in the same undoable step. Invert restores BOTH the clip's original track and
 * its prior `start`, captured at factory time. No-op invert when the clip was not
 * found (the apply is then also a no-op via the reducer's guards).
 */
export function moveClipToTrackCommand(
  project: Project,
  clipId: string,
  targetTrackId: string,
  start: number
): Command {
  const found = locateClip(project, clipId)
  const prevTrackId = found?.trackId ?? null
  const prevStart = found?.clip.start ?? start
  return {
    label: 'Move clip to track',
    apply: (p) => moveClipToTrack(p, clipId, targetTrackId, start),
    invert: (p) =>
      prevTrackId === null ? p : moveClipToTrack(p, clipId, prevTrackId, prevStart)
  }
}

/**
 * Auto-create a NEW track (`newTrackId`, `type`) at `index` and move the clip
 * onto it with `start`, as ONE undoable step (CapCut-style "drag past the last
 * lane, or onto a crowded lane, to spawn a fresh lane"). Invert moves the clip
 * back to its original track + start AND removes the new (now-empty) lane, all
 * captured at factory time. No-op invert when the clip was not found.
 */
export function moveClipToNewTrackCommand(
  project: Project,
  clipId: string,
  newTrackId: string,
  type: ProjectTrack['type'],
  start: number,
  index: number
): Command {
  const found = locateClip(project, clipId)
  const prevTrackId = found?.trackId ?? null
  const prevStart = found?.clip.start ?? start
  return {
    label: 'Move clip to new track',
    apply: (p) => moveClipToNewTrack(p, clipId, newTrackId, type, start, index),
    invert: (p) => {
      if (prevTrackId === null) return p
      const back = moveClipToTrack(p, clipId, prevTrackId, prevStart)
      return removeTrack(back, newTrackId)
    }
  }
}

/** Restore a single clip's in/out/start (used to invert a clamped trim). */
function restoreClipBounds(
  project: Project,
  clipId: string,
  bounds: { in: number; out: number; start: number }
): Project {
  return {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((c) =>
        c.id === clipId ? { ...c, in: bounds.in, out: bounds.out, start: bounds.start } : c
      )
    }))
  }
}

/**
 * Trim a clip edge by `delta` (clamped to media bounds + min length inside the
 * pure `trimClip` reducer; an optional `sourceDurationSec` caps the right edge —
 * undefined today, ffprobe in Phase 4). Because the clamp can shorten the
 * effective delta, the inverse is NOT simply `-delta`; instead the factory
 * captures the clip's prior in/out/start (from `project` at factory time) and
 * `invert` restores them exactly. `apply`/`invert` stay pure (no closures over
 * mutable state, no Date.now/Math.random).
 */
export function trimClipCommand(
  project: Project,
  clipId: string,
  edge: 'start' | 'end',
  delta: number,
  sourceDurationSec?: number
): Command {
  const found = locateClip(project, clipId)
  const prior =
    found === null
      ? null
      : { in: found.clip.in, out: found.clip.out, start: found.clip.start }
  return {
    label: 'Trim clip',
    apply: (p) => trimClip(p, clipId, edge, delta, sourceDurationSec),
    invert: (p) => (prior === null ? p : restoreClipBounds(p, clipId, prior))
  }
}

/**
 * Patch a clip's `transform` (P3.11 drag-to-move writes `x`/`y`; P3.12/P3.13
 * reuse it for rotation/flip/opacity/z). General over any subset of transform
 * keys. The inverse is NOT the same patch — it restores the PREVIOUS values for
 * exactly the patched keys, captured from `project` at factory time. Keys whose
 * value did not exist (clip absent) leave the patch empty so invert is a no-op.
 * `apply`/`invert` stay pure (no closures over mutable state, no Date.now/random).
 */
export function setClipTransformCommand(
  project: Project,
  clipId: string,
  patch: Partial<ClipTransform>
): Command {
  const found = locateClip(project, clipId)
  // Capture only the keys this patch touches, with their prior values, so
  // invert restores exactly what changed (and nothing it shouldn't).
  const prior: Partial<ClipTransform> = {}
  if (found !== null) {
    for (const key of Object.keys(patch) as (keyof ClipTransform)[]) {
      // Assigning each key from the prior transform; types line up per-key.
      ; (prior as Record<string, unknown>)[key] = found.clip.transform[key]
    }
  }
  return {
    label: 'Transform clip',
    apply: (p) => setClipTransform(p, clipId, patch),
    invert: (p) => (found === null ? p : setClipTransform(p, clipId, prior))
  }
}

/**
 * Patch a clip's `text` surface (P3.14 multi-line + manual breaks writes
 * `{lines}` / `{align}`). General over any subset of `ClipText` keys, mirroring
 * {@link setClipTransformCommand}: the inverse restores the PREVIOUS values for
 * exactly the patched keys, captured from `project` at factory time. A patched
 * key the clip's prior `text` did not define inverts back to `undefined` (so the
 * field is removed on undo). `apply`/`invert` stay pure (no closures over
 * mutable state, no Date.now/Math.random).
 */
export function setClipTextCommand(
  project: Project,
  clipId: string,
  patch: Partial<ClipText>
): Command {
  const found = locateClip(project, clipId)
  // Capture only the keys this patch touches, with their prior values, so
  // invert restores exactly what changed (undefined where it did not exist).
  const prior: Partial<ClipText> = {}
  if (found !== null) {
    const priorText = found.clip.text ?? {}
    for (const key of Object.keys(patch) as (keyof ClipText)[]) {
      ; (prior as Record<string, unknown>)[key] = (priorText as Record<string, unknown>)[key]
    }
  }
  return {
    label: 'Edit text',
    apply: (p) => setClipText(p, clipId, patch),
    invert: (p) => (found === null ? p : setClipText(p, clipId, prior))
  }
}

/**
 * Patch a clip's `audio` mix surface (P4.1 volume/fade writes `{gain}` /
 * `{fadeInSec}` / `{fadeOutSec}` / `{muted}`). General over any subset of
 * `ClipAudio` keys, mirroring {@link setClipTextCommand}: the inverse restores
 * the PREVIOUS values for exactly the patched keys, captured from `project` at
 * factory time. A patched key the clip's prior `audio` did not define inverts
 * back to `undefined` (so the field is removed on undo). `apply`/`invert` stay
 * pure (no closures over mutable state, no Date.now/Math.random).
 */
export function setClipAudioCommand(
  project: Project,
  clipId: string,
  patch: Partial<ClipAudio>
): Command {
  const found = locateClip(project, clipId)
  // Capture only the keys this patch touches, with their prior values, so
  // invert restores exactly what changed (undefined where it did not exist).
  const prior: Partial<ClipAudio> = {}
  if (found !== null) {
    const priorAudio = found.clip.audio ?? {}
    for (const key of Object.keys(patch) as (keyof ClipAudio)[]) {
      ; (prior as Record<string, unknown>)[key] = (priorAudio as Record<string, unknown>)[key]
    }
  }
  return {
    label: 'Adjust audio',
    apply: (p) => setClipAudio(p, clipId, patch),
    invert: (p) => (found === null ? p : setClipAudio(p, clipId, prior))
  }
}

/**
 * Patch a clip's `animation` surface (P8.5 In/Out/Loop text animation writes one
 * lane at a time: `{in}` / `{out}` / `{loop}`). General over any subset of
 * `ClipAnimation` lanes, mirroring {@link setClipTextCommand}: the inverse restores
 * the PREVIOUS values for exactly the patched LANES, captured from `project` at
 * factory time. A patched lane the clip's prior `animation` did not define inverts
 * back to `undefined` (so the lane is removed on undo). `apply`/`invert` stay pure
 * (no closures over mutable state, no Date.now/Math.random) — the same fields drive
 * the preview + export `evaluateClipAnimation`, so an animation edit is one undo step.
 */
export function setClipAnimationCommand(
  project: Project,
  clipId: string,
  patch: Partial<ClipAnimation>
): Command {
  const found = locateClip(project, clipId)
  // Capture only the lanes this patch touches, with their prior values, so
  // invert restores exactly what changed (undefined where it did not exist).
  const prior: Partial<ClipAnimation> = {}
  if (found !== null) {
    const priorAnim = found.clip.animation ?? {}
    for (const key of Object.keys(patch) as (keyof ClipAnimation)[]) {
      ; (prior as Record<string, unknown>)[key] = (priorAnim as Record<string, unknown>)[key]
    }
  }
  return {
    label: 'Edit animation',
    apply: (p) => setClipAnimation(p, clipId, patch),
    invert: (p) => (found === null ? p : setClipAnimation(p, clipId, prior))
  }
}

/**
 * Split a clip at time `t` into the original (`clipId`) + a new right clip
 * (`rightId`). Invert merges them back: it removes the right clip and restores
 * the original clip's `out` so the left half regains the full source window.
 */
export function splitClipCommand(
  project: Project,
  clipId: string,
  t: number,
  rightId: string
): Command {
  const found = locateClip(project, clipId)
  const originalOut = found?.clip.out ?? 0
  return {
    label: 'Split clip',
    apply: (p) => splitAtPlayhead(p, clipId, t, rightId),
    invert: (p) => {
      const withoutRight = removeClip(p, rightId)
      return {
        ...withoutRight,
        tracks: withoutRight.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((c) => (c.id === clipId ? { ...c, out: originalOut } : c))
        }))
      }
    }
  }
}

/**
 * Ripple-delete a clip; invert restores the affected track's exact pre-edit
 * clip array (snapshot captured at factory time), guaranteeing identical
 * ordering and values regardless of the ripple shift.
 */
export function rippleDeleteCommand(project: Project, clipId: string): Command {
  const found = locateClip(project, clipId)
  const trackId = found?.trackId ?? null
  const priorClips =
    trackId === null ? null : (project.tracks.find((t) => t.id === trackId)?.clips ?? null)
  return {
    label: 'Ripple delete',
    apply: (p) => rippleDelete(p, clipId),
    invert: (p) =>
      trackId === null || priorClips === null ? p : restoreTrackClips(p, trackId, priorClips)
  }
}

/**
 * Generate (or REGENERATE) the dedicated Caption track from already-grouped
 * caption clips (P4.7, Doc 02). One undoable step that:
 *   - creates the well-known Caption track ({@link CAPTION_TRACK_ID}, a `text`
 *     track) if it does not yet exist, then
 *   - REPLACES that track's clips with `clips` (so regenerating swaps the clips
 *     instead of duplicating the track — the runbook's "replace rather than add").
 *
 * Invert restores the pre-edit state EXACTLY: if the Caption track existed, its
 * prior clip array is restored (snapshot captured at factory time); if it did
 * not exist, invert removes the track that `apply` created. `apply`/`invert`
 * stay pure (no closures over mutable state, no Date.now/Math.random) — `clips`
 * (incl. their ids) are built by the caller via the pure `buildCaptionClips`.
 */
export function generateCaptionsCommand(project: Project, clips: Clip[]): Command {
  const existing = project.tracks.find((t) => t.id === CAPTION_TRACK_ID)
  const priorClips = existing?.clips ?? null
  return {
    label: 'Generate captions',
    apply: (p) => {
      // Ensure the track exists (addTrack is a no-op if present), then swap clips.
      const withTrack = addTrack(p, CAPTION_TRACK_ID, CAPTION_TRACK_TYPE)
      return replaceTrackClips(withTrack, CAPTION_TRACK_ID, clips)
    },
    invert: (p) =>
      priorClips === null
        ? // Track did not exist before — remove the one apply created.
        removeTrack(p, CAPTION_TRACK_ID)
        : // Track existed — restore its exact pre-edit clip array.
        restoreTrackClips(p, CAPTION_TRACK_ID, priorClips)
  }
}

/**
 * Apply a {@link CaptionPreset} to the whole Caption track (P5.4, Doc 03). ONE
 * undoable step that:
 *   - records the preset id on the project as `captions.styleId` (so a re-open +
 *     the active-word highlight know which preset the track wears), and
 *   - stamps the preset's clip-side style ({@link stampPresetOntoClips}) onto
 *     EVERY caption clip — text/animation/transform from the preset, while
 *     PRESERVING each clip's `text.lines`, `text.lang`, and `caption.words`.
 *
 * Invert restores the pre-edit state EXACTLY: the prior `captions` block (incl.
 * the prior `styleId`, or its absence) AND the Caption track's prior clip array
 * (snapshot captured at factory time) are restored verbatim. Because switching
 * presets replaces the style fields wholesale, undo never leaves a previous
 * preset's style behind. `apply`/`invert` stay pure (no closures over mutable
 * state, no Date.now/Math.random) — the `preset` is supplied by the caller.
 *
 * The caller should guard for a missing Caption track / unknown preset id before
 * building this command (the store action no-ops in those cases); given a valid
 * preset, `apply` is still safe (stamping is a no-op when no Caption track).
 */
export function applyCaptionPresetCommand(project: Project, preset: CaptionPreset): Command {
  const priorCaptions = project.captions
  const existing = project.tracks.find((t) => t.id === CAPTION_TRACK_ID)
  const priorClips = existing?.clips ?? null
  return {
    label: 'Apply caption style',
    apply: (p) => {
      const stamped = stampPresetOntoClips(p, preset)
      return { ...stamped, captions: { ...stamped.captions, styleId: preset.id } }
    },
    invert: (p) => {
      // Restore the prior captions block exactly (drop the key if it was absent).
      const restored: Project = priorCaptions === undefined
        ? (() => {
          const rest = { ...p } as Partial<Project>
          delete rest.captions
          return rest as Project
        })()
        : { ...p, captions: priorCaptions }
      // Restore the Caption track's prior clip array (if the track existed).
      return priorClips === null ? restored : restoreTrackClips(restored, CAPTION_TRACK_ID, priorClips)
    }
  }
}

/**
 * Set the caption POSITION on the whole Caption track (P5.8, Doc 03). ONE
 * undoable step that stamps the chosen `anchor` + the already-resolved,
 * safe-clamped center-relative pixel `y` onto EVERY caption clip's transform
 * ({@link setCaptionPositionOnClips}) — `clip.transform.captionAnchor = anchor`
 * and `clip.transform.y = y` — while leaving every other clip field untouched.
 *
 * Invert restores the Caption track's EXACT pre-edit clip array (snapshot
 * captured at factory time), so undo recovers each clip's prior `y`/anchor
 * verbatim regardless of how many clips moved. `apply`/`invert` stay pure (no
 * closures over mutable state, no Date.now/Math.random) — the resolved `y` is
 * computed by the caller via the pure aspect/safe-margin math.
 *
 * No-op (returns the project unchanged) when there is no Caption track.
 */
export function setCaptionPositionCommand(
  project: Project,
  anchor: LayoutAnchor,
  y: number,
  x?: number
): Command {
  const existing = project.tracks.find((t) => t.id === CAPTION_TRACK_ID)
  const priorClips = existing?.clips ?? null
  return {
    label: 'Set caption position',
    apply: (p) => setCaptionPositionOnClips(p, anchor, y, x),
    invert: (p) =>
      priorClips === null ? p : restoreTrackClips(p, CAPTION_TRACK_ID, priorClips)
  }
}

/**
 * Stamp a new font size onto every caption clip (undoable).
 * Captures the prior clips for exact undo.
 */
export function setCaptionFontSizeCommand(project: Project, size: number): Command {
  const existing = project.tracks.find((t) => t.id === CAPTION_TRACK_ID)
  const priorClips = existing?.clips ?? null
  return {
    label: 'Set caption font size',
    apply: (p) => setCaptionFontSizeOnClips(p, size),
    invert: (p) =>
      priorClips === null ? p : restoreTrackClips(p, CAPTION_TRACK_ID, priorClips)
  }
}

/**
 * Stamp a new font FAMILY onto every caption clip (undoable). Captures the prior
 * clips for exact undo. Lets the user switch the caption face (e.g. Baloo Thambi 2
 * → Noto Serif Tamil) independently of the applied style preset.
 */
export function setCaptionFontFamilyCommand(project: Project, family: string): Command {
  const existing = project.tracks.find((t) => t.id === CAPTION_TRACK_ID)
  const priorClips = existing?.clips ?? null
  return {
    label: 'Set caption font',
    apply: (p) => setCaptionFontFamilyOnClips(p, family),
    invert: (p) =>
      priorClips === null ? p : restoreTrackClips(p, CAPTION_TRACK_ID, priorClips)
  }
}

/**
 * Wrap caption text within each clip by word count — populates `text.lines` with
 * multiple elements (one per word chunk) without splitting into separate clips.
 * Captures prior clips for exact undo.
 */
export function wrapCaptionTextCommand(project: Project, maxWordsPerLine: number): Command {
  const existing = project.tracks.find((t) => t.id === CAPTION_TRACK_ID)
  const priorClips = existing?.clips ?? null
  return {
    label: 'Wrap caption text',
    apply: (p) => wrapCaptionClipsByWords(p, maxWordsPerLine),
    invert: (p) =>
      priorClips === null ? p : restoreTrackClips(p, CAPTION_TRACK_ID, priorClips)
  }
}

export function setCaptionLetterSpacingCommand(project: Project, letterSpacing: number): Command {
  const existing = project.tracks.find((t) => t.id === CAPTION_TRACK_ID)
  const priorClips = existing?.clips ?? null
  return {
    label: 'Set caption letter spacing',
    apply: (p) => setCaptionLetterSpacingOnClips(p, letterSpacing),
    invert: (p) =>
      priorClips === null ? p : restoreTrackClips(p, CAPTION_TRACK_ID, priorClips)
  }
}

export function setCaptionLineHeightCommand(project: Project, lineHeight: number): Command {
  const existing = project.tracks.find((t) => t.id === CAPTION_TRACK_ID)
  const priorClips = existing?.clips ?? null
  return {
    label: 'Set caption line spacing',
    apply: (p) => setCaptionLineHeightOnClips(p, lineHeight),
    invert: (p) =>
      priorClips === null ? p : restoreTrackClips(p, CAPTION_TRACK_ID, priorClips)
  }
}

export function setCaptionFillCommand(project: Project, fill: PresetFill): Command {
  const existing = project.tracks.find((t) => t.id === CAPTION_TRACK_ID)
  const priorClips = existing?.clips ?? null
  return {
    label: 'Set caption fill',
    apply: (p) => setCaptionFillOnClips(p, fill),
    invert: (p) =>
      priorClips === null ? p : restoreTrackClips(p, CAPTION_TRACK_ID, priorClips)
  }
}

export function setCaptionShadowCommand(project: Project, shadow: PresetShadow | null): Command {
  const existing = project.tracks.find((t) => t.id === CAPTION_TRACK_ID)
  const priorClips = existing?.clips ?? null
  return {
    label: 'Set caption shadow',
    apply: (p) => setCaptionShadowOnClips(p, shadow),
    invert: (p) =>
      priorClips === null ? p : restoreTrackClips(p, CAPTION_TRACK_ID, priorClips)
  }
}

export function setCaptionGlowCommand(
  project: Project,
  glow: { radius: number; color: string } | null
): Command {
  const existing = project.tracks.find((t) => t.id === CAPTION_TRACK_ID)
  const priorClips = existing?.clips ?? null
  return {
    label: 'Set caption glow',
    apply: (p) => setCaptionGlowOnClips(p, glow),
    invert: (p) =>
      priorClips === null ? p : restoreTrackClips(p, CAPTION_TRACK_ID, priorClips)
  }
}

export function setCaptionStrokeCommand(project: Project, stroke: PresetStrokeLayer[]): Command {
  const existing = project.tracks.find((t) => t.id === CAPTION_TRACK_ID)
  const priorClips = existing?.clips ?? null
  return {
    label: 'Set caption stroke',
    apply: (p) => setCaptionStrokeOnClips(p, stroke),
    invert: (p) =>
      priorClips === null ? p : restoreTrackClips(p, CAPTION_TRACK_ID, priorClips)
  }
}

/**
 * Remove-silence (P4.11, Doc 02): ripple the detected silence/filler `ranges`
 * out of EVERY track in lock-step (audio clips trimmed, downstream clips shifted
 * earlier, caption clips + their per-word timing shifted by the same map). ONE
 * undoable step. Because the edit touches every track (clips dropped, trimmed,
 * and shifted), the inverse cannot be a mirror reducer — the factory captures the
 * ENTIRE pre-edit `tracks` snapshot from `project` and `invert` restores it
 * verbatim, guaranteeing exact ordering/values regardless of how many cuts ran.
 * `apply`/`invert` stay pure (no closures over mutable state, no Date.now/random).
 */
export function removeSilenceCommand(project: Project, ranges: readonly TimeRange[]): Command {
  const priorTracks = project.tracks
  return {
    label: 'Remove silence',
    apply: (p) => rippleRemoveRanges(p, ranges),
    invert: (p) => ({ ...p, tracks: priorTracks })
  }
}

/**
 * Ripple-insert a clip onto a track; invert restores the track's exact pre-edit
 * clip array (snapshot captured at factory time). This reverses both the
 * downstream shift and the append, preserving original ordering. Captured at
 * apply time would be impure, so the caller supplies `project`.
 */
export function rippleInsertCommand(project: Project, trackId: string, clip: Clip): Command {
  const priorClips = project.tracks.find((t) => t.id === trackId)?.clips ?? null
  return {
    label: 'Ripple insert',
    apply: (p) => rippleInsert(p, trackId, clip),
    invert: (p) => (priorClips === null ? p : restoreTrackClips(p, trackId, priorClips))
  }
}

// ---------------------------------------------------------------------------
// Keyframe-lane commands (P8.6, Doc 11). Because add/move/delete an entry into
// a sorted, deduped lane cannot be reversed by a mirror reducer (the prior
// ordering/values/dropped-duplicate are not recoverable from the args), each
// factory CAPTURES the clip's prior `prop` lane from `project` at factory time
// and `invert` restores it verbatim — exactly the snapshot pattern the
// trim/remove/caption commands use. `apply`/`invert` stay pure (no closures
// over mutable state, no Date.now/Math.random).
// ---------------------------------------------------------------------------

/**
 * Restore a single clip's `prop` keyframe lane to `priorLane` (immutably). An
 * empty `priorLane` removes the lane (and `keyframes` if it was the only one),
 * so undoing a freshly-added FIRST keyframe leaves a keyframe-less clip exactly.
 */
function restoreClipLane(
  project: Project,
  clipId: string,
  prop: KeyframeProp,
  priorLane: Keyframe[]
): Project {
  return {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((c) => {
        if (c.id !== clipId) return c
        const merged = { ...c.keyframes }
        if (priorLane.length === 0) delete merged[prop]
        else merged[prop] = priorLane
        if (Object.keys(merged).length === 0) {
          const rest = { ...c } as Partial<Clip>
          delete rest.keyframes
          return rest as Clip
        }
        return { ...c, keyframes: merged }
      })
    }))
  }
}

/** Snapshot a clip's `prop` lane (empty array when the clip/lane is absent). */
function captureLane(project: Project, clipId: string, prop: KeyframeProp): Keyframe[] {
  const found = locateClip(project, clipId)
  return found === null ? [] : getLane(found.clip, prop)
}

/**
 * Add a keyframe to `clipId`'s `prop` lane at clip-local time `t` with `value`
 * (per-segment `ease` defaults `linear`). Invert restores the lane's exact
 * pre-edit snapshot (so an added duplicate-time replacement or a first keyframe
 * both undo cleanly).
 */
export function addKeyframeCommand(
  project: Project,
  clipId: string,
  prop: KeyframeProp,
  t: number,
  value: number,
  ease: EasingName = 'linear'
): Command {
  const priorLane = captureLane(project, clipId, prop)
  return {
    label: 'Add keyframe',
    apply: (p) => addKeyframe(p, clipId, prop, t, value, ease),
    invert: (p) => restoreClipLane(p, clipId, prop, priorLane)
  }
}

/**
 * Move the keyframe at `index` of `clipId`'s `prop` lane to `newTime` (clamped
 * to the clip), optionally to `newValue`. Invert restores the lane's exact
 * pre-edit snapshot (recovers ordering + any duplicate the move dropped).
 */
export function moveKeyframeCommand(
  project: Project,
  clipId: string,
  prop: KeyframeProp,
  index: number,
  newTime: number,
  newValue?: number
): Command {
  const priorLane = captureLane(project, clipId, prop)
  return {
    label: 'Move keyframe',
    apply: (p) => moveKeyframe(p, clipId, prop, index, newTime, newValue),
    invert: (p) => restoreClipLane(p, clipId, prop, priorLane)
  }
}

/**
 * Delete the keyframe at `index` of `clipId`'s `prop` lane. Invert restores the
 * lane's exact pre-edit snapshot (re-adds the removed keyframe in place).
 */
export function deleteKeyframeCommand(
  project: Project,
  clipId: string,
  prop: KeyframeProp,
  index: number
): Command {
  const priorLane = captureLane(project, clipId, prop)
  return {
    label: 'Delete keyframe',
    apply: (p) => deleteKeyframe(p, clipId, prop, index),
    invert: (p) => restoreClipLane(p, clipId, prop, priorLane)
  }
}

/**
 * Set the per-segment `ease` on the keyframe at `index` of `clipId`'s `prop`
 * lane (the easing governing the segment leaving it). Invert restores the lane's
 * exact pre-edit snapshot (recovers the prior easing, or its absence).
 */
export function setKeyframeEasingCommand(
  project: Project,
  clipId: string,
  prop: KeyframeProp,
  index: number,
  ease: EasingName
): Command {
  const priorLane = captureLane(project, clipId, prop)
  return {
    label: 'Set keyframe easing',
    apply: (p) => setKeyframeEasing(p, clipId, prop, index, ease),
    invert: (p) => restoreClipLane(p, clipId, prop, priorLane)
  }
}

/**
 * Set (or clear, with `undefined`) a clip's custom MOTION PATH (P8.8, Doc 11) as
 * ONE undoable command. Invert restores the clip's EXACT prior `motionPath` (its
 * previous path, or its ABSENCE — so drawing a first path undoes back to no path,
 * and clearing a path undoes back to the drawn path). The prior value is captured
 * from `project` at factory time so `apply`/`invert` stay pure.
 */
export function setClipMotionPathCommand(
  project: Project,
  clipId: string,
  path: ClipMotionPath | undefined
): Command {
  const found = locateClip(project, clipId)
  const priorPath = found?.clip.motionPath
  return {
    label: path === undefined ? 'Clear motion path' : 'Set motion path',
    apply: (p) => setClipMotionPath(p, clipId, path),
    invert: (p) => (found === null ? p : setClipMotionPath(p, clipId, priorPath))
  }
}

/**
 * Set (or clear, with `undefined`) a clip's MOTION-TRACKING attachment (P8.9, Doc 11)
 * as ONE undoable command. Used both when a fresh track is run (attach the provider's
 * {@link ClipTracking}) and when a manual anchor correction (P8.10) re-writes the
 * `path`. Invert restores the clip's EXACT prior `tracking` (its previous attachment,
 * or its ABSENCE — so a first track undoes back to untracked, and a correction undoes
 * back to the prior path). The prior value is captured from `project` at factory time
 * so `apply`/`invert` stay pure.
 */
export function setClipTrackingCommand(
  project: Project,
  clipId: string,
  tracking: ClipTracking | undefined
): Command {
  const found = locateClip(project, clipId)
  const priorTracking = found?.clip.tracking
  return {
    label: tracking === undefined ? 'Clear tracking' : 'Set tracking',
    apply: (p) => setClipTracking(p, clipId, tracking),
    invert: (p) => (found === null ? p : setClipTracking(p, clipId, priorTracking))
  }
}

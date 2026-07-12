/**
 * Pure timeline reducers (timeline-engine skill — track/clip operations).
 *
 * Each function takes a `Project` and returns a NEW `Project` (immutable; the
 * input is never mutated). These are the core building blocks; full snapping
 * (P3.5) and clamp-to-media (P3.6) refine them later. Clip duration is always
 * DERIVED as `out - in`.
 *
 * Headless-safe: NO DOM / electron / node imports, NO Math.random / Date.now —
 * any new id is supplied by the caller. Proven by node-env vitest.
 */

import type { Project, ProjectTrack } from '../../../shared/storage'
import type {
  Clip,
  ClipAnimation,
  ClipAudio,
  ClipMotionPath,
  ClipText,
  ClipTracking,
  ClipTransform
} from '../../../shared/project-schema'
import { defaultClipAudio } from '../../../shared/project-schema'
import { clampTrim } from './trim'

/** Locate the track that owns `clipId`, returning its index, or -1. */
function findTrackIndexByClip(project: Project, clipId: string): number {
  return project.tracks.findIndex((t) => t.clips.some((c) => c.id === clipId))
}

/** Replace the track at `trackIndex` with `nextClips`, returning a new Project. */
function withTrackClips(project: Project, trackIndex: number, nextClips: Clip[]): Project {
  const tracks = project.tracks.map((t, i): ProjectTrack =>
    i === trackIndex ? { ...t, clips: nextClips } : t
  )
  return { ...project, tracks }
}

/** Source/timeline duration of a clip (`out - in`). */
export function clipLength(clip: Clip): number {
  return clip.out - clip.in
}

/**
 * Find the first clip (across all tracks, in track then clip order) whose
 * timeline span `[start, start + duration)` STRICTLY contains `t`, i.e.
 * `start < t < start + duration`. Returns the clip's id, or null if none —
 * matching `splitAtPlayhead`'s interior-only cut guard. Pure (no DOM/random).
 */
export function clipIdContainingTime(project: Project, t: number): string | null {
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      const end = clip.start + clipLength(clip)
      if (t > clip.start && t < end) return clip.id
    }
  }
  return null
}

/**
 * Append a new, empty track (caller-supplied `trackId` — no random ids here).
 * No-op if a track with that id already exists. Pure: returns a new Project.
 */
export function addTrack(
  project: Project,
  trackId: string,
  type: ProjectTrack['type']
): Project {
  if (project.tracks.some((t) => t.id === trackId)) return project
  const track: ProjectTrack = { id: trackId, type, clips: [] }
  return { ...project, tracks: [...project.tracks, track] }
}

/** Remove the track with `trackId` (and its clips). No-op if absent. */
export function removeTrack(project: Project, trackId: string): Project {
  if (!project.tracks.some((t) => t.id === trackId)) return project
  return { ...project, tracks: project.tracks.filter((t) => t.id !== trackId) }
}

/**
 * Insert a new, empty track at `index` (clamped to `[0, tracks.length]`) instead
 * of always appending like {@link addTrack}. Used by the CapCut-style "drag past
 * the last lane / drop onto a crowded lane → auto-create a new lane" flow, which
 * wants the fresh lane to appear right where it was dropped. No-op if a track
 * with that id already exists. Pure: returns a new Project.
 */
export function insertTrack(
  project: Project,
  trackId: string,
  type: ProjectTrack['type'],
  index: number
): Project {
  if (project.tracks.some((t) => t.id === trackId)) return project
  const track: ProjectTrack = { id: trackId, type, clips: [] }
  const tracks = [...project.tracks]
  const clamped = Math.max(0, Math.min(index, tracks.length))
  tracks.splice(clamped, 0, track)
  return { ...project, tracks }
}

/**
 * True when placing a clip of `durationSec` at `start` on the track `trackId`
 * would OVERLAP an existing clip on that track (half-open spans: `[start, end)`).
 * The clip being moved is excluded via `ignoreClipId` so a clip never collides
 * with itself. Used to decide whether a drop lands on a crowded lane (→ spawn a
 * new lane) or is free (→ a plain move). No-op-safe: unknown track → false. Pure.
 */
export function wouldOverlapOnTrack(
  project: Project,
  trackId: string,
  start: number,
  durationSec: number,
  ignoreClipId?: string
): boolean {
  const track = project.tracks.find((t) => t.id === trackId)
  if (track === undefined) return false
  const end = start + durationSec
  for (const c of track.clips) {
    if (c.id === ignoreClipId) continue
    const cEnd = c.start + (c.out - c.in)
    if (start < cEnd && c.start < end) return true
  }
  return false
}

/** Append `clip` to the track with `trackId`. No-op if the track is absent. */
export function addClip(project: Project, trackId: string, clip: Clip): Project {
  const trackIndex = project.tracks.findIndex((t) => t.id === trackId)
  if (trackIndex === -1) return project
  const track = project.tracks[trackIndex]
  return withTrackClips(project, trackIndex, [...track.clips, clip])
}

/**
 * Replace the entire clip array of the track with `trackId` (used by Caption
 * regeneration, P4.7, to swap all caption clips in one step rather than
 * remove/add per clip). No-op if the track is absent. Pure: returns a new Project.
 */
export function replaceTrackClips(project: Project, trackId: string, clips: Clip[]): Project {
  const trackIndex = project.tracks.findIndex((t) => t.id === trackId)
  if (trackIndex === -1) return project
  return withTrackClips(project, trackIndex, clips)
}

/** Remove the clip with `clipId` from its track. No-op if absent. */
export function removeClip(project: Project, clipId: string): Project {
  const trackIndex = findTrackIndexByClip(project, clipId)
  if (trackIndex === -1) return project
  const track = project.tracks[trackIndex]
  return withTrackClips(
    project,
    trackIndex,
    track.clips.filter((c) => c.id !== clipId)
  )
}

/** Set a clip's timeline `start` (seconds). No-op if absent. */
export function moveClip(project: Project, clipId: string, start: number): Project {
  const trackIndex = findTrackIndexByClip(project, clipId)
  if (trackIndex === -1) return project
  const track = project.tracks[trackIndex]
  return withTrackClips(
    project,
    trackIndex,
    track.clips.map((c) => (c.id === clipId ? { ...c, start } : c))
  )
}

/**
 * Move a clip to another track (CapCut-style vertical drag between rows) and set
 * its timeline `start` in the same step. The clip is removed from its current
 * track and appended to the track with `targetTrackId`. No-op when: the clip is
 * absent, the target track is absent, the target IS the clip's current track
 * (use `moveClip` for that), or the target track's TYPE differs from the source
 * track's type (a video clip can only land on another video track, etc.). Pure +
 * immutable — other tracks/clips untouched.
 */
export function moveClipToTrack(
  project: Project,
  clipId: string,
  targetTrackId: string,
  start: number
): Project {
  const sourceIndex = findTrackIndexByClip(project, clipId)
  if (sourceIndex === -1) return project
  const source = project.tracks[sourceIndex]
  if (source.id === targetTrackId) return project
  const targetIndex = project.tracks.findIndex((t) => t.id === targetTrackId)
  if (targetIndex === -1) return project
  const target = project.tracks[targetIndex]
  // Only same-type moves are allowed (CapCut keeps clips on matching lanes).
  if (target.type !== source.type) return project

  const clip = source.clips.find((c) => c.id === clipId)
  if (clip === undefined) return project
  const moved: Clip = { ...clip, start }

  const tracks = project.tracks.map((t): ProjectTrack => {
    if (t.id === source.id) return { ...t, clips: t.clips.filter((c) => c.id !== clipId) }
    if (t.id === target.id) return { ...t, clips: [...t.clips, moved] }
    return t
  })
  return { ...project, tracks }
}

/**
 * Auto-create a NEW empty track (`newTrackId`, `type`) at `index` and move the
 * clip onto it with the given `start`, in ONE pure step. Backs the CapCut-style
 * "drag a clip past the last lane, or onto a crowded lane, to spawn a fresh lane"
 * gesture. No-op when: the clip is absent, `newTrackId` already exists, or the
 * new lane's `type` does not match the clip's current track type (a clip only
 * ever lands on a lane of its own kind). Pure + immutable.
 */
export function moveClipToNewTrack(
  project: Project,
  clipId: string,
  newTrackId: string,
  type: ProjectTrack['type'],
  start: number,
  index: number
): Project {
  const sourceIndex = findTrackIndexByClip(project, clipId)
  if (sourceIndex === -1) return project
  if (project.tracks[sourceIndex].type !== type) return project
  if (project.tracks.some((t) => t.id === newTrackId)) return project
  const withTrack = insertTrack(project, newTrackId, type, index)
  return moveClipToTrack(withTrack, clipId, newTrackId, start)
}

/**
 * Merge a partial transform `patch` into the clip's `transform` (P3.11–P3.13:
 * position/scale/rotation/flip/opacity/z). General-purpose so the positioning,
 * rotation, flip, and layer-order commands all share one reducer. The patch is
 * shallow-merged over the existing transform, so unspecified keys are kept.
 * No-op if the clip is absent. Pure + immutable (other clips untouched).
 */
export function setClipTransform(
  project: Project,
  clipId: string,
  patch: Partial<ClipTransform>
): Project {
  const trackIndex = findTrackIndexByClip(project, clipId)
  if (trackIndex === -1) return project
  const track = project.tracks[trackIndex]
  return withTrackClips(
    project,
    trackIndex,
    track.clips.map((c) => (c.id === clipId ? { ...c, transform: { ...c.transform, ...patch } } : c))
  )
}

/**
 * Merge a partial `ClipText` `patch` into the clip's `text` surface (P3.14:
 * multi-line text content + manual line breaks; `clips[].text.lines` /
 * `clips[].text.align`). The patch is shallow-merged over the existing `text`,
 * creating an empty `text` object first if the clip has none. Unspecified keys
 * are kept. No-op if the clip is absent. Pure + immutable (other clips & the
 * clip's `transform` untouched).
 *
 * NOTE (Phase 6): only `lines`/`align` are exercised this phase. The full
 * typography surface (`font`/`fill`/`stroke`/`shadow`/`effects`/`runs`) is
 * deferred to Phases 5/6 — this reducer already merges any `ClipText` key, so
 * those phases reuse it without change.
 */
export function setClipText(
  project: Project,
  clipId: string,
  patch: Partial<ClipText>
): Project {
  const trackIndex = findTrackIndexByClip(project, clipId)
  if (trackIndex === -1) return project
  const track = project.tracks[trackIndex]
  return withTrackClips(
    project,
    trackIndex,
    track.clips.map((c) => (c.id === clipId ? { ...c, text: { ...c.text, ...patch } } : c))
  )
}

/**
 * Focused convenience over {@link setClipText} for the common manual-break edit:
 * replace the clip's `text.lines` with `lines` (the textarea value split on
 * `\n`). No-op if the clip is absent. Pure + immutable.
 */
export function setClipTextLines(project: Project, clipId: string, lines: string[]): Project {
  return setClipText(project, clipId, { lines })
}

/**
 * Merge a partial `ClipAudio` `patch` into the clip's `audio` mix surface (P4.1:
 * per-clip gain + fade-in/out). The patch is shallow-merged over the existing
 * `audio`, seeding a neutral mix (unity gain, no fades) first if the clip has
 * none, so a video clip can gain an audio mix without losing schema validity.
 * Unspecified keys are kept. No-op if the clip is absent. Pure + immutable
 * (other clips & the clip's `transform`/`text` untouched).
 *
 * The fields are export-representable (FFmpeg `volume`/`afade`), so the same
 * values drive preview and export (parity, master plan §6).
 */
export function setClipAudio(
  project: Project,
  clipId: string,
  patch: Partial<ClipAudio>
): Project {
  const trackIndex = findTrackIndexByClip(project, clipId)
  if (trackIndex === -1) return project
  const track = project.tracks[trackIndex]
  return withTrackClips(
    project,
    trackIndex,
    track.clips.map((c) =>
      c.id === clipId ? { ...c, audio: { ...defaultClipAudio(), ...c.audio, ...patch } } : c
    )
  )
}

/**
 * Merge a partial `ClipAnimation` `patch` into the clip's `animation` surface
 * (P8.5 In/Out/Loop text animation; `clips[].animation.{in|out|loop|reveal}`).
 * The patch is shallow-merged over the existing `animation`, creating an empty
 * `animation` object first if the clip has none, so a text/caption clip can gain
 * an animation lane without losing schema validity. Unspecified LANES are kept
 * (patching `{in}` never disturbs an existing `{out}` / `{loop}` / `{reveal}`),
 * so the panel's tab-by-tab edits each preserve the other lanes' configs. The
 * merge is one lane DEEP — a patched lane REPLACES that lane wholesale (the panel
 * always writes a complete lane object), which is the intended "set this lane".
 *
 * No-op if the clip is absent. Pure + immutable (other clips & the clip's
 * `transform`/`text`/`audio` untouched). The fields drive the SAME
 * `evaluateClipAnimation` the preview + export read, so preview = export (parity).
 */
export function setClipAnimation(
  project: Project,
  clipId: string,
  patch: Partial<ClipAnimation>
): Project {
  const trackIndex = findTrackIndexByClip(project, clipId)
  if (trackIndex === -1) return project
  const track = project.tracks[trackIndex]
  return withTrackClips(
    project,
    trackIndex,
    track.clips.map((c) => {
      if (c.id !== clipId) return c
      // Merge the patched lane(s), then PRUNE any lane explicitly set to
      // `undefined` (a patch key whose prior value did not exist — the undo path)
      // so undoing a newly-added lane removes it cleanly. If no lanes remain, drop
      // the `animation` key entirely so an invert restores a lane-less clip exactly.
      const merged: Record<string, unknown> = { ...c.animation, ...patch }
      for (const key of Object.keys(merged)) {
        if (merged[key] === undefined) delete merged[key]
      }
      if (Object.keys(merged).length === 0) {
        const rest = { ...c } as Partial<Clip>
        delete rest.animation
        return rest as Clip
      }
      return { ...c, animation: merged as ClipAnimation }
    })
  )
}

/**
 * Set (or CLEAR) a clip's custom MOTION PATH (P8.8, Doc 11 — `clips[].motionPath`).
 * `path === undefined` (or a path with no points) CLEARS the path — the `motionPath`
 * key is dropped entirely so an undo back to a path-less clip is exact (the sampler
 * treats an absent path as identity). Otherwise the whole path is replaced (drawing
 * is a full re-capture, not an incremental edit). No-op when the clip is absent.
 * Pure + immutable.
 */
export function setClipMotionPath(
  project: Project,
  clipId: string,
  path: ClipMotionPath | undefined
): Project {
  const trackIndex = findTrackIndexByClip(project, clipId)
  if (trackIndex === -1) return project
  const track = project.tracks[trackIndex]
  return withTrackClips(
    project,
    trackIndex,
    track.clips.map((c) => {
      if (c.id !== clipId) return c
      if (path === undefined || path.points.length === 0) {
        const rest = { ...c } as Partial<Clip>
        delete rest.motionPath
        return rest as Clip
      }
      return { ...c, motionPath: path }
    })
  )
}

/**
 * Set (or CLEAR) a clip's MOTION-TRACKING attachment (P8.9, Doc 11 —
 * `clips[].tracking`). `tracking === undefined` CLEARS it — the `tracking` key is
 * dropped entirely so an undo back to an untracked clip is exact (the compositor
 * treats an absent tracking as no offset). Otherwise the whole attachment is
 * replaced (a re-track is a full re-capture). The tracked `path` is persisted
 * verbatim from the provider's {@link import('../../../shared/tracking').TrackPath};
 * `enabled` toggles whether it drives the transform without losing the data; manual
 * anchor corrections (P8.10) replace `path` through this same reducer. No-op when the
 * clip is absent. Pure + immutable.
 */
export function setClipTracking(
  project: Project,
  clipId: string,
  tracking: ClipTracking | undefined
): Project {
  const trackIndex = findTrackIndexByClip(project, clipId)
  if (trackIndex === -1) return project
  const track = project.tracks[trackIndex]
  return withTrackClips(
    project,
    trackIndex,
    track.clips.map((c) => {
      if (c.id !== clipId) return c
      if (tracking === undefined) {
        const rest = { ...c } as Partial<Clip>
        delete rest.tracking
        return rest as Clip
      }
      return { ...c, tracking }
    })
  )
}

/**
 * Trim a clip edge by `delta` seconds (positive grows the source window),
 * CLAMPED to media bounds + minimum clip length via the pure `clampTrim` helper
 * (P3.6) — the SAME helper the UI uses for its live preview, so preview and
 * commit always agree.
 *
 * - `'start'`: shift the source `in` by `delta` AND the timeline `start` by the
 *   same (clamped) amount, so the kept frames stay anchored on the timeline.
 *   Clamped so `in >= 0` and `out - in >= MIN_CLIP_SEC`.
 * - `'end'`:   shift the source `out` by `delta`. Clamped so
 *   `out - in >= MIN_CLIP_SEC`; the right edge extends freely unless an optional
 *   `sourceDurationSec` (Phase 4 / ffprobe) caps it.
 *
 * No-op if the clip is absent. Pure + immutable.
 */
export function trimClip(
  project: Project,
  clipId: string,
  edge: 'start' | 'end',
  delta: number,
  sourceDurationSec?: number
): Project {
  const trackIndex = findTrackIndexByClip(project, clipId)
  if (trackIndex === -1) return project
  const track = project.tracks[trackIndex]
  return withTrackClips(
    project,
    trackIndex,
    track.clips.map((c) => {
      if (c.id !== clipId) return c
      const next = clampTrim(c, edge, delta, sourceDurationSec)
      return { ...c, in: next.in, out: next.out, start: next.start }
    })
  )
}

/**
 * Split the clip with `clipId` at absolute timeline time `t`, producing two
 * clips that share `mediaRef`. The left keeps the original `id`; the right gets
 * `rightId` (caller-supplied — no random ids here). The cut maps to source
 * offset `localOffset = t - clip.start`, so:
 *   left:  in=in,            out=in+localOffset, start=start
 *   right: in=in+localOffset, out=out,           start=t
 * No-op if the clip is absent or `t` falls outside the clip's timeline span.
 */
export function splitAtPlayhead(
  project: Project,
  clipId: string,
  t: number,
  rightId: string
): Project {
  const trackIndex = findTrackIndexByClip(project, clipId)
  if (trackIndex === -1) return project
  const track = project.tracks[trackIndex]
  const clip = track.clips.find((c) => c.id === clipId)
  if (clip === undefined) return project

  const clipEnd = clip.start + clipLength(clip)
  if (t <= clip.start || t >= clipEnd) return project

  const localOffset = t - clip.start
  const left: Clip = { ...clip, out: clip.in + localOffset }
  const right: Clip = { ...clip, id: rightId, in: clip.in + localOffset, start: t }

  const nextClips: Clip[] = []
  for (const c of track.clips) {
    if (c.id === clipId) {
      nextClips.push(left, right)
    } else {
      nextClips.push(c)
    }
  }
  return withTrackClips(project, trackIndex, nextClips)
}

/**
 * Ripple-delete `clipId`: remove it and shift every later clip on the SAME
 * track left by the deleted clip's duration (closing the gap). "Later" =
 * `start >= deletedStart`. No-op if absent.
 */
export function rippleDelete(project: Project, clipId: string): Project {
  const trackIndex = findTrackIndexByClip(project, clipId)
  if (trackIndex === -1) return project
  const track = project.tracks[trackIndex]
  const deleted = track.clips.find((c) => c.id === clipId)
  if (deleted === undefined) return project
  const gap = clipLength(deleted)

  const nextClips = track.clips
    .filter((c) => c.id !== clipId)
    .map((c) => (c.start >= deleted.start ? { ...c, start: c.start - gap } : c))
  return withTrackClips(project, trackIndex, nextClips)
}

/**
 * Ripple-insert `clip` onto `trackId`: push every existing clip whose `start`
 * is at or after `clip.start` to the right by the inserted clip's duration,
 * then add the new clip. No-op if the track is absent.
 */
export function rippleInsert(project: Project, trackId: string, clip: Clip): Project {
  const trackIndex = project.tracks.findIndex((t) => t.id === trackId)
  if (trackIndex === -1) return project
  const track = project.tracks[trackIndex]
  const width = clipLength(clip)

  const shifted = track.clips.map((c) =>
    c.start >= clip.start ? { ...c, start: c.start + width } : c
  )
  return withTrackClips(project, trackIndex, [...shifted, clip])
}

import { create } from 'zustand'
import type {
  Clip,
  ClipAnimation,
  ClipAudio,
  ClipMotionPath,
  ClipText,
  ClipTracking,
  ClipTransform,
  KeyframeProp,
  MotionPathPoint
} from '../../shared/project-schema'
import { clipDuration } from '../../shared/project-schema'
import type { TargetBox } from '../../shared/tracking'
import type { EasingName } from '../../shared/easing'
import type { MediaKind, ProjectRef, ProjectTrack } from '../../shared/storage'
import type { LanguageCode, Transcript } from '../../shared/stt'
import type { TTSLanguageCode, TTSVoice, TTSSynthesizeResult } from '../../shared/tts'
import type { ExportJob } from '../../shared/export'
import type { CaptionTranslation } from '../../shared/translation'
import type { KeywordHighlight } from '../../shared/keywordHighlight'
import { detectKeywords } from '../../shared/keywordHighlight'
import type { CaptionLine, GroupingOptions } from '../../shared/captionSync'
import { resyncTranscript } from '../../shared/captionSync'
import type { LyricsAlignmentResult } from '../../shared/lyricsFirst'
import type { UserPreset } from '../../shared/userPreset'
import {
  applyPresetStyleToClipText,
  resolveVariant,
  type AspectKey
} from '../../shared/userPreset'
import { useProjectStore } from './projectStore'
import { getCaptionPreset } from '../../shared/captionPresetRegistry'
import {
  CAPTION_TRACK_ID,
  addClipCommand,
  addTrackCommand,
  applyCaptionPresetCommand,
  buildAudioClip,
  buildCaptionClips,
  buildCaptionClipsFromTranscript,
  buildImportedClip,
  DEFAULT_IMPORT_DURATION_SEC,
  buildTextClip,
  clipIdContainingTime,
  clipLength,
  frameToSeconds,
  generateCaptionsCommand,
  moveClipCommand,
  moveClipToTrackCommand,
  moveClipToNewTrackCommand,
  removeClipCommand,
  removeTrackCommand,
  removeSilenceCommand,
  detectSilenceRanges,
  totalRemoved,
  type DetectSilenceConfig,
  type TimeRange,
  rippleDeleteCommand,
  rippleInsertCommand,
  addKeyframeCommand,
  moveKeyframeCommand,
  deleteKeyframeCommand,
  setKeyframeEasingCommand,
  setClipMotionPathCommand,
  setClipTrackingCommand,
  setClipAnimationCommand,
  setClipAudioCommand,
  setClipTextCommand,
  setClipTransformCommand,
  linesEqual,
  valueToLines,
  snapToFrame,
  splitClipCommand,
  trackEndSeconds,
  transcriptFromCaptionClips,
  trimClipCommand,
  setCaptionPositionCommand,
  setCaptionPositionOnClip,
  setCaptionFontSizeCommand,
  setCaptionFontFamilyCommand,
  setCaptionLetterSpacingCommand,
  setCaptionLineHeightCommand,
  setCaptionFillCommand,
  setCaptionShadowCommand,
  setCaptionGlowCommand,
  setCaptionStrokeCommand,
  wrapCaptionTextCommand
} from './timeline'
import { projectDurationSec } from '../routes/editor/timeline/scale'
import { lowConfidenceFraction } from '../routes/editor/timeline/confidenceHeatmap'
import { mediaRefToUrl } from '../routes/editor/preview/mediaSource'
import type { LayoutAnchor, PresetFill, PresetShadow, PresetStrokeLayer } from '../../shared/captionPreset'
import type { Aspect } from '../routes/home/aspect'
import { resolveCaptionY, DEFAULT_CAPTION_BLOCK_HEIGHT } from '../../shared/captionPosition'
import { resolutionForAspect } from '../routes/home/aspect'
import {
  setClipTransitionCommand,
  type SetClipTransitionPayload
} from './timeline/clipTransitionCommand'

/**
 * Timeline UI / view-state slice (timeline-engine skill).
 *
 * THIS SLICE HOLDS VIEW STATE ONLY — selection, zoom, snap, and the playhead.
 * The tracks/clips themselves are the SINGLE SOURCE OF TRUTH in
 * `projectStore.currentProject.tracks` (it persists); this slice MIRRORS them by
 * reading from there and never duplicates the clip arrays.
 *
 * PLAYHEAD OWNERSHIP (constraint A): the authoritative playhead lives HERE for
 * Phase 3. The P3.8 rAF clock will drive THIS `playhead` field — there must be
 * exactly one. `editorStore.playhead` is the legacy placeholder from P2 and is
 * NOT driven by the clock; new code reads/writes the timeline-slice playhead.
 * editorStore is left as-is (no breaking change) and should be considered
 * deprecated for playhead/selection once Phase 3 UI lands.
 *
 * Edit operations are thin wrappers that build a `Command` from the pure
 * command factories and dispatch through the existing
 * `projectStore.runCommand`, so every timeline edit is undoable.
 */

/** Outcome of a media-import flow (P3.3), surfaced to the Media panel. */
export type ImportMediaResult =
  | { ok: true; imported: number }
  | { ok: false; error: string }

/**
 * Outcome of an audio-import flow (P4.1), surfaced to the Audio panel. On
 * success returns the imported audio clip id (or null when the dialog was
 * cancelled / nothing imported) and the bundle-relative `mediaRef` so the panel
 * can decode its waveform.
 */
export type ImportAudioResult =
  | { ok: true; clipId: string | null; mediaRef: string | null }
  | { ok: false; error: string }

/** Outcome of the FFmpeg normalize-to-WAV flow (P4.1). */
export type NormalizeAudioResult =
  | { ok: true; wavRef: string }
  | { ok: false; error: string }

/**
 * Outcome of the STT transcribe flow (P4.4, Doc 02). On success returns the
 * word-level {@link Transcript} (detected language + words[]) that P4.6 groups
 * into caption lines and writes to `captions.transcript`/`language`.
 */
export type TranscribeResult =
  | { ok: true; transcript: Transcript }
  | { ok: false; error: string }

/** Outcome of lyrics-first forced alignment (known lyrics -> timing). */
export type AlignLyricsResult =
  | { ok: true; alignment: LyricsAlignmentResult }
  | { ok: false; error: string }

/**
 * Outcome of a Remove-silence run (P4.11, Doc 02). On success reports the
 * detected ranges, how many seconds the timeline shrank (`removedSec`), and the
 * count of cuts applied. `removedSec === 0` means detection found nothing (no
 * command was run). `ok:false` carries a human reason (no project / no
 * transcript to detect from).
 */
export type RemoveSilenceResult =
  | { ok: true; ranges: TimeRange[]; removedSec: number; cuts: number }
  | { ok: false; error: string }

/**
 * Outcome of a motion-TRACK run (P8.10, Doc 11; skill `motion-tracking`). On success
 * the per-frame {@link TrackPath} was persisted to `clip.tracking` via an undoable
 * `setClipTrackingCommand`; the result echoes the produced sample count. On failure
 * (no project / IPC reject / `{ok:false}` envelope) it carries a human reason.
 */
export type TrackTargetResult =
  | { ok: true; samples: number }
  | { ok: false; error: string }

/**
 * Outcome of TTS voice listing (P10.1, Doc 12). On success returns the available
 * voices. On failure (no project, no provider) carries a human reason.
 */
export type ListVoicesResult =
  | { ok: true; voices: TTSVoice[] }
  | { ok: false; error: string }

/**
 * Outcome of a TTS synthesis run (P10.3, Doc 12). On success the audio clip was
 * generated and the `mediaRef` + `duration` returned. On failure carries a human
 * reason. The audio clip is not automatically placed on the timeline — the caller
 * uses `addClip` with the returned `mediaRef`.
 */
export type SynthesizeTtsResult =
  | { ok: true; result: TTSSynthesizeResult }
  | { ok: false; error: string }

/**
 * Outcome of a translation run (P10.6, Doc 12). On success the captions block
 * is stamped with translation metadata and each caption clip carries
 * `text.translatedText`. On failure carries a human reason.
 */
export type ApplyTranslationResult =
  | { ok: true; count: number }
  | { ok: false; error: string }

/**
 * Preview render quality (P3.10). VIEW state only — controls the preview
 * canvas backing-store pixel density, never layout/transform math:
 * - `'full'`  → backing store at the project `settings.resolution`.
 * - `'half'`  → backing store at half resolution for cheaper compositing
 *   while scrubbing/playing. The CSS `objectFit: contain` letterbox keeps the
 *   displayed frame identical, so half quality is parity-safe.
 */
export type PreviewQuality = 'full' | 'half'

export interface TimelineState {
  /** Selected clip ids (mirror keys into projectStore clips). */
  selection: string[]
  /** Timeline horizontal scale, in pixels per second. */
  zoom: number
  /** Whether edge/playhead snapping is engaged (full snap math: P3.5). */
  snap: boolean
  /** Authoritative playhead position, in seconds (the clock drives this). */
  playhead: number
  /**
   * Whether the single rAF clock (P3.8) is running. Pure VIEW state — NOT
   * persisted. The clock loop lives in `usePlayheadClock`, which reads this and
   * drives `playhead` via `setPlayhead`; the store only holds the flag.
   */
  isPlaying: boolean
  /**
   * In-point marker (seconds) or null. VIEW state only — NOT persisted to
   * project.json. Set from the transport bar at the current playhead.
   */
  inPoint: number | null
  /**
   * Out-point marker (seconds) or null. VIEW state only — NOT persisted.
   */
  outPoint: number | null
  /** Preview render quality (VIEW state only — see {@link PreviewQuality}). */
  previewQuality: PreviewQuality
  /**
   * TRANSIENT live transform-preview for canvas gestures (P3.11 drag-to-move,
   * P3.12 rotation). VIEW state only — NOT persisted and NOT pushed on the
   * command stack. While a gesture is in progress this holds the clip id + a
   * PARTIAL transform patch (e.g. `{x,y}` for a move, `{rotation}` for a rotate)
   * so the preview canvas + selection box can render the change LIVE without
   * emitting a command per pointer-move. On pointer-up the patch is committed as
   * ONE undoable `setClipTransformCommand` and this is cleared back to null.
   *
   * Generalized in P3.12 from the old `{clipId,x,y}` shape to `{clipId,patch}`
   * so any subset of transform keys can drive live preview through one channel.
   */
  dragTransform: { clipId: string; patch: Partial<ClipTransform> } | null
  /**
   * Motion-path DRAW session (P8.8, Doc 11). VIEW state only — NOT persisted, NOT
   * on the command stack. When non-null, the preview is in DRAW MODE for `clipId`:
   * the overlay captures pointer points into `points` (canvas px) as the user drags
   * a stroke. On finish the captured polyline is committed as ONE undoable
   * `setClipMotionPathCommand` (then this clears); on cancel it clears with no
   * command. `points` accumulates LIVE so the overlay can draw the in-progress path.
   */
  motionPathDraw: { clipId: string; points: MotionPathPoint[] } | null
  /**
   * Id of the text clip in inline canvas-edit mode (P3.14), or null. VIEW state
   * only — NOT persisted, NOT on the command stack. While set, the preview
   * overlays a `<textarea>` over the clip; the canvas drag and the timeline
   * footer's S/Delete shortcuts are suppressed so typing is uninterrupted. On
   * commit the textarea value is split on `\n` into `text.lines` via ONE
   * undoable `setClipTextCommand`.
   */
  editingTextClipId: string | null

  setSelection: (ids: string[]) => void
  addToSelection: (id: string) => void
  clearSelection: () => void
  setZoom: (pxPerSec: number) => void
  toggleSnap: () => void
  setSnap: (snap: boolean) => void
  setPlayhead: (seconds: number) => void
  /** Start the rAF clock. */
  play: () => void
  /** Stop the rAF clock. */
  pause: () => void
  /** Toggle play/pause. */
  togglePlay: () => void
  /**
   * Frame-snapped convenience setter over `setPlayhead`: snaps `seconds` to the
   * nearest frame boundary at the project fps (`settings.fps`, default 30) so a
   * seek/scrub always lands on a whole frame. Callers may clamp to
   * `[0, duration]` first; this does not clamp.
   */
  seek: (seconds: number) => void
  /**
   * Step the playhead by exactly `direction` frames (`+1` forward, `-1` back)
   * at the project fps (`settings.fps`, default 30). Pauses playback first so a
   * step never fights the running clock, and clamps the result to
   * `[0, projectDurationSec(tracks)]`. The landing time is frame-snapped (it
   * starts from a frame-snapped playhead and adds a whole frame).
   */
  stepFrame: (direction: 1 | -1) => void

  // --- In/Out markers (P3.10) — VIEW state, not persisted ---
  /** Set (or clear with null) the in-point. Setting In >= Out clears Out. */
  setInPoint: (seconds: number | null) => void
  /** Set (or clear with null) the out-point. Setting Out <= In clears In. */
  setOutPoint: (seconds: number | null) => void
  /** Clear both in/out markers. */
  clearInOut: () => void

  // --- Preview quality (P3.10) — VIEW state, not persisted ---
  /** Set the preview render quality. */
  setPreviewQuality: (quality: PreviewQuality) => void
  /** Toggle between full and half preview quality. */
  togglePreviewQuality: () => void

  // --- Undoable edit operations (dispatched through projectStore.runCommand) ---
  addClip: (trackId: string, clip: Clip) => void
  removeClip: (clipId: string) => void
  /**
   * Add a NEW empty track (row) of the given type and return its id (CapCut-style
   * "add track"). The new track is appended below existing rows. Undoable. Returns
   * null when no project is open.
   */
  addEmptyTrack: (type: ProjectTrack['type']) => string | null
  /**
   * Remove a whole track (row) and all its clips (CapCut-style "delete track").
   * Undoable. No-op when the track is absent. Clears any selection that pointed
   * at a removed clip.
   */
  removeTrackById: (trackId: string) => void
  moveClip: (clipId: string, start: number) => void
  /**
   * Move a clip to another track (CapCut-style vertical drag) AND set its start,
   * as ONE undoable step. No-op when the clip/track is absent, the target is the
   * clip's current track, or the target track's type differs from the source.
   */
  moveClipToTrack: (clipId: string, targetTrackId: string, start: number) => void
  /**
   * Auto-create a NEW empty track of `type` at `index` and move the clip onto it
   * with `start`, as ONE undoable step. Backs the CapCut-style gestures "drag a
   * clip past the last lane" and "drop onto a crowded lane" — both spawn a fresh
   * lane so clips never overlap. Returns the new track id, or null when no
   * project is open. Undo removes the new lane and restores the clip.
   */
  moveClipToNewTrack: (
    clipId: string,
    type: ProjectTrack['type'],
    start: number,
    index: number
  ) => string | null
  /**
   * Trim a clip edge by `delta` seconds (clamped to media bounds + min length).
   * `sourceDurationSec` caps the right edge to the probed source end (Phase 4);
   * undefined today lets the right edge extend freely.
   */
  trimClip: (
    clipId: string,
    edge: 'start' | 'end',
    delta: number,
    sourceDurationSec?: number
  ) => void
  splitClip: (clipId: string, t: number, rightId: string) => void
  rippleDelete: (clipId: string) => void
  rippleInsert: (trackId: string, clip: Clip) => void
  /**
   * Patch a clip's transform as ONE undoable command (P3.11 drag-to-move writes
   * `{x,y}`; P3.12/P3.13 reuse it for rotation/flip/opacity/z). No-op when no
   * project is open. For a drag, call this ONCE on pointer-up with the final
   * snapped value — the live in-between is shown via `dragTransform`, not commands.
   */
  setClipTransform: (clipId: string, patch: Partial<ClipTransform>) => void
  /**
   * Patch a text clip's `text` surface as ONE undoable command (P3.14 multi-line
   * + manual breaks writes `{lines}` / `{align}`). No-op when no project is open.
   */
  setClipText: (clipId: string, patch: Partial<ClipText>) => void
  /** Convenience over {@link setClipText}: replace a text clip's `lines` (one undo). */
  setClipTextLines: (clipId: string, lines: string[]) => void
  /**
   * Patch a clip's `animation` surface as ONE undoable command (P8.5 In/Out/Loop
   * text animation — the Animation panel writes one lane at a time: `{in}` /
   * `{out}` / `{loop}`). No-op when no project is open. The fields drive the same
   * `evaluateClipAnimation` the preview canvas + export read, so the edit is
   * reflected live in preview and preview = export (parity).
   */
  setClipAnimation: (clipId: string, patch: Partial<ClipAnimation>) => void
  /**
   * Add a keyframe to a clip's `prop` lane at CLIP-LOCAL time `t` with `value`
   * (P8.6, Doc 11) as ONE undoable command. `ease` (defaults `linear`) sets the
   * easing for the segment LEAVING this keyframe. `t` is clamped into the clip;
   * a keyframe at the same time is replaced. No-op when no project is open.
   */
  addKeyframe: (
    clipId: string,
    prop: KeyframeProp,
    t: number,
    value: number,
    ease?: EasingName
  ) => void
  /**
   * Move the keyframe at `index` of a clip's `prop` lane to clip-local `newTime`
   * (clamped to the clip), optionally to `newValue`, as ONE undoable command.
   * The lane re-sorts. No-op when no project is open.
   */
  moveKeyframe: (
    clipId: string,
    prop: KeyframeProp,
    index: number,
    newTime: number,
    newValue?: number
  ) => void
  /**
   * Delete the keyframe at `index` of a clip's `prop` lane as ONE undoable
   * command. No-op when no project is open.
   */
  deleteKeyframe: (clipId: string, prop: KeyframeProp, index: number) => void
  /**
   * Set the per-segment `ease` on the keyframe at `index` of a clip's `prop`
   * lane (the easing governing the segment leaving it) as ONE undoable command.
   * No-op when no project is open.
   */
  setKeyframeEasing: (clipId: string, prop: KeyframeProp, index: number, ease: EasingName) => void
  /**
   * Patch an audio clip's `audio` mix surface as ONE undoable command (P4.1
   * volume/fade writes `{gain}` / `{fadeInSec}` / `{fadeOutSec}` / `{muted}`).
   * No-op when no project is open. Values are export-representable (FFmpeg
   * `volume`/`afade`) so preview and export agree.
   */
  setClipAudio: (clipId: string, patch: Partial<ClipAudio>) => void
  /**
   * Set (or clear with `null`) the transition on the `edge` of a clip (P9.3+P9.4)
   * as ONE undoable command. Writes to `clips[].transitions.{in|out}`. No-op when
   * no project is open. Preview = export: the same `TransitionRef` drives both the
   * preview compositor evaluator and the FFmpeg xfade mapper.
   */
  setClipTransition: (payload: SetClipTransitionPayload) => void
  /**
   * Add a new TEXT clip (P3.14) as ONE undoable step: ensure a `text`-type track
   * exists (creating one with a renderer-minted id if none), then append a
   * default text clip (`text.lines = ['Text']`, `align: 'center'`) starting at
   * the current playhead. Selects the new clip. No-op when no project is open.
   * Returns the new clip id, or null on no-op.
   */
  addTextClip: (opts?: { start?: number; durationSec?: number; text?: ClipText }) => string | null

  // --- Inline text editing (P3.14) — TRANSIENT VIEW state ---
  /** Enter inline edit mode for `clipId` (also selects it). */
  beginTextEdit: (clipId: string) => void
  /**
   * Commit the inline edit: split `value` on `\n` into `text.lines` and dispatch
   * ONE undoable `setClipTextCommand`, then exit edit mode. No command is run if
   * the lines are unchanged. No-op if not editing that clip.
   */
  commitTextEdit: (clipId: string, value: string) => void
  /** Exit inline edit mode without committing (Escape / blur-cancel). */
  cancelTextEdit: () => void

  // --- Canvas transform-gesture live preview (P3.11/P3.12) — TRANSIENT ---
  /**
   * Begin a live transform gesture on `clipId` with an initial preview `patch`
   * (no command yet). P3.11 move passes `{x,y}`; P3.12 rotate passes `{rotation}`.
   */
  beginTransformDrag: (clipId: string, patch: Partial<ClipTransform>) => void
  /** Replace the live preview patch (no command — preview only). No-op if not dragging. */
  updateTransformDrag: (patch: Partial<ClipTransform>) => void
  /**
   * Commit the gesture as ONE undoable `setClipTransformCommand(patch)` and clear
   * the transient preview. No-op if not dragging. The final patch is taken from
   * the explicit arg (the snapped value computed by the overlay).
   */
  commitTransformDrag: (patch: Partial<ClipTransform>) => void
  /** Abandon the gesture (e.g. Escape / pointer cancel) without committing. */
  cancelTransformDrag: () => void

  // --- Motion-path draw mode (P8.8, Doc 11) — TRANSIENT capture ---
  /**
   * Enter motion-path DRAW MODE for `clipId` (clears any prior in-flight stroke).
   * The preview overlay then captures pointer points into the live `motionPathDraw`.
   */
  beginMotionPathDraw: (clipId: string) => void
  /** Append a captured point (canvas px) to the live stroke. No-op if not drawing. */
  appendMotionPathPoint: (point: MotionPathPoint) => void
  /**
   * Finish the stroke: commit the captured polyline as ONE undoable
   * `setClipMotionPathCommand` (with optional `closed`/`ease`) and exit draw mode.
   * A stroke with < 2 points is discarded (no command). No-op if not drawing.
   */
  commitMotionPathDraw: (opts?: { closed?: boolean; ease?: string }) => void
  /** Exit draw mode without committing (Escape / cancel). */
  cancelMotionPathDraw: () => void
  /**
   * Clear `clipId`'s stored motion path as ONE undoable `setClipMotionPathCommand`
   * (no-op when no project is open). Also exits any in-flight draw for that clip.
   */
  clearMotionPath: (clipId: string) => void

  // --- Motion tracking (P8.10, Doc 11; skill `motion-tracking`) ---
  /**
   * The TRANSIENT target-box selection for the preview "pick target" UI. Holds the
   * clip being targeted plus a box (project-resolution px, center + size + kind) the
   * user draws over the subject. VIEW state only — NOT persisted; cleared on commit /
   * cancel. The preview overlay reads this to draw the selection rectangle.
   */
  trackingTarget: { clipId: string; box: TargetBox } | null
  /** Begin / replace the target-box selection for `clipId` (preview overlay draws it). */
  beginTrackTarget: (clipId: string, box: TargetBox) => void
  /** Update the in-flight target box (as the user drags the selection). No-op if none. */
  updateTrackTarget: (box: Partial<TargetBox>) => void
  /** Discard the in-flight target-box selection without tracking. */
  cancelTrackTarget: () => void
  /**
   * Run motion tracking for `clipId` against `target` over the clip's duration via the
   * active provider in main (`tracking:run`; NO frame bytes cross IPC), then persist
   * the returned per-frame {@link TrackPath} to `clip.tracking` (`enabled:true`) as ONE
   * undoable `setClipTrackingCommand`. Clears the transient target selection on success.
   * `videoRef` defaults to the clip's `mediaRef`. Surfaces errors via the
   * {@link TrackTargetResult} `{ok,error}` envelope (no project / IPC failure).
   */
  trackTarget: (clipId: string, target: TargetBox, videoRef?: string) => Promise<TrackTargetResult>
  /**
   * Toggle `clipId`'s tracking attachment on/off WITHOUT losing the tracked path
   * (sets `tracking.enabled`) as ONE undoable command. No-op when the clip has no
   * tracking attachment / no project.
   */
  setTrackingEnabled: (clipId: string, enabled: boolean) => void
  /**
   * MANUAL ANCHOR CORRECTION (P8.10): nudge where the tracked text sits relative to
   * the subject by setting `tracking.anchor = {dx,dy}` (project-resolution px) as ONE
   * undoable command. No-op without an existing tracking attachment / project.
   */
  setTrackingAnchor: (clipId: string, anchor: { dx: number; dy: number }) => void
  /**
   * Set the JITTER-SMOOTHING amount ∈ [0,1] on `clipId`'s tracking attachment (0 =
   * raw path; higher = smoother) as ONE undoable command. No-op without an existing
   * tracking attachment / project.
   */
  setTrackingSmoothing: (clipId: string, smoothing: number) => void
  /**
   * Clear `clipId`'s tracking attachment entirely as ONE undoable
   * `setClipTrackingCommand` (no-op when no project is open). Also discards any
   * in-flight target-box selection for that clip.
   */
  clearTracking: (clipId: string) => void

  /**
   * Split at the playhead (P3.7) as ONE undoable command.
   *
   * Target selection rule: use the single selected clip if exactly one is
   * selected AND the playhead falls strictly inside it; otherwise pick the
   * first clip (across all tracks, in track/clip order) whose timeline span
   * `[start, start + duration)` STRICTLY contains the playhead. The split only
   * fires when `start < t < start + duration` (an interior cut); a hit on an
   * edge or no containing clip is a no-op (the pure reducer also guards this).
   *
   * The split time `t` is snapped to the nearest frame boundary at the project
   * fps via `snapToFrame`, so both halves land on whole frames. The new right
   * clip's id is generated HERE with `crypto.randomUUID()` (renderer-side;
   * reducers stay deterministic). POST-SPLIT SELECTION: the new RIGHT clip is
   * selected, matching the common "cut and keep editing the tail" flow.
   *
   * @returns true if a split was committed, false on no-op.
   */
  splitSelectedAtPlayhead: () => boolean
  /**
   * Ripple-delete the currently selected clip (P3.7) as ONE undoable command:
   * removes it and shifts downstream same-track clips left to close the gap.
   * No-op (returns false) when nothing is selected. Selection is cleared on
   * success since the target clip no longer exists.
   *
   * @returns true if a delete was committed, false on no-op.
   */
  rippleDeleteSelected: () => boolean

  /**
   * Media import (P3.3): pick file(s) via the OS dialog, copy each into the
   * open project's bundle `media/` folder (path-based copy in main), then append
   * a Clip onto a video track (creating one if none exists) via the undoable
   * command stack. Returns the count imported or an error.
   */
  importMedia: () => Promise<ImportMediaResult>

  /**
   * Audio import (P4.1, Doc 02): pick MP3 (or other audio) via the OS dialog,
   * copy each into the open project's bundle `media/` folder (path-based copy in
   * main), then append an audio Clip (neutral gain, no fades) onto an `audio`
   * track (creating one if none exists) via the undoable command stack. Returns
   * the LAST imported clip id + its mediaRef so the panel can decode a waveform.
   */
  importAudio: () => Promise<ImportAudioResult>
  /**
   * Correct imported video/audio clip durations to their REAL media length by
   * measuring each source via an off-screen media element (the same
   * `app-media://` bytes the preview loads). Runs after import and on project
   * open so a clip never stays stuck at the short placeholder default (5s/30s)
   * even when the ffprobe IPC path is unavailable. Only un-trimmed clips
   * (`in === 0`) are adjusted; the update is silent (no undo entry) but marks the
   * project dirty so the corrected span can be saved.
   */
  healImportedClipDurations: () => Promise<void>
  /**
   * Repair caption clip durations from their authoritative per-word timing
   * (`caption.words`). A caption clip's `out` is its DURATION (in === 0); the
   * correct value is `lastWord.end - clip.start`. This heals projects saved by an
   * earlier build that stored `out` as the ABSOLUTE end time (which made every
   * caption linger and overlap). Idempotent — clips already in the correct shape
   * are left untouched. Silent (no undo entry) but marks the project dirty so the
   * fix persists on save. Runs on project open.
   */
  healCaptionClipDurations: () => void
  /**
   * Normalize an imported audio file to 16 kHz mono WAV in the bundle `cache/`
   * folder via FFmpeg in main (Doc 02 — STT input). Returns the bundle-relative
   * WAV path or an error.
   */
  normalizeAudio: (mediaRef: string) => Promise<NormalizeAudioResult>
  /**
   * Transcribe a normalized WAV (P4.4, Doc 02) via the active STT provider in
   * main (`stt:transcribe`). Pass the bundle-relative `wavRef` from
   * {@link normalizeAudio}; optionally pin `language` (omit to auto-detect within
   * the six supported languages, Tamil fallback). Returns the word-level
   * {@link Transcript} or an error. NO audio bytes cross IPC.
   */
  transcribe: (wavRef: string, language?: LanguageCode) => Promise<TranscribeResult>
  /**
   * Lyrics-first alignment: align user-provided lyrics against audio timing and
   * return timed lines/words without inventing text.
   */
  alignLyrics: (
    wavRef: string,
    lyrics: string,
    language?: LanguageCode
  ) => Promise<AlignLyricsResult>

  /**
   * Generate (or REGENERATE) the dedicated Caption track from a word-level
   * {@link Transcript} (P4.7, Doc 02). Reuses the P4.6 `groupWordsIntoLines`
   * (grouping is NOT reimplemented here) — `opts` tunes the word→line grouping
   * (max chars/line, max lines, pause gap). Builds ONE text clip per caption line
   * (`clip.start = line.start`, `clip.out = line.out`, default caption style,
   * per-word timing on `clip.caption.words`) and dispatches ONE undoable
   * `generateCaptionsCommand`: it creates the Caption track if absent and REPLACES
   * its clips otherwise (no duplicate track). An empty transcript clears the
   * track to zero clips. No-op (returns null) when no project is open. Returns the
   * generated clip ids in order.
   */
  generateCaptions: (
    transcript: Transcript,
    opts?: GroupingOptions & { offsetSec?: number }
  ) => string[] | null
  /**
   * Lower-level variant of {@link generateCaptions} that takes already-grouped
   * {@link CaptionLine}[] (e.g. from a live preview/edit) plus the language code
   * for `clip.text.lang`. Same undoable replace-or-create semantics.
   */
  generateCaptionsFromLines: (
    lines: CaptionLine[],
    lang?: LanguageCode,
    offsetSec?: number
  ) => string[] | null
  /**
   * RE-SYNC the Caption track (Doc 02 §2.3, `caption-sync` skill): REGROUP from
   * the STORED per-word transcript and REPLACE the caption clips — WITHOUT
   * re-running STT. The stored transcript is reconstructed from the current
   * Caption track's clips' `caption.words` (the spoken-word timing that survives
   * manual text edits) via `transcriptFromCaptionClips`, regrouped with
   * `resyncTranscript`/`groupWordsIntoLines` using `opts`, then committed through
   * the SAME undoable `generateCaptionsCommand` as P4.7 so it replaces (never
   * duplicates) the track and is one undo step.
   *
   * SEMANTICS / WARNING: because it regroups from the source words, re-sync
   * DISCARDS any manual text edits made to caption lines BY DESIGN — the lines
   * are rebuilt from the transcript. Per-word timing is preserved (it IS the
   * source). No-op (returns null) when no project is open OR there is no Caption
   * track / no stored word timing to regroup from. Returns the new clip ids.
   */
  resyncCaptions: (opts?: GroupingOptions) => string[] | null
  /**
   * APPLY a caption-style PRESET to the whole Caption track (P5.4, Doc 03) in
   * ONE undoable step: record the preset id on the project as `captions.styleId`
   * AND stamp the preset's clip-side style (text/animation/transform via the P5.1
   * {@link captionPresetToClipStyle} contract) onto EVERY caption clip, while
   * PRESERVING each clip's `text.lines`, `text.lang`, and `caption.words` (spoken
   * content + per-word timing survive a style change). Undo restores both the
   * prior styleId and every clip's prior style exactly. Switching presets replaces
   * the style fields wholesale, so the track always wears exactly the latest
   * preset (no accumulated cruft). No-op (returns false) when no project is open,
   * `presetId` is unknown, or there is no Caption track. Returns true when applied.
   */
  applyCaptionPreset: (presetId: string) => boolean
  /**
   * SET the caption POSITION on the whole Caption track (P5.8, Doc 03) in ONE
   * undoable step. Given an `anchor` (`lower-third` | `center` | `top` |
   * `custom`), the action resolves the center-relative pixel `y` for the CURRENT
   * project aspect/resolution (via the pure {@link resolveCaptionY}) — CLAMPED so
   * the caption block stays inside the aspect's title-safe margins — and stamps
   * `transform.y` + `transform.captionAnchor` onto every caption clip. For
   * `custom`, pass `customY` (a center-relative pixel offset, e.g. from a drag or
   * the panel's slider); it is clamped into the safe area too. Undo restores each
   * clip's prior position exactly. No-op (returns false) when no project is open
   * or there is no Caption track. Returns true when applied.
   */
  setCaptionPosition: (anchor: LayoutAnchor, customY?: number, customX?: number) => boolean
  /** Stamp a new font size onto every caption clip in one undoable step. */
  setCaptionFontSize: (size: number) => boolean
  /** Stamp a new font FAMILY onto every caption clip in one undoable step. */
  setCaptionFontFamily: (family: string) => boolean
  /** Stamp a new letter-spacing onto every caption clip in one undoable step. */
  setCaptionLetterSpacing: (letterSpacing: number) => boolean
  /** Stamp a new line-height onto every caption clip in one undoable step. */
  setCaptionLineHeight: (lineHeight: number) => boolean
  setCaptionFill: (fill: PresetFill) => boolean
  setCaptionShadow: (shadow: PresetShadow | null) => boolean
  setCaptionGlow: (glow: { radius: number; color: string } | null) => boolean
  setCaptionStroke: (stroke: PresetStrokeLayer[]) => boolean
  /**
   * Wrap each caption clip's text into multiple visual lines (populating
   * `text.lines`) by splitting at `maxWordsPerLine` words per line. Does NOT
   * create new clips — only inserts line breaks within existing clips. One
   * undoable step. No-op when no Caption track exists.
   */
  wrapCaptionText: (maxWordsPerLine: number) => boolean
  /**
   * REMOVE SILENCE (P4.11, Doc 02 §2): detect silence/filler from the STORED
   * per-word transcript (reconstructed from the Caption track's `caption.words`)
   * and ripple those ranges out of the WHOLE timeline as ONE undoable
   * `removeSilenceCommand` — audio/video clips are trimmed, downstream clips
   * shift earlier, and caption clips + their per-word timing shift by the same
   * map so captions stay aligned to the shortened audio (no drift). `config`
   * tunes the silence threshold / filler removal. No-op (returns `{ok:false}`)
   * when no project is open or there is no transcript to detect from; returns
   * `{ok:true, removedSec:0}` (and runs no command) when detection finds nothing.
   */
  removeSilence: (config?: DetectSilenceConfig) => RemoveSilenceResult
  /**
   * True when {@link removeSilence} has a transcript to detect silence from
   * (same source as {@link hasCaptionTranscript}). Drives the Remove-silence
   * button's disabled state.
   */
  canRemoveSilence: () => boolean
  /**
   * True when {@link resyncCaptions} has a stored transcript to regroup from —
   * i.e. a Caption track exists with at least one clip carrying `caption.words`.
   * Drives the Re-sync button's disabled state in the Auto-Caption panel.
   */
  hasCaptionTranscript: () => boolean

  // --- Lyrics-first Tap-Sync & Review ---
  /**
   * Record a Tap-Sync anchor: pin line or word `index` to the current playhead
   * time `t`. Appended to `captions.anchors` on the open project (silent, no
   * undo — anchors are a live session overlay, not content edits). No-op when no
   * project is open.
   */
  addLyricsAnchor: (unit: 'line' | 'word', index: number, t: number) => void
  /**
   * Clear all Tap-Sync anchors from the open project. No-op when no project is
   * open or there are no anchors. Silent (no undo).
   */
  clearLyricsAnchors: () => void
  /**
   * Seek the playhead to the start of the next caption clip that has more than
   * 20% of its words flagged as low-confidence (< 0.6). Wraps around from the
   * current playhead position. Returns true when a clip was found and the
   * playhead was moved; false when no low-confidence clips exist.
   */
  seekNextLowConfidenceCaption: () => boolean

  // --- TTS (P10.1–P10.4, Doc 12) ---
  /**
   * Enumerate available TTS voices from the active provider. Returns an empty list
   * when no provider is registered (graceful disabled state — no crash).
   */
  listTtsVoices: () => Promise<ListVoicesResult>
  /**
   * Synthesize the text of a text/caption clip via the active TTS provider (P10.3).
   * Writes a WAV into the bundle's `media/` folder and returns the `mediaRef` +
   * `duration`. The caller is responsible for placing the audio on the timeline.
   * Returns an error when no project is open or the provider fails.
   */
  synthesizeTts: (
    clipId: string,
    voiceId: string,
    language: TTSLanguageCode,
    wordTimings?: boolean
  ) => Promise<SynthesizeTtsResult>

  // --- Translation (P10.5–P10.6, Doc 12) ---
  /**
   * Translate all caption lines to `targetLang` via the active translation
   * provider. Stamps `captions.translation = {target, mode:'inline'}` on the
   * project and stores `translatedText` on each caption clip's text surface.
   * Silent (no undo) because translation is a metadata operation, not a clip
   * geometry edit. Returns an error when no project is open or provider fails.
   */
  applyTranslation: (targetLang: TTSLanguageCode) => Promise<ApplyTranslationResult>

  // --- Keyword Highlight (P10.7–P10.8, Doc 12) ---
  /**
   * Auto-detect emphasis words from the Caption track's stored transcript
   * (reconstructed from `caption.words`). Applies up to 5 highlights and stamps
   * them onto `captions.keywordHighlights`. Applies `text.runs[].color` to
   * matching words in each caption clip. Returns false when no transcript exists.
   */
  autoDetectKeywords: () => boolean
  /**
   * Manually add a keyword highlight for `word` with `color`. Stamps onto
   * `captions.keywordHighlights` and applies `text.runs[].color` to each caption
   * clip. No-op when the word is already highlighted.
   */
  addKeywordHighlight: (word: string, color: string) => void
  /**
   * Remove the keyword highlight for `word`. Clears `text.runs[].color` for
   * matching words in each caption clip. No-op when the word is not highlighted.
   */
  removeKeywordHighlight: (word: string) => void
  /**
   * Set the full keyword highlights list (replaces existing). Stamps onto
   * `captions.keywordHighlights` and applies colors to caption clips.
   */
  setKeywordHighlights: (highlights: KeywordHighlight[]) => void
  /**
   * Persist transliteration metadata on the open project (P10R.2, Doc 16).
   * Sets `captions.transliteration = { target, scheme, mode }` so the
   * applied transliteration scheme survives reopen. Silent (no undo) because
   * transliteration is a metadata operation. No-op when no project is open.
   */
  applyTransliteration: (
    result: string,
    targetLang: import('../../shared/transliteration').SupportedLang
  ) => void
  // ---------------------------------------------------------------------------
  // P11 — user-managed presets
  // ---------------------------------------------------------------------------
  /**
   * List all user-saved presets from the host store.
   * Returns an empty array on error (renderer degrades gracefully).
   */
  listUserPresets: () => Promise<UserPreset[]>
  /**
   * Save a preset to the host store (upsert by id).
   * Returns `{ ok: true }` on success, `{ ok: false; error }` on failure.
   */
  saveUserPreset: (preset: UserPreset) => Promise<{ ok: boolean; error?: string }>
  /**
   * Delete a user preset by id. No-op when not found.
   */
  deleteUserPreset: (id: string) => Promise<{ ok: boolean; error?: string }>
  /**
   * Apply a user preset to a single clip (by id). Merges style + animation;
   * resolves the best layout variant for the current project aspect.
   * No-op when clip or project not found. Undoable.
   */
  applyUserPreset: (clipId: string, preset: UserPreset) => void
  /**
   * Import a JSON preset pack (string). Validates each preset before inserting;
   * rejects unknown/unsafe fields (OWASP input validation).
   */
  importUserPresets: (json: string) => Promise<{ imported: number; skipped: number; errors: string[] }>
  /**
   * Export a single user preset to a JSON string.
   * Returns `null` when the preset id is not found.
   */
  exportUserPreset: (id: string) => Promise<string | null>
  // ---------------------------------------------------------------------------
  // P12 — export
  // ---------------------------------------------------------------------------
  /**
   * Start an export job (P12.1, Doc 13). Invokes `export:start` over IPC and
   * returns the jobId. Progress events flow via `window.api.on('export:progress',
   * ...)` — the ExportPanel handles those with local React state, not Zustand.
   * Returns the jobId on success, throws on IPC error.
   */
  startExport: (job: Omit<ExportJob, 'ref'>) => Promise<string>
  /**
   * Cancel a running export job (P12.1, Doc 13). Kills the FFmpeg process.
   * No-op when the job is not found.
   */
  cancelExport: (jobId: string) => Promise<void>
}

/**
 * Track type a given media kind is placed on: visual kinds (video/image) go on a
 * `video` track (P3.3); `audio` goes on an `audio` track (P4.1).
 */
function trackTypeForKind(kind: MediaKind): ProjectTrack['type'] {
  return kind === 'audio' ? 'audio' : 'video'
}

/** Default pixels-per-second when a timeline first mounts. */
const DEFAULT_ZOOM = 100

/** Fallback fps when a project's settings are missing one (read defensively). */
const DEFAULT_FPS = 30

/** Resolve a project's bundle absolute path via the storage IPC bridge. */
async function resolveBundlePath(ref: ProjectRef): Promise<string | null> {
  try {
    const result = await window.api.invoke('storage:resolvePath', { ref })
    return result.ok ? result.data.path : null
  } catch {
    return null
  }
}

/** Probe duration through main IPC (ffprobe-backed). Returns null on failure. */
async function probeMediaDurationViaIpc(
  ref: ProjectRef,
  mediaRef: string
): Promise<number | null> {
  try {
    const result = await window.api.invoke('storage:probeMediaDuration', { ref, mediaRef })
    if (!result.ok) return null
    const value = result.data.durationSec
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

/**
 * Probe media duration in seconds via an off-DOM media element (metadata only).
 * Returns null on failure/timeout so import can gracefully fall back.
 */
async function probeMediaDurationSec(url: string, kind: 'audio' | 'video'): Promise<number | null> {
  if (typeof document === 'undefined') return null

  return await new Promise<number | null>((resolve) => {
    const media = document.createElement(kind)
    let done = false
    const finish = (value: number | null): void => {
      if (done) return
      done = true
      window.clearTimeout(timeoutId)
      media.removeEventListener('loadedmetadata', onLoaded)
      media.removeEventListener('error', onError)
      media.removeAttribute('src')
      media.load()
      resolve(value)
    }
    const onLoaded = (): void => {
      const d = Number.isFinite(media.duration) ? media.duration : NaN
      finish(d > 0 ? d : null)
    }
    const onError = (): void => finish(null)
    const timeoutId = window.setTimeout(() => finish(null), 8000)

    media.preload = 'metadata'
    media.crossOrigin = 'anonymous'
    media.addEventListener('loadedmetadata', onLoaded, { once: true })
    media.addEventListener('error', onError, { once: true })
    media.src = url
  })
}

/** Probe imported media duration via IPC first, then via DOM metadata as a fallback. */
async function probeImportedMediaDuration(
  ref: ProjectRef,
  mediaRef: string,
  kind: 'audio' | 'video'
): Promise<number | null> {
  const probedViaIpc = await probeMediaDurationViaIpc(ref, mediaRef)
  if (probedViaIpc !== null) return probedViaIpc

  const bundleAbs = await resolveBundlePath(ref)
  if (bundleAbs === null) return null

  const url = mediaRefToUrl(bundleAbs, mediaRef)
  return await probeMediaDurationSec(url, kind)
}

/**
 * Post-process generated caption clips so they land where subtitles belong and
 * never pile up:
 *   1. DE-OVERLAP — clamp each clip's `out` so it never runs past the NEXT
 *      clip's `start`. Spoken-word timing from STT is usually clean, but a noisy
 *      segment can hand back a word whose end bleeds into the next word; this
 *      guarantees only ONE caption is ever on screen at a time (the compositor's
 *      active test is half-open, so touching `out === next.start` shows no overlap).
 *   2. POSITION — anchor every caption at the LOWER-THIRD (CapCut-style subtitle
 *      placement) with the real center-relative pixel `y` resolved for the
 *      project's aspect + clamped to its title-safe band, instead of the pure
 *      builder's aspect-agnostic placeholder (which rendered at frame center).
 * Pure given its inputs; ids/timing/text are preserved.
 */
function prepareCaptionClips(clips: Clip[], project: { settings: { aspect: string } }): Clip[] {
  if (clips.length === 0) return clips

  // 1) De-overlap: clamp each clip's DURATION so its END never runs past the next
  //    clip's start. `out` is a duration (in === 0), so END = start + (out - in);
  //    the clamped duration is `next.start - start` (kept strictly positive).
  const deOverlapped = clips.map((clip, i) => {
    const next = clips[i + 1]
    if (next === undefined) return clip
    const end = clip.start + (clip.out - clip.in)
    if (end <= next.start) return clip
    const clampedDur = Math.max(0.001, next.start - clip.start)
    return { ...clip, out: clip.in + clampedDur }
  })

  // 2) Position at the lower-third for the project's aspect (real pixel y).
  const aspect = project.settings.aspect as Aspect
  const resolution = resolutionForAspect(aspect)
  const y = resolveCaptionY({
    anchor: 'lower-third',
    aspect,
    resolution,
    blockHeight: DEFAULT_CAPTION_BLOCK_HEIGHT
  })
  return deOverlapped.map((clip) => setCaptionPositionOnClip(clip, 'lower-third', y))
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  selection: [],
  zoom: DEFAULT_ZOOM,
  snap: true,
  playhead: 0,
  isPlaying: false,
  inPoint: null,
  outPoint: null,
  previewQuality: 'full',
  dragTransform: null,
  motionPathDraw: null,
  editingTextClipId: null,

  setSelection: (ids) => set({ selection: ids }),
  addToSelection: (id) =>
    set((s) => (s.selection.includes(id) ? s : { selection: [...s.selection, id] })),
  clearSelection: () => set({ selection: [] }),
  setZoom: (pxPerSec) => set({ zoom: pxPerSec }),
  toggleSnap: () => set((s) => ({ snap: !s.snap })),
  setSnap: (snap) => set({ snap }),
  setPlayhead: (seconds) => set({ playhead: seconds }),
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),
  seek: (seconds) => {
    const fps = useProjectStore.getState().currentProject?.settings.fps ?? DEFAULT_FPS
    set({ playhead: snapToFrame(seconds, fps) })
  },
  stepFrame: (direction) => {
    const project = useProjectStore.getState().currentProject
    const fps = project?.settings.fps ?? DEFAULT_FPS
    const duration = project === null ? Infinity : projectDurationSec(project.tracks)
    const current = snapToFrame(get().playhead, fps)
    const next = current + frameToSeconds(direction, fps)
    const clamped = Math.min(duration, Math.max(0, next))
    set({ isPlaying: false, playhead: snapToFrame(clamped, fps) })
  },

  setInPoint: (seconds) => {
    if (seconds === null) {
      set({ inPoint: null })
      return
    }
    set((s) => ({
      inPoint: seconds,
      // Keep markers sane: an In at/after the Out invalidates the Out.
      outPoint: s.outPoint !== null && seconds >= s.outPoint ? null : s.outPoint
    }))
  },
  setOutPoint: (seconds) => {
    if (seconds === null) {
      set({ outPoint: null })
      return
    }
    set((s) => ({
      outPoint: seconds,
      // An Out at/before the In invalidates the In.
      inPoint: s.inPoint !== null && seconds <= s.inPoint ? null : s.inPoint
    }))
  },
  clearInOut: () => set({ inPoint: null, outPoint: null }),

  setPreviewQuality: (quality) => set({ previewQuality: quality }),
  togglePreviewQuality: () =>
    set((s) => ({ previewQuality: s.previewQuality === 'full' ? 'half' : 'full' })),

  addClip: (trackId, clip) =>
    useProjectStore.getState().runCommand(addClipCommand(trackId, clip)),
  removeClip: (clipId) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return
    useProjectStore.getState().runCommand(removeClipCommand(project, clipId))
  },
  addEmptyTrack: (type) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return null
    const trackId = crypto.randomUUID()
    useProjectStore.getState().runCommand(addTrackCommand(trackId, type))
    return trackId
  },
  removeTrackById: (trackId) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return
    const track = project.tracks.find((t) => t.id === trackId)
    if (track === undefined) return
    // Drop any selection that pointed at a clip on the removed track.
    const removedClipIds = new Set(track.clips.map((c) => c.id))
    const nextSelection = get().selection.filter((id) => !removedClipIds.has(id))
    if (nextSelection.length !== get().selection.length) set({ selection: nextSelection })
    useProjectStore.getState().runCommand(removeTrackCommand(project, trackId))
  },
  moveClip: (clipId, start) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return
    useProjectStore.getState().runCommand(moveClipCommand(project, clipId, start))
  },
  moveClipToTrack: (clipId, targetTrackId, start) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return
    useProjectStore.getState().runCommand(moveClipToTrackCommand(project, clipId, targetTrackId, start))
  },
  moveClipToNewTrack: (clipId, type, start, index) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return null
    const newTrackId = crypto.randomUUID()
    useProjectStore
      .getState()
      .runCommand(moveClipToNewTrackCommand(project, clipId, newTrackId, type, start, index))
    return newTrackId
  },
  trimClip: (clipId, edge, delta, sourceDurationSec) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return
    useProjectStore
      .getState()
      .runCommand(trimClipCommand(project, clipId, edge, delta, sourceDurationSec))
  },
  splitClip: (clipId, t, rightId) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return
    useProjectStore.getState().runCommand(splitClipCommand(project, clipId, t, rightId))
  },
  rippleDelete: (clipId) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return
    useProjectStore.getState().runCommand(rippleDeleteCommand(project, clipId))
  },
  rippleInsert: (trackId, clip) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return
    useProjectStore.getState().runCommand(rippleInsertCommand(project, trackId, clip))
  },
  setClipTransform: (clipId, patch) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return
    useProjectStore.getState().runCommand(setClipTransformCommand(project, clipId, patch))
  },
  setClipText: (clipId, patch) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return
    useProjectStore.getState().runCommand(setClipTextCommand(project, clipId, patch))
  },
  setClipTextLines: (clipId, lines) => get().setClipText(clipId, { lines }),
  setClipAnimation: (clipId, patch) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return
    useProjectStore.getState().runCommand(setClipAnimationCommand(project, clipId, patch))
  },
  addKeyframe: (clipId, prop, t, value, ease) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return
    useProjectStore
      .getState()
      .runCommand(addKeyframeCommand(project, clipId, prop, t, value, ease ?? 'linear'))
  },
  moveKeyframe: (clipId, prop, index, newTime, newValue) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return
    useProjectStore
      .getState()
      .runCommand(moveKeyframeCommand(project, clipId, prop, index, newTime, newValue))
  },
  deleteKeyframe: (clipId, prop, index) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return
    useProjectStore.getState().runCommand(deleteKeyframeCommand(project, clipId, prop, index))
  },
  setKeyframeEasing: (clipId, prop, index, ease) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return
    useProjectStore
      .getState()
      .runCommand(setKeyframeEasingCommand(project, clipId, prop, index, ease))
  },
  setClipAudio: (clipId, patch) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return
    useProjectStore.getState().runCommand(setClipAudioCommand(project, clipId, patch))
  },
  setClipTransition: (payload) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return
    useProjectStore.getState().runCommand(setClipTransitionCommand(project, payload))
  },
  addTextClip: (opts) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return null

    // Ensure a text track exists; create one (undoable, id from renderer) if not.
    let track = project.tracks.find((t) => t.type === 'text')
    if (track === undefined) {
      const trackId = crypto.randomUUID()
      useProjectStore.getState().runCommand(addTrackCommand(trackId, 'text'))
      const after = useProjectStore.getState().currentProject
      track = after?.tracks.find((t) => t.id === trackId)
      if (track === undefined) return null
    }

    const start = opts?.start ?? get().playhead
    const clip = buildTextClip({
      id: crypto.randomUUID(),
      start,
      durationSec: opts?.durationSec,
      text: opts?.text
    })
    useProjectStore.getState().runCommand(addClipCommand(track.id, clip))
    get().setSelection([clip.id])
    return clip.id
  },

  beginTextEdit: (clipId) => set({ editingTextClipId: clipId, selection: [clipId] }),
  commitTextEdit: (clipId, value) => {
    if (get().editingTextClipId !== clipId) return
    set({ editingTextClipId: null })
    const project = useProjectStore.getState().currentProject
    if (project === null) return
    // ENTER inserts a manual break: `valueToLines` normalizes CRLF/CR → `\n`
    // then splits, so each break becomes one `text.lines` entry (parity-safe).
    const lines = valueToLines(value)
    // Skip the command when nothing changed (avoids a no-op undo step).
    const clip = project.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)
    if (linesEqual(clip?.text?.lines ?? [], lines)) return
    useProjectStore.getState().runCommand(setClipTextCommand(project, clipId, { lines }))
  },
  cancelTextEdit: () => set({ editingTextClipId: null }),

  beginTransformDrag: (clipId, patch) => set({ dragTransform: { clipId, patch } }),
  updateTransformDrag: (patch) =>
    set((s) => (s.dragTransform === null ? s : { dragTransform: { ...s.dragTransform, patch } })),
  commitTransformDrag: (patch) => {
    const drag = get().dragTransform
    set({ dragTransform: null })
    if (drag === null) return
    // ONE command per gesture: the live in-between never touched the stack.
    get().setClipTransform(drag.clipId, patch)
  },
  cancelTransformDrag: () => set({ dragTransform: null }),

  beginMotionPathDraw: (clipId) => set({ motionPathDraw: { clipId, points: [] } }),
  appendMotionPathPoint: (point) =>
    set((s) =>
      s.motionPathDraw === null
        ? s
        : { motionPathDraw: { ...s.motionPathDraw, points: [...s.motionPathDraw.points, point] } }
    ),
  commitMotionPathDraw: (opts) => {
    const draw = get().motionPathDraw
    set({ motionPathDraw: null })
    if (draw === null) return
    // A meaningful path needs at least two points; discard a stray tap.
    if (draw.points.length < 2) return
    const project = useProjectStore.getState().currentProject
    if (project === null) return
    const path: ClipMotionPath = {
      points: draw.points,
      ...(opts?.closed === true ? { closed: true } : {}),
      ...(opts?.ease !== undefined ? { ease: opts.ease } : {})
    }
    // ONE undoable command per drawn stroke (the live capture never touched the stack).
    useProjectStore.getState().runCommand(setClipMotionPathCommand(project, draw.clipId, path))
  },
  cancelMotionPathDraw: () => set({ motionPathDraw: null }),
  clearMotionPath: (clipId) => {
    set((s) =>
      s.motionPathDraw !== null && s.motionPathDraw.clipId === clipId
        ? { motionPathDraw: null }
        : s
    )
    const project = useProjectStore.getState().currentProject
    if (project === null) return
    useProjectStore.getState().runCommand(setClipMotionPathCommand(project, clipId, undefined))
  },

  // --- Motion tracking (P8.10, Doc 11) ---
  trackingTarget: null,
  beginTrackTarget: (clipId, box) => set({ trackingTarget: { clipId, box } }),
  updateTrackTarget: (box) =>
    set((s) =>
      s.trackingTarget === null
        ? s
        : { trackingTarget: { ...s.trackingTarget, box: { ...s.trackingTarget.box, ...box } } }
    ),
  cancelTrackTarget: () => set({ trackingTarget: null }),
  trackTarget: async (clipId, target, videoRef) => {
    const { currentProject, currentRef } = useProjectStore.getState()
    if (currentProject === null || currentRef === null) {
      return { ok: false, error: 'No project is open.' }
    }
    const clip = currentProject.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)
    if (clip === undefined) return { ok: false, error: 'Clip not found.' }

    const fps = currentProject.settings.fps ?? DEFAULT_FPS
    const durationSec = clipDuration(clip)
    const ref = videoRef ?? clip.mediaRef
    try {
      // NO frame bytes cross IPC — main resolves the bundle path + runs the provider.
      const result = await window.api.invoke('tracking:run', {
        ref: currentRef,
        videoRef: ref,
        target,
        durationSec,
        fps
      })
      if (!result.ok) return { ok: false, error: result.error }
      const path = result.data
      // Inline the TrackPath into the persisted ClipTracking attachment (enabled on).
      const tracking: ClipTracking = {
        enabled: true,
        target: target.kind,
        targetBox: target,
        fps: path.fps,
        path: path.samples
      }
      useProjectStore.getState().runCommand(setClipTrackingCommand(currentProject, clipId, tracking))
      set((s) =>
        s.trackingTarget !== null && s.trackingTarget.clipId === clipId
          ? { trackingTarget: null }
          : s
      )
      return { ok: true, samples: path.samples.length }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to run tracking.'
      return { ok: false, error: message }
    }
  },
  setTrackingEnabled: (clipId, enabled) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return
    const clip = project.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)
    if (clip?.tracking === undefined) return
    useProjectStore
      .getState()
      .runCommand(setClipTrackingCommand(project, clipId, { ...clip.tracking, enabled }))
  },
  setTrackingAnchor: (clipId, anchor) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return
    const clip = project.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)
    if (clip?.tracking === undefined) return
    useProjectStore
      .getState()
      .runCommand(setClipTrackingCommand(project, clipId, { ...clip.tracking, anchor }))
  },
  setTrackingSmoothing: (clipId, smoothing) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return
    const clip = project.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)
    if (clip?.tracking === undefined) return
    const clamped = smoothing < 0 ? 0 : smoothing > 1 ? 1 : smoothing
    useProjectStore
      .getState()
      .runCommand(setClipTrackingCommand(project, clipId, { ...clip.tracking, smoothing: clamped }))
  },
  clearTracking: (clipId) => {
    set((s) =>
      s.trackingTarget !== null && s.trackingTarget.clipId === clipId
        ? { trackingTarget: null }
        : s
    )
    const project = useProjectStore.getState().currentProject
    if (project === null) return
    useProjectStore.getState().runCommand(setClipTrackingCommand(project, clipId, undefined))
  },

  splitSelectedAtPlayhead: () => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return false

    const { selection, playhead } = get()
    const fps = project.settings.fps ?? DEFAULT_FPS
    const t = snapToFrame(playhead, fps)

    // Target rule: the single selected clip iff exactly one is selected AND the
    // (snapped) playhead falls strictly inside it; otherwise the first clip
    // whose span strictly contains the playhead.
    let targetId: string | null = null
    if (selection.length === 1) {
      const selectedId = selection[0]
      for (const track of project.tracks) {
        const clip = track.clips.find((c) => c.id === selectedId)
        if (clip === undefined) continue
        const end = clip.start + clipLength(clip)
        if (t > clip.start && t < end) targetId = selectedId
        break
      }
    }
    if (targetId === null) targetId = clipIdContainingTime(project, t)
    if (targetId === null) return false

    const rightId = crypto.randomUUID()
    get().splitClip(targetId, t, rightId)
    get().setSelection([rightId])
    return true
  },
  rippleDeleteSelected: () => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return false

    const { selection } = get()
    if (selection.length === 0) return false

    get().rippleDelete(selection[0])
    get().clearSelection()
    return true
  },

  importMedia: async () => {
    const { currentRef } = useProjectStore.getState()
    if (currentRef === null) return { ok: false, error: 'No project is open.' }

    try {
      const picked = await window.api.invoke('storage:pickMedia', undefined)
      if (!picked.ok) return { ok: false, error: picked.error }
      if (picked.data.paths.length === 0) return { ok: true, imported: 0 }

      let imported = 0
      let lastClipId: string | null = null
      let lastClipStart = 0
      for (const sourcePath of picked.data.paths) {
        const result = await window.api.invoke('storage:importMedia', {
          ref: currentRef,
          sourcePath
        })
        if (!result.ok) return { ok: false, error: result.error }

        // Re-read current project per iteration so successive appends see prior
        // commands' effects (start = end of last clip on the chosen track).
        const project = useProjectStore.getState().currentProject
        if (project === null) return { ok: false, error: 'No project is open.' }

        const trackType = trackTypeForKind(result.data.kind)
        let track = project.tracks.find((t) => t.type === trackType)

        // Create a video track first if none exists (undoable, id from renderer).
        if (track === undefined) {
          const trackId = crypto.randomUUID()
          useProjectStore.getState().runCommand(addTrackCommand(trackId, trackType))
          const after = useProjectStore.getState().currentProject
          track = after?.tracks.find((t) => t.id === trackId)
          if (track === undefined) return { ok: false, error: 'Failed to create track.' }
        }

        const start = trackEndSeconds(track)
        // Probe the real media duration for BOTH video and audio so the clip
        // (and thus the auto-fit timeline) spans the full media length instead
        // of a short placeholder. Falls back to the build defaults on failure.
        const durationSec =
          (await probeImportedMediaDuration(
            currentRef,
            result.data.mediaRef,
            result.data.kind === 'audio' ? 'audio' : 'video'
          )) ?? undefined
        const clip =
          result.data.kind === 'audio'
            ? buildAudioClip(result.data, { id: crypto.randomUUID(), start, durationSec })
            : buildImportedClip(result.data, { id: crypto.randomUUID(), start, durationSec })
        useProjectStore.getState().runCommand(addClipCommand(track.id, clip))
        lastClipId = clip.id
        lastClipStart = clip.start
        imported += 1
      }

      // UX: after import, focus the most recently added clip and reveal it in preview
      // immediately (especially when playhead was parked outside the clip range).
      if (lastClipId !== null) {
        get().setSelection([lastClipId])
        if (!get().isPlaying) get().seek(lastClipStart)
      }

      // Correct any placeholder durations to the real media length (resilient to
      // ffprobe being unavailable — measures via the same app-media:// bytes the
      // preview decodes). Fire-and-forget so import returns promptly.
      void get().healImportedClipDurations()

      return { ok: true, imported }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to import media.'
      return { ok: false, error: message }
    }
  },

  importAudio: async () => {
    const { currentRef } = useProjectStore.getState()
    if (currentRef === null) return { ok: false, error: 'No project is open.' }

    try {
      const picked = await window.api.invoke('storage:pickAudio', undefined)
      if (!picked.ok) return { ok: false, error: picked.error }
      if (picked.data.paths.length === 0) return { ok: true, clipId: null, mediaRef: null }

      let lastClipId: string | null = null
      let lastMediaRef: string | null = null
      let lastClipStart = 0
      for (const sourcePath of picked.data.paths) {
        const result = await window.api.invoke('storage:importMedia', {
          ref: currentRef,
          sourcePath
        })
        if (!result.ok) return { ok: false, error: result.error }

        // Re-read per iteration so successive appends see prior commands' effects.
        const project = useProjectStore.getState().currentProject
        if (project === null) return { ok: false, error: 'No project is open.' }

        const trackType = trackTypeForKind(result.data.kind)
        let track = project.tracks.find((t) => t.type === trackType)

        // Create an audio track first if none exists (undoable, id from renderer).
        if (track === undefined) {
          const trackId = crypto.randomUUID()
          useProjectStore.getState().runCommand(addTrackCommand(trackId, trackType))
          const after = useProjectStore.getState().currentProject
          track = after?.tracks.find((t) => t.id === trackId)
          if (track === undefined) return { ok: false, error: 'Failed to create track.' }
        }

        const start = trackEndSeconds(track)
        const durationSec =
          (await probeImportedMediaDuration(currentRef, result.data.mediaRef, 'audio')) ?? undefined
        const clip = buildAudioClip(result.data, { id: crypto.randomUUID(), start, durationSec })
        useProjectStore.getState().runCommand(addClipCommand(track.id, clip))
        lastClipId = clip.id
        lastMediaRef = clip.mediaRef
        lastClipStart = clip.start
      }

      if (lastClipId !== null) {
        get().setSelection([lastClipId])
        if (!get().isPlaying) get().seek(lastClipStart)
      }

      // Correct any placeholder durations to the real media length.
      void get().healImportedClipDurations()

      return { ok: true, clipId: lastClipId, mediaRef: lastMediaRef }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to import audio.'
      return { ok: false, error: message }
    }
  },

  healImportedClipDurations: async () => {
    const { currentRef, currentProject } = useProjectStore.getState()
    if (currentRef === null || currentProject === null) return

    // Only visual/audio tracks reference imported media with a real duration.
    const mediaTrackTypes = new Set(['video', 'audio'])
    const bundleAbs = await resolveBundlePath(currentRef)
    if (bundleAbs === null) return

    // Measure every un-trimmed imported clip's real source duration in parallel.
    const measurements = await Promise.all(
      currentProject.tracks
        .filter((track) => mediaTrackTypes.has(track.type))
        .flatMap((track) =>
          track.clips
            .filter((clip) => clip.mediaRef !== undefined && clip.in === 0)
            .map(async (clip) => {
              const kind = track.type === 'audio' ? 'audio' : 'video'
              const url = mediaRefToUrl(bundleAbs, clip.mediaRef as string)
              const real = await probeMediaDurationSec(url, kind)
              return { clipId: clip.id, real }
            })
        )
    )

    const corrected = new Map<string, number>()
    for (const { clipId, real } of measurements) {
      if (real !== null && Number.isFinite(real) && real > 0) corrected.set(clipId, real)
    }
    if (corrected.size === 0) return

    // Re-read the latest project (import selection/seek may have run meanwhile)
    // and apply the corrected out-points silently — no undo entry, but dirty so
    // the real span persists on save. Only change clips that actually differ.
    const latest = useProjectStore.getState().currentProject
    if (latest === null) return

    let changed = false
    const nextTracks = latest.tracks.map((track) => {
      if (!mediaTrackTypes.has(track.type)) return track
      const nextClips = track.clips.map((clip) => {
        const real = corrected.get(clip.id)
        if (real === undefined || clip.in !== 0) return clip
        if (Math.abs(clip.out - real) <= 0.1) return clip
        // Only override clips still at the import placeholder duration — any other
        // value means the probe succeeded at import time or the user already
        // resized the clip, and we must not overwrite their edit.
        if (Math.abs(clip.out - DEFAULT_IMPORT_DURATION_SEC) > 0.1) return clip
        changed = true
        return { ...clip, out: real }
      })
      return changed ? { ...track, clips: nextClips } : track
    })
    if (!changed) return

    useProjectStore.setState({
      currentProject: { ...latest, tracks: nextTracks },
      isDirty: true
    })
  },

  healCaptionClipDurations: () => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return

    let changed = false
    const nextTracks = project.tracks.map((track) => {
      if (track.id !== CAPTION_TRACK_ID) return track
      let trackChanged = false
      const nextClips = track.clips.map((clip) => {
        const words = clip.caption?.words
        if (words === undefined || words.length === 0) return clip
        // Authoritative end = last word's absolute end; duration = end - start.
        const lastEnd = words[words.length - 1].end
        const wantOut = Math.max(0.001, lastEnd - clip.start)
        // in must be 0 for the compositor's `out - in` duration to hold.
        if (clip.in === 0 && Math.abs(clip.out - wantOut) <= 1e-6) return clip
        trackChanged = true
        return { ...clip, in: 0, out: wantOut }
      })
      if (!trackChanged) return track
      changed = true
      return { ...track, clips: nextClips }
    })
    if (!changed) return

    useProjectStore.setState({
      currentProject: { ...project, tracks: nextTracks },
      isDirty: true
    })
  },

  normalizeAudio: async (mediaRef) => {
    const { currentRef } = useProjectStore.getState()
    if (currentRef === null) return { ok: false, error: 'No project is open.' }
    try {
      const result = await window.api.invoke('ffmpeg:normalizeAudio', {
        ref: currentRef,
        mediaRef
      })
      if (!result.ok) return { ok: false, error: result.error }
      return { ok: true, wavRef: result.data.wavRef }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to normalize audio.'
      return { ok: false, error: message }
    }
  },

  transcribe: async (wavRef, language) => {
    const { currentRef } = useProjectStore.getState()
    if (currentRef === null) return { ok: false, error: 'No project is open.' }
    try {
      const result = await window.api.invoke('stt:transcribe', {
        ref: currentRef,
        wavRef,
        language
      })
      if (!result.ok) return { ok: false, error: result.error }
      return { ok: true, transcript: result.data }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to transcribe audio.'
      return { ok: false, error: message }
    }
  },

  alignLyrics: async (wavRef, lyrics, language) => {
    const { currentRef } = useProjectStore.getState()
    if (currentRef === null) return { ok: false, error: 'No project is open.' }
    try {
      const result = await window.api.invoke('stt:alignLyrics', {
        ref: currentRef,
        wavRef,
        lyrics,
        language
      })
      if (!result.ok) return { ok: false, error: result.error }
      return { ok: true, alignment: result.data }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to align lyrics.'
      return { ok: false, error: message }
    }
  },

  generateCaptions: (transcript, opts) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return null

    // Shift the transcript words by offsetSec if provided
    let finalTranscript = transcript
    if (opts?.offsetSec) {
      const offset = opts.offsetSec
      finalTranscript = {
        ...transcript,
        words: transcript.words.map((w) => ({
          ...w,
          start: w.start + offset,
          end: w.end + offset
        }))
      }
    }

    // Reuse P4.6 grouping (inside buildCaptionClipsFromTranscript) — NOT
    // reimplemented here. ids are minted renderer-side so the builder stays pure.
    const raw = buildCaptionClipsFromTranscript(finalTranscript, () => crypto.randomUUID(), opts)
    // Subtitle placement (lower-third) + anti-overlap in one pass before the
    // undoable command so captions land at the bottom and never pile up.
    const clips = prepareCaptionClips(raw, project)
    useProjectStore.getState().runCommand(generateCaptionsCommand(project, clips))
    return clips.map((c) => c.id)
  },
  generateCaptionsFromLines: (lines, lang, offsetSec) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return null

    let finalLines = lines
    if (offsetSec) {
      finalLines = lines.map((l) => ({
        ...l,
        start: l.start + offsetSec,
        out: l.out + offsetSec,
        words: l.words.map((w) => ({
          ...w,
          start: w.start + offsetSec,
          end: w.end + offsetSec
        }))
      }))
    }

    const raw = buildCaptionClips(finalLines, () => crypto.randomUUID(), lang)
    const clips = prepareCaptionClips(raw, project)
    useProjectStore.getState().runCommand(generateCaptionsCommand(project, clips))
    return clips.map((c) => c.id)
  },

  resyncCaptions: (opts) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return null

    // STORED transcript = the per-word timing on the existing Caption track's
    // clips (reconstructed in order). This is the spoken-word source, untouched
    // by manual TEXT edits, so re-sync never re-runs STT.
    const captionTrack = project.tracks.find((t) => t.id === CAPTION_TRACK_ID)
    if (captionTrack === undefined) return null
    const transcript = transcriptFromCaptionClips(captionTrack.clips)
    if (transcript === null) return null

    // Regroup from source words (P4.6) — this DISCARDS manual line-text edits by
    // design — then REPLACE the clips via the same undoable P4.7 command.
    const lines = resyncTranscript(transcript, opts)
    const raw = buildCaptionClips(lines, () => crypto.randomUUID(), transcript.language)
    const clips = prepareCaptionClips(raw, project)
    useProjectStore.getState().runCommand(generateCaptionsCommand(project, clips))
    return clips.map((c) => c.id)
  },

  applyCaptionPreset: (presetId) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return false
    // Unknown preset id → no-op.
    const preset = getCaptionPreset(presetId)
    if (preset === undefined) return false
    // No Caption track → no-op (nothing to stamp the style onto).
    if (!project.tracks.some((t) => t.id === CAPTION_TRACK_ID)) return false

    useProjectStore.getState().runCommand(applyCaptionPresetCommand(project, preset))
    return true
  },

  setCaptionPosition: (anchor, customY, customX) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return false
    // No Caption track → no-op (nothing to position).
    if (!project.tracks.some((t) => t.id === CAPTION_TRACK_ID)) return false

    // Resolve the center-relative pixel y for the current aspect, clamped into
    // that aspect's title-safe band (pure math). `custom` honors the explicit
    // px offset; named anchors derive from the shared anchor table.
    const aspect = project.settings.aspect as Aspect
    const resolution = resolutionForAspect(aspect)
    const y = resolveCaptionY({
      anchor,
      aspect,
      resolution,
      blockHeight: DEFAULT_CAPTION_BLOCK_HEIGHT,
      ...(customY !== undefined ? { customY } : {})
    })

    // Horizontal offset (px from center) is passed through only for `custom`
    // placement; named anchors keep the caption horizontally centered (x = 0).
    const x = anchor === 'custom' ? customX : 0
    useProjectStore.getState().runCommand(setCaptionPositionCommand(project, anchor, y, x))
    return true
  },

  setCaptionFontSize: (size) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return false
    if (!project.tracks.some((t) => t.id === CAPTION_TRACK_ID)) return false
    useProjectStore.getState().runCommand(setCaptionFontSizeCommand(project, size))
    return true
  },

  setCaptionFontFamily: (family) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return false
    if (!project.tracks.some((t) => t.id === CAPTION_TRACK_ID)) return false
    useProjectStore.getState().runCommand(setCaptionFontFamilyCommand(project, family))
    return true
  },

  setCaptionLetterSpacing: (letterSpacing) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return false
    if (!project.tracks.some((t) => t.id === CAPTION_TRACK_ID)) return false
    useProjectStore.getState().runCommand(setCaptionLetterSpacingCommand(project, letterSpacing))
    return true
  },

  setCaptionLineHeight: (lineHeight) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return false
    if (!project.tracks.some((t) => t.id === CAPTION_TRACK_ID)) return false
    useProjectStore.getState().runCommand(setCaptionLineHeightCommand(project, lineHeight))
    return true
  },

  setCaptionFill: (fill) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return false
    if (!project.tracks.some((t) => t.id === CAPTION_TRACK_ID)) return false
    useProjectStore.getState().runCommand(setCaptionFillCommand(project, fill))
    return true
  },

  setCaptionShadow: (shadow) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return false
    if (!project.tracks.some((t) => t.id === CAPTION_TRACK_ID)) return false
    useProjectStore.getState().runCommand(setCaptionShadowCommand(project, shadow))
    return true
  },

  setCaptionGlow: (glow) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return false
    if (!project.tracks.some((t) => t.id === CAPTION_TRACK_ID)) return false
    useProjectStore.getState().runCommand(setCaptionGlowCommand(project, glow))
    return true
  },

  setCaptionStroke: (stroke) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return false
    if (!project.tracks.some((t) => t.id === CAPTION_TRACK_ID)) return false
    useProjectStore.getState().runCommand(setCaptionStrokeCommand(project, stroke))
    return true
  },

  wrapCaptionText: (maxWordsPerLine) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return false
    if (!project.tracks.some((t) => t.id === CAPTION_TRACK_ID)) return false
    useProjectStore.getState().runCommand(wrapCaptionTextCommand(project, maxWordsPerLine))
    return true
  },

  removeSilence: (config) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return { ok: false, error: 'No project is open.' }

    // Detect from the STORED per-word transcript (the Caption track's
    // caption.words) — the spoken-word timing, never re-run STT.
    const captionTrack = project.tracks.find((t) => t.id === CAPTION_TRACK_ID)
    const transcript =
      captionTrack === undefined ? null : transcriptFromCaptionClips(captionTrack.clips)
    if (transcript === null) {
      return { ok: false, error: 'No transcript to detect silence from. Generate captions first.' }
    }

    const ranges = detectSilenceRanges(transcript.words, config)
    const removedSec = totalRemoved(ranges)
    // Nothing to cut → no command (keeps the undo stack clean).
    if (ranges.length === 0) return { ok: true, ranges, removedSec: 0, cuts: 0 }

    useProjectStore.getState().runCommand(removeSilenceCommand(project, ranges))
    return { ok: true, ranges, removedSec, cuts: ranges.length }
  },
  canRemoveSilence: () => get().hasCaptionTranscript(),

  hasCaptionTranscript: () => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return false
    const captionTrack = project.tracks.find((t) => t.id === CAPTION_TRACK_ID)
    if (captionTrack === undefined) return false
    return transcriptFromCaptionClips(captionTrack.clips) !== null
  },

  // --- Lyrics-first Tap-Sync & Review ---
  addLyricsAnchor: (unit, index, t) => {
    const { currentProject, currentRef } = useProjectStore.getState()
    if (currentProject === null || currentRef === null) return
    const existing = currentProject.captions?.anchors ?? []
    const anchors = [...existing.filter((a) => !(a.unit === unit && a.index === index)), { unit, index, t }]
    useProjectStore.setState({
      currentProject: {
        ...currentProject,
        captions: { ...currentProject.captions, anchors }
      }
    })
  },

  clearLyricsAnchors: () => {
    const { currentProject } = useProjectStore.getState()
    if (currentProject === null || !currentProject.captions?.anchors?.length) return
    useProjectStore.setState({
      currentProject: {
        ...currentProject,
        captions: { ...currentProject.captions, anchors: [] }
      }
    })
  },

  seekNextLowConfidenceCaption: () => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return false
    const captionTrack = project.tracks.find((t) => t.id === CAPTION_TRACK_ID)
    if (captionTrack === undefined) return false
    const { playhead } = get()
    const clips = captionTrack.clips
      .filter((c) => {
        const words = c.caption?.words ?? []
        return lowConfidenceFraction(words.map((w) => w.confidence)) > 0.2
      })
      .sort((a, b) => a.start - b.start)
    if (clips.length === 0) return false
    // Find first clip starting strictly after the playhead; wrap around if none.
    const next = clips.find((c) => c.start > playhead + 0.001) ?? clips[0]
    get().seek(next.start)
    return true
  },

  // --- TTS (P10.1–P10.4, Doc 12) ---
  listTtsVoices: async () => {
    try {
      const result = await window.api.invoke('tts:listVoices', {})
      if (!result.ok) return { ok: false, error: result.error }
      return { ok: true, voices: result.data }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to list TTS voices.'
      return { ok: false, error: message }
    }
  },

  synthesizeTts: async (clipId, voiceId, language, wordTimings) => {
    const { currentRef, currentProject } = useProjectStore.getState()
    if (currentRef === null || currentProject === null) {
      return { ok: false, error: 'No project is open.' }
    }
    // Gather the text from the clip (text.lines joined with space, or caption text).
    const clip = currentProject.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)
    if (clip === undefined) return { ok: false, error: 'Clip not found.' }
    const lines = clip.text?.lines ?? []
    const captionWords = clip.caption?.words ?? []
    const text =
      lines.length > 0
        ? lines.join(' ')
        : captionWords.map((w) => w.text).join(' ')
    if (text.trim().length === 0) return { ok: false, error: 'Clip has no text to synthesize.' }

    try {
      const result = await window.api.invoke('tts:synthesize', {
        ref: currentRef,
        text,
        voiceId,
        language,
        ...(wordTimings === true ? { wordTimings: true } : {})
      })
      if (!result.ok) return { ok: false, error: result.error }
      return { ok: true, result: result.data }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to synthesize speech.'
      return { ok: false, error: message }
    }
  },

  // --- Translation (P10.5–P10.6, Doc 12) ---
  applyTranslation: async (targetLang) => {
    const { currentRef, currentProject } = useProjectStore.getState()
    if (currentRef === null || currentProject === null) {
      return { ok: false, error: 'No project is open.' }
    }
    // Collect lines from the Caption track's clips.
    const captionTrack = currentProject.tracks.find((t) => t.id === CAPTION_TRACK_ID)
    if (captionTrack === undefined) {
      return { ok: false, error: 'No caption track to translate.' }
    }
    const lines = captionTrack.clips.map((clip) =>
      clip.text?.lines?.join(' ') ??
      clip.caption?.words.map((w) => w.text).join(' ') ??
      ''
    )

    try {
      const result = await window.api.invoke('translation:translate', {
        ref: currentRef,
        lines,
        targetLang
      })
      if (!result.ok) return { ok: false, error: result.error }

      const translated = result.data.translated
      // Stamp captions.translation metadata on the project.
      const translation: CaptionTranslation = { target: targetLang, mode: 'inline' }
      const updatedProject = useProjectStore.getState().currentProject
      if (updatedProject === null) return { ok: false, error: 'No project is open.' }

      // Apply translatedText to each caption clip's text surface (no undo — metadata op).
      const nextTracks = updatedProject.tracks.map((track) => {
        if (track.id !== CAPTION_TRACK_ID) return track
        const nextClips = track.clips.map((clip, i) => ({
          ...clip,
          text: {
            ...clip.text,
            translatedText: [translated[i] ?? '']
          }
        }))
        return { ...track, clips: nextClips }
      })

      useProjectStore.setState({
        currentProject: {
          ...updatedProject,
          captions: { ...updatedProject.captions, translation },
          tracks: nextTracks
        },
        isDirty: true
      })

      return { ok: true, count: translated.length }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to translate captions.'
      return { ok: false, error: message }
    }
  },

  // --- Keyword Highlight (P10.7–P10.8, Doc 12) ---
  autoDetectKeywords: () => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return false
    const captionTrack = project.tracks.find((t) => t.id === CAPTION_TRACK_ID)
    if (captionTrack === undefined) return false
    const transcript = transcriptFromCaptionClips(captionTrack.clips)
    if (transcript === null) return false
    const highlights = detectKeywords(transcript.words)
    get().setKeywordHighlights(highlights)
    return true
  },

  addKeywordHighlight: (word, color) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return
    const existing = (project.captions?.keywordHighlights ?? []) as KeywordHighlight[]
    const lowerWord = word.toLowerCase()
    if (existing.some((h) => h.word === lowerWord)) return

    // Gather all transcript word indices matching this word.
    const captionTrack = project.tracks.find((t) => t.id === CAPTION_TRACK_ID)
    const transcript = captionTrack === undefined ? null : transcriptFromCaptionClips(captionTrack.clips)
    const indices: number[] = []
    if (transcript !== null) {
      transcript.words.forEach((w, i) => {
        if (w.text.toLowerCase() === lowerWord) indices.push(i)
      })
    }
    const newHighlight: KeywordHighlight = { word: lowerWord, color, indices }
    get().setKeywordHighlights([...existing, newHighlight])
  },

  removeKeywordHighlight: (word) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return
    const existing = (project.captions?.keywordHighlights ?? []) as KeywordHighlight[]
    const lowerWord = word.toLowerCase()
    const updated = existing.filter((h) => h.word !== lowerWord)
    get().setKeywordHighlights(updated)
  },

  setKeywordHighlights: (highlights) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return

    // Build a word-to-color lookup for applying to clip runs.
    const colorMap = new Map<string, string>()
    for (const h of highlights) {
      colorMap.set(h.word.toLowerCase(), h.color)
    }

    // Apply `text.runs[].color` to matching words in each caption clip.
    const nextTracks = project.tracks.map((track) => {
      if (track.id !== CAPTION_TRACK_ID) return track
      const nextClips = track.clips.map((clip) => {
        const words = clip.caption?.words ?? []
        if (words.length === 0) return clip
        // Build a runs array: one entry per word; set color if matched, else null.
        const runs = words.map((w) => {
          const color = colorMap.get(w.text.toLowerCase())
          return color !== undefined ? { color } : {}
        })
        return { ...clip, text: { ...clip.text, runs } }
      })
      return { ...track, clips: nextClips }
    })

    useProjectStore.setState({
      currentProject: {
        ...project,
        captions: { ...project.captions, keywordHighlights: highlights },
        tracks: nextTracks
      },
      isDirty: true
    })
  },

  applyTransliteration: (_result, targetLang) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return
    // Persist the transliteration metadata on the captions block. The actual
    // text transformation is applied by the caller (TransliterationTool) which
    // already has the transliterated result; this records which scheme was used
    // so the setting survives reopen.
    const transliteration = { target: targetLang, scheme: 'ISO-15919', mode: 'inline' }
    useProjectStore.setState({
      currentProject: {
        ...project,
        captions: { ...project.captions, transliteration }
      },
      isDirty: true
    })
  },

  // ---------------------------------------------------------------------------
  // P11 — user-managed presets
  // ---------------------------------------------------------------------------

  listUserPresets: async () => {
    try {
      const result = await window.api.invoke('preset:list', {})
      return result.ok ? result.data : []
    } catch {
      return []
    }
  },

  saveUserPreset: async (preset) => {
    try {
      const result = await window.api.invoke('preset:save', { preset })
      return result.ok ? { ok: true } : { ok: false, error: result.error }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  },

  deleteUserPreset: async (id) => {
    try {
      const result = await window.api.invoke('preset:delete', { id })
      return result.ok ? { ok: true } : { ok: false, error: result.error }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  },

  applyUserPreset: (clipId, preset) => {
    const project = useProjectStore.getState().currentProject
    if (project === null) return

    // Resolve the aspect key from the project settings.
    const aspect = project.settings?.aspect ?? '9:16'
    const aspectKey: AspectKey = ['9:16', '16:9', '1:1'].includes(aspect)
      ? (aspect as AspectKey)
      : '9:16'

    // Find the clip across all tracks.
    const track = project.tracks.find((t) => t.clips.some((c) => c.id === clipId))
    const clip = track?.clips.find((c) => c.id === clipId)
    if (clip === undefined) return

    const nextText = applyPresetStyleToClipText(clip.text, preset.style)
    const nextAnimation: import('../../shared/project-schema').ClipAnimation = {
      ...(clip.animation ?? {}),
      ...(preset.animation ?? {})
    }

    // Apply per-aspect layout variant to the clip's transform y-position.
    const variant = resolveVariant(preset.variants, aspectKey)
    const nextTransform = variant?.y !== undefined
      ? { ...clip.transform, y: variant.y }
      : clip.transform

    // Build undoable commands for text + animation (reuses setClipTextCommand).
    useProjectStore.getState().runCommand(setClipTextCommand(project, clipId, nextText))
    useProjectStore.getState().runCommand(setClipAnimationCommand(project, clipId, nextAnimation))
    if (nextTransform !== clip.transform) {
      useProjectStore.getState().runCommand(setClipTransformCommand(project, clipId, nextTransform))
    }
  },

  importUserPresets: async (json) => {
    try {
      const result = await window.api.invoke('preset:import', { json })
      if (!result.ok) return { imported: 0, skipped: 0, errors: [result.error] }
      return result.data
    } catch (err) {
      return { imported: 0, skipped: 0, errors: [err instanceof Error ? err.message : String(err)] }
    }
  },

  exportUserPreset: async (id) => {
    try {
      const result = await window.api.invoke('preset:export', { id })
      if (!result.ok) return null
      return result.data.json
    } catch {
      return null
    }
  },

  // ---------------------------------------------------------------------------
  // P12 — export
  // ---------------------------------------------------------------------------

  startExport: async (jobWithoutRef) => {
    const { currentRef } = useProjectStore.getState()
    if (currentRef === null) throw new Error('No project is open.')
    const job: ExportJob = { ...jobWithoutRef, ref: currentRef }
    const result = await window.api.invoke('export:start', job)
    if (!result.ok) throw new Error(result.error)
    return result.data.jobId
  },

  cancelExport: async (jobId) => {
    try {
      await window.api.invoke('export:cancel', { jobId })
    } catch {
      // Ignore — fire and forget
    }
  }
}))

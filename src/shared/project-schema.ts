/**
 * Clip / track data-model types — the headless contract (master plan §4).
 *
 * Pure types + pure helpers ONLY. NO electron / node / DOM imports leak here so
 * BOTH the renderer (timeline, preview) and a node/vitest engine can import
 * these without rework (master plan §3 process model; constraint C — headless).
 *
 * Every field is taken verbatim from the project.json schema in §4. Text/effect
 * surfaces (`text`, `animation`, `effects`) are OPTIONAL so a Phase-3 video/image
 * clip and a Phase-5+ text clip both satisfy `Clip` with no schema drift.
 */

import type { TargetBox, TrackSample, TrackTargetKind } from './tracking'

/** Per-clip 2D transform (§4 `clips[].transform`). */
export interface ClipTransform {
  x: number
  y: number
  scale: number
  rotation: number
  flipH: boolean
  flipV: boolean
  opacity: number
  /** Layer order within the composite (higher = front). */
  z: number
  /**
   * Caption position anchor (P5.8 — Doc 03). OPTIONAL; present only on caption
   * clips whose position has been set via the Captions panel. `lower-third` |
   * `center` | `top` resolve `y` per aspect + safe margins; `custom` keeps the
   * explicit `y`. Non-caption clips omit it. Recorded so a re-open knows which
   * named anchor the caption block wears (and the panel reflects it).
   */
  captionAnchor?: 'lower-third' | 'center' | 'top' | 'custom'
}

/**
 * The animatable properties a keyframe lane can drive (P8.6, Doc 11). One LANE
 * per prop; each lane is an independent, time-sorted {@link Keyframe}[]. The set
 * mirrors the transform fields the preview evaluator (P8.7) samples:
 *   - `x` / `y`      — center-relative pixel offset (same units as `transform.x/y`)
 *   - `scale`        — uniform scale multiplier (`transform.scale`)
 *   - `rotation`     — degrees (`transform.rotation`)
 *   - `opacity`      — 0..1 (`transform.opacity`)
 */
export type KeyframeProp = 'x' | 'y' | 'scale' | 'rotation' | 'opacity'

/** The animatable keyframe props as a runtime array (value mirror of {@link KeyframeProp}). */
export const KEYFRAME_PROPS: readonly KeyframeProp[] = ['x', 'y', 'scale', 'rotation', 'opacity'] as const

/**
 * A single keyframe on a clip's keyframe lane (P8.6, Doc 11 — `clips[].keyframes`).
 *
 * TIME CONVENTION: `t` is CLIP-LOCAL seconds — the offset from the clip's
 * timeline `start` (i.e. `0` is the clip's first frame, `clipDuration(clip)` is
 * its last). Storing clip-local time means moving the clip on the timeline (or
 * rippling it) never invalidates its keyframes, and the same lane data is valid
 * regardless of `clip.start`. The preview/export sampler (P8.7) converts the
 * playhead to clip-local time before sampling.
 *
 * Each keyframe carries the lane prop's `value` at `t`, plus the `ease` that
 * governs the SEGMENT LEAVING this keyframe (the interpolation from THIS
 * keyframe to the NEXT one). The last keyframe's `ease` is unused (no segment
 * follows it). `ease` is an {@link EasingName} resolved through the shared `ease`
 * registry; it defaults to `'linear'` when absent (backward compatible).
 */
export interface Keyframe {
  /** Clip-local time, in seconds (offset from `clip.start`). */
  t: number
  /** The lane prop's value at `t`. */
  value: number
  /** Named easing for the segment LEAVING this keyframe (defaults to `linear`). */
  ease?: string
}

/**
 * A clip's keyframe lanes (P8.6, Doc 11 — `clips[].keyframes`): one
 * time-sorted {@link Keyframe}[] PER animatable prop. Optional + open so a clip
 * with no motion keyframes omits it entirely (no schema drift); a prop with no
 * keyframes omits its lane. Edited by the pure lane ops in
 * `timeline/keyframes.ts` and sampled by the P8.7 preview/export evaluator.
 */
export type ClipKeyframes = Partial<Record<KeyframeProp, Keyframe[]>>

/** A 2D point (canvas/project-resolution px) on a clip's motion path. */
export interface MotionPathPoint {
  x: number
  y: number
}

/**
 * A custom MOTION PATH the user DREW on the preview (P8.8, Doc 11 — keyframe-engine
 * skill: "motion path = parametric position over progress").
 *
 * `points` is the captured POLYLINE — the ordered vertices of the drawn stroke, in
 * CANVAS (project-resolution) px, interpreted as an ADDITIVE x/y OFFSET on the clip's
 * translate (the same units as `transform.x/y` and the keyframe `x`/`y` lanes). The
 * pure sampler (`sampleMotionPath`) ARC-LENGTH parameterizes the polyline so the clip
 * moves along it at EVEN speed as the clip-local progress runs 0→1.
 *
 * `closed` joins the last point back to the first (a loop the clip orbits). `ease`
 * (an {@link EasingName} resolved through the shared `ease` registry; default
 * `'linear'`) warps PROGRESS before sampling, so the clip can ease in/out along the
 * path. OPTIONAL + open so a clip with no drawn path omits it entirely (no schema
 * drift) and a path-less clip samples to identity (no offset).
 */
export interface ClipMotionPath {
  /** Ordered drawn vertices (canvas px), interpreted as a translate offset. */
  points: MotionPathPoint[]
  /** Join the last point to the first (an orbiting loop). Default open. */
  closed?: boolean
  /** Named easing warping progress 0→1 before sampling (default `linear`). */
  ease?: string
}

/** A clip-edge transition descriptor (§4 `clips[].transitions`). */
export interface ClipTransitions {
  in?: Record<string, unknown>
  out?: Record<string, unknown>
}

/**
 * Motion-tracking attachment (§4 `clips[].tracking`; P8.9 / Doc 11, skill
 * `motion-tracking`). When a target is tracked, the result is persisted here: the
 * picked `targetBox` (the region the user selected, project-resolution px), the
 * per-frame `path` the text follows, and `enabled` to toggle the attachment without
 * losing the tracked data. P8.10's compositor samples `path` at the playhead and
 * offsets the attached text clip's transform by it; manual anchor corrections can
 * override/blend low-confidence samples (skill: "manual correction").
 *
 * Stored verbatim from the {@link import('./tracking').TrackPath} the provider
 * returned, re-using the SAME {@link import('./tracking').TrackSample} /
 * {@link import('./tracking').TargetBox} shapes (a `TrackPath`'s `fps` + `samples`
 * are inlined here as `fps` + `path`). Optional + open so a clip with no tracking
 * omits it entirely (no schema drift) — a Phase-3 clip and a tracked text clip both
 * satisfy `Clip`.
 */
export interface ClipTracking {
  /** Whether the tracking attachment is currently driving the clip's transform. */
  enabled: boolean
  /** The target kind hint (face/object); mirrors `targetBox.kind`. */
  target?: TrackTargetKind
  /** The region the user picked to track (project-resolution px) + kind. */
  targetBox?: TargetBox
  /** Frames per second the `path` samples were produced at. */
  fps?: number
  /** Per-frame tracked transform samples (clip-local seconds), time-sorted. */
  path?: TrackSample[]
  /**
   * MANUAL ANCHOR CORRECTION (P8.10, Doc 11; skill `motion-tracking` — "manual
   * correction"). An additive offset in project-resolution px the user nudges so the
   * attached text sits where they want RELATIVE to the tracked subject (e.g. above a
   * face). It is ADDED on top of the tracked-path offset in the compositor, so the
   * text still follows the subject but at the user-chosen position. Absent → no nudge
   * (`{dx:0, dy:0}`). Pure data — the compositor applies it; nothing here mutates.
   */
  anchor?: { dx: number; dy: number }
  /**
   * JITTER-SMOOTHING amount ∈ [0,1] (P8.10, Doc 11). 0 = the raw path (identity, no
   * smoothing); higher = a stronger low-pass over the path samples to suppress
   * per-frame tracker jitter. The compositor / sampler applies `smoothTrackPath`
   * before sampling. Absent → 0 (raw). Pure parameter.
   */
  smoothing?: number
}

/**
 * Text styling surface (§4 `clips[].text`). Intentionally a single open-ish
 * object so the text-styling phases (Docs 03–06, 08, 10, 15) can read/write
 * their fields without breaking Phase-3 non-text clips, which omit it entirely.
 */
export interface ClipText {
  lang?: string
  /**
   * Per-word text RUNS (P6.9 — Doc 10 per-word color). POSITIONAL: `runs[i]`
   * styles WORD `i` (the i-th token in `caption.words`, same order the per-word
   * draw path lays out). Each run MAY carry a `color` hex that OVERRIDES the base
   * `fill` for that word (baked at the base fill's opacity); a run with no `color`
   * (or a word past the end of the array) keeps the base fill. OPTIONAL + backward
   * compatible — no `runs` → base fill everywhere. Kept as an open `unknown[]` on
   * the schema (forward-compat for future per-word style); the renderer/UI read it
   * through `normalizeTextRuns` (preview/textFillSpec) for the typed `TextRun[]`.
   */
  runs?: unknown[]
  font?: Record<string, unknown>
  align?: 'left' | 'center' | 'right'
  lines?: string[]
  fill?: Record<string, unknown>
  stroke?: unknown[]
  shadow?: Record<string, unknown>
  effects?: unknown[]
  decoration?: Record<string, unknown>
}

/** In/Out/Loop/Reveal animation presets (§4 `clips[].animation`). */
export interface ClipAnimation {
  in?: Record<string, unknown>
  out?: Record<string, unknown>
  loop?: Record<string, unknown>
  reveal?: Record<string, unknown>
}

/** A clip-level (non-text) effect entry (§4 `clips[].effects`). */
export interface ClipEffect {
  type: string
  params?: Record<string, unknown>
}

/**
 * A single word with its on-timeline-relative timestamps, stored on a CAPTION
 * clip (`clips[].caption.words`). Mirrors the STT `Word` shape (text + seconds)
 * but is kept as a self-contained type here so this headless schema module never
 * imports the STT contract. Times are in SECONDS, in the SAME timeline reference
 * as `clip.start`/`clip.out` (Doc 00 §6: `clip.start = wordGroup.start`).
 *
 * Why it lives here: the auto-caption pipeline (Doc 02) maps each grouped
 * caption line onto one text clip; the per-word `{start,end}` must travel WITH
 * the clip so a later phase (Phase 5 active-word highlight / karaoke) can colour
 * the word whose `[start,end]` contains the playhead, and so a "Re-sync" can
 * regroup from the clip's own words. This is the OPTIONAL `caption` surface —
 * only caption clips carry it; ordinary text/video/audio clips omit it.
 */
/**
 * One akshara/syllable timing entry on a lyrics-first caption word.
 * Times share the same timeline reference as the parent `CaptionWord`.
 * Only present when the alignment engine produces sub-word timing (lyrics-first
 * mode with Indic text that has > 1 grapheme cluster per word).
 */
export interface CaptionSyllable {
  /** Visible text of the akshara (grapheme-cluster atomic unit — never split). */
  akshara: string
  /** Syllable start, seconds, same timeline reference as `clip.start`. */
  start: number
  /** Syllable end, seconds. */
  end: number
  /** Confidence in [0,1] for karaoke-fill quality hint. */
  confidence: number
}

export interface CaptionWord {
  /** The word text as recognized (already in the detected script). */
  text: string
  /** Word start time, in seconds (same reference as `clip.start`). */
  start: number
  /** Word end time, in seconds (same reference as `clip.out`). */
  end: number
  /** Optional confidence in [0,1] (alignment/STT quality hint). */
  confidence?: number
  /**
   * Token kind (P5.7 sound-effect cues, Doc 03). Absent/`'spoken'` → an ordinary
   * spoken word that participates in active-word highlight and word-by-word /
   * typewriter reveal. `'cue'` → a bracketed sound-effect cue such as
   * `[applause]` / `(laughs)`: it is rendered in a distinct CUE style and is
   * EXCLUDED from active-word highlight and reveal (it never becomes the active
   * word and is shown for the whole clip, not "spoken" one cluster at a time).
   * Optional + open so non-cue words omit it with no schema drift.
   */
  kind?: 'spoken' | 'cue'
  /**
   * Per-akshara/syllable timing for karaoke syllable fill (lyrics-first mode).
   * Only present when the alignment engine produced sub-word timing AND the word
   * contains more than one grapheme cluster. Each entry covers one akshara
   * (grapheme-cluster atomic unit; Indic conjuncts are never split).
   */
  syllables?: CaptionSyllable[]
}

/**
 * Per-clip CAPTION surface (Doc 02 auto-caption). Present ONLY on clips
 * generated onto the Caption track; carries the word-level timing for the line
 * so active-word highlight (Phase 5) and Re-sync (Doc 02 §2.3) have it locally
 * on the clip. Optional + open so non-caption clips omit it with no schema drift.
 */
export interface ClipCaption {
  /** The line's constituent words, in order, with per-word `{start,end}`. */
  words: CaptionWord[]
}

/**
 * Per-clip audio mix surface (Doc 02 — "Audio panel: import MP3, show waveform,
 * volume/fade"). Optional so video/image/text clips that carry no audio mix omit
 * it entirely (no schema drift). Every field is EXPORT-REPRESENTABLE so the same
 * values drive both the preview and the eventual FFmpeg `volume`/`afade` filters
 * (ffmpeg-export skill) — preview/export parity, master plan §6.
 */
export interface ClipAudio {
  /**
   * Linear gain multiplier applied to the clip's audio (1 = unity / 0 dB,
   * 0 = silent, 2 = +6 dB). Maps directly to FFmpeg `volume=<gain>`.
   */
  gain: number
  /**
   * Fade-in ramp length, in seconds, from the clip's audible start. 0 = none.
   * Maps to FFmpeg `afade=t=in:st=<clipStart>:d=<fadeInSec>`.
   */
  fadeInSec: number
  /**
   * Fade-out ramp length, in seconds, ending at the clip's audible end.
   * 0 = none. Maps to FFmpeg `afade=t=out:st=<end-fadeOutSec>:d=<fadeOutSec>`.
   */
  fadeOutSec: number
  /** True to silence the clip without losing its gain/fade values. */
  muted?: boolean
  /**
   * Detected BEAT times (P8.11, Doc 11; skill `beat-sync`), in SOURCE seconds
   * (offset from the clip's media start, the same reference as `in`/`out`), sorted
   * ascending. Produced by `detectBeats` over the clip's decoded audio and persisted
   * so beat snapping (P8.12) and the ruler markers survive reload. Absent → beats not
   * yet detected. Source-time (not timeline-time) so the markers travel correctly when
   * the clip is moved or trimmed (the timeline mapping adds `start - in`).
   */
  beats?: number[]
}

/**
 * A single timeline clip (§4 `clips[]`). Duration is DERIVED as `out - in`
 * (source trim length); it is never stored, to keep one source of truth.
 *
 * The text/animation/effects surfaces are optional so video, image, and audio
 * clips (Phase 3) and text/effect clips (Phase 5+) all satisfy this type.
 */
export interface Clip {
  id: string
  /** Relative media path within the bundle, e.g. "media/clip1.mp4". */
  mediaRef: string
  /** Source trim start, in seconds. */
  in: number
  /** Source trim end, in seconds. */
  out: number
  /** Timeline position (left edge), in seconds. */
  start: number
  transitions?: ClipTransitions
  transform: ClipTransform
  /** Per-prop keyframe lanes (P8.6, Doc 11). Optional — absent when the clip has no motion keyframes. */
  keyframes?: ClipKeyframes
  /** Custom drawn MOTION PATH (P8.8, Doc 11). Optional — absent when no path was drawn. */
  motionPath?: ClipMotionPath
  tracking?: ClipTracking
  text?: ClipText
  animation?: ClipAnimation
  effects?: ClipEffect[]
  /** Audio mix (gain/fades) — present on audio clips (Doc 02), omitted otherwise. */
  audio?: ClipAudio
  /** Word-level caption timing — present on Caption-track clips (Doc 02), omitted otherwise. */
  caption?: ClipCaption
}

/** Neutral transform applied to a freshly-imported clip (§4 defaults). */
export function defaultTransform(): ClipTransform {
  return { x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false, opacity: 1, z: 0 }
}

/** Neutral audio mix for a freshly-imported audio clip: unity gain, no fades. */
export function defaultClipAudio(): ClipAudio {
  return { gain: 1, fadeInSec: 0, fadeOutSec: 0, muted: false }
}

/**
 * Derived on-timeline (and source) duration of a clip in seconds.
 *
 * Defensive clamp: malformed/corrupt data may transiently produce `out < in`.
 * Rendering/visibility math treats such clips as zero-length instead of a
 * negative duration, preventing timeline/preview divergence.
 */
export function clipDuration(clip: Clip): number {
  const duration = clip.out - clip.in
  return duration > 0 ? duration : 0
}

/**
 * Caption-track generation (P4.7 — Doc 02 auto-caption, `caption-sync` skill).
 *
 * Turns the grouped {@link CaptionLine}[] from P4.6 into the clips of a dedicated
 * CAPTION track: ONE text clip per line, with `clip.start = line.start` and
 * `clip.out = line.out - line.start` (its DURATION — like every text-type clip,
 * `in = 0` and `out` is the length, so the compositor's `out - in` gives the
 * on-screen span `[line.start, line.out)`). PURE + headless-safe: NO DOM / electron / node / crypto
 * / Date — clip ids are supplied by the caller (the renderer action mints them
 * via `crypto.randomUUID`), so this is fully deterministic + unit-testable and
 * reusable by both preview (renderer) and export (main).
 *
 * CAPTION TRACK IDENTITY
 * ----------------------
 * A Caption track is a normal `text`-type track (master plan §4 track types are
 * video|audio|text|effect — there is no separate "caption" type). To make
 * regeneration REPLACE rather than DUPLICATE, the Caption track uses a stable,
 * well-known id {@link CAPTION_TRACK_ID}. Track ids are arbitrary strings in the
 * schema, so a fixed id is schema-valid and lets the store find "the" Caption
 * track deterministically without a new schema flag.
 *
 * WHERE WORD TIMING LIVES
 * -----------------------
 * Each caption clip keeps its line's per-word `{start,end}` on the OPTIONAL
 * `clip.caption.words` surface (see {@link ClipCaption} in project-schema). This
 * travels with the clip so Phase 5 active-word highlight / karaoke can colour the
 * word under the playhead, and a "Re-sync" (Doc 02 §2.3) can regroup straight
 * from the clip's own words. The visible text also lives in `clip.text.lines`
 * (the text surface the compositor draws and the inline editor edits); editing
 * that text does NOT touch `clip.caption.words`, so timing is preserved across a
 * text edit (the runbook's "Editing text preserves timing").
 */
import type { Clip, ClipCaption, ClipText, ClipTransform, CaptionSyllable } from '../../../shared/project-schema'
import type { PresetFill, PresetShadow, PresetStrokeLayer } from '../../../shared/captionPreset'
import { defaultTransform } from '../../../shared/project-schema'
import type { CaptionLine } from '../../../shared/captionSync'
import { groupWordsIntoLines } from '../../../shared/captionSync'
import type { GroupingOptions } from '../../../shared/captionSync'
import type { LanguageCode, Transcript, Word } from '../../../shared/stt'
import { DEFAULT_LANGUAGE, asLanguageCode } from '../../../shared/stt'
import type { Project } from '../../../shared/storage'
import type { CaptionPreset, LayoutAnchor } from '../../../shared/captionPreset'
import { captionPresetToClipStyle } from '../../../shared/captionPreset'
import { DEFAULT_FONT_FAMILY, defaultFallbackChain } from '../../../shared/fontRegistry'
import { TEXT_CLIP_MEDIA_REF } from './textClip'
import { markCueWords } from './captionCue'

/**
 * Stable id of the dedicated Caption track. Fixed (not random) so regenerating
 * captions finds and REPLACES the same track instead of creating a duplicate.
 */
export const CAPTION_TRACK_ID = 'caption-track'

/** The Caption track's schema track type (a `text` track; §4 has no `caption` type). */
export const CAPTION_TRACK_TYPE = 'text' as const

/**
 * Floor (seconds) for a caption clip's DURATION so a degenerate zero-length line
 * (a word whose `start === end`) still renders for a beat instead of vanishing.
 * Tiny on purpose — normal lines are far longer, so it never alters real timing.
 */
const MIN_CAPTION_DURATION_SEC = 0.001

/**
 * Default caption STYLE applied to every generated caption clip's `text`
 * surface. CapCut-like baseline: centre-aligned, a bold body with a black
 * outline + soft shadow for legibility over any footage. `lang` is filled in
 * per-generation from the transcript's detected language (drives Indic shaping).
 * Later phases (Doc 03 caption presets) override these via `captions.styleId`.
 *
 * INDIC-FIRST (P6.17): the body `font.family` is the registry's Tamil-capable
 * {@link DEFAULT_FONT_FAMILY} and `font.fallback` is the Indic-first per-script
 * chain ({@link defaultFallbackChain}) — so auto-generated Tamil/Telugu/Malayalam/
 * Kannada/Hindi captions shape correctly out of the box (no tofu) and fall back
 * per script ending in a Latin family + generic. Resolved from the font registry
 * (single source of truth) so it cannot drift from the global default.
 */
export function defaultCaptionStyle(): Omit<ClipText, 'lines' | 'lang'> {
  return {
    align: 'center',
    font: {
      family: DEFAULT_FONT_FAMILY,
      size: 48,
      bold: true,
      italic: false,
      letterSpacing: 0,
      lineHeight: 1.2,
      fallback: defaultFallbackChain()
    },
    fill: { type: 'solid', value: '#ffffff', opacity: 1 },
    stroke: [{ color: '#000000', width: 4 }],
    shadow: { color: '#000000', opacity: 0.6, blur: 8, angle: 45, distance: 4, inner: false, long: false }
  }
}

/**
 * Default TRANSFORM for a caption clip: neutral except anchored toward the lower
 * third (CapCut captions sit near the bottom). `y` is a normalized offset the
 * compositor interprets; kept here so generated captions are immediately
 * positioned sensibly without a manual move.
 */
export function defaultCaptionTransform(): ClipTransform {
  return { ...defaultTransform(), y: 0.35 }
}

/** Inputs the caller computes outside this pure builder (id from the renderer). */
export interface BuildCaptionClipOptions {
  /** Caller-generated clip id (crypto.randomUUID in the renderer action). */
  id: string
  /** The grouped line this clip represents (provides start/out/text/words). */
  line: CaptionLine
  /** Detected/pinned language code → `clip.text.lang` (drives Indic shaping). */
  lang?: string
}

/**
 * Build ONE caption text clip from a {@link CaptionLine}:
 *   - `start = line.start`; `in = 0`; `out = line.out - line.start` (the clip's
 *     DURATION, seconds). This mirrors {@link buildTextClip} (all text-type clips
 *     use `in = 0`, `out = duration`) so the compositor's `dur = out - in`
 *     yields the correct on-screen span `[start, start + dur) = [line.start,
 *     line.out)`. (Storing `out = line.out` absolute — as an earlier version did —
 *     made `dur = line.out`, so every caption stayed on screen for its whole
 *     absolute-end time and they all overlapped.)
 *   - `mediaRef = ''` (the text-clip "no media" sentinel, shared with text clips).
 *   - `text` = the line text as a single line + the default caption style + `lang`.
 *   - `caption.words` = the line's words (per-word timing for active-word highlight,
 *     kept in ABSOLUTE seconds — highlight compares them against the playhead).
 * Pure + deterministic.
 */
export function buildCaptionClip(options: BuildCaptionClipOptions): Clip {
  const { id, line, lang } = options
  const text: ClipText = {
    ...defaultCaptionStyle(),
    lines: [line.text],
    ...(lang !== undefined ? { lang } : {})
  }
  // Mark bracketed sound-effect cues (P5.7) at ingest so the persisted
  // `caption.words` carry `kind:'cue'` and downstream highlight/reveal/render can
  // branch on the flag without re-parsing text.
  const caption: ClipCaption = {
    words: markCueWords(
      line.words.map((w) => {
        const syllables = (w as { syllables?: CaptionSyllable[] }).syllables
        return {
          text: w.text,
          start: w.start,
          end: w.end,
          ...(w.confidence !== undefined ? { confidence: w.confidence } : {}),
          ...(syllables !== undefined ? { syllables } : {})
        }
      })
    )
  }
  // Duration = line span; guard a tiny positive floor so a degenerate zero-length
  // line still renders one frame instead of vanishing.
  const duration = Math.max(MIN_CAPTION_DURATION_SEC, line.out - line.start)
  return {
    id,
    mediaRef: TEXT_CLIP_MEDIA_REF,
    in: 0,
    out: duration,
    start: line.start,
    transform: defaultCaptionTransform(),
    text,
    caption
  }
}

/**
 * Build the full caption clip array from grouped lines: one clip per line, in
 * order, ids drawn from `mintId()` (the caller supplies a fresh id per call so
 * this stays pure — the renderer passes `crypto.randomUUID`). N lines → N clips.
 * An empty `lines` array yields `[]`.
 */
export function buildCaptionClips(
  lines: CaptionLine[],
  mintId: () => string,
  lang?: string
): Clip[] {
  return lines.map((line) => buildCaptionClip({ id: mintId(), line, lang }))
}

/**
 * One-shot convenience: group a {@link Transcript}'s words into lines (reusing
 * the P4.6 {@link groupWordsIntoLines} — grouping is NOT reimplemented here) and
 * build the caption clip array, tagging each clip's `text.lang` with the
 * transcript's detected language. Empty transcript → `[]`. Pure (ids from
 * `mintId`, grouping options passed through).
 */
export function buildCaptionClipsFromTranscript(
  transcript: Transcript,
  mintId: () => string,
  opts?: GroupingOptions
): Clip[] {
  const lines = groupWordsIntoLines(transcript.words, opts)
  return buildCaptionClips(lines, mintId, transcript.language)
}

/**
 * Reconstruct a word-level {@link Transcript} from the Caption track's clips —
 * the renderer-side STORED-transcript source that a Re-sync (Doc 02 §2.3)
 * regroups from WITHOUT re-running STT (`caption-sync` skill: "Re-sync regroups
 * from the stored transcript; never re-transcribes").
 *
 * Each caption clip carries its line's per-word `{text,start,end}` on the
 * optional `clip.caption.words` surface (see {@link buildCaptionClip}); that
 * timing survives a manual TEXT edit (which only touches `clip.text.lines`), so
 * it remains the authoritative spoken-word timing to regroup from. We flatten
 * those words across the track's clips IN ORDER. Clips with no `caption.words`
 * (e.g. a hand-added text clip dropped on the Caption track) contribute nothing.
 *
 * The language is recovered from the first caption clip's `text.lang` (the code
 * `buildCaptionClip` tagged at generation) when it is one of the supported
 * codes, falling back to {@link DEFAULT_LANGUAGE} (Tamil). Returns `null` when
 * `clips` holds NO word timing at all (nothing to regroup → caller no-ops),
 * distinguishing "empty Caption track" from "a real but wordless track".
 *
 * Pure + deterministic.
 */
export function transcriptFromCaptionClips(clips: readonly Clip[]): Transcript | null {
  const words: Word[] = []
  for (const clip of clips) {
    const captionWords = clip.caption?.words
    if (captionWords === undefined) continue
    for (const w of captionWords) {
      words.push({
        text: w.text,
        start: w.start,
        end: w.end,
        ...(w.confidence !== undefined ? { confidence: w.confidence } : {})
      })
    }
  }
  if (words.length === 0) return null

  let language: LanguageCode = DEFAULT_LANGUAGE
  for (const clip of clips) {
    const lang = clip.text?.lang
    if (lang !== undefined) {
      language = asLanguageCode(lang) ?? language
      break
    }
  }
  return { language, words }
}

/**
 * Stamp a {@link CaptionPreset}'s clip-side style onto ONE caption clip,
 * honoring the P5.1 contract ({@link captionPresetToClipStyle}):
 *   - `clip.text.*`      ← preset style fields (font/fill/stroke/shadow/decoration/align)
 *   - `clip.animation`   ← preset in/out/loop/reveal bundle
 *   - `clip.transform`   ← shallow-merged with the layout-anchor transform patch
 * while PRESERVING the spoken content + timing: `clip.text.lines`, `clip.text.lang`,
 * and `clip.caption.words` are carried over UNCHANGED. The style fields are
 * REPLACED wholesale (not deep-merged) so switching presets never leaves cruft
 * from a previous preset's style.
 *
 * Pure + immutable: returns a new clip; the input is never mutated.
 */
export function stampPresetOntoClip(clip: Clip, preset: CaptionPreset): Clip {
  const style = captionPresetToClipStyle(preset)
  // Preserve ONLY the content/timing fields of the existing text surface; the
  // style fields come entirely from the preset (replace, not deep-merge).
  const text: ClipText = {
    ...style.text,
    ...(clip.text?.lines !== undefined ? { lines: clip.text.lines } : {}),
    ...(clip.text?.lang !== undefined ? { lang: clip.text.lang } : {})
  }
  return {
    ...clip,
    text,
    animation: style.animation,
    transform: { ...clip.transform, ...style.transformPatch }
    // clip.caption (the per-word timing) is carried through untouched by spread.
  }
}

/**
 * Stamp a {@link CaptionPreset} onto EVERY clip of the Caption track
 * ({@link CAPTION_TRACK_ID}) — the pure core of P5.4 "apply preset to track".
 * Returns a NEW Project with each caption clip restyled per {@link stampPresetOntoClip}
 * (text/animation/transform replaced from the preset, lines/lang/caption.words
 * preserved). Non-caption tracks and all other clips are untouched. No-op (returns
 * the input project reference) when there is no Caption track. Pure + immutable.
 *
 * NOTE: this stamps the per-clip STYLE only; recording `captions.styleId` on the
 * project is done alongside it by the command/action layer.
 */
export function stampPresetOntoClips(project: Project, preset: CaptionPreset): Project {
  const trackIndex = project.tracks.findIndex((t) => t.id === CAPTION_TRACK_ID)
  if (trackIndex === -1) return project
  const tracks = project.tracks.map((track, i) =>
    i === trackIndex
      ? { ...track, clips: track.clips.map((c) => stampPresetOntoClip(c, preset)) }
      : track
  )
  return { ...project, tracks }
}

/**
 * Set a caption clip's POSITION (P5.8 — Doc 03): record the chosen `anchor` on
 * `clip.transform.captionAnchor` and the resolved center-relative pixel offset
 * on `clip.transform.y`. The `y` is computed OUTSIDE this pure helper (the store
 * action runs the aspect/safe-margin math in {@link resolveCaptionY}) and passed
 * in already clamped, keeping this function pure + deterministic. Returns a NEW
 * clip; the input is never mutated. Only the transform's `y` + `captionAnchor`
 * change — every other field (text/animation/caption.words) is carried through.
 */
export function setCaptionPositionOnClip(
  clip: Clip,
  anchor: LayoutAnchor,
  y: number,
  x?: number
): Clip {
  return {
    ...clip,
    transform: {
      ...clip.transform,
      y,
      // Horizontal offset (px from center) is OPTIONAL — omitted keeps the clip's
      // current `x` (captions are centered by default, x = 0).
      ...(x !== undefined ? { x } : {}),
      captionAnchor: anchor
    }
  }
}

/**
 * Set the POSITION (anchor + resolved pixel `y`) on EVERY clip of the Caption
 * track ({@link CAPTION_TRACK_ID}) — the pure core of P5.8's "position controls".
 * Returns a NEW Project with each caption clip repositioned per
 * {@link setCaptionPositionOnClip}; non-caption tracks/clips are untouched.
 * No-op (returns the input reference) when there is no Caption track. The caller
 * (store action) supplies the already-resolved, safe-clamped `y`. Pure + immutable.
 */
export function setCaptionPositionOnClips(
  project: Project,
  anchor: LayoutAnchor,
  y: number,
  x?: number
): Project {
  const trackIndex = project.tracks.findIndex((t) => t.id === CAPTION_TRACK_ID)
  if (trackIndex === -1) return project
  const tracks = project.tracks.map((track, i) =>
    i === trackIndex
      ? { ...track, clips: track.clips.map((c) => setCaptionPositionOnClip(c, anchor, y, x)) }
      : track
  )
  return { ...project, tracks }
}

/**
 * Stamp a new font size onto ONE caption clip's text surface.
 * Preserves lines/lang/caption.words/fill/stroke/shadow/animation untouched.
 */
export function setCaptionFontSizeOnClip(clip: Clip, size: number): Clip {
  if (clip.text === undefined) return clip
  const font = clip.text.font ?? {}
  return {
    ...clip,
    text: { ...clip.text, font: { ...font, size } }
  }
}

/**
 * Stamp a new font size onto EVERY clip of the Caption track.
 * No-op when no Caption track exists.
 */
export function setCaptionFontSizeOnClips(project: Project, size: number): Project {
  const trackIndex = project.tracks.findIndex((t) => t.id === CAPTION_TRACK_ID)
  if (trackIndex === -1) return project
  const tracks = project.tracks.map((track, i) =>
    i === trackIndex
      ? { ...track, clips: track.clips.map((c) => setCaptionFontSizeOnClip(c, size)) }
      : track
  )
  return { ...project, tracks }
}

/**
 * Stamp a new font FAMILY (+ per-script fallback chain) onto ONE caption clip.
 * Preserves lines/lang/caption.words/fill/stroke/shadow/animation/size untouched.
 */
export function setCaptionFontFamilyOnClip(clip: Clip, family: string): Clip {
  if (clip.text === undefined) return clip
  const font = clip.text.font ?? {}
  return {
    ...clip,
    text: {
      ...clip.text,
      // Keep the chosen family FIRST, then the Indic-first fallback so a Tamil/etc.
      // run still shapes if the chosen family lacks the script's glyphs.
      font: { ...font, family, fallback: defaultFallbackChain() }
    }
  }
}

/**
 * Stamp a new font family onto EVERY clip of the Caption track.
 * No-op when no Caption track exists.
 */
export function setCaptionFontFamilyOnClips(project: Project, family: string): Project {
  const trackIndex = project.tracks.findIndex((t) => t.id === CAPTION_TRACK_ID)
  if (trackIndex === -1) return project
  const tracks = project.tracks.map((track, i) =>
    i === trackIndex
      ? { ...track, clips: track.clips.map((c) => setCaptionFontFamilyOnClip(c, family)) }
      : track
  )
  return { ...project, tracks }
}

/**
 * Wrap ONE caption clip's text into multiple visual lines by word count.
 * Joins all current `text.lines` with a space, splits by whitespace, then
 * groups into chunks of `maxWordsPerLine` words — each chunk becomes one
 * element of `text.lines`. No new clip is created; only the line breaks move.
 * No-op when `clip.text` is undefined or `maxWordsPerLine <= 0`.
 */
export function setCaptionLetterSpacingOnClip(clip: Clip, letterSpacing: number): Clip {
  if (clip.text === undefined) return clip
  const font = clip.text.font ?? {}
  return { ...clip, text: { ...clip.text, font: { ...font, letterSpacing } } }
}

export function setCaptionLetterSpacingOnClips(project: Project, letterSpacing: number): Project {
  const trackIndex = project.tracks.findIndex((t) => t.id === CAPTION_TRACK_ID)
  if (trackIndex === -1) return project
  const tracks = project.tracks.map((track, i) =>
    i === trackIndex
      ? { ...track, clips: track.clips.map((c) => setCaptionLetterSpacingOnClip(c, letterSpacing)) }
      : track
  )
  return { ...project, tracks }
}

export function setCaptionLineHeightOnClip(clip: Clip, lineHeight: number): Clip {
  if (clip.text === undefined) return clip
  const font = clip.text.font ?? {}
  return { ...clip, text: { ...clip.text, font: { ...font, lineHeight } } }
}

export function setCaptionLineHeightOnClips(project: Project, lineHeight: number): Project {
  const trackIndex = project.tracks.findIndex((t) => t.id === CAPTION_TRACK_ID)
  if (trackIndex === -1) return project
  const tracks = project.tracks.map((track, i) =>
    i === trackIndex
      ? { ...track, clips: track.clips.map((c) => setCaptionLineHeightOnClip(c, lineHeight)) }
      : track
  )
  return { ...project, tracks }
}

export function setCaptionFillOnClips(project: Project, fill: PresetFill): Project {
  const trackIndex = project.tracks.findIndex((t) => t.id === CAPTION_TRACK_ID)
  if (trackIndex === -1) return project
  const tracks = project.tracks.map((track, i) =>
    i === trackIndex
      ? {
          ...track,
          clips: track.clips.map((c) =>
            c.text === undefined ? c : { ...c, text: { ...c.text, fill: fill as unknown as Record<string, unknown> } }
          )
        }
      : track
  )
  return { ...project, tracks }
}

export function setCaptionShadowOnClips(project: Project, shadow: PresetShadow | null): Project {
  const trackIndex = project.tracks.findIndex((t) => t.id === CAPTION_TRACK_ID)
  if (trackIndex === -1) return project
  const tracks = project.tracks.map((track, i) =>
    i === trackIndex
      ? {
          ...track,
          clips: track.clips.map((c) => {
            if (c.text === undefined) return c
            const text = { ...c.text }
            if (shadow === null) {
              delete text.shadow
            } else {
              text.shadow = shadow as unknown as Record<string, unknown>
            }
            return { ...c, text }
          })
        }
      : track
  )
  return { ...project, tracks }
}

export function setCaptionGlowOnClips(
  project: Project,
  glow: { radius: number; color: string } | null
): Project {
  const trackIndex = project.tracks.findIndex((t) => t.id === CAPTION_TRACK_ID)
  if (trackIndex === -1) return project
  const tracks = project.tracks.map((track, i) =>
    i === trackIndex
      ? {
          ...track,
          clips: track.clips.map((c) => {
            if (c.text === undefined) return c
            const existing = (c.text.effects ?? []) as { type: string; params?: unknown }[]
            const nonGlow = existing.filter((e) => e.type !== 'glow')
            const effects = glow === null ? nonGlow : [...nonGlow, { type: 'glow', params: glow }]
            return { ...c, text: { ...c.text, effects: effects as ClipText['effects'] } }
          })
        }
      : track
  )
  return { ...project, tracks }
}

export function setCaptionStrokeOnClips(project: Project, stroke: PresetStrokeLayer[]): Project {
  const trackIndex = project.tracks.findIndex((t) => t.id === CAPTION_TRACK_ID)
  if (trackIndex === -1) return project
  const tracks = project.tracks.map((track, i) =>
    i === trackIndex
      ? {
          ...track,
          clips: track.clips.map((c) =>
            c.text === undefined
              ? c
              : { ...c, text: { ...c.text, stroke: stroke as ClipText['stroke'] } }
          )
        }
      : track
  )
  return { ...project, tracks }
}

export function wrapClipTextByWords(clip: Clip, maxWordsPerLine: number): Clip {
  if (clip.text === undefined || maxWordsPerLine <= 0) return clip
  const full = (clip.text.lines ?? []).join(' ').trim()
  if (full === '') return clip
  const words = full.split(/\s+/)
  const chunks: string[] = []
  for (let i = 0; i < words.length; i += maxWordsPerLine) {
    chunks.push(words.slice(i, i + maxWordsPerLine).join(' '))
  }
  return { ...clip, text: { ...clip.text, lines: chunks } }
}

/**
 * Apply {@link wrapClipTextByWords} to EVERY clip of the Caption track.
 * No-op when no Caption track exists.
 */
export function wrapCaptionClipsByWords(project: Project, maxWordsPerLine: number): Project {
  const trackIndex = project.tracks.findIndex((t) => t.id === CAPTION_TRACK_ID)
  if (trackIndex === -1) return project
  const tracks = project.tracks.map((track, i) =>
    i === trackIndex
      ? { ...track, clips: track.clips.map((c) => wrapClipTextByWords(c, maxWordsPerLine)) }
      : track
  )
  return { ...project, tracks }
}

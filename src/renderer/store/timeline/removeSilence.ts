/**
 * Remove-silence: detect silence/filler from the transcript (and optionally the
 * waveform) and ripple it out of the timeline (P4.11, Doc 02 §2 — audio &
 * auto-caption). PURE + headless-safe: NO DOM / electron / node / Date.now /
 * Math.random — proven by node-env vitest, reusable by preview AND export.
 *
 * TWO PURE PIECES
 * ---------------
 *  1. {@link detectSilenceRanges} — given the word-level transcript (the spoken
 *     timing) plus a config, returns the disjoint time ranges to REMOVE: the
 *     long no-speech gaps (silence) and, optionally, the spans of filler tokens
 *     (um / uh / …). It never re-runs STT and never needs audio bytes; an
 *     optional waveform-peaks hook can VETO a gap that is not actually quiet.
 *
 *  2. {@link rippleRemoveRanges} — given a Project and those ranges, removes the
 *     ranges from EVERY track in lock-step: clips fully inside a range are
 *     dropped, clips after a range shift earlier by the removed duration, clips
 *     that straddle a range are trimmed, and a CAPTION clip's per-word
 *     `caption.words` timing is shifted by the SAME map so captions stay aligned
 *     to the now-shortened audio (no drift). Composes for multiple cuts.
 *
 * The renderer wires these into ONE undoable `removeSilenceCommand`
 * (see commands.ts) so a Remove-silence run is a single undo step.
 */
import type { Project, ProjectTrack } from '../../../shared/storage'
import type { Clip, CaptionWord } from '../../../shared/project-schema'
import type { Word } from '../../../shared/stt'
import { clipLength } from './reducers'

/**
 * A half-open time range `[start, end)` (seconds) to be removed from the
 * timeline. `end > start`. Ranges returned by detection are disjoint and sorted
 * by `start`.
 */
export interface TimeRange {
  start: number
  end: number
}

/**
 * Default filler tokens flagged for removal (English + romanized Indic
 * hesitations). Compared case-insensitively after stripping surrounding
 * punctuation; callers may override the list entirely via
 * {@link DetectSilenceConfig.fillerWords}.
 */
export const DEFAULT_FILLER_WORDS: readonly string[] = [
  'um',
  'uh',
  'umm',
  'uhh',
  'erm',
  'er',
  'hmm',
  'mhm',
  'ah',
  'eh',
  'like',
  'aa',
  'aaa'
]

/** Tunables for {@link detectSilenceRanges}. */
export interface DetectSilenceConfig {
  /**
   * Minimum silent gap (seconds) between consecutive spoken words to remove.
   * A gap is the time from one word's `end` to the next word's `start`. Gaps
   * `<= minSilenceSec` are KEPT (natural breathing room). Default 0.5.
   */
  minSilenceSec?: number
  /**
   * Leading silence before the first word and trailing silence after the last
   * word are also gaps; this caps how much head/tail silence to KEEP as
   * padding around speech (seconds). The excess beyond `padSec` past the
   * minimum-gap threshold is removed. Default 0 (no head/tail trim) — set to
   * remove dead air at the very start/end.
   */
  padSec?: number
  /** Whether to also remove filler-word spans. Default true. */
  removeFiller?: boolean
  /** Filler token list (case-insensitive). Defaults to {@link DEFAULT_FILLER_WORDS}. */
  fillerWords?: readonly string[]
  /**
   * Optional waveform veto: given a candidate SILENT gap `[start,end)`, return
   * false to KEEP it (the audio is not actually quiet there — e.g. music). When
   * omitted, every gap past the threshold is removed. Pure callback (the panel
   * passes one backed by the decoded peaks; detection stays testable without it).
   */
  isQuiet?: (range: TimeRange) => boolean
}

/** Resolved config with all defaults applied. */
interface ResolvedConfig {
  minSilenceSec: number
  padSec: number
  removeFiller: boolean
  fillerSet: ReadonlySet<string>
  isQuiet: ((range: TimeRange) => boolean) | null
}

const DEFAULTS = {
  minSilenceSec: 0.5,
  padSec: 0,
  removeFiller: true
} as const

function resolveConfig(config?: DetectSilenceConfig): ResolvedConfig {
  const fillerWords = config?.fillerWords ?? DEFAULT_FILLER_WORDS
  return {
    minSilenceSec: config?.minSilenceSec ?? DEFAULTS.minSilenceSec,
    padSec: config?.padSec ?? DEFAULTS.padSec,
    removeFiller: config?.removeFiller ?? DEFAULTS.removeFiller,
    fillerSet: new Set(fillerWords.map(normalizeFiller)),
    isQuiet: config?.isQuiet ?? null
  }
}

/** Lower-case + strip leading/trailing non-letter/number punctuation for matching. */
function normalizeFiller(text: string): string {
  // Strip common surrounding punctuation; keep inner letters/marks intact so
  // Indic scripts are unaffected. Unicode-aware trim of edge punctuation.
  return text
    .toLowerCase()
    .replace(/^[\s.,!?;:"'(){}[\]…।॥-]+/u, '')
    .replace(/[\s.,!?;:"'(){}[\]…।॥-]+$/u, '')
}

/**
 * Detect the disjoint, sorted time ranges to REMOVE from the timeline.
 *
 * SILENCE: between consecutive words `prev` and `next`, the gap is
 * `next.start - prev.end`. When that exceeds `minSilenceSec`, the gap interior
 * is removed but `padSec` of breathing room is KEPT on each side, i.e. the
 * removed range is `[prev.end + padSec, next.start - padSec)` (only when that
 * stays non-empty). The same padding logic trims head silence (before the first
 * word, measured from 0) and tail silence is NOT inferred here (the timeline end
 * is unknown to detection) — head/tail beyond the words is the caller's via the
 * audio-clip span, but leading dead-air from 0 to the first word IS handled.
 *
 * FILLER (when `removeFiller`): any word whose normalized text is in the filler
 * set contributes its `[start, end)` span as a removed range.
 *
 * The optional `isQuiet` veto can drop a silence range that is not actually
 * quiet. Filler ranges are never vetoed (they are explicit tokens).
 *
 * Overlapping/touching ranges (e.g. a filler word adjacent to a silence gap) are
 * MERGED so the output is disjoint and sorted. Empty `words` → `[]`.
 */
export function detectSilenceRanges(words: readonly Word[], config?: DetectSilenceConfig): TimeRange[] {
  const cfg = resolveConfig(config)
  const ranges: TimeRange[] = []

  // Head silence: from 0 up to the first word, keep `padSec` before the word.
  if (words.length > 0) {
    const first = words[0]
    const headGap = first.start // gap from timeline 0 to first word
    if (headGap > cfg.minSilenceSec) {
      const cut: TimeRange = { start: 0, end: first.start - cfg.padSec }
      if (cut.end > cut.start && (cfg.isQuiet === null || cfg.isQuiet(cut))) ranges.push(cut)
    }
  }

  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1]
    const next = words[i]
    const gap = next.start - prev.end
    if (gap > cfg.minSilenceSec) {
      const cut: TimeRange = { start: prev.end + cfg.padSec, end: next.start - cfg.padSec }
      if (cut.end > cut.start && (cfg.isQuiet === null || cfg.isQuiet(cut))) ranges.push(cut)
    }
  }

  if (cfg.removeFiller) {
    for (const w of words) {
      if (cfg.fillerSet.has(normalizeFiller(w.text)) && w.end > w.start) {
        ranges.push({ start: w.start, end: w.end })
      }
    }
  }

  return mergeRanges(ranges)
}

/**
 * Sort + merge overlapping/touching ranges into a disjoint, ascending list.
 * Pure. Two ranges merge when the later one starts at or before the running
 * end (`<=`), so adjacent cuts (filler immediately after a gap) coalesce.
 */
export function mergeRanges(ranges: readonly TimeRange[]): TimeRange[] {
  const sorted = [...ranges].filter((r) => r.end > r.start).sort((a, b) => a.start - b.start)
  const merged: TimeRange[] = []
  for (const r of sorted) {
    const last = merged[merged.length - 1]
    if (last !== undefined && r.start <= last.end) {
      if (r.end > last.end) last.end = r.end
    } else {
      merged.push({ start: r.start, end: r.end })
    }
  }
  return merged
}

/** Total seconds covered by a disjoint range list (the timeline shrinkage). */
export function totalRemoved(ranges: readonly TimeRange[]): number {
  return ranges.reduce((sum, r) => sum + (r.end - r.start), 0)
}

/**
 * Map a timeline time `t` to its position AFTER all `ranges` (sorted, disjoint)
 * are removed. Subtracts the total removed duration that lies STRICTLY before
 * `t`; a `t` inside a removed range collapses to that range's (post-shift) start.
 * Pure + monotonic non-decreasing — the backbone of the ripple so clips and the
 * per-word timing shift by EXACTLY the same amount (no drift).
 */
export function shiftTime(t: number, ranges: readonly TimeRange[]): number {
  let removedBefore = 0
  for (const r of ranges) {
    if (r.end <= t) {
      // Whole range is before t: it shifts t left by its full width.
      removedBefore += r.end - r.start
    } else if (r.start < t) {
      // t falls inside this range: collapse to the range start, plus whatever
      // earlier ranges already removed. (t - r.start) is discarded.
      removedBefore += t - r.start
    } else {
      // Range is at/after t — and the rest are too (sorted): stop.
      break
    }
  }
  return t - removedBefore
}

/**
 * Remap a single clip through the removed `ranges`, returning the surviving clip
 * (with shifted `start`, trimmed source `in`/`out`, and — for caption clips —
 * shifted `caption.words`), or `null` if the clip is entirely consumed.
 *
 * The clip's timeline span is `[start, start + length)` where `length = out-in`.
 * We compute the NEW span via {@link shiftTime} on both edges; the surviving
 * timeline length is `newEnd - newStart`. The amount removed from BEFORE the
 * clip's interior trims the SOURCE window: the portion of the clip's own span
 * that fell inside removed ranges is cut out of `[in,out]` from the front in
 * proportion (a straddling cut shortens the clip). Because audio/video source is
 * linear, we trim the source by the same total interior removal, anchoring on
 * `in`.
 *
 * For caption clips, per-word `{start,end}` are absolute timeline times, so each
 * is run through the SAME `shiftTime`; words fully inside a removed range
 * collapse to zero-length and are dropped, keeping the surviving words aligned.
 */
export function remapClip(clip: Clip, ranges: readonly TimeRange[]): Clip | null {
  const length = clipLength(clip)
  const oldStart = clip.start
  const oldEnd = clip.start + length

  const newStart = shiftTime(oldStart, ranges)
  const newEnd = shiftTime(oldEnd, ranges)
  const newLength = newEnd - newStart

  // Entire clip consumed by removed ranges → drop it.
  if (newLength <= 0) return null

  // Interior removal = how much of THIS clip's own span was cut.
  const interiorRemoved = length - newLength
  // Trim the source window from the front by the interior removal so the kept
  // frames map to the kept timeline span. (`in` advances; `out` follows length.)
  const nextIn = clip.in + interiorRemoved
  const nextOut = nextIn + newLength

  const next: Clip = { ...clip, start: newStart, in: nextIn, out: nextOut }

  if (clip.caption !== undefined) {
    next.caption = { ...clip.caption, words: remapCaptionWords(clip.caption.words, ranges) }
  }

  return next
}

/**
 * Shift each caption word's `{start,end}` through `ranges` and drop words fully
 * inside a removed range (their span collapses to <= 0). Pure.
 */
export function remapCaptionWords(
  words: readonly CaptionWord[],
  ranges: readonly TimeRange[]
): CaptionWord[] {
  const out: CaptionWord[] = []
  for (const w of words) {
    const start = shiftTime(w.start, ranges)
    const end = shiftTime(w.end, ranges)
    if (end > start) out.push({ ...w, start, end })
  }
  return out
}

/**
 * Ripple-remove the time `ranges` from EVERY track of `project` in lock-step.
 * Each clip is remapped via {@link remapClip}; dropped clips (fully inside a
 * range) are removed, survivors keep their relative order. Ranges are merged +
 * sorted first so the caller can pass raw detection output. Pure + immutable:
 * returns a NEW Project, input untouched. No-op (returns the same project value)
 * when there are no effective ranges.
 */
export function rippleRemoveRanges(project: Project, ranges: readonly TimeRange[]): Project {
  const merged = mergeRanges(ranges)
  if (merged.length === 0) return project

  const tracks = project.tracks.map((track): ProjectTrack => {
    const clips: Clip[] = []
    for (const clip of track.clips) {
      const next = remapClip(clip, merged)
      if (next !== null) clips.push(next)
    }
    return { ...track, clips }
  })
  return { ...project, tracks }
}

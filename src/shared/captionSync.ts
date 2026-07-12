/**
 * Word → caption-line grouping (P4.6, Doc 02 §2.3, `caption-sync` skill).
 *
 * Turns the word-level {@link Word}[] from a {@link Transcript} into ordered,
 * timed caption lines. PURE + deterministic: no IPC, no fs, no electron/node —
 * so it is fully unit-testable and reusable by BOTH preview (renderer) and
 * export (main). P4.7 maps each line onto a Caption-track text clip where
 * `clip.start = line.start` and `clip.out = line.out` (Doc 00 §6, line 189).
 *
 * Grouping rules (`caption-sync` skill):
 *   - Greedy fill up to `maxCharsPerLine`, counted in GRAPHEME CLUSTERS (not
 *     codepoints) so Tamil/Indic conjuncts wrap as one unit (indic-text).
 *   - At most `maxLines` lines per caption block; the block closes and a new one
 *     starts when it is full.
 *   - Break on sentence-ending punctuation (. ! ? … and the Devanagari danda) so
 *     a block does not run past the end of a sentence.
 *   - Force a break when the silent gap between consecutive words exceeds
 *     `pauseGapSec` (the previous word ends, the next starts a fresh line/block).
 *
 * Active-word timing: each line keeps its constituent {@link Word}[] (with their
 * `{start,end}`), so a highlight/karaoke compositor can color the word whose
 * `[start,end]` contains the playhead.
 *
 * Re-sync: this regroups from the STORED transcript words and never re-runs STT.
 */
import type { Transcript, Word } from './stt'

/**
 * One timed caption line. `start` is the first word's start, `out` is the last
 * word's end (both seconds) — named `out` to mirror the clip's `out` field in
 * Doc 00 §4 so P4.7 can assign `clip.start`/`clip.out` directly. `words` are the
 * words in this line, in order, for active-word highlight.
 */
export interface CaptionLine {
  /** The line text: member words joined by a single space. */
  text: string
  /** Line start time = first word's `start`, in seconds. */
  start: number
  /** Line end time = last word's `end`, in seconds (matches clip `out`). */
  out: number
  /** The words composing this line, in order, with per-word `{start,end}`. */
  words: Word[]
}

/** Tunables for {@link groupWordsIntoLines}, surfaced in the Auto-Caption panel. */
export interface GroupingOptions {
  /** Max line length in GRAPHEME CLUSTERS (default 42). */
  maxCharsPerLine?: number
  /** Max lines per caption block; a new block opens when full (default 2). */
  maxLines?: number
  /** Silent gap (seconds) between words that forces a break (default 0.7). */
  pauseGapSec?: number
  /** Max words per caption line. Breaks BEFORE the word that would exceed this. Default: unlimited. */
  maxWordsPerLine?: number
}

/** Resolved options with all defaults applied (Doc 02 §2.3 / skill defaults). */
export interface ResolvedGroupingOptions {
  maxCharsPerLine: number
  maxLines: number
  pauseGapSec: number
}

/** Default grouping parameters — CapCut-like: ~42 chars, max 2 lines, 0.7s gap. */
export const DEFAULT_GROUPING_OPTIONS: ResolvedGroupingOptions = {
  maxCharsPerLine: 42,
  maxLines: 2,
  pauseGapSec: 0.7
}

/** Sentence-ending punctuation that closes a caption block. */
const SENTENCE_END = /[.!?…।॥]$/

/**
 * Reusable grapheme segmenter when the runtime provides `Intl.Segmenter` (Node
 * 16+/Electron). Counting in grapheme clusters keeps Tamil/Indic conjuncts and
 * combining marks as ONE unit so wrapping does not split a cluster.
 */
const graphemeSegmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

/**
 * Split `text` into its grapheme clusters (indic-text), in order. A Tamil/Indic
 * conjunct (base + combining vowel signs/viramas) stays a SINGLE element so a
 * typewriter/character reveal advances by one visible glyph cluster — never
 * splitting a cluster mid-way (which would render a dotted-circle artefact).
 * Falls back to `Array.from` (codepoints) only if `Intl.Segmenter` is absent.
 */
export function splitGraphemes(text: string): string[] {
  if (graphemeSegmenter) {
    const out: string[] = []
    for (const seg of graphemeSegmenter.segment(text)) out.push(seg.segment)
    return out
  }
  return Array.from(text)
}

/**
 * Count the length of `text` in grapheme clusters (indic-text). Falls back to
 * `Array.from` (codepoints) only if `Intl.Segmenter` is unavailable.
 */
export function graphemeLength(text: string): number {
  return splitGraphemes(text).length
}

/** Resolve partial options to a fully-defaulted set. Pure. */
function resolveOptions(opts?: GroupingOptions): ResolvedGroupingOptions & { maxWordsPerLine: number } {
  return {
    maxCharsPerLine: opts?.maxCharsPerLine ?? DEFAULT_GROUPING_OPTIONS.maxCharsPerLine,
    maxLines: opts?.maxLines ?? DEFAULT_GROUPING_OPTIONS.maxLines,
    pauseGapSec: opts?.pauseGapSec ?? DEFAULT_GROUPING_OPTIONS.pauseGapSec,
    maxWordsPerLine: opts?.maxWordsPerLine ?? Infinity
  }
}

/** Build a {@link CaptionLine} from a non-empty run of words. */
function makeLine(words: Word[]): CaptionLine {
  return {
    text: words.map((w) => w.text).join(' '),
    start: words[0].start,
    out: words[words.length - 1].end,
    words
  }
}

/**
 * Group word-level timestamps into timed caption lines (P4.6).
 *
 * Greedy, single-pass, deterministic:
 *   1. A new word starts a fresh line if it would push the line past
 *      `maxCharsPerLine` (grapheme count, including the joining space).
 *   2. A new word also forces a break if the gap from the previous word's `end`
 *      to this word's `start` exceeds `pauseGapSec`.
 *   3. After a word ending in sentence punctuation, the next word breaks.
 *   4. Lines accumulate into a block; once a block has `maxLines` lines it
 *      closes and the next line opens a new block. A pause gap or sentence end
 *      also closes the current block early.
 *
 * Empty input yields `[]`. A single word becomes one line. A word longer than
 * `maxCharsPerLine` still gets its own line (never dropped or split mid-word).
 */
export function groupWordsIntoLines(words: Word[], opts?: GroupingOptions): CaptionLine[] {
  const { maxCharsPerLine, maxLines, pauseGapSec, maxWordsPerLine } = resolveOptions(opts)
  if (words.length === 0) return []

  const lines: CaptionLine[] = []
  let current: Word[] = []
  let currentChars = 0
  // How many lines the OPEN block already holds (lines emitted since the last
  // hard break). Used to enforce `maxLines` per block.
  let linesInBlock = 0
  // Whether the next word must start a new BLOCK (pause/sentence), not just a line.
  let forceBlockBreak = false

  /** Flush the in-progress line into `lines`; bump the block line counter. */
  const flushLine = (): void => {
    if (current.length > 0) {
      lines.push(makeLine(current))
      linesInBlock++
      current = []
      currentChars = 0
    }
  }

  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    const prev = i > 0 ? words[i - 1] : null

    // Decide whether this word breaks the current line and/or block.
    const gapBreak = prev !== null && word.start - prev.end > pauseGapSec
    const blockBreak = forceBlockBreak || gapBreak
    forceBlockBreak = false

    const wordLen = graphemeLength(word.text)
    // +1 for the space when appending to a non-empty line.
    const projected = current.length === 0 ? wordLen : currentChars + 1 + wordLen
    const charBreak = current.length > 0 && projected > maxCharsPerLine
    const wordBreak = current.length > 0 && current.length >= maxWordsPerLine

    if (blockBreak) {
      // Close the line AND the block before placing this word.
      flushLine()
      linesInBlock = 0
    } else if (charBreak || wordBreak) {
      // Close just the line; if the block is now full, close the block too.
      flushLine()
      if (linesInBlock >= maxLines) linesInBlock = 0
    }

    current.push(word)
    currentChars = current.length === 1 ? wordLen : currentChars + 1 + wordLen

    // A sentence-ending word forces the FOLLOWING word into a new block.
    if (SENTENCE_END.test(word.text)) forceBlockBreak = true
  }

  flushLine()
  return lines
}

/**
 * Re-sync convenience: regroup straight from a stored {@link Transcript}'s words
 * (skill: "Re-sync" regroups from the stored transcript; never re-transcribes).
 */
export function resyncTranscript(
  transcript: Transcript,
  opts?: GroupingOptions
): CaptionLine[] {
  return groupWordsIntoLines(transcript.words, opts)
}

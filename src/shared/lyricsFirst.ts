import type { CaptionLine } from './captionSync'
import type { LanguageCode, Transcript, Word } from './stt'
import { asLanguageCode, DEFAULT_LANGUAGE } from './stt'
import { segmentClusters, splitSyllables } from './textShaping'
import type { VocalRegion } from './vocalActivity'
import { totalVocalDuration } from './vocalActivity'

/** One parsed lyrics line that should become a caption line after alignment. */
export interface ParsedLyricsLine {
  text: string
  section?: string
}

/** Parsed lyrics input with optional metadata tags. */
export interface ParsedLyrics {
  language?: LanguageCode
  lines: ParsedLyricsLine[]
}

/**
 * One timed akshara/syllable within an aligned word.
 * Times are proportional to syllable cluster count within the word span.
 * confidence is slightly below the parent word (derived, not directly measured).
 */
export interface AlignedSyllable {
  akshara: string
  start: number
  end: number
  confidence: number
}

/** Word-level alignment with confidence for review heatmaps. */
export interface AlignedWord extends Word {
  confidence: number
  /** Syllable/akshara timing — present when the word contains > 1 grapheme cluster. */
  syllables?: AlignedSyllable[]
}

/** One aligned lyrics line (line text + aligned words + confidence). */
export interface AlignedLyricsLine {
  index: number
  text: string
  start: number
  end: number
  confidence: number
  words: AlignedWord[]
}

/** Output of lyrics-first alignment. */
export interface LyricsAlignmentResult {
  language: LanguageCode
  lines: AlignedLyricsLine[]
}

const TAG_RE = /^\[\s*([a-zA-Z]+)\s*:\s*(.*?)\s*\]$/
const INLINE_COMMENT_RE = /\s+#.*$/
const WORD_SPLIT_RE = /\s+/u

/**
 * Parse a lyrics document supporting plain lines plus lightweight tags:
 * - [lang: ta]
 * - [section: chorus]
 * - [gap: instrumental]  (accepted and ignored for clip emit)
 */
export function parseLyricsInput(lyrics: string): ParsedLyrics {
  const out: ParsedLyrics = { lines: [] }
  let currentSection: string | undefined

  for (const raw of lyrics.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = raw.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue

    const tag = trimmed.match(TAG_RE)
    if (tag !== null) {
      const key = tag[1].toLowerCase()
      const value = tag[2].trim()
      if (key === 'lang') {
        const parsed = asLanguageCode(value)
        if (parsed !== null) out.language = parsed
      } else if (key === 'section') {
        currentSection = value.length > 0 ? value : undefined
      } else if (key === 'gap') {
        // Intentionally accepted and ignored for MVP emit.
      }
      continue
    }

    const content = raw.replace(INLINE_COMMENT_RE, '').trim()
    if (content.length === 0) continue
    out.lines.push({ text: content, ...(currentSection !== undefined ? { section: currentSection } : {}) })
  }

  return out
}

/** Flatten parsed lyrics lines into words while preserving line boundaries. */
function wordsPerLine(parsed: ParsedLyrics): string[][] {
  return parsed.lines.map((line) =>
    line.text
      .split(WORD_SPLIT_RE)
      .map((w) => w.trim())
      .filter((w) => w.length > 0)
  )
}

/**
 * Distribute a word's timing proportionally across its syllables.
 * Each syllable's fraction is its cluster count / total cluster count.
 * Confidence is the parent word's value discounted by 0.05 (derived timing).
 */
function splitWordIntoSyllables(word: string, start: number, end: number, wordConfidence: number): AlignedSyllable[] | undefined {
  const ranges = splitSyllables(word)
  if (ranges.length <= 1) return undefined
  const duration = Math.max(0, end - start)
  const totalClusters = ranges.reduce((sum, r) => sum + (r.end - r.start), 0)
  const confidence = Math.max(0, wordConfidence - 0.05)
  let cursor = start
  return ranges.map((r) => {
    const fraction = totalClusters > 0 ? (r.end - r.start) / totalClusters : 1 / ranges.length
    const syllableEnd = cursor + duration * fraction
    const syl: AlignedSyllable = { akshara: r.text, start: cursor, end: syllableEnd, confidence }
    cursor = syllableEnd
    return syl
  })
}

/** Normalize for loose matching while preserving original output text. */
function normalizeToken(token: string): string {
  return token
    .toLocaleLowerCase()
    .replace(/[.,!?…;:()[\]{}"'`]/g, '')
    .trim()
}

/** Total grapheme-cluster count for a word (safe for Indic conjuncts). */
function clusterLen(word: string): number {
  return segmentClusters(word).length
}

/**
 * Proportional alignment: uses the transcript ONLY to detect the vocal span
 * (start of first detected word → end of last detected word), then distributes
 * lyric lines within that span proportionally by grapheme-cluster count.
 *
 * This is the correct strategy for sung audio (songs, bhajans, etc.) where the
 * STT recognizer produces wrong words but plausible timestamps — the word-by-word
 * monotonic matching breaks completely when transcript and lyric word counts
 * diverge (e.g. 3 detected segments for a 40-word Tamil song). Proportional
 * distribution gives sensible, evenly-spread timing that users can correct with
 * Tap-Sync rather than facing captions crammed into the first few seconds.
 *
 * Confidence: 0.65 when the span is STT-bounded (real timestamps), 0.4 when
 * purely synthetic (no transcript, no audioDurationSec).
 */
function alignProportionally(
  parsed: ParsedLyrics,
  lineWords: string[][],
  language: LanguageCode,
  transcriptWords: readonly Word[],
  audioDurationSec?: number
): LyricsAlignmentResult {
  // Vocal span: transcript bounds take priority; fall back to full audio duration.
  const vocalStart = transcriptWords.length > 0 ? transcriptWords[0].start : 0
  const vocalEnd =
    transcriptWords.length > 0
      ? transcriptWords[transcriptWords.length - 1].end
      : (audioDurationSec ?? 0)
  const totalDuration = Math.max(0, vocalEnd - vocalStart)

  // Base confidence reflects how well-anchored the timing is.
  const baseConf = transcriptWords.length > 0 ? 0.65 : audioDurationSec !== undefined && audioDurationSec > 0 ? 0.45 : 0.4

  // Total cluster count across all non-empty lines (proportional denominator).
  const allClusters = lineWords.reduce(
    (s, ws) => s + ws.reduce((sc, w) => sc + clusterLen(w), 0),
    0
  )

  const alignedLines: AlignedLyricsLine[] = []
  const lineCount = parsed.lines.filter((_, i) => lineWords[i].length > 0).length
  let cursor = vocalStart

  for (let lineIndex = 0; lineIndex < parsed.lines.length; lineIndex++) {
    const words = lineWords[lineIndex]
    if (words.length === 0) continue

    const lineClusters = words.reduce((s, w) => s + clusterLen(w), 0)
    const lineDuration =
      allClusters > 0
        ? totalDuration * (lineClusters / allClusters)
        : lineCount > 0
          ? totalDuration / lineCount
          : 0.24
    const lineStart = cursor
    const lineEnd = lineStart + lineDuration
    cursor = lineEnd

    const alignedWords: AlignedWord[] = []
    let wordCursor = lineStart

    for (const lyricWord of words) {
      const wordClusters = clusterLen(lyricWord)
      const wordDuration =
        lineClusters > 0
          ? lineDuration * (wordClusters / lineClusters)
          : words.length > 0
            ? lineDuration / words.length
            : 0.24
      const wordStart = wordCursor
      const wordEnd = wordStart + wordDuration
      wordCursor = wordEnd

      alignedWords.push({
        text: lyricWord,
        start: wordStart,
        end: wordEnd,
        confidence: baseConf,
        syllables: splitWordIntoSyllables(lyricWord, wordStart, wordEnd, baseConf) ?? undefined
      })
    }

    alignedLines.push({
      index: lineIndex,
      text: parsed.lines[lineIndex].text,
      start: lineStart,
      end: lineEnd,
      confidence: baseConf,
      words: alignedWords
    })
  }

  return { language, lines: alignedLines }
}

/**
 * Map a position on the concatenated "voiced timeline" (`x` seconds into the sum
 * of region durations) back to a real audio time, returning the containing region
 * index. Clamps `x` to `[0, totalVoiced]`; `x` at/after the end maps to the last
 * region's end.
 */
function voicedToReal(
  x: number,
  regions: readonly VocalRegion[]
): { t: number; regionIndex: number } {
  let remaining = Math.max(0, x)
  for (let i = 0; i < regions.length; i++) {
    const dur = Math.max(0, regions[i].end - regions[i].start)
    if (remaining <= dur || i === regions.length - 1) {
      return { t: regions[i].start + Math.min(remaining, dur), regionIndex: i }
    }
    remaining -= dur
  }
  // Empty regions guarded by callers; keep TS happy.
  return { t: 0, regionIndex: 0 }
}

/**
 * Place word start times inside a line span `[lineStart, lineEnd]`. Words are
 * first laid out by grapheme-cluster proportion, then each word start (after the
 * first, which pins to `lineStart`) is snapped to the nearest energy ONSET inside
 * the span — but only when that onset is closer than half the word's proportional
 * duration, so snapping tightens timing without teleporting words. Returns the
 * word starts plus a per-word flag of whether it was onset-anchored (→ higher
 * confidence).
 */
function placeWordsWithOnsets(
  words: string[],
  lineStart: number,
  lineEnd: number,
  onsets: readonly number[]
): { starts: number[]; snapped: boolean[] } {
  const w = words.length
  const span = Math.max(0, lineEnd - lineStart)
  const clusters = words.map((word) => Math.max(1, clusterLen(word)))
  const totalClusters = clusters.reduce((s, c) => s + c, 0)

  // Proportional boundaries: boundary[k] is the start of word k.
  const boundaries: number[] = new Array(w)
  let cursor = lineStart
  for (let k = 0; k < w; k++) {
    boundaries[k] = cursor
    cursor += totalClusters > 0 ? span * (clusters[k] / totalClusters) : span / w
  }

  const onsetsInSpan = onsets.filter((o) => o > lineStart && o < lineEnd).sort((a, b) => a - b)

  const starts: number[] = new Array(w)
  const snapped: boolean[] = new Array(w).fill(false)
  starts[0] = lineStart
  let onsetPtr = 0
  for (let k = 1; k < w; k++) {
    const target = boundaries[k]
    const wordDur = (k < w ? boundaries[k] : lineEnd) - boundaries[k - 1]
    const window = Math.max(0.02, wordDur / 2)
    // Advance past any onset at/behind the previous word start (monotonic).
    while (onsetPtr < onsetsInSpan.length && onsetsInSpan[onsetPtr] <= starts[k - 1]) onsetPtr++
    // Nearest onset to the proportional target (onsets are sorted ascending).
    let bestJ = -1
    let bestDist = Infinity
    for (let j = onsetPtr; j < onsetsInSpan.length; j++) {
      const d = Math.abs(onsetsInSpan[j] - target)
      if (d < bestDist) {
        bestDist = d
        bestJ = j
      } else {
        break // distance grows once we pass the target
      }
    }
    if (bestJ >= 0 && bestDist <= window && onsetsInSpan[bestJ] > starts[k - 1]) {
      starts[k] = onsetsInSpan[bestJ]
      snapped[k] = true
      onsetPtr = bestJ + 1
    } else {
      starts[k] = Math.max(target, starts[k - 1] + 0.001)
    }
  }
  return { starts, snapped }
}

const SEG_CONF_ONSET = 0.72
const SEG_CONF_INTERP = 0.6
const SEG_CONF_SNAPPED_START = 0.03 // bonus when a line start pins to a real region onset
const SEG_MIN_LINE_DUR = 0.2

/**
 * Segmented (VAD phrase-sync) alignment — the recommended strategy for songs.
 *
 * Each lyric line is BUCKETED into the vocal region its proportional position
 * (cumulative grapheme-cluster count) falls into, then the lines sharing a region
 * SUBDIVIDE that region's span in order (proportional to cluster count). This
 * guarantees the sync-critical properties structurally:
 *   • every line sits fully inside a detected sung phrase — never in silence or
 *     an instrumental gap;
 *   • the first line of each region begins on a real vocal onset (region start);
 *   • legato couplets that share one continuous phrase are split within it;
 *   • lines stay monotonic and non-overlapping.
 *
 * Within each line, word starts snap to energy onsets. Lyrics text is ground
 * truth; only timing is computed. (Section-level drift — a whole verse landing
 * early/late because the model is content-blind — is corrected by Tap-Sync
 * anchors or an acoustic CTC engine, not here.)
 */
function alignBySegments(
  parsed: ParsedLyrics,
  lineWords: string[][],
  language: LanguageCode,
  regions: readonly VocalRegion[],
  onsets: readonly number[]
): LyricsAlignmentResult {
  const voiced = totalVocalDuration(regions)
  const lineClusterCounts = lineWords.map((ws) => ws.reduce((s, word) => s + Math.max(1, clusterLen(word)), 0))
  const allClusters = lineClusterCounts.reduce((s, c) => s + c, 0)

  // Bucket each non-empty line into the region its proportional MIDPOINT lands in.
  // Items are processed in reading order and proportional midpoints increase, so
  // each bucket's region index is non-decreasing (buckets fill left→right).
  interface Item { lineIndex: number; words: string[] }
  const buckets: Item[][] = regions.map(() => [])
  let clustersBefore = 0
  for (let lineIndex = 0; lineIndex < parsed.lines.length; lineIndex++) {
    const words = lineWords[lineIndex]
    if (words.length === 0) continue
    const lineClusters = lineClusterCounts[lineIndex]
    const vMid = allClusters > 0 ? ((clustersBefore + lineClusters / 2) / allClusters) * voiced : voiced / 2
    clustersBefore += lineClusters
    const { regionIndex } = voicedToReal(vMid, regions)
    buckets[regionIndex].push({ lineIndex, words })
  }

  // Subdivide each region's span among its bucketed lines, in order.
  const alignedLines: AlignedLyricsLine[] = []
  for (let r = 0; r < regions.length; r++) {
    const group = buckets[r]
    if (group.length === 0) continue
    const region = regions[r]
    const span = Math.max(0, region.end - region.start)
    const groupClusters = group.reduce((s, it) => s + lineClusterCounts[it.lineIndex], 0)

    let cursor = region.start
    for (let gi = 0; gi < group.length; gi++) {
      const it = group[gi]
      const frac = groupClusters > 0 ? lineClusterCounts[it.lineIndex] / groupClusters : 1 / group.length
      const lineStart = cursor
      const lineEnd = gi === group.length - 1 ? region.end : Math.min(region.end, cursor + span * frac)
      cursor = lineEnd
      const safeLineEnd = Math.max(lineEnd, lineStart + Math.min(SEG_MIN_LINE_DUR, region.end - lineStart, 0.001 + span))

      const { starts: wStarts, snapped } = placeWordsWithOnsets(it.words, lineStart, safeLineEnd, onsets)
      // The first line of a region begins exactly on the region's onset.
      const startBonus = gi === 0 ? SEG_CONF_SNAPPED_START : 0

      const alignedWords: AlignedWord[] = it.words.map((word, k) => {
        const wordStart = wStarts[k]
        const wordEnd = k + 1 < it.words.length ? wStarts[k + 1] : safeLineEnd
        const wEnd = Math.max(wordEnd, wordStart + 0.001)
        const conf = Math.min(0.9, (snapped[k] ? SEG_CONF_ONSET : SEG_CONF_INTERP) + startBonus)
        return {
          text: word,
          start: wordStart,
          end: wEnd,
          confidence: conf,
          syllables: splitWordIntoSyllables(word, wordStart, wEnd, conf) ?? undefined
        }
      })

      const avgConfidence = alignedWords.reduce((s, x) => s + x.confidence, 0) / alignedWords.length
      alignedLines.push({
        index: it.lineIndex,
        text: parsed.lines[it.lineIndex].text,
        start: lineStart,
        end: Math.max(safeLineEnd, lineStart + 0.001),
        confidence: Number(avgConfidence.toFixed(4)),
        words: alignedWords
      })
    }
  }

  // Emit in lyric reading order (buckets already fill left→right, but be safe).
  alignedLines.sort((a, b) => a.index - b.index)
  return { language, lines: alignedLines }
}

/**
 * Align known lyrics to transcript timing in reading order.
 *
 * Lyrics text is SOURCE OF TRUTH — words are never invented or changed.
 * Only timing is computed from the transcript or synthetic defaults.
 *
 * Two strategies are available via the `strategy` option:
 *
 * **`'monotonic'` (default — good for speech/podcasts with accurate STT)**
 * Borrows timing word-by-word from the transcript in reading order.
 * Works well when STT word count ≈ lyric word count and words are recognizable.
 * Breaks for songs where the recognizer produces wrong/fewer words.
 *
 * **`'proportional'` (songs / Indic music, no acoustic evidence)**
 * Uses the transcript ONLY to detect the vocal span (first word start → last
 * word end), then distributes lines proportionally by grapheme-cluster count.
 * Robust to word-count mismatches and wrong STT words — the result covers the
 * whole vocal span evenly and is easy to correct with Tap-Sync anchors.
 *
 * **`'segmented'` (recommended for songs — VAD phrase-sync)**
 * Distributes lines across DETECTED vocal regions (`vocalRegions`) by cluster
 * count so captions land on actual sung phrases and skip instrumental gaps, and
 * snaps word starts to energy `onsets`. Requires `vocalRegions`; falls back to
 * `'proportional'` when none are supplied/detected.
 */
export function alignLyricsToTranscript(args: {
  lyrics: string
  transcript: Transcript
  language?: LanguageCode
  /**
   * Total audio duration in seconds. For `'monotonic'`: used to spread
   * synthetic trailing timings when the transcript runs out. For
   * `'proportional'`: used as the span bound when no transcript words exist.
   */
  audioDurationSec?: number
  /**
   * Detected vocal regions (sung phrases) for `'segmented'` alignment. When
   * present and non-empty, `'segmented'` snaps lines onto these regions.
   */
  vocalRegions?: readonly VocalRegion[]
  /** Energy onset times (seconds) used by `'segmented'` to snap word starts. */
  onsets?: readonly number[]
  /**
   * Alignment strategy:
   *
   * - `'monotonic'` (default) — word-by-word borrowing from transcript in order.
   *   Preserves prior behaviour; good when STT word count ≈ lyric word count.
   *
   * - `'proportional'` — always use the vocal-span + cluster-count distribution
   *   regardless of word count. Use for songs when you know STT is unreliable.
   *
   * - `'segmented'` — VAD phrase-sync using `vocalRegions` + `onsets`. Falls back
   *   to `'proportional'` when no regions are supplied.
   *
   * - `'auto'` — chooses: proportional when the lyric word count is more than
   *   3× the transcript word count (transcript is too sparse to drive per-word
   *   timing), monotonic otherwise. Recommended for the lyrics-first IPC path.
   */
  strategy?: 'monotonic' | 'proportional' | 'segmented' | 'auto'
}): LyricsAlignmentResult {
  const parsed = parseLyricsInput(args.lyrics)
  const lineWords = wordsPerLine(parsed)
  const language = args.language ?? parsed.language ?? args.transcript.language ?? DEFAULT_LANGUAGE
  const transcriptWords = args.transcript.words

  // Segmented (VAD phrase-sync): use detected vocal regions when available,
  // otherwise degrade to the proportional spread.
  if (args.strategy === 'segmented') {
    if (args.vocalRegions !== undefined && args.vocalRegions.length > 0) {
      return alignBySegments(parsed, lineWords, language, args.vocalRegions, args.onsets ?? [])
    }
    return alignProportionally(parsed, lineWords, language, transcriptWords, args.audioDurationSec)
  }

  const resolvedStrategy = (() => {
    if (args.strategy === 'proportional') return 'proportional'
    if (args.strategy === 'auto') {
      const lyricWordCount = lineWords.reduce((s, ws) => s + ws.length, 0)
      const transcriptWordCount = transcriptWords.length
      // Sparse transcript: proportional spread prevents words piling up.
      if (transcriptWordCount === 0 || lyricWordCount / transcriptWordCount > 3) {
        return 'proportional'
      }
      return 'monotonic'
    }
    return 'monotonic'
  })()

  if (resolvedStrategy === 'proportional') {
    return alignProportionally(parsed, lineWords, language, transcriptWords, args.audioDurationSec)
  }

  // --- Monotonic strategy (original, backward-compatible) ---
  const defaultDur = 0.24
  const totalWords = lineWords.reduce((sum, words) => sum + words.length, 0)
  const syntheticDur =
    args.audioDurationSec !== undefined && args.audioDurationSec > 0 && totalWords > 0
      ? Math.max(0.08, args.audioDurationSec / totalWords)
      : defaultDur
  let transcriptIndex = 0
  let syntheticCursor = transcriptWords.length > 0 ? transcriptWords[0].start : 0

  const alignedLines: AlignedLyricsLine[] = []

  for (let lineIndex = 0; lineIndex < parsed.lines.length; lineIndex++) {
    const words = lineWords[lineIndex]
    if (words.length === 0) continue

    const alignedWords: AlignedWord[] = []

    for (const lyricWord of words) {
      const timing = transcriptWords[transcriptIndex]
      if (timing !== undefined) {
        transcriptIndex += 1
        syntheticCursor = timing.end
        const match = normalizeToken(lyricWord) === normalizeToken(timing.text)
        const conf = match ? 0.95 : 0.7
        const wordStart = timing.start
        const wordEnd = Math.max(timing.end, timing.start + 0.001)
        alignedWords.push({
          text: lyricWord,
          start: wordStart,
          end: wordEnd,
          confidence: conf,
          syllables: splitWordIntoSyllables(lyricWord, wordStart, wordEnd, conf) ?? undefined
        })
        continue
      }

      const start = syntheticCursor
      const end = start + syntheticDur
      syntheticCursor = end
      alignedWords.push({
        text: lyricWord,
        start,
        end,
        confidence: 0.4,
        syllables: splitWordIntoSyllables(lyricWord, start, end, 0.4) ?? undefined
      })
    }

    const lineStart = alignedWords[0].start
    const lineEnd = alignedWords[alignedWords.length - 1].end
    const avgConfidence = alignedWords.reduce((sum, w) => sum + w.confidence, 0) / alignedWords.length

    alignedLines.push({
      index: lineIndex,
      text: parsed.lines[lineIndex].text,
      start: lineStart,
      end: lineEnd,
      confidence: Number(avgConfidence.toFixed(4)),
      words: alignedWords
    })
  }

  return { language, lines: alignedLines }
}

/** One CTC-aligned word's timing + acoustic score (0–1); null = unalignable. */
export interface ForcedWordTiming {
  start: number
  end: number
  score: number
}

/** Max seconds a single caption line stays on screen (caps held-note over-extension). */
const FA_MAX_LINE_DUR = 7

/**
 * The exact flat word sequence the forced-alignment sidecar must be given, in
 * lyric reading order. Shared by the caller (to build the request) and
 * {@link alignedFromForcedWords} (to consume the response) so the two never
 * diverge.
 */
export function lyricWordSequence(lyrics: string): string[] {
  return wordsPerLine(parseLyricsInput(lyrics)).flat()
}

/**
 * Map flat CTC word timings (from the forced-alignment sidecar, one entry per
 * {@link lyricWordSequence} word, in order) into timed caption lines.
 *
 * - Unalignable words (`null`) are interpolated between their aligned neighbours.
 * - Word ends are clamped to the next word's start so a held note / blank stretch
 *   doesn't swallow the following word.
 * - Line ends are capped to the next line's start and to {@link FA_MAX_LINE_DUR}
 *   so a caption never lingers across a long instrumental tail.
 * - Confidence is derived from the acoustic score (low score → flagged for review
 *   in the heatmap) but timing is kept regardless, since forced-alignment timing
 *   is reliable even where the posterior is low (sustained/sung vowels).
 *
 * Lyrics text stays ground truth; only timing is computed.
 */
export function alignedFromForcedWords(args: {
  lyrics: string
  language?: LanguageCode
  timings: readonly (ForcedWordTiming | null)[]
}): LyricsAlignmentResult {
  const parsed = parseLyricsInput(args.lyrics)
  const lineWords = wordsPerLine(parsed)
  const language = args.language ?? parsed.language ?? DEFAULT_LANGUAGE
  const flat = lineWords.flat()
  const n = flat.length

  // Resolve a start/end for every word: keep known ones, interpolate the rest.
  const start: number[] = new Array(n).fill(0)
  const end: number[] = new Array(n).fill(0)
  const known: boolean[] = new Array(n).fill(false)
  const score: number[] = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    const t = args.timings[i]
    if (t != null && Number.isFinite(t.start) && Number.isFinite(t.end) && t.end >= t.start) {
      start[i] = t.start
      end[i] = t.end
      score[i] = Number.isFinite(t.score) ? Math.max(0, Math.min(1, t.score)) : 0
      known[i] = true
    }
  }
  const firstKnown = known.indexOf(true)
  if (firstKnown === -1) {
    // Nothing aligned — let the caller fall back rather than emit zeros.
    return { language, lines: [] }
  }
  // Interpolate null runs using the nearest known neighbours on each side.
  for (let i = 0; i < n; i++) {
    if (known[i]) continue
    let p = i - 1
    while (p >= 0 && !known[p]) p--
    let q = i + 1
    while (q < n && !known[q]) q--
    if (p >= 0 && q < n && known[q]) {
      const frac = (i - p) / (q - p)
      const t = end[p] + (start[q] - end[p]) * frac
      start[i] = t
      end[i] = t
    } else if (p >= 0) {
      start[i] = end[i] = end[p]
    } else if (q < n) {
      start[i] = end[i] = start[q]
    }
  }

  // Enforce monotonic starts, then clamp each word's end to the next word's start.
  for (let i = 1; i < n; i++) if (start[i] < start[i - 1]) start[i] = start[i - 1]
  for (let i = 0; i < n; i++) {
    const nextStart = i + 1 < n ? start[i + 1] : Infinity
    end[i] = Math.max(start[i] + 0.02, Math.min(end[i], nextStart))
  }

  // Group into lines and cap line durations.
  const alignedLines: AlignedLyricsLine[] = []
  let w = 0
  const lineStartFlatIndex: number[] = []
  for (let li = 0; li < parsed.lines.length; li++) {
    if (lineWords[li].length === 0) continue
    lineStartFlatIndex.push(w)
    w += lineWords[li].length
  }
  w = 0
  let emitted = 0
  for (let li = 0; li < parsed.lines.length; li++) {
    const words = lineWords[li]
    if (words.length === 0) continue
    const base = w
    w += words.length
    const nextLineStart =
      emitted + 1 < lineStartFlatIndex.length ? start[lineStartFlatIndex[emitted + 1]] : Infinity
    emitted++

    const lineStart = start[base]
    const rawLineEnd = end[base + words.length - 1]
    const lineEnd = Math.max(
      lineStart + 0.05,
      Math.min(rawLineEnd, nextLineStart, lineStart + FA_MAX_LINE_DUR)
    )

    const alignedWords: AlignedWord[] = words.map((word, k) => {
      const idx = base + k
      const wStart = start[idx]
      // Clamp within the (possibly capped) line span.
      const wEnd = Math.max(wStart + 0.02, Math.min(end[idx], lineEnd))
      const conf = known[idx] ? Math.max(0.4, Math.min(0.98, 0.45 + 0.5 * score[idx])) : 0.4
      return {
        text: word,
        start: wStart,
        end: wEnd,
        confidence: conf,
        syllables: splitWordIntoSyllables(word, wStart, wEnd, conf) ?? undefined
      }
    })

    const avg = alignedWords.reduce((s, x) => s + x.confidence, 0) / alignedWords.length
    alignedLines.push({
      index: li,
      text: parsed.lines[li].text,
      start: lineStart,
      end: lineEnd,
      confidence: Number(avg.toFixed(4)),
      words: alignedWords
    })
  }

  return { language, lines: alignedLines }
}

/** Convert aligned lyrics lines into caption lines for track generation. */
export function alignedLyricsToCaptionLines(lines: readonly AlignedLyricsLine[]): CaptionLine[] {
  return lines.map((line) => ({
    text: line.text,
    start: line.start,
    out: line.end,
    words: line.words.map((w) => ({
      text: w.text,
      start: w.start,
      end: w.end,
      confidence: w.confidence,
      ...(w.syllables !== undefined ? { syllables: w.syllables } : {})
    }))
  }))
}

/**
 * Split any AlignedLyricsLine whose word count exceeds `maxWordsPerLine` into
 * two or more sub-lines. Each sub-line gets a proportional time slice of the
 * parent line's span. Words stay in reading order; timing is preserved.
 * No-op when maxWordsPerLine <= 0 or Infinity.
 */
export function splitAlignedLinesByWordCount(
  lines: readonly AlignedLyricsLine[],
  maxWordsPerLine: number
): AlignedLyricsLine[] {
  if (!Number.isFinite(maxWordsPerLine) || maxWordsPerLine <= 0) return [...lines]
  const result: AlignedLyricsLine[] = []
  for (const line of lines) {
    const words = line.words
    if (words.length <= maxWordsPerLine) {
      result.push(line)
      continue
    }
    for (let i = 0; i < words.length; i += maxWordsPerLine) {
      const chunk = words.slice(i, i + maxWordsPerLine)
      const chunkStart = chunk[0].start
      const chunkEnd = chunk[chunk.length - 1].end
      result.push({
        index: line.index,
        text: chunk.map((w) => w.text).join(' '),
        start: chunkStart,
        end: chunkEnd,
        confidence: line.confidence,
        words: chunk
      })
    }
  }
  return result
}

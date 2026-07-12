/**
 * Sound-effect CUE detection / marking (P5.7 — Doc 03 caption styles; skills
 * `caption-sync` + `text-render`).
 *
 * A "cue" is a NON-spoken bracketed annotation that appears in a transcript or
 * caption line to describe audio rather than transcribe speech — e.g.
 * `[applause]`, `[music]`, `(laughs)`, `(crowd cheering)`. Whisper and most STT
 * engines emit these inline. For caption STYLING they must:
 *   1. render in a distinct CUE style (italic / dimmed / bracketed), visibly
 *      different from spoken words; and
 *   2. be EXCLUDED from active-word highlight and word-by-word / typewriter
 *      reveal — a cue is not "spoken", so the karaoke playhead must never select
 *      it and the typewriter must not reveal it one cluster at a time.
 *
 * This module is PURE + headless-safe (NO DOM / electron / node / Date): it only
 * inspects + transforms `{text,start,end,kind}` word records and plain strings,
 * so it is fully unit-testable and reused by both preview (renderer) and export.
 * It does NOT decide HOW a cue is drawn — that is `cueDrawStyle` plus the canvas
 * draw path — it only DETECTS + MARKS which tokens are cues (`kind: 'cue'`).
 *
 * CUE MODEL
 * ---------
 * A cue is flagged on the existing per-word surface via the optional
 * `CaptionWord.kind` discriminator (see project-schema): `kind: 'cue'` marks a
 * cue; absent / `'spoken'` is an ordinary spoken word. Keeping cues IN the same
 * `caption.words` array (rather than a parallel list) means a single index-aligned
 * pass drives highlight, reveal AND rendering, and the line text stays a faithful
 * in-order transcript including the cue.
 *
 * BRACKET FORMS WE ACCEPT
 * -----------------------
 * A token is a cue when its trimmed text is ENTIRELY one bracketed group:
 *   - square brackets `[...]`   e.g. `[applause]`, `[music]`, `[தாளம்]`
 *   - parentheses     `(...)`   e.g. `(laughs)`, `(crowd cheering)`
 *   - asterisks       `*...*`   e.g. `*sighs*` (common in informal captions)
 * with non-empty inner content. Only WHOLE-token brackets count: a spoken word
 * that merely contains a parenthetical (e.g. `well(ish)`) is NOT treated as a
 * cue. The match is anchored + trimmed so surrounding whitespace is ignored.
 */
import type { CaptionWord } from '../../../shared/project-schema'

/**
 * The distinct CUE STYLE (P5.7 requirement 2): how a cue token is drawn vs a
 * spoken word. Pure data — the canvas (and export) APPLY these (italic font,
 * dimmed/tinted fill). Keeping it here, not in the draw code, means preview and
 * export render cues identically. The default is an italic, dimmed white tint —
 * visibly "an annotation, not speech".
 */
export interface CueDrawStyle {
  /** Render the cue text in italic (the canonical "annotation" look). */
  italic: boolean
  /** Fill color for the cue (dimmed/tinted vs the base spoken fill). */
  color: string
  /** Multiply the cue's drawn alpha by this (further dimming). */
  opacity: number
}

/** The default cue look: italic, soft grey, slightly transparent. */
export const DEFAULT_CUE_DRAW_STYLE: CueDrawStyle = {
  italic: true,
  color: '#c9c9c9',
  opacity: 0.85
}

/**
 * The cue draw style to use for a word: {@link DEFAULT_CUE_DRAW_STYLE} for a cue,
 * `null` for a spoken word (the caller keeps the base style). Pure.
 */
export function cueDrawStyle(word: Pick<CaptionWord, 'text' | 'kind'>): CueDrawStyle | null {
  return isCueWord(word) ? DEFAULT_CUE_DRAW_STYLE : null
}

/**
 * Anchored bracket forms accepted as a cue. Each requires a non-empty inner body
 * (`.+`, non-greedy) wrapped in matching delimiters, with optional surrounding
 * whitespace. The whole token must match (`^...$`) so a parenthetical glued onto
 * a spoken word is not mistaken for a cue.
 */
const CUE_PATTERNS: readonly RegExp[] = [
  /^\s*\[.+?\]\s*$/u, // [applause]
  /^\s*\(.+?\)\s*$/u, // (laughs)
  /^\s*\*.+?\*\s*$/u // *sighs*
]

/**
 * Whether a single token's text is a bracketed sound-effect cue (whole-token,
 * one of {@link CUE_PATTERNS}). Empty / whitespace-only → not a cue. PURE.
 */
export function isCueText(text: string): boolean {
  if (text.trim().length === 0) return false
  return CUE_PATTERNS.some((re) => re.test(text))
}

/** Whether a {@link CaptionWord} is a cue — by its `kind` flag OR its text shape. */
export function isCueWord(word: Pick<CaptionWord, 'text' | 'kind'>): boolean {
  return word.kind === 'cue' || isCueText(word.text)
}

/** Whether a word is a SPOKEN word (participates in highlight + reveal) — i.e. not a cue. */
export function isSpokenWord(word: Pick<CaptionWord, 'text' | 'kind'>): boolean {
  return !isCueWord(word)
}

/**
 * Return a COPY of `words` with every token whose text is a bracketed cue flagged
 * `kind: 'cue'`, so downstream highlight/reveal/render can branch on a single
 * explicit field rather than re-parsing text. SPOKEN words are left WITHOUT a
 * `kind` (the implicit/default state — see {@link CaptionWord.kind}) so the
 * persisted timing stays minimal and byte-for-byte stable. Pure + immutable: the
 * input array and its members are never mutated.
 *
 * Use this once at ingest (e.g. when building caption clips from a transcript) so
 * the cue flag is persisted on `clip.caption.words` and the evaluators stay simple.
 */
export function markCueWords<T extends CaptionWord>(words: readonly T[]): T[] {
  return words.map((w) => (isCueWord(w) ? { ...w, kind: 'cue' as const } : w))
}

/** Options for {@link insertCue} — a MANUALLY added cue at a chosen time/position. */
export interface InsertCueOptions {
  /** The existing words to insert into (not mutated). */
  words: readonly CaptionWord[]
  /** The cue body, with or without brackets — `applause` and `[applause]` both work. */
  label: string
  /** Cue start time, seconds (same reference as the other words). */
  start: number
  /** Cue end time, seconds. Defaults to `start` (a zero-length marker) when omitted. */
  end?: number
  /**
   * Bracket form to wrap a bare label in when `label` is not already bracketed.
   * `'square'` → `[label]` (default), `'paren'` → `(label)`, `'asterisk'` → `*label*`.
   */
  bracket?: 'square' | 'paren' | 'asterisk'
}

/** Wrap a bare label in the requested bracket form; leave already-bracketed text as-is. */
export function bracketCueLabel(label: string, bracket: InsertCueOptions['bracket'] = 'square'): string {
  const trimmed = label.trim()
  if (isCueText(trimmed)) return trimmed
  switch (bracket) {
    case 'paren':
      return `(${trimmed})`
    case 'asterisk':
      return `*${trimmed}*`
    case 'square':
    default:
      return `[${trimmed}]`
  }
}

/**
 * Insert a manually-authored cue into a word list at the right time-ordered
 * position, returning a NEW array (input untouched). The cue is wrapped in the
 * chosen bracket form (if not already bracketed) and flagged `kind: 'cue'`, so it
 * renders in the cue style and is excluded from highlight/reveal. The cue is spliced
 * in BEFORE the first word whose `start` is greater than the cue's `start` (a stable
 * insert that keeps the array sorted by start when the input is sorted). Pure.
 */
export function insertCue(options: InsertCueOptions): CaptionWord[] {
  const { words, label, start } = options
  const end = options.end ?? start
  const cue: CaptionWord = {
    text: bracketCueLabel(label, options.bracket),
    start,
    end,
    kind: 'cue'
  }
  const out = [...words]
  let at = out.length
  for (let i = 0; i < out.length; i++) {
    if (out[i].start > start) {
      at = i
      break
    }
  }
  out.splice(at, 0, cue)
  return out
}

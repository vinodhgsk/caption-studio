/**
 * Pure builder for a TEXT clip (P3.14 — Doc 01 owns "multi-line text with
 * manual breaks").
 *
 * Headless-safe: NO DOM / electron / node / crypto / Date here. The clip `id`
 * and timeline `start` are supplied by the caller (the renderer action mints
 * the id via crypto.randomUUID), keeping this fully deterministic + testable.
 *
 * TEXT-CLIP MODEL / mediaRef SENTINEL
 * -----------------------------------
 * A text clip is a normal `Clip` that lives on a `text`-type track and carries
 * its content in `clip.text.lines` (one string per manual line). The schema
 * REQUIRES `mediaRef: string`, but a text clip references no file — so we use
 * the empty string `''` as an explicit "no media" sentinel. The compositor only
 * ever resolves `mediaRef` to an `app-media://` URL for clips on VISUAL tracks
 * (`track.type === 'video'`); text clips are drawn by a separate text path that
 * never touches `mediaRef`, so the sentinel is never loaded as a file.
 */
import type { Clip, ClipText } from '../../../shared/project-schema'
import { defaultTransform } from '../../../shared/project-schema'
import { DEFAULT_FONT_FAMILY, defaultFallbackChain } from '../../../shared/fontRegistry'

/** The "no media" sentinel for a text clip's required `mediaRef` field. */
export const TEXT_CLIP_MEDIA_REF = ''

/** Default on-timeline duration (seconds) for a freshly-added text clip. */
export const DEFAULT_TEXT_DURATION_SEC = 3

/**
 * The default typography a new text clip carries (P6.17 — Indic-first). The
 * GLOBAL default family is the registry's Tamil-capable {@link DEFAULT_FONT_FAMILY}
 * and the per-script `fallback` is the registry's Indic-first chain
 * ({@link defaultFallbackChain}), so a freshly-added text clip can render Tamil
 * (and falls back per script ending in Latin + generic) WITHOUT the user picking a
 * font first. Resolved from the registry — the single source of truth — so it
 * cannot drift from the font library default.
 */
export function defaultTextFont(): NonNullable<ClipText['font']> {
  return {
    family: DEFAULT_FONT_FAMILY,
    fallback: defaultFallbackChain()
  }
}

/** The default content a new text clip starts with (Indic-first default font). */
function defaultText(): ClipText {
  return { lines: ['Text'], align: 'center', font: defaultTextFont() }
}

/** Inputs the caller computes outside the pure builder. */
export interface BuildTextClipOptions {
  /** Caller-generated id (crypto.randomUUID in the renderer action). */
  id: string
  /** Timeline start (seconds) — typically the current playhead (or 0). */
  start: number
  /** Override the default out (seconds); defaults to DEFAULT_TEXT_DURATION_SEC. */
  durationSec?: number
  /** Override the default text content (lines/align). */
  text?: ClipText
}

/**
 * Build a text Clip: `mediaRef=''` (sentinel), `in=0`,
 * `out=durationSec`, neutral `transform`, and a `text` surface holding the
 * manual lines + alignment. The caller adds it to a `text`-type track via
 * `addClipCommand` so the add is one undoable step.
 */
export function buildTextClip(options: BuildTextClipOptions): Clip {
  const duration = options.durationSec ?? DEFAULT_TEXT_DURATION_SEC
  return {
    id: options.id,
    mediaRef: TEXT_CLIP_MEDIA_REF,
    in: 0,
    out: duration,
    start: options.start,
    transform: defaultTransform(),
    text: options.text ?? defaultText()
  }
}

/**
 * MANUAL-BREAK MODEL (P3.14)
 * --------------------------
 * The canvas inline editor edits text as ONE `<textarea>` string; the persisted
 * model is `clip.text.lines` — one entry per MANUAL line break. These two pure
 * helpers are the single canonical mapping between the two, used by BOTH the
 * commit path (textarea value → `lines`) and the seed path (`lines` → textarea
 * value), so what the user types, what is stored, and what the compositor draws
 * stay in lock-step (preview/export parity).
 *
 * A "manual break" is a `\n`. We NORMALIZE CRLF (`\r\n`) and lone CR (`\r`) — as
 * a paste from Windows/clipboard can introduce — down to `\n` first, so a stray
 * carriage return never leaks into a stored line (which would render as an
 * invisible glyph and silently diverge from export). Empty lines are PRESERVED
 * (a blank manual break is a real, intentional vertical slot — see
 * `layoutTextLines`), so we never trim or drop them.
 */

/** Split a textarea value into manual lines: normalize CRLF/CR → `\n`, then split. */
export function valueToLines(value: string): string[] {
  return value.replace(/\r\n?/g, '\n').split('\n')
}

/** Join stored manual lines back into a single textarea value (one `\n` per break). */
export function linesToValue(lines: readonly string[]): string {
  return lines.join('\n')
}

/** True when two manual-line arrays are content-identical (same count + entries). */
export function linesEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i])
}

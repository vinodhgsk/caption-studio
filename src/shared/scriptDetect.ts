/**
 * Script detection (P6.1 — Doc 08 typography; skill `indic-text`).
 *
 * The app is Indic-first. Per-script font selection and the per-script fallback
 * chain (`text.font.fallback`, Doc 00 §4) both need to know which writing system
 * a run of text is in. This module implements the deterministic Unicode-block
 * detection the `indic-text` skill specifies — used to pick the primary font for
 * a run and to order the fallback chain (Tamil text → Tamil font → … → Latin).
 *
 * SUPPORTED SCRIPTS (indic-text supported-language set): Tamil (primary/default),
 * Telugu, Malayalam, Kannada, Devanagari (Hindi), Latin (English). Anything else
 * resolves to {@link DEFAULT_SCRIPT} (Tamil) — never to a tofu/unknown — so the
 * Indic-first default always wins when text is empty/ambiguous.
 *
 * Headless-safe: pure functions + a static range table. NO electron/node/DOM, so
 * the renderer (Fonts panel), a vitest engine, and the export path import this
 * identically.
 */

// ---------------------------------------------------------------------------
// Script enum + Unicode block ranges (from the indic-text skill)
// ---------------------------------------------------------------------------

/**
 * The closed set of scripts the Indic-first app understands. `latin` covers
 * English/ASCII; the five Indic scripts cover the supported Indic languages.
 * Kept a closed union so font catalog `scripts[]` and fallback chains stay
 * exhaustive and a switch over it is total.
 */
export type Script = 'tamil' | 'telugu' | 'malayalam' | 'kannada' | 'devanagari' | 'latin'

/** Every supported script, in Indic-first order (Tamil leads). */
export const ALL_SCRIPTS: readonly Script[] = [
  'tamil',
  'telugu',
  'malayalam',
  'kannada',
  'devanagari',
  'latin'
]

/**
 * The global default script. Tamil is the Indic-first default (indic-text:
 * "Tamil is the global default language/script"). Empty/ambiguous text and any
 * out-of-set codepoint resolve here, so the default family (which renders Tamil)
 * always applies first.
 */
export const DEFAULT_SCRIPT: Script = 'tamil'

/** Inclusive Unicode codepoint range. */
interface Range {
  lo: number
  hi: number
}

/**
 * Per-script Unicode block ranges (from indic-text). Latin is restricted to the
 * Basic-Latin block per the skill table; combining/punctuation common to all
 * scripts is intentionally NOT attributed to any script so it does not skew the
 * dominant-script vote.
 */
const SCRIPT_RANGES: Record<Exclude<Script, 'latin'>, Range> & { latin: Range } = {
  tamil: { lo: 0x0b80, hi: 0x0bff },
  telugu: { lo: 0x0c00, hi: 0x0c7f },
  kannada: { lo: 0x0c80, hi: 0x0cff },
  malayalam: { lo: 0x0d00, hi: 0x0d7f },
  devanagari: { lo: 0x0900, hi: 0x097f },
  latin: { lo: 0x0000, hi: 0x007f }
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Classify a single codepoint to a {@link Script}, or `null` if it is outside
 * every supported block (e.g. emoji, CJK, general punctuation above U+007F).
 * `null` codepoints do not vote toward the dominant script.
 */
export function scriptOfCodePoint(cp: number): Script | null {
  for (const script of ALL_SCRIPTS) {
    const range = SCRIPT_RANGES[script]
    if (cp >= range.lo && cp <= range.hi) return script
  }
  return null
}

/**
 * Detect the DOMINANT script of a text run by counting codepoints per block and
 * returning the script with the most. Whitespace/ASCII punctuation (U+0000–007F)
 * counts toward `latin` per the indic-text range table, but an Indic script with
 * any meaningful presence wins because Indic letters fall outside Latin; to make
 * that explicit and avoid a stray space tipping a short Indic line to Latin, a
 * NON-Latin script wins any tie and beats Latin unless Latin is strictly the only
 * voting script.
 *
 * Empty/whitespace-only/unsupported text → {@link DEFAULT_SCRIPT} (Tamil), so the
 * Indic-first default always applies.
 *
 * PURE + deterministic — iterates by codepoint (`for…of` is codepoint-aware), so
 * it is safe on surrogate pairs. (Cluster segmentation is a separate concern;
 * detection only needs per-codepoint block membership.)
 */
export function detectScript(text: string): Script {
  if (typeof text !== 'string' || text.length === 0) return DEFAULT_SCRIPT

  const counts: Record<Script, number> = {
    tamil: 0,
    telugu: 0,
    malayalam: 0,
    kannada: 0,
    devanagari: 0,
    latin: 0
  }

  for (const ch of text) {
    const cp = ch.codePointAt(0)
    if (cp === undefined) continue
    const s = scriptOfCodePoint(cp)
    if (s !== null) counts[s] += 1
  }

  // Pick the highest-count NON-Latin script first (Indic-first tie-break).
  let bestIndic: Script | null = null
  let bestIndicCount = 0
  for (const s of ALL_SCRIPTS) {
    if (s === 'latin') continue
    if (counts[s] > bestIndicCount) {
      bestIndicCount = counts[s]
      bestIndic = s
    }
  }
  if (bestIndic !== null && bestIndicCount > 0) return bestIndic

  if (counts.latin > 0) return 'latin'

  // No supported codepoints voted (e.g. emoji-only) → Indic-first default.
  return DEFAULT_SCRIPT
}

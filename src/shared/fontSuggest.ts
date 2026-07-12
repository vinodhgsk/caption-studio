/**
 * AI font-suggestion shared contract (P6.6 — Doc 08 typography; skill `text-render`).
 *
 * The "AI font generator" turns a free-text PROMPT (e.g. "bold cinematic title",
 * "elegant tamil wedding", "handwritten note") into a ranked list of font
 * SUGGESTIONS — each one a family that ALREADY EXISTS in the font registry
 * (P6.1, bundled or imported). NOTHING proprietary or external is baked in: the
 * provider never invents a family name or ships font bytes; it only MAPS a
 * prompt onto the catalog the app already owns. A cloud LLM can later back the
 * same interface, but it too must resolve its answers to registry families
 * before returning them (see {@link FontSuggestionProvider}).
 *
 * Pure TYPES + tiny const helpers ONLY. NO electron / node / DOM imports leak
 * here so the renderer (Fonts panel), the local provider, the provider registry,
 * and a vitest engine all import this module identically (mirrors `stt.ts`).
 */
import type { Script } from './scriptDetect'
import type { FontCategory } from './fontRegistry'

/**
 * One suggested font returned by a {@link FontSuggestionProvider}. `family` MUST
 * be a family name that exists in the font registry — the renderer applies it to
 * `text.font.family` directly, so an unknown family would be a no-op/tofu. The
 * other fields are presentation-only (the UI shows `label`/`reason` and renders
 * `sample` in the family) and carry NO external IP.
 */
export interface FontSuggestion {
  /** Registry family name to apply to `text.font.family` (e.g. `Noto Sans Tamil`). */
  family: string
  /** Short human label for the suggestion chip (defaults to `family`). */
  label: string
  /** Why this family matched the prompt — for the UI tooltip/subtext. */
  reason: string
  /** A script-appropriate sample string to preview the suggestion in. */
  sample: string
  /**
   * Match score in [0,1] used to RANK suggestions (higher = stronger match).
   * Deterministic for a given prompt + catalog so results are stable/testable.
   */
  score: number
}

/**
 * Options for a suggestion request. `script` biases results toward families that
 * COVER that script (Indic-first: a Tamil project prefers Tamil-capable picks);
 * `limit` caps the returned count. All optional — a bare prompt still works.
 */
export interface SuggestOptions {
  /** Prefer families covering this script (e.g. the selected clip's text script). */
  script?: Script
  /** Maximum number of suggestions to return. Defaults to {@link DEFAULT_SUGGEST_LIMIT}. */
  limit?: number
}

/** Default cap on suggestion count when {@link SuggestOptions.limit} is omitted. */
export const DEFAULT_SUGGEST_LIMIT = 6

/**
 * The pluggable font-suggestion provider interface (P6.6). A provider maps a
 * free-text `prompt` to a ranked list of {@link FontSuggestion}s drawn ENTIRELY
 * from the font registry. It must be GRACEFUL: an empty/garbage prompt still
 * resolves to a sensible non-empty fallback (never throws for bad input), so the
 * UI can always offer something. A real LLM provider drops in behind this same
 * interface (and must still resolve its output to registry families).
 */
export interface FontSuggestionProvider {
  /** Stable id used by the registry/factory (e.g. `'local'`, `'cloud'`). */
  readonly id: string
  /**
   * Suggest registry families for `prompt`. Resolves to a ranked, de-duplicated
   * list (best first), capped by `opts.limit`. Always resolves to a NON-EMPTY
   * list for any input (graceful fallback) and never references a family outside
   * the registry.
   */
  suggest(prompt: string, opts?: SuggestOptions): Promise<FontSuggestion[]>
}

/**
 * A keyword → catalog-facet rule the local provider matches a prompt against.
 * Pure DATA (no font bytes, no external families) — it only steers toward
 * existing catalog families by `category` and/or `script`. Exported so tests and
 * a future provider can introspect/extend the mapping.
 */
export interface FontKeywordRule {
  /** Lower-cased keywords/synonyms that trigger this rule (matched as words). */
  keywords: readonly string[]
  /** Bias toward families in this category (e.g. `cinematic` for "title"). */
  category?: FontCategory
  /** Bias toward families covering this script (e.g. `tamil` for "tamil"). */
  script?: Script
  /** Short reason surfaced in the suggestion when this rule fires. */
  reason: string
}

/**
 * Local deterministic font-suggestion provider (P6.6 — Doc 08 typography).
 *
 * The DEFAULT {@link FontSuggestionProvider}: it maps a free-text prompt onto the
 * font registry's catalog using a static keyword → (category, script) rule table
 * ({@link KEYWORD_RULES}) plus a direct family-name match. It is:
 *
 *   - CATALOG-ONLY / no external IP — it NEVER invents a family or ships font
 *     bytes; every suggestion is a family the supplied {@link FontRegistry}
 *     already knows (bundled or imported), so a newly imported font becomes
 *     suggestable the moment it is in the registry.
 *   - DETERMINISTIC — same prompt + same catalog → same ranked output (scores
 *     and tie-breaks are stable on catalog order), so it is unit-testable.
 *   - GRACEFUL — an empty / whitespace / unmatched prompt still returns a
 *     non-empty list of sensible defaults (the Indic-first home families), so
 *     the UI always has something to offer; it never throws for bad input.
 *
 * Pure + headless-safe: takes the registry as a dependency, no electron/node/DOM.
 */
import type {
  FontSuggestion,
  FontSuggestionProvider,
  FontKeywordRule,
  SuggestOptions
} from './fontSuggest'
import { DEFAULT_SUGGEST_LIMIT } from './fontSuggest'
import {
  fontRegistry as defaultRegistry,
  previewTextFor,
  type FontRegistry,
  type FontEntry
} from './fontRegistry'

/** Stable id for the built-in local provider. */
export const LOCAL_FONT_PROVIDER_ID = 'local'

/**
 * Keyword → catalog-facet rules (pure data, NO external families). Each rule
 * steers a prompt toward existing catalog families by `category` and/or `script`.
 * Synonyms are grouped so common phrasings ("title"/"poster" → cinematic) map the
 * same way. Order is irrelevant — scoring sums every firing rule. Extend this
 * table (not the callers) to teach the local provider new vocabulary.
 */
export const KEYWORD_RULES: readonly FontKeywordRule[] = [
  // --- Category moods ------------------------------------------------------
  {
    keywords: ['bold', 'heavy', 'strong', 'impact', 'poster', 'title', 'headline', 'display'],
    category: 'cinematic',
    reason: 'Bold display weight for titles'
  },
  {
    keywords: ['cinematic', 'movie', 'film', 'trailer', 'credits', 'dramatic', 'epic'],
    category: 'cinematic',
    reason: 'Cinematic title look'
  },
  {
    keywords: ['techno', 'tech', 'futuristic', 'sci-fi', 'scifi', 'gaming', 'sport', 'sporty'],
    category: 'cinematic',
    reason: 'Condensed techno/sport face'
  },
  {
    keywords: ['elegant', 'classy', 'luxury', 'fancy', 'formal', 'wedding', 'serif', 'editorial', 'magazine'],
    category: 'serif',
    reason: 'Elegant serif for refined text'
  },
  {
    keywords: ['handwritten', 'handwriting', 'script', 'cursive', 'signature', 'casual', 'brush', 'calligraphy'],
    category: 'script',
    reason: 'Handwritten / script style'
  },
  {
    keywords: ['decorative', 'novelty', 'fun', 'playful', 'quirky', 'unique', 'stylish'],
    category: 'decorative',
    reason: 'Decorative / display novelty'
  },
  {
    keywords: ['clean', 'modern', 'minimal', 'simple', 'sans', 'readable', 'neutral', 'ui', 'body', 'subtitle'],
    category: 'sans',
    reason: 'Clean modern sans-serif'
  },
  // --- Script affinities (Indic-first) -------------------------------------
  { keywords: ['tamil', 'தமிழ்'], script: 'tamil', reason: 'Tamil-capable family' },
  { keywords: ['telugu', 'తెలుగు'], script: 'telugu', reason: 'Telugu-capable family' },
  { keywords: ['malayalam', 'മലയാളം'], script: 'malayalam', reason: 'Malayalam-capable family' },
  { keywords: ['kannada', 'ಕನ್ನಡ'], script: 'kannada', reason: 'Kannada-capable family' },
  {
    keywords: ['hindi', 'devanagari', 'देवनागरी', 'हिन्दी'],
    script: 'devanagari',
    reason: 'Devanagari-capable family'
  },
  { keywords: ['english', 'latin', 'roman'], script: 'latin', reason: 'Latin-capable family' }
]

/** Split a prompt into lower-cased word-ish tokens (keeps Indic letters). */
function tokenize(prompt: string): string[] {
  const lower = (prompt ?? '').toLowerCase()
  // Match runs of letters/digits across scripts; ignore punctuation/whitespace.
  const matches = lower.match(/[\p{L}\p{N}-]+/gu)
  return matches ?? []
}

/** Is every char of `s` a printable ASCII char (space..~)? Non-ASCII → false. */
function isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x20 || c > 0x7e) return false
  }
  return true
}

/** True if `rule` fires for any token in `tokens` (word-level, not substring). */
function ruleFires(rule: FontKeywordRule, tokens: readonly string[], raw: string): boolean {
  for (const kw of rule.keywords) {
    if (tokens.includes(kw)) return true
    // Multi-word / Indic keywords: fall back to a raw substring check.
    if (kw.includes(' ') || !isAscii(kw)) {
      if (raw.includes(kw)) return true
    }
  }
  return false
}

interface Scored {
  entry: FontEntry
  /** The meaningful facet/name match score in [0,1+] (drives the displayed score). */
  score: number
  /** `score` plus a tiny catalog-order epsilon, used ONLY for stable sorting. */
  sortKey: number
  reasons: string[]
}

/**
 * Create the local deterministic provider over a {@link FontRegistry}. The shared
 * default ({@link localFontSuggestionProvider}) binds the app's default registry;
 * tests pass an isolated registry so a custom catalog (and newly registered
 * fonts) can be exercised in isolation.
 */
export function createLocalFontSuggestionProvider(
  registry: FontRegistry = defaultRegistry
): FontSuggestionProvider {
  async function suggest(prompt: string, opts: SuggestOptions = {}): Promise<FontSuggestion[]> {
    const limit = Math.max(1, opts.limit ?? DEFAULT_SUGGEST_LIMIT)
    const catalog = registry.allFonts()
    if (catalog.length === 0) return []

    const raw = (prompt ?? '').toLowerCase()
    const tokens = tokenize(prompt)

    // Which facets does the prompt ask for?
    const wantCategories = new Set<string>()
    const wantScripts = new Set<string>()
    const facetReasons = new Map<string, string>()
    for (const rule of KEYWORD_RULES) {
      if (!ruleFires(rule, tokens, raw)) continue
      if (rule.category !== undefined) {
        wantCategories.add(rule.category)
        facetReasons.set(`c:${rule.category}`, rule.reason)
      }
      if (rule.script !== undefined) {
        wantScripts.add(rule.script)
        facetReasons.set(`s:${rule.script}`, rule.reason)
      }
    }
    // The opts.script bias acts like an implicit script keyword (Indic-first UI).
    if (opts.script !== undefined) wantScripts.add(opts.script)

    const scored: Scored[] = catalog.map((entry, idx) => {
      let score = 0
      const reasons: string[] = []

      // Direct family-name match (strongest, deterministic).
      const famLower = entry.family.toLowerCase()
      if (raw.length > 0 && (raw.includes(famLower) || tokens.includes(famLower))) {
        score += 1
        reasons.push('Matched family name')
      }

      // Category facet match.
      if (wantCategories.has(entry.category)) {
        score += 0.6
        const r = facetReasons.get(`c:${entry.category}`)
        if (r !== undefined) reasons.push(r)
      }

      // Script facet match. Indic-first: a requested script is a STRONG intent
      // (a Tamil project must get a Tamil-capable face), so a home-script match
      // outweighs a category mood; secondary coverage counts less.
      for (const s of wantScripts) {
        if (entry.scripts[0] === s) {
          score += 0.7
          const r = facetReasons.get(`s:${s}`)
          reasons.push(r ?? `${s} home script`)
        } else if (entry.scripts.includes(s as FontEntry['scripts'][number])) {
          score += 0.2
        }
      }

      // Tiny deterministic tie-break by catalog order so equal scores are stable.
      const sortKey = score + (catalog.length - idx) * 1e-6

      return { entry, score, sortKey, reasons }
    })

    const matched = scored.filter((s) => hasFacetMatch(s, wantCategories, wantScripts, raw))
    const pool = matched.length > 0 ? matched : gracefulFallback(scored)

    pool.sort((a, b) => b.sortKey - a.sortKey)

    return pool.slice(0, limit).map((s) => toSuggestion(s))
  }

  return { id: LOCAL_FONT_PROVIDER_ID, suggest }
}

/**
 * Did this entry match a REQUESTED facet (not just the tie-break epsilon)? When
 * the prompt asks for nothing (no facets, no name match), every entry only has
 * the epsilon — handled by {@link gracefulFallback} instead.
 */
function hasFacetMatch(
  s: Scored,
  wantCategories: ReadonlySet<string>,
  wantScripts: ReadonlySet<string>,
  raw: string
): boolean {
  if (raw.length > 0 && s.reasons.includes('Matched family name')) return true
  if (wantCategories.has(s.entry.category)) return true
  for (const sc of wantScripts) if (s.entry.scripts.includes(sc as FontEntry['scripts'][number])) return true
  return false
}

/**
 * Graceful fallback when nothing matched: surface the Indic-first home families
 * (one representative per home script, in catalog order) so the UI always offers
 * sensible, catalog-only defaults. Never empty when the catalog is non-empty.
 */
function gracefulFallback(scored: readonly Scored[]): Scored[] {
  const seenHome = new Set<string>()
  const picks: Scored[] = []
  for (const s of scored) {
    const home = s.entry.scripts[0] ?? 'latin'
    if (seenHome.has(home)) continue
    seenHome.add(home)
    picks.push({ entry: s.entry, score: 0, sortKey: s.sortKey, reasons: ['Suggested default'] })
  }
  // If somehow no homes (shouldn't happen), fall back to the whole catalog.
  return picks.length > 0 ? picks : [...scored]
}

/** Project a scored entry to the public {@link FontSuggestion} shape. */
function toSuggestion(s: Scored): FontSuggestion {
  return {
    family: s.entry.family,
    label: s.entry.displayName,
    reason: s.reasons.length > 0 ? dedupeReasons(s.reasons) : 'Suggested default',
    sample: previewTextFor(s.entry),
    // Clamp the displayed score to [0,1], rounded to 2dp (no tie-break noise).
    score: Math.min(1, Math.round(s.score * 100) / 100)
  }
}

/** Join distinct reasons into one readable phrase. */
function dedupeReasons(reasons: readonly string[]): string {
  const out: string[] = []
  for (const r of reasons) if (!out.includes(r)) out.push(r)
  return out.join(' · ')
}

/**
 * The shared default local provider bound to the app's default font registry.
 * The provider registry registers this as the default; tests can build an
 * isolated one with {@link createLocalFontSuggestionProvider}.
 */
export const localFontSuggestionProvider: FontSuggestionProvider =
  createLocalFontSuggestionProvider()

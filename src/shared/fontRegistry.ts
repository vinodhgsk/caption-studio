/**
 * Font registry (P6.1 — Doc 08 typography; skills `text-render`, `indic-text`).
 *
 * The SINGLE SOURCE OF TRUTH for the font catalog the Fonts panel renders: a
 * categorized library of bundled families (Indic-capable defaults covering
 * Tamil/Telugu/Malayalam/Kannada/Devanagari + Latin) plus a pluggable enumerator
 * for system fonts, with category filtering, name search, per-script fallback
 * chain resolution, and a small live-preview spec helper.
 *
 * WHY this is the source of truth: the caption default font (Doc 03 /
 * `captionPreset.ts`) is `Noto Sans Tamil` with an Indic-first fallback chain.
 * Hard-coding that in two places drifts. So {@link DEFAULT_FONT_FAMILY} and
 * {@link defaultFallbackChain} live HERE and {@link captionPreset.ts} re-exports
 * its constants from this module — the registry now owns the global default.
 *
 * DESIGN for the rest of Phase 6:
 *   - P6.2 (custom import) appends entries via {@link registerFont} (source:
 *     `'imported'`, with a `media/fonts/…` `fileRef`), and they participate in
 *     listing/search/fallback like any bundled family.
 *   - P6.3 (controls) reads {@link FontEntry} metadata (weights/styles, default
 *     weight) to populate weight/italic controls; the resolved `family` feeds
 *     `text.font.family`.
 *   - P6.5 (AI generator) is a separate provider that ultimately yields family
 *     names resolvable here.
 *   - P6.17/P6.18 (Indic-first / HarfBuzz) consume {@link resolveFallbackChain}
 *     to choose the per-run font and the `scripts[]` coverage to drive shaping.
 *
 * PURE + headless-safe: pure data + pure helpers + an injectable system-font
 * enumerator (stubbed by default — main-process font listing is a follow-up).
 * NO electron/node/DOM here, so the renderer, a vitest engine, and the export
 * path import it identically.
 */
import { detectScript, type Script, ALL_SCRIPTS } from './scriptDetect'

// ---------------------------------------------------------------------------
// Catalog shape
// ---------------------------------------------------------------------------

/**
 * Font category the Fonts-panel library groups by (Doc 08 UI spec). `sans`/
 * `serif` are the workhorse text categories; `script` is handwriting/cursive;
 * `decorative` is display/novelty; `cinematic` is the bold title/credits look.
 * Closed union so the panel renders a stable, ordered set of tabs.
 */
export type FontCategory = 'sans' | 'serif' | 'script' | 'decorative' | 'cinematic'

/** Every category, in Fonts-panel tab order. */
export const ALL_CATEGORIES: readonly FontCategory[] = [
  'sans',
  'serif',
  'script',
  'decorative',
  'cinematic'
]

/** Where a family came from: shipped with the app vs. enumerated from the OS. */
export type FontSource = 'bundled' | 'system' | 'imported'

/**
 * A reference to an embedded font file in the project bundle (`media/fonts/…`,
 * Doc 08 data model / Doc 00 §4). Bundled defaults set this so the SAME bytes
 * load in preview and export (indic-text parity rule). System fonts omit it.
 * P6.2 populates this for imported families.
 */
export interface FontFileRef {
  /** Bundle-relative path, e.g. `media/fonts/NotoSansTamil-Regular.ttf`. */
  path: string
  /** The weight this file provides (100..900). */
  weight: number
  /** Whether this file is the italic/oblique cut. */
  italic: boolean
}

/**
 * One catalog entry. The library card shows `displayName` + `category` + a live
 * preview; the controls read `weights`/`styles`; the fallback resolver reads
 * `scripts` (Unicode coverage) + `family`.
 */
export interface FontEntry {
  /** CSS family name — what lands in `text.font.family` and the CSS `font` list. */
  family: string
  /** Human label for the library card (defaults to `family`). */
  displayName: string
  category: FontCategory
  source: FontSource
  /**
   * The scripts this family can render, in priority order. The FIRST script is
   * the family's "home" script (Noto Sans Tamil → `tamil`); a family may cover
   * more (Inter covers `latin` only; a Latin family does NOT claim Indic glyphs).
   * Drives {@link resolveFallbackChain}: a Tamil run prefers a `tamil`-covering
   * family. MUST be non-empty.
   */
  scripts: Script[]
  /** Available numeric weights (100..900). Drives the weight control (P6.3). */
  weights: number[]
  /** Available styles. `'normal'` always; `'italic'` if an italic cut exists. */
  styles: ('normal' | 'italic')[]
  /** Sample text for the live preview (defaults to a script-appropriate pangram). */
  previewText?: string
  /** Embedded file refs (bundled/imported). Empty/undefined for system fonts. */
  files?: FontFileRef[]
}

// ---------------------------------------------------------------------------
// Per-script preview samples (Tamil sample by default — Doc 08 UI spec)
// ---------------------------------------------------------------------------

/**
 * Representative preview strings per script. The Fonts panel shows the Tamil
 * sample by default (Doc 08), but a Latin-only family previews Latin so the card
 * is not all-tofu. Used by {@link previewTextFor} / {@link buildPreviewSpec}.
 */
export const SCRIPT_SAMPLE: Record<Script, string> = {
  tamil: 'வணக்கம் தமிழ்',
  telugu: 'నమస్కారం తెలుగు',
  malayalam: 'നമസ്കാരം മലയാളം',
  kannada: 'ನಮಸ್ಕಾರ ಕನ್ನಡ',
  devanagari: 'नमस्ते हिन्दी',
  latin: 'The quick brown fox'
}

// ---------------------------------------------------------------------------
// Generic fallbacks appended at the END of every chain
// ---------------------------------------------------------------------------

/**
 * The generic CSS family the chain always ends with so a missing-glyph never
 * draws nothing. Latin-first chains end with this; Indic chains pass through a
 * Latin family first (so digits/punctuation render in a matching face) then this.
 */
export const GENERIC_SANS = 'sans-serif'

// ---------------------------------------------------------------------------
// Bundled catalog
// ---------------------------------------------------------------------------

const STD_WEIGHTS = [400, 500, 600, 700]

/** Quick helper to declare a bundled entry without repeating boilerplate. */
function bundled(
  family: string,
  category: FontCategory,
  scripts: Script[],
  opts: Partial<Pick<FontEntry, 'displayName' | 'weights' | 'styles' | 'previewText'>> = {}
): FontEntry {
  return {
    family,
    displayName: opts.displayName ?? family,
    category,
    source: 'bundled',
    scripts,
    weights: opts.weights ?? STD_WEIGHTS,
    styles: opts.styles ?? ['normal', 'italic'],
    ...(opts.previewText ? { previewText: opts.previewText } : {})
  }
}

/**
 * The shipped bundled catalog. Indic-capable defaults (the indic-text "Fonts"
 * list) lead so the per-script fallback always has a covering family, followed
 * by the Latin display/cinematic picks. Each Indic family declares its home
 * script PLUS `latin` (Noto covers Latin digits/punctuation), so an Indic chain
 * can stay within one family for mixed text before reaching a Latin fallback.
 *
 * Ordering is stable + deterministic (drives default listing order).
 */
export const BUNDLED_FONTS: readonly FontEntry[] = [
  // --- Indic-capable defaults (indic-text Fonts list) ----------------------
  // Noto Sans Tamil stays FIRST so it remains the neutral per-script tofu
  // fallback for arbitrary Tamil text.
  bundled('Noto Sans Tamil', 'sans', ['tamil', 'latin']),
  bundled('Noto Serif Tamil', 'serif', ['tamil', 'latin']),
  // --- Tamil DEVOTIONAL display faces (best free fits for the gold title) ----
  // Baloo Thambi 2 — heavy ROUNDED (Doc 03 §7 primary pick), the default caption
  // face. Variable weight (400–800); the gold preset uses ExtraBold.
  bundled('Baloo Thambi 2', 'decorative', ['tamil', 'latin'], {
    weights: [400, 500, 600, 700, 800]
  }),
  // Catamaran — clean modern grotesque, heavy weights (variable 100–900); a
  // crisp poster alternative to Baloo.
  bundled('Catamaran', 'sans', ['tamil', 'latin'], {
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900]
  }),
  // Mukta Malar — traditional humanist, ExtraBold; the classic devotional feel.
  bundled('Mukta Malar', 'sans', ['tamil', 'latin'], { weights: [400, 600, 700, 800] }),
  // Anek Tamil — contemporary variable (100–800), great for bold lyric titles.
  bundled('Anek Tamil', 'sans', ['tamil', 'latin'], {
    weights: [100, 200, 300, 400, 500, 600, 700, 800]
  }),
  // Hind Madurai — even, readable, SemiBold; a calmer devotional caption.
  bundled('Hind Madurai', 'sans', ['tamil', 'latin'], { weights: [400, 500, 600, 700] }),
  // Pavanam — elegant single-weight display; a lighter ornamental option.
  bundled('Pavanam', 'sans', ['tamil', 'latin'], { weights: [400], styles: ['normal'] }),
  
  // --- Trendy new Tamil fonts ----
  bundled('Coiny', 'decorative', ['tamil', 'latin'], { weights: [400], styles: ['normal'] }),
  bundled('Kavivanar', 'script', ['tamil', 'latin'], { weights: [400], styles: ['normal'] }),
  bundled('Meera Inimai', 'sans', ['tamil', 'latin'], { weights: [400], styles: ['normal'] }),
  bundled('Tiro Tamil', 'serif', ['tamil', 'latin'], { weights: [400] }),
  
  // --- User added Tamil fonts ----
  bundled('Ka Kalvettu', 'decorative', ['tamil', 'latin'], { weights: [700], styles: ['normal'] }),
  bundled('Ka Dhool', 'decorative', ['tamil', 'latin'], { weights: [700], styles: ['normal'] }),
  bundled('Ka Thiramai', 'decorative', ['tamil', 'latin'], { weights: [700], styles: ['normal'] }),
  bundled('JF Nathiya', 'decorative', ['tamil', 'latin'], { weights: [400], styles: ['normal'] }),
  bundled('JF Kamala', 'decorative', ['tamil', 'latin'], { weights: [400], styles: ['normal'] }),
  bundled('Ka Sangeetham', 'decorative', ['tamil', 'latin'], { weights: [700], styles: ['normal'] }),
  
  bundled('Noto Sans Telugu', 'sans', ['telugu', 'latin']),
  bundled('Noto Serif Telugu', 'serif', ['telugu', 'latin']),
  bundled('Noto Sans Malayalam', 'sans', ['malayalam', 'latin']),
  bundled('Noto Sans Kannada', 'sans', ['kannada', 'latin']),
  bundled('Noto Serif Kannada', 'serif', ['kannada', 'latin']),
  bundled('Noto Sans Devanagari', 'sans', ['devanagari', 'latin']),
  bundled('Mukta', 'sans', ['devanagari', 'latin']),
  // --- Latin workhorse + display picks (indic-text Latin list) -------------
  bundled('Inter', 'sans', ['latin'], { weights: [300, 400, 500, 600, 700, 800] }),
  bundled('Lora', 'serif', ['latin']),
  bundled('Playfair Display', 'serif', ['latin'], { weights: [400, 500, 600, 700, 800, 900] }),
  bundled('Dancing Script', 'script', ['latin'], { styles: ['normal'] }),
  bundled('Pacifico', 'script', ['latin'], { weights: [400], styles: ['normal'] }),
  bundled('Bebas Neue', 'cinematic', ['latin'], { weights: [400], styles: ['normal'] }),
  bundled('Oswald', 'cinematic', ['latin'], { weights: [300, 400, 500, 600, 700] }),
  bundled('Rajdhani', 'cinematic', ['latin'], { weights: [300, 400, 500, 600, 700] }),
  bundled('Anton', 'decorative', ['latin'], { weights: [400], styles: ['normal'] })
]

// ---------------------------------------------------------------------------
// Global default — Tamil-capable (Doc 08 / Doc 16 / Doc 03)
// ---------------------------------------------------------------------------

/**
 * The GLOBAL DEFAULT font family. Tamil-capable (Indic-first) — must appear in
 * {@link BUNDLED_FONTS} covering `tamil`. `captionPreset.ts` re-exports this as
 * `DEFAULT_CAPTION_FONT_FAMILY`, so the registry owns the one default.
 */
export const DEFAULT_FONT_FAMILY = 'Noto Sans Tamil'

/**
 * The default per-script fallback chain for the global default family — the same
 * Indic-first ordering `captionPreset.ts` re-exports as
 * `DEFAULT_CAPTION_FONT_FALLBACK`. Resolved lazily from the catalog so it cannot
 * drift from {@link BUNDLED_FONTS}.
 */
export function defaultFallbackChain(): string[] {
  return resolveFallbackChain(DEFAULT_FONT_FAMILY, 'tamil')
}

// ---------------------------------------------------------------------------
// System-font enumerator (pluggable / stubbed)
// ---------------------------------------------------------------------------

/**
 * Interface for enumerating OS-installed fonts. The main process will implement
 * this (font-manager / fontconfig) in a follow-up; the renderer treats it as a
 * pluggable dependency. The default registry uses {@link emptySystemEnumerator}
 * (deterministic, no system access) so listing is reproducible in tests.
 */
export interface SystemFontEnumerator {
  /** Return the OS-installed families as catalog entries (source: `'system'`). */
  list(): FontEntry[]
}

/** A no-op enumerator — the deterministic default until P6.x wires the OS list. */
export const emptySystemEnumerator: SystemFontEnumerator = {
  list: () => []
}

// ---------------------------------------------------------------------------
// Registry instance (bundled catalog + imported + a system enumerator)
// ---------------------------------------------------------------------------

/** Options for {@link createFontRegistry}. */
export interface FontRegistryOptions {
  /** Override the bundled catalog (tests). Defaults to {@link BUNDLED_FONTS}. */
  bundled?: readonly FontEntry[]
  /** System-font source. Defaults to {@link emptySystemEnumerator}. */
  system?: SystemFontEnumerator
}

/** Filter args for {@link FontRegistry.listFonts}. */
export interface ListFontsQuery {
  /** Restrict to one category. */
  category?: FontCategory
  /** Substring (case-insensitive) name search over family + displayName. */
  query?: string
  /** Restrict to families covering this script (Indic-first filtering). */
  script?: Script
  /** Restrict to a source (`bundled`/`system`/`imported`). */
  source?: FontSource
}

/**
 * A live, in-memory font registry. Combines the bundled catalog, any imported
 * families (P6.2 via {@link registerFont}), and the system enumerator's list.
 * All read methods are PURE over the current state and return COPIES so callers
 * cannot mutate the catalog.
 */
export interface FontRegistry {
  /** All known families (bundled + imported + system), de-duplicated by family. */
  allFonts(): FontEntry[]
  /** Filtered + searched listing (category / query / script / source). */
  listFonts(query?: ListFontsQuery): FontEntry[]
  /** Look up one entry by exact family name (case-insensitive). */
  getFont(family: string): FontEntry | undefined
  /** True if a family is known to the registry. */
  hasFont(family: string): boolean
  /**
   * Append an imported/plugin family (P6.2). Rejects an empty family; later
   * registrations of the same family REPLACE the prior imported entry (re-import
   * updates files), but never shadow a bundled family of the same name.
   */
  registerFont(entry: FontEntry): void
  /**
   * Resolve the ordered fallback chain for a primary family + a script (or text
   * to detect the script from). See module-level {@link resolveFallbackChain}.
   */
  resolveFallbackChain(family: string, scriptOrText: Script | string): string[]
  /** All categories that have at least one font (for panel tabs). */
  categories(): FontCategory[]
}

/** Lower-cased family key for case-insensitive lookup/de-dup. */
function key(family: string): string {
  return family.trim().toLowerCase()
}

/**
 * Create a {@link FontRegistry}. The module exports a shared default instance
 * ({@link fontRegistry}); tests/import flows can create isolated instances.
 */
export function createFontRegistry(opts: FontRegistryOptions = {}): FontRegistry {
  const bundledList = (opts.bundled ?? BUNDLED_FONTS).map(cloneEntry)
  const system = opts.system ?? emptySystemEnumerator
  const imported = new Map<string, FontEntry>()

  const bundledKeys = new Set(bundledList.map((f) => key(f.family)))

  function allFonts(): FontEntry[] {
    // De-dup by family key; precedence bundled > imported > system.
    const out = new Map<string, FontEntry>()
    for (const f of system.list()) out.set(key(f.family), cloneEntry({ ...f, source: 'system' }))
    for (const f of imported.values()) out.set(key(f.family), cloneEntry(f))
    for (const f of bundledList) out.set(key(f.family), cloneEntry(f))
    // Preserve bundled order first, then imported, then system extras.
    const ordered: FontEntry[] = []
    const emitted = new Set<string>()
    for (const f of bundledList) {
      ordered.push(out.get(key(f.family))!)
      emitted.add(key(f.family))
    }
    for (const f of imported.values()) {
      const k = key(f.family)
      if (!emitted.has(k)) {
        ordered.push(out.get(k)!)
        emitted.add(k)
      }
    }
    for (const f of system.list()) {
      const k = key(f.family)
      if (!emitted.has(k)) {
        ordered.push(out.get(k)!)
        emitted.add(k)
      }
    }
    return ordered
  }

  function listFonts(q: ListFontsQuery = {}): FontEntry[] {
    const needle = q.query?.trim().toLowerCase() ?? ''
    return allFonts().filter((f) => {
      if (q.category !== undefined && f.category !== q.category) return false
      if (q.source !== undefined && f.source !== q.source) return false
      if (q.script !== undefined && !f.scripts.includes(q.script)) return false
      if (needle.length > 0) {
        const hay = `${f.family} ${f.displayName}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }

  function getFont(family: string): FontEntry | undefined {
    const k = key(family)
    return allFonts().find((f) => key(f.family) === k)
  }

  function hasFont(family: string): boolean {
    return getFont(family) !== undefined
  }

  function registerFont(entry: FontEntry): void {
    if (typeof entry.family !== 'string' || entry.family.trim().length === 0) {
      throw new Error('registerFont: family must be a non-empty string')
    }
    if (!Array.isArray(entry.scripts) || entry.scripts.length === 0) {
      throw new Error(`registerFont: "${entry.family}" must declare at least one script`)
    }
    const k = key(entry.family)
    if (bundledKeys.has(k)) {
      throw new Error(`registerFont: "${entry.family}" collides with a bundled family`)
    }
    imported.set(k, cloneEntry(entry))
  }

  function resolve(family: string, scriptOrText: Script | string): string[] {
    return resolveFallbackChainOn(allFonts(), family, scriptOrText)
  }

  function categories(): FontCategory[] {
    const present = new Set(allFonts().map((f) => f.category))
    return ALL_CATEGORIES.filter((c) => present.has(c))
  }

  return {
    allFonts,
    listFonts,
    getFont,
    hasFont,
    registerFont,
    resolveFallbackChain: resolve,
    categories
  }
}

/** Deep-ish clone of an entry so callers cannot mutate shared catalog state. */
function cloneEntry(e: FontEntry): FontEntry {
  return {
    ...e,
    scripts: [...e.scripts],
    weights: [...e.weights],
    styles: [...e.styles],
    ...(e.files ? { files: e.files.map((f) => ({ ...f })) } : {})
  }
}

// ---------------------------------------------------------------------------
// Per-script fallback chain (pure, catalog-driven)
// ---------------------------------------------------------------------------

/**
 * Resolve the ordered per-script fallback chain for `family` given a `script`
 * (or text to detect it from), over the supplied `catalog`. The chain:
 *
 *   1. the primary `family` (always first, even if it does not cover the script);
 *   2. every OTHER bundled family whose FIRST/home script matches `script`
 *      (so a Tamil run falls back Tamil → Tamil → … before leaving the script);
 *   3. a Latin family (so digits/punctuation/mixed-script render in a real face);
 *   4. {@link GENERIC_SANS} as the terminal generic so a missing glyph never
 *      draws nothing.
 *
 * De-duplicated, order-preserving. PURE — no registry/DOM. The chain always ENDS
 * in a Latin fallback then `sans-serif`, satisfying the indic-text rule.
 */
export function resolveFallbackChainOn(
  catalog: readonly FontEntry[],
  family: string,
  scriptOrText: Script | string
): string[] {
  const script: Script = isScript(scriptOrText) ? scriptOrText : detectScript(scriptOrText)

  const chain: string[] = []
  const seen = new Set<string>()
  const push = (f: string): void => {
    const t = f.trim()
    if (t.length === 0 || seen.has(t.toLowerCase())) return
    seen.add(t.toLowerCase())
    chain.push(t)
  }

  // 1. primary family always leads.
  push(family)

  // 2. same-home-script families (excluding the primary), catalog order.
  for (const e of catalog) {
    if (e.scripts.length > 0 && e.scripts[0] === script) push(e.family)
  }

  // 2b. families that COVER the script but as a secondary (rare; keeps coverage).
  if (script !== 'latin') {
    for (const e of catalog) {
      if (e.scripts.includes(script)) push(e.family)
    }
  }

  // 3. a real Latin family for digits/punctuation/mixed text.
  for (const e of catalog) {
    if (e.scripts.length > 0 && e.scripts[0] === 'latin') {
      push(e.family)
      break
    }
  }

  // 4. terminal generic so there is never a tofu-only end.
  push(GENERIC_SANS)

  return chain
}

/**
 * Module-level convenience that resolves against the shared {@link BUNDLED_FONTS}
 * catalog. Equivalent to {@link FontRegistry.resolveFallbackChain} on the default
 * registry but importable without a registry instance (used by `captionPreset.ts`
 * to derive its default chain).
 */
export function resolveFallbackChain(family: string, scriptOrText: Script | string): string[] {
  return resolveFallbackChainOn(BUNDLED_FONTS, family, scriptOrText)
}

/**
 * The minimal `text.font` shape {@link resolveFontForText} reads: the chosen
 * primary `family` and the persisted per-script `fallback` chain (Doc 00 §4
 * `text.font.fallback`). Both optional so a clip that has not set typography
 * still resolves to the Indic-first default.
 */
export interface FontForText {
  family?: string
  fallback?: string[]
}

/**
 * The script-correct font resolution the DRAW PATH calls so Tamil/Telugu/etc.
 * text never renders tofu (indic-text "resolve missing glyphs by script before
 * falling back to a tofu box"). Given a clip's `font` ({@link FontForText}) and
 * the text being rendered (or an explicit {@link Script}), it returns the ORDERED
 * CSS family list where:
 *
 *   1. the chosen `family` leads IF it covers the run's script (the user's pick
 *      wins when it can render the text);
 *   2. otherwise a catalog family that DOES cover the script leads (so a Latin-only
 *      family chosen for Tamil text still shapes Tamil — no tofu), with the chosen
 *      `family` kept right after as a hint;
 *   3. the clip's own persisted `fallback` entries (Doc 00 §4) follow;
 *   4. the catalog per-script chain ({@link resolveFallbackChain}) fills any gap
 *      and guarantees a Latin family + {@link GENERIC_SANS} terminal.
 *
 * De-duplicated, order-preserving, PURE. Resolved over {@link BUNDLED_FONTS} plus
 * any extra catalog entries supplied (so imported/Tamil families participate).
 * Use {@link resolveFontForTextOn} to resolve against a live registry's catalog.
 */
export function resolveFontForTextOn(
  catalog: readonly FontEntry[],
  font: FontForText | undefined,
  scriptOrText: Script | string
): string[] {
  const script: Script = isScript(scriptOrText) ? scriptOrText : detectScript(scriptOrText)
  const chosen = typeof font?.family === 'string' && font.family.trim().length > 0 ? font.family.trim() : ''
  const clipFallback = Array.isArray(font?.fallback)
    ? font!.fallback!.filter((f): f is string => typeof f === 'string')
    : []

  // Does the chosen family cover the run's script? (Unknown families — e.g. a
  // freshly imported one not yet in the catalog — are trusted to cover it, since
  // the user picked it for this text; only a KNOWN family that demonstrably lacks
  // the script is demoted below a covering family.)
  const chosenEntry = chosen.length > 0 ? catalog.find((e) => key(e.family) === key(chosen)) : undefined
  const chosenCovers = chosen.length === 0 ? false : chosenEntry === undefined || chosenEntry.scripts.includes(script)

  const out: string[] = []
  const seen = new Set<string>()
  const push = (f: string): void => {
    const t = f.trim()
    if (t.length === 0 || seen.has(t.toLowerCase())) return
    seen.add(t.toLowerCase())
    out.push(t)
  }

  if (chosen.length > 0 && chosenCovers) {
    // 1. user's pick covers the script → it leads.
    push(chosen)
  } else if (chosen.length > 0) {
    // 2. user's pick CANNOT render this script → lead with a covering catalog
    //    family so the glyphs shape, but keep the pick right after as a hint.
    const cover = catalog.find((e) => e.scripts.length > 0 && e.scripts[0] === script)
    if (cover) push(cover.family)
    push(chosen)
  }

  // 3. the clip's own persisted fallback chain (Doc 00 §4 text.font.fallback).
  //    Skip the generic terminal here so a chain ending in `sans-serif` does not
  //    bury the catalog families that follow — the generic is appended LAST below.
  for (const f of clipFallback) {
    if (f.trim().toLowerCase() === GENERIC_SANS) continue
    push(f)
  }

  // 4. the catalog's per-script chain fills any gap + guarantees Latin coverage.
  //    Resolve from the COVERING family (or the chosen one) so the chain stays in
  //    the right script before reaching the Latin tail.
  const chainAnchor = chosenCovers && chosen.length > 0 ? chosen : firstFamilyForScript(catalog, script) ?? chosen
  for (const f of resolveFallbackChainOn(catalog, chainAnchor || GENERIC_SANS, script)) {
    if (f.trim().toLowerCase() === GENERIC_SANS) continue
    push(f)
  }

  // 5. the terminal generic — ALWAYS last, so a missing glyph never draws nothing.
  push(GENERIC_SANS)

  return out
}

/** First catalog family whose home script is `script`, if any. */
function firstFamilyForScript(catalog: readonly FontEntry[], script: Script): string | undefined {
  const e = catalog.find((f) => f.scripts.length > 0 && f.scripts[0] === script)
  return e?.family
}

/**
 * Module-level {@link resolveFontForTextOn} over the shared {@link BUNDLED_FONTS}
 * catalog — the importable helper the renderer/export draw paths call directly so
 * a run of text always resolves a script-covering primary then a Latin + generic
 * tail. The caller turns the returned list into a CSS family list via
 * {@link cssFamilyList}.
 */
export function resolveFontForText(
  font: FontForText | undefined,
  scriptOrText: Script | string
): string[] {
  return resolveFontForTextOn(BUNDLED_FONTS, font, scriptOrText)
}

/** Type guard: is the value one of the supported {@link Script} tokens? */
function isScript(v: unknown): v is Script {
  return typeof v === 'string' && (ALL_SCRIPTS as readonly string[]).includes(v)
}

// ---------------------------------------------------------------------------
// Live-preview spec (reuses captionTextRender's family-list logic at call sites)
// ---------------------------------------------------------------------------

/** A flat, canvas-agnostic spec for a font-library live preview swatch. */
export interface FontPreviewSpec {
  family: string
  /** The CSS family list (family + resolved fallback chain), quoted + de-duped. */
  fontFamilyList: string
  /** The sample text to render (script-appropriate). */
  sampleText: string
  /** The script the sample/preview is for. */
  script: Script
  /** The weight to preview with (the family's default/regular weight). */
  weight: number
  /** Whether the preview is italic (always false for the swatch). */
  italic: boolean
}

/**
 * Choose the preview sample text for an entry: its explicit `previewText`, else
 * the per-script sample for its HOME script (Tamil sample for a Tamil family,
 * Latin pangram for a Latin family) — matching the Doc 08 "Tamil sample by
 * default" rule for the Indic-first defaults.
 */
export function previewTextFor(entry: FontEntry): string {
  if (entry.previewText && entry.previewText.length > 0) return entry.previewText
  const home = entry.scripts[0] ?? 'tamil'
  return SCRIPT_SAMPLE[home]
}

/** Pick the regular/default weight to preview with (400 if available, else the lowest). */
function defaultWeight(entry: FontEntry): number {
  if (entry.weights.includes(400)) return 400
  return entry.weights.length > 0 ? Math.min(...entry.weights) : 400
}

/**
 * Build a {@link FontPreviewSpec} for a library card. Reuses the SAME family-list
 * shape `captionTextRender.fontFamilyList` produces (family + de-duped fallback,
 * space-containing tokens quoted) so a preview swatch and the applied caption
 * resolve the same glyph source. PURE — the renderer turns this into a CSS `font`.
 */
export function buildPreviewSpec(entry: FontEntry): FontPreviewSpec {
  const home = entry.scripts[0] ?? 'tamil'
  const sampleText = previewTextFor(entry)
  const script = detectScript(sampleText)
  const fallback = resolveFallbackChain(entry.family, home)
  return {
    family: entry.family,
    fontFamilyList: cssFamilyList(fallback),
    sampleText,
    script: script === 'latin' && home !== 'latin' ? home : script,
    weight: defaultWeight(entry),
    italic: false
  }
}

/**
 * Build a CSS family list from an already-resolved chain (family-first, the chain
 * already includes the primary as element 0). Mirrors `captionTextRender`'s
 * `fontFamilyList`: de-dup + quote space-containing tokens. Kept here so the
 * registry has no renderer import; `captionTextRender` remains the canonical one
 * for preset rendering.
 */
export function cssFamilyList(families: readonly string[]): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const f of families) {
    const t = f.trim()
    if (t.length === 0 || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push(/\s/.test(t) ? `"${t}"` : t)
  }
  return out.join(', ')
}

// ---------------------------------------------------------------------------
// Shared default instance
// ---------------------------------------------------------------------------

/**
 * The shared default registry (bundled catalog + empty system enumerator). The
 * Fonts panel imports this; tests that need isolation use {@link createFontRegistry}.
 */
export const fontRegistry: FontRegistry = createFontRegistry()

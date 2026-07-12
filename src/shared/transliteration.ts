/**
 * Transliteration engine (P10R.1, Doc 16) — any-to-any across the six
 * supported languages via a phonetic pivot table.
 *
 * The pivot uses an IPA-like phoneme string as the common intermediate so
 * N languages need O(N) mappings, not O(N^2). Each script maps characters
 * (or digraphs) to a phoneme, and each phoneme maps to every other script's
 * representation.
 *
 * Pure functions only — NO DOM, NO Date, NO external calls.
 */

export type SupportedLang = 'ta' | 'te' | 'ml' | 'kn' | 'hi' | 'en'

export const SUPPORTED_LANGS: readonly SupportedLang[] = ['ta', 'te', 'ml', 'kn', 'hi', 'en']

/** Convert text from one language script to another, preserving pronunciation. */
export interface TransliterationProvider {
  transliterate(text: string, sourceLang: SupportedLang, targetLang: SupportedLang): Promise<string>
}

/** Phonetic pivot table entry — maps IPA-like phoneme to each script. */
interface PhoneticEntry {
  /** IPA-like pivot phoneme string. */
  phoneme: string
  ta?: string
  te?: string
  ml?: string
  kn?: string
  hi?: string
  en?: string
}

/**
 * The phonetic pivot table covering vowels and common consonants across all
 * six supported languages.
 *
 * Ordering: longer sequences FIRST within each script so the tokenizer greedily
 * matches multi-char sequences before single chars (e.g. "aa" before "a",
 * Tamil "ஆ" vs "அ").
 *
 * Tamil vowel signs (matras) are included to handle fully-composed Tamil text.
 * In Tamil a consonant like க (k) combines with a vowel sign to form ka (க), etc.
 * We map each combined form to the phoneme sequence.
 */
const PIVOT_TABLE: PhoneticEntry[] = [
  // ─── Vowels ───────────────────────────────────────────────────────────────
  { phoneme: 'aa', ta: 'ஆ', te: 'ఆ', ml: 'ആ', kn: 'ಆ', hi: 'आ', en: 'aa' },
  { phoneme: 'a',  ta: 'அ', te: 'అ', ml: 'അ', kn: 'ಅ', hi: 'अ', en: 'a'  },
  { phoneme: 'ii', ta: 'ஈ', te: 'ఈ', ml: 'ഈ', kn: 'ಈ', hi: 'ई', en: 'ii' },
  { phoneme: 'i',  ta: 'இ', te: 'ఇ', ml: 'ഇ', kn: 'ಇ', hi: 'इ', en: 'i'  },
  { phoneme: 'uu', ta: 'ஊ', te: 'ఊ', ml: 'ഊ', kn: 'ಊ', hi: 'ऊ', en: 'uu' },
  { phoneme: 'u',  ta: 'உ', te: 'ఉ', ml: 'ഉ', kn: 'ಉ', hi: 'उ', en: 'u'  },
  { phoneme: 'ee', ta: 'ஏ', te: 'ఏ', ml: 'ഏ', kn: 'ಏ', hi: 'ए', en: 'ee' },
  { phoneme: 'e',  ta: 'எ', te: 'ఎ', ml: 'എ', kn: 'ಎ', hi: 'ए', en: 'e'  },
  { phoneme: 'oo', ta: 'ஓ', te: 'ఓ', ml: 'ഓ', kn: 'ಓ', hi: 'ओ', en: 'oo' },
  { phoneme: 'o',  ta: 'ஒ', te: 'ఒ', ml: 'ഒ', kn: 'ಒ', hi: 'ओ', en: 'o'  },
  { phoneme: 'ai', ta: 'ஐ', te: 'ఐ', ml: 'ഐ', kn: 'ಐ', hi: 'ऐ', en: 'ai' },
  { phoneme: 'au', ta: 'ஔ', te: 'ఔ', ml: 'ഔ', kn: 'ಔ', hi: 'औ', en: 'au' },

  // ─── Tamil vowel signs (matras) used in combined consonant-vowel forms ────
  // These map standalone matra codepoints to vowel phonemes.
  { phoneme: 'aa_m', ta: 'ா',  te: 'ా',  ml: 'ാ',  kn: 'ಾ',  hi: 'ा',  en: 'aa' },
  { phoneme: 'ii_m', ta: 'ீ',  te: 'ీ',  ml: 'ീ',  kn: 'ೀ',  hi: 'ी',  en: 'ii' },
  { phoneme: 'i_m',  ta: 'ி',  te: 'ి',  ml: 'ി',  kn: 'ಿ',  hi: 'ि',  en: 'i'  },
  { phoneme: 'uu_m', ta: 'ூ',  te: 'ూ',  ml: 'ൂ',  kn: 'ೂ',  hi: 'ू',  en: 'uu' },
  { phoneme: 'u_m',  ta: 'ு',  te: 'ు',  ml: 'ു',  kn: 'ು',  hi: 'ु',  en: 'u'  },
  { phoneme: 'ee_m', ta: 'ே',  te: 'ే',  ml: 'േ',  kn: 'ೇ',  hi: 'े',  en: 'ee' },
  { phoneme: 'e_m',  ta: 'ெ',  te: 'ె',  ml: 'െ',  kn: 'ೆ',  hi: 'े',  en: 'e'  },
  { phoneme: 'oo_m', ta: 'ோ',  te: 'ో',  ml: 'ോ',  kn: 'ೋ',  hi: 'ो',  en: 'oo' },
  { phoneme: 'o_m',  ta: 'ொ',  te: 'ొ',  ml: 'ൊ',  kn: 'ೊ',  hi: 'ो',  en: 'o'  },
  { phoneme: 'ai_m', ta: 'ை',  te: 'ై',  ml: 'ൈ',  kn: 'ೈ',  hi: 'ै',  en: 'ai' },
  { phoneme: 'au_m', ta: 'ௌ',  te: 'ౌ',  ml: 'ൌ',  kn: 'ೌ',  hi: 'ौ',  en: 'au' },

  // ─── Pulli / Virama (consonant stopper — no following vowel) ─────────────
  { phoneme: 'virama', ta: '்', te: '్', ml: '്', kn: '್', hi: '्', en: '' },

  // ─── Anusvara / Chandrabindu (nasal final) ────────────────────────────────
  { phoneme: 'anusvara', ta: 'ம்', te: 'ం', ml: 'ം', kn: 'ಂ', hi: 'ं', en: 'm' },

  // Tamil aytham
  { phoneme: 'aytham', ta: 'ஃ', te: 'ః', ml: 'ഃ', kn: 'ಃ', hi: 'ः', en: 'h' },

  // ─── Consonants ───────────────────────────────────────────────────────────
  // Each consonant here represents the BASE form (without any following vowel
  // — the inherent-vowel form is the consonant + 'a' phoneme in most scripts,
  // but Tamil uses the base consonant + pulli for the pure consonant sound).

  // Velars
  { phoneme: 'k',   ta: 'க', te: 'క', ml: 'ക', kn: 'ಕ', hi: 'क', en: 'k'  },
  { phoneme: 'ng',  ta: 'ங', te: 'ఙ', ml: 'ങ', kn: 'ಙ', hi: 'ङ', en: 'ng' },
  // Palatals
  { phoneme: 'ch',  ta: 'ச', te: 'చ', ml: 'ച', kn: 'ಚ', hi: 'च', en: 'ch' },
  { phoneme: 'ny',  ta: 'ஞ', te: 'ఞ', ml: 'ഞ', kn: 'ಞ', hi: 'ञ', en: 'ny' },
  { phoneme: 'j',   ta: 'ஜ', te: 'జ', ml: 'ജ', kn: 'ಜ', hi: 'ज', en: 'j'  },
  { phoneme: 'sh',  ta: 'ஷ', te: 'ష', ml: 'ഷ', kn: 'ಷ', hi: 'ष', en: 'sh' },
  // Retroflexes
  { phoneme: 'T',   ta: 'ட', te: 'డ', ml: 'ട', kn: 'ಡ', hi: 'ड', en: 'T'  },
  { phoneme: 'N',   ta: 'ண', te: 'ణ', ml: 'ണ', kn: 'ಣ', hi: 'ण', en: 'N'  },
  { phoneme: 'zh',  ta: 'ழ', te: 'ళ', ml: 'ഴ', kn: 'ಳ', hi: 'ळ', en: 'zh' },
  { phoneme: 'L',   ta: 'ள', te: 'ళ', ml: 'ള', kn: 'ಳ', hi: 'ळ', en: 'L'  },
  { phoneme: 'R',   ta: 'ற', te: 'ర', ml: 'റ', kn: 'ರ', hi: 'र', en: 'R'  },
  // Dentals
  { phoneme: 't',   ta: 'த', te: 'త', ml: 'ത', kn: 'ತ', hi: 'त', en: 't'  },
  { phoneme: 'th',  ta: 'த', te: 'థ', ml: 'ഥ', kn: 'ಥ', hi: 'थ', en: 'th' },
  { phoneme: 'n',   ta: 'ன', te: 'న', ml: 'ന', kn: 'ನ', hi: 'न', en: 'n'  },
  { phoneme: 'nN',  ta: 'ந', te: 'న', ml: 'ന', kn: 'ನ', hi: 'न', en: 'n'  },
  // Labials
  { phoneme: 'p',   ta: 'ப', te: 'ప', ml: 'പ', kn: 'ಪ', hi: 'प', en: 'p'  },
  { phoneme: 'm',   ta: 'ம', te: 'మ', ml: 'മ', kn: 'ಮ', hi: 'म', en: 'm'  },
  // Approximants
  { phoneme: 'y',   ta: 'ய', te: 'య', ml: 'യ', kn: 'ಯ', hi: 'य', en: 'y'  },
  { phoneme: 'r',   ta: 'ர', te: 'ర', ml: 'ര', kn: 'ರ', hi: 'र', en: 'r'  },
  { phoneme: 'l',   ta: 'ல', te: 'ల', ml: 'ല', kn: 'ಲ', hi: 'ल', en: 'l'  },
  { phoneme: 'v',   ta: 'வ', te: 'వ', ml: 'വ', kn: 'ವ', hi: 'व', en: 'v'  },
  // Sibilants
  { phoneme: 's',   ta: 'ஸ', te: 'స', ml: 'സ', kn: 'ಸ', hi: 'स', en: 's'  },
  { phoneme: 'h',   ta: 'ஹ', te: 'హ', ml: 'ഹ', kn: 'ಹ', hi: 'ह', en: 'h'  },

  // ─── Hindi-specific consonants (Devanagari) ───────────────────────────────
  { phoneme: 'kh',  ta: 'க', te: 'ఖ', ml: 'ഖ', kn: 'ಖ', hi: 'ख', en: 'kh' },
  { phoneme: 'g',   ta: 'க', te: 'గ', ml: 'ഗ', kn: 'ಗ', hi: 'ग', en: 'g'  },
  { phoneme: 'gh',  ta: 'க', te: 'ఘ', ml: 'ഘ', kn: 'ಘ', hi: 'घ', en: 'gh' },
  { phoneme: 'chh', ta: 'ச', te: 'ఛ', ml: 'ഛ', kn: 'ಛ', hi: 'छ', en: 'chh'},
  { phoneme: 'jh',  ta: 'ஜ', te: 'ఝ', ml: 'ഝ', kn: 'ಝ', hi: 'झ', en: 'jh' },
  { phoneme: 'Th',  ta: 'ட', te: 'ఠ', ml: 'ഠ', kn: 'ಠ', hi: 'ठ', en: 'Th' },
  { phoneme: 'Dh',  ta: 'ட', te: 'ఢ', ml: 'ഢ', kn: 'ಢ', hi: 'ढ', en: 'Dh' },
  { phoneme: 'D',   ta: 'ட', te: 'డ', ml: 'ഡ', kn: 'ಡ', hi: 'ड', en: 'D'  },
  { phoneme: 'dh',  ta: 'த', te: 'ధ', ml: 'ധ', kn: 'ಧ', hi: 'ध', en: 'dh' },
  { phoneme: 'd',   ta: 'த', te: 'ద', ml: 'ദ', kn: 'ದ', hi: 'द', en: 'd'  },
  { phoneme: 'ph',  ta: 'ப', te: 'ఫ', ml: 'ഫ', kn: 'ಫ', hi: 'फ', en: 'ph' },
  { phoneme: 'b',   ta: 'ப', te: 'బ', ml: 'ബ', kn: 'ಬ', hi: 'ब', en: 'b'  },
  { phoneme: 'bh',  ta: 'ப', te: 'భ', ml: 'ഭ', kn: 'ಭ', hi: 'भ', en: 'bh' },
]

/**
 * Build character-to-phoneme lookup maps for each language.
 * Longer sequences are tried first (greedy matching).
 */
function buildSourceMaps(): Map<SupportedLang, Array<[string, string]>> {
  const maps = new Map<SupportedLang, Array<[string, string]>>()
  const langs: SupportedLang[] = ['ta', 'te', 'ml', 'kn', 'hi', 'en']

  for (const lang of langs) {
    const entries: Array<[string, string]> = []
    for (const entry of PIVOT_TABLE) {
      const ch = entry[lang]
      if (ch !== undefined && ch !== '') {
        entries.push([ch, entry.phoneme])
      }
    }
    // Sort by descending length so greedy matching tries longer sequences first.
    entries.sort((a, b) => b[0].length - a[0].length)
    maps.set(lang, entries)
  }
  return maps
}

/**
 * Build phoneme-to-target-char lookup maps for each language.
 */
function buildTargetMaps(): Map<SupportedLang, Map<string, string>> {
  const maps = new Map<SupportedLang, Map<string, string>>()
  const langs: SupportedLang[] = ['ta', 'te', 'ml', 'kn', 'hi', 'en']

  for (const lang of langs) {
    const m = new Map<string, string>()
    for (const entry of PIVOT_TABLE) {
      const ch = entry[lang]
      if (ch !== undefined) {
        // Skip matra phonemes in target maps — they should not appear standalone
        // in non-source contexts; only used when tokenizing source scripts.
        if (!entry.phoneme.endsWith('_m') && entry.phoneme !== 'virama') {
          if (!m.has(entry.phoneme)) m.set(entry.phoneme, ch)
        }
      }
    }
    maps.set(lang, m)
  }
  return maps
}

// Pre-build maps once at module load time (pure, no side-effects).
const SOURCE_MAPS = buildSourceMaps()
const TARGET_MAPS = buildTargetMaps()

/**
 * Tokenize `text` for `sourceLang`. Returns an array of tokens where each
 * element is either:
 *   - a matched phoneme string (to be mapped to the target script), or
 *   - a literal passthrough string (whitespace, punctuation, or unknown chars)
 *     prefixed with '\x00' to distinguish it from a phoneme.
 */
function tokenize(text: string, sourceLang: SupportedLang): string[] {
  const entries = SOURCE_MAPS.get(sourceLang) ?? []
  const tokens: string[] = []
  let i = 0

  while (i < text.length) {
    // Try to match a script character sequence starting at i.
    let matched = false
    for (const [seq, phoneme] of entries) {
      if (text.startsWith(seq, i)) {
        tokens.push(phoneme)
        i += seq.length
        matched = true
        break
      }
    }

    if (!matched) {
      // Unknown char — pass through unchanged (whitespace, punctuation, etc.)
      tokens.push('\x00' + text[i])
      i += 1
    }
  }

  return tokens
}

/**
 * Convert a token stream to the target language string.
 * Passthrough tokens (prefixed '\x00') are emitted as-is.
 * Matra phonemes (ending '_m') map to vowel phoneme for the target.
 */
function renderTokens(tokens: string[], targetLang: SupportedLang): string {
  const targetMap = TARGET_MAPS.get(targetLang) ?? new Map<string, string>()
  const parts: string[] = []

  for (const token of tokens) {
    if (token.startsWith('\x00')) {
      // Passthrough: emit the raw character(s) after the sentinel prefix.
      parts.push(token.slice(1))
    } else {
      // Phoneme: strip matra suffix for lookup — _m variants map to the
      // same vowel phoneme in the target (we just need the base vowel char).
      const lookupKey = token.endsWith('_m') ? token.slice(0, -2) : token

      // 'virama' should be suppressed in English (already '' in target map);
      // for other scripts emit the target virama character if available.
      const targetChar = targetMap.get(lookupKey)
      if (targetChar !== undefined) {
        parts.push(targetChar)
      } else {
        // Phoneme not in target map — try the raw phoneme string as a best
        // effort passthrough (e.g. English digraphs that have no Indic form).
        parts.push(lookupKey)
      }
    }
  }

  return parts.join('')
}

/**
 * Transliterate text from sourceLang to targetLang using the phonetic pivot.
 * Whitespace and punctuation are preserved unchanged.
 */
function transliterateText(
  text: string,
  sourceLang: SupportedLang,
  targetLang: SupportedLang
): string {
  if (sourceLang === targetLang) return text
  const tokens = tokenize(text, sourceLang)
  return renderTokens(tokens, targetLang)
}

/** The module-level singleton provider. */
let _provider: TransliterationProvider | null = null

/**
 * Build the local pivot-based transliteration provider.
 * All work is synchronous; the async wrapper is for API consistency with
 * cloud providers that may need network calls.
 */
export function createLocalTransliterationProvider(): TransliterationProvider {
  return {
    async transliterate(
      text: string,
      sourceLang: SupportedLang,
      targetLang: SupportedLang
    ): Promise<string> {
      return transliterateText(text, sourceLang, targetLang)
    }
  }
}

/** Get the active transliteration provider (lazy-initializes with local default). */
export function getTransliterationProvider(): TransliterationProvider {
  if (_provider === null) {
    _provider = createLocalTransliterationProvider()
  }
  return _provider
}

/** Replace the active provider (for testing or cloud integration). */
export function setTransliterationProvider(p: TransliterationProvider): void {
  _provider = p
}

/**
 * Exported for use by romanizedInput.ts — the raw synchronous transliterator
 * that does not go through the async provider interface.
 */
export { transliterateText as transliterateSync }

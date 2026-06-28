import Sanscript from '@indic-transliteration/sanscript';
import { LanguageCode } from '../../types/styler';
import { exceptionTrie } from './tamilExceptions';

// =============================================================================
// SCHEME SETUP
// =============================================================================
// We register a custom "tamil_reverse" scheme optimized for Tamil → ITRANS/other
// reverse mapping. The stock Tamil scheme has many-to-one consonant mappings
// (e.g., क,ख,ग,घ all → க), so when reversing Tamil → ITRANS, Sanscript picks
// the LAST Devanagari entry (the voiced/aspirated form), producing wrong output
// like "gha" instead of "ka". Our custom scheme keeps only the unvoiced entry
// per Tamil character for clean reverse lookup.
//
// For FORWARD mapping (ITRANS/other → Tamil), we use the stock "tamil" scheme
// which correctly collapses all voiced/aspirated variants into Tamil's limited set.
// =============================================================================

const tamilReverseScheme = JSON.parse(JSON.stringify(Sanscript.schemes.tamil));
tamilReverseScheme.consonants = {
  // Velars
  'क': 'க',
  'ङ': 'ங',
  // Palatals
  'च': 'ச',
  'ज': 'ஜ',
  'ञ': 'ஞ',
  // Retroflexes
  'ट': 'ட',
  'ण': 'ண',
  // Dentals
  'त': 'த',
  'न': 'ந',
  // Labials
  'प': 'ப',
  'म': 'ம',
  // Semivowels
  'य': 'ய',
  'र': 'ர',
  'ल': 'ல',
  'व': 'வ',
  // Sibilants & aspirate
  'श': 'ஶ',
  'ष': 'ஷ',
  'स': 'ஸ',
  'ह': 'ஹ',
  // Tamil-specific retroflex/alveolar
  'ळ': 'ள',
  'क्ष': 'க்ஷ',
  'ज्ञ': 'ஜ்ஞ',
  'ऱ': 'ற', // alveolar r (ற)
  'ऴ': 'ழ', // retroflex approximant (ழ)
  'ऩ': 'ன', // alveolar n (ன)
};
Sanscript.addBrahmicScheme('tamil_reverse', tamilReverseScheme);

/**
 * Maps LanguageCode to Sanscript schema names.
 * For Tamil source (reverse direction), we use 'tamil_reverse'.
 * For Tamil target (forward direction), we use stock 'tamil'.
 */
const SANSCRIPT_SOURCE_MAP: Record<LanguageCode, string> = {
  ta: 'tamil_reverse',
  te: 'telugu',
  ml: 'malayalam',
  hi: 'devanagari',
  en: 'itrans',
};

const SANSCRIPT_TARGET_MAP: Record<LanguageCode, string> = {
  ta: 'tamil',       // Stock scheme for forward mapping
  te: 'telugu',
  ml: 'malayalam',
  hi: 'devanagari',
  en: 'itrans',
};

/**
 * Detects the language of a given text block based on Unicode character ranges.
 * Returns the first matching Indic script, or 'en' for ASCII text.
 */
export function detectIndicLanguage(text: string): LanguageCode | null {
  if (!text) return null;

  const tamilRegex = /[\u0B80-\u0BFF]/;
  const devanagariRegex = /[\u0900-\u097F]/;
  const teluguRegex = /[\u0C00-\u0C7F]/;
  const malayalamRegex = /[\u0D00-\u0D7F]/;

  if (tamilRegex.test(text)) return 'ta';
  if (devanagariRegex.test(text)) return 'hi';
  if (teluguRegex.test(text)) return 'te';
  if (malayalamRegex.test(text)) return 'ml';
  if (/[a-zA-Z]/.test(text)) return 'en';

  return null;
}

// =============================================================================
// TAMIL PHONOLOGICAL VOICING (English output only)
// =============================================================================
// Tamil script has no voiced/aspirated distinction, but spoken Tamil applies
// phonological voicing rules contextually. These rules are ONLY applied when
// the target output is English (Tanglish), NOT for other Indic scripts where
// we want faithful character-level transliteration.
// =============================================================================

function applyTamilVoicing(itrans: string): string {
  return itrans
    // Normalize any stray n2 from Sanscript
    .replace(/n2/g, 'n')

    // Nasal assimilations: nasal + stop → nasal + voiced stop
    .replace(/(~N)k/g, '$1g')       // ங்க → ng
    .replace(/(~n)ch/g, '$1j')      // ஞ்ச → nj
    .replace(/NT/g, 'ND')           // ண்ட → ND
    .replace(/nt/g, 'ndh')          // ந்த → ndh
    .replace(/mp/g, 'mb')           // ம்ப → mb
    .replace(/np/g, 'nb')           // ந்ப → nb (அன்பே → anbe)
    .replace(/nk/g, 'ng')           // ந்க → ng

    // Intervocalic voicing: stop between vowels → voiced
    .replace(/([AEIOUaeiou])k([AEIOUaeiou])/g, '$1g$2')
    .replace(/([AEIOUaeiou])ch([AEIOUaeiou])/g, '$1s$2')  // ச between vowels → s
    .replace(/([AEIOUaeiou])T([AEIOUaeiou])/g, '$1D$2')
    .replace(/([AEIOUaeiou])t([AEIOUaeiou])/g, '$1dh$2')
    .replace(/([AEIOUaeiou])p([AEIOUaeiou])/g, '$1b$2');
}

// =============================================================================
// ITRANS → TANGLISH FORMATTER
// =============================================================================

function itransToTanglish(itrans: string): string {
  return itrans
    // ITRANS vowels → English digraphs
    .replace(/U/g, 'oo')
    .replace(/A/g, 'aa')
    .replace(/I/g, 'ee')
    .replace(/è/g, 'e')
    .replace(/ò/g, 'o')
    .replace(/O/g, 'o')
    .replace(/E/g, 'e')

    // ITRANS consonants → English
    .replace(/tt/g, 'thth')
    .replace(/t(?!h)/g, 'th')
    .replace(/T/g, 't')
    .replace(/ch/g, 's')     // ச (ch in ITRANS) → s in Tanglish
    .replace(/sh/g, 's')

    // Strip ITRANS capitalization
    .toLowerCase()

    // Title Case each word
    .split('\n')
    .map(line =>
      line.split(' ')
        .map(word => {
          if (word.length === 0) return word;
          return word.charAt(0).toUpperCase() + word.slice(1);
        })
        .join(' ')
    )
    .join('\n')

    // Edge case fix
    .replace(/rku/g, 'tku');
}

// =============================================================================
// TANGLISH → ITRANS PREPROCESSOR (English → Indic)
// =============================================================================

function tanglishToItrans(text: string): string {
  // Tokenize the input by words and non-words to preserve spacing and punctuation
  const tokens = text.split(/([a-zA-Z]+)/);

  return tokens.map(token => {
    // If not a word (e.g. whitespace, punctuation), return as-is
    if (!/^[a-zA-Z]+$/.test(token)) return token;

    // Check Trie for high-frequency exceptions FIRST
    const exceptionMatch = exceptionTrie.search(token);
    if (exceptionMatch) {
      return exceptionMatch;
    }

    // Standard fallback processing
    return token.toLowerCase()
      // Vowel digraphs → ITRANS
      .replace(/oo/g, 'U')
      .replace(/ee/g, 'I')
      .replace(/aa/g, 'A')

      // Consonant clusters → ITRANS equivalents
      .replace(/thth/g, 'tt')
      .replace(/th/g, 't')
      .replace(/dh/g, 't')
      .replace(/ng/g, '~Nk')
      .replace(/nj/g, '~nch')
      .replace(/nd/g, 'NT')
      .replace(/nb/g, 'np')
      .replace(/mb/g, 'mp')
      .replace(/tku/g, 'Rku')
      .replace(/rku/g, 'Rku')
      .replace(/rr/g, 'RR')

      // Voiced → unvoiced (Tamil has no voiced consonants in script)
      .replace(/b/g, 'p')
      .replace(/g/g, 'k')
      .replace(/d/g, 'T')
      .replace(/j/g, 'ch')
      .replace(/sh/g, 'ch')
      .replace(/s/g, 'ch')
      .replace(/ch/g, 'ch');
  }).join('');
}

// =============================================================================
// TAMIL ORTHOGRAPHY POST-PROCESSOR
// =============================================================================
// When converting into Tamil, Sanscript maps ITRANS 'n' to ந (dental).
// But Tamil orthography requires ன (alveolar) in most mid-word/final positions.
// This post-processor fixes that using positional heuristics.
// =============================================================================

function fixTamilOrthography(tamil: string): string {
  return tamil
    // First fix ந் (with virama) at mid-word positions
    .replace(/ந்/g, (_: string, offset: number, str: string) => {
      // Word-initial (including ZWNJ \u200C): keep ந்
      if (offset === 0 || /[\s\n\u200C]/.test(str[offset - 1])) return 'ந்';
      // Before த: keep ந் (ந்த cluster is correct: vandha = வந்த)
      if (str[offset + 2] === 'த') return 'ந்';
      // Otherwise mid-word: use ன் (anbe = அன்பே, unnai = உன்னை)
      return 'ன்';
    })
    // Then fix standalone ந (without virama) at mid-word positions
    .replace(/ந(?!்)/g, (_: string, offset: number, str: string) => {
      // Word-initial (including ZWNJ \u200C): keep ந (nilai = நிலை)
      if (offset === 0 || /[\s\n\u200C]/.test(str[offset - 1])) return 'ந';
      // Mid-word: use ன (puvanam = புவனம்)
      return 'ன';
    });
}

function finalizeOutput(text: string): string {
  // Strip the ZWNJ marker used for compound word boundaries
  return text.replace(/\u200C/g, '');
}

// =============================================================================
// MAIN TRANSLITERATION FUNCTION
// =============================================================================

/**
 * Deterministically converts text between Indic scripts via offline algorithmic mapping.
 *
 * Architecture:
 * - Tamil → English: Tamil → ITRANS (reverse scheme) → voicing rules → Tanglish formatter
 * - Tamil → Indic:   Tamil → ITRANS (reverse scheme) → target script (NO voicing)
 * - English → Tamil:  Tanglish → ITRANS → Tamil (stock scheme) → orthography fix
 * - English → Indic:  Tanglish → ITRANS → target script
 * - Indic → Indic:    Direct Sanscript Brahmic mapping
 * - Indic → Tamil:    Direct mapping → orthography fix
 * - Indic → English:  Source → ITRANS → English formatting
 */
export function transliterateIndic(
  text: string,
  sourceLang: LanguageCode,
  targetLang: LanguageCode
): string {
  if (!text || text.trim() === '') return '';
  if (sourceLang === targetLang) return text;

  try {
    // =========================================================================
    // PATH 1: Tamil source
    // =========================================================================
    if (sourceLang === 'ta') {
      // Pre-map ன (alveolar n) → ந (dental n) because ன has no direct
      // Devanagari/ITRANS equivalent and would be passed through as-is.
      const textToProcess = text.replace(/ன/g, 'ந');

      // Convert to ITRANS using the reverse scheme (unvoiced consonants)
      const itrans = Sanscript.t(textToProcess, 'tamil_reverse', 'itrans');

      if (targetLang === 'en') {
        // Apply voicing rules, then format as Tanglish
        const phonetized = applyTamilVoicing(itrans);
        return finalizeOutput(itransToTanglish(phonetized));
      } else {
        // For other Indic scripts: convert raw ITRANS directly (NO voicing).
        // This preserves the original Tamil orthographic structure faithfully.
        return finalizeOutput(Sanscript.t(itrans, 'itrans', SANSCRIPT_TARGET_MAP[targetLang]));
      }
    }

    // =========================================================================
    // PATH 2: English source
    // =========================================================================
    if (sourceLang === 'en') {
      const itrans = tanglishToItrans(text);

      if (targetLang === 'ta') {
        // Use stock Tamil scheme for forward mapping, then fix orthography
        let tamil = Sanscript.t(itrans, 'itrans', 'tamil');
        return finalizeOutput(fixTamilOrthography(tamil));
      } else {
        // For other Indic scripts: ITRANS → target directly
        return finalizeOutput(Sanscript.t(itrans, 'itrans', SANSCRIPT_TARGET_MAP[targetLang]));
      }
    }

    // =========================================================================
    // PATH 3: Indic → Indic (non-Tamil, non-English source)
    // =========================================================================
    const sourceSchema = SANSCRIPT_SOURCE_MAP[sourceLang];
    const targetSchema = SANSCRIPT_TARGET_MAP[targetLang];

    if (targetLang === 'en') {
      // Convert to ITRANS, then format as English
      const itrans = Sanscript.t(text, sourceSchema, 'itrans');
      return finalizeOutput(itransToTanglish(itrans));
    }

    if (targetLang === 'ta') {
      // Direct Brahmic mapping → fix Tamil orthography
      let tamil = Sanscript.t(text, sourceSchema, targetSchema);
      return finalizeOutput(fixTamilOrthography(tamil));
    }

    // Direct Brahmic mapping for other pairs (Hindi↔Telugu↔Malayalam)
    return finalizeOutput(Sanscript.t(text, sourceSchema, targetSchema));

  } catch (error) {
    console.error(`[Transliteration Error] Failed: ${sourceLang} → ${targetLang}`, error);
    return text;
  }
}

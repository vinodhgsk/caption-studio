import { FontConfiguration, LanguageCode } from '../../types/styler';

// ---------------------------------------------------------------------------
// DevotionalFontEntry — extends FontConfiguration with Google Fonts weight
// data and a human-readable label shown in the panel dropdown.
// ---------------------------------------------------------------------------
export interface DevotionalFontEntry extends FontConfiguration {
  /** Label shown in the UI dropdown */
  label: string;
  /** Aesthetic description shown as a subtitle in the panel */
  aesthetic: string;
  /** Google Fonts API weight string used when constructing the URL */
  weights: string;
  /** Encoding type of the font (default is unicode) */
  encoding?: 'unicode' | 'bamini' | 'tab' | 'tam';
}

// ---------------------------------------------------------------------------
// DEVOTIONAL_FONTS
// Each language maps to an ordered list of font options, most recommended
// first. All fonts are hosted on Google Fonts and loaded at runtime.
// ---------------------------------------------------------------------------
export const DEVOTIONAL_FONTS: Record<LanguageCode, DevotionalFontEntry[]> = {

  // ── Tamil ─────────────────────────────────────────────────────────────────
  ta: [
    {
      family: 'Kavivanar',
      displayName: 'Kavivanar',
      label: 'Kavivanar',
      aesthetic: 'Display Calligraphy / Slanted Script',
      category: 'calligraphic',
      source: 'google',
      weights: '400',
      url: 'https://fonts.googleapis.com/css2?family=Kavivanar&display=swap',
    },
    {
      family: 'Arima Madurai',
      displayName: 'Arima Madurai',
      label: 'Arima Madurai',
      aesthetic: 'Elegant, Rounded Display',
      category: 'traditional',
      source: 'google',
      weights: '400;700',
      url: 'https://fonts.googleapis.com/css2?family=Arima+Madurai:wght@400;700&display=swap',
    },
    {
      family: 'Tiro Tamil',
      displayName: 'Tiro Tamil',
      label: 'Tiro Tamil',
      aesthetic: 'Classical Palm-Leaf Manuscript Style',
      category: 'serif',
      source: 'google',
      weights: '400',
      url: 'https://fonts.googleapis.com/css2?family=Tiro+Tamil&display=swap',
    },
    {
      family: 'Anek Tamil',
      displayName: 'Anek Tamil',
      label: 'Anek Tamil',
      aesthetic: 'Expanded/Condensed Cinematic Title Weight',
      category: 'traditional',
      source: 'google',
      weights: '400;700;800',
      url: 'https://fonts.googleapis.com/css2?family=Anek+Tamil:wght@400;700;800&display=swap',
    },
    {
      family: 'SaiIndira',
      displayName: 'SaiIndira',
      label: 'SaiIndira',
      aesthetic: 'Classic Traditional Broadcast Font',
      category: 'calligraphic',
      source: 'local',
      weights: '400;700',
      encoding: 'bamini',
    },
    {
      family: 'Kamban',
      displayName: 'Kamban',
      label: 'Kamban',
      aesthetic: 'Epic Cinematic Sweeping Script',
      category: 'calligraphic',
      source: 'local',
      weights: '400;700',
      encoding: 'bamini',
    },
    {
      family: 'Valluvan',
      displayName: 'Valluvan',
      label: 'Valluvan',
      aesthetic: 'Bold Temple Architecture Script',
      category: 'calligraphic',
      source: 'local',
      weights: '400;700',
      encoding: 'bamini',
    },
  ],

  // ── Telugu ────────────────────────────────────────────────────────────────
  te: [
    {
      family: 'Ramabhadra',
      displayName: 'Ramabhadra',
      label: 'Ramabhadra',
      aesthetic: 'Bold Traditional',
      category: 'traditional',
      source: 'google',
      weights: '400',
      url: 'https://fonts.googleapis.com/css2?family=Ramabhadra&display=swap',
    },
    {
      family: 'Suranna',
      displayName: 'Suranna',
      label: 'Suranna',
      aesthetic: 'Classic Script',
      category: 'calligraphic',
      source: 'google',
      weights: '400',
      url: 'https://fonts.googleapis.com/css2?family=Suranna&display=swap',
    },
    {
      family: 'NTR',
      displayName: 'NTR',
      label: 'NTR',
      aesthetic: 'Elegant Extended',
      category: 'serif',
      source: 'google',
      weights: '400',
      url: 'https://fonts.googleapis.com/css2?family=NTR&display=swap',
    },
  ],

  // ── Malayalam ─────────────────────────────────────────────────────────────
  ml: [
    {
      family: 'Manjari',
      displayName: 'Manjari',
      label: 'Manjari',
      aesthetic: 'Flowing Script',
      category: 'calligraphic',
      source: 'google',
      weights: '400;700',
      url: 'https://fonts.googleapis.com/css2?family=Manjari:wght@400;700&display=swap',
    },
    {
      family: 'Gayathri',
      displayName: 'Gayathri',
      label: 'Gayathri',
      aesthetic: 'Devotional Display',
      category: 'traditional',
      source: 'google',
      weights: '400;700',
      url: 'https://fonts.googleapis.com/css2?family=Gayathri:wght@400;700&display=swap',
    },
    {
      family: 'Chilanka',
      displayName: 'Chilanka',
      label: 'Chilanka',
      aesthetic: 'Calligraphic Hand',
      category: 'calligraphic',
      source: 'google',
      weights: '400',
      url: 'https://fonts.googleapis.com/css2?family=Chilanka&display=swap',
    },
  ],

  // ── Hindi / Devanagari ────────────────────────────────────────────────────
  hi: [
    {
      family: 'Yatra One',
      displayName: 'Yatra One',
      label: 'Yatra One',
      aesthetic: 'Temple Hand-carved Script',
      category: 'calligraphic',
      source: 'google',
      weights: '400',
      url: 'https://fonts.googleapis.com/css2?family=Yatra+One&display=swap',
    },
    {
      family: 'Rozha One',
      displayName: 'Rozha One',
      label: 'Rozha One',
      aesthetic: 'Heavy High-Contrast Display',
      category: 'serif',
      source: 'google',
      weights: '400',
      url: 'https://fonts.googleapis.com/css2?family=Rozha+One&display=swap',
    },
    {
      family: 'Federo',
      displayName: 'Federo',
      label: 'Federo',
      aesthetic: 'Stylized',
      category: 'serif',
      source: 'google',
      weights: '400',
      url: 'https://fonts.googleapis.com/css2?family=Federo&display=swap',
    },
  ],

  // ── English ───────────────────────────────────────────────────────────────
  en: [
    {
      family: 'Cinzel Decorative',
      displayName: 'Cinzel Decorative',
      label: 'Cinzel Decorative',
      aesthetic: 'Epic Roman Serif',
      category: 'calligraphic',
      source: 'google',
      weights: '400;700',
      url: 'https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@400;700&display=swap',
    },
    {
      family: 'Great Vibes',
      displayName: 'Great Vibes',
      label: 'Great Vibes',
      aesthetic: 'Classic Calligraphy',
      category: 'calligraphic',
      source: 'google',
      weights: '400',
      url: 'https://fonts.googleapis.com/css2?family=Great+Vibes&display=swap',
    },
    {
      family: 'Pinyon Script',
      displayName: 'Pinyon Script',
      label: 'Pinyon Script',
      aesthetic: 'High Gloss Elegant Cursive',
      category: 'calligraphic',
      source: 'google',
      weights: '400',
      url: 'https://fonts.googleapis.com/css2?family=Pinyon+Script&display=swap',
    },
  ],
};

// ---------------------------------------------------------------------------
// COMBINED_GOOGLE_FONTS_URL
// A single composite URL to bulk-preload all Google Fonts in one HTTP request.
// ---------------------------------------------------------------------------
export const COMBINED_GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?' +
  // Tamil
  'family=Kavivanar&' +
  'family=Arima+Madurai:wght@400;700&' +
  'family=Tiro+Tamil&' +
  'family=Anek+Tamil:wght@400;700;800&' +
  // Telugu
  'family=Ramabhadra&' +
  'family=Suranna&' +
  'family=NTR&' +
  // Malayalam
  'family=Manjari:wght@400;700&' +
  'family=Gayathri:wght@400;700&' +
  'family=Chilanka&' +
  // Hindi / Devanagari
  'family=Yatra+One&' +
  'family=Rozha+One&' +
  'family=Federo&' +
  // English
  'family=Cinzel+Decorative:wght@400;700&' +
  'family=Great+Vibes&' +
  'family=Pinyon+Script&' +
  // Display optimization
  'display=swap';

// ---------------------------------------------------------------------------
// loadFont()
// Runtime WebFont caching utility. Injects a <link> stylesheet for the given
// font URL if not already present, then calls document.fonts.load() to prime
// the browser glyph cache before any canvas draw operations begin.
//
// Usage:
//   await loadFont(fontEntry);
//   // At this point the font is guaranteed to be in the browser glyph cache
//   store.setTextStyle({ fontFamily: fontEntry.family });
// ---------------------------------------------------------------------------
export async function loadFont(font: DevotionalFontEntry): Promise<void> {
  if (!font.url) return;

  // Inject a <link> stylesheet only once per font URL
  const linkId = `gf-${font.family.replace(/\s+/g, '-').toLowerCase()}`;
  if (!document.getElementById(linkId)) {
    const link = document.createElement('link');
    link.id = linkId;
    link.rel = 'stylesheet';
    link.href = font.url;
    document.head.appendChild(link);
  }

  // Give the stylesheet a brief moment to begin parsing before probing
  await new Promise<void>((resolve) => setTimeout(resolve, 80));

  // Probe the font at a representative size that covers ligature shaping
  // for complex Indic scripts — 120px is large enough to trigger subsetting.
  const probeString = font.family.includes('Script') || font.category === 'calligraphic'
    ? 'அ க ண ப ம' // Indic ligature probe glyphs
    : 'A B C';

  try {
    await document.fonts.load(`700 120px '${font.family}'`, probeString);
    // Fallback: also load regular weight to cover all canvas draw calls
    await document.fonts.load(`400 120px '${font.family}'`, probeString);
  } catch (err) {
    // Non-fatal: font may still render; log and continue.
    console.warn(`[FontLoader] Could not confirm load for "${font.family}":`, err);
  }
}

// ---------------------------------------------------------------------------
// getDefaultFont()
// Returns the first (highest-priority) font for a given language code.
// ---------------------------------------------------------------------------
export function getDefaultFont(language: LanguageCode): DevotionalFontEntry {
  return DEVOTIONAL_FONTS[language][0];
}

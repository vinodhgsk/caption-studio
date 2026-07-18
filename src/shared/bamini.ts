import { applyMapping, regExpList } from 'tamil-language-tools-and-assets'

/**
 * List of known Bamini-encoded legacy Tamil font families.
 * These fonts do not contain Unicode Tamil glyphs; they map English keyboard
 * characters to Tamil shapes. Modern Unicode Tamil must be transliterated
 * into the Bamini layout before rendering.
 */
const BAMINI_FONTS = new Set([
  'Ka Kalvettu',
  'Ka Dhool',
  'Ka Thiramai',
  'JF Nathiya',
  'JF Kamala',
  'Ka Sangeetham',
  'BAMINI-Tamil01',
  'BAMINI-Tamil22',
  'BAMINI-Tamil24',
  'BAMINI-Tamil30',
  'BAMINI-Tamil51'
])

/**
 * Check if the given font family is a known Bamini-encoded legacy font.
 */
export function isBaminiFont(family: string): boolean {
  return BAMINI_FONTS.has(family)
}

/**
 * Convert Unicode Tamil text to the Bamini layout string.
 * Non-Tamil characters (like spaces or punctuation) are preserved.
 *
 * NOTE: The `tamil-language-tools-and-assets` package exposes `regExpList.UniBamini`
 * for Unicode -> Bamini conversion.
 */
export function toBamini(text: string): string {
  try {
    return applyMapping(text, regExpList.UniBamini)
  } catch (e) {
    console.error('Failed to convert to Bamini:', e)
    return text // fallback to original
  }
}

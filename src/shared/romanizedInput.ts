/**
 * Romanized input helper (P10R.3, Doc 16) — convert Latin romanized text to
 * an Indic script using the transliteration engine.
 *
 * This is the "de-Romanization" direction (en → targetLang) that powers
 * Romanized typing → Indic script input in the editor.
 *
 * Pure functions only — NO DOM, NO Date, NO external calls.
 */

import type { SupportedLang } from './transliteration'
import { transliterateSync } from './transliteration'

/**
 * Convert a Latin romanized string to the target Indic script using the
 * transliteration engine (en → targetLang).
 * Synchronous convenience wrapper — converts the full string using the pivot table.
 */
export function romanizedToIndic(
  latin: string,
  targetLang: Exclude<SupportedLang, 'en'>
): string {
  return transliterateSync(latin, 'en', targetLang)
}

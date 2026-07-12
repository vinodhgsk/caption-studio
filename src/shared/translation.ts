/**
 * Translation shared contract — the headless interface for the pluggable
 * translation provider (P10.5–P10.6, Doc 12).
 *
 * Pure TYPES ONLY. NO electron / node / DOM imports leak here so the renderer,
 * preload, and main-process provider registry can all import this module without
 * rework.
 */

import type { TTSLanguageCode } from './tts'

/**
 * The pluggable translation provider interface (P10.5). A provider translates
 * a block of text into the given target language. The real cloud translation
 * provider (e.g. Google Translate, DeepL) drops in here behind this interface.
 */
export interface TranslationProvider {
  /**
   * Translate `text` into `targetLang`. Returns the translated string.
   * Throws on failure (the IPC wrapper converts to `{ok:false,error}`).
   */
  translate(text: string, targetLang: TTSLanguageCode): Promise<string>
}

/**
 * Translation metadata stamped on `captions.translation` in project.json after
 * a successful translate action (P10.6).
 */
export interface CaptionTranslation {
  /** Target language code the captions were translated to. */
  target: TTSLanguageCode
  /** How the translation is displayed: `'inline'` = below original line. */
  mode: 'inline'
}

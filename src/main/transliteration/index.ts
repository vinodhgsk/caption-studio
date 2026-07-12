/**
 * Transliteration IPC entry point (P10R.1, Doc 16) — registers the
 * `transliteration:transliterate` IPC handler.
 *
 * Validates that source and target languages are in the supported set;
 * returns a pass-through result (original text) for invalid inputs rather
 * than throwing, so the renderer always gets a usable string back.
 *
 * The local pivot-based provider runs here in MAIN so that a future cloud
 * provider can make network requests without blocking the renderer. No
 * text bytes are subject to the IPC size constraints used for media.
 */

import { handle } from '../ipc'
import {
  SUPPORTED_LANGS,
  getTransliterationProvider
} from '../../shared/transliteration'
import type { SupportedLang } from '../../shared/transliteration'

/** Register the `transliteration:transliterate` IPC handler. */
export function registerTransliterationIpc(): void {
  handle('transliteration:transliterate', async (request) => {
    const { text, sourceLang, targetLang } = request

    // Validate both lang codes against the supported set.
    const validLangs: ReadonlyArray<string> = SUPPORTED_LANGS
    if (!validLangs.includes(sourceLang) || !validLangs.includes(targetLang)) {
      // Graceful degradation: return original text unchanged.
      return { result: text }
    }

    try {
      const provider = getTransliterationProvider()
      const result = await provider.transliterate(
        text,
        sourceLang as SupportedLang,
        targetLang as SupportedLang
      )
      return { result }
    } catch {
      // Graceful degradation: return original text if the provider throws.
      return { result: text }
    }
  })
}

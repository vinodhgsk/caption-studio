/**
 * Translation entry point (P10.5–P10.6, Doc 12) — registers the
 * `translation:` IPC domain.
 *
 * The ONLY translation module allowed to import electron (via the shared
 * `handle()` wrapper). The handler delegates to the active provider from the
 * registry. Providers stay pure behind the registry; a real translation engine
 * drops in with no caller change.
 *
 * Graceful disabled state: if no provider is registered or translate throws,
 * the IPC wrapper converts the throw to `{ok:false,error}` so the renderer
 * shows a disabled/error state without crashing.
 */
import { handle } from '../ipc'
import { getTranslationProvider } from './registry'
import type { TTSLanguageCode } from '../../shared/tts'
import { TTS_LANGUAGES } from '../../shared/tts'

/** Register the `translation:translate` handler. */
export function registerTranslationIpc(): void {
  handle('translation:translate', async (request) => {
    const provider = getTranslationProvider()

    // Validate targetLang is one of the six supported codes; fallback to 'ta'.
    const targetLang: TTSLanguageCode = (TTS_LANGUAGES as readonly string[]).includes(request.targetLang)
      ? (request.targetLang as TTSLanguageCode)
      : 'ta'

    const translated = await Promise.all(
      request.lines.map((line) => provider.translate(line, targetLang))
    )

    return { translated }
  })
}

/**
 * Stub translation provider (P10.5, Doc 12). A deterministic placeholder that
 * satisfies the {@link TranslationProvider} contract for testing.
 *
 * Returns `[${targetLang}] ${text}` — the identity translation prefixed with
 * the target language code so tests can verify the provider was called.
 *
 * NO electron / node imports — kept pure so it is trivially unit-testable.
 */
import type { TranslationProvider } from '../../shared/translation'
import type { TTSLanguageCode } from '../../shared/tts'

export class StubTranslationProvider implements TranslationProvider {
  readonly id = 'stub'

  async translate(text: string, targetLang: TTSLanguageCode): Promise<string> {
    return `[${targetLang}] ${text}`
  }
}

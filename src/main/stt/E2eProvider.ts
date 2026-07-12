/**
 * E2E-only STT provider (Playwright UI tests). A deterministic provider that
 * stands in for whisper.cpp during a headed end-to-end run so the auto-caption
 * flow produces REAL captions in the UI without a model on the host.
 *
 * It is INERT in production: it is registered alongside the built-ins but is only
 * ever resolved when explicitly selected via `CAPTION_STUDIO_STT_PROVIDER=e2e`
 * (the registry's existing precedence). It never reads the WAV or spawns anything.
 *
 * The transcript is read from `CAPTION_STUDIO_E2E_TRANSCRIPT` (a JSON
 * `{ language, words: [{ text, start, end }] }`) so a test can inject any known
 * script; absent/invalid env falls back to {@link DEFAULT_E2E_TRANSCRIPT}. A
 * pinned `opts.language` overrides the transcript's language like a real provider.
 *
 * NO electron / node-spawn imports — kept pure so it is trivially testable.
 */
import {
  DEFAULT_LANGUAGE,
  asLanguageCode,
  type SttProvider,
  type Transcript,
  type TranscribeOptions,
  type Word
} from '../../shared/stt'

/** The provider id selected via `CAPTION_STUDIO_STT_PROVIDER=e2e`. */
export const E2E_PROVIDER_ID = 'e2e'

/** Fallback known script when no transcript is injected via the env var. */
export const DEFAULT_E2E_TRANSCRIPT: Transcript = {
  language: 'en',
  words: [
    { text: 'Welcome', start: 0.5, end: 0.96 },
    { text: 'to', start: 1.0, end: 1.18 },
    { text: 'Caption', start: 1.2, end: 1.7 },
    { text: 'Studio.', start: 1.74, end: 2.3 },
    { text: 'Edit', start: 3.2, end: 3.5 },
    { text: 'videos', start: 3.55, end: 4.05 },
    { text: 'fast.', start: 4.1, end: 4.6 }
  ]
}

/** Parse + validate the injected transcript JSON, or null when absent/invalid. */
export function parseInjectedTranscript(raw: string | undefined): Transcript | null {
  if (raw === undefined || raw.length === 0) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const obj = parsed as { language?: unknown; words?: unknown }
    if (!Array.isArray(obj.words)) return null
    const words: Word[] = []
    for (const w of obj.words) {
      if (typeof w !== 'object' || w === null) return null
      const word = w as { text?: unknown; start?: unknown; end?: unknown }
      if (
        typeof word.text !== 'string' ||
        typeof word.start !== 'number' ||
        typeof word.end !== 'number'
      ) {
        return null
      }
      words.push({ text: word.text, start: word.start, end: word.end })
    }
    const language =
      typeof obj.language === 'string' ? (asLanguageCode(obj.language) ?? DEFAULT_LANGUAGE) : DEFAULT_LANGUAGE
    return { language, words }
  } catch {
    return null
  }
}

export class E2eSttProvider implements SttProvider {
  readonly id = E2E_PROVIDER_ID

  async transcribe(
    _bundlePath: string,
    _wavRef: string,
    opts?: TranscribeOptions
  ): Promise<Transcript> {
    const base = parseInjectedTranscript(process.env.CAPTION_STUDIO_E2E_TRANSCRIPT) ?? DEFAULT_E2E_TRANSCRIPT
    return {
      language: opts?.language ?? base.language,
      words: base.words
    }
  }
}

/**
 * Text-to-Speech (TTS) shared contract — the headless interface that the
 * renderer, preload, and main all agree on (P10.1–P10.4, Doc 12).
 *
 * Pure TYPES ONLY. NO electron / node / DOM imports leak here so the renderer
 * wrapper, the preload bridge, and the main-process provider registry can all
 * import this module without rework.
 *
 * The six Indic-first languages mirror those in `stt.ts`; Tamil is the default.
 */

/**
 * The six languages supported for TTS. Tamil-first (mirrors STT/LanguageCode).
 */
export type TTSLanguageCode = 'ta' | 'te' | 'ml' | 'kn' | 'hi' | 'en'

/** Ordered list of TTS language codes (Tamil first). */
export const TTS_LANGUAGES: readonly TTSLanguageCode[] = ['ta', 'te', 'ml', 'kn', 'hi', 'en'] as const

/** Default TTS language (Tamil). */
export const DEFAULT_TTS_LANGUAGE: TTSLanguageCode = 'ta'

/**
 * A single TTS voice descriptor returned by `listVoices()`.
 * `id` is stable and provider-specific; `name` is human-readable.
 */
export interface TTSVoice {
  id: string
  name: string
  language: TTSLanguageCode
  gender?: 'male' | 'female' | 'neutral'
}

/**
 * Request shape for TTS synthesis. `wordTimings` requests per-word timestamps
 * from the provider when it supports them (for caption sync).
 */
export interface TTSSynthesizeRequest {
  text: string
  voiceId: string
  language: TTSLanguageCode
  /** Optional word timings from TTS (for caption sync). */
  wordTimings?: boolean
}

/**
 * Result of a TTS synthesis. `mediaRef` is a bundle-relative path in `media/`
 * (e.g. `media/tts-1234567890.wav`). `duration` is the generated audio length
 * in seconds. `wordTimings` is optional per-word timing data.
 */
export interface TTSSynthesizeResult {
  /** Path written to bundle media/ (relative to bundle root). */
  mediaRef: string
  /** Duration of the generated audio, seconds. */
  duration: number
  /** Optional word timings (if the provider supports them). */
  wordTimings?: Array<{ word: string; start: number; end: number }>
}

/**
 * The pluggable TTS provider interface (P10.2). A provider synthesizes the
 * given text into audio, writes it into the bundle's `media/` folder, and
 * returns the bundle-relative `mediaRef` + duration. The real cloud/local TTS
 * provider drops in here behind this same interface.
 */
export interface TTSProvider {
  /** Enumerate available voices. */
  listVoices(): Promise<TTSVoice[]>
  /**
   * Synthesize `req.text` with `req.voiceId` and write the resulting audio to
   * `<bundlePath>/media/`. Returns the bundle-relative `mediaRef` and duration.
   * Throws on failure (the IPC wrapper converts to `{ok:false,error}`).
   */
  synthesize(bundlePath: string, req: TTSSynthesizeRequest): Promise<TTSSynthesizeResult>
}

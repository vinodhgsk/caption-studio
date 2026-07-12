/**
 * Speech-to-text (STT) shared contract — the headless interface that the
 * renderer, preload, and main all agree on (P4.4, Doc 02 — auto-caption).
 *
 * Pure TYPES + small const helpers ONLY. NO electron / node / DOM imports leak
 * here so the renderer wrapper, the preload bridge, and the main-process
 * provider registry can all import this module without rework (master plan §3).
 *
 * This is the contract the real whisper.cpp integration (P4.5) and the
 * word→line grouping (P4.6 / caption-sync skill) build on. The provider output
 * (`Transcript`) is what gets written to `cache/transcript.json` and feeds
 * `captions.transcript` / `captions.language` in project.json (master plan §4).
 */

/**
 * The six Indic-first languages the app supports for STT / language detection,
 * Tamil first (master plan §4, Doc 16). `LanguageCode` is the closed set; the
 * STT provider restricts auto-detect to these and falls back to Tamil.
 */
export const SUPPORTED_LANGUAGES = ['ta', 'te', 'ml', 'kn', 'hi', 'en'] as const
export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]

/** Tamil is the project default and the STT detection fallback (master plan §4). */
export const DEFAULT_LANGUAGE: LanguageCode = 'ta'

/** Narrow an arbitrary string to a supported `LanguageCode`, else null. */
export function asLanguageCode(value: string): LanguageCode | null {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
    ? (value as LanguageCode)
    : null
}

/**
 * A single transcribed word with timestamps (Doc 02 §4: `transcript.json` is
 * `[{ word, start, end }, ...]`). Times are in SECONDS from the start of the
 * normalized WAV. `start <= end`. Extra fields (confidence) are optional so a
 * provider can enrich without breaking the contract or downstream grouping.
 */
export interface Word {
  /** The word text as recognized (already in the detected script). */
  text: string
  /** Start time of the word, in seconds. */
  start: number
  /** End time of the word, in seconds. */
  end: number
  /** Optional model confidence in [0,1]; absent when the provider omits it. */
  confidence?: number
}

/**
 * The full transcription result a provider returns and that is persisted to
 * `cache/transcript.json`. `language` is the detected (or caller-provided) code
 * — one of {@link SUPPORTED_LANGUAGES}; downstream sets `captions.language`.
 */
export interface Transcript {
  /** Detected / provided language, one of the six supported codes. */
  language: LanguageCode
  /** Word-level timestamps, in timeline order. */
  words: Word[]
}

/**
 * Options for a transcription request. `language` PINS the language (skips
 * auto-detect) when provided; omit it to auto-detect within
 * {@link SUPPORTED_LANGUAGES} with a Tamil fallback. Future options (model size,
 * VAD) can be added without changing the channel shape.
 */
export interface TranscribeOptions {
  /** Pin the language instead of auto-detecting. One of the supported codes. */
  language?: LanguageCode
}

/**
 * The pluggable STT provider interface (P4.4). A provider transcribes the WAV
 * referenced by `wavRef` (a BUNDLE-RELATIVE path such as
 * `cache/voice.16k.mono.wav`, produced by `ffmpeg:normalizeAudio`) and returns a
 * {@link Transcript} with word-level timestamps and a detected language.
 *
 * IMPORTANT: the provider receives the bundle-relative `wavRef` plus the
 * resolved absolute bundle path (so it can read the WAV in main); NO audio bytes
 * ever cross IPC (constraint: keep media bytes out of IPC payloads). The real
 * whisper.cpp provider drops in here behind this same interface (P4.5).
 */
export interface SttProvider {
  /** Stable id used by the registry/factory (e.g. `'stub'`, `'whisper'`). */
  readonly id: string
  /**
   * Transcribe the normalized WAV at `wavRef` within the bundle rooted at
   * `bundlePath`. Resolves to the {@link Transcript}. Rejects on failure (the
   * IPC wrapper converts a throw to `{ ok:false, error }`).
   */
  transcribe(
    bundlePath: string,
    wavRef: string,
    opts?: TranscribeOptions
  ): Promise<Transcript>
}

/**
 * The `captions` block on the project model (master plan §4 / Doc 00 §4). After a
 * transcription, P4.5 sets `transcript` to the bundle-relative `cache/transcript.json`
 * path and `language` to the resolved code. The other fields (translation,
 * transliteration, styleId, keywordHighlights) are refined by later phases and
 * preserved as-is when present.
 */
export interface Captions {
  /** Caption generation mode. */
  mode?: 'auto' | 'lyricsFirst'
  /** Bundle-relative source media this transcript came from (e.g. `media/audio.mp3`). */
  source?: string
  /** Bundle-relative path to the word-level transcript (`cache/transcript.json`). */
  transcript?: string
  /** Detected / pinned language, one of the supported codes. */
  language?: LanguageCode
  /** Bundle-relative path to user-provided lyrics text (`cache/lyrics.txt`). */
  lyricsRef?: string
  /** Bundle-relative path to cached lyrics alignment details (`cache/alignment.json`). */
  alignmentRef?: string
  /** Alignment engine used for lyrics-first timing. */
  engine?: 'mms-ctc' | 'mfa' | 'aeneas' | 'cloud' | 'lyrics-first-stub' | 'lyrics-first-vad'
  /** Whether a vocal stem was used for alignment. */
  vocalStem?: boolean
  /** Optional romanization scheme for display/fallback workflows. */
  romanization?: 'iso15919' | 'itrans' | 'iast' | 'none'
  /** Optional tap-sync anchors. */
  anchors?: Array<{ unit: 'line' | 'word'; index: number; t: number }>
  /** Later-phase fields, preserved verbatim. */
  translation?: unknown
  transliteration?: unknown
  /**
   * Id of the applied caption preset → `CaptionPreset.id` (Doc 00 §4, Doc 03
   * P5.1/P5.4). Set by "apply preset to track" (P5.4); read on re-open to know
   * which preset the caption track currently wears. Optional — a project with no
   * preset applied yet omits it.
   */
  styleId?: string
  keywordHighlights?: unknown[]
}

/** The IPC request shape for `stt:transcribe` (mirrored in the IPC contract). */
export interface SttTranscribeRequest {
  /** Bundle-relative WAV path from `ffmpeg:normalizeAudio` (e.g. `cache/x.wav`). */
  wavRef: string
  /** Optional language pin; omit for auto-detect. */
  language?: LanguageCode
}

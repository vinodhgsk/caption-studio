/**
 * Transcript persistence helpers (P4.5, Doc 02 / Doc 00 §4).
 *
 * After a provider returns a {@link Transcript}, the `stt:transcribe` handler
 * (index.ts) persists it to `cache/transcript.json` in the bundle and updates the
 * project's `captions.transcript` / `captions.language`. The SHAPE of both writes
 * is encoded here as PURE functions so they are unit-testable without fs:
 *
 *   - `TRANSCRIPT_CACHE_REF` — the canonical bundle-relative path.
 *   - `serializeTranscript` — the exact bytes written to transcript.json.
 *   - `withCaptions` — returns a NEW project with `captions.*` set, preserving
 *     any existing captions fields (translation/transliteration/styleId/…).
 *
 * NO electron / node imports here — kept pure.
 */
import type { Project } from '../../shared/storage'
import type { Captions, Transcript } from '../../shared/stt'

/** Canonical bundle-relative path of the persisted transcript (Doc 00 §4). */
export const TRANSCRIPT_CACHE_REF = 'cache/transcript.json'

/**
 * The on-disk transcript.json document. Doc 02 §4 describes transcript.json as the
 * word-level timestamps; we persist the full {@link Transcript} (language + words)
 * so a reload has the detected language without re-reading project.json.
 */
export interface TranscriptDocument {
  language: Transcript['language']
  words: Transcript['words']
}

/** Build the transcript.json document from a provider {@link Transcript}. Pure. */
export function toTranscriptDocument(transcript: Transcript): TranscriptDocument {
  return { language: transcript.language, words: transcript.words }
}

/** Serialize the transcript to the exact JSON bytes written to disk (2-space). */
export function serializeTranscript(transcript: Transcript): string {
  return `${JSON.stringify(toTranscriptDocument(transcript), null, 2)}\n`
}

/**
 * Return a NEW project with `captions.transcript` pointed at the persisted
 * transcript and `captions.language` set to the resolved code, preserving every
 * other existing captions field. Optionally records the `source` media ref.
 * Pure — does not mutate `project`.
 */
export function withCaptions(
  project: Project,
  transcript: Transcript,
  source?: string
): Project {
  const existing = (
    typeof project.captions === 'object' && project.captions !== null ? project.captions : {}
  ) as Captions
  const captions: Captions = {
    ...existing,
    transcript: TRANSCRIPT_CACHE_REF,
    language: transcript.language,
    ...(source !== undefined ? { source } : {})
  }
  return { ...project, captions }
}

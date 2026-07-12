/**
 * Pure builder for an AUDIO clip (P4.1 — Doc 02 owns audio import + volume/fade).
 *
 * Headless-safe: NO DOM / electron / node / crypto / Date here. The clip `id`
 * and timeline `start` are supplied by the caller (the renderer action mints the
 * id via crypto.randomUUID), keeping this fully deterministic + testable.
 *
 * AUDIO-CLIP MODEL
 * ----------------
 * An audio clip is a normal `Clip` that lives on an `audio`-type track. It
 * references the imported file via `mediaRef` (e.g. `media/voice.mp3`) like a
 * video clip, but carries a `clip.audio` mix surface ({@link ClipAudio}) holding
 * the per-clip gain + fade-in/out. Those values are EXPORT-REPRESENTABLE (FFmpeg
 * `volume` / `afade`), so preview and export stay in parity (master plan §6).
 */
import type { Clip, ClipAudio } from '../../../shared/project-schema'
import { defaultClipAudio, defaultTransform } from '../../../shared/project-schema'
import type { ImportMediaResult } from '../../../shared/storage'

/**
 * Default on-timeline duration (seconds) for a freshly imported audio clip when
 * the real source duration is unknown. ffprobe (Phase 4 export pipeline) can
 * later supply the true length; until then we use a sensible default so the clip
 * is visible and trimmable on the timeline.
 */
export const DEFAULT_AUDIO_DURATION_SEC = 30

/** Inputs the caller computes outside the pure builder. */
export interface BuildAudioClipOptions {
  /** Caller-generated id (crypto.randomUUID in the renderer action). */
  id: string
  /** Timeline start (seconds) — typically the end of the last clip on the track. */
  start: number
  /** Override the default out (seconds); defaults to DEFAULT_AUDIO_DURATION_SEC. */
  durationSec?: number
  /** Override the default (neutral) audio mix. */
  audio?: ClipAudio
}

/**
 * Build an audio Clip referencing imported media: `in=0`, `out=durationSec`,
 * neutral `transform`, and a neutral `audio` mix (unity gain, no fades). The
 * caller adds it to an `audio`-type track via `addClipCommand` so the add is one
 * undoable step.
 */
export function buildAudioClip(result: ImportMediaResult, options: BuildAudioClipOptions): Clip {
  const duration = options.durationSec ?? DEFAULT_AUDIO_DURATION_SEC
  return {
    id: options.id,
    mediaRef: result.mediaRef,
    in: 0,
    out: duration,
    start: options.start,
    transform: defaultTransform(),
    audio: options.audio ?? defaultClipAudio()
  }
}

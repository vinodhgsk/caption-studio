/**
 * Pure helpers for building a Clip from a media-import result (P3.3).
 *
 * Headless-safe: NO DOM / electron / node / crypto here. The clip `id` and the
 * computed `start` are supplied by the caller (the renderer action generates the
 * id via crypto.randomUUID), keeping this fully deterministic and testable.
 */
import type { Clip, ProjectTrack } from '../../../shared/storage'
import { defaultTransform } from '../../../shared/project-schema'
import type { ImportMediaResult } from '../../../shared/storage'
import { clipLength } from './reducers'

/**
 * Default clip duration (seconds) for a freshly imported media file.
 *
 * Images have no intrinsic duration, so they always use this. For video we
 * cannot know the real duration without ffprobe, which arrives in Phase 4.
 * TODO(P4): probe video duration via ffprobe and use it instead of this default.
 */
export const DEFAULT_IMPORT_DURATION_SEC = 5

/** Inputs the caller computes outside the pure builder. */
export interface BuildImportedClipOptions {
  /** Caller-generated id (crypto.randomUUID in the renderer action). */
  id: string
  /** Timeline start (seconds) — typically the end of the last clip on the track. */
  start: number
  /** Override the default out (seconds); defaults to DEFAULT_IMPORT_DURATION_SEC. */
  durationSec?: number
}

/**
 * Build a Clip referencing imported media. `in=0`, `out=durationSec`,
 * `transform=defaultTransform()`. The `kind` from the import result is not
 * stored on the Clip (the schema is media-agnostic) but informs track choice in
 * the caller.
 */
export function buildImportedClip(
  result: ImportMediaResult,
  options: BuildImportedClipOptions
): Clip {
  const duration = options.durationSec ?? DEFAULT_IMPORT_DURATION_SEC
  return {
    id: options.id,
    mediaRef: result.mediaRef,
    in: 0,
    out: duration,
    start: options.start,
    transform: defaultTransform()
  }
}

/**
 * Compute the append point on a track: the max end (`start + length`) of its
 * clips, or 0 when empty. Pure.
 */
export function trackEndSeconds(track: ProjectTrack): number {
  return track.clips.reduce((end, clip) => Math.max(end, clip.start + clipLength(clip)), 0)
}

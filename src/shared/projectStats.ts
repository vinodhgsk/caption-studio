/**
 * Pure project-level statistics helpers (P13.5 — Large-project stress guard).
 *
 * No DOM / electron / node imports — importable headlessly in tests and main.
 */
import type { Project } from './storage'

/**
 * Total number of clips across all tracks in `project`.
 * Returns 0 for a project with no tracks.
 */
export function countClips(project: Project): number {
  let total = 0
  for (const track of project.tracks) {
    total += track.clips.length
  }
  return total
}

/** Threshold above which a performance warning is emitted. */
export const LARGE_PROJECT_CLIP_THRESHOLD = 500

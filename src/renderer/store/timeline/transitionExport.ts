/**
 * FFmpeg xfade mapping (P9.5) — pure module that describes how each transition
 * preset maps to an FFmpeg xfade filter equivalent.
 *
 * This module is PURE (no FFmpeg execution, no DOM, no electron). It is used by
 * the export pipeline to build the filtergraph that matches the preview.
 *
 * Parity guarantee: the transition engine (clipTransition.ts) is the single
 * source of truth for the blend logic; this module maps each preset to the
 * closest FFmpeg xfade filter so the exported video matches the preview as
 * closely as the available FFmpeg filters allow.
 *
 * FFmpeg xfade reference: https://ffmpeg.org/ffmpeg-filters.html#xfade
 */

import type { TransitionRef } from './clipTransition'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** An FFmpeg xfade filter specification. */
export interface XfadeSpec {
  /** xfade filter name (e.g. 'fade', 'slideleft', 'zoomin', 'pixelize'). */
  filter: string
  /** Overlap window duration in seconds (the `duration` xfade param). */
  duration: number
  /**
   * Any extra xfade parameters appended after `filter` and `duration`
   * in the filtergraph string, e.g. `'offset=0'`. Absent when none needed.
   */
  extraParams?: string
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

/**
 * Map a `TransitionRef` to an FFmpeg xfade filter specification.
 *
 * Mapping table:
 *   dissolve       → xfade=transition=fade
 *   slide (l)      → xfade=transition=slideleft
 *   slide (r)      → xfade=transition=slideright
 *   slide (t)      → xfade=transition=slideup
 *   slide (b)      → xfade=transition=slidedown
 *   zoom           → xfade=transition=zoomin
 *   glitch         → xfade=transition=pixelize  (closest available approximation)
 *   unknown preset → xfade=transition=fade      (safe fallback)
 *
 * The `offset` xfade parameter must be computed by the export pipeline from
 * the clip timeline positions: `offset = clipAStart + clipADuration - ref.duration`.
 * It is NOT included here because this module is pure and does not know clip
 * positions — the export pipeline supplies it when building the filtergraph.
 */
export function transitionToXfade(ref: TransitionRef): XfadeSpec {
  const duration = ref.duration

  switch (ref.presetId) {
    case 'dissolve':
      return { filter: 'fade', duration }

    case 'slide': {
      const dir = ref.direction ?? 'l'
      let filter: string
      switch (dir) {
        case 'l':
          filter = 'slideleft'
          break
        case 'r':
          filter = 'slideright'
          break
        case 't':
          filter = 'slideup'
          break
        case 'b':
          filter = 'slidedown'
          break
        default:
          filter = 'slideleft'
      }
      return { filter, duration }
    }

    case 'zoom':
      return { filter: 'zoomin', duration }

    case 'glitch':
      // pixelize is the closest FFmpeg xfade to a glitch/digital noise effect.
      return { filter: 'pixelize', duration }

    default:
      // Unknown preset — safe dissolve fallback.
      return { filter: 'fade', duration }
  }
}

/**
 * Build a complete FFmpeg xfade filter string for a transition, given the
 * clip A end time on the timeline (used to derive the `offset` parameter).
 *
 * The returned string can be used directly in an FFmpeg filtergraph:
 *   `[0:v][1:v]xfade=transition=fade:duration=0.5:offset=10.5[v]`
 *
 * @param ref       The transition descriptor.
 * @param clipAEnd  Timeline seconds of the outgoing clip's end.
 * @returns         The full xfade filter argument string.
 */
export function buildXfadeFilterString(ref: TransitionRef, clipAEnd: number): string {
  const spec = transitionToXfade(ref)
  // offset is the timeline position where the overlap window starts.
  const offset = clipAEnd - ref.duration
  const base = `xfade=transition=${spec.filter}:duration=${spec.duration}:offset=${offset.toFixed(4)}`
  return spec.extraParams !== undefined ? `${base}:${spec.extraParams}` : base
}

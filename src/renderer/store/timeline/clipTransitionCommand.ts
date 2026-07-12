/**
 * Undoable command: SetClipTransition (P9.3 + P9.4).
 *
 * Sets or clears the `in` or `out` transition on a clip, stored as
 * `clips[].transitions.{in|out}` — a `Record<string, unknown>` bag matching
 * the existing `ClipTransitions` schema (project-schema.ts).
 *
 * The command follows the same factory pattern as the other commands in
 * `commands.ts`: the prior value is captured at factory time so `invert` can
 * restore it without any mutable closure state.
 *
 * Headless-safe: no DOM / electron / node imports.
 */

import type { Command } from '../commandStack'
import type { Project } from '../../../shared/storage'
import type { Clip, ClipTransitions } from '../../../shared/project-schema'

// ---------------------------------------------------------------------------
// Pure reducer
// ---------------------------------------------------------------------------

/**
 * Set (or clear with `undefined`) the `edge` transition on `clipId`.
 * Returns the project unchanged when the clip is not found. Pure + immutable.
 */
export function setClipTransition(
  project: Project,
  clipId: string,
  edge: 'in' | 'out',
  value: Record<string, unknown> | undefined
): Project {
  return {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((c: Clip): Clip => {
        if (c.id !== clipId) return c
        const priorTransitions: ClipTransitions = c.transitions ?? {}
        let nextTransitions: ClipTransitions

        if (value === undefined) {
          // Clear the edge: drop the key from the transitions object.
          const rest = { ...priorTransitions }
          if (edge === 'in') delete rest.in
          else delete rest.out
          // Drop the whole `transitions` key when both edges are gone.
          if (Object.keys(rest).length === 0) {
            const clipRest = { ...c } as Partial<Clip>
            delete clipRest.transitions
            return clipRest as Clip
          }
          nextTransitions = rest
        } else {
          // Set the edge.
          nextTransitions = { ...priorTransitions, [edge]: value }
        }

        return { ...c, transitions: nextTransitions }
      })
    }))
  }
}

// ---------------------------------------------------------------------------
// Payload type (public for TransitionsPanel to import)
// ---------------------------------------------------------------------------

export interface SetClipTransitionPayload {
  clipId: string
  edge: 'in' | 'out'
  transition: {
    presetId: string
    duration: number
    direction?: string
    params?: Record<string, unknown>
  } | null
}

// ---------------------------------------------------------------------------
// Command factory
// ---------------------------------------------------------------------------

/** Helper: find a clip across all tracks and return the prior transitions (or undefined). */
function captureTransitions(project: Project, clipId: string): ClipTransitions | undefined {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId)
    if (clip !== undefined) return clip.transitions
  }
  return undefined
}

/**
 * Undoable command that sets or clears the transition on one edge of a clip.
 *
 * When `payload.transition` is non-null, the transition descriptor is written
 * as a `Record<string, unknown>` into `clip.transitions[edge]`. When null,
 * that edge is cleared entirely.
 *
 * Invert restores the clip's EXACT prior `transitions` object (both edges),
 * captured from `project` at factory time, so undo recovers both edges even if
 * only one was changed.
 */
export function setClipTransitionCommand(
  project: Project,
  payload: SetClipTransitionPayload
): Command {
  const { clipId, edge, transition } = payload
  const priorTransitions = captureTransitions(project, clipId)

  return {
    label: transition === null ? 'Clear transition' : 'Set transition',
    apply: (p) => {
      if (transition === null) {
        return setClipTransition(p, clipId, edge, undefined)
      }
      const value: Record<string, unknown> = {
        presetId: transition.presetId,
        duration: transition.duration,
        ...(transition.direction !== undefined ? { direction: transition.direction } : {}),
        params: transition.params ?? {}
      }
      return setClipTransition(p, clipId, edge, value)
    },
    invert: (p) => {
      // Restore BOTH edges to the prior snapshot (full transitions object).
      return {
        ...p,
        tracks: p.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((c: Clip): Clip => {
            if (c.id !== clipId) return c
            if (priorTransitions === undefined) {
              const rest = { ...c } as Partial<Clip>
              delete rest.transitions
              return rest as Clip
            }
            return { ...c, transitions: priorTransitions }
          })
        }))
      }
    }
  }
}

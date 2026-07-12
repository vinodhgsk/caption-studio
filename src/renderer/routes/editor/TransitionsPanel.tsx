/**
 * Transitions panel (P9.3 + P9.4) — gallery of transition presets, duration
 * slider, direction selector, and apply/clear controls.
 *
 * Reads the SELECTED clip's current in/out transitions from the project, and
 * writes through the undoable `setClipTransition` store action (one undo step
 * per apply/clear). The panel targets whichever SINGLE clip is selected; when
 * multiple clips or no clip is selected, controls are disabled.
 *
 * The four built-in presets (dissolve, slide, zoom, glitch) are shown as a
 * gallery. A clip's IN edge (left) and OUT edge (right) are configured
 * independently via the edge tab selector.
 */

import { useMemo, useState } from 'react'
import { useProjectStore } from '@/store/projectStore'
import { useTimelineStore } from '@/store/timelineStore'
import type { Clip } from '../../../shared/project-schema'
import { TRANSITION_CATALOG } from '../../store/timeline/clipTransitionPresets'
import { resolveTransition } from '../../store/timeline/clipTransition'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EdgeTab = 'in' | 'out'

interface TransitionState {
  presetId: string
  duration: number
  direction: 'l' | 'r' | 't' | 'b'
}

const DEFAULT_DIRECTION: 'l' | 'r' | 't' | 'b' = 'l'
const DEFAULT_DURATION = 0.5
const MIN_DURATION = 0.1
const MAX_DURATION = 2.0
const DURATION_STEP = 0.05

const DIRECTION_OPTIONS: { id: 'l' | 'r' | 't' | 'b'; label: string }[] = [
  { id: 'l', label: 'Left' },
  { id: 'r', label: 'Right' },
  { id: 't', label: 'Up' },
  { id: 'b', label: 'Down' }
]

// Presets that expose a direction selector.
const DIRECTIONAL_PRESETS = new Set(['slide', 'zoom'])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive transition state from the raw `Record<string, unknown>` bag. */
function deriveState(bag: Record<string, unknown> | undefined): TransitionState {
  const ref = resolveTransition(bag)
  if (ref === undefined) {
    return { presetId: 'none', duration: DEFAULT_DURATION, direction: DEFAULT_DIRECTION }
  }
  return {
    presetId: ref.presetId,
    duration: ref.duration,
    direction:
      ref.direction === 'l' || ref.direction === 'r' || ref.direction === 't' || ref.direction === 'b'
        ? ref.direction
        : DEFAULT_DIRECTION
  }
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

/**
 * Transitions panel: gallery + duration slider + direction selector +
 * apply/clear per clip edge.
 */
export function TransitionsPanel(): JSX.Element {
  const project = useProjectStore((s) => s.currentProject)
  const selection = useTimelineStore((s) => s.selection)
  const setClipTransition = useTimelineStore((s) => s.setClipTransition)

  const [edge, setEdge] = useState<EdgeTab>('out')

  // Resolve the single selected clip (any type can have transitions).
  const selectedClip: Clip | null = useMemo(() => {
    if (project === null || selection.length !== 1) return null
    for (const track of project.tracks) {
      const c = track.clips.find((x) => x.id === selection[0])
      if (c !== undefined) return c
    }
    return null
  }, [project, selection])

  const disabled = selectedClip === null

  // Derive the current state for the selected edge.
  const edgeBag = selectedClip?.transitions?.[edge]
  const state = useMemo(() => deriveState(edgeBag), [edgeBag])

  // ---------------------------------------------------------------------------
  // Writers
  // ---------------------------------------------------------------------------

  const applyPreset = (presetId: string): void => {
    if (selectedClip === null) return
    const entry = TRANSITION_CATALOG.find((e) => e.id === presetId)
    const duration = state.presetId === presetId ? state.duration : (entry?.defaultDuration ?? DEFAULT_DURATION)
    const direction = state.direction

    setClipTransition({
      clipId: selectedClip.id,
      edge,
      transition: { presetId, duration, direction, params: {} }
    })
  }

  const updateDuration = (duration: number): void => {
    if (selectedClip === null || state.presetId === 'none') return
    setClipTransition({
      clipId: selectedClip.id,
      edge,
      transition: { presetId: state.presetId, duration, direction: state.direction, params: {} }
    })
  }

  const updateDirection = (direction: 'l' | 'r' | 't' | 'b'): void => {
    if (selectedClip === null || state.presetId === 'none') return
    setClipTransition({
      clipId: selectedClip.id,
      edge,
      transition: { presetId: state.presetId, duration: state.duration, direction, params: {} }
    })
  }

  const clearTransition = (): void => {
    if (selectedClip === null) return
    setClipTransition({ clipId: selectedClip.id, edge, transition: null })
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <section className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <h2 className="text-sm font-semibold text-text-primary">Transitions</h2>

      {disabled ? (
        <p className="text-xs text-text-muted">
          Select a clip to add a transition to its In (left edge) or Out (right edge).
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* ---- Edge tabs (In / Out) ---- */}
          <div className="flex gap-1" role="tablist" aria-label="Transition edge">
            {(['out', 'in'] as const).map((e) => (
              <button
                key={e}
                type="button"
                role="tab"
                aria-selected={edge === e}
                onClick={() => setEdge(e)}
                className={`flex-1 rounded-sm border px-2 py-1 text-xs ${
                  edge === e
                    ? 'border-accent bg-accent/20 text-text-primary'
                    : 'border-line text-text-secondary hover:bg-surface-2'
                }`}
              >
                {e === 'in' ? 'In (left edge)' : 'Out (right edge)'}
              </button>
            ))}
          </div>

          {/* ---- Preset gallery ---- */}
          <div>
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              Preset
            </span>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Transition preset">
              {TRANSITION_CATALOG.map((entry) => {
                const active = state.presetId === entry.id
                return (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => applyPreset(entry.id)}
                    className={`rounded-sm border px-2 py-1 text-[11px] ${
                      active
                        ? 'border-accent bg-accent/20 text-text-primary'
                        : 'border-line text-text-secondary hover:bg-surface-2'
                    }`}
                  >
                    {entry.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* ---- Duration slider (only when a preset is selected) ---- */}
          {state.presetId !== 'none' && (
            <>
              <label className="flex flex-col gap-1 text-[11px] text-text-secondary">
                <span className="flex items-center justify-between">
                  <span>Duration</span>
                  <span className="tabular-nums text-text-muted">{state.duration.toFixed(2)}s</span>
                </span>
                <input
                  type="range"
                  aria-label="transition duration"
                  min={MIN_DURATION}
                  max={MAX_DURATION}
                  step={DURATION_STEP}
                  value={state.duration}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (Number.isFinite(v)) updateDuration(v)
                  }}
                  className="w-full accent-accent"
                />
                <span className="text-[10px] text-text-muted">
                  {MIN_DURATION}s – {MAX_DURATION}s overlap window.
                </span>
              </label>

              {/* ---- Direction selector (slide and zoom only) ---- */}
              {DIRECTIONAL_PRESETS.has(state.presetId) && (
                <div>
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    Direction
                  </span>
                  <div className="flex gap-1" role="group" aria-label="Transition direction">
                    {DIRECTION_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        aria-pressed={state.direction === opt.id}
                        onClick={() => updateDirection(opt.id)}
                        className={`flex-1 rounded-sm border px-1 py-1 text-[10px] ${
                          state.direction === opt.id
                            ? 'border-accent bg-accent/20 text-text-primary'
                            : 'border-line text-text-secondary hover:bg-surface-2'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ---- Clear button ---- */}
              <button
                type="button"
                onClick={clearTransition}
                className="self-start rounded-sm border border-line px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-2"
              >
                Clear transition
              </button>
            </>
          )}

          {state.presetId === 'none' && (
            <p className="text-[10px] text-text-muted">
              Select a preset above to add a transition to the clip's {edge === 'in' ? 'In' : 'Out'} edge.
            </p>
          )}
        </div>
      )}

      <p className="text-xs text-text-muted">
        Transitions blend two clips over an overlap window. Out applies at the clip's right edge;
        In applies at the left edge. Duration controls the overlap length.
      </p>
    </section>
  )
}

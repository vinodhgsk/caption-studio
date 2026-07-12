import { useCallback, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Clip, KeyframeProp } from '../../../../shared/project-schema'
import { clipDuration, KEYFRAME_PROPS } from '../../../../shared/project-schema'
import { EASING_NAMES, type EasingName } from '../../../../shared/easing'
import { useTimelineStore } from '@/store/timelineStore'
import { getLane } from '@/store/timeline'
import { pxToTime, timeToPx } from './scale'

/**
 * Per-prop KEYFRAME LANES for the selected clip (P8.6, Doc 11 — keyframe-engine).
 *
 * Shown ONLY for the single selected clip (the lanes are hidden otherwise, so
 * existing timeline rendering is untouched). One row per animatable prop
 * (`x`/`y`/`scale`/`rotation`/`opacity`); each row draws a DIAMOND per keyframe at
 * its clip-local `t` mapped to px via the shared `timeToPx` scale, positioned so
 * the lane aligns under the clip block (offset by `clip.start`).
 *
 * EDITING (all through the undoable `timelineStore` keyframe commands):
 *   - ADD: a "+" button drops a keyframe at the current playhead (clip-local),
 *     and DOUBLE-CLICK on the lane drops one at the clicked time. The value is
 *     seeded from the clip's current `transform[prop]` so a new keyframe starts
 *     "where the clip is" (the P8.7 sampler then interpolates).
 *   - MOVE: drag a diamond horizontally; px delta → clip-local time delta via
 *     `pxToTime`, committed as ONE `moveKeyframe` on pointer-up (live preview is
 *     local-only — no command per move).
 *   - DELETE: select a diamond (click) then the row's trash button removes it.
 *   - EASING (per segment): a `<select>` over `EASING_NAMES` sets the ease that
 *     governs the segment LEAVING the selected keyframe (`setKeyframeEasing`).
 *
 * All px<->time math is the pure `scale` helpers; this component only wires
 * pointer/keyboard events to the store actions.
 */

interface KeyframeLanesProps {
  /** The single selected clip whose lanes to edit. */
  clip: Clip
  /** Active timeline scale, in pixels per second. */
  pxPerSec: number
}

/** Half-width (px) of a diamond marker — also its hit padding. */
const DIAMOND_PX = 10
/** Pixels of pointer travel before a press becomes a drag (vs a select click). */
const DRAG_THRESHOLD_PX = 3
/** Height (px) of one prop row. */
const ROW_HEIGHT_PX = 22

/** The clip's current transform value for `prop` (seed for a new keyframe). */
function seedValue(clip: Clip, prop: KeyframeProp): number {
  return clip.transform[prop]
}

interface DragState {
  pointerId: number
  prop: KeyframeProp
  index: number
  originClientX: number
  originT: number
}

export function KeyframeLanes({ clip, pxPerSec }: KeyframeLanesProps): JSX.Element {
  const playhead = useTimelineStore((s) => s.playhead)
  const addKeyframe = useTimelineStore((s) => s.addKeyframe)
  const moveKeyframe = useTimelineStore((s) => s.moveKeyframe)
  const deleteKeyframe = useTimelineStore((s) => s.deleteKeyframe)
  const setKeyframeEasing = useTimelineStore((s) => s.setKeyframeEasing)

  const durationSec = clipDuration(clip)
  const clipLeftPx = timeToPx(clip.start, pxPerSec)

  // Selected keyframe (per prop+index) for delete + easing controls.
  const [selected, setSelected] = useState<{ prop: KeyframeProp; index: number } | null>(null)
  // Live drag preview time (clip-local) so the diamond follows the pointer.
  const [previewT, setPreviewT] = useState<number | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const movedRef = useRef(false)

  /** Clip-local time (seconds) under a viewport clientX, given the row element. */
  const localTimeFromClientX = useCallback(
    (clientX: number, rowEl: HTMLElement): number => {
      const rect = rowEl.getBoundingClientRect()
      const px = clientX - rect.left
      const t = pxToTime(px, pxPerSec)
      return Math.min(durationSec, Math.max(0, t))
    },
    [durationSec, pxPerSec]
  )

  const handleRowDoubleClick = useCallback(
    (prop: KeyframeProp) =>
      (e: React.MouseEvent<HTMLDivElement>): void => {
        const t = localTimeFromClientX(e.clientX, e.currentTarget)
        addKeyframe(clip.id, prop, t, seedValue(clip, prop))
      },
    [addKeyframe, clip, localTimeFromClientX]
  )

  const handleAddAtPlayhead = useCallback(
    (prop: KeyframeProp): void => {
      // Playhead is timeline-absolute; lanes are clip-local → subtract clip.start.
      const localT = Math.min(durationSec, Math.max(0, playhead - clip.start))
      addKeyframe(clip.id, prop, localT, seedValue(clip, prop))
    },
    [addKeyframe, clip, durationSec, playhead]
  )

  const handleDiamondPointerDown = useCallback(
    (prop: KeyframeProp, index: number, originT: number) =>
      (e: ReactPointerEvent<HTMLButtonElement>): void => {
        if (e.button !== 0) return
        e.stopPropagation()
        setSelected({ prop, index })
        dragRef.current = { pointerId: e.pointerId, prop, index, originClientX: e.clientX, originT }
        movedRef.current = false
        e.currentTarget.setPointerCapture(e.pointerId)
      },
    []
  )

  const handleDiamondPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>): void => {
      const drag = dragRef.current
      if (drag === null || e.pointerId !== drag.pointerId) return
      const deltaPx = e.clientX - drag.originClientX
      if (!movedRef.current && Math.abs(deltaPx) < DRAG_THRESHOLD_PX) return
      movedRef.current = true
      const next = drag.originT + pxToTime(deltaPx, pxPerSec)
      setPreviewT(Math.min(durationSec, Math.max(0, next)))
    },
    [durationSec, pxPerSec]
  )

  const handleDeleteSelected = useCallback(
    (prop: KeyframeProp): void => {
      if (selected === null || selected.prop !== prop) return
      deleteKeyframe(clip.id, prop, selected.index)
      setSelected(null)
    },
    [clip.id, deleteKeyframe, selected]
  )

  const handleDiamondPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>): void => {
      const drag = dragRef.current
      if (drag === null || e.pointerId !== drag.pointerId) return
      const finalT = previewT
      dragRef.current = null
      setPreviewT(null)
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      // ONE command per gesture — only if the keyframe actually moved.
      if (movedRef.current && finalT !== null && finalT !== drag.originT) {
        moveKeyframe(clip.id, drag.prop, drag.index, finalT)
      }
      movedRef.current = false
    },
    [clip.id, moveKeyframe, previewT]
  )

  return (
    <div
      className="border-b border-line bg-surface-2"
      data-keyframe-lanes-clip={clip.id}
    >
      {KEYFRAME_PROPS.map((prop) => {
        const lane = getLane(clip, prop)
        const selProp = selected?.prop === prop ? selected : null
        const selKf = selProp !== null ? lane[selProp.index] : undefined
        return (
          <div key={prop} className="flex items-stretch" style={{ height: `${ROW_HEIGHT_PX}px` }}>
            {/* Row controls (fixed): label, add, delete, per-segment easing. */}
            <div className="flex w-44 shrink-0 items-center gap-1 border-r border-line px-2">
              <span className="w-14 shrink-0 text-[10px] font-medium uppercase text-text-secondary">
                {prop}
              </span>
              <button
                type="button"
                aria-label={`Add ${prop} keyframe at playhead`}
                title="Add keyframe at playhead"
                onClick={() => handleAddAtPlayhead(prop)}
                className="rounded-sm bg-surface-1 px-1 text-[10px] text-text-secondary hover:text-text-primary"
              >
                +
              </button>
              <button
                type="button"
                aria-label={`Delete selected ${prop} keyframe`}
                title="Delete selected keyframe"
                disabled={selProp === null}
                onClick={() => handleDeleteSelected(prop)}
                className="rounded-sm bg-surface-1 px-1 text-[10px] text-text-secondary hover:text-text-primary disabled:opacity-30"
              >
                del
              </button>
              <select
                aria-label={`Easing for selected ${prop} keyframe segment`}
                title="Easing for the segment leaving the selected keyframe"
                disabled={selProp === null}
                value={(selKf?.ease as EasingName) ?? 'linear'}
                onChange={(e) => {
                  if (selProp === null) return
                  setKeyframeEasing(clip.id, prop, selProp.index, e.target.value as EasingName)
                }}
                className="min-w-0 flex-1 rounded-sm bg-surface-1 text-[10px] text-text-secondary disabled:opacity-30"
              >
                {EASING_NAMES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            {/* Scrollable lane track: diamonds positioned by clip-local time,
                offset by the clip's timeline start so they align under the clip. */}
            <div className="relative min-w-0 flex-1 overflow-hidden">
              <div
                className="absolute inset-y-0"
                style={{ left: `${clipLeftPx}px`, width: `${timeToPx(durationSec, pxPerSec)}px` }}
                onDoubleClick={handleRowDoubleClick(prop)}
                data-keyframe-row={prop}
              >
                {/* Lane baseline. */}
                <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" />
                {lane.map((kf, index) => {
                  const isSel = selProp?.index === index
                  const isDragging =
                    dragRef.current?.prop === prop && dragRef.current?.index === index
                  const t = isDragging && previewT !== null ? previewT : kf.t
                  const px = timeToPx(t, pxPerSec)
                  return (
                    <button
                      key={index}
                      type="button"
                      aria-label={`${prop} keyframe ${index + 1}`}
                      aria-pressed={isSel}
                      onPointerDown={handleDiamondPointerDown(prop, index, kf.t)}
                      onPointerMove={handleDiamondPointerMove}
                      onPointerUp={handleDiamondPointerUp}
                      onPointerCancel={handleDiamondPointerUp}
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelected({ prop, index })
                      }}
                      className={`absolute top-1/2 touch-none ${
                        isSel ? 'bg-accent' : 'bg-text-secondary'
                      }`}
                      style={{
                        left: `${px}px`,
                        width: `${DIAMOND_PX}px`,
                        height: `${DIAMOND_PX}px`,
                        transform: 'translate(-50%, -50%) rotate(45deg)'
                      }}
                      title={`${prop} = ${kf.value} @ ${kf.t.toFixed(2)}s (${kf.ease ?? 'linear'})`}
                      data-keyframe-index={index}
                    />
                  )
                })}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

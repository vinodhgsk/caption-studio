import { useCallback, useMemo, useState } from 'react'
import type { Clip } from '../../../../shared/project-schema'
import { useProjectStore } from '@/store/projectStore'
import { useTimelineStore } from '@/store/timelineStore'
import { bringForwardZ, bringToFrontZ, sendBackwardZ, sendToBackZ } from './layerOrder'

/**
 * Contextual transform property controls (P3.12, Doc 01) for the single selected
 * clip: Flip Horizontal, Flip Vertical, and an Opacity slider.
 *
 * PLACEMENT NOTE: the right-panel registry (`panels.ts`) is a fixed exhaustive
 * union (Media/Text/…), with no per-selection "Properties" panel and no slot for
 * one without restructuring the rail + store. The lowest-friction correct home
 * for selection-scoped transform controls is therefore a COMPACT row docked in
 * the preview region, just above the transport bar — it lives next to the canvas
 * it manipulates and is naturally selection-scoped. Disabled (and dimmed) when a
 * single clip is not selected.
 *
 * UNDO MODEL:
 * - Flip H/V toggles commit ONE `setClipTransform({flipH|flipV})` per click.
 * - Opacity uses the live transient pattern: pointer/keyboard input updates the
 *   `dragTransform` preview (no command) so the canvas reflects the value LIVE;
 *   the change is COMMITTED as ONE undoable command on release (onPointerUp /
 *   onKeyUp / onBlur). One slider drag = one undo step.
 */
export function TransformControls(): JSX.Element | null {
  const selection = useTimelineStore((s) => s.selection)
  const project = useProjectStore((s) => s.currentProject)
  const dragTransform = useTimelineStore((s) => s.dragTransform)
  const [sliding, setSliding] = useState(false)

  const selected: Clip | null =
    selection.length === 1 && project !== null
      ? (project.tracks.flatMap((t) => t.clips).find((c) => c.id === selection[0]) ?? null)
      : null

  const setClipTransform = useTimelineStore((s) => s.setClipTransform)
  const beginTransformDrag = useTimelineStore((s) => s.beginTransformDrag)
  const updateTransformDrag = useTimelineStore((s) => s.updateTransformDrag)
  const commitTransformDrag = useTimelineStore((s) => s.commitTransformDrag)

  // Motion path (P8.8): a draw-mode TOGGLE for the selected clip. Entering draw mode
  // arms the preview overlay to capture a stroke; exiting commits it (≥2 points).
  const motionPathDraw = useTimelineStore((s) => s.motionPathDraw)
  const beginMotionPathDraw = useTimelineStore((s) => s.beginMotionPathDraw)
  const commitMotionPathDraw = useTimelineStore((s) => s.commitMotionPathDraw)
  const clearMotionPath = useTimelineStore((s) => s.clearMotionPath)

  const clipId = selected?.id ?? null
  const drawingThis = motionPathDraw !== null && motionPathDraw.clipId === clipId
  const hasPath = (selected?.motionPath?.points.length ?? 0) > 0

  const toggleDrawPath = useCallback(() => {
    if (clipId === null) return
    if (drawingThis) commitMotionPathDraw()
    else beginMotionPathDraw(clipId)
  }, [clipId, drawingThis, commitMotionPathDraw, beginMotionPathDraw])

  const clearPath = useCallback(() => {
    if (clipId === null) return
    clearMotionPath(clipId)
  }, [clipId, clearMotionPath])

  const toggleFlipH = useCallback(() => {
    if (selected === null) return
    setClipTransform(selected.id, { flipH: !selected.transform.flipH })
  }, [selected, setClipTransform])

  const toggleFlipV = useCallback(() => {
    if (selected === null) return
    setClipTransform(selected.id, { flipV: !selected.transform.flipV })
  }, [selected, setClipTransform])

  // Layer order (P3.13): z reorders clips WITHIN the same track only (the
  // compositor sorts by track first, then z). Peers = OTHER clips on the
  // selected clip's track. The selected clip's own z is excluded.
  const sameTrackPeerZs: number[] = useMemo(
    () =>
      selected !== null && project !== null
        ? (project.tracks
            .find((t) => t.clips.some((c) => c.id === selected.id))
            ?.clips.filter((c) => c.id !== selected.id)
            .map((c) => c.transform.z) ?? [])
        : [],
    [selected, project]
  )

  const currentZ = selected?.transform.z ?? 0
  const hasPeerAbove = sameTrackPeerZs.some((z) => z > currentZ)
  const hasPeerBelow = sameTrackPeerZs.some((z) => z < currentZ)

  const bringToFront = useCallback(() => {
    if (selected === null || !hasPeerAbove) return
    setClipTransform(selected.id, { z: bringToFrontZ(sameTrackPeerZs) })
  }, [selected, hasPeerAbove, sameTrackPeerZs, setClipTransform])

  const bringForward = useCallback(() => {
    if (selected === null || !hasPeerAbove) return
    setClipTransform(selected.id, { z: bringForwardZ(currentZ, sameTrackPeerZs) })
  }, [selected, hasPeerAbove, currentZ, sameTrackPeerZs, setClipTransform])

  const sendBackward = useCallback(() => {
    if (selected === null || !hasPeerBelow) return
    setClipTransform(selected.id, { z: sendBackwardZ(currentZ, sameTrackPeerZs) })
  }, [selected, hasPeerBelow, currentZ, sameTrackPeerZs, setClipTransform])

  const sendToBack = useCallback(() => {
    if (selected === null || !hasPeerBelow) return
    setClipTransform(selected.id, { z: sendToBackZ(sameTrackPeerZs) })
  }, [selected, hasPeerBelow, sameTrackPeerZs, setClipTransform])

  // Opacity live-drag: begin on first input, update on each change, commit on release.
  const handleOpacityChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (clipId === null) return
      const opacity = Number(e.target.value) / 100
      const active = useTimelineStore.getState().dragTransform
      if (active === null || active.clipId !== clipId) {
        beginTransformDrag(clipId, { opacity })
        setSliding(true)
      } else {
        updateTransformDrag({ opacity })
      }
    },
    [clipId, beginTransformDrag, updateTransformDrag]
  )

  const commitOpacity = useCallback(() => {
    if (!sliding) return
    const active = useTimelineStore.getState().dragTransform
    setSliding(false)
    if (active !== null) commitTransformDrag(active.patch)
  }, [sliding, commitTransformDrag])

  // Reflect the live transient opacity (during a slider drag) over the stored one.
  const liveOpacity =
    dragTransform !== null &&
    dragTransform.clipId === clipId &&
    dragTransform.patch.opacity !== undefined
      ? dragTransform.patch.opacity
      : (selected?.transform.opacity ?? 1)
  const opacityPct = Math.round(liveOpacity * 100)

  const disabled = selected === null
  const toggle =
    'rounded-sm bg-surface-2 px-2 py-1 text-xs font-medium text-text-secondary hover:text-text-primary disabled:opacity-50'

  return (
    <div className="flex h-9 w-full shrink-0 items-center gap-3 border-t border-line bg-surface-1 px-3">
      <span className="text-xs font-medium text-text-muted">Transform</span>
      <button
        type="button"
        aria-label="Flip horizontal"
        aria-pressed={selected?.transform.flipH ?? false}
        onClick={toggleFlipH}
        disabled={disabled}
        className={toggle}
        title="Flip horizontal"
      >
        Flip H
      </button>
      <button
        type="button"
        aria-label="Flip vertical"
        aria-pressed={selected?.transform.flipV ?? false}
        onClick={toggleFlipV}
        disabled={disabled}
        className={toggle}
        title="Flip vertical"
      >
        Flip V
      </button>
      <label className="flex items-center gap-2 text-xs text-text-secondary">
        Opacity
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={opacityPct}
          disabled={disabled}
          aria-label="Opacity"
          onChange={handleOpacityChange}
          onPointerUp={commitOpacity}
          onKeyUp={commitOpacity}
          onBlur={commitOpacity}
          className="h-1 w-32 disabled:opacity-50"
        />
        <span className="w-9 tabular-nums text-text-muted">{opacityPct}%</span>
      </label>
      <span className="text-xs font-medium text-text-muted">Layer</span>
      <button
        type="button"
        aria-label="Send to back"
        onClick={sendToBack}
        disabled={disabled || !hasPeerBelow}
        className={toggle}
        title="Send to back"
      >
        To Back
      </button>
      <button
        type="button"
        aria-label="Send backward"
        onClick={sendBackward}
        disabled={disabled || !hasPeerBelow}
        className={toggle}
        title="Send backward"
      >
        Backward
      </button>
      <button
        type="button"
        aria-label="Bring forward"
        onClick={bringForward}
        disabled={disabled || !hasPeerAbove}
        className={toggle}
        title="Bring forward"
      >
        Forward
      </button>
      <button
        type="button"
        aria-label="Bring to front"
        onClick={bringToFront}
        disabled={disabled || !hasPeerAbove}
        className={toggle}
        title="Bring to front"
      >
        To Front
      </button>
      <span className="text-xs font-medium text-text-muted">Motion</span>
      <button
        type="button"
        aria-label={drawingThis ? 'Finish drawing motion path' : 'Draw motion path'}
        aria-pressed={drawingThis}
        onClick={toggleDrawPath}
        disabled={disabled}
        className={toggle}
        title="Draw a custom motion path on the preview; the clip follows it over its duration"
      >
        {drawingThis ? 'Done Path' : 'Draw Path'}
      </button>
      <button
        type="button"
        aria-label="Clear motion path"
        onClick={clearPath}
        disabled={disabled || !hasPath}
        className={toggle}
        title="Clear the drawn motion path"
      >
        Clear Path
      </button>
    </div>
  )
}

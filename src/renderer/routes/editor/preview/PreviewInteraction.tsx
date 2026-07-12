import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Project } from '../../../../shared/storage'
import type { ClipTransform } from '../../../../shared/project-schema'
import type { TargetBox } from '../../../../shared/tracking'
import { useTimelineStore } from '@/store/timelineStore'
import {
  clipBoundsAt,
  clipCenter,
  hitTestClip,
  letterboxFit,
  rotatedClipCorners,
  visibleClipsAt,
  type LetterboxFit
} from './compositor'
import { snapTransformXY, type SnapGuideId } from './snapGuides'
import { angleFromCenterDeg, normalizeDeg, snapRotationDeg } from './rotate'
import { linesToValue } from '@/store/timeline'
import { valueToLines } from '@/store/timeline'
import { resolveTextFont, resolveFontForRun } from './textFontSpec'
import { detectScript } from '../../../../shared/scriptDetect'
import { textBlockSize } from './textLayout'
import { DEFAULT_FONT_FAMILY } from '../../../../shared/fontRegistry'
import { clampTargetBox } from '../trackingPanelState'

interface PreviewInteractionProps {
  /** The open project document — source of truth for tracks/resolution. */
  project: Project
  /** Intrinsic source sizes of the clips drawn this frame, keyed by clip id. */
  drawnSizes: Map<string, { width: number; height: number }>
}

/** Snap threshold in CANVAS (project-resolution) units. ~12px on a 1080p frame. */
const SNAP_THRESHOLD_CANVAS_PX = 12

/** Rotation snap step (degrees) when Shift is held during a rotate gesture. */
const ROTATION_SNAP_STEP_DEG = 15

/** Distance (canvas px) the rotation handle dot sits above the box top edge. */
const ROTATION_HANDLE_OFFSET_CANVAS_PX = 28

/** In-progress MOVE drag bookkeeping (component-local — not store state). */
interface MoveSession {
  kind: 'move'
  clipId: string
  /** Pointer position at drag start, in viewport (CSS) px relative to overlay. */
  startVx: number
  startVy: number
  /** Clip's transform.x/y at drag start (canvas units). */
  baseX: number
  baseY: number
  /** Source size of the dragged clip (canvas units). */
  clipW: number
  clipH: number
}

/** In-progress ROTATE drag bookkeeping. */
interface RotateSession {
  kind: 'rotate'
  clipId: string
  /** Clip center in canvas units (rotation pivots about this). */
  centerX: number
  centerY: number
  /**
   * Offset (deg) between the clip's stored rotation at gesture start and the
   * raw pointer→center angle at that moment. Subtracted from the live pointer
   * angle so grabbing the handle anywhere does not snap the clip's orientation.
   */
  angleOffset: number
}

type Session = MoveSession | RotateSession

const EDIT_PADDING_X_PX = 8
const EDIT_PADDING_Y_PX = 4

type EditWrapWidthMode = 'narrow' | 'balanced' | 'wide'

/** Parse the optional persisted wrap mode from the open `text.font` bag. */
function resolveEditWrapWidthMode(font: Record<string, unknown> | undefined): EditWrapWidthMode {
  const raw = font?.wrapWidth
  return raw === 'narrow' || raw === 'wide' ? raw : 'balanced'
}

/**
 * Aspect-aware max width cap for inline text editing.
 * - Portrait (e.g. 9:16): tighter cap so lines wrap sooner and stay readable.
 * - Square (1:1): balanced cap.
 * - Landscape (e.g. 16:9): wider cap so short titles stay on one line.
 *
 * The user can bias this via `mode` persisted on `clip.text.font.wrapWidth`.
 */
function editMaxWidthRatioForResolution(
  resolution: readonly [number, number],
  mode: EditWrapWidthMode
): number {
  const [w, h] = resolution
  if (!(w > 0) || !(h > 0)) return mode === 'narrow' ? 0.74 : mode === 'wide' ? 0.90 : 0.82
  const ratio = w / h
  if (ratio < 0.9) return mode === 'narrow' ? 0.68 : mode === 'wide' ? 0.80 : 0.74
  if (ratio <= 1.1) return mode === 'narrow' ? 0.72 : mode === 'wide' ? 0.84 : 0.78
  return mode === 'narrow' ? 0.80 : mode === 'wide' ? 0.92 : 0.86
}

/**
 * Transparent interaction overlay over the preview canvas (P3.11 + P3.12, Doc 01).
 *
 * Pointer-down inside a visible clip's drawn bounds selects it and begins a free
 * MOVE that writes `transform.x/y` (viewport deltas → canvas units via the
 * letterbox scale, with center/edge/quarter snapping). When a clip is selected a
 * rotation-aware bounding box is drawn with a grab dot above top-center; dragging
 * the dot ROTATES the clip about its center, writing `transform.rotation`
 * (degrees, Shift snaps to 15°). Both gestures use the SAME transient pattern —
 * the store's `dragTransform` carries a partial transform patch so the canvas +
 * box preview LIVE, and pointer-up commits exactly ONE undoable
 * `setClipTransformCommand` (one undo step per gesture).
 *
 * Hit-testing + the selection box are rotation-aware (compositor.ts).
 */
export function PreviewInteraction({
  project,
  drawnSizes
}: PreviewInteractionProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [guides, setGuides] = useState<SnapGuideId[]>([])
  const [cursor, setCursor] = useState<'default' | 'grabbing'>('default')

  const [resW, resH] = project.settings.resolution
  const playhead = useTimelineStore((s) => s.playhead)
  // Motion-path DRAW MODE (P8.8): when active, the overlay captures the pointer
  // stroke into the store and suppresses the normal select/move/rotate gestures.
  const motionPathDraw = useTimelineStore((s) => s.motionPathDraw)
  // Motion-tracking TARGET-PICK MODE (P8.10): when a target box is in-flight, the
  // box overlay owns the pointer (drag to move / resize) and the normal
  // select/move/rotate gestures are suppressed (like draw mode).
  const trackingTarget = useTimelineStore((s) => s.trackingTarget)
  const drawingRef = useRef(false)

  // Measure the overlay's own box so the letterbox fit matches the canvas
  // (both are sized to fill the same stage with objectFit: contain).
  useEffect(() => {
    const el = rootRef.current
    if (el === null || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r !== undefined) setViewport({ width: r.width, height: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fit: LetterboxFit = letterboxFit(resW, resH, viewport.width, viewport.height)

  /** Map a pointer event to a point in canvas (project-resolution) space. */
  const toCanvasPoint = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const el = rootRef.current
      if (el === null || fit.scale <= 0) return null
      const rect = el.getBoundingClientRect()
      const vx = clientX - rect.left - fit.offsetX
      const vy = clientY - rect.top - fit.offsetY
      return { x: vx / fit.scale, y: vy / fit.scale }
    },
    [fit.scale, fit.offsetX, fit.offsetY]
  )

  /** Begin rotating the selected clip about its center (from the handle dot). */
  const beginRotate = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, clipId: string): void => {
      const pt = toCanvasPoint(e.clientX, e.clientY)
      if (pt === null) return
      const items = visibleClipsAt(project.tracks, playhead)
      const found = items.find((i) => i.clip.id === clipId)
      const size = drawnSizes.get(clipId)
      if (found === undefined || size === undefined) return
      const bounds = clipBoundsAt(found.clip.transform, size.width, size.height, [resW, resH])
      const center = clipCenter(bounds)
      const pointerAngle = angleFromCenterDeg(center.x, center.y, pt.x, pt.y)
      sessionRef.current = {
        kind: 'rotate',
        clipId,
        centerX: center.x,
        centerY: center.y,
        angleOffset: normalizeDeg(pointerAngle - found.clip.transform.rotation)
      }
      setCursor('grabbing')
      useTimelineStore
        .getState()
        .beginTransformDrag(clipId, { rotation: found.clip.transform.rotation })
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [toCanvasPoint, project.tracks, playhead, drawnSizes, resW, resH]
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      // Motion-path DRAW MODE (P8.8): begin capturing a stroke. Each captured point
      // is in CANVAS (project-resolution) px so it is stored as a translate offset
      // directly (preview/export sample the same units). Suppresses select/move.
      if (useTimelineStore.getState().motionPathDraw !== null) {
        const pt = toCanvasPoint(e.clientX, e.clientY)
        if (pt === null) return
        drawingRef.current = true
        useTimelineStore.getState().appendMotionPathPoint(pt)
        setCursor('grabbing')
        e.currentTarget.setPointerCapture(e.pointerId)
        return
      }
      // Motion-tracking TARGET-PICK MODE (P8.10): the box overlay (a child) owns the
      // gesture; suppress select/move/rotate underneath so a click off the box does
      // not clear selection mid-pick.
      if (useTimelineStore.getState().trackingTarget !== null) return
      // While inline-editing a text clip, the overlay textarea owns the pointer;
      // do NOT start a drag or change selection underneath it (P3.14).
      if (useTimelineStore.getState().editingTextClipId !== null) return
      // The rotation handle stops propagation and begins its own gesture; this
      // body handles clip selection + move only.
      const pt = toCanvasPoint(e.clientX, e.clientY)
      if (pt === null) return
      const items = visibleClipsAt(project.tracks, playhead)
      const clipId = hitTestClip(items, drawnSizes, pt.x, pt.y, project.settings.resolution)
      if (clipId === null) {
        useTimelineStore.getState().clearSelection()
        return
      }
      const size = drawnSizes.get(clipId)
      const found = items.find((i) => i.clip.id === clipId)
      if (size === undefined || found === undefined) return

      useTimelineStore.getState().setSelection([clipId])
      sessionRef.current = {
        kind: 'move',
        clipId,
        startVx: e.clientX,
        startVy: e.clientY,
        baseX: found.clip.transform.x,
        baseY: found.clip.transform.y,
        clipW: size.width,
        clipH: size.height
      }
      setCursor('grabbing')
      useTimelineStore.getState().beginTransformDrag(clipId, {
        x: found.clip.transform.x,
        y: found.clip.transform.y
      })
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [toCanvasPoint, project.tracks, project.settings.resolution, playhead, drawnSizes]
  )

  /** Double-click a text clip to enter inline edit mode (P3.14). */
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): void => {
      const pt = toCanvasPoint(e.clientX, e.clientY)
      if (pt === null) return
      const items = visibleClipsAt(project.tracks, playhead)
      const clipId = hitTestClip(items, drawnSizes, pt.x, pt.y, project.settings.resolution)
      if (clipId === null) return
      const found = items.find((i) => i.clip.id === clipId)
      if (found === undefined || found.track.type !== 'text') return
      // Abandon any in-flight gesture, then enter edit mode.
      sessionRef.current = null
      useTimelineStore.getState().cancelTransformDrag()
      useTimelineStore.getState().beginTextEdit(clipId)
    },
    [toCanvasPoint, project.tracks, project.settings.resolution, playhead, drawnSizes]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      // Draw mode: accumulate stroke points while the pointer is down.
      if (drawingRef.current) {
        const pt = toCanvasPoint(e.clientX, e.clientY)
        if (pt !== null) useTimelineStore.getState().appendMotionPathPoint(pt)
        return
      }
      const session = sessionRef.current
      if (session === null || fit.scale <= 0) return
      if (session.kind === 'move') {
        // Viewport-pixel delta → canvas units (1 viewport px = 1/scale canvas px).
        const dx = (e.clientX - session.startVx) / fit.scale
        const dy = (e.clientY - session.startVy) / fit.scale
        const snapped = snapTransformXY(
          { x: session.baseX + dx, y: session.baseY + dy },
          [session.clipW, session.clipH],
          project.settings.resolution,
          SNAP_THRESHOLD_CANVAS_PX
        )
        setGuides(snapped.guides)
        useTimelineStore.getState().updateTransformDrag({ x: snapped.x, y: snapped.y })
        return
      }
      // Rotate: angle from center to pointer, minus the grab offset, optional snap.
      const pt = toCanvasPoint(e.clientX, e.clientY)
      if (pt === null) return
      const raw = normalizeDeg(
        angleFromCenterDeg(session.centerX, session.centerY, pt.x, pt.y) - session.angleOffset
      )
      const rotation = e.shiftKey ? snapRotationDeg(raw, ROTATION_SNAP_STEP_DEG) : raw
      useTimelineStore.getState().updateTransformDrag({ rotation })
    },
    [fit.scale, project.settings.resolution, toCanvasPoint]
  )

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, commit: boolean): void => {
      // Draw mode: finish the stroke — commit the captured polyline (≥2 points) as
      // ONE undoable motion-path command, or cancel on pointer-cancel.
      if (drawingRef.current) {
        drawingRef.current = false
        setCursor('default')
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId)
        }
        if (commit) useTimelineStore.getState().commitMotionPathDraw()
        else useTimelineStore.getState().cancelMotionPathDraw()
        return
      }
      const session = sessionRef.current
      sessionRef.current = null
      setGuides([])
      setCursor('default')
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      if (session === null) return
      const drag = useTimelineStore.getState().dragTransform
      if (commit && drag !== null) {
        useTimelineStore.getState().commitTransformDrag(drag.patch)
      } else {
        useTimelineStore.getState().cancelTransformDrag()
      }
    },
    []
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => endDrag(e, true),
    [endDrag]
  )
  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => endDrag(e, false),
    [endDrag]
  )

  return (
    <div
      ref={rootRef}
      className="absolute inset-0"
      style={{
        touchAction: 'none',
        cursor: motionPathDraw !== null ? 'crosshair' : cursor
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onDoubleClick={handleDoubleClick}
    >
      <MotionPathOverlay project={project} playhead={playhead} fit={fit} />
      {trackingTarget !== null && fit.scale > 0 ? (
        <TargetBoxOverlay box={trackingTarget.box} fit={fit} resolution={project.settings.resolution} />
      ) : null}
      {guides.length > 0 && fit.scale > 0 ? (
        <GuideOverlay guides={guides} fit={fit} resolution={project.settings.resolution} />
      ) : null}
      <SelectionOutline
        project={project}
        playhead={playhead}
        drawnSizes={drawnSizes}
        fit={fit}
        onRotateHandleDown={beginRotate}
      />
      <TextEditOverlay
        project={project}
        playhead={playhead}
        drawnSizes={drawnSizes}
        fit={fit}
      />
    </div>
  )
}

/**
 * Inline multi-line text editor (P3.14, Doc 01). When a text clip is in edit
 * mode (`editingTextClipId`), overlays a `<textarea>` roughly matching the
 * clip's drawn bounds (via `clipBoundsAt` + the letterbox scale).
 *
 * EDITING UX:
 * - ENTER inserts a manual line break (native textarea newline → a new entry in
 *   `text.lines` on commit, which splits the value on `\n`).
 * - COMMIT keys: Escape, Cmd/Ctrl-Enter, or blur. All commit the current value
 *   (Escape included — it commits rather than discards so accidental focus loss
 *   never silently drops typing; this is a deliberate "commit-on-exit" convention).
 * - One commit = ONE undoable `setClipTextCommand({ lines })`.
 *
 * The textarea stops pointer propagation so clicks inside it don't reach the
 * drag handler; the drag handler also bails while editing.
 *
 * Position/size is approximate (legible + usable, not pixel-perfect): font
 * family/fill are the same placeholders the canvas draws with (Phase 6 owns the
 * real typography).
 */
function TextEditOverlay({
  project,
  playhead,
  drawnSizes,
  fit
}: {
  project: Project
  playhead: number
  drawnSizes: Map<string, { width: number; height: number }>
  fit: LetterboxFit
}): JSX.Element | null {
  const editingTextClipId = useTimelineStore((s) => s.editingTextClipId)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const [value, setValue] = useState('')
  const [wrappedHeightPx, setWrappedHeightPx] = useState(0)

  const items = visibleClipsAt(project.tracks, playhead)
  const found = editingTextClipId === null ? undefined : items.find((i) => i.clip.id === editingTextClipId)
  const size = editingTextClipId === null ? undefined : drawnSizes.get(editingTextClipId)

  const resolvedFont = resolveTextFont(found?.clip.text?.font, {
    family: DEFAULT_FONT_FAMILY,
    sizePx: 64,
    lineHeight: 1.2
  })
  const wrapWidthMode = resolveEditWrapWidthMode(found?.clip.text?.font)
  const draftLines = valueToLines(value)
  const runScript = detectScript(draftLines.join('\n'))
  const familyList = resolveFontForRun(resolvedFont, runScript)
  const transformScale = found?.clip.transform.scale ?? 1
  const fontPx = resolvedFont.sizePx * transformScale * Math.max(fit.scale, 0)
  const lineHeight = resolvedFont.lineHeight
  const align = found?.clip.text?.align ?? 'center'

  const measuredDraft = useMemo<{ width: number; height: number }>(() => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (ctx === null) {
      const minHeight = Math.max(fontPx * lineHeight, fontPx)
      return { width: fontPx, height: minHeight }
    }
    const style = resolvedFont.italic ? 'italic ' : ''
    const weight = typeof resolvedFont.weight === 'number' ? String(resolvedFont.weight) : resolvedFont.weight
    ctx.font = `${style}${weight} ${fontPx}px ${familyList}`
    const measure = (line: string): number => ctx.measureText(line).width
    const block = textBlockSize(draftLines, fontPx, lineHeight, measure, resolvedFont.letterSpacing * fit.scale)
    return {
      width: Math.max(fontPx, block.w + EDIT_PADDING_X_PX * 2),
      height: Math.max(fontPx * lineHeight, block.h + EDIT_PADDING_Y_PX * 2)
    }
  }, [draftLines, familyList, fit.scale, fontPx, lineHeight, resolvedFont.italic, resolvedFont.letterSpacing, resolvedFont.weight])

  // Cap editor width to the stage so long typing wraps, then read the textarea's
  // natural wrapped height (scrollHeight) for live vertical autosize.
  const maxWidthRatio = useMemo(
    () => editMaxWidthRatioForResolution(project.settings.resolution, wrapWidthMode),
    [project.settings.resolution, wrapWidthMode]
  )
  const maxEditWidthPx = useMemo(
    () => Math.max(fontPx * 2, fit.width * maxWidthRatio),
    [fit.width, fontPx, maxWidthRatio]
  )
  const editWidthPx = useMemo(
    () => Math.min(Math.max(fontPx, measuredDraft.width), maxEditWidthPx),
    [fontPx, measuredDraft.width, maxEditWidthPx]
  )

  // Seed the textarea from the clip's current lines whenever editing begins.
  useEffect(() => {
    if (editingTextClipId === null || found === undefined) return
    setValue(linesToValue(found.clip.text?.lines ?? []))
    setWrappedHeightPx(0)
    // Focus + select on the next tick once mounted.
    const id = requestAnimationFrame(() => {
      const ta = taRef.current
      if (ta !== null) {
        ta.focus()
        ta.select()
      }
    })
    return () => cancelAnimationFrame(id)
    // Only re-seed when the edited clip id changes, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTextClipId])

  useLayoutEffect(() => {
    const ta = taRef.current
    if (ta === null) return
    const next = ta.scrollHeight
    setWrappedHeightPx((prev) => (prev === next ? prev : next))
  }, [value, editWidthPx, fontPx, lineHeight, familyList, resolvedFont.letterSpacing, align])

  if (editingTextClipId === null || found === undefined || size === undefined || fit.scale <= 0) {
    return null
  }

  const bounds = clipBoundsAt(found.clip.transform, size.width, size.height, project.settings.resolution)
  // Canvas px → CSS px within the overlay (rotation ignored for the box — the
  // editor stays axis-aligned for usability; the committed text re-renders rotated).
  const centerX = fit.offsetX + ((bounds.left + bounds.right) / 2) * fit.scale
  const top = fit.offsetY + bounds.top * fit.scale
  const commit = (): void => {
    useTimelineStore.getState().commitTextEdit(editingTextClipId, taRef.current?.value ?? value)
  }

  return (
    <textarea
      ref={taRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation()
        // ENTER = manual line break (let the textarea insert the newline).
        // Commit on Escape or Cmd/Ctrl-Enter.
        if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) {
          e.preventDefault()
          commit()
        }
      }}
      spellCheck={false}
      className="absolute resize-none overflow-hidden border border-accent bg-black/40 p-0 text-white outline-none"
      wrap="soft"
      style={{
        left: centerX - editWidthPx / 2,
        top,
        width: editWidthPx,
        height: Math.max(measuredDraft.height, wrappedHeightPx, fontPx * lineHeight),
        fontFamily: familyList,
        fontSize: Math.max(8, fontPx),
        lineHeight,
        textAlign: align,
        paddingLeft: EDIT_PADDING_X_PX,
        paddingRight: EDIT_PADDING_X_PX,
        paddingTop: EDIT_PADDING_Y_PX,
        paddingBottom: EDIT_PADDING_Y_PX,
        letterSpacing: resolvedFont.letterSpacing * fit.scale,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        pointerEvents: 'auto'
      }}
    />
  )
}

/**
 * Render the MOTION PATH (P8.8) as an SVG polyline over the letterboxed preview:
 * the LIVE stroke while drawing (the in-flight `motionPathDraw.points`) and, for
 * the selected clip, its PERSISTED `clip.motionPath`. Path points are CANVAS px
 * (a translate OFFSET), so they project into CSS via the letterbox fit the same
 * way clip coordinates do. Endpoints are dotted (start green, end red) so the
 * 0→1 travel direction is legible. Pointer-transparent (capture is on the root).
 */
function MotionPathOverlay({
  project,
  playhead,
  fit
}: {
  project: Project
  playhead: number
  fit: LetterboxFit
}): JSX.Element | null {
  const motionPathDraw = useTimelineStore((s) => s.motionPathDraw)
  const selection = useTimelineStore((s) => s.selection)
  if (fit.scale <= 0) return null

  const toCss = (p: { x: number; y: number }): { x: number; y: number } => ({
    x: fit.offsetX + p.x * fit.scale,
    y: fit.offsetY + p.y * fit.scale
  })

  // The persisted path of the selected clip (when not actively redrawing it).
  let persisted: { x: number; y: number }[] = []
  if (selection.length === 1) {
    const found = visibleClipsAt(project.tracks, playhead).find((i) => i.clip.id === selection[0])
    const pts = found?.clip.motionPath?.points
    if (pts !== undefined && pts.length >= 2) persisted = pts.map(toCss)
  }
  const live =
    motionPathDraw !== null && motionPathDraw.points.length >= 1
      ? motionPathDraw.points.map(toCss)
      : []

  if (persisted.length === 0 && live.length === 0) return null
  const toPoints = (cs: { x: number; y: number }[]): string => cs.map((c) => `${c.x},${c.y}`).join(' ')

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full">
      {persisted.length >= 2 ? (
        <polyline
          points={toPoints(persisted)}
          fill="none"
          stroke="#22d3ee"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          opacity={0.8}
        />
      ) : null}
      {live.length >= 2 ? (
        <polyline points={toPoints(live)} fill="none" stroke="#22d3ee" strokeWidth={2} />
      ) : null}
      {(live.length > 0 ? live : persisted).length > 0
        ? (() => {
          const path = live.length > 0 ? live : persisted
          const start = path[0]
          const end = path[path.length - 1]
          return (
            <>
              <circle cx={start.x} cy={start.y} r={4} fill="#4ade80" />
              <circle cx={end.x} cy={end.y} r={4} fill="#f87171" />
            </>
          )
        })()
        : null}
    </svg>
  )
}

/**
 * The in-flight motion-tracking TARGET BOX (P8.10, Doc 11; skill `motion-tracking`).
 * When the panel begins a target pick (`trackingTarget`), this draggable +
 * resizable rectangle overlays the preview so the user frames the subject
 * (face/object) before running the tracker. The box `(x,y)` is the CENTER in canvas
 * (project-resolution) px — the same space the produced path is taken relative to —
 * projected to CSS through the letterbox `fit`. Dragging the body moves the center;
 * the corner handle resizes about the center. Both write the transient box back via
 * `updateTrackTarget` (clamped to the canvas); nothing is persisted until Track.
 */
function TargetBoxOverlay({
  box,
  fit,
  resolution
}: {
  box: TargetBox
  fit: LetterboxFit
  resolution: readonly [number, number]
}): JSX.Element {
  const sessionRef = useRef<{
    mode: 'move' | 'resize'
    startVx: number
    startVy: number
    box: TargetBox
  } | null>(null)

  const left = fit.offsetX + (box.x - box.width / 2) * fit.scale
  const top = fit.offsetY + (box.y - box.height / 2) * fit.scale
  const widthPx = box.width * fit.scale
  const heightPx = box.height * fit.scale

  const begin = (mode: 'move' | 'resize') => (e: React.PointerEvent<HTMLDivElement>): void => {
    e.stopPropagation()
    sessionRef.current = { mode, startVx: e.clientX, startVy: e.clientY, box }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const s = sessionRef.current
    if (s === null || fit.scale <= 0) return
    e.stopPropagation()
    const dx = (e.clientX - s.startVx) / fit.scale
    const dy = (e.clientY - s.startVy) / fit.scale
    if (s.mode === 'move') {
      const next = clampTargetBox({ ...s.box, x: s.box.x + dx, y: s.box.y + dy }, resolution)
      useTimelineStore.getState().updateTrackTarget({ x: next.x, y: next.y })
    } else {
      // Corner handle grows symmetrically about the center (both edges move).
      const next = clampTargetBox(
        { ...s.box, width: s.box.width + dx * 2, height: s.box.height + dy * 2 },
        resolution
      )
      useTimelineStore.getState().updateTrackTarget({ width: next.width, height: next.height })
    }
  }
  const onUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    sessionRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  return (
    <div
      role="group"
      aria-label="Tracking target box"
      className="absolute cursor-move border-2 border-accent bg-accent/10"
      style={{ left, top, width: Math.max(8, widthPx), height: Math.max(8, heightPx), touchAction: 'none' }}
      onPointerDown={begin('move')}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {/* Center crosshair so the subject can be framed precisely. */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent" />
      {/* Bottom-right resize handle. */}
      <div
        aria-label="Resize tracking target"
        className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize border border-accent bg-accent"
        style={{ touchAction: 'none' }}
        onPointerDown={begin('resize')}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
    </div>
  )
}

/** Draw the engaged alignment guide lines (magenta) over the letterboxed area. */
function GuideOverlay({
  guides,
  fit,
  resolution
}: {
  guides: SnapGuideId[]
  fit: LetterboxFit
  resolution: readonly [number, number]
}): JSX.Element {
  const [resW, resH] = resolution
  // Canvas-space line position for each guide → CSS px within the overlay.
  const verticalAt: Partial<Record<SnapGuideId, number>> = {
    cx: resW / 2,
    left: 0,
    right: resW,
    'qx-left': resW / 4,
    'qx-right': (resW * 3) / 4
  }
  const horizontalAt: Partial<Record<SnapGuideId, number>> = {
    cy: resH / 2,
    top: 0,
    bottom: resH,
    'qy-top': resH / 4,
    'qy-bottom': (resH * 3) / 4
  }
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full">
      {guides.map((g) => {
        const vx = verticalAt[g]
        if (vx !== undefined) {
          const x = fit.offsetX + vx * fit.scale
          return (
            <line
              key={g}
              x1={x}
              y1={fit.offsetY}
              x2={x}
              y2={fit.offsetY + fit.height}
              stroke="#ff00ff"
              strokeWidth={1}
            />
          )
        }
        const vy = horizontalAt[g]
        if (vy !== undefined) {
          const y = fit.offsetY + vy * fit.scale
          return (
            <line
              key={g}
              x1={fit.offsetX}
              y1={y}
              x2={fit.offsetX + fit.width}
              y2={y}
              stroke="#ff00ff"
              strokeWidth={1}
            />
          )
        }
        return null
      })}
    </svg>
  )
}

/**
 * Draw a rotation-aware selection box around the selected clip plus a rotation
 * handle dot above its (rotated) top-center. The box rotates WITH the clip:
 * the four corners come from `rotatedClipCorners`, drawn as an SVG polygon in
 * letterboxed CSS px. The handle is an `<svg>` circle that begins the rotate
 * gesture on pointer-down.
 *
 * Reflects the live transient patch (`dragTransform`) so the box + handle track
 * a move or rotate gesture in real time.
 */
function SelectionOutline({
  project,
  playhead,
  drawnSizes,
  fit,
  onRotateHandleDown
}: {
  project: Project
  playhead: number
  drawnSizes: Map<string, { width: number; height: number }>
  fit: LetterboxFit
  onRotateHandleDown: (e: React.PointerEvent<HTMLDivElement>, clipId: string) => void
}): JSX.Element | null {
  const selection = useTimelineStore((s) => s.selection)
  const dragTransform = useTimelineStore((s) => s.dragTransform)
  if (selection.length !== 1 || fit.scale <= 0) return null
  const clipId = selection[0]
  const items = visibleClipsAt(project.tracks, playhead)
  const found = items.find((i) => i.clip.id === clipId)
  const size = drawnSizes.get(clipId)
  if (found === undefined || size === undefined) return null

  const transform: ClipTransform =
    dragTransform !== null && dragTransform.clipId === clipId
      ? { ...found.clip.transform, ...dragTransform.patch }
      : found.clip.transform

  const bounds = clipBoundsAt(transform, size.width, size.height, project.settings.resolution)
  // Canvas px → CSS px within the overlay.
  const toCss = (p: { x: number; y: number }): { x: number; y: number } => ({
    x: fit.offsetX + p.x * fit.scale,
    y: fit.offsetY + p.y * fit.scale
  })
  const corners = rotatedClipCorners(bounds, transform.rotation).map(toCss)
  const polygon = corners.map((c) => `${c.x},${c.y}`).join(' ')

  // Handle sits above the TOP edge midpoint, rotated with the box. The top edge
  // midpoint is the average of corners[0] (top-left) & corners[1] (top-right);
  // push it outward along the box's "up" normal by the handle offset.
  const rad = (transform.rotation * Math.PI) / 180
  const up = { x: Math.sin(rad), y: -Math.cos(rad) } // box-local -y in canvas space
  const topMidCanvas = {
    x: (corners[0].x + corners[1].x) / 2,
    y: (corners[0].y + corners[1].y) / 2
  }
  const handle = {
    x: topMidCanvas.x + up.x * ROTATION_HANDLE_OFFSET_CANVAS_PX * fit.scale,
    y: topMidCanvas.y + up.y * ROTATION_HANDLE_OFFSET_CANVAS_PX * fit.scale
  }

  return (
    <svg className="absolute inset-0 h-full w-full" style={{ pointerEvents: 'none' }}>
      <polygon
        points={polygon}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        className="text-accent"
      />
      <line
        x1={topMidCanvas.x}
        y1={topMidCanvas.y}
        x2={handle.x}
        y2={handle.y}
        stroke="currentColor"
        strokeWidth={1}
        className="text-accent"
      />
      <circle
        cx={handle.x}
        cy={handle.y}
        r={6}
        className="text-accent"
        fill="currentColor"
        style={{ pointerEvents: 'auto', cursor: 'grab' }}
        onPointerDown={(e) => {
          e.stopPropagation()
          // Re-dispatch onto the overlay-level handler with a div-typed event.
          onRotateHandleDown(e as unknown as React.PointerEvent<HTMLDivElement>, clipId)
        }}
      />
    </svg>
  )
}

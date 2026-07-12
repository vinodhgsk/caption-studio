import { useCallback, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Clip } from '../../../../shared/project-schema'
import { clipDuration } from '../../../../shared/project-schema'
import type { ProjectTrack } from '../../../../shared/storage'
import { useProjectStore } from '@/store/projectStore'
import { useTimelineStore } from '@/store/timelineStore'
import { useEditorStore } from '@/store/editorStore'
import { clampTrim, type TrimEdge } from '@/store/timeline'
import { wouldOverlapOnTrack } from '@/store/timeline'
import { pxToTime, timeToPx } from './scale'
import { gatherSnapTargets, snapStart } from './snapping'
import { collectBeatMarkers, snapTrimEdgeToBeat } from '@/store/timeline/beatMarkers'
import { WaveformStrip } from './WaveformStrip'
import { clipLabel } from './virtualize'
import { confidenceTier, tierColour, lowConfidenceFraction } from './confidenceHeatmap'

interface TimelineClipProps {
  clip: Clip
  /** The owning track's type — selects the placeholder strip style. */
  trackType: ProjectTrack['type']
  /** Active timeline scale, in pixels per second. */
  pxPerSec: number
  /**
   * Resolved bundle absolute path (P4.2) so audio clips can decode + render
   * their real waveform. Null until resolved / no project open.
   */
  bundleAbs: string | null
}

/** Minimum on-screen clip width (px) so a very short clip stays clickable. */
const MIN_CLIP_PX = 8
/** Snap tolerance, in screen pixels (constant feel at any zoom). */
const SNAP_PX = 8
/** Pixels of pointer travel before a press is treated as a drag (vs a click). */
const DRAG_THRESHOLD_PX = 3
/** Width (px) of each edge grab handle for trim (P3.6). */
const TRIM_HANDLE_PX = 8

/** Live, per-drag state held locally so pointermove never touches the store/command stack. */
interface DragState {
  pointerId: number
  /** Pointer x at pointerdown, in client px. */
  originClientX: number
  /** Pointer y at pointerdown, in client px (for cross-track vertical drag). */
  originClientY: number
  /** The clip's start at pointerdown, in seconds. */
  originStartSec: number
  /** Snap-target times (seconds) gathered once at drag start. */
  targets: number[]
}

/** Live, per-trim state for an edge resize (P3.6). Local only — no store writes. */
interface TrimState {
  pointerId: number
  /** Which edge is being resized. */
  edge: TrimEdge
  /** Pointer x at pointerdown, in client px. */
  originClientX: number
  /** The clip's in/out/start at pointerdown (the trim origin). */
  origin: { in: number; out: number; start: number }
  /** Beat-marker times (timeline seconds) gathered once at trim start (P8.12). */
  beats: number[]
}

/**
 * One positioned clip block on a timeline lane (P3.4) with drag-move + snapping
 * (P3.5).
 *
 * Geometry comes from the pure `timeToPx` helper (constraint C): `left` from the
 * clip's `start`, `width` from its derived `clipDuration`. The body shows a label
 * (media basename) plus a strip: a REAL decoded waveform for audio clips (P4.2)
 * or a thumbnail STRIP PLACEHOLDER for video/image clips.
 *
 * DRAG-MOVE (P3.5): pointerdown captures the pointer + the clip's start + the
 * snap targets; pointermove updates a LOCAL preview start (no store writes, no
 * command per move); pointerup commits the FINAL start as ONE undoable command
 * (`timelineStore.moveClip` -> `moveClipCommand` -> `runCommand`). When
 * `timelineStore.snap` is on, the pure `snapStart` helper aligns the dragged
 * start/end to the nearest target (playhead, other clip edges, markers) within
 * `SNAP_PX`; the matched target is drawn as a thin accent guide line. When snap
 * is off the move is free (clamped to `start >= 0`). A press that never crosses
 * `DRAG_THRESHOLD_PX` is treated as a plain click (select only).
 *
 * DRAG-TRIM (P3.6): the clip has a LEFT and RIGHT edge grab handle (a few px
 * wide, accent on hover, `cursor-ew-resize`). They are SEPARATE hit zones layered
 * over the body and call `e.stopPropagation()` on pointerdown so grabbing a
 * handle never starts the body-move. Pointerdown captures the clip's prior
 * in/out/start; pointermove computes a LOCAL preview via the SAME pure
 * `clampTrim` helper the reducer uses (so preview == commit); pointerup commits
 * exactly ONE undoable `trimClipCommand` (only if the edge actually changed).
 * Left-edge drags move `in` AND `start` together so kept frames stay anchored.
 * `sourceDurationSec` is undefined today (no upper cap on the right edge);
 * TODO(P4): pass the probed source duration. Trim edges are NOT snapped (kept
 * simple — body-move snapping is unchanged); snapping a trim edge could reuse
 * `snapStart`-style targets later.
 *
 * Split/ripple (P3.7) and the rAF clock (P3.8) are NOT here. All px<->sec +
 * clamp math lives in pure helpers (`scale`, `snapping`, `trim`); this component
 * only wires pointer events.
 *
 * AUDIO WAVEFORM (P4.2): audio clips render their REAL decoded waveform via
 * `WaveformStrip` (decoded once per media, sliced to `[in, out]`, downsampled to
 * the clip's pixel width). Video/image clips keep the placeholder thumb strip.
 * TODO(P4): replace the video placeholder strip with real thumbnails via ffmpeg.
 */

/**
 * A thin bottom strip on caption clips showing per-word alignment confidence.
 * Rendered only when at least one word carries a `confidence` value (lyrics-first
 * mode). Each word gets a proportional segment coloured by confidence tier:
 *   green (≥ 0.8) = well-timed  |  amber (0.6–0.8) = acceptable  |  red (< 0.6) = needs review
 * A small dot badge flags clips where > 20 % of words are low-confidence.
 */
function ConfidenceHeatmap({ clip, durationSec }: { clip: Clip; durationSec: number }): JSX.Element | null {
  const words = clip.caption?.words
  if (!words || words.length === 0) return null
  const hasConfidence = words.some((w) => w.confidence !== undefined)
  if (!hasConfidence) return null

  const lowFrac = lowConfidenceFraction(words.map((w) => w.confidence))
  const showBadge = lowFrac > 0.2

  return (
    <>
      {/* Per-word colour segments — occupies the bottom 6 px of the clip. */}
      <div
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-1.5 overflow-hidden rounded-b-md"
        aria-hidden="true"
        data-testid="confidence-heatmap"
      >
        {words.map((w, i) => {
          const leftFrac = durationSec > 0 ? (w.start - clip.start) / durationSec : 0
          const widthFrac = durationSec > 0 ? (w.end - w.start) / durationSec : 0
          const colour = tierColour(confidenceTier(w.confidence ?? 1))
          return (
            <div
              key={i}
              className={`absolute top-0 h-full ${colour}`}
              style={{
                left: `${(Math.max(0, leftFrac) * 100).toFixed(2)}%`,
                width: `${(Math.max(0, widthFrac) * 100).toFixed(2)}%`
              }}
            />
          )
        })}
      </div>

      {/* Low-confidence badge: amber dot in the bottom-right corner. */}
      {showBadge && (
        <span
          className="pointer-events-none absolute bottom-2 right-1 z-10 h-2 w-2 rounded-full bg-amber-400 ring-1 ring-black/30"
          aria-label="Low alignment confidence — review recommended"
          title="Low alignment confidence — review timing"
          data-testid="low-confidence-badge"
        />
      )}
    </>
  )
}

export function TimelineClip({ clip, trackType, pxPerSec, bundleAbs }: TimelineClipProps): JSX.Element {
  const selected = useTimelineStore((s) => s.selection.includes(clip.id))
  const setSelection = useTimelineStore((s) => s.setSelection)
  const seek = useTimelineStore((s) => s.seek)
  const isPlaying = useTimelineStore((s) => s.isPlaying)
  const moveClip = useTimelineStore((s) => s.moveClip)
  const trimClip = useTimelineStore((s) => s.trimClip)
  const removeClip = useTimelineStore((s) => s.removeClip)
  const moveClipToTrack = useTimelineStore((s) => s.moveClipToTrack)
  const moveClipToNewTrack = useTimelineStore((s) => s.moveClipToNewTrack)
  const setActivePanel = useEditorStore((s) => s.setActivePanel)

  // Right-click context menu anchor (client px), null = closed (CapCut-style).
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  // Vertical pointer offset (px) during a drag, for the CapCut-style "clip
  // follows the cursor across lanes" preview. Null = not dragging vertically.
  const [previewOffsetY, setPreviewOffsetY] = useState<number | null>(null)

  // Live preview position during a drag (null = not dragging / use clip.start).
  const [previewStart, setPreviewStart] = useState<number | null>(null)
  // Target time the current preview snapped to, for the guide line (null = none).
  const [snappedTo, setSnappedTo] = useState<number | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const movedRef = useRef(false)

  // Live preview in/out/start during a trim (null = not trimming / use clip).
  const [previewTrim, setPreviewTrim] = useState<{ in: number; out: number; start: number } | null>(
    null
  )
  const trimRef = useRef<TrimState | null>(null)
  const trimmedRef = useRef(false)

  const durationSec = clipDuration(clip)

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>): void => {
      if (e.button !== 0) return
      // Select on press so the active clip is obvious during the drag.
      setSelection([clip.id])

      const project = useProjectStore.getState().currentProject
      const { snap, playhead } = useTimelineStore.getState()
      // Beat markers (P8.12) join the snap targets so clip START + caption
      // appearance align to the music; only when snap is on.
      const beats = snap ? collectBeatMarkers(project?.tracks ?? []) : []
      const targets = snap
        ? gatherSnapTargets(project?.tracks ?? [], playhead, clip.id, beats)
        : []

      dragRef.current = {
        pointerId: e.pointerId,
        originClientX: e.clientX,
        originClientY: e.clientY,
        originStartSec: clip.start,
        targets
      }
      movedRef.current = false
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [clip.id, clip.start, setSelection]
  )

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>): void => {
      const drag = dragRef.current
      if (drag === null || e.pointerId !== drag.pointerId) return

      const deltaPx = e.clientX - drag.originClientX
      if (!movedRef.current && Math.abs(deltaPx) < DRAG_THRESHOLD_PX) return
      movedRef.current = true

      const rawStart = drag.originStartSec + pxToTime(deltaPx, pxPerSec)

      // `targets` is non-empty only when snap was on at drag start (gathered then).
      let nextStart = rawStart
      let nextSnap: number | null = null
      if (drag.targets.length > 0) {
        const result = snapStart(rawStart, durationSec, drag.targets, SNAP_PX, pxPerSec)
        nextStart = result.start
        nextSnap = result.snappedTo
      }
      // Clamp the clip to the timeline origin (snap may push the start negative).
      const clampedStart = Math.max(0, nextStart)
      setPreviewStart(clampedStart)
      setSnappedTo(clampedStart === nextStart ? nextSnap : null)
      // Vertical follow: translate the clip toward the cursor's lane (CapCut-style
      // cross-track drag). Committed to a real track change on pointerup.
      setPreviewOffsetY(e.clientY - drag.originClientY)
    },
    [durationSec, pxPerSec]
  )

  const endDrag = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>): void => {
      const drag = dragRef.current
      if (drag === null || e.pointerId !== drag.pointerId) return

      const finalStart = previewStart
      const buttonEl = e.currentTarget
      dragRef.current = null
      setPreviewStart(null)
      setSnappedTo(null)
      setPreviewOffsetY(null)
      if (buttonEl.hasPointerCapture(e.pointerId)) {
        buttonEl.releasePointerCapture(e.pointerId)
      }

      if (movedRef.current) {
        const commitStart = finalStart ?? drag.originStartSec
        const startChanged = commitStart !== drag.originStartSec
        const project = useProjectStore.getState().currentProject

        // Hit-test the lane under the cursor for a CapCut-style cross-track drop.
        // The dragged button is topmost at the point; its owning (source) lane is
        // its DOM ancestor, while the visually-overlapped TARGET lane sits beneath
        // it in the stacking list. Find the first `[data-track-id]` element.
        const sourceTrackId =
          buttonEl.closest<HTMLElement>('[data-track-id]')?.dataset.trackId ?? null
        const dropLane = document
          .elementsFromPoint(e.clientX, e.clientY)
          .find(
            (el): el is HTMLElement => el instanceof HTMLElement && el.dataset.trackId !== undefined
          )
        const targetTrackId = dropLane?.dataset.trackId ?? null
        const targetType = dropLane?.dataset.trackType ?? null

        // All lanes in track order (for index math + "past the last lane" test).
        const laneEls = Array.from(document.querySelectorAll<HTMLElement>('[data-track-id]'))
        const laneIndexOf = (trackId: string | null): number =>
          trackId === null
            ? -1
            : laneEls.findIndex((el) => el.dataset.trackId === trackId)
        const lastLane = laneEls[laneEls.length - 1]
        // Dropped below EVERY lane → spawn a fresh lane at the very bottom.
        const belowAllLanes =
          lastLane !== undefined && e.clientY > lastLane.getBoundingClientRect().bottom

        const crossedTrack =
          targetTrackId !== null && targetTrackId !== sourceTrackId && targetType === trackType

        if (belowAllLanes) {
          // Drag past the last track: append a new lane and drop the clip there.
          moveClipToNewTrack(clip.id, trackType, commitStart, laneEls.length)
        } else if (crossedTrack && targetTrackId !== null) {
          // Cross-lane drop. If the target lane is crowded (would overlap), spawn a
          // fresh lane just below it instead of piling clips on top of each other.
          const crowded =
            project !== null &&
            wouldOverlapOnTrack(project, targetTrackId, commitStart, durationSec, clip.id)
          if (crowded) {
            moveClipToNewTrack(clip.id, trackType, commitStart, laneIndexOf(targetTrackId) + 1)
          } else {
            moveClipToTrack(clip.id, targetTrackId, commitStart)
          }
        } else if (startChanged) {
          // Same lane. If the new position would overlap a sibling clip, spawn a
          // fresh lane just below the source; otherwise commit the horizontal move.
          const crowded =
            project !== null &&
            sourceTrackId !== null &&
            wouldOverlapOnTrack(project, sourceTrackId, commitStart, durationSec, clip.id)
          if (crowded) {
            moveClipToNewTrack(clip.id, trackType, commitStart, laneIndexOf(sourceTrackId) + 1)
          } else {
            moveClip(clip.id, commitStart)
          }
        }
      }
      movedRef.current = false
    },
    [clip.id, durationSec, moveClip, moveClipToNewTrack, moveClipToTrack, previewStart, trackType]
  )

  // --- Trim (P3.6): edge resize, distinct from the body-move above. ---
  const handleTrimPointerDown = useCallback(
    (edge: TrimEdge) =>
      (e: ReactPointerEvent<HTMLDivElement>): void => {
        if (e.button !== 0) return
        // Separate hit zone: never let the body-drag (on the parent button) start.
        e.stopPropagation()
        setSelection([clip.id])
        const { snap } = useTimelineStore.getState()
        const project = useProjectStore.getState().currentProject
        trimRef.current = {
          pointerId: e.pointerId,
          edge,
          originClientX: e.clientX,
          origin: { in: clip.in, out: clip.out, start: clip.start },
          beats: snap ? collectBeatMarkers(project?.tracks ?? []) : []
        }
        trimmedRef.current = false
        e.currentTarget.setPointerCapture(e.pointerId)
      },
    [clip.in, clip.out, clip.start, clip.id, setSelection]
  )

  const handleTrimPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      const trim = trimRef.current
      if (trim === null || e.pointerId !== trim.pointerId) return

      const deltaPx = e.clientX - trim.originClientX
      if (!trimmedRef.current && Math.abs(deltaPx) < DRAG_THRESHOLD_PX) return
      trimmedRef.current = true

      const deltaSec = pxToTime(deltaPx, pxPerSec)
      // SAME pure helper the reducer uses → preview matches the eventual commit.
      // sourceDurationSec is undefined today (no upper cap). TODO(P4): pass probed.
      const clamped = clampTrim(trim.origin, trim.edge, deltaSec)
      // P8.12: snap the moving edge (in/start or out) to a nearby beat. Tolerance
      // is the same SNAP_PX feel, converted to seconds at the current zoom.
      const next =
        trim.beats.length > 0
          ? snapTrimEdgeToBeat(clamped, trim.edge, trim.beats, SNAP_PX / pxPerSec)
          : clamped
      setPreviewTrim(next)
    },
    [pxPerSec]
  )

  const endTrim = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      const trim = trimRef.current
      if (trim === null || e.pointerId !== trim.pointerId) return

      const finalTrim = previewTrim
      trimRef.current = null
      setPreviewTrim(null)
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }

      // Commit exactly ONE undoable command — only if the edge actually changed.
      // The committed delta is the full clamped edge delta from the trim origin;
      // the reducer re-clamps it identically, so commit == preview.
      if (trimmedRef.current && finalTrim !== null) {
        const delta =
          trim.edge === 'start'
            ? finalTrim.in - trim.origin.in
            : finalTrim.out - trim.origin.out
        if (delta !== 0) trimClip(clip.id, trim.edge, delta)
      }
      trimmedRef.current = false
    },
    [clip.id, previewTrim, trimClip]
  )

  const effectiveStart = previewTrim?.start ?? previewStart ?? clip.start
  const effectiveDurationSec =
    previewTrim !== null ? previewTrim.out - previewTrim.in : durationSec
  const leftPx = timeToPx(effectiveStart, pxPerSec)
  const widthPx = Math.max(MIN_CLIP_PX, timeToPx(effectiveDurationSec, pxPerSec))
  const guidePx = snappedTo !== null ? timeToPx(snappedTo, pxPerSec) : null
  const isAudio = trackType === 'audio'

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setSelection([clip.id])
          if (!isPlaying) seek(clip.start)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setSelection([clip.id])
          setMenuPos({ x: e.clientX, y: e.clientY })
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`group absolute top-1 bottom-1 flex cursor-grab touch-none select-none flex-col overflow-hidden rounded-md border bg-surface-2 text-left active:cursor-grabbing ${selected ? 'border-accent ring-1 ring-accent' : 'border-line'
          } ${previewOffsetY !== null ? 'z-30 opacity-90 shadow-lg' : ''}`}
        style={{
          left: `${leftPx}px`,
          width: `${widthPx}px`,
          transform: previewOffsetY !== null ? `translateY(${previewOffsetY}px)` : undefined
        }}
        data-clip-id={clip.id}
        aria-pressed={selected}
        title={clipLabel(clip)}
      >
        {/* Audio: real decoded waveform (P4.2), sliced to the clip's source
            window + downsampled to its pixel width. Falls back to a deterministic
            placeholder shape until the shared per-media decode resolves.
            Video/image: thumbnail-frame placeholder strip. TODO(P4): real thumbs. */}
        {isAudio ? (
          <WaveformStrip clip={clip} widthPx={widthPx} bundleAbs={bundleAbs} />
        ) : (
          // Repeating thumbnail-frame placeholder strip (deterministic, token-driven).
          <div
            className="pointer-events-none h-full w-full opacity-40"
            aria-hidden="true"
            style={{
              backgroundImage:
                'repeating-linear-gradient(90deg, currentColor 0 1px, transparent 1px 28px)'
            }}
          />
        )}

        {/* Label overlay. */}
        <span className="pointer-events-none absolute left-1 top-0.5 max-w-full truncate pr-1 text-[10px] font-medium text-text-primary">
          {clipLabel(clip)}
        </span>

        {/* Hover delete (×): appears on hover (CapCut-style quick delete). Its
            own hit zone; stopPropagation keeps it from starting a body-move. */}
        <span
          role="button"
          aria-label="Delete clip"
          title="Delete clip"
          className="absolute right-0.5 top-0.5 z-30 hidden h-4 w-4 cursor-pointer items-center justify-center rounded-sm bg-black/50 text-[11px] leading-none text-white hover:bg-danger group-hover:flex"
          onPointerDown={(e) => {
            e.stopPropagation()
            e.preventDefault()
          }}
          onClick={(e) => {
            e.stopPropagation()
            removeClip(clip.id)
          }}
        >
          ×
        </span>

        {/* Trim handles (P3.6): separate hit zones; stopPropagation keeps the
            body-move from starting. ew-resize cursor, accent on hover. */}
        <div
          role="separator"
          aria-label="Trim clip start"
          className="absolute left-0 top-0 bottom-0 z-20 cursor-ew-resize touch-none bg-accent/0 hover:bg-accent/60"
          style={{ width: `${TRIM_HANDLE_PX}px` }}
          onPointerDown={handleTrimPointerDown('start')}
          onPointerMove={handleTrimPointerMove}
          onPointerUp={endTrim}
          onPointerCancel={endTrim}
        />
        <div
          role="separator"
          aria-label="Trim clip end"
          className="absolute right-0 top-0 bottom-0 z-20 cursor-ew-resize touch-none bg-accent/0 hover:bg-accent/60"
          style={{ width: `${TRIM_HANDLE_PX}px` }}
          onPointerDown={handleTrimPointerDown('end')}
          onPointerMove={handleTrimPointerMove}
          onPointerUp={endTrim}
          onPointerCancel={endTrim}
        />

        {/* Confidence heatmap (lyrics-first caption clips only): a bottom strip
            where each word segment is coloured by alignment confidence.
            No-ops for all other clip types / auto-mode caption clips. */}
        <ConfidenceHeatmap clip={clip} durationSec={durationSec} />

        {/* Transition badge — In edge (left). A thin colored strip with a label
            showing the first letter of the preset. Click opens the Transitions
            panel. Only rendered when clip.transitions.in is set. */}
        {clip.transitions?.in !== undefined && (
          <span
            role="button"
            aria-label="In transition — open Transitions panel"
            title="In transition"
            className="absolute left-0 top-0 bottom-0 z-20 flex w-1 cursor-pointer items-center justify-center bg-blue-500/80 hover:w-2 hover:bg-blue-500"
            onPointerDown={(e) => {
              e.stopPropagation()
              e.preventDefault()
            }}
            onClick={(e) => {
              e.stopPropagation()
              setSelection([clip.id])
              setActivePanel('transitions')
            }}
          />
        )}

        {/* Transition badge — Out edge (right). Same pattern for the out transition. */}
        {clip.transitions?.out !== undefined && (
          <span
            role="button"
            aria-label="Out transition — open Transitions panel"
            title="Out transition"
            className="absolute right-0 top-0 bottom-0 z-20 flex w-1 cursor-pointer items-center justify-center bg-purple-500/80 hover:w-2 hover:bg-purple-500"
            onPointerDown={(e) => {
              e.stopPropagation()
              e.preventDefault()
            }}
            onClick={(e) => {
              e.stopPropagation()
              setSelection([clip.id])
              setActivePanel('transitions')
            }}
          />
        )}
      </button>

      {/* Snap guide: a thin accent vertical line at the active snap target. */}
      {guidePx !== null && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-accent"
          style={{ left: `${guidePx}px` }}
        />
      )}

      {/* Right-click context menu (CapCut-style): Delete clip. Fixed-position
          overlay + a full-screen backdrop that closes it on any outside click. */}
      {menuPos !== null && (
        <>
          <div
            className="fixed inset-0 z-40"
            aria-hidden="true"
            onPointerDown={() => setMenuPos(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenuPos(null)
            }}
          />
          <div
            role="menu"
            className="fixed z-50 min-w-32 overflow-hidden rounded-md border border-line bg-surface-2 py-1 text-xs shadow-lg"
            style={{ left: `${menuPos.x}px`, top: `${menuPos.y}px` }}
          >
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-danger hover:text-white"
              onClick={() => {
                removeClip(clip.id)
                setMenuPos(null)
              }}
            >
              Delete clip
            </button>
          </div>
        </>
      )}
    </>
  )
}

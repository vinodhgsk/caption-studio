import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import type { Project } from '../../../../shared/storage'
import { useTimelineStore } from '@/store/timelineStore'
import { useProjectStore } from '@/store/projectStore'
import {
  autoViewModeLabel,
  pointerToTime,
  projectDurationSec,
  timelineRenderDurationSec,
  timeToPx,
  zoomToFitPxPerSec
} from './scale'
import { collectBeatMarkers } from '@/store/timeline/beatMarkers'
import { usePlayheadClock } from '../usePlayheadClock'
import { useVisibleWindow } from './useVisibleWindow'
import { EditControls } from './EditControls'
import { TimeRuler } from './TimeRuler'
import { TrackHeader } from './TrackHeader'
import { TrackLane } from './TrackLane'
import { KeyframeLanes } from './KeyframeLane'
import { useBundlePath } from './useBundlePath'
import { ZoomControl } from './ZoomControl'
import { AddTrackControl } from './AddTrackControl'
/** True when the keyboard event originates from an editable/text field. */
function isFromTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

interface TimelineProps {
  project: Project
}

/** Uniform lane / header row height (px) so headers and lanes line up. */
const LANE_HEIGHT_PX = 44
/** Width of the left track-header column (px). */
const HEADER_WIDTH_PX = 132
/**
 * Multi-track timeline (P3.2): a fixed track-header column on the left and a
 * horizontally-scrollable ruler + lanes area on the right. The ruler and every
 * lane share ONE scroll container and ONE `pxPerSec` scale (from
 * `timelineStore.zoom`), so clips added in P3.4 line up with time.
 *
 * The playhead (constraint A) is READ from `timelineStore.playhead` and drawn as
 * a vertical marker over the ruler + lanes. The SINGLE authoritative rAF clock
 * (P3.8) is mounted here via `usePlayheadClock`, and the ruler is draggable to
 * scrub (frame-snapped seek).
 */
export function Timeline({ project }: TimelineProps): JSX.Element {
  const zoom = useTimelineStore((s) => s.zoom)
  const playhead = useTimelineStore((s) => s.playhead)
  const selection = useTimelineStore((s) => s.selection)
  const splitSelectedAtPlayhead = useTimelineStore((s) => s.splitSelectedAtPlayhead)
  const rippleDeleteSelected = useTimelineStore((s) => s.rippleDeleteSelected)

  // Keyframe lanes (P8.6, Doc 11) render ONLY for a single selected clip, below
  // the track lanes — hidden otherwise so existing timeline rendering is intact.
  const selectedClip =
    selection.length === 1
      ? project.tracks.flatMap((t) => t.clips).find((c) => c.id === selection[0]) ?? null
      : null

  // Beat markers (P8.12, Doc 11): distinct timeline-time beats across all audio
  // clips, drawn as faint guides so clip/caption edges can be aligned to music.
  const beatMarkers = useMemo(() => collectBeatMarkers(project.tracks), [project.tracks])

  const scrollRef = useRef<HTMLDivElement>(null)
  const autoZoomProjectKeyRef = useRef<string | null>(null)
  const prevClipCountRef = useRef(0)
  const view = useVisibleWindow(scrollRef, zoom)
  const currentRef = useProjectStore((s) => s.currentRef)
  // Resolved ONCE per project ref so audio lanes can decode waveforms without
  // each clip re-issuing the storage IPC.
  const bundleAbs = useBundlePath()

  // Mount the SINGLE authoritative playhead clock once, driven by this project's
  // actual duration.
  usePlayheadClock(project.tracks)

  /**
   * Scrub mapping: translate a pointer's viewport x into a frame-snapped seek.
   * Reads the shared scroll container's bounding rect + scrollLeft so the local
   * content x is correct regardless of scroll position. `pointerToTime` is the
   * pure mapping; `seek` applies the frame snap at project fps.
   */
  const scrubTo = useCallback((clientX: number): void => {
    const el = scrollRef.current
    if (el === null) return
    const rectLeft = el.getBoundingClientRect().left
    const { seek } = useTimelineStore.getState()
    seek(pointerToTime(clientX, rectLeft, el.scrollLeft, zoom))
  }, [zoom])

  /**
   * Zoom-to-fit (P3.10): set `pxPerSec` so the whole project fits the timeline
   * viewport. Lives HERE (not in the transport bar) because the scroll
   * container's measured `clientWidth` is the viewport — keeping the DOM read
   * local is cleaner than lifting the width into the store. The math is the
   * pure, tested `zoomToFitPxPerSec` (already clamps to the zoom range).
   */
  const zoomToFit = useCallback((): void => {
    const el = scrollRef.current
    if (el === null) return
    const duration = timelineRenderDurationSec(project.tracks)
    useTimelineStore.getState().setZoom(zoomToFitPxPerSec(duration, el.clientWidth))
  }, [project.tracks])

  /** Pointer-down on the ruler: pause playback and begin a (possibly zero-distance) scrub drag. */
  const handleRulerPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>): void => {
      // Left button / primary pointer only.
      if (e.button !== 0) return
      e.currentTarget.setPointerCapture(e.pointerId)
      useTimelineStore.getState().pause()
      scrubTo(e.clientX)
    },
    [scrubTo]
  )

  /** Pointer-move while dragging (capture set): keep updating the playhead. */
  const handleRulerPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>): void => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
      scrubTo(e.clientX)
    },
    [scrubTo]
  )

  /** Release the drag. */
  const handleRulerPointerUp = useCallback((e: PointerEvent<HTMLDivElement>): void => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [])

  /**
   * Timeline-region shortcuts (P3.7): `S` splits at the playhead; `Delete` /
   * `Backspace` ripple-deletes the selection. Ignored while typing in a text
   * field so caption/name editors keep their native keys.
   */
  function handleKeyDown(e: KeyboardEvent<HTMLElement>): void {
    if (isFromTextInput(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 's' || e.key === 'S') {
      e.preventDefault()
      splitSelectedAtPlayhead()
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      rippleDeleteSelected()
    }
  }

  const tracks = project.tracks
  const clipCount = useMemo(
    () => tracks.reduce((acc, track) => acc + track.clips.length, 0),
    [tracks]
  )
  const fps = project.settings.fps
  const exactDurationSec = projectDurationSec(tracks, 0)
  const durationSec = timelineRenderDurationSec(tracks)
  const viewModeLabel = autoViewModeLabel(exactDurationSec, '6m')
  const contentWidthPx = timeToPx(durationSec, zoom)
  const playheadPx = timeToPx(playhead, zoom)

  // Default timeline view: whenever a project opens or media is added, auto-fit
  // the EXACT current media span so the full timeline is visible immediately.
  useEffect(() => {
    const el = scrollRef.current
    if (el === null || el.clientWidth <= 0) return

    const projectKey =
      currentRef === null ? null : `${currentRef.location}:${currentRef.id}:${currentRef.path}`
    const isNewProject = projectKey !== autoZoomProjectKeyRef.current
    const addedClips = clipCount > prevClipCountRef.current

    if (isNewProject || addedClips) {
      useTimelineStore
        .getState()
        .setZoom(zoomToFitPxPerSec(timelineRenderDurationSec(tracks), el.clientWidth))

      // Always reset to the start so the whole fitted timeline is in view.
      el.scrollLeft = 0

      autoZoomProjectKeyRef.current = projectKey
    }

    prevClipCountRef.current = clipCount
  }, [clipCount, currentRef, tracks])

  // On project open, correct any imported clips still stuck at the short
  // placeholder duration (5s/30s) to their real media length — resilient to the
  // ffprobe IPC path being unavailable. Keyed on the project ref so it runs once
  // per opened project, not on every edit.
  const healDurationsRef = useRef<string | null>(null)
  useEffect(() => {
    const projectKey =
      currentRef === null ? null : `${currentRef.location}:${currentRef.id}:${currentRef.path}`
    if (projectKey === null || projectKey === healDurationsRef.current) return
    healDurationsRef.current = projectKey
    void useTimelineStore.getState().healImportedClipDurations()
    // Repair caption clip durations saved by an earlier build (out stored as the
    // absolute end → captions lingered and overlapped). Idempotent + synchronous.
    useTimelineStore.getState().healCaptionClipDurations()
  }, [currentRef])

  return (
    <footer
      className="flex h-56 shrink-0 flex-col border-t border-line bg-surface-1 outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Toolbar row: edit ops + zoom + snap. */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-text-secondary">Timeline</span>
          <EditControls />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-text-muted" title="Timeline default view mode">
            View: {viewModeLabel}
          </span>
          <button
            type="button"
            aria-label="Zoom to fit"
            onClick={zoomToFit}
            className="rounded-sm bg-surface-2 px-2 py-1 text-xs font-medium text-text-secondary hover:text-text-primary"
          >
            Fit
          </button>
          <ZoomControl />
        </div>
      </div>

      {/* Body: header column (fixed) + scrollable ruler/lanes. */}
      <div className="flex min-h-0 flex-1">
        {/* Track-header column. Offset by the ruler height so headers align to lanes. */}
        <div
          className="shrink-0 border-r border-line bg-surface-2"
          style={{ width: `${HEADER_WIDTH_PX}px` }}
        >
          <div className="h-7 border-b border-line" aria-hidden="true" />
          {tracks.map((track) => (
            <TrackHeader key={track.id} track={track} heightPx={LANE_HEIGHT_PX} />
          ))}
          {/* Add a new empty track row (CapCut-style). */}
          <AddTrackControl />
        </div>

        {/* Shared horizontal scroll container for ruler + lanes. */}
        <div ref={scrollRef} className="relative min-w-0 flex-1 overflow-x-auto overflow-y-auto">
          <div className="relative" style={{ width: `${contentWidthPx}px` }}>
            {/* Draggable ruler: pointer-down/move scrubs the playhead (frame-snapped). */}
            <div
              className="cursor-ew-resize"
              onPointerDown={handleRulerPointerDown}
              onPointerMove={handleRulerPointerMove}
              onPointerUp={handleRulerPointerUp}
              onPointerCancel={handleRulerPointerUp}
            >
              <TimeRuler durationSec={durationSec} pxPerSec={zoom} fps={fps} />
            </div>
            {tracks.map((track) => (
              <TrackLane
                key={track.id}
                track={track}
                heightPx={LANE_HEIGHT_PX}
                window={view}
                bundleAbs={bundleAbs}
              />
            ))}
            {tracks.length === 0 && (
              <div className="flex h-11 items-center px-3 text-xs text-text-muted">
                No tracks yet.
              </div>
            )}

            {/* Keyframe lanes for the single selected clip (P8.6, Doc 11). */}
            {selectedClip !== null && <KeyframeLanes clip={selectedClip} pxPerSec={zoom} />}

            {/* Beat markers (P8.12): faint vertical guides at detected beats. */}
            {beatMarkers.map((t) => (
              <div
                key={`beat-${t}`}
                aria-hidden="true"
                className="pointer-events-none absolute top-0 bottom-0 w-px bg-warning/40"
                style={{ left: `${timeToPx(t, zoom)}px` }}
              />
            ))}

            {/* Playhead marker over ruler + lanes; follows the live clock + scrub. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-accent"
              style={{ left: `${playheadPx}px` }}
            >
              <span className="absolute -left-1 top-0 h-0 w-0 border-x-[4px] border-t-[5px] border-x-transparent border-t-accent" />
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}

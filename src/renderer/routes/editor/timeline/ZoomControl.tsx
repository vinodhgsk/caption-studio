import { useTimelineStore } from '@/store/timelineStore'
import { clampZoom, ZOOM_MAX_PX_PER_SEC, ZOOM_MIN_PX_PER_SEC } from './scale'

/** One zoom step (px per second) for the +/- buttons. */
const ZOOM_STEP = 20

/**
 * Timeline zoom + snap controls (P3.2). Zoom is bound to `timelineStore.setZoom`
 * (px per second, clamped to [min, max]); the snap toggle is bound to
 * `timelineStore.toggleSnap`. Snap's real effect lands in P3.5 — the toggle UI is
 * included here because the timeline spec lists it.
 */
export function ZoomControl(): JSX.Element {
  const zoom = useTimelineStore((s) => s.zoom)
  const setZoom = useTimelineStore((s) => s.setZoom)
  const snap = useTimelineStore((s) => s.snap)
  const toggleSnap = useTimelineStore((s) => s.toggleSnap)

  return (
    <div className="flex items-center gap-3 text-text-secondary">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => setZoom(clampZoom(zoom - ZOOM_STEP))}
          className="flex h-6 w-6 items-center justify-center rounded-sm bg-surface-2 text-text-secondary hover:text-text-primary"
        >
          −
        </button>
        <input
          type="range"
          aria-label="Timeline zoom"
          min={ZOOM_MIN_PX_PER_SEC}
          max={ZOOM_MAX_PX_PER_SEC}
          step={1}
          value={zoom}
          onChange={(e) => setZoom(clampZoom(Number(e.target.value)))}
          className="h-1 w-32 cursor-pointer accent-accent"
        />
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => setZoom(clampZoom(zoom + ZOOM_STEP))}
          className="flex h-6 w-6 items-center justify-center rounded-sm bg-surface-2 text-text-secondary hover:text-text-primary"
        >
          +
        </button>
      </div>
      <button
        type="button"
        aria-label="Toggle snapping"
        aria-pressed={snap}
        onClick={() => toggleSnap()}
        className={[
          'rounded-sm px-2 py-1 text-xs font-medium transition-colors',
          snap ? 'bg-accent text-surface-0' : 'bg-surface-2 text-text-secondary hover:text-text-primary'
        ].join(' ')}
      >
        Snap
      </button>
    </div>
  )
}

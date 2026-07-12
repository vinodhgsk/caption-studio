import type { ProjectTrack } from '../../../../shared/storage'
import { useTimelineStore } from '@/store/timelineStore'
import { TrackIcon } from './TrackIcon'
import { trackLabel } from './trackKind'

interface TrackHeaderProps {
  track: ProjectTrack
  /** Lane height in px — kept in sync with the matching `TrackLane`. */
  heightPx: number
}

/**
 * One track-header row in the left column (P3.2): the track's type icon + label
 * plus a per-track DELETE control (CapCut-style "delete track"), revealed on
 * hover. Deleting a track removes the whole row and its clips as ONE undoable
 * step. The row height is locked to its lane so rows line up horizontally.
 */
export function TrackHeader({ track, heightPx }: TrackHeaderProps): JSX.Element {
  const removeTrackById = useTimelineStore((s) => s.removeTrackById)
  const clipCount = track.clips.length

  return (
    <div
      className="group flex items-center gap-2 border-b border-line px-3 text-text-secondary"
      style={{ height: `${heightPx}px` }}
    >
      <span className="text-text-muted">
        <TrackIcon type={track.type} />
      </span>
      <span className="truncate text-xs font-medium">{trackLabel(track.type)}</span>
      <button
        type="button"
        aria-label={`Delete ${trackLabel(track.type)} track`}
        title={
          clipCount > 0
            ? `Delete track (${clipCount} clip${clipCount === 1 ? '' : 's'})`
            : 'Delete track'
        }
        onClick={() => removeTrackById(track.id)}
        className="ml-auto hidden h-5 w-5 shrink-0 items-center justify-center rounded-sm text-text-muted hover:bg-danger hover:text-white group-hover:flex"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M3 4h10M6.5 4V3h3v1M5 4l.5 8.5a1 1 0 0 0 1 .9h3a1 1 0 0 0 1-.9L11 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  )
}

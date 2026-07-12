import type { ProjectTrack } from '../../../../shared/storage'
import { useTimelineStore } from '@/store/timelineStore'
import type { ViewWindow } from './scale'
import { TimelineClip } from './TimelineClip'
import { visibleClips } from './virtualize'

interface TrackLaneProps {
  track: ProjectTrack
  /** Lane height in px — kept in sync with the matching `TrackHeader`. */
  heightPx: number
  /**
   * The lane's current visible time window, derived once at the timeline level
   * (shared scroll container) and threaded down. P3.4 reads this to virtualize.
   */
  window: ViewWindow
  /**
   * Resolved bundle absolute path (P4.2), threaded from the timeline so audio
   * clips can decode their waveform. Null until resolved / no project open.
   */
  bundleAbs: string | null
}

/**
 * Overscan margin (seconds) added to each side of the visible window so clips
 * mount slightly before they scroll into view and never pop in. Small on purpose
 * (constraint B): off-screen clips beyond this band are not in the DOM.
 */
const OVERSCAN_SEC = 1.5

/**
 * A single horizontal lane that hosts this track's clips (P3.2 + P3.4).
 *
 * VIRTUALIZATION (constraint B): only the clips returned by the pure
 * `visibleClips(track.clips, window.startSec, window.endSec, OVERSCAN_SEC)` are
 * rendered — off-screen clips never reach the DOM. The shared visible `window`
 * comes from the timeline-level `useVisibleWindow` (no second scroll listener);
 * `zoom` (pxPerSec) is read from the timeline store and drives clip geometry.
 *
 * No drag-move (P3.5) or trim handles (P3.6) here — clips are positioned/selected
 * only. Clip reads are non-mutating; tracks remain the single source of truth.
 */
export function TrackLane({ track, heightPx, window, bundleAbs }: TrackLaneProps): JSX.Element {
  const pxPerSec = useTimelineStore((s) => s.zoom)
  const clips = visibleClips(track.clips, window.startSec, window.endSec, OVERSCAN_SEC)

  return (
    <div
      className="relative border-b border-line bg-surface-1"
      style={{ height: `${heightPx}px` }}
      data-track-id={track.id}
      data-track-type={track.type}
    >
      {clips.map((clip) => (
        <TimelineClip
          key={clip.id}
          clip={clip}
          trackType={track.type}
          pxPerSec={pxPerSec}
          bundleAbs={bundleAbs}
        />
      ))}
    </div>
  )
}

import { useState } from 'react'
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
 * One track-header row in the left column (CapCut-style):
 * - Row 1: Type icon + label (e.g. VIDEO) + hover delete button
 * - Row 2: Lock track button + Hide (eyeball) or Mute (speaker) button
 */
export function TrackHeader({ track, heightPx }: TrackHeaderProps): JSX.Element {
  const removeTrackById = useTimelineStore((s) => s.removeTrackById)

  const [locked, setLocked] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [muted, setMuted] = useState(false)

  const isAudio = track.type === 'audio'

  return (
    <div
      className="group flex flex-col justify-center border-b border-line px-3 text-text-secondary bg-surface-2/60 hover:bg-surface-2/90 transition-all select-none"
      style={{ height: `${heightPx}px` }}
    >
      {/* Row 1: Label & Action */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-text-muted shrink-0">
            <TrackIcon type={track.type} />
          </span>
          <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-text-primary">
            {trackLabel(track.type)}
          </span>
        </div>

        <button
          type="button"
          aria-label={`Delete ${trackLabel(track.type)} track`}
          onClick={() => removeTrackById(track.id)}
          className="opacity-0 group-hover:opacity-100 h-5 w-5 shrink-0 flex items-center justify-center rounded text-text-muted hover:bg-danger hover:text-white transition-opacity"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 4h10M6.5 4V3h3v1M5 4l.5 8.5a1 1 0 0 0 1 .9h3a1 1 0 0 0 1-.9L11 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Row 2: CapCut settings controls */}
      <div className="flex items-center gap-2 mt-1">
        {/* Lock button */}
        <button
          type="button"
          onClick={() => setLocked(!locked)}
          className={`flex h-4.5 w-4.5 items-center justify-center rounded text-[10px] transition-colors ${
            locked ? 'text-accent bg-accent/15 border border-accent/20' : 'text-text-muted hover:text-text-secondary border border-transparent'
          }`}
          title={locked ? 'Unlock track' : 'Lock track'}
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            {locked ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
            )}
          </svg>
        </button>

        {/* Hide / Mute button */}
        {isAudio ? (
          <button
            type="button"
            onClick={() => setMuted(!muted)}
            className={`flex h-4.5 w-4.5 items-center justify-center rounded text-[10px] transition-colors ${
              muted ? 'text-danger bg-danger/15 border border-danger/20' : 'text-text-muted hover:text-text-secondary border border-transparent'
            }`}
            title={muted ? 'Unmute track' : 'Mute track'}
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {muted ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              )}
            </svg>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setHidden(!hidden)}
            className={`flex h-4.5 w-4.5 items-center justify-center rounded text-[10px] transition-colors ${
              hidden ? 'text-accent bg-accent/15 border border-accent/20' : 'text-text-muted hover:text-text-secondary border border-transparent'
            }`}
            title={hidden ? 'Show track' : 'Hide track'}
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {hidden ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              )}
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

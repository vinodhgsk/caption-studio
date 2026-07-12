import type { ProjectTrack } from '../../../../shared/storage'

interface TrackIconProps {
  type: ProjectTrack['type']
}

/**
 * Original, hand-drawn line glyph for a track type (no third-party/copied icons).
 * One component switches on `type` so the file exports only a component (keeps
 * fast-refresh happy and the label data separate in `trackKind.ts`).
 */
export function TrackIcon({ type }: TrackIconProps): JSX.Element {
  switch (type) {
    case 'video':
      return (
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
          <rect x="1.5" y="3.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <path
            d="M10.5 6.5 14.5 4.5v7l-4-2z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'audio':
      return (
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
          <path
            d="M2 8h2l2-4 3 9 2-6 1 2h2"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'text':
      return (
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
          <path d="M3 4h10M8 4v9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      )
    case 'effect':
      return (
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
          <path
            d="M8 1.5 9.4 6l4.1 1.4L9.4 8.8 8 13.3 6.6 8.8 2.5 7.4 6.6 6z"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
        </svg>
      )
    default: {
      const exhaustive: never = type
      return exhaustive
    }
  }
}

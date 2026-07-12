import { useProjectStore } from '@/store/projectStore'
import { useTimelineStore } from '@/store/timelineStore'
import { clipIdContainingTime } from '@/store/timeline'

/**
 * Split + ripple-delete toolbar controls (P3.7). Both dispatch the high-level
 * undoable store actions (`splitSelectedAtPlayhead` / `rippleDeleteSelected`)
 * and are disabled when the action would be a no-op:
 *   - Split is enabled when some clip's span strictly contains the playhead.
 *   - Ripple-delete is enabled when at least one clip is selected.
 *
 * Styling matches `ZoomControl` (design tokens only — no new colors).
 */
export function EditControls(): JSX.Element {
  const project = useProjectStore((s) => s.currentProject)
  const selection = useTimelineStore((s) => s.selection)
  const playhead = useTimelineStore((s) => s.playhead)
  const splitSelectedAtPlayhead = useTimelineStore((s) => s.splitSelectedAtPlayhead)
  const rippleDeleteSelected = useTimelineStore((s) => s.rippleDeleteSelected)

  const canSplit = project !== null && clipIdContainingTime(project, playhead) !== null
  const canRippleDelete = project !== null && selection.length > 0

  const buttonClass = (enabled: boolean): string =>
    [
      'rounded-sm px-2 py-1 text-xs font-medium transition-colors',
      enabled
        ? 'bg-surface-2 text-text-secondary hover:text-text-primary'
        : 'cursor-not-allowed bg-surface-2 text-text-muted opacity-50'
    ].join(' ')

  return (
    <div className="flex items-center gap-2 text-text-secondary">
      <button
        type="button"
        aria-label="Split at playhead"
        title="Split at playhead (S)"
        disabled={!canSplit}
        onClick={() => splitSelectedAtPlayhead()}
        className={buttonClass(canSplit)}
      >
        Split
      </button>
      <button
        type="button"
        aria-label="Ripple delete"
        title="Ripple delete (Delete)"
        disabled={!canRippleDelete}
        onClick={() => rippleDeleteSelected()}
        className={buttonClass(canRippleDelete)}
      >
        Ripple delete
      </button>
    </div>
  )
}

import { useProjectStore } from '@/store/projectStore'
import { useTimelineStore } from '@/store/timelineStore'
import { clipIdContainingTime } from '@/store/timeline'

/**
 * Timeline editing icon toolbar (CapCut-style):
 * Left group: Pointer/Select · Undo · Redo · Split · Ripple-delete · Freeze · Crop (dimmed stubs)
 * Right group: Mic · Link · Snap magnet (all stubs)
 */

function IconBtn({
  label,
  title,
  disabled,
  onClick,
  active,
  children
}: {
  label: string
  title?: string
  disabled?: boolean
  onClick?: () => void
  active?: boolean
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className={[
        'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
        active
          ? 'bg-accent/15 text-accent'
          : disabled
          ? 'cursor-not-allowed text-text-muted opacity-30'
          : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary'
      ].join(' ')}
    >
      {children}
    </button>
  )
}

export function EditControls(): JSX.Element {
  const project = useProjectStore((s) => s.currentProject)
  const selection = useTimelineStore((s) => s.selection)
  const playhead = useTimelineStore((s) => s.playhead)
  const splitSelectedAtPlayhead = useTimelineStore((s) => s.splitSelectedAtPlayhead)
  const rippleDeleteSelected = useTimelineStore((s) => s.rippleDeleteSelected)

  const canSplit = project !== null && clipIdContainingTime(project, playhead) !== null
  const canRippleDelete = project !== null && selection.length > 0

  return (
    <div className="flex w-full items-center justify-between">
      {/* ── Left group: selection + edit tools ── */}
      <div className="flex items-center gap-0.5">
        {/* Pointer / select (always active — default tool) */}
        <IconBtn label="Select tool" title="Select (V)" active>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" />
          </svg>
        </IconBtn>

        {/* Divider */}
        <span className="mx-1 h-4 w-px bg-line" />

        {/* Split at playhead (scissors) */}
        <IconBtn
          label="Split at playhead"
          title="Split at playhead (S)"
          disabled={!canSplit}
          onClick={() => splitSelectedAtPlayhead()}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12" />
          </svg>
        </IconBtn>

        {/* Ripple delete (trash) */}
        <IconBtn
          label="Ripple delete"
          title="Ripple delete (Del)"
          disabled={!canRippleDelete}
          onClick={() => rippleDeleteSelected()}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </IconBtn>

        {/* Divider */}
        <span className="mx-1 h-4 w-px bg-line" />

        {/* Stub tools — dimmed (not yet implemented) */}
        {/* Freeze frame */}
        <IconBtn label="Freeze frame" disabled>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </IconBtn>

        {/* Crop */}
        <IconBtn label="Crop" disabled>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 2v14a2 2 0 002 2h14M18 22V8a2 2 0 00-2-2H2" />
          </svg>
        </IconBtn>

        {/* Speed */}
        <IconBtn label="Speed" disabled>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </IconBtn>

        {/* Replace media */}
        <IconBtn label="Replace" disabled>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </IconBtn>
      </div>

      {/* ── Right group: mic / link / snap ── */}
      <div className="flex items-center gap-0.5">
        {/* Voiceover / mic */}
        <IconBtn label="Record voiceover" disabled>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        </IconBtn>

        {/* Link / unlink */}
        <IconBtn label="Link / unlink tracks" disabled>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        </IconBtn>

        {/* Snap / magnet */}
        <IconBtn label="Toggle snapping" disabled>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v8m0 0l4-4m-4 4l-4-4" />
          </svg>
        </IconBtn>
      </div>
    </div>
  )
}

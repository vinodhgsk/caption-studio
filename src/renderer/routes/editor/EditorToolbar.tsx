import { Link } from 'react-router-dom'
import type { SaveStatus } from '@/store/projectStore'

interface EditorToolbarProps {
  projectName: string
  isDirty: boolean
  saveStatus: SaveStatus
  onSave: () => void
  onClose: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}

/** Teal auto-save label shown in the toolbar centre-left area. */
function AutoSaveLabel({ saveStatus, isDirty }: { saveStatus: SaveStatus; isDirty: boolean }): JSX.Element {
  if (saveStatus === 'saving') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-text-muted" role="status">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
        Saving…
      </span>
    )
  }
  if (saveStatus === 'error') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-danger" role="status">
        <span className="h-1.5 w-1.5 rounded-full bg-danger" />
        Save failed
      </span>
    )
  }
  if (isDirty) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-text-muted" role="status">
        <span className="h-1.5 w-1.5 rounded-full bg-warning" />
        Unsaved changes
      </span>
    )
  }
  if (saveStatus === 'saved') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-[#00d4c8]" role="status">
        <span className="h-1.5 w-1.5 rounded-full bg-[#00d4c8]" />
        Auto saved
      </span>
    )
  }
  return <span />
}

/** Small SVG icon-button for the centre toolbar. */
function ToolBtn({
  label,
  title,
  disabled,
  onClick,
  children
}: {
  label: string
  title?: string
  disabled?: boolean
  onClick?: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  )
}

export function EditorToolbar({
  projectName,
  isDirty,
  saveStatus,
  onSave,
  onClose,
  canUndo,
  canRedo,
  onUndo,
  onRedo
}: EditorToolbarProps): JSX.Element {
  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-line bg-surface-1 px-3 z-30">

      {/* ── Left: back arrow + CS logo + project name + auto-save ── */}
      <div className="flex min-w-0 items-center gap-2.5">
        <Link
          to="/"
          onClick={() => onClose()}
          aria-label="Back to Projects"
          title="Back to Projects"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>

        {/* CS logo badge */}
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent text-[10px] font-extrabold text-white select-none shadow-md shadow-accent/30">
          CS
        </div>

        {/* Project name + dirty dot */}
        <span className="flex min-w-0 items-center gap-1.5 truncate text-xs font-semibold text-text-primary">
          <span className="truncate max-w-[180px]">{projectName}</span>
          {isDirty && (
            <span
              aria-label="Unsaved changes"
              title="Unsaved changes"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
            />
          )}
        </span>

        <AutoSaveLabel saveStatus={saveStatus} isDirty={isDirty} />
      </div>

      {/* ── Centre: editing tool icon row ── */}
      <div className="flex items-center gap-0.5">
        {/* Undo */}
        <ToolBtn label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a7 7 0 017 7v0M3 10l4-4M3 10l4 4" />
          </svg>
        </ToolBtn>

        {/* Redo */}
        <ToolBtn label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={onRedo}>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 10H11a7 7 0 00-7 7v0M21 10l-4-4M21 10l-4 4" />
          </svg>
        </ToolBtn>

        {/* Divider */}
        <span className="mx-1 h-5 w-px bg-line" />

        {/* Split (scissors) — fired from EditControls via keyboard; toolbar is visual hint */}
        <ToolBtn label="Split at playhead" title="Split at playhead (S)" disabled>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12" />
          </svg>
        </ToolBtn>

        {/* Ripple delete */}
        <ToolBtn label="Delete selected" title="Ripple delete (Del)" disabled>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </ToolBtn>

        {/* Divider */}
        <span className="mx-1 h-5 w-px bg-line" />

        {/* Save shortcut button */}
        <ToolBtn label="Save" title="Save (Ctrl+S)" onClick={onSave}>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
          </svg>
        </ToolBtn>
      </div>

      {/* ── Right: Export CTA ── */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Export"
          disabled
          className="flex items-center gap-1.5 rounded-lg bg-[#00d4c8] px-3.5 py-1.5 text-xs font-bold text-[#0d1117] shadow-md shadow-[#00d4c8]/20 transition-all hover:bg-[#00bfb4] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export
        </button>
      </div>
    </header>
  )
}

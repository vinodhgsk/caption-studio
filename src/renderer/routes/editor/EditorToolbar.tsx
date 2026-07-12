import { Link } from 'react-router-dom'
import type { SaveStatus } from '@/store/projectStore'

interface EditorToolbarProps {
  /** Display name of the open project. */
  projectName: string
  /** Unsaved-changes seam — flipped by autosave (P2.9). */
  isDirty: boolean
  /** Lifecycle of the most recent save, reflected on the Save affordance. */
  saveStatus: SaveStatus
  /** Persist the open document now (manual Save). */
  onSave: () => void
  /** Clear the open project handle before navigating Home. */
  onClose: () => void
  /** Whether a command is available to undo (P2.8). */
  canUndo: boolean
  /** Whether a command is available to redo (P2.8). */
  canRedo: boolean
  /** Reverse the most recent command. */
  onUndo: () => void
  /** Re-apply the most recently undone command. */
  onRedo: () => void
}

/**
 * Top toolbar (region 1 of the editor shell): back link + project name +
 * dirty indicator on the left; undo/redo + Export on the right.
 *
 * Undo/redo (P2.8) are enabled from the command stack and call the store's
 * undo/redo. Export is a disabled placeholder — real export lands in Phase 12.
 */
/** Label + token class for the small save-status text beside the Save button. */
function saveStatusView(status: SaveStatus): { label: string; tone: string } | null {
  switch (status) {
    case 'saving':
      return { label: 'Saving…', tone: 'text-text-muted' }
    case 'saved':
      return { label: 'Saved', tone: 'text-success' }
    case 'error':
      return { label: 'Save failed', tone: 'text-danger' }
    default:
      return null
  }
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
  const status = saveStatusView(saveStatus)
  // Disabled when there's nothing to save (clean) — unless the last save errored,
  // so the user can retry. "Saving…" also disables to avoid double writes.
  const saveDisabled = saveStatus === 'saving' || (!isDirty && saveStatus !== 'error')
  const saveLabel = saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : 'Save'
  return (
    <header className="flex items-center justify-between border-b border-line bg-surface-1 px-4 py-3">
      <div className="flex items-center gap-3">
        <Link
          to="/"
          onClick={() => onClose()}
          className="text-sm text-text-secondary hover:text-text-primary"
        >
          ← Projects
        </Link>
        <span className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
          {projectName}
          {isDirty && (
            <span
              aria-label="Unsaved changes"
              title="Unsaved changes"
              className="h-1.5 w-1.5 rounded-md bg-warning"
            />
          )}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {status !== null && (
          <span className={`text-xs ${status.tone}`} role="status">
            {status.label}
          </span>
        )}
        <button
          type="button"
          aria-label="Save"
          disabled={saveDisabled}
          onClick={() => onSave()}
          className="rounded-md px-2 py-1 text-sm text-text-secondary hover:text-text-primary disabled:cursor-not-allowed disabled:text-text-muted disabled:hover:text-text-muted"
        >
          {saveLabel}
        </button>
        <button
          type="button"
          aria-label="Undo"
          disabled={!canUndo}
          onClick={() => onUndo()}
          className="rounded-md px-2 py-1 text-sm text-text-secondary hover:text-text-primary disabled:cursor-not-allowed disabled:text-text-muted disabled:hover:text-text-muted"
        >
          Undo
        </button>
        <button
          type="button"
          aria-label="Redo"
          disabled={!canRedo}
          onClick={() => onRedo()}
          className="rounded-md px-2 py-1 text-sm text-text-secondary hover:text-text-primary disabled:cursor-not-allowed disabled:text-text-muted disabled:hover:text-text-muted"
        >
          Redo
        </button>
        <button
          type="button"
          aria-label="Export"
          disabled
          className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-text-primary hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          Export
        </button>
      </div>
    </header>
  )
}

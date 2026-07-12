import { useEffect, useRef, useState } from 'react'
import type { ProjectMeta } from '../../../shared/storage'
import { useProjectStore } from '@/store/projectStore'
import Modal from '@/components/Modal'

export interface RenameProjectDialogProps {
  open: boolean
  project: ProjectMeta | null
  onClose: () => void
}

const fieldLabel = 'mb-1 block text-sm font-medium text-text-secondary'
const inputBase =
  'w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-text-primary outline-none focus:border-accent'

/**
 * Rename dialog (P2.4): prefilled name field → renameProject. Reuses {@link Modal}
 * for overlay/Escape handling; focuses + selects the field on open.
 */
export default function RenameProjectDialog({
  open,
  project,
  onClose
}: RenameProjectDialogProps): JSX.Element {
  const renameProject = useProjectStore((s) => s.renameProject)
  const nameRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(project?.name ?? '')
    setSubmitting(false)
    setError(null)
    const id = window.setTimeout(() => nameRef.current?.select(), 0)
    return () => window.clearTimeout(id)
  }, [open, project])

  const trimmed = name.trim()
  const canSubmit = trimmed.length > 0 && !submitting && project !== null

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!canSubmit || project === null) return
    setSubmitting(true)
    setError(null)
    const result = await renameProject(
      { id: project.id, name: project.name, location: project.location, path: project.path },
      trimmed
    )
    if (result.ok) {
      onClose()
    } else {
      setError(result.error)
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} title="Rename project" onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={(e) => void handleSubmit(e)}>
        <div>
          <label htmlFor="rp-name" className={fieldLabel}>
            Name
          </label>
          <input
            id="rp-name"
            ref={nameRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputBase}
            required
          />
        </div>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line bg-surface-2 px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-0"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Renaming…' : 'Rename'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

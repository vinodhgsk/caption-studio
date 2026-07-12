import { useEffect, useRef, useState } from 'react'
import type { ProjectMeta } from '../../../shared/storage'
import { useProjectStore } from '@/store/projectStore'
import Modal from '@/components/Modal'

export interface DeleteProjectDialogProps {
  open: boolean
  project: ProjectMeta | null
  onClose: () => void
}

/**
 * Delete confirm dialog (P2.4): a destructive-styled confirm with the Cancel
 * button focused by default (safer keyboard default). Reuses {@link Modal}.
 */
export default function DeleteProjectDialog({
  open,
  project,
  onClose
}: DeleteProjectDialogProps): JSX.Element {
  const deleteProject = useProjectStore((s) => s.deleteProject)
  const cancelRef = useRef<HTMLButtonElement>(null)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSubmitting(false)
    setError(null)
    const id = window.setTimeout(() => cancelRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open])

  const handleDelete = async (): Promise<void> => {
    if (project === null || submitting) return
    setSubmitting(true)
    setError(null)
    const result = await deleteProject({
      id: project.id,
      name: project.name,
      location: project.location,
      path: project.path
    })
    if (result.ok) {
      onClose()
    } else {
      setError(result.error)
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} title="Delete project" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary">
          Delete &lsquo;{project?.name ?? ''}&rsquo;? This cannot be undone.
        </p>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            className="rounded-md border border-line bg-surface-2 px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-0"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={submitting}
            className="rounded-md bg-danger px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

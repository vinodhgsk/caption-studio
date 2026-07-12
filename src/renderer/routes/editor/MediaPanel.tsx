import { useState } from 'react'
import { useProjectStore } from '@/store/projectStore'
import { useTimelineStore } from '@/store/timelineStore'

/**
 * Media panel (P3.3). Hosts the "Import media" action: it picks file(s) via the
 * OS dialog, copies each into the open project's bundle `media/` folder (in
 * main), and appends a Clip onto a video track through the undoable command
 * stack. Thumbnails/waveforms (P3.4) and drag-to-timeline (P3.5) arrive later.
 */
export function MediaPanel(): JSX.Element {
  const importMedia = useTimelineStore((s) => s.importMedia)
  const hasProject = useProjectStore((s) => s.currentRef !== null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const onImport = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    const result = await importMedia()
    if (!result.ok) {
      setMessage(result.error)
    } else if (result.imported === 0) {
      setMessage(null)
    } else {
      setMessage(
        result.imported === 1 ? 'Imported 1 clip.' : `Imported ${result.imported} clips.`
      )
    }
    setBusy(false)
  }

  return (
    <section className="flex h-full flex-col gap-3 p-4">
      <h2 className="text-sm font-semibold text-text-primary">Media</h2>
      <p className="text-xs text-text-muted">
        Import a video or image. It is copied into the project bundle and added to the
        timeline.
      </p>
      <button
        type="button"
        onClick={() => {
          void onImport()
        }}
        disabled={!hasProject || busy}
        className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-text-primary disabled:opacity-50"
      >
        {busy ? 'Importing…' : 'Import media'}
      </button>
      {!hasProject && (
        <p className="text-xs text-text-muted">Open a project to import media.</p>
      )}
      {message !== null && <p className="text-xs text-text-muted">{message}</p>}
    </section>
  )
}

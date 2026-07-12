import { useEffect, useMemo } from 'react'
import { useProjectStore } from '@/store/projectStore'
import { debounce } from '@/lib/debounce'
import { AUTOSAVE_DEBOUNCE_MS, shouldAutosave } from './autosave'

/**
 * Triggers a debounced `saveProject` whenever the open document becomes dirty.
 * The debounce collapses rapid edits into one write `AUTOSAVE_DEBOUNCE_MS` after
 * the last change. `shouldAutosave` guards against firing with no project open or
 * while a save is in flight; since a successful save flips `isDirty` false, this
 * cannot loop. The pending call is cancelled on unmount / when the project closes.
 *
 * `flush()` is exposed so the manual Cmd/Ctrl+S handler can write immediately
 * instead of waiting out the debounce.
 */
export function useAutosave(): { flushAutosave: () => void } {
  const isDirty = useProjectStore((s) => s.isDirty)
  const saveStatus = useProjectStore((s) => s.saveStatus)
  const hasProject = useProjectStore((s) => s.currentProject !== null)
  const saveProject = useProjectStore((s) => s.saveProject)

  const debounced = useMemo(
    () => debounce(() => void saveProject(), AUTOSAVE_DEBOUNCE_MS),
    [saveProject]
  )

  useEffect(() => {
    if (shouldAutosave(isDirty, saveStatus, hasProject)) debounced()
  }, [isDirty, saveStatus, hasProject, debounced])

  // Drop any pending write when the hook unmounts (e.g. project closes).
  useEffect(() => () => debounced.cancel(), [debounced])

  return { flushAutosave: () => debounced.flush() }
}

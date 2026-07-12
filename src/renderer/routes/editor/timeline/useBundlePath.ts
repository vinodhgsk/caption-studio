/**
 * Resolve the current project's bundle absolute path (P4.2 helper).
 *
 * The bundle path is needed to build `app-media://` URLs for waveform decode but
 * is NOT stored on the project (constraint: paths never persisted to
 * project.json). It is resolved ONCE per `currentRef` via the storage IPC bridge
 * and threaded down to the lanes, so each audio clip does not re-issue the IPC.
 */
import { useEffect, useState } from 'react'
import type { ProjectRef } from '../../../../shared/storage'
import { useProjectStore } from '@/store/projectStore'

/** The resolved bundle absolute path for the open project, or null until known. */
export function useBundlePath(): string | null {
  const currentRef = useProjectStore((s) => s.currentRef)
  const [path, setPath] = useState<string | null>(null)

  useEffect(() => {
    if (currentRef === null) {
      setPath(null)
      return
    }
    let active = true
    void resolveBundlePath(currentRef).then((p) => {
      if (active) setPath(p)
    })
    return () => {
      active = false
    }
  }, [currentRef])

  return path
}

/** Resolve a project ref's bundle absolute path via the storage IPC bridge. */
async function resolveBundlePath(ref: ProjectRef): Promise<string | null> {
  try {
    const result = await window.api.invoke('storage:resolvePath', { ref })
    return result.ok ? result.data.path : null
  } catch {
    return null
  }
}

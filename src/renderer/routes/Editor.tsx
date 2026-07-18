import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { ProjectMeta, ProjectRef } from '../../shared/storage'
import { useProjectStore } from '@/store/projectStore'
import { useEditorStore } from '@/store/editorStore'
import { canRedo, canUndo } from '@/store/commandStack'
import { parseEditorParams } from './editorParams'
import { EditorToolbar } from './editor/EditorToolbar'
import { useAutosave } from './editor/useAutosave'
import { LeftRail } from './editor/LeftRail'
import { PanelContainer } from './editor/PanelContainer'
import { PreviewRegion } from './editor/PreviewRegion'
import { TimelineRegion } from './editor/TimelineRegion'
import { usePreviewAudio } from './editor/usePreviewAudio'

function resolvePreviewAspect(aspect: string | undefined): '16:9' | '9:16' | '1:1' {
  if (aspect === '16:9' || aspect === '9:16' || aspect === '1:1') return aspect
  return '16:9'
}

/** A `ProjectMeta` carries every `ProjectRef` field — narrow to the ref shape. */
function toRef(project: ProjectMeta): ProjectRef {
  return {
    id: project.id,
    name: project.name,
    location: project.location,
    path: project.path
  }
}

/**
 * Editor entry (P2.5): reads `id` + `location` from the route, resolves the
 * full `ProjectRef` from the store's listing (loading it on deep-link/reload),
 * then opens the project document. Renders minimal loading / error / ready
 * states — the full 3-region shell lands in P2.6/P2.7.
 */
export default function Editor(): JSX.Element {
  const [searchParams] = useSearchParams()
  const loadProjects = useProjectStore((s) => s.loadProjects)
  const openProject = useProjectStore((s) => s.openProject)
  const closeProject = useProjectStore((s) => s.closeProject)
  const currentProject = useProjectStore((s) => s.currentProject)
  const isDirty = useProjectStore((s) => s.isDirty)
  const openStatus = useProjectStore((s) => s.openStatus)
  const openError = useProjectStore((s) => s.openError)
  const commandStack = useProjectStore((s) => s.commandStack)
  const undo = useProjectStore((s) => s.undo)
  const redo = useProjectStore((s) => s.redo)
  const saveProject = useProjectStore((s) => s.saveProject)
  const saveStatus = useProjectStore((s) => s.saveStatus)
  const timelineLayout = useEditorStore((s) => s.timelineLayout)
  const setTimelineLayout = useEditorStore((s) => s.setTimelineLayout)

  const { flushAutosave } = useAutosave()

  const params = parseEditorParams(searchParams)
  const projectIsOpen = openStatus === 'ready' && currentProject !== null

  const [timelineHeight, setTimelineHeight] = useState(320)
  const [isDragging, setIsDragging] = useState(false)

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return
    const container = e.currentTarget.parentElement
    if (!container) return
    const rect = container.getBoundingClientRect()
    const newHeight = rect.bottom - e.clientY
    const minHeight = 120
    const maxHeight = rect.height * 0.7
    setTimelineHeight(Math.max(minHeight, Math.min(newHeight, maxHeight)))
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const [panelWidth, setPanelWidth] = useState(320)
  const [isDraggingPanel, setIsDraggingPanel] = useState(false)

  const handlePanelPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDraggingPanel(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePanelPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingPanel) return
    const container = e.currentTarget.parentElement
    if (!container) return
    const rect = container.getBoundingClientRect()
    const newWidth = rect.right - e.clientX
    const minWidth = 240
    const maxWidth = rect.width * 0.5
    setPanelWidth(Math.max(minWidth, Math.min(newWidth, maxWidth)))
  }

  const handlePanelPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDraggingPanel(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  // Keep audio-track clips audible in preview transport playback.
  usePreviewAudio(currentProject)

  // Keyboard shortcuts: Cmd/Ctrl+Z undo, Cmd/Ctrl+Shift+Z redo,
  // Cmd/Ctrl+S manual save (flushes the autosave debounce). Active only while a
  // project is open; ignored when focus is in a text input.
  useEffect(() => {
    if (!projectIsOpen) return

    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false
      const tag = target.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
    }

    const handler = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      if (key === 's') {
        event.preventDefault()
        flushAutosave()
        void saveProject()
        return
      }
      if (key !== 'z') return
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [projectIsOpen, undo, redo, saveProject, flushAutosave])

  useEffect(() => {
    if (params === null) {
      useProjectStore.setState({ openStatus: 'error', openError: 'Invalid project link.' })
      return
    }

    let cancelled = false

    const resolveAndOpen = async (): Promise<void> => {
      let list = useProjectStore.getState().projects
      let match = list.find((p) => p.id === params.id && p.location === params.location)

      if (match === undefined) {
        await loadProjects(params.location)
        if (cancelled) return
        list = useProjectStore.getState().projects
        match = list.find((p) => p.id === params.id && p.location === params.location)
      }

      if (cancelled) return
      if (match === undefined) {
        useProjectStore.setState({ openStatus: 'error', openError: 'Project not found.' })
        return
      }

      await openProject(toRef(match))
    }

    void resolveAndOpen()

    return () => {
      cancelled = true
    }
    // Re-run only when the target project changes, not on listing refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.id, params?.location, loadProjects, openProject])

  if (openStatus === 'error') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-surface-0 text-text-muted">
        <p className="text-sm">{openError ?? 'Failed to open project.'}</p>
        <Link to="/" className="text-sm text-text-secondary hover:text-text-primary">
          ← Projects
        </Link>
      </main>
    )
  }

  if (openStatus !== 'ready' || currentProject === null) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-surface-0 text-text-muted">
        <p className="text-sm">Loading project…</p>
      </main>
    )
  }

  const previewAspect = resolvePreviewAspect(currentProject.settings.aspect)

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-surface-0 text-text-primary">
      <EditorToolbar
        projectName={currentProject.name}
        isDirty={isDirty}
        saveStatus={saveStatus}
        onSave={() => {
          flushAutosave()
          void saveProject()
        }}
        onClose={() => closeProject()}
        canUndo={canUndo(commandStack)}
        canRedo={canRedo(commandStack)}
        onUndo={() => undo()}
        onRedo={() => redo()}
        timelineLayout={timelineLayout}
        onToggleLayout={() => setTimelineLayout(timelineLayout === 'full-width' ? 'docked' : 'full-width')}
      />
      {timelineLayout === 'full-width' ? (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 overflow-hidden">
            <LeftRail />
            <div className="flex flex-1 relative overflow-hidden">
              <PreviewRegion aspect={previewAspect} />
            </div>
            {/* Horizontal drag handle */}
            <div
              role="separator"
              aria-label="Resize right panel"
              onPointerDown={handlePanelPointerDown}
              onPointerMove={handlePanelPointerMove}
              onPointerUp={handlePanelPointerUp}
              onPointerCancel={handlePanelPointerUp}
              className="relative z-20 flex w-2 h-full cursor-col-resize items-center justify-center bg-transparent shrink-0 group -mx-1"
            >
              <div className="w-px h-full bg-line group-hover:bg-accent/70 group-active:bg-accent transition-colors" />
            </div>
            <PanelContainer width={panelWidth} />
          </div>
          {/* Vertical drag handle */}
          <div
            role="separator"
            aria-label="Resize timeline"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="relative z-20 flex h-2 w-full cursor-row-resize items-center justify-center bg-transparent shrink-0 group -my-1"
          >
            <div className="h-px w-full bg-line group-hover:bg-accent/70 group-active:bg-accent transition-colors" />
          </div>
          <TimelineRegion height={timelineHeight} />
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <LeftRail />
          <div className="flex flex-1 flex-col overflow-hidden relative">
            <PreviewRegion aspect={previewAspect} />
            {/* Vertical drag handle */}
            <div
              role="separator"
              aria-label="Resize timeline"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className="relative z-20 flex h-2 w-full cursor-row-resize items-center justify-center bg-transparent shrink-0 group -my-1"
            >
              <div className="h-px w-full bg-line group-hover:bg-accent/70 group-active:bg-accent transition-colors" />
            </div>
            <TimelineRegion height={timelineHeight} />
          </div>
          {/* Horizontal drag handle */}
          <div
            role="separator"
            aria-label="Resize right panel"
            onPointerDown={handlePanelPointerDown}
            onPointerMove={handlePanelPointerMove}
            onPointerUp={handlePanelPointerUp}
            onPointerCancel={handlePanelPointerUp}
            className="relative z-20 flex w-2 h-full cursor-col-resize items-center justify-center bg-transparent shrink-0 group -mx-1"
          >
            <div className="w-px h-full bg-line group-hover:bg-accent/70 group-active:bg-accent transition-colors" />
          </div>
          <PanelContainer width={panelWidth} />
        </div>
      )}
    </main>
  )
}

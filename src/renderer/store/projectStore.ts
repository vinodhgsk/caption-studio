import { create } from 'zustand'
import type { Project, ProjectRef, ProjectMeta, StorageLocation } from '../../shared/storage'
import type { FontManifest } from '../../shared/fontParse'
import { resolutionForAspect, type Aspect } from '../routes/home/aspect'
import { rehydrateProjectFonts } from './fonts/importFont'
import {
  type Command,
  type CommandStack,
  canRedo as stackCanRedo,
  canUndo as stackCanUndo,
  emptyStack,
  push as stackPush,
  redo as stackRedo,
  undo as stackUndo
} from './commandStack'
import { countClips, LARGE_PROJECT_CLIP_THRESHOLD } from '../../shared/projectStats'

/** Lifecycle of the Projects Home listing fetch. */
export type ProjectListStatus = 'idle' | 'loading' | 'ready' | 'error'

/** The six Indic-first languages every new project ships with (master plan §4). */
export const DEFAULT_LANGUAGES = ['ta', 'te', 'ml', 'kn', 'hi', 'en'] as const

/** User choices from the New-Project dialog (P2.3), applied post-scaffold. */
export interface CreateProjectInput {
  location: StorageLocation
  name: string
  aspect: Aspect
  fps: number
  /** Project default language (one of `DEFAULT_LANGUAGES`). */
  language: string
}

/** Outcome of a `createProject` call surfaced to the dialog. */
export type CreateProjectResult =
  | { ok: true; ref: ProjectRef }
  | { ok: false; error: string }

/** Generic outcome of a per-card action (duplicate/rename/delete/reveal). */
export type ProjectActionResult = { ok: true } | { ok: false; error: string }

/** Lifecycle of opening a project document into the editor. */
export type OpenStatus = 'idle' | 'loading' | 'ready' | 'error'

/** Lifecycle of a save (manual or autosave) through `storage:writeProject`. */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Project slice. Holds the current open project handle plus the Projects Home
 * listing (loaded via `storage:listProjects`). Card internals, the New-Project
 * dialog, and per-card actions land in later prompts (P2.2–P2.4).
 */
export interface ProjectState {
  currentProjectId: string | null
  isDirty: boolean
  /** The full open project document, or null when none is loaded. */
  currentProject: Project | null
  /** Handle to the open project's bundle, or null when none is loaded. */
  currentRef: ProjectRef | null
  /** Lifecycle of the open-project fetch. */
  openStatus: OpenStatus
  /** Human-readable error from a failed open, else null. */
  openError: string | null
  /** Projects Home listing for the active storage location. */
  projects: ProjectMeta[]
  listStatus: ProjectListStatus
  /** Human-readable error from a failed listing, else null. */
  listError: string | null
  /** Undo/redo command history for the open document (reset per open/close). */
  commandStack: CommandStack
  /** Lifecycle of the most recent save (manual or autosave). */
  saveStatus: SaveStatus
  /** Human-readable error (or soft conflict warning) from the last save, else null. */
  saveError: string | null
  /** ISO timestamp of the last successful save, else null. */
  lastSavedAt: string | null
  setCurrentProject: (id: string | null) => void
  markDirty: (dirty: boolean) => void
  /**
   * Persist an updated imported-font manifest onto the open document (P6.2/P6.3
   * font import). Replaces `project.fonts` and marks the doc dirty so the
   * autosave/Save writes it to the bundle and imported families "travel".
   * NOT an undoable command — a font import is an asset operation, not an edit.
   * No-op when no project is open.
   */
  setProjectFonts: (manifest: FontManifest) => void
  /** Apply a command to the open doc, push it on the stack, mark dirty. No-op when no project is open. */
  runCommand: (cmd: Command) => void
  /** Reverse the most recent command. No-op when nothing to undo / no project. */
  undo: () => void
  /** Re-apply the most recently undone command. No-op when nothing to redo / no project. */
  redo: () => void
  /** True when there is a command available to undo. */
  canUndo: () => boolean
  /** True when there is a command available to redo. */
  canRedo: () => boolean
  /** Fetch the project listing for a storage location via the IPC bridge. */
  loadProjects: (location: StorageLocation) => Promise<void>
  /**
   * Persist the open document via `storage:writeProject`. No-op when no project
   * is open. Clears `isDirty` on success; surfaces a soft conflict warning or a
   * hard error via `saveError`. Used by the manual Save and the autosave debounce.
   */
  saveProject: () => Promise<void>
  /** Load a project document into the editor via `storage:readProject`. */
  openProject: (ref: ProjectRef) => Promise<void>
  /** Clear the open project document and its handle. */
  closeProject: () => void
  /**
   * Scaffold a new project, apply the dialog's aspect/fps/language choices,
   * then refresh the listing. Errors are returned (not thrown) for the UI.
   */
  createProject: (input: CreateProjectInput) => Promise<CreateProjectResult>
  /** Copy a bundle to a uniquely-named duplicate, then refresh the listing. */
  duplicateProject: (ref: ProjectRef) => Promise<ProjectActionResult>
  /** Rename a bundle + project.json, then refresh the listing. */
  renameProject: (ref: ProjectRef, name: string) => Promise<ProjectActionResult>
  /** Delete a bundle, then refresh the listing. */
  deleteProject: (ref: ProjectRef) => Promise<ProjectActionResult>
  /** Reveal a bundle in the OS file manager. */
  revealProject: (ref: ProjectRef) => Promise<ProjectActionResult>
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  currentProjectId: null,
  isDirty: false,
  currentProject: null,
  currentRef: null,
  openStatus: 'idle',
  openError: null,
  projects: [],
  listStatus: 'idle',
  listError: null,
  commandStack: emptyStack(),
  saveStatus: 'idle',
  saveError: null,
  lastSavedAt: null,
  setCurrentProject: (id) => set({ currentProjectId: id }),
  markDirty: (dirty) => set({ isDirty: dirty }),
  setProjectFonts: (manifest) => {
    const { currentProject } = get()
    if (currentProject === null) return
    set({ currentProject: { ...currentProject, fonts: manifest }, isDirty: true })
  },
  runCommand: (cmd) => {
    const { currentProject, commandStack } = get()
    if (currentProject === null) return
    const nextProject = cmd.apply(currentProject)
    set({
      currentProject: nextProject,
      commandStack: stackPush(commandStack, cmd),
      isDirty: true
    })
    const total = countClips(nextProject)
    if (total > LARGE_PROJECT_CLIP_THRESHOLD) {
      console.warn(
        `[Caption Studio] Large project: ${total} clips detected (threshold: ${LARGE_PROJECT_CLIP_THRESHOLD}). ` +
        'Performance may degrade — consider splitting into multiple projects.'
      )
    }
  },
  undo: () => {
    const { currentProject, commandStack } = get()
    if (currentProject === null || !stackCanUndo(commandStack)) return
    const next = stackUndo(commandStack, currentProject)
    set({ currentProject: next.doc, commandStack: next.stack, isDirty: true })
    const total = countClips(next.doc)
    if (total > LARGE_PROJECT_CLIP_THRESHOLD) {
      console.warn(
        `[Caption Studio] Large project: ${total} clips detected (threshold: ${LARGE_PROJECT_CLIP_THRESHOLD}). ` +
        'Performance may degrade — consider splitting into multiple projects.'
      )
    }
  },
  redo: () => {
    const { currentProject, commandStack } = get()
    if (currentProject === null || !stackCanRedo(commandStack)) return
    const next = stackRedo(commandStack, currentProject)
    set({ currentProject: next.doc, commandStack: next.stack, isDirty: true })
    const total = countClips(next.doc)
    if (total > LARGE_PROJECT_CLIP_THRESHOLD) {
      console.warn(
        `[Caption Studio] Large project: ${total} clips detected (threshold: ${LARGE_PROJECT_CLIP_THRESHOLD}). ` +
        'Performance may degrade — consider splitting into multiple projects.'
      )
    }
  },
  canUndo: () => stackCanUndo(get().commandStack),
  canRedo: () => stackCanRedo(get().commandStack),
  saveProject: async () => {
    const { currentProject, currentRef } = get()
    if (currentProject === null || currentRef === null) return
    set({ saveStatus: 'saving' })
    try {
      const result = await window.api.invoke('storage:writeProject', {
        ref: currentRef,
        project: currentProject,
        expectedUpdatedAt: currentProject.updatedAt
      })
      if (result.ok) {
        // Main stamps a fresh `updatedAt` on disk but `WriteResult` doesn't echo
        // the persisted doc. We mirror that stamp locally (vs. an extra
        // `storage:readProject` round-trip) so the NEXT save's conflict check
        // compares against the value we just wrote, not the stale one.
        // Re-read currentProject from the store (not the stale closure snapshot)
        // so any edits made while the IPC call was in-flight (trim, move, etc.)
        // are not overwritten.
        const now = new Date().toISOString()
        const live = get().currentProject
        set({
          currentProject: live !== null ? { ...live, updatedAt: now } : { ...currentProject, updatedAt: now },
          isDirty: live !== null && live !== currentProject,
          saveStatus: 'saved',
          // A conflict is last-write-wins (we still saved): surface the warning softly.
          saveError: result.data.conflict ? (result.data.warning ?? null) : null,
          lastSavedAt: now
        })
      } else {
        set({ saveStatus: 'error', saveError: result.error })
      }
    } catch (err: unknown) {
      console.error('[Caption Studio] autosave failed:', err)
      const message = err instanceof Error ? err.message : 'Failed to save project.'
      set({ saveStatus: 'error', saveError: message })
    }
  },
  loadProjects: async (location) => {
    set({ listStatus: 'loading', listError: null })
    try {
      const result = await window.api.invoke('storage:listProjects', { location })
      if (result.ok) {
        set({ projects: result.data, listStatus: 'ready', listError: null })
      } else {
        set({ projects: [], listStatus: 'error', listError: result.error })
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load projects.'
      set({ projects: [], listStatus: 'error', listError: message })
    }
  },
  openProject: async (ref) => {
    set({ openStatus: 'loading', openError: null })
    try {
      const result = await window.api.invoke('storage:readProject', { ref })
      if (result.ok) {
        const project = result.data
        set({
          currentProject: project,
          currentRef: ref,
          currentProjectId: project.id,
          openStatus: 'ready',
          openError: null,
          isDirty: false,
          commandStack: emptyStack(),
          saveStatus: 'idle',
          saveError: null,
          lastSavedAt: null
        })
        // P6.2: re-register + load imported fonts from the persisted manifest so
        // custom families render identically on reopen (and on another machine /
        // OneDrive). Best-effort — a font failure must not break opening the doc.
        if (project.fonts !== undefined && project.fonts.imported.length > 0) {
          void resolveBundleAbs(ref).then((bundleAbs) => {
            if (bundleAbs !== null) void rehydrateProjectFonts(project, bundleAbs)
          })
        }
      } else {
        set({
          currentProject: null,
          currentRef: null,
          openStatus: 'error',
          openError: result.error
        })
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to open project.'
      set({
        currentProject: null,
        currentRef: null,
        openStatus: 'error',
        openError: message
      })
    }
  },
  closeProject: () =>
    set({
      currentProject: null,
      currentRef: null,
      currentProjectId: null,
      openStatus: 'idle',
      openError: null,
      isDirty: false,
      commandStack: emptyStack(),
      saveStatus: 'idle',
      saveError: null,
      lastSavedAt: null
    }),
  createProject: async ({ location, name, aspect, fps, language }) => {
    try {
      const created = await window.api.invoke('storage:createProject', { location, name })
      if (!created.ok) return { ok: false, error: created.error }
      const ref = created.data

      const read = await window.api.invoke('storage:readProject', { ref })
      if (!read.ok) return { ok: false, error: read.error }

      const project = read.data
      const next = {
        ...project,
        settings: {
          ...project.settings,
          aspect,
          fps,
          language,
          languages: [...DEFAULT_LANGUAGES],
          resolution: resolutionForAspect(aspect)
        }
      }

      const written = await window.api.invoke('storage:writeProject', { ref, project: next })
      if (!written.ok) return { ok: false, error: written.error }

      await get().loadProjects(location)
      return { ok: true, ref }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create project.'
      return { ok: false, error: message }
    }
  },
  duplicateProject: async (ref) => {
    try {
      const result = await window.api.invoke('storage:duplicateProject', { ref })
      if (!result.ok) {
        set({ listError: result.error })
        return { ok: false, error: result.error }
      }
      await get().loadProjects(ref.location)
      return { ok: true }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to duplicate project.'
      set({ listError: message })
      return { ok: false, error: message }
    }
  },
  renameProject: async (ref, name) => {
    try {
      const result = await window.api.invoke('storage:renameProject', { ref, name })
      if (!result.ok) {
        set({ listError: result.error })
        return { ok: false, error: result.error }
      }
      await get().loadProjects(ref.location)
      return { ok: true }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to rename project.'
      set({ listError: message })
      return { ok: false, error: message }
    }
  },
  deleteProject: async (ref) => {
    try {
      const result = await window.api.invoke('storage:deleteProject', { ref })
      if (!result.ok) {
        set({ listError: result.error })
        return { ok: false, error: result.error }
      }
      await get().loadProjects(ref.location)
      return { ok: true }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete project.'
      set({ listError: message })
      return { ok: false, error: message }
    }
  },
  revealProject: async (ref) => {
    try {
      const result = await window.api.invoke('storage:revealProject', { ref })
      if (!result.ok) {
        set({ listError: result.error })
        return { ok: false, error: result.error }
      }
      return { ok: true }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to reveal project.'
      set({ listError: message })
      return { ok: false, error: message }
    }
  }
}))

/** Resolve a ref's bundle absolute path via IPC (for font re-hydration). */
async function resolveBundleAbs(ref: ProjectRef): Promise<string | null> {
  try {
    const r = await window.api.invoke('storage:resolvePath', { ref })
    return r.ok ? r.data.path : null
  } catch {
    return null
  }
}

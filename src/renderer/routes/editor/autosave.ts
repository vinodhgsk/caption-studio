import type { ProjectState } from '@/store/projectStore'

/** Debounce window for autosave, in ms. Long enough to collapse rapid edits. */
export const AUTOSAVE_DEBOUNCE_MS = 1500

/**
 * Pure decision for whether a debounced autosave should fire: only when there
 * are unsaved changes, a project is open, and a save is not already in flight
 * (so the trailing edit does not stack a redundant write). Saving flips
 * `isDirty` false, so this also prevents a save loop.
 */
export function shouldAutosave(
  isDirty: boolean,
  saveStatus: ProjectState['saveStatus'],
  hasProject: boolean
): boolean {
  return isDirty && hasProject && saveStatus !== 'saving'
}

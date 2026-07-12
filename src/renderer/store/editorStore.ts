import { create } from 'zustand'
import type { PanelId } from '../routes/editor/panels'

/**
 * Placeholder editor slice. Timeline, selection, and playhead state are filled
 * in during Phase 3; this exists so the store wiring boots cleanly.
 *
 * `activePanel` (P2.7) tracks which contextual side panel the right column
 * shows; it is a typed `PanelId` literal union and defaults to `'media'`.
 */
export interface EditorState {
  selectedClipId: string | null
  playhead: number
  activePanel: PanelId
  select: (id: string | null) => void
  setPlayhead: (time: number) => void
  setActivePanel: (panel: PanelId) => void
}

export const useEditorStore = create<EditorState>((set) => ({
  selectedClipId: null,
  playhead: 0,
  activePanel: 'media',
  select: (id) => set({ selectedClipId: id }),
  setPlayhead: (time) => set({ playhead: time }),
  setActivePanel: (panel) => set({ activePanel: panel })
}))

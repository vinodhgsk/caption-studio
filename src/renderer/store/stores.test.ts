import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '../../shared/ipc'
import { useEditorStore } from './editorStore'
import { useProjectStore } from './projectStore'
import { PANELS } from '../routes/editor/panels'

describe('app modules import cleanly', () => {
  it('exposes the shared IPC channel registry', () => {
    expect(IPC_CHANNELS).toContain('app:getState')
  })

  it('boots the project store with empty initial state', () => {
    const state = useProjectStore.getState()
    expect(state.currentProjectId).toBeNull()
    expect(state.isDirty).toBe(false)
  })

  it('boots the editor store with empty initial state', () => {
    const state = useEditorStore.getState()
    expect(state.selectedClipId).toBeNull()
    expect(state.playhead).toBe(0)
  })

  it('defaults the active panel to media', () => {
    expect(useEditorStore.getState().activePanel).toBe('media')
  })

  it('switches the active panel via setActivePanel', () => {
    useEditorStore.getState().setActivePanel('text')
    expect(useEditorStore.getState().activePanel).toBe('text')
    // Restore default so test order stays independent.
    useEditorStore.getState().setActivePanel('media')
    expect(useEditorStore.getState().activePanel).toBe('media')
  })

  it('registers all panels in docs/01 order (includes reveal panel from P8R.11)', () => {
    expect(PANELS.map((p) => p.id)).toEqual([
      'media',
      'audio',
      'captions',
      'text',
      'effects',
      'decorations',
      'animation',
      'reveal',
      'transitions',
      'fonts',
      'aiTools',
      'presets',
      'export'
    ])
  })
})

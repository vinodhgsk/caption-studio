import { create } from 'zustand'
import type { UserPreset } from '../../shared/userPreset'

interface UserPresetState {
  presets: UserPreset[]
  loading: boolean
  loadPresets: () => Promise<void>
  savePreset: (preset: UserPreset) => Promise<void>
  deletePreset: (id: string) => Promise<void>
}

export const useUserPresetStore = create<UserPresetState>((set, get) => ({
  presets: [],
  loading: false,
  loadPresets: async () => {
    set({ loading: true })
    try {
      const result = await window.api.invoke('preset:list', {})
      if (result.ok) {
        set({ presets: result.data })
      }
    } finally {
      set({ loading: false })
    }
  },
  savePreset: async (preset: UserPreset) => {
    const result = await window.api.invoke('preset:save', { preset })
    if (result.ok) {
      await get().loadPresets()
    }
  },
  deletePreset: async (id: string) => {
    const result = await window.api.invoke('preset:delete', { id })
    if (result.ok) {
      await get().loadPresets()
    }
  }
}))

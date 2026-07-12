/**
 * Editor side-panel registry (P2.7).
 *
 * Per docs/01: the right side hosts contextual panels switched by a left rail —
 * Media, Text, Captions, Effects, Decorations, Animation, Transitions, Audio,
 * Fonts, AI Tools, Presets, Export. `PanelId` is a literal union so the store,
 * rail, and container stay exhaustively in sync; adding or removing a panel
 * here surfaces as a type error at every use site.
 */
export type PanelId =
  | 'media'
  | 'text'
  | 'captions'
  | 'effects'
  | 'decorations'
  | 'animation'
  | 'reveal'
  | 'transitions'
  | 'audio'
  | 'fonts'
  | 'aiTools'
  | 'presets'
  | 'export'

export interface PanelDef {
  /** Stable, typed identifier used by the store + container switch. */
  id: PanelId
  /** Human-readable label shown in the rail and as the panel header. */
  label: string
}

/** Panels in display order, matching docs/01. */
export const PANELS: readonly PanelDef[] = [
  // Media → Audio → Captions lead (the core auto-caption workflow order).
  { id: 'media', label: 'Media' },
  { id: 'audio', label: 'Audio' },
  { id: 'captions', label: 'Captions' },
  { id: 'text', label: 'Text' },
  { id: 'effects', label: 'Effects' },
  { id: 'decorations', label: 'Decorations' },
  { id: 'animation', label: 'Animation' },
  { id: 'reveal', label: 'Reveal' },
  { id: 'transitions', label: 'Transitions' },
  { id: 'fonts', label: 'Fonts' },
  { id: 'aiTools', label: 'AI Tools' },
  { id: 'presets', label: 'Presets' },
  { id: 'export', label: 'Export' }
] as const

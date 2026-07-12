import { useEditorStore } from '@/store/editorStore'
import { AIToolsPanel } from './AIToolsPanel'
import { AnimationPanel } from './AnimationPanel'
import { AudioPanel } from './AudioPanel'
import { AutoCaptionPanel } from './AutoCaptionPanel'
import { ExportPanel } from './ExportPanel'
import { MediaPanel } from './MediaPanel'
import { RevealPanel } from './RevealPanel'
import { TextPanel } from './TextPanel'
import { TransitionsPanel } from './TransitionsPanel'
import { PresetsPanel } from './PresetsPanel'
import { PANELS, type PanelId } from './panels'

/** Tiny presentational placeholder shown until a panel's real internals land. */
function PanelPlaceholder({ label }: { label: string }): JSX.Element {
  return (
    <section className="flex h-full flex-col gap-2 p-4">
      <h2 className="text-sm font-semibold text-text-primary">{label}</h2>
      <p className="text-xs text-text-muted">Panel content arrives in a later phase.</p>
    </section>
  )
}

/** Resolve a panel id to its registry label (panels are always registered). */
function labelFor(id: PanelId): string {
  const def = PANELS.find((p) => p.id === id)
  return def?.label ?? id
}

/** Render a panel's body. Most are placeholders; Media (P3.3) is real. */
function PanelBody({ id }: { id: PanelId }): JSX.Element {
  switch (id) {
    case 'media':
      return <MediaPanel />
    case 'text':
      return <TextPanel />
    case 'audio':
      return <AudioPanel />
    case 'captions':
      return <AutoCaptionPanel />
    case 'animation':
      return <AnimationPanel />
    case 'reveal':
      return <RevealPanel />
    case 'transitions':
      return <TransitionsPanel />
    case 'aiTools':
      return <AIToolsPanel />
    case 'presets':
      return <PresetsPanel />
    case 'export':
      return <ExportPanel />
    case 'effects':
    case 'decorations':
    case 'fonts':
      return <PanelPlaceholder label={labelFor(id)} />
    default: {
      const exhaustive: never = id
      return exhaustive
    }
  }
}

/**
 * Right contextual panel container (P2.7): reads `activePanel` and renders the
 * matching panel body inside the contextual aside. `PanelBody` is exhaustive
 * over `PanelId` — a missing or extra panel becomes a compile error via the
 * `never` default branch.
 */
export function PanelContainer(): JSX.Element {
  const activePanel = useEditorStore((s) => s.activePanel)

  return (
    <aside
      aria-label={`${labelFor(activePanel)} panel`}
      className="w-72 shrink-0 overflow-y-auto border-l border-line bg-surface-1"
    >
      <PanelBody id={activePanel} />
    </aside>
  )
}

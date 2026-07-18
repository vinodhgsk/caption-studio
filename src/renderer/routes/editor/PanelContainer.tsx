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

/** Placeholder for panels not yet implemented. */
function PanelPlaceholder({ label }: { label: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center px-6">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-text-muted">
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
        </svg>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-semibold text-text-primary">{label}</p>
        <p className="text-[10px] text-text-muted leading-relaxed">Coming soon</p>
      </div>
    </div>
  )
}

function labelFor(id: PanelId): string {
  return PANELS.find((p) => p.id === id)?.label ?? id
}

function PanelBody({ id }: { id: PanelId }): JSX.Element {
  switch (id) {
    case 'media':       return <MediaPanel />
    case 'text':        return <TextPanel />
    case 'audio':       return <AudioPanel />
    case 'captions':    return <AutoCaptionPanel />
    case 'animation':   return <AnimationPanel />
    case 'reveal':      return <RevealPanel />
    case 'transitions': return <TransitionsPanel />
    case 'aiTools':     return <AIToolsPanel />
    case 'presets':     return <PresetsPanel />
    case 'export':      return <ExportPanel />
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
 * Right contextual panel container (CapCut-style):
 * - Fixed 280px width on the right
 * - Styled header: panel name + reset (↺) and keyframe (◇) icon buttons
 * - Scrollable body
 */
export function PanelContainer({ width }: { width: number }): JSX.Element {
  const activePanel = useEditorStore((s) => s.activePanel)
  const label = labelFor(activePanel)

  return (
    <aside
      aria-label={`${label} panel`}
      className="flex shrink-0 flex-col border-l border-line bg-surface-1 overflow-hidden right-panel-container"
      style={{ width }}
    >
      {/* Panel header — matches CapCut's right-panel header style */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-4">
        <span className="text-xs font-semibold text-text-primary">{label}</span>
        <div className="flex items-center gap-1">
          {/* Reset icon (↺) */}
          <button
            type="button"
            aria-label="Reset panel"
            title="Reset to defaults"
            className="flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          {/* Keyframe diamond icon (◇) */}
          <button
            type="button"
            aria-label="Add keyframe"
            title="Add keyframe"
            className="flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l4 8H8l4-8zM12 22l-4-8h8l-4 8z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2 12l8-4v8L2 12zM22 12l-8 4V8l8 4z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Panel body — scrollable */}
      <div className="flex-1 overflow-y-auto">
        <PanelBody id={activePanel} />
      </div>
    </aside>
  )
}

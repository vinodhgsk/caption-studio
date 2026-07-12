import { useEditorStore } from '@/store/editorStore'
import type { PanelId } from './panels'

/**
 * Left media panel nav (CapCut-style): 80px icon+label tab strip.
 * Each tab shows a SVG icon above its label. Active tab has an accent
 * underline + accent text. Matches CapCut's top-of-panel icon row.
 */

interface PanelTab {
  id: PanelId
  label: string
  iconPath: string | string[]
  /** True = render as two separate <path> elements (e.g. compound icons). */
  multiPath?: boolean
}

const TABS: PanelTab[] = [
  {
    id: 'media',
    label: 'Media',
    iconPath: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z'
  },
  {
    id: 'audio',
    label: 'Audio',
    iconPath: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3'
  },
  {
    id: 'text',
    label: 'Text',
    iconPath: 'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z'
  },
  {
    id: 'captions',
    label: 'Captions',
    iconPath: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z'
  },
  {
    id: 'effects',
    label: 'Effects',
    iconPath: 'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z'
  },
  {
    id: 'transitions',
    label: 'Transition',
    iconPath: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4'
  },
  {
    id: 'animation',
    label: 'Animation',
    iconPath: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    multiPath: true
  },
  {
    id: 'aiTools',
    label: 'AI Tools',
    iconPath: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z'
  },
  {
    id: 'presets',
    label: 'Presets',
    iconPath: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10'
  },
  {
    id: 'export',
    label: 'Export',
    iconPath: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4'
  }
]

function TabIcon({ path, multiPath }: { path: string | string[]; multiPath?: boolean }): JSX.Element {
  const paths = Array.isArray(path) ? path : multiPath ? path.split(' M ').filter(Boolean).map((p, i) => (i === 0 ? p : 'M ' + p)) : [path as string]
  return (
    <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      {paths.map((d, i) => (
        <path key={i} strokeLinecap="round" strokeLinejoin="round" d={d} />
      ))}
    </svg>
  )
}

export function LeftRail(): JSX.Element {
  const activePanel = useEditorStore((s) => s.activePanel)
  const setActivePanel = useEditorStore((s) => s.setActivePanel)

  return (
    <nav
      aria-label="Editor panels"
      className="flex w-[78px] shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r border-line bg-surface-1"
    >
      {TABS.map((tab) => {
        const isActive = tab.id === activePanel
        return (
          <button
            key={tab.id}
            type="button"
            aria-label={tab.label}
            aria-pressed={isActive}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => setActivePanel(tab.id)}
            className={[
              'relative flex flex-col items-center justify-center gap-1 px-1 py-2.5 text-center transition-colors',
              isActive
                ? 'text-accent bg-surface-2/60'
                : 'text-text-muted hover:bg-surface-2/40 hover:text-text-secondary'
            ].join(' ')}
          >
            {/* Active indicator — bottom border line like CapCut's top-row tabs */}
            {isActive && (
              <span
                aria-hidden="true"
                className="absolute bottom-0 left-3 right-3 h-[2px] rounded-t-full bg-accent"
              />
            )}
            <TabIcon path={tab.iconPath} />
            <span className="text-[9px] font-medium leading-tight tracking-wide">{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

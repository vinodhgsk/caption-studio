import { useEditorStore } from '@/store/editorStore'
import { PANELS } from './panels'

/**
 * Left rail (P2.7): a narrow vertical strip of panel buttons that switch the
 * right-side contextual panel. The active panel is highlighted with a surface
 * fill, accent text, and a left accent bar. Buttons are real `<button>`s with
 * `aria-label` + `aria-current`/`aria-pressed` so the active item is announced.
 *
 * This is containers + switching only — panel internals land in later phases.
 */
export function LeftRail(): JSX.Element {
  const activePanel = useEditorStore((s) => s.activePanel)
  const setActivePanel = useEditorStore((s) => s.setActivePanel)

  return (
    <nav
      aria-label="Editor panels"
      className="flex w-16 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line bg-surface-1 p-1"
    >
      {PANELS.map((panel) => {
        const isActive = panel.id === activePanel
        return (
          <button
            key={panel.id}
            type="button"
            aria-label={panel.label}
            aria-pressed={isActive}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => setActivePanel(panel.id)}
            className={[
              'relative flex flex-col items-center justify-center rounded-md px-1 py-2 text-center text-xs font-medium transition-colors',
              isActive
                ? 'bg-surface-2 text-accent'
                : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary'
            ].join(' ')}
          >
            {isActive && (
              <span
                aria-hidden="true"
                className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-md bg-accent"
              />
            )}
            {panel.label}
          </button>
        )
      })}
    </nav>
  )
}

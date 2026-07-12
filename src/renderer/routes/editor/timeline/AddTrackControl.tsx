import { useState } from 'react'
import type { ProjectTrack } from '../../../../shared/storage'
import { useTimelineStore } from '@/store/timelineStore'
import { trackLabel } from './trackKind'

/** Track types a user can add a fresh row for (CapCut-style). `effect` is omitted
 * here — effect tracks are created implicitly by effect tooling, not manually. */
const ADDABLE_TYPES: ProjectTrack['type'][] = ['video', 'audio', 'text']

/**
 * "Add track" control (CapCut-style): a compact button that opens a small menu to
 * append a NEW empty track row of the chosen type. The new row appears below the
 * existing tracks; the add is ONE undoable step (`addEmptyTrack`). The newly
 * created track's clips are then filled by importing media / adding text.
 *
 * Rendered at the bottom of the timeline's header column so it lines up with the
 * lanes area; the menu is a fixed-position popup with a full-screen backdrop that
 * closes it on any outside click.
 */
export function AddTrackControl(): JSX.Element {
  const addEmptyTrack = useTimelineStore((s) => s.addEmptyTrack)
  const [open, setOpen] = useState(false)

  return (
    <div className="flex items-center px-2 py-1">
      <button
        type="button"
        aria-label="Add track"
        title="Add a new track row"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-center gap-1 rounded-sm border border-dashed border-line px-2 py-1 text-[11px] font-medium text-text-muted hover:border-accent hover:text-text-primary"
      >
        <span className="text-sm leading-none">+</span>
        <span>Track</span>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            aria-hidden="true"
            onPointerDown={() => setOpen(false)}
          />
          <div
            role="menu"
            className="fixed bottom-3 left-3 z-50 min-w-32 overflow-hidden rounded-md border border-line bg-surface-2 py-1 text-xs shadow-lg"
          >
            {ADDABLE_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-accent hover:text-white"
                onClick={() => {
                  addEmptyTrack(type)
                  setOpen(false)
                }}
              >
                {trackLabel(type)} track
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

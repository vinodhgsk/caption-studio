import { useEffect, useRef, useState } from 'react'

/** A single action exposed by the card's kebab menu. */
export interface ProjectCardMenuItem {
  key: string
  label: string
  onSelect: () => void
  /** Render with destructive (danger) styling. */
  danger?: boolean
}

export interface ProjectCardMenuProps {
  /** Accessible label for the trigger (e.g. `Actions for "My project"`). */
  label: string
  items: ProjectCardMenuItem[]
}

/**
 * Kebab ("⋯") actions menu for a project card. The trigger and every item are
 * real buttons (keyboard-focusable). Clicks stop propagation so they never
 * bubble to the card's open handler. Closes on outside click and Escape.
 */
export default function ProjectCardMenu({ label, items }: ProjectCardMenuProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface-2 text-text-secondary transition-colors hover:bg-surface-0 hover:text-text-primary focus-visible:border-accent focus-visible:outline-none"
      >
        <span aria-hidden className="text-base leading-none">
          ⋯
        </span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1 min-w-[10rem] overflow-hidden rounded-md border border-line bg-surface-1 py-1 shadow-xl"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                item.onSelect()
              }}
              className={`block w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-surface-2 ${
                item.danger ? 'text-danger' : 'text-text-primary'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

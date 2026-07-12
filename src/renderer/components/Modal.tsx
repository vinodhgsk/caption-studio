import { useEffect, useId, useRef, type ReactNode } from 'react'

export interface ModalProps {
  /** Whether the modal is mounted/visible. */
  open: boolean
  /** Title text, rendered as the dialog's accessible label. */
  title: string
  /** Requested close (Escape, overlay click, or a child action). */
  onClose: () => void
  children: ReactNode
}

/**
 * Generic token-styled modal: a dimmed overlay plus a centered panel with
 * `role="dialog" aria-modal`. Closes on Escape and overlay click. Focus is
 * moved into the panel on open so keyboard users land inside the dialog; the
 * concrete dialog focuses its first field via an effect of its own.
 */
export default function Modal({ open, title, onClose, children }: ModalProps): JSX.Element | null {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/70 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-lg border border-line bg-surface-1 shadow-xl"
      >
        <h2
          id={titleId}
          className="border-b border-line px-5 py-4 text-lg font-semibold text-text-primary"
        >
          {title}
        </h2>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

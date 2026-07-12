import { useCallback, useEffect, useRef, useState } from 'react'
import { visibleWindow, type ViewWindow } from './scale'

/**
 * Tracks the visible time window of a horizontally-scrollable element at the
 * active `pxPerSec`. This is the SEAM P3.4 reads to virtualize clips: a lane
 * passes its scroll container ref here and gets `{ startSec, endSec }`, then
 * feeds that to `visibleClips(track, window)` (P3.4) — no off-screen clips.
 *
 * The window math itself lives in the pure `visibleWindow` helper (constraint C);
 * this hook only wires DOM scroll/resize into it.
 */
export function useVisibleWindow(
  ref: React.RefObject<HTMLElement>,
  pxPerSec: number
): ViewWindow {
  const [win, setWin] = useState<ViewWindow>({ startSec: 0, endSec: 0 })
  const pxPerSecRef = useRef(pxPerSec)
  pxPerSecRef.current = pxPerSec

  const recompute = useCallback(() => {
    const el = ref.current
    if (el === null) return
    setWin(visibleWindow(el.scrollLeft, el.clientWidth, pxPerSecRef.current))
  }, [ref])

  useEffect(() => {
    const el = ref.current
    if (el === null) return
    recompute()
    el.addEventListener('scroll', recompute, { passive: true })
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(recompute) : null
    observer?.observe(el)
    return () => {
      el.removeEventListener('scroll', recompute)
      observer?.disconnect()
    }
  }, [ref, recompute])

  // Re-derive the window when the scale changes (zoom) even without a scroll event.
  useEffect(() => {
    recompute()
  }, [pxPerSec, recompute])

  return win
}

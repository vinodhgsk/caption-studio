import { useCallback, useState, type KeyboardEvent } from 'react'
import { useProjectStore } from '@/store/projectStore'
import { useTimelineStore } from '@/store/timelineStore'
import type { Aspect } from '../home/aspect'
import { PreviewCanvas } from './preview/PreviewCanvas'
import { PreviewInteraction } from './preview/PreviewInteraction'
import { TransformControls } from './preview/TransformControls'
import { TransportBar } from './preview/TransportBar'
import { aspectRatioStyle } from './stageAspect'

interface PreviewRegionProps {
  /** Project aspect ratio — the letterboxed stage respects it. */
  aspect: Aspect
}

/** Shallow-equal two clip-size maps (same keys + same width/height). */
function sameSizes(
  a: Map<string, { width: number; height: number }>,
  b: Map<string, { width: number; height: number }>
): boolean {
  if (a.size !== b.size) return false
  for (const [k, v] of a) {
    const o = b.get(k)
    if (o === undefined || o.width !== v.width || o.height !== v.height) return false
  }
  return true
}

/** True when the keyboard event originates from an editable/text field. */
function isFromTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
  )
}

/**
 * Center region (region 2 of the editor shell): a letterboxed stage matching
 * the project aspect ratio, with the transport control bar (P3.10) docked
 * below it. The stage hosts the composited preview canvas (P3.9), which renders
 * the video + image clips visible at the timeline playhead.
 *
 * Keyboard: Space toggles play/pause on this region (guarded against text
 * inputs and modifier combos). Frame-step uses Left/Right (`,`/`.` aliases).
 * These do NOT conflict with the timeline footer's S/Delete handler — that
 * handler ignores Space/arrows, and focus scoping keeps the two regions
 * independent.
 */
export function PreviewRegion({ aspect }: PreviewRegionProps): JSX.Element {
  const project = useProjectStore((s) => s.currentProject)
  // Intrinsic clip sizes reported by the canvas each frame; the interaction
  // overlay (P3.11) uses them for hit-testing + drawn-bounds math.
  const [drawnSizes, setDrawnSizes] = useState<Map<string, { width: number; height: number }>>(
    () => new Map()
  )

  // Dedupe per-frame size reports so we only re-render when sizes actually
  // change (the canvas calls back every painted frame, incl. during playback).
  const handleDrawnSizes = useCallback(
    (next: Map<string, { width: number; height: number }>): void => {
      setDrawnSizes((prev) => (sameSizes(prev, next) ? prev : next))
    },
    []
  )

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLElement>): void => {
    if (isFromTextInput(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
    const store = useTimelineStore.getState()
    // While inline-editing a text clip, the textarea owns the keyboard.
    if (store.editingTextClipId !== null) return
    const { togglePlay, stepFrame } = store
    // Enter / F2 enters inline edit mode for a single selected TEXT clip (P3.14).
    if (e.key === 'Enter' || e.key === 'F2') {
      const project = useProjectStore.getState().currentProject
      const sel = store.selection
      if (project !== null && sel.length === 1) {
        const onTextTrack = project.tracks.some(
          (t) => t.type === 'text' && t.clips.some((c) => c.id === sel[0])
        )
        if (onTextTrack) {
          e.preventDefault()
          store.beginTextEdit(sel[0])
          return
        }
      }
      return
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault()
      togglePlay()
    } else if (e.key === 'ArrowRight' || e.key === '.') {
      e.preventDefault()
      stepFrame(1)
    } else if (e.key === 'ArrowLeft' || e.key === ',') {
      e.preventDefault()
      stepFrame(-1)
    }
  }, [])

  return (
    <section
      className="flex flex-1 flex-col overflow-hidden bg-surface-0 outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
        <div className="flex h-full w-full items-center justify-center rounded-xl border border-line/80 bg-[#3a4049] p-4 shadow-inner">
          <div
            className="relative flex max-h-[96%] max-w-[96%] items-center justify-center overflow-hidden rounded-lg border-2 border-white/45 shadow-[0_0_0_1px_rgba(255,255,255,0.14),0_0_0_8px_rgba(0,0,0,0.34),0_24px_40px_rgba(0,0,0,0.58)]"
            style={{ aspectRatio: aspectRatioStyle(aspect), width: 'auto', height: '100%' }}
          >
            {project === null ? (
              <span className="text-sm text-text-muted">Preview</span>
            ) : (
              <>
                <PreviewCanvas project={project} onDrawnSizes={handleDrawnSizes} />
                <PreviewInteraction project={project} drawnSizes={drawnSizes} />
              </>
            )}
          </div>
        </div>
      </div>
      <TransformControls />
      <TransportBar />
    </section>
  )
}

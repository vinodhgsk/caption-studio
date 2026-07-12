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
  aspect: Aspect
}

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

function isFromTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/**
 * Centre preview region (CapCut-style):
 * - "Player" label strip at the top
 * - Dark charcoal surround (#1a1d21) to match CapCut's monitor background
 * - Clean stage: no double-border box, just the stage itself with a thin accent frame
 * - TransformControls + TransportBar docked below
 */
export function PreviewRegion({ aspect }: PreviewRegionProps): JSX.Element {
  const project = useProjectStore((s) => s.currentProject)
  const [drawnSizes, setDrawnSizes] = useState<Map<string, { width: number; height: number }>>(
    () => new Map()
  )

  const handleDrawnSizes = useCallback(
    (next: Map<string, { width: number; height: number }>): void => {
      setDrawnSizes((prev) => (sameSizes(prev, next) ? prev : next))
    },
    []
  )

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLElement>): void => {
    if (isFromTextInput(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
    const store = useTimelineStore.getState()
    if (store.editingTextClipId !== null) return
    const { togglePlay, stepFrame } = store
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
      className="flex flex-1 flex-col overflow-hidden outline-none"
      style={{ backgroundColor: '#14171a' }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* ── Player header strip — matches CapCut's "Player" label ── */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-line/50 px-4"
        style={{ backgroundColor: '#1a1d21' }}>
        <span className="text-[11px] font-semibold tracking-wide text-text-secondary">Player</span>
        {/* Right: aspect ratio chip */}
        {project !== null && (
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[9px] font-bold text-text-muted border border-line">
            {aspect}
          </span>
        )}
      </div>

      {/* ── Stage area — dark monitor surround ── */}
      <div
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        style={{ backgroundColor: '#14171a', padding: '16px' }}
      >
        {/* Stage frame: thin white border like CapCut's player frame */}
        <div
          className="relative overflow-hidden rounded-sm shadow-[0_0_0_1px_rgba(255,255,255,0.12),0_8px_32px_rgba(0,0,0,0.7)]"
          style={{
            aspectRatio: aspectRatioStyle(aspect),
            height: '100%',
            maxHeight: '100%',
            maxWidth: '100%',
            width: 'auto'
          }}
        >
          {project === null ? (
            <div className="flex h-full w-full items-center justify-center bg-surface-2">
              <span className="text-sm text-text-muted">Preview</span>
            </div>
          ) : (
            <>
              <PreviewCanvas project={project} onDrawnSizes={handleDrawnSizes} />
              <PreviewInteraction project={project} drawnSizes={drawnSizes} />
            </>
          )}
        </div>
      </div>

      {/* ── Docked controls below the stage ── */}
      <TransformControls />
      <TransportBar />
    </section>
  )
}

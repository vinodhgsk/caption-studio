import { useTimelineStore } from '@/store/timelineStore'
import { useProjectStore } from '@/store/projectStore'
import { formatTimecode } from './timecode'
import { projectDurationSec } from '../timeline/scale'

/**
 * Transport control bar (CapCut-style):
 * - Left: teal current timecode + separator + project duration
 * - Centre: step-back | play/pause circle | step-forward
 * - Right: In/Out point icons + quality toggle
 */
export function TransportBar(): JSX.Element {
  const project = useProjectStore((s) => s.currentProject)
  const playhead = useTimelineStore((s) => s.playhead)
  const isPlaying = useTimelineStore((s) => s.isPlaying)
  const inPoint = useTimelineStore((s) => s.inPoint)
  const outPoint = useTimelineStore((s) => s.outPoint)
  const previewQuality = useTimelineStore((s) => s.previewQuality)

  const togglePlay = useTimelineStore((s) => s.togglePlay)
  const stepFrame = useTimelineStore((s) => s.stepFrame)
  const setInPoint = useTimelineStore((s) => s.setInPoint)
  const setOutPoint = useTimelineStore((s) => s.setOutPoint)
  const clearInOut = useTimelineStore((s) => s.clearInOut)
  const togglePreviewQuality = useTimelineStore((s) => s.togglePreviewQuality)

  const fps = project?.settings.fps ?? 30
  const hasInOut = inPoint !== null || outPoint !== null

  /** Total project duration for the duration display */
  const totalSec = project !== null ? projectDurationSec(project.tracks) : 0

  const iconBtn = 'flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed'
  const smallBtn = 'flex h-6 items-center gap-1 rounded px-2 text-[10px] font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text-secondary disabled:opacity-30'

  return (
    <div className="flex h-10 w-full shrink-0 items-center justify-between border-t border-line bg-surface-1 px-4">

      {/* ── Left: teal timecode + duration ── */}
      <div className="flex items-center gap-2 font-mono tabular-nums">
        <span
          className="text-sm font-bold tracking-wider"
          style={{ color: '#00d4c8' }}
          aria-label="Current timecode"
        >
          {formatTimecode(playhead, fps)}
        </span>
        <span className="text-text-muted/50 text-xs">/</span>
        <span className="text-xs text-text-muted">
          {formatTimecode(totalSec, fps)}
        </span>
      </div>

      {/* ── Centre: playback controls ── */}
      <div className="flex items-center gap-1">
        {/* Step back */}
        <button
          type="button"
          aria-label="Step back one frame"
          onClick={() => stepFrame(-1)}
          disabled={project === null}
          className={iconBtn}
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
          </svg>
        </button>

        {/* Play / Pause — circle button */}
        <button
          type="button"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          aria-pressed={isPlaying}
          onClick={() => togglePlay()}
          disabled={project === null}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface-2 text-text-primary shadow-md transition-all hover:border-accent/40 hover:bg-surface-0 hover:shadow-lg hover:shadow-accent/10 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {isPlaying ? (
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          ) : (
            <svg className="h-4 w-4 translate-x-px" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Step forward */}
        <button
          type="button"
          aria-label="Step forward one frame"
          onClick={() => stepFrame(1)}
          disabled={project === null}
          className={iconBtn}
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z" />
          </svg>
        </button>
      </div>

      {/* ── Right: In/Out markers + quality toggle ── */}
      <div className="flex items-center gap-1">
        {/* Set In point */}
        <button
          type="button"
          aria-label="Set in point"
          title={`Set In${inPoint !== null ? ' · ' + formatTimecode(inPoint, fps) : ''}`}
          onClick={() => setInPoint(playhead)}
          disabled={project === null}
          className={smallBtn}
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 19V5M7 5l4-4 4 4" />
          </svg>
          {inPoint !== null && <span className="text-accent">{formatTimecode(inPoint, fps)}</span>}
        </button>

        {/* Set Out point */}
        <button
          type="button"
          aria-label="Set out point"
          title={`Set Out${outPoint !== null ? ' · ' + formatTimecode(outPoint, fps) : ''}`}
          onClick={() => setOutPoint(playhead)}
          disabled={project === null}
          className={smallBtn}
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 5v14M9 19l4 4 4-4" />
          </svg>
          {outPoint !== null && <span className="text-accent">{formatTimecode(outPoint, fps)}</span>}
        </button>

        {/* Clear In/Out */}
        {hasInOut && (
          <button
            type="button"
            aria-label="Clear in and out points"
            onClick={() => clearInOut()}
            className={smallBtn}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* Divider */}
        <span className="mx-1 h-4 w-px bg-line" />

        {/* Quality toggle */}
        <button
          type="button"
          aria-label="Toggle preview quality"
          aria-pressed={previewQuality === 'half'}
          onClick={() => togglePreviewQuality()}
          disabled={project === null}
          className={`${smallBtn} ${previewQuality === 'half' ? 'text-accent' : ''}`}
          title="Toggle preview quality (Full / Half)"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          {previewQuality === 'half' ? '½' : 'Full'}
        </button>
      </div>
    </div>
  )
}

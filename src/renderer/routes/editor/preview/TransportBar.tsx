import { useTimelineStore } from '@/store/timelineStore'
import { useProjectStore } from '@/store/projectStore'
import { formatTimecode } from './timecode'

/**
 * Transport control bar (P3.10) for the preview region (region 2). BINDS to the
 * single authoritative clock/state in `timelineStore` — it adds NO new clock,
 * only calls existing/added store actions:
 *
 * - Play/Pause      → `togglePlay()` (icon reflects `isPlaying`).
 * - Frame back/fwd  → `stepFrame(-1 | +1)` (pauses, steps one frame, clamps).
 * - Set In / Set Out / Clear → `setInPoint` / `setOutPoint` / `clearInOut`
 *   at the current playhead (VIEW state only; not persisted).
 * - Quality toggle  → `togglePreviewQuality()` (full | half backing store).
 * - Timecode        → `formatTimecode(playhead, fps)` as `MM:SS:FF`.
 *
 * Zoom-to-fit lives in the timeline toolbar (next to ZoomControl) where the
 * scroll-container ref / viewport width is available — see Timeline.tsx.
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

  const iconButton =
    'flex h-7 w-7 items-center justify-center rounded-sm bg-surface-2 text-text-secondary hover:text-text-primary disabled:opacity-50'
  const textButton =
    'rounded-sm bg-surface-2 px-2 py-1 text-xs font-medium text-text-secondary hover:text-text-primary disabled:opacity-50'

  return (
    <div className="flex h-9 w-full shrink-0 items-center justify-between gap-3 border-t border-line bg-surface-1 px-3">
      {/* Playback + frame-step. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Step back one frame"
          onClick={() => stepFrame(-1)}
          disabled={project === null}
          className={iconButton}
        >
          ⏮
        </button>
        <button
          type="button"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          aria-pressed={isPlaying}
          onClick={() => togglePlay()}
          disabled={project === null}
          className={iconButton}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button
          type="button"
          aria-label="Step forward one frame"
          onClick={() => stepFrame(1)}
          disabled={project === null}
          className={iconButton}
        >
          ⏭
        </button>
        <span className="ml-2 font-mono text-xs tabular-nums text-text-secondary" aria-label="Current timecode">
          {formatTimecode(playhead, fps)}
        </span>
      </div>

      {/* In / Out markers. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Set in point"
          onClick={() => setInPoint(playhead)}
          disabled={project === null}
          className={textButton}
        >
          Set In{inPoint !== null ? ` · ${formatTimecode(inPoint, fps)}` : ''}
        </button>
        <button
          type="button"
          aria-label="Set out point"
          onClick={() => setOutPoint(playhead)}
          disabled={project === null}
          className={textButton}
        >
          Set Out{outPoint !== null ? ` · ${formatTimecode(outPoint, fps)}` : ''}
        </button>
        <button
          type="button"
          aria-label="Clear in and out points"
          onClick={() => clearInOut()}
          disabled={!hasInOut}
          className={textButton}
        >
          Clear
        </button>
      </div>

      {/* Quality toggle. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Toggle preview quality"
          aria-pressed={previewQuality === 'half'}
          onClick={() => togglePreviewQuality()}
          disabled={project === null}
          className={textButton}
          title="Half quality renders the preview at reduced resolution for smoother playback"
        >
          Quality: {previewQuality === 'full' ? 'Full' : 'Half'}
        </button>
      </div>
    </div>
  )
}

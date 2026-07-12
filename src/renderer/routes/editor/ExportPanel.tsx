/**
 * Export panel (P12.5–P12.6, Doc 13).
 *
 * UI sections:
 *   1. Format    — dropdown: MP4 / MOV / WebM
 *   2. Resolution — dropdown: 1080p / 4K / 720p / 480p
 *   3. FPS       — dropdown: 30 / 24 / 60
 *   4. Burn captions in — toggle (default on)
 *   5. Subtitle sidecars — SRT / VTT / ASS checkboxes (all off by default)
 *   6. Output location — Local / OneDrive radio
 *   7. Export button + progress bar (0–100%) + phase label + Cancel button
 *   8. Caption-length warning banner when any caption clip text > 120 chars
 */

import { useEffect, useMemo, useState } from 'react'
import { useProjectStore } from '@/store/projectStore'
import type {
  CaptionOverlayInput,
  ExportFormat,
  ExportProgress,
  ExportResolution
} from '../../../shared/export'
import { renderCaptionOverlay } from './captionOverlay'

type FpsOption = 24 | 30 | 60

const FORMAT_OPTIONS: { value: ExportFormat; label: string }[] = [
  { value: 'mp4', label: 'MP4' },
  { value: 'mov', label: 'MOV' },
  { value: 'webm', label: 'WebM' }
]

const RESOLUTION_OPTIONS: { value: ExportResolution; label: string }[] = [
  { value: '1080p', label: '1080p (Full HD)' },
  { value: '4k', label: '4K (UHD)' },
  { value: '720p', label: '720p (HD)' },
  { value: '480p', label: '480p (SD)' }
]

const FPS_OPTIONS: { value: FpsOption; label: string }[] = [
  { value: 30, label: '30 fps' },
  { value: 24, label: '24 fps' },
  { value: 60, label: '60 fps' }
]

/** Check if any caption clip text exceeds 120 chars. */
function hasCaptionLengthWarning(
  tracks: import('../../../shared/storage').ProjectTrack[]
): boolean {
  for (const track of tracks) {
    if (track.type !== 'text') continue
    for (const clip of track.clips) {
      const lines = clip.text?.lines ?? []
      const words = clip.caption?.words ?? []
      const text =
        lines.length > 0
          ? lines.join('\n')
          : words.map((w) => w.text).join(' ')
      if (text.length > 120) return true
    }
  }
  return false
}

export function ExportPanel(): JSX.Element {
  const project = useProjectStore((s) => s.currentProject)
  const currentRef = useProjectStore((s) => s.currentRef)
  const saveProject = useProjectStore((s) => s.saveProject)
  const isDirty = useProjectStore((s) => s.isDirty)

  // Form state
  const [format, setFormat] = useState<ExportFormat>('mp4')
  const [resolution, setResolution] = useState<ExportResolution>('1080p')
  const [fps, setFps] = useState<FpsOption>(30)
  const [burnCaptions, setBurnCaptions] = useState(true)
  const [srtEnabled, setSrtEnabled] = useState(false)
  const [vttEnabled, setVttEnabled] = useState(false)
  const [assEnabled, setAssEnabled] = useState(false)
  const [outputLocation, setOutputLocation] = useState<'local' | 'onedrive'>('local')

  // Export state
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedToPath, setSavedToPath] = useState<string | null>(null)

  // Caption-length warning
  const captionLengthWarning = useMemo(() => {
    if (project === null) return false
    return hasCaptionLengthWarning(project.tracks)
  }, [project])

  // Listen for export:progress push events from main.
  useEffect(() => {
    const off = window.api.on('export:progress', (payload) => {
      const p = payload as ExportProgress
      setProgress(p)
      if (p.phase === 'done') {
        setBusy(false)
        // Capture the path from the final progress message when available.
        // (Runner sets videoRef to the absolute path when savePath was used.)
      } else if (p.phase === 'error') {
        setBusy(false)
        setError(p.error ?? p.message)
      }
    })
    return off
  }, [])

  const canExport = project !== null && currentRef !== null && !busy

  const handleExport = async (): Promise<void> => {
    if (!canExport || currentRef === null) return
    setError(null)
    setProgress(null)
    setSavedToPath(null)

    // Flush any unsaved edits to disk — the export runner reads from disk.
    if (isDirty) {
      await saveProject()
    }

    // For local exports, show the OS save dialog before starting the job.
    let savePath: string | undefined
    if (outputLocation === 'local') {
      setBusy(true)
      const pickResult = await window.api.invoke('storage:pickSavePath', {
        format,
        defaultName: `export.${format}`
      })
      if (!pickResult.ok || pickResult.data.path === null) {
        // User cancelled the save dialog — abort without starting the job.
        setBusy(false)
        return
      }
      savePath = pickResult.data.path
    }

    setBusy(true)

    // Preview-faithful caption burn-in (P13.x): render the caption track to a
    // transparent PNG overlay so the exported gold gradient / 3D wall / animated
    // karaoke sweep match the preview. FFmpeg composites it over the video. If it
    // yields nothing (no captions) or fails, we fall back to the flat ASS burn-in.
    let captionOverlay: CaptionOverlayInput | undefined
    if (burnCaptions) {
      const proj = useProjectStore.getState().currentProject
      if (proj !== null) {
        try {
          setProgress({ jobId: '', phase: 'preparing', percent: 0, message: 'Rendering captions…' })
          const overlay = await renderCaptionOverlay(
            proj,
            currentRef,
            fps,
            (frac) => {
              const pct = Math.round(frac * 100)
              setProgress({
                jobId: '',
                phase: 'preparing',
                percent: pct,
                message: `Rendering captions… ${pct}%`
              })
            }
          )
          captionOverlay = overlay ?? undefined
        } catch (err: unknown) {
          // Non-fatal — leave captionOverlay undefined so the runner uses ASS.
          console.error('[export] caption overlay render failed; falling back to ASS burn-in:', err)
        }
      }
    }

    try {
      const result = await window.api.invoke('export:start', {
        ref: currentRef,
        format,
        resolution,
        fps,
        burnCaptions,
        subtitles: { srt: srtEnabled, vtt: vttEnabled, ass: assEnabled },
        outputLocation,
        savePath,
        captionOverlay
      })

      if (!result.ok) {
        setError(result.error)
        setBusy(false)
        return
      }

      setJobId(result.data.jobId)
      if (savePath !== undefined) setSavedToPath(savePath)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setBusy(false)
    }
  }

  const handleCancel = async (): Promise<void> => {
    if (jobId === null) return
    try {
      await window.api.invoke('export:cancel', { jobId })
    } catch {
      // Ignore — the runner will emit an error progress event.
    }
    setBusy(false)
    setJobId(null)
  }

  const phaseLabel = progress !== null ? phase_label(progress.phase) : ''
  const progressPercent = progress?.percent ?? 0
  const isDone = progress?.phase === 'done'

  return (
    <section className="flex h-full flex-col gap-4 p-4">
      <h2 className="text-sm font-semibold text-text-primary">Export</h2>

      {/* Caption-length warning banner */}
      {captionLengthWarning && (
        <div className="rounded border border-yellow-300 bg-yellow-100 px-3 py-2 text-xs text-yellow-900">
          One or more captions exceed 120 characters. Subtitle display may be truncated.
        </div>
      )}

      {project === null ? (
        <p className="text-xs text-text-muted">No project is open.</p>
      ) : (
        <>
          {/* Format */}
          <div className="flex flex-col gap-1">
            <label htmlFor="export-format" className="text-xs font-medium text-text-secondary">Format</label>
            <select
              id="export-format"
              className="rounded border border-line bg-surface-2 px-2 py-1.5 text-xs text-text-primary disabled:opacity-50"
              value={format}
              disabled={busy}
              onChange={(e) => setFormat(e.target.value as ExportFormat)}
            >
              {FORMAT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Resolution */}
          <div className="flex flex-col gap-1">
            <label htmlFor="export-resolution" className="text-xs font-medium text-text-secondary">Resolution</label>
            <select
              id="export-resolution"
              className="rounded border border-line bg-surface-2 px-2 py-1.5 text-xs text-text-primary disabled:opacity-50"
              value={resolution}
              disabled={busy}
              onChange={(e) => setResolution(e.target.value as ExportResolution)}
            >
              {RESOLUTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* FPS */}
          <div className="flex flex-col gap-1">
            <label htmlFor="export-fps" className="text-xs font-medium text-text-secondary">Frame Rate</label>
            <select
              id="export-fps"
              className="rounded border border-line bg-surface-2 px-2 py-1.5 text-xs text-text-primary disabled:opacity-50"
              value={fps}
              disabled={busy}
              onChange={(e) => setFps(Number(e.target.value) as FpsOption)}
            >
              {FPS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Burn captions toggle */}
          <div className="flex items-center justify-between">
            <label id="burn-captions-label" className="text-xs font-medium text-text-secondary">Burn captions in</label>
            <button
              type="button"
              role="switch"
              aria-checked={burnCaptions}
              aria-labelledby="burn-captions-label"
              disabled={busy}
              onClick={() => setBurnCaptions((v) => !v)}
              className={[
                'relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50',
                burnCaptions ? 'bg-accent' : 'bg-surface-3'
              ].join(' ')}
            >
              <span
                className={[
                  'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform',
                  burnCaptions ? 'translate-x-4' : 'translate-x-0.5'
                ].join(' ')}
              />
            </button>
          </div>

          {/* Subtitle sidecars */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-text-secondary">Subtitle sidecars</span>
            <div className="flex flex-col gap-1 pl-1">
              {(
                [
                  { id: 'srt', label: 'SRT', value: srtEnabled, set: setSrtEnabled },
                  { id: 'vtt', label: 'VTT (WebVTT)', value: vttEnabled, set: setVttEnabled },
                  { id: 'ass', label: 'ASS (Advanced)', value: assEnabled, set: setAssEnabled }
                ] as const
              ).map((item) => (
                <label key={item.id} className="flex cursor-pointer items-center gap-2 text-xs text-text-primary">
                  <input
                    type="checkbox"
                    checked={item.value}
                    disabled={busy}
                    onChange={(e) => item.set(e.target.checked)}
                    className="accent-accent disabled:opacity-50"
                  />
                  {item.label}
                </label>
              ))}
            </div>
          </div>

          {/* Output location */}
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-text-secondary">Output location</span>
            <div className="flex flex-col gap-1 pl-1">
              {(
                [
                  { value: 'local', label: 'Local (exports/)' },
                  { value: 'onedrive', label: 'OneDrive' }
                ] as const
              ).map((opt) => (
                <label key={opt.value} className="flex cursor-pointer items-center gap-2 text-xs text-text-primary">
                  <input
                    type="radio"
                    name="outputLocation"
                    value={opt.value}
                    checked={outputLocation === opt.value}
                    disabled={busy}
                    onChange={() => setOutputLocation(opt.value)}
                    className="accent-accent disabled:opacity-50"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* Error display */}
          {error !== null && (
            <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          {/* Progress */}
          {progress !== null && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs text-text-secondary">
                <span>{phaseLabel}</span>
                <span>{progressPercent}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
                <div
                  role="progressbar"
                  aria-valuenow={progressPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Export progress"
                  className={[
                    'h-full rounded-full transition-all duration-200',
                    isDone ? 'bg-green-500' : 'bg-accent'
                  ].join(' ')}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              {progress.message.length > 0 && (
                <p className="text-xs text-text-muted">{progress.message}</p>
              )}
            </div>
          )}

          {/* Success summary */}
          {isDone && (
            <div className="rounded border border-green-500/40 bg-green-500/10 px-3 py-2 text-xs text-green-400">
              {savedToPath !== null
                ? `Export complete. Saved to: ${savedToPath}`
                : 'Export complete. Video uploaded to OneDrive.'}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={!canExport || isDone}
              className="flex-1 rounded bg-accent px-3 py-2 text-xs font-semibold text-white hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? 'Exporting…' : isDone ? 'Done' : 'Export'}
            </button>
            {busy && (
              <button
                type="button"
                onClick={() => void handleCancel()}
                className="rounded border border-line px-3 py-2 text-xs text-text-secondary hover:bg-surface-2"
              >
                Cancel
              </button>
            )}
          </div>
        </>
      )}
    </section>
  )
}

function phase_label(phase: ExportProgress['phase']): string {
  switch (phase) {
    case 'preparing':
      return 'Preparing…'
    case 'encoding':
      return 'Encoding…'
    case 'subtitles':
      return 'Generating subtitles…'
    case 'writing':
      return 'Writing output…'
    case 'done':
      return 'Done'
    case 'error':
      return 'Error'
    default:
      return ''
  }
}

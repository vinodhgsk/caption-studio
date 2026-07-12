import { useEffect, useMemo, useRef, useState } from 'react'
import type { Clip, ClipAudio } from '../../../shared/project-schema'
import { defaultClipAudio } from '../../../shared/project-schema'
import { useProjectStore } from '@/store/projectStore'
import { useTimelineStore } from '@/store/timelineStore'
import { mediaRefToUrl } from './preview/mediaSource'
import { decodeWaveform, decodeAudioBeats } from './timeline/decodeWaveform'
import type { Waveform } from './timeline/waveform'

/**
 * Audio panel (P4.1, Doc 02). Import MP3 into the bundle media/ folder, add an
 * audio clip, show its decoded waveform, and edit per-clip volume + fade-in/out.
 * A "Normalize for STT" action runs FFmpeg in main to produce a 16 kHz mono WAV
 * in cache/ (the input shape the transcriber expects — PROMPTs 2.1/2.2).
 *
 * The volume/fade values live on `clip.audio` ({@link ClipAudio}) and are
 * export-representable (FFmpeg `volume`/`afade`), so preview and export agree.
 * Each control commits ONE undoable `setClipAudio` command on change-end.
 */
export function AudioPanel(): JSX.Element {
  const project = useProjectStore((s) => s.currentProject)
  const currentRef = useProjectStore((s) => s.currentRef)
  const importAudio = useTimelineStore((s) => s.importAudio)
  const normalizeAudio = useTimelineStore((s) => s.normalizeAudio)
  const setClipAudio = useTimelineStore((s) => s.setClipAudio)
  const selection = useTimelineStore((s) => s.selection)
  const setSelection = useTimelineStore((s) => s.setSelection)

  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // All audio clips across audio tracks (mirror of the source of truth).
  const audioClips = useMemo<Clip[]>(() => {
    if (project === null) return []
    return project.tracks.filter((t) => t.type === 'audio').flatMap((t) => t.clips)
  }, [project])

  // The target clip: the selected audio clip if one is selected, else the first.
  const selectedAudioClip = useMemo<Clip | null>(() => {
    if (audioClips.length === 0) return null
    const selected = audioClips.find((c) => selection.includes(c.id))
    return selected ?? audioClips[0]
  }, [audioClips, selection])

  const audio: ClipAudio = selectedAudioClip?.audio ?? defaultClipAudio()

  const onImport = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    const result = await importAudio()
    setBusy(false)
    if (!result.ok) {
      setMessage(result.error)
      return
    }
    if (result.clipId === null) return
    setSelection([result.clipId])
    setMessage('Imported audio clip.')
  }

  const onNormalize = async (): Promise<void> => {
    if (selectedAudioClip === null) return
    setBusy(true)
    setMessage(null)
    const result = await normalizeAudio(selectedAudioClip.mediaRef)
    setBusy(false)
    setMessage(result.ok ? `Normalized → ${result.wavRef}` : result.error)
  }

  // Detect beats (P8.11): decode the clip audio in the renderer, run onset detection,
  // and persist the SOURCE-time beats to `clip.audio.beats` (one undoable command) so
  // beat snapping (P8.12) + ruler markers can use them.
  const onDetectBeats = async (): Promise<void> => {
    if (selectedAudioClip === null || currentRef === null) return
    setBusy(true)
    setMessage(null)
    try {
      const resolved = await window.api.invoke('storage:resolvePath', { ref: currentRef })
      if (!resolved.ok) throw new Error(resolved.error)
      const url = mediaRefToUrl(resolved.data.path, selectedAudioClip.mediaRef)
      const beats = await decodeAudioBeats(url)
      setClipAudio(selectedAudioClip.id, { beats })
      setMessage(`Detected ${beats.length} beat${beats.length === 1 ? '' : 's'}.`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to detect beats.')
    } finally {
      setBusy(false)
    }
  }

  const patch = (p: Partial<ClipAudio>): void => {
    if (selectedAudioClip === null) return
    setClipAudio(selectedAudioClip.id, p)
  }

  return (
    <section className="flex h-full flex-col gap-3 p-4">
      <h2 className="text-sm font-semibold text-text-primary">Audio</h2>
      <p className="text-xs text-text-muted">
        Import an MP3. It is copied into the project bundle, decoded to a waveform, and added
        to an audio track.
      </p>

      <button
        type="button"
        onClick={() => void onImport()}
        disabled={project === null || busy}
        className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-text-primary disabled:opacity-50"
      >
        {busy ? 'Working…' : 'Import audio'}
      </button>
      {project === null && (
        <p className="text-xs text-text-muted">Open a project to import audio.</p>
      )}

      {selectedAudioClip !== null && currentRef !== null && (
        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <WaveformPreview clip={selectedAudioClip} />

          {/* Volume (per-clip gain). 0–200% maps to gain 0–2 (unity = 100%). */}
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            <span>Volume: {Math.round(audio.gain * 100)}%</span>
            <input
              type="range"
              min={0}
              max={200}
              step={1}
              value={Math.round(audio.gain * 100)}
              onChange={(e) => patch({ gain: Number(e.target.value) / 100 })}
              className="accent-accent"
            />
          </label>

          {/* Fade in / out, in seconds. */}
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            <span>Fade in: {audio.fadeInSec.toFixed(1)}s</span>
            <input
              type="range"
              min={0}
              max={5}
              step={0.1}
              value={audio.fadeInSec}
              onChange={(e) => patch({ fadeInSec: Number(e.target.value) })}
              className="accent-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            <span>Fade out: {audio.fadeOutSec.toFixed(1)}s</span>
            <input
              type="range"
              min={0}
              max={5}
              step={0.1}
              value={audio.fadeOutSec}
              onChange={(e) => patch({ fadeOutSec: Number(e.target.value) })}
              className="accent-accent"
            />
          </label>

          <label className="flex items-center gap-2 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={audio.muted ?? false}
              onChange={(e) => patch({ muted: e.target.checked })}
              className="accent-accent"
            />
            <span>Mute</span>
          </label>

          <button
            type="button"
            onClick={() => void onNormalize()}
            disabled={busy}
            className="rounded-md border border-line px-3 py-2 text-xs font-medium text-text-primary disabled:opacity-50"
          >
            Normalize for STT (16 kHz mono WAV)
          </button>

          {/* Beat detection (P8.11) — onset times the timeline can snap to (P8.12). */}
          <button
            type="button"
            onClick={() => void onDetectBeats()}
            disabled={busy}
            className="rounded-md border border-line px-3 py-2 text-xs font-medium text-text-primary disabled:opacity-50"
          >
            {(selectedAudioClip.audio?.beats?.length ?? 0) > 0
              ? `Re-detect beats (${selectedAudioClip.audio?.beats?.length})`
              : 'Detect beats'}
          </button>
        </div>
      )}

      {message !== null && <p className="text-xs text-text-muted">{message}</p>}
    </section>
  )
}

/**
 * Decode + render the selected clip's waveform. Resolves the bundle path itself
 * (via the storage IPC) so the panel does not need it pre-fetched.
 */
function WaveformPreview({ clip }: { clip: Clip }): JSX.Element {
  const currentRef = useProjectStore((s) => s.currentRef)
  const [waveform, setWaveform] = useState<Waveform | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reqRef = useRef(0)

  useEffect(() => {
    if (currentRef === null) return
    const req = ++reqRef.current
    setWaveform(null)
    setError(null)
    void (async () => {
      try {
        const resolved = await window.api.invoke('storage:resolvePath', { ref: currentRef })
        if (!resolved.ok) throw new Error(resolved.error)
        const url = mediaRefToUrl(resolved.data.path, clip.mediaRef)
        const wf = await decodeWaveform(url)
        if (reqRef.current === req) setWaveform(wf)
      } catch (err) {
        if (reqRef.current === req) {
          setError(err instanceof Error ? err.message : 'Failed to decode waveform.')
        }
      }
    })()
  }, [clip.mediaRef, currentRef])

  if (error !== null) return <p className="text-xs text-text-muted">Waveform: {error}</p>
  if (waveform === null) return <p className="text-xs text-text-muted">Decoding waveform…</p>

  return (
    <svg
      className="h-16 w-full text-accent"
      viewBox={`0 0 ${waveform.peaks.length} 100`}
      preserveAspectRatio="none"
      aria-label="Audio waveform"
    >
      {waveform.peaks.map((peak, i) => {
        const top = (1 - peak.max) * 50
        const height = Math.max(0.5, (peak.max - peak.min) * 50)
        return (
          <rect key={i} x={i} y={top} width={1} height={height} fill="currentColor" opacity={0.6} />
        )
      })}
    </svg>
  )
}

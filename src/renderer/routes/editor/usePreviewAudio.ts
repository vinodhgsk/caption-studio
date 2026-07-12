import { useEffect, useRef } from 'react'
import { clipDuration, type Clip, type ClipAudio } from '../../../shared/project-schema'
import type { Project } from '../../../shared/storage'
import { mediaRefToUrl } from './preview/mediaSource'
import { useBundlePath } from './timeline/useBundlePath'
import { useTimelineStore } from '@/store/timelineStore'

interface ManagedAudio {
  mediaRef: string
  element: HTMLAudioElement
}

/**
 * Return the audio clips (from `audio` tracks only) that are audible at `t`.
 *
 * Visual-track media audio is already handled by the preview canvas' `<video>`
 * elements; this hook owns dedicated audio tracks so imported narration/music is
 * audible during timeline playback and scrubbing.
 */
export function audibleAudioClipsAt(project: Project, t: number): Clip[] {
  return project.tracks
    .filter((track) => track.type === 'audio')
    .flatMap((track) =>
      track.clips.filter((clip) => {
        const duration = clipDuration(clip)
        return duration > 0 && t >= clip.start && t < clip.start + duration
      })
    )
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

/**
 * Effective preview gain at the given clip-local source time.
 *
 * Mirrors the clip mix model (`gain` + fade-in/fade-out + mute) so preview sound
 * follows the same intent as export. The HTML media-element path clamps to [0,1].
 */
export function effectivePreviewGain(audio: ClipAudio | undefined, sourceSec: number, durationSec: number): number {
  if (audio?.muted === true) return 0

  const baseGain = clamp01(audio?.gain ?? 1)
  if (baseGain <= 0 || durationSec <= 0) return 0

  const clampedSource = Math.min(durationSec, Math.max(0, sourceSec))
  const fadeInSec = Math.max(0, audio?.fadeInSec ?? 0)
  const fadeOutSec = Math.max(0, audio?.fadeOutSec ?? 0)

  const fadeInFactor =
    fadeInSec > 0 ? clamp01(clampedSource / fadeInSec) : 1
  const remaining = Math.max(0, durationSec - clampedSource)
  const fadeOutFactor =
    fadeOutSec > 0 ? clamp01(remaining / fadeOutSec) : 1

  return clamp01(baseGain * Math.min(fadeInFactor, fadeOutFactor))
}

/**
 * Keep audio-track playback synced to the timeline playhead/transport state.
 *
 * - While playing: active clips play and are softly corrected if drift grows.
 * - While paused/scrubbing: active clips are paused and hard-seeked to playhead.
 * - Hidden/inactive clips are paused.
 */
export function usePreviewAudio(project: Project | null): void {
  const bundleAbs = useBundlePath()
  const playhead = useTimelineStore((s) => s.playhead)
  const isPlaying = useTimelineStore((s) => s.isPlaying)

  const audiosRef = useRef<Map<string, ManagedAudio>>(new Map())

  useEffect(() => {
    const audios = audiosRef.current
    const clearAll = (): void => {
      audios.forEach(({ element }) => {
        element.pause()
        element.removeAttribute('src')
        element.load()
      })
      audios.clear()
    }

    if (project === null || bundleAbs === null) {
      clearAll()
      return
    }

    const active = audibleAudioClipsAt(project, playhead)
    const activeIds = new Set(active.map((clip) => clip.id))

    for (const clip of active) {
      const url = mediaRefToUrl(bundleAbs, clip.mediaRef)
      const existing = audios.get(clip.id)
      const needsNew = existing === undefined || existing.mediaRef !== clip.mediaRef

      if (needsNew && existing !== undefined) {
        existing.element.pause()
        existing.element.removeAttribute('src')
        existing.element.load()
        audios.delete(clip.id)
      }

      let managed = audios.get(clip.id)
      if (managed === undefined) {
        const element = document.createElement('audio')
        element.preload = 'auto'
        element.crossOrigin = 'anonymous'
        element.src = url
        managed = { mediaRef: clip.mediaRef, element }
        audios.set(clip.id, managed)
      }

      const durationSec = clipDuration(clip)
      const sourceSec = clip.in + (playhead - clip.start)
      const gain = effectivePreviewGain(clip.audio, sourceSec, durationSec)

      managed.element.muted = clip.audio?.muted === true
      managed.element.volume = gain

      if (isPlaying) {
        // Keep long runs in sync; avoid micro-seek jitter while already aligned.
        if (Number.isFinite(sourceSec) && Math.abs(managed.element.currentTime - sourceSec) > 0.1) {
          try {
            managed.element.currentTime = Math.max(0, sourceSec)
          } catch {
            // Ignore until metadata is ready.
          }
        }
        if (managed.element.paused) {
          void managed.element.play().catch(() => undefined)
        }
      } else {
        if (!managed.element.paused) managed.element.pause()
        if (Number.isFinite(sourceSec) && Math.abs(managed.element.currentTime - sourceSec) > 1 / 120) {
          try {
            managed.element.currentTime = Math.max(0, sourceSec)
          } catch {
            // Ignore until metadata is ready.
          }
        }
      }
    }

    // Pause anything not currently audible.
    audios.forEach(({ element }, clipId) => {
      if (activeIds.has(clipId)) return
      if (!element.paused) element.pause()
    })

    return () => {
      // Intentionally do nothing on dependency churn; elements are retained and
      // reused between frames. Full teardown happens when project/path clears and
      // on unmount (effect below).
    }
  }, [project, bundleAbs, playhead, isPlaying])

  useEffect(() => {
    const audios = audiosRef.current
    return () => {
      audios.forEach(({ element }) => {
        element.pause()
        element.removeAttribute('src')
        element.load()
      })
      audios.clear()
    }
  }, [])
}

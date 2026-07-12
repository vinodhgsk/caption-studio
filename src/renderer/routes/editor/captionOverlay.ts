/**
 * Caption-overlay renderer (P13.x — preview-faithful caption burn-in).
 *
 * The FFmpeg/libass export path can only burn in a FLAT solid color + outline —
 * it has no primitive for the signature gold gradient, the 3D extrusion wall, or
 * the animated white-gold karaoke sweep. So instead of asking libass to draw the
 * captions, THIS module renders them itself using the EXACT preview render path
 * ({@link drawTextClips} + {@link visibleClipsAt}) onto a detached canvas at the
 * export resolution, one transparent PNG per output frame, and streams the frames
 * to main (which the export runner composites over the video via an `overlay`
 * filter). Because it reuses the preview's HarfBuzz-backed canvas and the SAME
 * font set (`document.fonts`), the burned-in captions match the preview
 * pixel-for-pixel AND shape Tamil/Indic correctly.
 *
 * RENDERER-ONLY: uses `document`, `canvas.toBlob`, and `window.api`. It is driven
 * by the Export panel BEFORE `export:start`, so the frames exist on disk when the
 * (main-process) runner reads them.
 */

import type { Project, ProjectRef } from '../../../shared/storage'
import type { CaptionOverlayInput } from '../../../shared/export'
import { getCaptionPreset } from '../../../shared/captionPresetRegistry'
import { CAPTION_TRACK_ID } from '@/store/timeline'
import { visibleClipsAt } from './preview/compositor'
import { drawTextClips } from './preview/PreviewCanvas'
import { planCaptionOverlay } from './captionOverlayPlan'

export { planCaptionOverlay } from './captionOverlayPlan'
export type { OverlayPlan } from './captionOverlayPlan'

/** How many frames to buffer before shipping a batch to main over IPC. */
const FRAME_BATCH = 24

/** Encode a canvas to PNG bytes (transparent-preserving). */
function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error('canvas.toBlob returned null'))
        return
      }
      blob
        .arrayBuffer()
        .then((buf) => resolve(new Uint8Array(buf)))
        .catch(reject)
    }, 'image/png')
  })
}

/**
 * Render the caption track to a transparent PNG sequence and upload it to the
 * bundle's cache via IPC. Returns the {@link CaptionOverlayInput} to attach to
 * the export job, or `null` when there is nothing to render (caller keeps ASS).
 *
 * `onProgress(fraction)` reports 0..1 across the frame render so the Export panel
 * can show a "Rendering captions…" bar before the FFmpeg encode begins.
 */
export async function renderCaptionOverlay(
  project: Project,
  ref: ProjectRef,
  fps: number,
  onProgress?: (fraction: number) => void
): Promise<CaptionOverlayInput | null> {
  const plan = planCaptionOverlay(project, fps)
  if (plan === null) return null
  const { startSec, frameCount, width, height } = plan

  // Ensure every registered/imported font face is loaded before we shape text,
  // so a frame never renders with a fallback the preview wouldn't use.
  if (typeof document !== 'undefined' && document.fonts !== undefined) {
    await document.fonts.ready
  }

  const overlayId = crypto.randomUUID()
  const init = await window.api.invoke('export:captionFramesInit', { ref, overlayId })
  if (!init.ok) throw new Error(init.error)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('Failed to acquire a 2D context for the caption overlay')

  // Active-word highlight is read from the applied preset (same as the preview).
  const styleId = project.captions?.styleId
  const presetHighlight = styleId !== undefined ? getCaptionPreset(styleId)?.highlight : undefined

  const sizes = new Map<string, { width: number; height: number }>()
  let batch: Uint8Array[] = []
  let batchStart = 0

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return
    const res = await window.api.invoke('export:captionFramesWrite', {
      ref,
      overlayId,
      startIndex: batchStart,
      frames: batch
    })
    if (!res.ok) throw new Error(res.error)
    batch = []
  }

  for (let f = 0; f < frameCount; f++) {
    const t = startSec + f / fps
    ctx.clearRect(0, 0, width, height)
    // Only the Caption track — the video/audio come from FFmpeg; this overlay is
    // captions on transparent alpha, composited on top of the encoded video.
    const items = visibleClipsAt(project.tracks, t).filter((it) => it.track.id === CAPTION_TRACK_ID)
    sizes.clear()
    drawTextClips(ctx, width, height, items, null, sizes, t, presetHighlight, null)

    if (batch.length === 0) batchStart = f
    batch.push(await canvasToPng(canvas))
    if (batch.length >= FRAME_BATCH) await flush()
    onProgress?.((f + 1) / frameCount)
  }
  await flush()

  return { framesPattern: init.data.framesPattern, framesDir: init.data.dir, fps, startSec }
}

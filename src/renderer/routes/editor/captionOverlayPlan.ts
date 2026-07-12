/**
 * Caption-overlay PLAN (P13.x) — the pure geometry of the preview-faithful
 * caption burn-in, split out from the canvas/IPC renderer ({@link ./captionOverlay})
 * so it can be unit-tested without React or a DOM canvas.
 *
 * Given a project + fps it computes the frame range that spans every caption
 * clip: `startSec` (aligned to the timeline frame grid so the overlay
 * `-itsoffset` lands exactly) and `frameCount` (frames to render at `fps`), plus
 * the pixel `width`/`height` to render at. Returns `null` when there is nothing
 * to burn in.
 *
 * RESOLUTION: the overlay is rendered at the PROJECT resolution
 * (`project.settings.resolution`) — the SAME canvas the preview draws on and the
 * space in which a caption's `transform.y` was resolved (`resolveCaptionY` bakes
 * the lower-third anchor into project-space pixels). FFmpeg then scales+pads the
 * overlay into the export frame identically to how it fits the video, so the
 * burned-in caption sits exactly where the preview shows it.
 */

import type { Project } from '../../../shared/storage'
import { clipDuration } from '../../../shared/project-schema'
import { CAPTION_TRACK_ID } from '../../store/timeline/captionTrack'

/** The frame range + canvas size an overlay render will cover. */
export interface OverlayPlan {
  /** Timeline time (seconds) of frame 0 — aligned to a frame boundary. */
  startSec: number
  /** Number of frames to render (covers the whole caption span at `fps`). */
  frameCount: number
  fps: number
  /** Render width — the PROJECT canvas width (matches preview). */
  width: number
  /** Render height — the PROJECT canvas height (matches preview). */
  height: number
}

/**
 * Plan the overlay: the frame range spanning ALL caption clips at `fps`, sized to
 * the project canvas. Returns `null` when there is nothing to burn in (no Caption
 * track, no clips, non-positive fps, a degenerate span, or a bad project
 * resolution) — the caller then leaves the ASS burn-in path in place. PURE.
 */
export function planCaptionOverlay(project: Project, fps: number): OverlayPlan | null {
  if (!(fps > 0)) return null
  const track = project.tracks.find((t) => t.id === CAPTION_TRACK_ID)
  if (track === undefined || track.clips.length === 0) return null

  const res = project.settings.resolution
  const width = Array.isArray(res) ? res[0] : 0
  const height = Array.isArray(res) ? res[1] : 0
  if (!(width > 0) || !(height > 0)) return null

  let spanStart = Infinity
  let spanEnd = -Infinity
  for (const clip of track.clips) {
    const end = clip.start + clipDuration(clip)
    if (clip.start < spanStart) spanStart = clip.start
    if (end > spanEnd) spanEnd = end
  }
  if (!Number.isFinite(spanStart) || spanEnd <= spanStart) return null

  // Align frame 0 to the timeline frame grid so `startSec` maps to an exact
  // frame; the runner passes `startSec` as the overlay `-itsoffset`.
  const startFrame = Math.floor(spanStart * fps)
  const startSec = startFrame / fps
  const endFrame = Math.ceil(spanEnd * fps)
  const frameCount = Math.max(1, endFrame - startFrame)
  return { startSec, frameCount, fps, width, height }
}

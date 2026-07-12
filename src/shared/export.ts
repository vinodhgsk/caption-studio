/**
 * Export job model and progress types (P12.1, Doc 13).
 *
 * Pure types only — NO electron / node imports. Safe for renderer and main.
 */

import type { ProjectRef } from './storage'

export type ExportFormat = 'mp4' | 'mov' | 'webm'
export type ExportResolution = '4k' | '1080p' | '720p' | '480p'

/**
 * Output width × height for each {@link ExportResolution}. SHARED (renderer +
 * main) so the caption-overlay pre-pass in the renderer renders frames at the
 * SAME pixel size the FFmpeg builder scales the video to — a mismatch would make
 * the burned-in caption overlay land at the wrong scale/position.
 */
export const RESOLUTION_DIMENSIONS: Record<ExportResolution, [number, number]> = {
  '4k': [3840, 2160],
  '1080p': [1920, 1080],
  '720p': [1280, 720],
  '480p': [854, 480]
}

/**
 * A pre-rendered, transparent caption OVERLAY the renderer produced from the live
 * caption render path (P13.x). When present on an {@link ExportJob}, the export
 * runner composites this PNG sequence over the video INSTEAD of the flat libass
 * ASS burn-in — so the burned-in captions match the preview pixel-for-pixel
 * (gold gradient, 3D wall, warm shadow, and the animated white-gold karaoke
 * sweep). Indic shaping is preserved because the frames come from the same
 * HarfBuzz-backed canvas the preview uses.
 */
export interface CaptionOverlayInput {
  /** Absolute FFmpeg image2 pattern for the frames, e.g. `/…/frame_%06d.png`. */
  framesPattern: string
  /** Absolute directory holding the frames (the runner deletes it post-export). */
  framesDir: string
  /** Frames-per-second the sequence was rendered at (matches the export fps). */
  fps: number
  /** Timeline time (seconds) of frame 0 — the overlay input is `-itsoffset` by this. */
  startSec: number
}

export interface ExportJob {
  ref: ProjectRef
  format: ExportFormat
  resolution: ExportResolution
  fps: number
  burnCaptions: boolean
  subtitles: {
    srt: boolean
    vtt: boolean
    ass: boolean
  }
  outputLocation: 'local' | 'onedrive'
  /**
   * Absolute path chosen by the user via the OS save dialog. When set, the
   * runner moves the finished file here instead of leaving it in exports/.
   * Undefined for OneDrive exports (destination is the configured cloud folder).
   */
  savePath?: string
  /**
   * Optional pre-rendered caption overlay (see {@link CaptionOverlayInput}). The
   * renderer generates this before calling `export:start` when burn-in is on and
   * a caption track exists; absent → the runner falls back to the ASS burn-in
   * (headless paths, e.g. the e2e tests, never set it and stay on ASS).
   */
  captionOverlay?: CaptionOverlayInput
}

export interface ExportProgress {
  jobId: string
  phase: 'preparing' | 'encoding' | 'subtitles' | 'writing' | 'done' | 'error'
  percent: number // 0–100
  message: string
  error?: string
}

export interface ExportResult {
  jobId: string
  videoRef?: string // bundle-relative path in exports/
  srtRef?: string
  vttRef?: string
  assRef?: string
}

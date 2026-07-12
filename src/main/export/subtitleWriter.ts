/**
 * Subtitle file writer (P12.3, Doc 13 subtitle-export skill).
 *
 * Extracts caption clips from a project, generates SRT/VTT/ASS strings via the
 * pure generators in src/shared/subtitleExport.ts, then writes them to the
 * bundle's exports/ folder. Returns bundle-relative refs.
 *
 * All file I/O is in MAIN — never in the renderer.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Project } from '../../shared/storage'
import type { CaptionClipLike } from '../../shared/subtitleExport'
import { captionsToSrt, captionsToVtt, captionsToAss } from '../../shared/subtitleExport'
import { bundleLayout } from '../storage/bundle'
/** Stable id of the dedicated Caption track (mirrors renderer/store/timeline/captionTrack.ts). */
const CAPTION_TRACK_ID = 'caption-track'

/**
 * Reduce a clip's `text.fill` to ONE representative solid hex color for the flat
 * ASS/SRT/VTT export (libass has no gradient primitive — see ffmpegBuilder header).
 *   - solid fill → its `value` string.
 *   - gradient fill → the stop nearest offset ~0.55 (the "main body" tone, e.g.
 *     the gold body of the Sarvam Bhakti gradient) so the burned-in caption reads
 *     as the dominant color rather than the pale top rim or the dark base. This
 *     ALSO avoids passing the raw stop ARRAY downstream (which would crash the
 *     ASS color conversion).
 * Returns `undefined` when no usable color is present (the generators then fall
 * back to white).
 */
function representativeFillColor(fill: Record<string, unknown> | null): string | undefined {
  if (fill === null) return undefined
  const value = fill['value']
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.length > 0) {
    // Pick the stop whose offset is closest to the body tone (0.55).
    const BODY = 0.55
    let best: { color: string; d: number } | null = null
    for (const raw of value) {
      if (typeof raw !== 'object' || raw === null) continue
      const stop = raw as Record<string, unknown>
      const color = stop['color']
      if (typeof color !== 'string') continue
      const offset = typeof stop['offset'] === 'number' ? (stop['offset'] as number) : 0
      const d = Math.abs(offset - BODY)
      if (best === null || d < best.d) best = { color, d }
    }
    return best?.color
  }
  return undefined
}

export interface WriteSubtitleOpts {
  srt: boolean
  vtt: boolean
  ass: boolean
  /** ASS PlayResX — should match the export output width (default 1920). */
  playResX?: number
  /** ASS PlayResY — should match the export output height (default 1080). */
  playResY?: number
}

export interface WriteSubtitleResult {
  srtRef?: string
  vttRef?: string
  assRef?: string
}

/**
 * Extract caption clips from a project and write SRT/VTT/ASS files to the
 * bundle's exports/ folder. Returns the bundle-relative refs for each
 * generated file (only the requested formats).
 */
export async function writeSubtitleFiles(
  project: Project,
  bundlePath: string,
  opts: WriteSubtitleOpts
): Promise<WriteSubtitleResult> {
  const layout = bundleLayout(bundlePath)
  await mkdir(layout.exports, { recursive: true })

  // Extract caption clips from the dedicated caption track.
  const captionTrack = project.tracks.find(
    (t) => t.id === CAPTION_TRACK_ID || t.type === 'text'
  )

  // Collect caption-like clips from all text tracks in order.
  const captionClips: CaptionClipLike[] = []
  for (const track of project.tracks) {
    if (track.type !== 'text') continue
    for (const clip of track.clips) {
      // Extract text from lines or caption.words.
      const lines = clip.text?.lines ?? []
      const words = clip.caption?.words ?? []
      const text =
        lines.length > 0
          ? lines.join('\n')
          : words.map((w) => w.text).join(' ')

      if (text.trim().length === 0) continue

      const startSec = clip.start
      const endSec = clip.start + (clip.out - clip.in)

      const font = typeof clip.text?.font === 'object' && clip.text.font !== null
        ? clip.text.font as Record<string, unknown>
        : null
      const fill = typeof clip.text?.fill === 'object' && clip.text.fill !== null
        ? clip.text.fill as Record<string, unknown>
        : null
      const stroke0 = Array.isArray(clip.text?.stroke) && (clip.text.stroke as unknown[]).length > 0
        ? (clip.text.stroke as Record<string, unknown>[])[0]
        : null
      const xf = clip.transform as unknown as Record<string, unknown>

      captionClips.push({
        startSec,
        endSec,
        text,
        fontFamily: font ? font['family'] as string | undefined : undefined,
        fontSize: font && typeof font['size'] === 'number' ? font['size'] as number : undefined,
        color: representativeFillColor(fill),
        outlineColor: stroke0 ? stroke0['color'] as string | undefined : undefined,
        outlineWidth: stroke0 && typeof stroke0['width'] === 'number' ? stroke0['width'] as number : undefined,
        captionAnchor: xf['captionAnchor'] as 'lower-third' | 'center' | 'top' | 'custom' | undefined,
        posY: typeof clip.transform.y === 'number' ? clip.transform.y : undefined
      })
    }
  }

  // Sort by start time.
  captionClips.sort((a, b) => a.startSec - b.startSec)

  const result: WriteSubtitleResult = {}

  if (opts.srt) {
    const srtContent = captionsToSrt(captionClips)
    const srtName = `captions.srt`
    const srtPath = join(layout.exports, srtName)
    await writeFile(srtPath, srtContent, 'utf8')
    result.srtRef = `exports/${srtName}`
  }

  if (opts.vtt) {
    const vttContent = captionsToVtt(captionClips)
    const vttName = `captions.vtt`
    const vttPath = join(layout.exports, vttName)
    await writeFile(vttPath, vttContent, 'utf8')
    result.vttRef = `exports/${vttName}`
  }

  if (opts.ass) {
    const assContent = captionsToAss(captionClips, undefined, {
      playResX: opts.playResX,
      playResY: opts.playResY
    })
    const assName = `captions.ass`
    const assPath = join(layout.exports, assName)
    await writeFile(assPath, assContent, 'utf8')
    result.assRef = `exports/${assName}`
  }

  // Suppress unused variable warning for captionTrack if it's only needed
  // as a guard (we iterate all text tracks above for breadth).
  void captionTrack

  return result
}

/**
 * Caption-overlay frame store (P13.x — preview-faithful caption burn-in).
 *
 * The renderer renders the caption track to transparent PNG frames (using the
 * SAME canvas path the preview uses, so gradient/3D/karaoke match exactly) and
 * streams them here in batches. This module owns the on-disk side: it places the
 * frames in a per-overlay scratch dir under the bundle's `cache/`, named
 * `frame_%06d.png` so FFmpeg's image2 demuxer can read them as a sequence
 * (`ffmpegBuilder` adds them as an `overlay` input). The export runner deletes
 * the dir once the encode finishes (or is cancelled).
 *
 * All file I/O runs in MAIN — the renderer only produces pixels + sends bytes.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { bundleLayout } from '../storage/bundle'

/** Absolute scratch dir for one overlay render, inside the bundle's cache/. */
export function captionFramesDir(bundlePath: string, overlayId: string): string {
  // Sanitize the id defensively — it flows from the renderer. Only allow the
  // shape `crypto.randomUUID()` produces so it can never escape the cache dir.
  const safe = /^[A-Za-z0-9-]{1,64}$/.test(overlayId) ? overlayId : 'invalid'
  return join(bundleLayout(bundlePath).cache, `${safe}-cap`)
}

/** FFmpeg image2 pattern for a frames dir (zero-padded to 6 digits). */
export function captionFramesPattern(dir: string): string {
  return join(dir, 'frame_%06d.png')
}

/** Create (fresh) the scratch dir for an overlay render. Returns dir + pattern. */
export async function initCaptionFrames(
  bundlePath: string,
  overlayId: string
): Promise<{ dir: string; framesPattern: string }> {
  const dir = captionFramesDir(bundlePath, overlayId)
  // Start clean so a re-run never mixes stale frames with fresh ones.
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  return { dir, framesPattern: captionFramesPattern(dir) }
}

/** Zero-pad a frame index to the `frame_%06d.png` filename. */
function frameName(index: number): string {
  return `frame_${String(index).padStart(6, '0')}.png`
}

/**
 * Write a batch of PNG frames. `frames[i]` is the frame at `startIndex + i`.
 * Returns the number of files written. Accepts `Uint8Array` (what crosses IPC)
 * or `Buffer`.
 */
export async function writeCaptionFrames(
  bundlePath: string,
  overlayId: string,
  startIndex: number,
  frames: readonly Uint8Array[]
): Promise<number> {
  const dir = captionFramesDir(bundlePath, overlayId)
  await mkdir(dir, { recursive: true })
  let written = 0
  for (let i = 0; i < frames.length; i++) {
    await writeFile(join(dir, frameName(startIndex + i)), frames[i])
    written++
  }
  return written
}

/** Delete an overlay scratch dir. Never throws (best-effort cleanup). */
export async function cleanupCaptionFrames(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}

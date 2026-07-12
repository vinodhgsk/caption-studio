/**
 * Export job runner (P12.1, P12.4, Doc 13 ffmpeg-export skill).
 *
 * Spawns FFmpeg as a subprocess, parses progress from stderr (`time=` field),
 * emits progress events, writes subtitle sidecars, and moves the output video
 * into the bundle's exports/ folder. Returns a cancel function that kills the
 * process.
 *
 * All file I/O runs in MAIN — never in renderer. Progress flows renderer-side
 * via `webContents.send('export:progress', ...)` (registered in index.ts).
 */

import { spawn } from 'node:child_process'
import { appendFile, copyFile, mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Project } from '../../shared/storage'
import type { ExportJob, ExportProgress, ExportResult } from '../../shared/export'
import { buildFfmpegArgs, RESOLUTION_MAP } from './ffmpegBuilder'
import { writeSubtitleFiles } from './subtitleWriter'
import { cleanupCaptionFrames } from './captionFrames'
import { bundleLayout } from '../storage/bundle'
import { getProvider } from '../storage'
import { appFontsDir } from './fontsDir'

/** FFmpeg binary to invoke. Overridable via CAPTION_STUDIO_FFMPEG for tests. */
function ffmpegBin(): string {
  return process.env.CAPTION_STUDIO_FFMPEG ?? 'ffmpeg'
}

/**
 * Parse a `time=HH:MM:SS.ss` (or `time=HH:MM:SS,ss`) field from FFmpeg stderr
 * into fractional seconds. Returns NaN when the pattern is absent.
 */
export function parseProgressTime(line: string): number {
  const match = line.match(/time=(\d+):(\d+):(\d+)[.,](\d+)/)
  if (match === null) return NaN
  const h = parseInt(match[1], 10)
  const m = parseInt(match[2], 10)
  const s = parseInt(match[3], 10)
  const cs = parseInt(match[4], 10)
  const csLen = match[4].length
  const fracSec = cs / Math.pow(10, csLen)
  return h * 3600 + m * 60 + s + fracSec
}

/**
 * Compute total duration in seconds from all video clips in the project.
 * Used to compute the encoding progress percentage.
 */
function computeTotalDurationSec(project: Project): number {
  let maxEnd = 0
  for (const track of project.tracks) {
    if (track.type !== 'video' && track.type !== 'audio') continue
    for (const clip of track.clips) {
      const end = clip.start + (clip.out - clip.in)
      if (end > maxEnd) maxEnd = end
    }
  }
  return maxEnd > 0 ? maxEnd : 1 // avoid division by zero
}

/** Warn if any caption clip text exceeds 120 characters. */
function checkCaptionLengths(project: Project): string | null {
  for (const track of project.tracks) {
    if (track.type !== 'text') continue
    for (const clip of track.clips) {
      const lines = clip.text?.lines ?? []
      const words = clip.caption?.words ?? []
      const text =
        lines.length > 0
          ? lines.join('\n')
          : words.map((w) => w.text).join(' ')
      if (text.length > 120) {
        return `Caption exceeds 120 characters: "${text.slice(0, 40)}..." — subtitle display may be truncated.`
      }
    }
  }
  return null
}

export interface RunExportResult {
  jobId: string
  cancel(): void
}

/**
 * Run an export job asynchronously. Spawns an FFmpeg subprocess, parses
 * progress from stderr (time= field), emits progress events via onProgress.
 * Returns a job id and a cancel function.
 */
export function runExportJob(
  job: ExportJob,
  bundlePath: string,
  project: Project,
  onProgress: (p: ExportProgress) => void
): RunExportResult {
  const jobId = randomUUID()
  let cancelled = false
  let childProcess: ReturnType<typeof spawn> | null = null

  const totalDurationSec = computeTotalDurationSec(project)
  const layout = bundleLayout(bundlePath)

  // Run everything in an async IIFE so we can use await inside.
  void (async () => {
    try {
      // Phase: preparing
      onProgress({
        jobId,
        phase: 'preparing',
        percent: 0,
        message: 'Preparing export…'
      })

      // Caption-length warning (non-blocking).
      const captionWarning = checkCaptionLengths(project)
      if (captionWarning !== null) {
        onProgress({
          jobId,
          phase: 'preparing',
          percent: 2,
          message: captionWarning
        })
      }

      // Ensure exports/ directory exists.
      await mkdir(layout.exports, { recursive: true })

      // Phase: subtitles — generate ASS first if burn-in is needed.
      let assAbsPath: string | undefined
      let srtRef: string | undefined
      let vttRef: string | undefined
      let assRef: string | undefined

      const needSubtitles =
        job.burnCaptions || job.subtitles.srt || job.subtitles.vtt || job.subtitles.ass

      if (needSubtitles) {
        onProgress({
          jobId,
          phase: 'subtitles',
          percent: 5,
          message: 'Generating subtitle files…'
        })

        // Pass the output resolution so ASS PlayResX/Y match the video dimensions.
        const [playResX, playResY] = RESOLUTION_MAP[job.resolution] ?? [1920, 1080]
        const subResult = await writeSubtitleFiles(project, bundlePath, {
          srt: job.subtitles.srt,
          vtt: job.subtitles.vtt,
          // Always generate ASS if burn-in is requested (needed for subtitles filter).
          ass: job.subtitles.ass || job.burnCaptions,
          playResX,
          playResY
        })

        srtRef = subResult.srtRef
        vttRef = subResult.vttRef
        assRef = subResult.assRef

        if (job.burnCaptions && subResult.assRef !== undefined) {
          assAbsPath = join(bundlePath, subResult.assRef)
        }
      }

      if (cancelled) {
        onProgress({
          jobId,
          phase: 'error',
          percent: 0,
          message: 'Export cancelled.',
          error: 'cancelled'
        })
        return
      }

      // Phase: encoding — spawn FFmpeg.
      onProgress({
        jobId,
        phase: 'encoding',
        percent: 10,
        message: 'Encoding video…'
      })

      const tempOutputPath = join(layout.exports, `${jobId}.tmp.${job.format}`)

      // ── DEBUG: log project structure ─────────────────────────────────────────
      const DEBUG_LOG = '/tmp/caption-export-debug.log'
      const trackSummary = project.tracks.map((t) => ({
        type: t.type,
        id: t.id,
        clips: t.clips.map((c) => ({
          id: c.id,
          mediaRef: c.mediaRef,
          in: c.in,
          out: c.out,
          start: c.start,
          durationSec: +(c.out - c.in).toFixed(3)
        }))
      }))
      const debugHeader = `\n=== EXPORT DEBUG ${new Date().toISOString()} ===\n`
      await writeFile(DEBUG_LOG, debugHeader + 'TRACKS:\n' + JSON.stringify(trackSummary, null, 2) + '\n')
      console.error('[export:debug] project tracks:', JSON.stringify(trackSummary, null, 2))
      onProgress({ jobId, phase: 'preparing', percent: 8,
        message: `[debug] ${project.tracks.length} tracks: ${project.tracks.map((t) => `${t.type}(${t.clips.length})`).join(', ')}` })
      // ─────────────────────────────────────────────────────────────────────────

      let ffmpegArgs: string[]
      try {
        ffmpegArgs = buildFfmpegArgs(project, bundlePath, tempOutputPath, {
          resolution: job.resolution,
          fps: job.fps,
          format: job.format,
          burnCaptions: job.burnCaptions,
          assSubtitlePath: assAbsPath,
          appFontsDir: appFontsDir(),
          // Preview-faithful burn-in: when the renderer pre-rendered a caption
          // overlay, composite it (gradient/3D/karaoke) INSTEAD of the flat ASS.
          ...(job.captionOverlay !== undefined
            ? {
                captionOverlay: {
                  framesPattern: job.captionOverlay.framesPattern,
                  fps: job.captionOverlay.fps,
                  startSec: job.captionOverlay.startSec
                }
              }
            : {})
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        onProgress({
          jobId,
          phase: 'error',
          percent: 0,
          message: `Failed to build FFmpeg arguments: ${msg}`,
          error: msg
        })
        return
      }

      // ── DEBUG: log full FFmpeg command ────────────────────────────────────────
      const ffmpegCmd = 'ffmpeg ' + ffmpegArgs.join(' ')
      await appendFile(DEBUG_LOG, '\nFFMPEG COMMAND:\n' + ffmpegCmd + '\n')
      console.error('[export:debug] ffmpeg command:\nffmpeg', ffmpegArgs.join(' '))
      onProgress({ jobId, phase: 'encoding', percent: 10,
        message: `[debug] ffmpeg ${ffmpegArgs.slice(0, 6).join(' ')} … (${ffmpegArgs.length} args total)` })
      // ─────────────────────────────────────────────────────────────────────────

      await new Promise<void>((resolve, reject) => {
        let proc: ReturnType<typeof spawn>
        try {
          proc = spawn(ffmpegBin(), ffmpegArgs, {
            stdio: ['ignore', 'ignore', 'pipe']
          })
        } catch (spawnErr: unknown) {
          reject(
            new Error(
              `ffmpeg not found: ${spawnErr instanceof Error ? spawnErr.message : String(spawnErr)}`
            )
          )
          return
        }

        childProcess = proc
        let stderr = ''

        proc.stderr?.on('data', (chunk: Buffer) => {
          const text = chunk.toString()
          stderr += text

          // Parse progress time= lines from FFmpeg stderr.
          const lines = text.split('\r').flatMap((l) => l.split('\n'))
          for (const line of lines) {
            const t = parseProgressTime(line)
            if (!isNaN(t)) {
              // Map encoding progress to 10–90% range.
              const encPercent = Math.min(1, t / totalDurationSec)
              const percent = 10 + Math.round(encPercent * 80)
              onProgress({
                jobId,
                phase: 'encoding',
                percent,
                message: `Encoding… ${percent}%`
              })
            }
          }
        })

        proc.on('error', (err) => {
          if (
            err.message.includes('ENOENT') ||
            err.message.toLowerCase().includes('not found')
          ) {
            reject(new Error('ffmpeg not found. Please install FFmpeg and ensure it is on PATH.'))
          } else {
            reject(new Error(`Failed to launch FFmpeg: ${err.message}`))
          }
        })

        proc.on('close', (code) => {
          childProcess = null
          if (cancelled) {
            reject(new Error('cancelled'))
          } else if (code === 0) {
            resolve()
          } else {
            // Log full stderr to main-process console and debug file.
            console.error('[export:debug] ffmpeg stderr (full):\n' + stderr)
            void appendFile(DEBUG_LOG, '\nFFMPEG STDERR:\n' + stderr + '\nEXIT CODE: ' + code + '\n').catch(() => {})
            // Show the most relevant last portion in the UI error message.
            const tail = stderr.trim().slice(-1200)
            reject(new Error(`FFmpeg exited with code ${code}: ${tail}`))
          }
        })
      })

      if (cancelled) {
        onProgress({
          jobId,
          phase: 'error',
          percent: 0,
          message: 'Export cancelled.',
          error: 'cancelled'
        })
        // Clean up temp file.
        try {
          await unlink(tempOutputPath)
        } catch { /* ignore */ }
        return
      }

      // Phase: writing — move temp file to final output.
      onProgress({
        jobId,
        phase: 'writing',
        percent: 92,
        message: 'Finalizing output…'
      })

      const finalName = `${jobId}.${job.format}`
      const finalPath = join(layout.exports, finalName)
      await rename(tempOutputPath, finalPath)
      let videoRef = `exports/${finalName}`

      // When user picked a save location, move the file there (cross-device safe).
      if (job.savePath !== undefined) {
        await mkdir(dirname(job.savePath), { recursive: true })
        await copyFile(finalPath, job.savePath)
        await unlink(finalPath)
        videoRef = job.savePath
      }

      // If outputLocation is onedrive, write via the storage provider.
      if (job.outputLocation === 'onedrive') {
        onProgress({
          jobId,
          phase: 'writing',
          percent: 95,
          message: 'Uploading to OneDrive…'
        })
        try {
          const { readFile } = await import('node:fs/promises')
          const provider = getProvider('onedrive')
          const data = await readFile(finalPath)
          await provider.writeOutput(job.ref, videoRef, data)
        } catch (uploadErr: unknown) {
          const msg =
            uploadErr instanceof Error ? uploadErr.message : String(uploadErr)
          onProgress({
            jobId,
            phase: 'writing',
            percent: 95,
            message: `OneDrive upload failed: ${msg} (local file saved)`
          })
        }
      }

      // If ASS was generated only for burn-in (not requested as sidecar), strip the ref.
      const finalAssRef = job.subtitles.ass ? assRef : undefined

      // Store the result for retrieval via export:getResult.
      exportResultCache.set(jobId, {
        jobId,
        videoRef,
        srtRef,
        vttRef,
        assRef: finalAssRef
      })

      onProgress({
        jobId,
        phase: 'done',
        percent: 100,
        message: 'Export complete.'
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      const isCancelled = msg === 'cancelled' || cancelled
      onProgress({
        jobId,
        phase: 'error',
        percent: 0,
        message: isCancelled ? 'Export cancelled.' : `Export failed: ${msg}`,
        error: isCancelled ? 'cancelled' : msg
      })
    } finally {
      // Always delete the caption-overlay scratch frames (success, error, or
      // cancel) so the bundle's cache/ never accumulates thousands of PNGs.
      if (job.captionOverlay !== undefined) {
        await cleanupCaptionFrames(job.captionOverlay.framesDir)
      }
    }
  })()

  return {
    jobId,
    cancel() {
      cancelled = true
      if (childProcess !== null) {
        try {
          childProcess.kill('SIGTERM')
          // Give it a moment, then SIGKILL if still running.
          setTimeout(() => {
            try {
              childProcess?.kill('SIGKILL')
            } catch { /* ignore */ }
          }, 2000)
        } catch { /* ignore */ }
      }
    }
  }
}

/** In-memory result cache (keyed by jobId). Populated when a job completes. */
export const exportResultCache = new Map<string, ExportResult>()

/** In-memory map of running job cancel functions. */
export const runningJobs = new Map<string, () => void>()

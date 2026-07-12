/**
 * Audio normalize for STT (P4.1 — Doc 02, ffmpeg-export skill).
 *
 * Converts an imported audio file in a bundle's `media/` folder to 16 kHz MONO
 * WAV in the bundle's `cache/` folder via FFmpeg (`-ac 1 -ar 16000`), which is
 * the input shape whisper.cpp expects (PROMPT 2.2). The conversion runs entirely
 * in MAIN; only the bundle-relative paths cross IPC — never audio bytes.
 *
 * This module imports node `child_process` but NOT electron, so the pure
 * `normalizedWavName` / `buildNormalizeArgs` helpers stay unit-testable; only the
 * `runFfmpeg` spawn boundary touches the OS.
 */
import { spawn } from 'node:child_process'
import { mkdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { bundleLayout } from '../storage/bundle'
import ffmpegPath from 'ffmpeg-static'

/** Target sample rate (Hz) — whisper.cpp expects 16 kHz mono WAV (Doc 02). */
export const STT_SAMPLE_RATE = 16000
/** Target channel count — mono. */
export const STT_CHANNELS = 1

/**
 * Derive the normalized WAV file name from a source media file name:
 * `voice.mp3` → `voice.16k.mono.wav`. Pure — encodes the normalization shape in
 * the name so a stale cache entry is obvious.
 */
export function normalizedWavName(sourceFileName: string): string {
  const base = basename(sourceFileName)
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  return `${stem}.16k.mono.wav`
}

/**
 * Build the FFmpeg argument vector to normalize `inputAbs` → `outputAbs` as
 * 16 kHz mono WAV. `-y` overwrites a stale cache entry. Pure (no spawn).
 */
export function buildNormalizeArgs(inputAbs: string, outputAbs: string): string[] {
  return [
    '-y',
    '-i',
    inputAbs,
    '-ac',
    String(STT_CHANNELS),
    '-ar',
    String(STT_SAMPLE_RATE),
    outputAbs
  ]
}

/**
 * Decide whether a cached WAV is fresh enough to reuse (idempotency). Pure: given
 * the source and cached-WAV modified times (epoch ms), the cache is fresh when it
 * exists and is at least as new as the source. `wavMtimeMs === null` means the WAV
 * is absent (must encode); `sourceMtimeMs === null` means the source mtime could
 * not be read, so we conservatively re-encode.
 */
export function isWavFresh(sourceMtimeMs: number | null, wavMtimeMs: number | null): boolean {
  if (wavMtimeMs === null) return false
  if (sourceMtimeMs === null) return false
  return wavMtimeMs >= sourceMtimeMs
}

/** Read a file's modified time in epoch ms, or null if it cannot be stat'd. */
async function mtimeMs(absPath: string): Promise<number | null> {
  try {
    return (await stat(absPath)).mtimeMs
  } catch {
    return null
  }
}

/** FFmpeg binary to invoke. Overridable via `CAPTION_STUDIO_FFMPEG` for tests/CI. */
function ffmpegBin(): string {
  return process.env.CAPTION_STUDIO_FFMPEG ?? ffmpegPath ?? 'ffmpeg'
}

/** Spawn FFmpeg with `args`; resolve on exit 0, reject with stderr otherwise. */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin(), args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) =>
      reject(new Error(`Failed to launch FFmpeg: ${err.message}. Is ffmpeg installed?`))
    )
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg exited with code ${code}: ${stderr.trim().slice(-500)}`))
    })
  })
}

/**
 * Normalize the bundle media file at `mediaRef` (e.g. `media/voice.mp3`) into a
 * 16 kHz mono WAV under `cache/`, returning its bundle-relative path
 * (e.g. `cache/voice.16k.mono.wav`). Ensures `cache/` exists. Idempotent: if a
 * cached WAV already exists and is at least as new as the source, the FFmpeg
 * re-encode is skipped. Throws on FFmpeg failure (the IPC wrapper converts it to
 * `{ ok:false, error }`).
 */
export async function normalizeAudio(bundlePath: string, mediaRef: string): Promise<string> {
  const layout = bundleLayout(bundlePath)
  await mkdir(layout.cache, { recursive: true })

  const sourceFileName = basename(mediaRef)
  const inputAbs = join(layout.media, sourceFileName)
  const wavName = normalizedWavName(sourceFileName)
  const outputAbs = join(layout.cache, wavName)
  const wavRef = `cache/${wavName}`

  // Idempotency: reuse a fresh cached WAV instead of re-encoding.
  if (isWavFresh(await mtimeMs(inputAbs), await mtimeMs(outputAbs))) return wavRef

  await runFfmpeg(buildNormalizeArgs(inputAbs, outputAbs))
  return wavRef
}

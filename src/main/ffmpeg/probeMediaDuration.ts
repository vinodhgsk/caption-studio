import { spawn } from 'node:child_process'
import { basename, join } from 'node:path'
import { bundleLayout } from '../storage/bundle'
import ffprobeStatic from 'ffprobe-static'

/** ffprobe binary to invoke. Overridable for tests/CI. */
function ffprobeBin(): string {
  return process.env.CAPTION_STUDIO_FFPROBE ?? ffprobeStatic.path ?? 'ffprobe'
}

/** Build ffprobe args that print ONLY the container duration in seconds. */
export function buildProbeArgs(inputAbs: string): string[] {
  return [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nw=1:nk=1',
    inputAbs
  ]
}

/** Parse ffprobe stdout into seconds; returns null for invalid/unknown durations. */
export function parseProbeDurationSec(stdout: string): number | null {
  const value = Number.parseFloat(stdout.trim())
  return Number.isFinite(value) && value > 0 ? value : null
}

function runFfprobe(inputAbs: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(ffprobeBin(), buildProbeArgs(inputAbs), {
      stdio: ['ignore', 'pipe', 'ignore']
    })

    let stdout = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    child.on('error', () => resolve(null))
    child.on('close', (code) => {
      if (code !== 0) {
        resolve(null)
        return
      }
      resolve(parseProbeDurationSec(stdout))
    })
  })
}

/**
 * Probe an imported media file duration from its bundle-relative mediaRef.
 * Returns null on failure so callers can gracefully fall back.
 */
export async function probeMediaDuration(bundlePath: string, mediaRef: string): Promise<number | null> {
  const layout = bundleLayout(bundlePath)
  const inputAbs = join(layout.media, basename(mediaRef))
  return await runFfprobe(inputAbs)
}

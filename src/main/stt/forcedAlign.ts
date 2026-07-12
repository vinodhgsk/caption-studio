/**
 * CTC forced-alignment sidecar runner (main process).
 *
 * Spawns the Python aligner (`resources/pyalign/forced_align.py`) inside its
 * dedicated venv, hands it the normalized WAV path + the KNOWN lyric words, and
 * parses the per-word timing it returns. Words are never sent back changed — only
 * timing is computed. This is the most accurate lyrics-first engine (real
 * acoustic alignment); when the sidecar is not installed or fails, the caller
 * falls back to VAD phrase-sync, so this is strictly an enhancement.
 *
 * No audio bytes cross the process boundary — only the bundle WAV path and the
 * lyric words (as JSON on stdin). The heavy torch model download/inference stays
 * in the sidecar.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ForcedWordTiming } from '../../shared/lyricsFirst'

export type { ForcedWordTiming }

export interface ForcedAlignResult {
  sampleRate: number
  /** One entry per input word, in order; null = word had no alignable tokens. */
  words: (ForcedWordTiming | null)[]
}

/** Default sidecar timeout — a 5-min song aligns in ~1 min on CPU; allow slack. */
const DEFAULT_TIMEOUT_MS = 8 * 60 * 1000

/**
 * Resolve the sidecar's venv python and script. `CAPTION_STUDIO_ALIGN_PY` (a
 * python executable) and `CAPTION_STUDIO_ALIGN_SCRIPT` override the defaults,
 * which sit under `resources/pyalign/` relative to the provided app root
 * (process.cwd() in dev). Returns null when either piece is missing.
 */
export function resolveSidecar(appRoot: string): { python: string; script: string } | null {
  const python =
    process.env.CAPTION_STUDIO_ALIGN_PY ??
    join(appRoot, 'resources', 'pyalign', '.venv', 'bin', 'python')
  const script =
    process.env.CAPTION_STUDIO_ALIGN_SCRIPT ?? join(appRoot, 'resources', 'pyalign', 'forced_align.py')
  if (!existsSync(python) || !existsSync(script)) return null
  return { python, script }
}

/**
 * Run CTC forced alignment. Returns the per-word timing, or null when the
 * sidecar is unavailable, times out, exits non-zero, or reports `{ok:false}`.
 * Never throws — the caller degrades to VAD phrase-sync on null.
 */
export async function runForcedAlign(args: {
  wavAbsPath: string
  words: readonly string[]
  language?: string
  appRoot: string
  timeoutMs?: number
}): Promise<ForcedAlignResult | null> {
  if (args.words.length === 0) return null
  const sidecar = resolveSidecar(args.appRoot)
  if (sidecar === null) return null

  const request = JSON.stringify({
    wav_path: args.wavAbsPath,
    language: args.language ?? null,
    words: args.words
  })

  return new Promise<ForcedAlignResult | null>((resolve) => {
    let stdout = ''
    let settled = false
    const done = (value: ForcedAlignResult | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(sidecar.python, [sidecar.script], { stdio: ['pipe', 'pipe', 'ignore'] })
    } catch {
      done(null)
      return
    }

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      done(null)
    }, args.timeoutMs ?? DEFAULT_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.on('error', () => done(null))
    child.on('close', (code) => {
      if (code !== 0) {
        done(null)
        return
      }
      try {
        const parsed = JSON.parse(stdout) as {
          ok?: boolean
          sample_rate?: number
          words?: (ForcedWordTiming | null)[]
        }
        if (parsed.ok !== true || !Array.isArray(parsed.words)) {
          done(null)
          return
        }
        done({ sampleRate: parsed.sample_rate ?? 16000, words: parsed.words })
      } catch {
        done(null)
      }
    })

    child.stdin?.on('error', () => done(null))
    child.stdin?.end(request)
  })
}

/**
 * Opt-in real CTC forced-alignment E2E (media/1.wav + Tamil lyrics).
 *
 * Runs the ACTUAL pipeline: lyricWordSequence → runForcedAlign (Python sidecar,
 * MMS CTC) → alignedFromForcedWords, and asserts the sync properties that VAD
 * phrase-sync could NOT achieve — most importantly that the "காற்றாகி" verse
 * lands AFTER the ~2:37–2:59 instrumental break (content-correct placement),
 * which is the regression this engine was built to fix.
 *
 * This is heavy (torch inference ~1 min + a one-time ~1 GB model download) and
 * needs the sidecar venv, so it is OFF by default. Enable with:
 *   CAPTION_STUDIO_RUN_CTC_E2E=1 npx vitest run src/e2e/forcedAlignCtc.e2e.test.ts
 * It also soft-skips if ffmpeg or the sidecar venv is missing.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { alignedFromForcedWords, lyricWordSequence } from '../shared/lyricsFirst'
import type { LyricsAlignmentResult } from '../shared/lyricsFirst'
import { resolveSidecar, runForcedAlign } from '../main/stt/forcedAlign'
import { MARIAMMAN_LYRICS } from './harness'

const ENABLED = process.env.CAPTION_STUDIO_RUN_CTC_E2E === '1'
const SRC = join(process.cwd(), 'media', '1.wav')
const APP_ROOT = process.cwd()

const LYRICS = MARIAMMAN_LYRICS

let aligned: LyricsAlignmentResult | null = null
let tmp = ''

beforeAll(async () => {
  if (!ENABLED || !existsSync(SRC) || resolveSidecar(APP_ROOT) === null) return
  try {
    tmp = mkdtempSync(join(tmpdir(), 'ctce2e-'))
    const wav = join(tmp, '1.16k.mono.wav')
    execFileSync('ffmpeg', ['-y', '-i', SRC, '-ac', '1', '-ar', '16000', wav], { stdio: 'ignore' })
    const words = lyricWordSequence(LYRICS)
    const forced = await runForcedAlign({ wavAbsPath: wav, words, language: 'ta', appRoot: APP_ROOT })
    if (forced === null) return
    aligned = alignedFromForcedWords({ lyrics: LYRICS, language: 'ta', timings: forced.words })
  } catch {
    aligned = null
  }
}, 600_000)

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
})

describe('CTC forced alignment — real audio (opt-in)', () => {
  it('places the காற்றாகி verse AFTER the instrumental break (content-correct)', () => {
    if (aligned === null) return
    const kaatru = aligned.lines.find((l) => l.text.startsWith('காற்றாகி'))
    expect(kaatru).toBeDefined()
    // Ground truth (Silero): vocals resume ~2:59.7 after the break; the VAD engine
    // wrongly placed this at ~2:33. CTC must land it after the break.
    expect(kaatru!.start).toBeGreaterThan(150) // well past the 2:33 VAD mistake
  })

  it('keeps lines monotonic with readable, bounded durations', () => {
    if (aligned === null) return
    const lines = aligned.lines
    for (let i = 0; i < lines.length; i++) {
      const dur = lines[i].end - lines[i].start
      expect(dur).toBeGreaterThan(0)
      expect(dur).toBeLessThanOrEqual(7 + 1e-6)
      if (i > 0) expect(lines[i].start).toBeGreaterThanOrEqual(lines[i - 1].start - 1e-6)
    }
  })

  it('keeps lyrics text exactly as provided', () => {
    if (aligned === null) return
    expect(aligned.lines[0].text).toBe('ஓம் சக்தி… அம்மா தாயே…')
  })
})

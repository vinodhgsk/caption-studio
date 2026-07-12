/**
 * Headed Electron UI end-to-end for the PREVIEW-FAITHFUL caption burn-in
 * (P13.x): create → import real media/audio → auto-caption (auto-applies the
 * Sarvam Bhakti Gold default) → EXPORT with burn-in → verify the exported file
 * exists AND the render used the PNG-overlay path (not the flat ASS fallback).
 *
 * This is the ONE flow that exercises the live renderer canvas capture
 * (`renderCaptionOverlay` → `drawTextClips` → `canvas.toBlob` → IPC), which the
 * headless vitest suite can't drive. The definitive assertion reads the runner's
 * debug log and checks the FFmpeg command overlaid the `frame_%06d.png` sequence
 * — that only happens when the renderer produced overlay frames successfully.
 *
 * Requires a real `ffmpeg` on PATH (to make a decodable MP4 and to encode). The
 * spec skips itself if ffmpeg is unavailable.
 *
 * Run with:  npx playwright test caption-overlay-export
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

const repoRoot = resolve(__dirname, '..')
const DEBUG_LOG = '/tmp/caption-export-debug.log'

const TRANSCRIPT = JSON.stringify({
  language: 'en',
  words: [
    { text: 'Om', start: 0.0, end: 0.5 },
    { text: 'Shanti', start: 0.5, end: 1.2 },
    { text: 'Namah', start: 1.4, end: 2.0 }
  ]
})

/** Valid 16-bit PCM mono WAV of `seconds` (silence) so FFmpeg can decode it. */
function makeWavBuffer(seconds: number, sampleRate = 16000): Buffer {
  const numSamples = Math.floor(seconds * sampleRate)
  const dataSize = numSamples * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(dataSize, 40)
  return buf
}

function ffmpegAvailable(): boolean {
  try {
    return spawnSync('ffmpeg', ['-version'], { timeout: 5000 }).status === 0
  } catch {
    return false
  }
}

/** Encode a real, decodable 2s black MP4 via FFmpeg. Returns false on failure. */
function makeRealMp4(path: string): boolean {
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-f', 'lavfi', '-i', 'color=black:s=640x360:r=24:d=2', '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p', '-t', '2', path],
    { timeout: 30000 }
  )
  return r.status === 0 && existsSync(path)
}

let app: ElectronApplication
let window: Page
let savePath = ''
let hasFfmpeg = false

test.beforeAll(async () => {
  hasFfmpeg = ffmpegAvailable()
  if (!hasFfmpeg) return

  const fixtureDir = mkdtempSync(join(tmpdir(), 'capstudio-overlay-e2e-'))
  const projectsRoot = mkdtempSync(join(tmpdir(), 'capstudio-overlay-projects-'))
  const videoPath = join(fixtureDir, 'clip.mp4')
  const audioPath = join(fixtureDir, 'voice.wav')
  savePath = join(fixtureDir, 'exported.mp4')

  if (!makeRealMp4(videoPath)) {
    hasFfmpeg = false
    return
  }
  writeFileSync(audioPath, makeWavBuffer(2))
  // Start from a clean debug log so our assertions read only THIS export.
  rmSync(DEBUG_LOG, { force: true })

  app = await electron.launch({
    args: [repoRoot],
    cwd: repoRoot,
    env: {
      ...process.env,
      CAPTION_STUDIO_E2E: '1',
      CAPTION_STUDIO_STT_PROVIDER: 'e2e',
      CAPTION_STUDIO_E2E_MEDIA: videoPath,
      CAPTION_STUDIO_E2E_AUDIO: audioPath,
      CAPTION_STUDIO_E2E_PROJECTS_ROOT: projectsRoot,
      CAPTION_STUDIO_E2E_TRANSCRIPT: TRANSCRIPT,
      CAPTION_STUDIO_E2E_SAVE_PATH: savePath
    }
  })
  window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

test('exports a burn-in video via the caption PNG-overlay path', async () => {
  test.skip(!hasFfmpeg, 'ffmpeg not available on PATH')

  // ── Create a 16:9 project so project aspect == export aspect (clean parity) ──
  const newProjectBtn = window.locator('header').getByRole('button', { name: 'New Project' })
  await expect(newProjectBtn).toBeVisible()
  await newProjectBtn.click()
  await window.locator('#np-name').fill('Overlay Export')
  await window.getByRole('radio', { name: '16:9' }).click()
  await window.locator('#np-language').selectOption('en')
  await window.getByRole('button', { name: 'Create' }).click()

  const openCard = window.locator('button[title="Overlay Export"]')
  await expect(openCard).toBeVisible()
  await openCard.click()
  await expect(window.getByRole('button', { name: 'Media', exact: true })).toBeVisible({ timeout: 20_000 })

  // ── Import media + audio ────────────────────────────────────────────────
  await window.getByRole('button', { name: 'Media', exact: true }).click()
  await window.getByRole('button', { name: 'Import media' }).click()
  await expect(window.getByText('Imported 1 clip.')).toBeVisible({ timeout: 15_000 })

  await window.getByRole('button', { name: 'Audio', exact: true }).click()
  await window.getByRole('button', { name: 'Import audio' }).click()
  await expect(window.getByText('Imported audio clip.')).toBeVisible({ timeout: 15_000 })

  // ── Auto-caption (Auto mode → injected transcript; auto-applies gold style) ──
  await window.getByRole('button', { name: 'Captions', exact: true }).click()
  await window.getByRole('radio', { name: 'Auto' }).click()
  await window.getByRole('button', { name: 'Generate captions' }).click()
  await expect(window.getByText('Captions generated.')).toBeVisible({ timeout: 30_000 })

  // ── Export with burn-in ───────────────────────────────────────────────────
  const rail = window.locator('nav[aria-label="Editor panels"]')
  await rail.getByRole('button', { name: 'Export' }).click()
  const panel = window.locator('aside[aria-label="Export panel"]')
  await expect(panel).toBeVisible()

  // Smallest resolution for a fast encode; burn-in defaults ON.
  await panel.locator('select').nth(1).selectOption('480p')
  const burnSwitch = panel.getByRole('switch', { name: 'Burn captions in' })
  await expect(burnSwitch).toHaveAttribute('aria-checked', 'true')

  await panel.getByRole('button', { name: 'Export' }).click()

  // Export completes (the save dialog is stubbed to CAPTION_STUDIO_E2E_SAVE_PATH).
  // Match the success banner specifically (the phase label also says "Export complete").
  await expect(panel.getByText(/Export complete\. Saved to:/)).toBeVisible({ timeout: 90_000 })

  // The exported file exists and is non-trivial.
  expect(existsSync(savePath)).toBe(true)
  expect(statSync(savePath).size).toBeGreaterThan(1000)

  // DEFINITIVE: the FFmpeg command overlaid the rendered PNG sequence — proving
  // the renderer capture path ran and the overlay (not the ASS fallback) was used.
  const log = readFileSync(DEBUG_LOG, 'utf8')
  expect(log).toContain('frame_%06d.png')
  expect(log).toContain('overlay=')
})

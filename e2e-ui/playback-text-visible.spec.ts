/**
 * E2E test: text clips must remain visible during timeline PLAYBACK.
 *
 * Regression test for the bug where text was invisible while the timeline was
 * playing but appeared correctly when paused. Root cause was the render-loop
 * useEffect tearing down/recreating on every playhead change (rAF frame), which
 * cancelled the animation frame before it could draw.
 *
 * Strategy:
 *   1. Create a project & open the editor.
 *   2. Add a text clip (which starts at the playhead = 0, default 5s duration).
 *   3. Verify the canvas is NOT blank while paused (baseline).
 *   4. Start playback → wait ~600ms → capture the canvas.
 *   5. Assert the canvas is NOT blank during playback (the regression).
 *   6. Pause → assert canvas still shows text.
 *
 * "Not blank" is determined by checking that the canvas pixel buffer contains
 * non-zero pixels beyond the background fill — i.e. at least SOME drawn content.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

const repoRoot = resolve(__dirname, '..')

/** Build a valid silent 16-bit PCM mono WAV so FFmpeg can read it if needed. */
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

/** Minimal MP4 ftyp box — enough for import classification by extension. */
function makeMp4Buffer(): Buffer {
  return Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
    0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32
  ])
}

let app: ElectronApplication
let window: Page

test.beforeAll(async () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'caption-studio-playback-'))
  const projectsRoot = mkdtempSync(join(tmpdir(), 'caption-studio-playback-proj-'))

  const videoPath = join(fixtureDir, 'demo-clip.mp4')
  const audioPath = join(fixtureDir, 'demo-voice.wav')
  writeFileSync(videoPath, makeMp4Buffer())
  writeFileSync(audioPath, makeWavBuffer(6))

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
      CAPTION_STUDIO_E2E_TRANSCRIPT: JSON.stringify({
        language: 'en',
        words: [
          { text: 'Hello', start: 0.0, end: 0.5 },
          { text: 'world', start: 0.5, end: 1.0 }
        ]
      })
    }
  })

  window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

/**
 * Check if the canvas has non-trivial content by examining its pixel data.
 * Returns the number of non-background pixels (any pixel whose RGB is NOT
 * all the same value as the top-left corner pixel — the assumed background).
 */
async function canvasNonBlankPixelCount(): Promise<number> {
  return await window.evaluate(() => {
    const canvas = (document.querySelector('[data-testid="preview-canvas"]')
      ?? document.querySelector('canvas')) as HTMLCanvasElement | null
    if (!canvas) return -1 // signal: canvas not found
    const ctx = canvas.getContext('2d')
    if (!ctx) return -2
    const { width, height } = canvas
    if (width === 0 || height === 0) return -3
    const imageData = ctx.getImageData(0, 0, width, height)
    const data = imageData.data
    // Sample background from (0,0) pixel
    const bgR = data[0]
    const bgG = data[1]
    const bgB = data[2]
    let nonBg = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== bgR || data[i + 1] !== bgG || data[i + 2] !== bgB) {
        nonBg++
      }
    }
    return nonBg
  })
}

test('text clips remain visible on the preview canvas during playback', async () => {
  // ── Step 1: Create project & open editor ──────────────────────────────────
  const newProjectBtn = window.locator('header').getByRole('button', { name: 'New Project' })
  await expect(newProjectBtn).toBeVisible()
  await newProjectBtn.click()

  await window.locator('#np-name').fill('Playback Visibility Test')
  await window.getByRole('radio', { name: '9:16' }).click()
  await window.locator('#np-language').selectOption('en')
  await window.getByRole('button', { name: 'Create' }).click()

  // Open the newly created project
  const openCard = window.locator('button[title="Playback Visibility Test"]')
  await expect(openCard).toBeVisible()
  await openCard.click()

  // Wait for editor to be ready
  await expect(window.getByRole('button', { name: 'Text', exact: true })).toBeVisible({
    timeout: 20_000
  })

  // ── Step 2: Add a text clip ───────────────────────────────────────────────
  await window.getByRole('button', { name: 'Text', exact: true }).click()
  await window.getByRole('button', { name: 'Add Text' }).click()

  // The text clip is created at playhead=0 with a default 5s duration.
  // Dismiss inline-edit mode: blur the textarea to trigger onBlur→commit→clear.
  // Then verify editingTextClipId is null by checking the textarea is gone.
  await window.waitForTimeout(500)
  // Focus the textarea first (it should already be focused, but ensure it).
  const textarea = window.locator('textarea')
  if (await textarea.isVisible()) {
    await textarea.focus()
    await window.waitForTimeout(100)
    // Press Escape while textarea is focused — this triggers commit().
    await textarea.press('Escape')
  }
  await window.waitForTimeout(500)
  // Confirm textarea is gone (edit mode exited).
  await expect(textarea).not.toBeVisible({ timeout: 5_000 })

  // ── Step 3: Verify canvas is NOT blank while paused ───────────────────────
  // The playhead is at 0 which is within the clip's [0, 5) interval.
  // Use waitForFunction to handle font loading delay — the canvas needs the font
  // file before it can draw text (may take up to a few seconds on first load).
  await window.waitForFunction(
    () => {
      const canvas = (document.querySelector('[data-testid="preview-canvas"]')
        ?? document.querySelector('canvas')) as HTMLCanvasElement | null
      if (!canvas) return false
      const ctx = canvas.getContext('2d')
      if (!ctx) return false
      const { width, height } = canvas
      if (width === 0 || height === 0) return false
      const imageData = ctx.getImageData(0, 0, width, height)
      const data = imageData.data
      const bgR = data[0], bgG = data[1], bgB = data[2]
      for (let i = 4; i < data.length; i += 4) {
        if (data[i] !== bgR || data[i + 1] !== bgG || data[i + 2] !== bgB) return true
      }
      return false
    },
    undefined,
    { timeout: 10_000 }
  )
  const pausedPixels = await canvasNonBlankPixelCount()
  expect(pausedPixels).toBeGreaterThan(0)

  await window.screenshot({ path: 'e2e-ui/__screens__/playback-01-paused-with-text.png' })

  // ── Step 4: Start playback ────────────────────────────────────────────────
  const playBtn = window.getByRole('button', { name: 'Play', exact: true })
  await expect(playBtn).toBeVisible()
  await playBtn.click()

  // The button label should now be "Pause" (confirming playback started).
  await expect(window.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()

  // ── Step 5: Verify canvas is NOT blank DURING playback ────────────────────
  // Wait a few frames so the rAF loop has time to draw at least one frame.
  await window.waitForTimeout(600)

  const playingPixels = await canvasNonBlankPixelCount()
  await window.screenshot({ path: 'e2e-ui/__screens__/playback-02-playing-with-text.png' })

  // THE REGRESSION: before the fix, this was 0 (canvas blank during playback).
  expect(playingPixels).toBeGreaterThan(0)

  // ── Step 6: Pause and verify text is still visible ────────────────────────
  const pauseBtnStep6 = window.getByRole('button', { name: 'Pause', exact: true })
  await pauseBtnStep6.click()
  await expect(window.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  await window.waitForTimeout(200)

  const afterPausePixels = await canvasNonBlankPixelCount()
  await window.screenshot({ path: 'e2e-ui/__screens__/playback-03-paused-after-play.png' })
  expect(afterPausePixels).toBeGreaterThan(0)
})

test('canvas renders consistently across multiple play/pause cycles', async () => {
  // This test exercises rapid play/pause toggling to ensure the effect cleanup
  // doesn't leave the canvas in a broken state.
  // Relies on state from the first test (same Electron window + project).
  // Verify we're on the editor page with a transport bar visible.
  const transportBtn = window.getByRole('button', { name: 'Play', exact: true })
  await expect(transportBtn).toBeVisible({ timeout: 5_000 })

  for (let cycle = 0; cycle < 3; cycle++) {
    // Play
    await window.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(window.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    await window.waitForTimeout(400)

    const pixels = await canvasNonBlankPixelCount()
    expect(pixels).toBeGreaterThan(0)

    // Pause
    await window.getByRole('button', { name: 'Pause', exact: true }).click()
    await expect(window.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
    await window.waitForTimeout(200)

    const pausedPixels = await canvasNonBlankPixelCount()
    expect(pausedPixels).toBeGreaterThan(0)
  }

  await window.screenshot({ path: 'e2e-ui/__screens__/playback-04-after-cycles.png' })
})

/**
 * E2E: real media playback using media/2.mp4 (contains video + audio).
 * Expectation:
 *  - import shows a clip in timeline
 *  - preview renders the video
 *  - while playing, media playback is active with audio enabled (not muted)
 *  - playback continues beyond 6.5s (not truncated to 5s) and ends near full clip duration
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

const repoRoot = resolve(__dirname, '..')
const mediaPath = resolve(repoRoot, 'media', '2.mp4')

let app: ElectronApplication
let window: Page

test.beforeAll(async () => {
  const projectsRoot = mkdtempSync(join(tmpdir(), 'caption-studio-media2-proj-'))
  app = await electron.launch({
    args: [repoRoot],
    cwd: repoRoot,
    env: {
      ...process.env,
      CAPTION_STUDIO_E2E: '1',
      CAPTION_STUDIO_STT_PROVIDER: 'e2e',
      CAPTION_STUDIO_E2E_MEDIA: mediaPath,
      CAPTION_STUDIO_E2E_PROJECTS_ROOT: projectsRoot
    }
  })

  window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  // Instrument media play calls so we can assert audio is enabled (unmuted play).
  await window.evaluate(() => {
    const w = window as unknown as {
      __e2eMediaPlayPatched?: boolean
      __e2eMediaStats?: {
        playCalls: number
        unmutedPlayCalls: number
        lastMuted: boolean | null
        lastVolume: number | null
      }
      __e2eMediaPlayOriginal?: HTMLMediaElement['play']
    }
    if (w.__e2eMediaPlayPatched) return

    w.__e2eMediaStats = {
      playCalls: 0,
      unmutedPlayCalls: 0,
      lastMuted: null,
      lastVolume: null
    }

    const proto = HTMLMediaElement.prototype
    w.__e2eMediaPlayOriginal = proto.play
    proto.play = function (...args: Parameters<HTMLMediaElement['play']>) {
      const stats = w.__e2eMediaStats
      if (stats !== undefined) {
        stats.playCalls += 1
        stats.lastMuted = this.muted
        stats.lastVolume = this.volume
        if (!this.muted && this.volume > 0) stats.unmutedPlayCalls += 1
      }
      return w.__e2eMediaPlayOriginal!.apply(this, args)
    }

    w.__e2eMediaPlayPatched = true
  })
})

test.afterAll(async () => {
  await app?.close()
})

async function canvasNonBlankPixelCount(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const canvas = (document.querySelector('[data-testid="preview-canvas"]')
      ?? document.querySelector('canvas')) as HTMLCanvasElement | null
    if (!canvas) return -1
    const ctx = canvas.getContext('2d')
    if (!ctx) return -2
    const { width, height } = canvas
    if (width === 0 || height === 0) return -3
    const imageData = ctx.getImageData(0, 0, width, height)
    const data = imageData.data
    const bgR = data[0]
    const bgG = data[1]
    const bgB = data[2]
    let nonBg = 0
    for (let i = 4; i < data.length; i += 4) {
      if (data[i] !== bgR || data[i + 1] !== bgG || data[i + 2] !== bgB) nonBg++
    }
    return nonBg
  })
}

async function waitForCanvasNonBlank(page: Page, timeout = 10_000): Promise<void> {
  await page.waitForFunction(() => {
    const canvas = (document.querySelector('[data-testid="preview-canvas"]')
      ?? document.querySelector('canvas')) as HTMLCanvasElement | null
    if (!canvas) return false
    const ctx = canvas.getContext('2d')
    if (!ctx) return false
    const { width, height } = canvas
    if (width === 0 || height === 0) return false
    const data = ctx.getImageData(0, 0, width, height).data
    const bgR = data[0], bgG = data[1], bgB = data[2]
    for (let i = 4; i < data.length; i += 4) {
      if (data[i] !== bgR || data[i + 1] !== bgG || data[i + 2] !== bgB) return true
    }
    return false
  }, undefined, { timeout })
}

function timecodeToSeconds(value: string, fps: number): number {
  const parts = value.trim().split(':').map((p) => Number(p))
  if (parts.length !== 3 || parts.some((p) => Number.isNaN(p))) return 0
  const [mm, ss, ff] = parts
  return mm * 60 + ss + ff / fps
}

test('2.mp4 imports, appears in timeline/preview, and plays full duration with audio enabled', async () => {
  const newProjectBtn = window.locator('header').getByRole('button', { name: 'New Project' })
  await expect(newProjectBtn).toBeVisible()
  await newProjectBtn.click()

  await window.locator('#np-name').fill('Media 2 Full Playback')
  await window.getByRole('radio', { name: '16:9' }).click()
  await window.locator('#np-language').selectOption('en')
  await window.getByRole('button', { name: 'Create' }).click()

  const openCard = window.locator('button[title="Media 2 Full Playback"]')
  await expect(openCard).toBeVisible()
  await openCard.click()

  await expect(window.getByRole('button', { name: 'Media', exact: true })).toBeVisible({
    timeout: 20_000
  })

  await window.getByRole('button', { name: 'Media', exact: true }).click()
  await window.getByRole('button', { name: 'Import media' }).click()
  await expect(window.getByText('Imported 1 clip.')).toBeVisible({ timeout: 20_000 })

  // Timeline clip should exist.
  await expect(window.locator('[data-clip-id]').first()).toBeVisible({ timeout: 15_000 })

  // Start playback.
  const playBtn = window.getByRole('button', { name: 'Play', exact: true })
  await expect(playBtn).toBeVisible()
  await playBtn.click()
  await expect(window.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()

  // Playback should advance the transport timecode.
  const timecode = window.getByLabel('Current timecode')
  const startTimecode = await timecode.textContent()
  await window.waitForTimeout(2000)
  const progressedTimecode = await timecode.textContent()
  expect(progressedTimecode).not.toBe(startTimecode)

  // Once playback is running, preview should show visual content.
  await waitForCanvasNonBlank(window, 10_000)
  expect(await canvasNonBlankPixelCount(window)).toBeGreaterThan(0)

  // Full clip end should auto-pause and show Play again within a reasonable window.
  await expect(window.getByRole('button', { name: 'Play', exact: true })).toBeVisible({
    timeout: 15000
  })

  // Validate full playback duration: 2.mp4 is ~8s and must not be truncated to 5s.
  const endTimecode = (await timecode.textContent()) ?? '00:00:00'
  const endSec = timecodeToSeconds(endTimecode, 30)
  expect(endSec).toBeGreaterThanOrEqual(7)

  // Audio intent assertion: at least one unmuted media play call occurred.
  const mediaStats = await window.evaluate(() => {
    const w = window as unknown as {
      __e2eMediaStats?: {
        playCalls: number
        unmutedPlayCalls: number
        lastMuted: boolean | null
        lastVolume: number | null
      }
    }
    return w.__e2eMediaStats ?? { playCalls: 0, unmutedPlayCalls: 0, lastMuted: null, lastVolume: null }
  })

  expect(mediaStats.playCalls).toBeGreaterThan(0)
  expect(mediaStats.unmutedPlayCalls).toBeGreaterThan(0)

  await window.screenshot({ path: 'e2e-ui/__screens__/media-2-full-playback-final.png' })
})

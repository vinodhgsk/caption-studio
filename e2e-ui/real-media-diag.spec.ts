/**
 * TEMPORARY diagnostic: import the REAL video file and report media state.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

const repoRoot = resolve(__dirname, '..')
const videoPath = join(homedir(), 'Downloads', 'media-1.mp4')

let app: ElectronApplication
let window: Page

test.beforeAll(async () => {
  const projectsRoot = mkdtempSync(join(tmpdir(), 'caption-studio-realvid-'))
  app = await electron.launch({
    args: [repoRoot],
    cwd: repoRoot,
    env: {
      ...process.env,
      CAPTION_STUDIO_E2E: '1',
      CAPTION_STUDIO_STT_PROVIDER: 'e2e',
      CAPTION_STUDIO_E2E_MEDIA: videoPath,
      CAPTION_STUDIO_E2E_PROJECTS_ROOT: projectsRoot
    }
  })
  window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  window.on('console', (msg) => console.log('[renderer]', msg.type(), msg.text()))
  window.on('pageerror', (err) => console.log('[pageerror]', err.message))
})

test.afterAll(async () => {
  await app?.close()
})

async function mediaDiag(): Promise<unknown> {
  return await window.evaluate(() => {
    const vids = Array.from(document.querySelectorAll('video')).map((v) => ({
      src: v.src.slice(0, 90),
      readyState: v.readyState,
      networkState: v.networkState,
      currentTime: v.currentTime,
      paused: v.paused,
      videoWidth: v.videoWidth,
      videoHeight: v.videoHeight,
      error: v.error ? { code: v.error.code, message: v.error.message } : null
    }))
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null
    let nonBg = -1
    if (canvas) {
      const ctx = canvas.getContext('2d')
      if (ctx) {
        const { width, height } = canvas
        const d = ctx.getImageData(0, 0, width, height).data
        const bgR = d[0], bgG = d[1], bgB = d[2]
        nonBg = 0
        for (let i = 4; i < d.length; i += 4) {
          if (d[i] !== bgR || d[i + 1] !== bgG || d[i + 2] !== bgB) nonBg++
        }
      }
    }
    return { vids, canvas: canvas ? { w: canvas.width, h: canvas.height, nonBg } : null }
  })
}

test('diagnose real video import', async () => {
  const newProjectBtn = window.locator('header').getByRole('button', { name: 'New Project' })
  await expect(newProjectBtn).toBeVisible()
  await newProjectBtn.click()
  await window.locator('#np-name').fill('Real Video Test')
  await window.getByRole('radio', { name: '9:16' }).click()
  await window.locator('#np-language').selectOption('en')
  await window.getByRole('button', { name: 'Create' }).click()

  const openCard = window.locator('button[title="Real Video Test"]')
  await expect(openCard).toBeVisible()
  await openCard.click()

  await expect(window.getByRole('button', { name: 'Media', exact: true })).toBeVisible({
    timeout: 20_000
  })

  await window.getByRole('button', { name: 'Media', exact: true }).click()
  await window.getByRole('button', { name: 'Import media' }).click()
  await expect(window.getByText('Imported 1 clip.')).toBeVisible({ timeout: 20_000 })

  await window.waitForTimeout(2000)
  console.log('[VIDEO DIAG t0]', JSON.stringify(await mediaDiag(), null, 2))
  await window.screenshot({ path: 'e2e-ui/__screens__/real-02-video-paused.png' })

  await window.getByRole('button', { name: 'Play', exact: true }).click()
  await window.waitForTimeout(1500)
  console.log('[VIDEO DIAG playing]', JSON.stringify(await mediaDiag(), null, 2))
  await window.screenshot({ path: 'e2e-ui/__screens__/real-03-video-playing.png' })
})

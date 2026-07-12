import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

const repoRoot = resolve(__dirname, '..')
const mediaPath = resolve(repoRoot, 'media', 'full-video.mp4')

let app: ElectronApplication
let window: Page

async function importIntoProject(projectName: string): Promise<void> {
  const projectsLink = window.getByRole('link', { name: '← Projects' })
  if (await projectsLink.isVisible().catch(() => false)) {
    await projectsLink.click()
  }

  const newProjectBtn = window.locator('header').getByRole('button', { name: 'New Project' })
  await expect(newProjectBtn).toBeVisible()
  await newProjectBtn.click()

  await window.locator('#np-name').fill(projectName)
  await window.getByRole('radio', { name: '16:9' }).click()
  await window.locator('#np-language').selectOption('en')
  await window.getByRole('button', { name: 'Create' }).click()

  const openCard = window.locator(`button[title="${projectName}"]`)
  await expect(openCard).toBeVisible()
  await openCard.click()

  await expect(window.getByRole('button', { name: 'Media', exact: true })).toBeVisible({
    timeout: 20_000
  })

  await window.getByRole('button', { name: 'Media', exact: true }).click()
  await window.getByRole('button', { name: 'Import media' }).click()
  await expect(window.getByText('Imported 1 clip.')).toBeVisible({ timeout: 20_000 })
  await expect(window.locator('[data-clip-id]').first()).toBeVisible({ timeout: 15_000 })
  await window.waitForTimeout(500)
}

async function readTimelineState(): Promise<{
  scrollClientWidth: number
  scrollWidth: number
  scrollLeft: number
  clipWidth: number
  labels: string[]
}> {
  return await window.evaluate(() => {
    const footer = document.querySelector('footer')
    const scroll = footer?.querySelector('div.overflow-x-auto.overflow-y-auto') as HTMLDivElement | null
    const ruler = footer?.querySelector('[role="presentation"]') as HTMLDivElement | null
    const clip = footer?.querySelector('[data-clip-id]') as HTMLElement | null
    const labels = Array.from(ruler?.querySelectorAll('span') ?? [])
      .map((el) => el.textContent?.trim() ?? '')
      .filter((text) => text.length > 0)

    return {
      scrollClientWidth: scroll?.clientWidth ?? 0,
      scrollWidth: scroll?.scrollWidth ?? 0,
      scrollLeft: scroll?.scrollLeft ?? 0,
      clipWidth: clip?.getBoundingClientRect().width ?? 0,
      labels
    }
  })
}

async function expectFullFitTimeline(): Promise<void> {
  await expect(window.getByText('View: Fit media')).toBeVisible()

  const timelineState = await readTimelineState()
  expect(timelineState.labels).toContain('5:00')
  expect(timelineState.scrollLeft).toBe(0)
  expect(Math.abs(timelineState.scrollWidth - timelineState.scrollClientWidth)).toBeLessThanOrEqual(4)
  expect(timelineState.clipWidth).toBeGreaterThan(timelineState.scrollClientWidth * 0.9)
}

test.beforeAll(async () => {
  const projectsRoot = mkdtempSync(join(tmpdir(), 'caption-studio-full-video-fit-'))
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
})

test.afterAll(async () => {
  await app?.close()
})

test('full-video.mp4 import auto-fits the full media duration in the timeline', async () => {
  await importIntoProject('Full Video Timeline Fit')
  await expectFullFitTimeline()

  await window.screenshot({ path: 'e2e-ui/__screens__/full-video-timeline-fit.png' })
})

test('full-video.mp4 remains fully fit after save, close, and reopen', async () => {
  await importIntoProject('Full Video Reopen Fit')
  await expectFullFitTimeline()

  const saveButton = window.getByRole('button', { name: 'Save', exact: true })
  await expect(saveButton).toBeVisible()
  await saveButton.click()
  await expect(window.getByRole('status')).toContainText('Saved')

  await window.getByRole('link', { name: '← Projects' }).click()
  const reopenCard = window.locator('button[title="Full Video Reopen Fit"]')
  await expect(reopenCard).toBeVisible({ timeout: 20_000 })
  await reopenCard.click()

  await expect(window.getByRole('button', { name: 'Media', exact: true })).toBeVisible({
    timeout: 20_000
  })
  await window.waitForTimeout(500)

  await expectFullFitTimeline()

  await window.screenshot({ path: 'e2e-ui/__screens__/full-video-reopen-fit.png' })
})

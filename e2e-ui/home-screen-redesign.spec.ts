/**
 * E2E test for the Projects Home Redesign (Sidebar, Workspace controls, Layouts, and Presets)
 * driven by Playwright's headed Electron UI test runner.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

const repoRoot = resolve(__dirname, '..')

let app: ElectronApplication
let window: Page

test.beforeAll(async () => {
  const projectsRoot = mkdtempSync(join(tmpdir(), 'caption-studio-e2e-projects-home-'))

  // Case-insensitively filter out all OneDrive environment variables from the sandbox environment
  const sandboxEnv = { ...process.env }
  for (const key of Object.keys(sandboxEnv)) {
    if (key.toLowerCase().includes('onedrive')) {
      delete sandboxEnv[key]
    }
  }

  app = await electron.launch({
    args: [repoRoot],
    cwd: repoRoot,
    env: {
      ...sandboxEnv,
      CAPTION_STUDIO_E2E: '1',
      CAPTION_STUDIO_E2E_PROJECTS_ROOT: projectsRoot
    }
  })

  window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  // Pre-seed localStorage to bypass onboarding modal deterministically
  await window.evaluate(() => {
    localStorage.setItem('onboardingComplete', '1')
  })
  await window.reload()
  await window.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

/** Small pause + screenshot helper to capture UI transitions. */
async function beat(name: string): Promise<void> {
  await window.screenshot({ path: `e2e-ui/__screens__/${name}.png` })
  await window.waitForTimeout(600)
}

test('Projects Home Redesign: Sidebar, Workspace controls, Layouts, and Presets', async () => {
  // ── 1. Sidebar Elements & Branding Visibility ────────────────────────────
  await expect(window.getByRole('heading', { name: 'Caption Studio', exact: true })).toBeVisible()
  await expect(window.getByText('Guest Creator')).toBeVisible()
  await expect(window.getByText('0 MB / 512 MB')).toBeVisible()
  await expect(window.getByRole('button', { name: '+ Start creating' })).toBeVisible()
  await expect(window.getByRole('button', { name: 'Local Drafts' })).toBeVisible()
  await expect(window.getByRole('button', { name: 'Cloud Space OneDrive' })).toBeVisible()
  await expect(window.getByRole('button', { name: 'Synology NAS Synology' })).toBeVisible()
  await beat('01-sidebar-visible')

  // ── 2. Cancel Project Creation ──────────────────────────────────────────
  await window.getByRole('button', { name: '+ Start creating' }).click()
  await expect(window.getByRole('dialog')).toBeVisible()
  await window.getByRole('button', { name: 'Cancel' }).click()
  await expect(window.getByRole('dialog')).not.toBeVisible()

  // ── 3. Create Project Alpha (Landscape 16:9) ─────────────────────────────
  await window.getByRole('button', { name: '+ Start creating' }).click()
  await window.locator('#np-name').fill('Project Alpha')
  await beat('02-create-alpha-dialog')
  await window.getByRole('button', { name: 'Create' }).click()

  // Wait for dialog to close and project card to appear on home
  const openAlphaCard = window.locator('button[title="Project Alpha"]')
  await expect(openAlphaCard).toBeVisible()
  await beat('03-project-alpha-created')

  // Click card to open in Editor
  await openAlphaCard.click()
  await expect(window.getByRole('link', { name: '← Projects' })).toBeVisible({ timeout: 20_000 })
  await beat('04-editor-alpha-open')

  // Navigate back to home
  await window.getByRole('link', { name: '← Projects' }).click()
  await expect(window.getByRole('heading', { name: 'Caption Studio', exact: true })).toBeVisible()

  // ── 4. Create Project Beta via Quick Presets (Portrait 9:16) ─────────────
  const quickPortraitBtn = window.getByRole('button', { name: '9:16 Portrait TikTok, Shorts, Reels' })
  await expect(quickPortraitBtn).toBeVisible()
  await quickPortraitBtn.click()

  // Check aspect is pre-selected as 9:16
  const portraitRadio = window.getByRole('radio', { name: '9:16' })
  await expect(portraitRadio).toHaveAttribute('aria-checked', 'true')
  await window.locator('#np-name').fill('Project Beta')
  await beat('05-create-beta-dialog-quick-aspect')
  await window.getByRole('button', { name: 'Create' }).click()

  // Wait for dialog to close and project card to appear on home
  const openBetaCard = window.locator('button[title="Project Beta"]')
  await expect(openBetaCard).toBeVisible()
  await beat('06-project-beta-created')

  // Click card to open in Editor
  await openBetaCard.click()
  await expect(window.getByRole('link', { name: '← Projects' })).toBeVisible({ timeout: 20_000 })
  await beat('07-editor-beta-open')

  // Navigate back to home
  await window.getByRole('link', { name: '← Projects' }).click()
  await expect(window.getByRole('heading', { name: 'Caption Studio', exact: true })).toBeVisible()

  // Both cards should be visible
  await expect(window.locator('button[title="Project Alpha"]')).toBeVisible()
  await expect(window.locator('button[title="Project Beta"]')).toBeVisible()
  await beat('08-two-draft-cards')

  // ── 5. Test Search Filtering ─────────────────────────────────────────────
  const searchInput = window.getByPlaceholder('Search drafts...')
  await expect(searchInput).toBeVisible()
  
  // Search for Alpha
  await searchInput.fill('Alpha')
  await expect(window.locator('button[title="Project Alpha"]')).toBeVisible()
  await expect(window.locator('button[title="Project Beta"]')).not.toBeVisible()
  await beat('09-search-alpha')

  // Clear search
  await window.getByRole('button', { name: '×' }).click()
  await expect(window.locator('button[title="Project Alpha"]')).toBeVisible()
  await expect(window.locator('button[title="Project Beta"]')).toBeVisible()

  // ── 6. Test Sorting Options ──────────────────────────────────────────────
  const sortSelect = window.locator('select')
  await expect(sortSelect).toBeVisible()

  // Sort by Name (A-Z)
  await sortSelect.selectOption('name')
  // Verify order: Alpha first, then Beta
  const firstCardTitle = await window.locator('.group button span.truncate').first().textContent()
  expect(firstCardTitle).toBe('Project Alpha')
  await beat('10-sort-by-name')

  // Sort back to Date Modified (Recent first)
  await sortSelect.selectOption('date')
  const firstCardTitleRecent = await window.locator('.group button span.truncate').first().textContent()
  expect(firstCardTitleRecent).toBe('Project Beta')

  // ── 7. Test Grid / List Layout Switching ─────────────────────────────────
  const listViewBtn = window.getByLabel('List view')
  const gridViewBtn = window.getByLabel('Grid view')

  await expect(listViewBtn).toBeVisible()
  await expect(gridViewBtn).toBeVisible()

  // Toggle List View
  await listViewBtn.click()
  await expect(window.locator('table')).toBeVisible()
  await expect(window.locator('th').getByText('Name', { exact: true })).toBeVisible()
  await expect(window.locator('th').getByText('Ratio', { exact: true })).toBeVisible()
  await expect(window.locator('th').getByText('Duration', { exact: true })).toBeVisible()
  await expect(window.locator('td').getByText('Project Alpha')).toBeVisible()
  await expect(window.locator('td').getByText('Project Beta')).toBeVisible()
  await beat('11-list-view')

  // Toggle Grid View
  await gridViewBtn.click()
  await expect(window.locator('table')).not.toBeVisible()
  await expect(window.locator('button[title="Project Alpha"]')).toBeVisible()
  await expect(window.locator('button[title="Project Beta"]')).toBeVisible()
  await beat('12-grid-view-restored')

  // ── 8. Test Cloud Space (Location Switching - OneDrive) ──────────────────
  const cloudSpaceBtn = window.getByRole('button', { name: 'Cloud Space OneDrive' })
  const localDraftsBtn = window.getByRole('button', { name: 'Local Drafts' })

  // Toggle OneDrive
  await cloudSpaceBtn.click()
  // Under OneDrive it should fail to load and display error state (offline/not-implemented)
  await expect(window.getByRole('heading', { name: 'Cloud Drafts' })).toBeVisible()
  await expect(window.getByText("Couldn't load drafts")).toBeVisible()
  await beat('13-cloud-space-error')

  // ── 9. Test Synology NAS (Location Switching - Synology) ──────────────────
  const synologyBtn = window.getByRole('button', { name: 'Synology NAS Synology' })

  // Toggle Synology NAS
  await synologyBtn.click()
  // Fails with a "default folder SynologyDrive not found" error since Synology is absent in tests
  await expect(window.getByText("Couldn't load drafts")).toBeVisible()
  await beat('14-synology-space-error')

  // Toggle Local Drafts back
  await localDraftsBtn.click()
  await expect(window.getByRole('heading', { name: 'Local Drafts' })).toBeVisible()
  await expect(window.locator('button[title="Project Alpha"]')).toBeVisible()
  await expect(window.locator('button[title="Project Beta"]')).toBeVisible()
  await beat('15-local-drafts-restored')
})

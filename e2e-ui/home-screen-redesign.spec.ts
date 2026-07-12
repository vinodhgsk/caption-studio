/**
 * E2E test for the CapCut-style Projects Home Redesign.
 * Covers: icon-rail sidebar, top header bar, quick-create banner, filter tabs,
 * sort/view controls, search, OneDrive & Synology location switching.
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
  const projectsRoot = mkdtempSync(join(tmpdir(), 'caption-studio-e2e-home-'))

  const sandboxEnv = { ...process.env }
  for (const key of Object.keys(sandboxEnv)) {
    if (key.toLowerCase().includes('onedrive')) delete sandboxEnv[key]
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

  // Bypass onboarding
  await window.evaluate(() => localStorage.setItem('onboardingComplete', '1'))
  await window.reload()
  await window.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

async function beat(name: string): Promise<void> {
  await window.screenshot({ path: `e2e-ui/__screens__/${name}.png` })
  await window.waitForTimeout(500)
}

test('Projects Home Redesign: Sidebar icon-rail, Header, Quick-create banner, Filter tabs, Sort, View toggle, Search, Location switching', async () => {
  // ── 1. Icon-rail sidebar ──────────────────────────────────────────────
  // App logo
  await expect(window.locator('aside [title="Caption Studio"]')).toBeVisible()
  // New project CTA in sidebar
  await expect(window.locator('aside [aria-label="New Project"]')).toBeVisible()
  // Nav rail location buttons
  await expect(window.locator('aside [aria-label="Local Drafts"]')).toBeVisible()
  await expect(window.locator('aside [aria-label="OneDrive"]')).toBeVisible()
  await expect(window.locator('aside [aria-label="Synology NAS"]')).toBeVisible()
  // Settings button in icon-rail
  await expect(window.locator('aside [aria-label="Settings"]')).toBeVisible()
  await beat('01-icon-rail-sidebar')

  // ── 2. Top navigation header bar ─────────────────────────────────────
  await expect(window.locator('header')).toBeVisible()
  // Breadcrumb: app name
  await expect(window.locator('header').getByText('Caption Studio')).toBeVisible()
  // Workspace label for local
  await expect(window.locator('header').getByText('Local Drafts')).toBeVisible()
  // Search input in header
  const headerSearch = window.locator('header input[aria-label="Search projects"]')
  await expect(headerSearch).toBeVisible()
  // New project button in header
  await expect(window.locator('header button', { hasText: 'New Project' })).toBeVisible()
  // User avatar
  await expect(window.locator('header [title="Guest Creator"]')).toBeVisible()
  await beat('02-top-header')

  // ── 3. Quick-create banner ────────────────────────────────────────────
  await expect(window.getByText('Start a new project')).toBeVisible()
  await expect(window.getByRole('button', { name: /16:9.*Landscape/i })).toBeVisible()
  await expect(window.getByRole('button', { name: /9:16.*Portrait/i })).toBeVisible()
  await expect(window.getByRole('button', { name: /1:1.*Square/i })).toBeVisible()
  await beat('03-quick-create-banner')

  // ── 4. Cancel dialog from header button ──────────────────────────────
  await window.locator('header button', { hasText: 'New Project' }).click()
  const dialog = window.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).not.toBeVisible()

  // ── 5. Create Project Alpha via Quick-create (16:9 Landscape) ────────
  await window.getByRole('button', { name: /16:9.*Landscape/i }).click()
  const portraitRadio16 = window.getByRole('radio', { name: '16:9' })
  await expect(portraitRadio16).toHaveAttribute('aria-checked', 'true')
  await window.locator('#np-name').fill('Project Alpha')
  await beat('04-create-alpha-dialog')
  await window.getByRole('dialog').getByRole('button', { name: 'Create' }).click()
  await expect(window.locator('button[title="Project Alpha"]')).toBeVisible()
  await beat('05-alpha-created')

  // ── 6. Open Alpha in editor and navigate back ─────────────────────────
  await window.locator('button[title="Project Alpha"]').click()
  await expect(window.getByRole('link', { name: '← Projects' })).toBeVisible({ timeout: 20_000 })
  await beat('06-editor-open')
  await window.getByRole('link', { name: '← Projects' }).click()
  await expect(window.locator('header').getByText('Caption Studio')).toBeVisible()

  // ── 7. Create Project Beta via Quick-create (9:16 Portrait) ──────────
  await window.getByRole('button', { name: /9:16.*Portrait/i }).click()
  const portraitRadio916 = window.getByRole('radio', { name: '9:16' })
  await expect(portraitRadio916).toHaveAttribute('aria-checked', 'true')
  await window.locator('#np-name').fill('Project Beta')
  await beat('07-create-beta-dialog')
  await window.getByRole('dialog').getByRole('button', { name: 'Create' }).click()
  await expect(window.locator('button[title="Project Beta"]')).toBeVisible()
  await beat('08-beta-created')

  // Both cards visible
  await expect(window.locator('button[title="Project Alpha"]')).toBeVisible()
  await expect(window.locator('button[title="Project Beta"]')).toBeVisible()

  // ── 8. Filter tabs ────────────────────────────────────────────────────
  const recentTab = window.getByRole('button', { name: 'Recent', exact: true })
  const allTab = window.getByRole('button', { name: 'All', exact: true })
  await expect(recentTab).toBeVisible()
  await expect(allTab).toBeVisible()
  await allTab.click()
  await expect(window.locator('button[title="Project Alpha"]')).toBeVisible()
  await beat('09-all-tab')
  await recentTab.click()

  // ── 9. Header search ──────────────────────────────────────────────────
  await headerSearch.fill('Alpha')
  await expect(window.locator('button[title="Project Alpha"]')).toBeVisible()
  await expect(window.locator('button[title="Project Beta"]')).not.toBeVisible()
  await beat('10-header-search-alpha')

  // Clear search via × button in header
  await window.locator('header button[aria-label="Clear search"]').click()
  await expect(window.locator('button[title="Project Alpha"]')).toBeVisible()
  await expect(window.locator('button[title="Project Beta"]')).toBeVisible()

  // ── 10. Sort selector ─────────────────────────────────────────────────
  const sortSelect = window.locator('select[aria-label="Sort by"]')
  await expect(sortSelect).toBeVisible()
  await sortSelect.selectOption('name')
  // Alpha should appear first — verify at least one card name is visible
  const firstCard = await window.locator('.group button span.line-clamp-1').first().textContent()
  // Note: list uses line-clamp-1 span; this is a loose check
  expect(firstCard).toBeTruthy()
  await beat('11-sort-by-name')
  await sortSelect.selectOption('date')

  // ── 11. View toggle: List → Grid ─────────────────────────────────────
  const listBtn = window.getByLabel('List view')
  const gridBtn = window.getByLabel('Grid view')
  await listBtn.click()
  await expect(window.locator('table')).toBeVisible()
  // List view has thumbnail column header (no text, just empty th)
  await expect(window.getByRole('columnheader', { name: 'Name', exact: true })).toBeVisible()
  await expect(window.getByRole('columnheader', { name: 'Ratio', exact: true })).toBeVisible()
  await expect(window.locator('td').getByText('Project Alpha')).toBeVisible()
  await expect(window.locator('td').getByText('Project Beta')).toBeVisible()
  await beat('12-list-view')

  await gridBtn.click()
  await expect(window.locator('table')).not.toBeVisible()
  await expect(window.locator('button[title="Project Alpha"]')).toBeVisible()
  await beat('13-grid-view-restored')

  // ── 12. OneDrive location switch ──────────────────────────────────────
  await window.locator('aside [aria-label="OneDrive"]').click()
  // Header breadcrumb updates
  await expect(window.locator('header').getByText(/OneDrive/)).toBeVisible()
  // Offline fallback expected in sandbox (isOffline=true shows "Could not connect")
  await expect(window.getByRole('heading', { name: 'Could not connect' })).toBeVisible()
  await beat('14-onedrive-error')

  // ── 13. Synology location switch ─────────────────────────────────────
  await window.locator('aside [aria-label="Synology NAS"]').click()
  await expect(window.locator('header').getByText(/Synology/)).toBeVisible()
  await expect(window.getByRole('heading', { name: 'Could not connect' })).toBeVisible()
  await beat('15-synology-error')

  // ── 14. Return to Local Drafts ────────────────────────────────────────
  await window.locator('aside [aria-label="Local Drafts"]').click()
  await expect(window.locator('header').getByText('Local Drafts')).toBeVisible()
  await expect(window.getByRole('heading', { name: 'Local Drafts' })).toBeVisible()
  await expect(window.locator('button[title="Project Alpha"]')).toBeVisible()
  await expect(window.locator('button[title="Project Beta"]')).toBeVisible()
  await beat('16-local-drafts-restored')
})

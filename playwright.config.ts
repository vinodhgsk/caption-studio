import { defineConfig } from '@playwright/test'

/**
 * Playwright config for the HEADED Electron UI end-to-end run (separate from the
 * headless vitest suite in `src/e2e`). `testDir` is scoped to `e2e-ui/` so the
 * runner never picks up vitest `*.test.ts` files, and vitest's `src/**` include
 * never picks up these specs.
 *
 * The spec launches the REAL built Electron app via Playwright's `_electron`
 * driver, so the app must be built first (`npm run build`). A trace, video, and
 * screenshots are captured so the run can be reviewed in the HTML report.
 */
export default defineConfig({
  testDir: 'e2e-ui',
  testMatch: '**/*.spec.ts',
  // The Electron app launch + UI flow is sequential; one worker keeps the single
  // window deterministic and easy to watch.
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'on',
    video: 'on',
    screenshot: 'on'
  }
})

/**
 * Headed Electron UI end-to-end demo (Phases 1–5) driven by Playwright's
 * `_electron` driver against the BUILT app in `out/`.
 *
 * This launches the REAL Electron window so the flow is visible on screen:
 *   1. Project management — create a project, open it in the editor.
 *   3. Media           — import a video clip.
 *   4. Audio           — import an audio clip.
 *   2. Auto-caption    — generate captions from the audio (E2E STT provider).
 *   5. Caption styles  — apply a built-in caption preset.
 *
 * Native OS file dialogs and the whisper model are stubbed in the MAIN process
 * via env-guarded hooks (all inert in production):
 *   - CAPTION_STUDIO_E2E=1                  master flag
 *   - CAPTION_STUDIO_STT_PROVIDER=e2e       inject a real transcript (no model)
 *   - CAPTION_STUDIO_E2E_MEDIA / _AUDIO     stub pickMedia / pickAudio
 *   - CAPTION_STUDIO_E2E_PROJECTS_ROOT      isolate projects from real Documents
 *   - CAPTION_STUDIO_E2E_TRANSCRIPT         the words the STT provider returns
 *
 * Run with:  npx playwright test
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

const repoRoot = resolve(__dirname, '..')

/** Built-in caption preset we apply in Phase 5 (see CaptionPresetGallery). */
const PRESET_NAME = 'Pop by Word'

/** The transcript the E2E STT provider returns. The >0.7s gap splits 2 lines. */
const TRANSCRIPT = JSON.stringify({
  language: 'en',
  words: [
    { text: 'Welcome', start: 0.0, end: 0.4 },
    { text: 'to', start: 0.4, end: 0.6 },
    { text: 'Caption', start: 0.6, end: 1.0 },
    { text: 'Studio.', start: 1.0, end: 1.5 },
    { text: 'Edit', start: 2.4, end: 2.7 },
    { text: 'videos', start: 2.7, end: 3.1 },
    { text: 'fast.', start: 3.1, end: 3.5 }
  ]
})

/** Build a valid silent 16-bit PCM mono WAV of `seconds` so FFmpeg can read it. */
function makeWavBuffer(seconds: number, sampleRate = 16000): Buffer {
  const numSamples = Math.floor(seconds * sampleRate)
  const dataSize = numSamples * 2 // 16-bit mono
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16) // fmt chunk size
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28) // byte rate
  buf.writeUInt16LE(2, 32) // block align
  buf.writeUInt16LE(16, 34) // bits per sample
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(dataSize, 40)
  // samples left as zero → silence
  return buf
}

/** A minimal MP4 `ftyp` box. Import classifies by extension; no probe at import. */
function makeMp4Buffer(): Buffer {
  return Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, // box size + 'ftyp'
    0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00, // 'isom' + minor version
    0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32 // compatible brands
  ])
}

let app: ElectronApplication
let window: Page

test.beforeAll(async () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'caption-studio-e2e-ui-'))
  const projectsRoot = mkdtempSync(join(tmpdir(), 'caption-studio-e2e-projects-'))

  const videoPath = join(fixtureDir, 'demo-clip.mp4')
  const audioPath = join(fixtureDir, 'demo-voice.wav')
  writeFileSync(videoPath, makeMp4Buffer())
  writeFileSync(audioPath, makeWavBuffer(4))

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
      CAPTION_STUDIO_E2E_TRANSCRIPT: TRANSCRIPT
    }
  })

  window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

/** Small pause + screenshot so the run is easy to watch and review. */
async function beat(name: string): Promise<void> {
  await window.screenshot({ path: `e2e-ui/__screens__/${name}.png` })
  await window.waitForTimeout(700)
}

test('Phases 1–5: create → import media → import audio → captions → preset', async () => {
  // ── Phase 1: project management ──────────────────────────────────────────
  // The header "New Project" button is always present (an empty-state copy also
  // appears when there are no projects yet), so scope to the header.
  const newProjectBtn = window.locator('header').getByRole('button', { name: 'New Project' })
  await expect(newProjectBtn).toBeVisible()
  await beat('01-home')

  await newProjectBtn.click()
  await window.locator('#np-name').fill('E2E Demo')
  await window.getByRole('radio', { name: '9:16' }).click()
  await window.locator('#np-language').selectOption('en')
  await beat('02-new-project-dialog')

  await window.getByRole('button', { name: 'Create' }).click()

  // Home shows the new project card; open it in the editor.
  const openCard = window.locator('button[title="E2E Demo"]')
  await expect(openCard).toBeVisible()
  await beat('03-project-card')
  await openCard.click()

  // Editor shell is ready once the left rail renders. Rail buttons use exact
  // names so they don't collide with "Import media" / "Generate captions".
  await expect(window.getByRole('button', { name: 'Media', exact: true })).toBeVisible({
    timeout: 20_000
  })
  await beat('04-editor-open')

  // ── Phase 3: import media ────────────────────────────────────────────────
  await window.getByRole('button', { name: 'Media', exact: true }).click()
  await window.getByRole('button', { name: 'Import media' }).click()
  await expect(window.getByText('Imported 1 clip.')).toBeVisible({ timeout: 15_000 })
  await beat('05-media-imported')

  // ── Phase 4: import audio ────────────────────────────────────────────────
  await window.getByRole('button', { name: 'Audio', exact: true }).click()
  await window.getByRole('button', { name: 'Import audio' }).click()
  await expect(window.getByText('Imported audio clip.')).toBeVisible({ timeout: 15_000 })
  await beat('06-audio-imported')

  // ── Phase 2: auto-caption ────────────────────────────────────────────────
  await window.getByRole('button', { name: 'Captions', exact: true }).click()
  // Auto-caption now defaults to Lyrics-first (the studio's primary flow); select
  // Auto to exercise the STT path this spec injects a transcript for.
  await window.getByRole('radio', { name: 'Auto' }).click()
  await window.getByRole('button', { name: 'Generate captions' }).click()
  await expect(window.getByText('Captions generated.')).toBeVisible({ timeout: 30_000 })
  await beat('07-captions-generated')

  // ── Phase 5: apply a caption style preset (now a compact dropdown) ────────
  const presetSelect = window.getByRole('combobox', { name: 'Caption style preset' })
  await expect(presetSelect).toBeEnabled()
  await presetSelect.selectOption({ label: PRESET_NAME })
  await expect(presetSelect).toHaveValue('pop-by-word')
  await beat('08-preset-applied')
})

/**
 * Storage entry point — the ONLY storage module allowed to import electron.
 * Resolves the right provider per location and registers the storage IPC
 * channels using the same `handle()` wrapper as src/main/ipc.ts.
 */
import { delimiter, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { app, dialog, shell } from 'electron'
import type { StorageLocation, StorageProvider } from '../../shared/storage'
import { handle } from '../ipc'
import { appFontsDir } from '../export/fontsDir'
import { BUNDLED_FONT_FACES } from '../../shared/bundledFonts'
import { normalizeAudio } from '../ffmpeg/normalizeAudio'
import { probeMediaDuration } from '../ffmpeg/probeMediaDuration'
import { LocalProvider } from './LocalProvider'
import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from './media'
import { FONT_EXTENSIONS } from '../../shared/fontParse'
import {
  GraphOneDriveProvider,
  createSyncedOneDriveProvider,
  detectOneDrivePath
} from './OneDriveProvider'

/** Open-dialog filters for media import (P3.3): video + image extensions. */
const MEDIA_DIALOG_FILTERS: Electron.FileFilter[] = [
  { name: 'Media', extensions: [...VIDEO_EXTENSIONS, ...IMAGE_EXTENSIONS] },
  { name: 'Video', extensions: [...VIDEO_EXTENSIONS] },
  { name: 'Images', extensions: [...IMAGE_EXTENSIONS] }
]

/** Open-dialog filters for audio import (P4.1): MP3 + common audio extensions. */
const AUDIO_DIALOG_FILTERS: Electron.FileFilter[] = [
  { name: 'Audio', extensions: [...AUDIO_EXTENSIONS] }
]

/** Open-dialog filters for font import (P6.2): TrueType + OpenType. */
const FONT_DIALOG_FILTERS: Electron.FileFilter[] = [
  { name: 'Fonts', extensions: [...FONT_EXTENSIONS] }
]

/** Default local projects root under the user's Documents folder. */
export function defaultLocalRoot(): string {
  // E2E-only: an explicit projects root keeps a Playwright run isolated from the
  // user's real Documents/Caption Studio folder. Inert unless the flag is set.
  if (process.env.CAPTION_STUDIO_E2E === '1' && process.env.CAPTION_STUDIO_E2E_PROJECTS_ROOT) {
    return process.env.CAPTION_STUDIO_E2E_PROJECTS_ROOT
  }
  return join(app.getPath('documents'), 'Caption Studio')
}

/**
 * E2E-only file-picker override (Playwright headed UI runs). When
 * `CAPTION_STUDIO_E2E=1` and `envKey` (e.g. `CAPTION_STUDIO_E2E_MEDIA`) holds one
 * or more `path.delimiter`-separated absolute paths, the OS open-dialog is
 * bypassed and those paths are returned — so an automated run can "pick" staged
 * fixtures without driving a native dialog. Returns `null` (open the real dialog)
 * in production / when the flag or env var is absent. Inert unless the flag is set.
 */
function e2ePickOverride(envKey: string): string[] | null {
  if (process.env.CAPTION_STUDIO_E2E !== '1') return null
  const raw = process.env[envKey]
  if (raw === undefined || raw.length === 0) return null
  return raw.split(delimiter).filter((p) => p.length > 0)
}

/**
 * Resolve a provider for a location.
 * - local: filesystem LocalProvider at the default root.
 * - onedrive: synced-folder provider if a OneDrive folder is detected, else the
 *   Graph stub (so the call degrades to a not-implemented result).
 */
export function getProvider(location: StorageLocation): StorageProvider {
  if (location === 'local') {
    return new LocalProvider(defaultLocalRoot())
  }
  if (detectOneDrivePath() !== null) {
    return createSyncedOneDriveProvider()
  }
  return new GraphOneDriveProvider()
}

/** Register storage IPC handlers (mirrors registerIpcHandlers in src/main/ipc.ts). */
export function registerStorageIpc(): void {
  handle('storage:listProjects', (request) => getProvider(request.location).listProjects())

  handle('storage:createProject', (request) =>
    getProvider(request.location).createProject(request.name)
  )

  handle('storage:readProject', (request) =>
    getProvider(request.ref.location).readProject(request.ref)
  )

  handle('storage:writeProject', (request) =>
    getProvider(request.ref.location).writeProject(
      request.ref,
      request.project,
      request.expectedUpdatedAt
    )
  )

  handle('storage:resolvePath', (request) => ({
    path: getProvider(request.ref.location).resolvePath(request.ref)
  }))

  handle('storage:probeMediaDuration', async (request) => {
    const bundlePath = getProvider(request.ref.location).resolvePath(request.ref)
    const durationSec = await probeMediaDuration(bundlePath, request.mediaRef)
    return { durationSec }
  })

  handle('storage:duplicateProject', (request) =>
    getProvider(request.ref.location).duplicateProject(request.ref)
  )

  handle('storage:renameProject', (request) =>
    getProvider(request.ref.location).renameProject(request.ref, request.name)
  )

  handle('storage:deleteProject', async (request) => {
    await getProvider(request.ref.location).deleteProject(request.ref)
    return { deleted: true as const }
  })

  // Reveal is the only storage channel that touches electron: resolve the
  // bundle path via the provider, then open the OS file manager at it.
  handle('storage:revealProject', (request) => {
    const path = getProvider(request.ref.location).resolvePath(request.ref)
    shell.showItemInFolder(path)
    return { revealed: true }
  })

  // Media import (P3.3). pickMedia touches electron (dialog); importMedia
  // delegates the path-based copy to the provider — NO Buffers cross IPC.
  handle('storage:pickMedia', async () => {
    const override = e2ePickOverride('CAPTION_STUDIO_E2E_MEDIA')
    if (override !== null) return { paths: override }
    const result = await dialog.showOpenDialog({
      title: 'Import media',
      properties: ['openFile', 'multiSelections'],
      filters: MEDIA_DIALOG_FILTERS
    })
    return { paths: result.canceled ? [] : result.filePaths }
  })

  handle('storage:importMedia', (request) =>
    getProvider(request.ref.location).copyMedia(request.ref, request.sourcePath)
  )

  // Audio import (P4.1). pickAudio touches electron (dialog); importMedia is
  // reused for the path-based copy (it classifies MP3 → kind 'audio').
  handle('storage:pickAudio', async () => {
    const override = e2ePickOverride('CAPTION_STUDIO_E2E_AUDIO')
    if (override !== null) return { paths: override }
    const result = await dialog.showOpenDialog({
      title: 'Import audio',
      properties: ['openFile', 'multiSelections'],
      filters: AUDIO_DIALOG_FILTERS
    })
    return { paths: result.canceled ? [] : result.filePaths }
  })

  // Export save-path picker. Opens the OS save dialog so the user can choose
  // where the finished video file will be written (P12.5).
  handle('storage:pickSavePath', async (request) => {
    // E2E-only: return a staged path instead of driving a native save dialog
    // (mirrors e2ePickOverride; inert unless CAPTION_STUDIO_E2E=1). Lets the
    // headed export UI test run unattended.
    if (process.env.CAPTION_STUDIO_E2E === '1') {
      const staged = process.env.CAPTION_STUDIO_E2E_SAVE_PATH
      if (staged !== undefined && staged.length > 0) return { path: staged }
    }
    const extMap: Record<string, string> = { mp4: 'mp4', mov: 'mov', webm: 'webm' }
    const ext = extMap[request.format] ?? request.format
    const result = await dialog.showSaveDialog({
      title: 'Export video — choose save location',
      defaultPath: request.defaultName,
      filters: [
        { name: 'Video', extensions: [ext] },
        { name: 'All files', extensions: ['*'] }
      ],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    return { path: result.canceled || result.filePath === undefined ? null : result.filePath }
  })

  // Font import (P6.2). pickFont touches electron (dialog); importFont delegates
  // the path-based atomic copy + parse to the provider — NO font bytes over IPC.
  handle('fonts:pickFont', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import font',
      properties: ['openFile', 'multiSelections'],
      filters: FONT_DIALOG_FILTERS
    })
    return { paths: result.canceled ? [] : result.filePaths }
  })

  // Read the app-bundled font faces so the renderer can register them as
  // FontFaces (canvas shaping for preview + overlay export). Missing files are
  // skipped so a partial fonts dir never breaks startup.
  handle('fonts:loadBundled', async () => {
    const dir = appFontsDir()
    const faces: Array<{ family: string; weight: string; style: string; data: Uint8Array }> = []
    for (const face of BUNDLED_FONT_FACES) {
      try {
        const data = await readFile(join(dir, face.file))
        faces.push({ family: face.family, weight: face.weight, style: face.style, data })
      } catch {
        // Font file absent (fonts not downloaded) → skip; renderer falls back.
      }
    }
    return { faces }
  })

  handle('fonts:import', (request) =>
    getProvider(request.ref.location).copyFont(request.ref, request.sourcePath)
  )

  // Normalize an imported audio file to 16 kHz mono WAV in cache/ for STT
  // (Doc 02). Resolve the bundle path via the provider, then run FFmpeg in main.
  handle('ffmpeg:normalizeAudio', async (request) => {
    const bundlePath = getProvider(request.ref.location).resolvePath(request.ref)
    const wavRef = await normalizeAudio(bundlePath, request.mediaRef)
    return { wavRef }
  })
}

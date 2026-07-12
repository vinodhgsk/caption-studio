/**
 * Export IPC handler registration (P12.1, Doc 13).
 *
 * Registers `export:start`, `export:cancel`, and `export:getResult` IPC
 * channels. Progress is pushed to the renderer via webContents.send on the
 * `export:progress` channel.
 *
 * Uses `BrowserWindow.getAllWindows()` at event-send time so the module works
 * regardless of whether the window exists at registration time.
 */

import { BrowserWindow, ipcMain } from 'electron'
import type { ExportJob } from '../../shared/export'
import type { ProjectRef } from '../../shared/storage'
import { runExportJob, exportResultCache, runningJobs } from './runner'
import { getProvider } from '../storage'
import { initCaptionFrames, writeCaptionFrames } from './captionFrames'

/** Broadcast a progress event to all open windows. */
function broadcastProgress(payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('export:progress', payload)
    }
  }
}

/**
 * Register all export-related IPC handlers. Call once from registerIpcHandlers.
 */
export function registerExportIpc(): void {
  // export:start — start an export job and return its jobId.
  ipcMain.handle('export:start', async (_event, job: ExportJob) => {
    try {
      const provider = getProvider(job.ref.location)
      const bundlePath = provider.resolvePath(job.ref)
      const project = await provider.readProject(job.ref)

      const { jobId, cancel } = runExportJob(
        job,
        bundlePath,
        project,
        (progress) => {
          broadcastProgress(progress)
        }
      )

      runningJobs.set(jobId, cancel)
      return { ok: true as const, data: { jobId } }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false as const, error: msg }
    }
  })

  // export:cancel — kill a running job.
  ipcMain.handle('export:cancel', (_event, req: { jobId: string }) => {
    try {
      const cancel = runningJobs.get(req.jobId)
      if (cancel !== undefined) {
        cancel()
        runningJobs.delete(req.jobId)
        return { ok: true as const, data: { cancelled: true } }
      }
      return { ok: true as const, data: { cancelled: false } }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false as const, error: msg }
    }
  })

  // export:captionFramesInit — prepare the overlay scratch dir (P13.x).
  ipcMain.handle(
    'export:captionFramesInit',
    async (_event, req: { ref: ProjectRef; overlayId: string }) => {
      try {
        const bundlePath = getProvider(req.ref.location).resolvePath(req.ref)
        const { dir, framesPattern } = await initCaptionFrames(bundlePath, req.overlayId)
        return { ok: true as const, data: { dir, framesPattern } }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return { ok: false as const, error: msg }
      }
    }
  )

  // export:captionFramesWrite — persist a batch of overlay PNG frames (P13.x).
  ipcMain.handle(
    'export:captionFramesWrite',
    async (
      _event,
      req: { ref: ProjectRef; overlayId: string; startIndex: number; frames: Uint8Array[] }
    ) => {
      try {
        const bundlePath = getProvider(req.ref.location).resolvePath(req.ref)
        const written = await writeCaptionFrames(
          bundlePath,
          req.overlayId,
          req.startIndex,
          req.frames
        )
        return { ok: true as const, data: { written } }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return { ok: false as const, error: msg }
      }
    }
  )

  // export:getResult — retrieve the cached result for a completed job.
  ipcMain.handle('export:getResult', (_event, req: { jobId: string }) => {
    try {
      const result = exportResultCache.get(req.jobId)
      if (result === undefined) {
        return { ok: false as const, error: `No result found for job ${req.jobId}` }
      }
      return { ok: true as const, data: result }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false as const, error: msg }
    }
  })
}

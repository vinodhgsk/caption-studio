import { app, ipcMain } from 'electron'
import type {
  AppState,
  IpcChannel,
  IpcRequest,
  IpcResponse,
  IpcResult
} from '../shared/ipc'
import { registerStorageIpc } from './storage'
import { registerSttIpc } from './stt'
import { selectDefaultProvider } from './stt/registry'
import { registerTrackingIpc } from './tracking'
import { registerTtsIpc } from './tts'
import { registerTranslationIpc } from './translation'
import { registerTransliterationIpc } from './transliteration'
import { registerPresetIpc } from './storage/presetStore'
import { registerExportIpc } from './export'

/**
 * Register a typed handler. The handler returns the bare response; we wrap it
 * in `IpcResult` and convert thrown errors into `{ ok:false, error }` so nothing
 * raw crosses the IPC boundary.
 *
 * Exported so the error-wrapping contract can be unit-tested directly.
 */
export function handle<C extends IpcChannel>(
  channel: C,
  handler: (request: IpcRequest<C>) => Promise<IpcResponse<C>> | IpcResponse<C>
): void {
  ipcMain.handle(
    channel,
    async (_event, request: IpcRequest<C>): Promise<IpcResult<IpcResponse<C>>> => {
      try {
        return { ok: true, data: await handler(request) }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
}

export function registerIpcHandlers(): void {
  handle('app:getState', (): AppState => ({
    version: app.getVersion(),
    platform: process.platform,
    ready: true
  }))

  handle('app:ping', (request) => ({ pong: request.at }))

  registerStorageIpc()
  registerSttIpc()
  registerTrackingIpc()
  registerTtsIpc()
  registerTranslationIpc()
  registerTransliterationIpc()
  registerPresetIpc()
  registerExportIpc()
  // Pick whisper.cpp as the active STT provider when its binary + model are
  // present; otherwise fall back to the stub (CAPTION_STUDIO_STT_PROVIDER wins).
  selectDefaultProvider()
}

import { contextBridge, ipcRenderer } from 'electron'
import type { Api, IpcChannel, IpcRequest, IpcResponse, IpcResult } from '../shared/ipc'

/**
 * The ONLY bridge between renderer and main. Exposes a narrow, typed `api`
 * surface — raw `ipcRenderer` is never leaked to the renderer.
 */
const api = {
  invoke<C extends IpcChannel>(channel: C, request: IpcRequest<C>) {
    return ipcRenderer.invoke(channel, request) as Promise<IpcResult<IpcResponse<C>>>
  },
  on(channel: string, listener: (payload: unknown) => void) {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void =>
      listener(payload)
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  }
} satisfies Api

contextBridge.exposeInMainWorld('api', api)

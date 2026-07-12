---
name: electron-scaffold
description: Conventions for the Electron + React + TypeScript shell — main/preload/renderer split, context isolation, the typed IPC bridge, and the project boot sequence. Use whenever creating processes, IPC channels, or the app skeleton.
---
# electron-scaffold

## Process model
- **main**: privileged. Owns fs, FFmpeg, STT, TTS, tracking, OneDrive/Graph, project read/write.
- **preload**: the ONLY bridge. `contextBridge.exposeInMainWorld('api', ...)`. Narrow, typed surface.
- **renderer**: React UI only. `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.

## Typed IPC pattern
- Define channels in `src/shared/ipc.ts` as a discriminated union `{ channel, request, response }`.
- main: `ipcMain.handle(channel, handler)`. preload: `invoke<T>(channel, req)`. renderer: `window.api.invoke(...)`.
- Never expose `ipcRenderer` raw. One typed wrapper per domain (storage, ffmpeg, stt, tts).

## Boot sequence
1. main creates BrowserWindow, loads renderer.
2. renderer mounts React, requests app state over IPC.
3. All heavy work is an IPC request → main → progress events → renderer.

## Conventions
- TS strict. ESLint + Prettier. Path alias `@/` → `src/renderer`.
- Errors cross IPC as `{ ok:false, error }`; never throw raw across the boundary.

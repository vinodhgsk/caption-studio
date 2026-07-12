---
description: Add a typed IPC channel end-to-end (main handler + preload bridge + renderer wrapper).
mode: agent
tools: ['search', 'edit', 'runCommands']
---
Using the electron-scaffold skill, add a typed IPC channel "$1" in domain "$2": define request/response types in src/shared/ipc.ts, add ipcMain.handle in main, expose it via the preload bridge, and add a renderer wrapper. Errors return {ok:false,error}; never throw across the boundary. Add a small test.

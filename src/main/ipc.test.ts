import { beforeEach, describe, expect, it, vi } from 'vitest'

// `src/main/ipc.ts` imports from 'electron', which isn't a real module outside
// the Electron runtime. Mock it and capture every listener registered via
// `ipcMain.handle(channel, listener)` so we can drive the wrapper directly.
// `vi.hoisted` ensures `handlers` exists when the hoisted mock factory runs.
const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, request: unknown) => Promise<unknown>>()
}))

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0' },
  ipcMain: {
    handle: (channel: string, listener: (event: unknown, request: unknown) => Promise<unknown>) => {
      handlers.set(channel, listener)
    }
  }
}))

import { handle } from './ipc'

beforeEach(() => {
  handlers.clear()
})

describe('IPC handle() error wrapping', () => {
  it('converts a thrown Error into { ok:false, error } instead of rejecting', async () => {
    handle('app:ping', () => {
      throw new Error('boom')
    })

    const listener = handlers.get('app:ping')
    expect(listener).toBeDefined()

    // Must resolve to a result envelope — never reject with the raw error.
    const result = await listener!({}, { at: 1 })
    expect(result).toEqual({ ok: false, error: 'boom' })
  })

  it('stringifies a non-Error throw into { ok:false, error }', async () => {
    handle('app:ping', () => {
      throw 'plain string failure'
    })

    const result = await handlers.get('app:ping')!({}, { at: 1 })
    expect(result).toEqual({ ok: false, error: 'plain string failure' })
  })

  it('wraps a successful handler in { ok:true, data }', async () => {
    handle('app:ping', (request) => ({ pong: request.at }))

    const result = await handlers.get('app:ping')!({}, { at: 42 })
    expect(result).toEqual({ ok: true, data: { pong: 42 } })
  })
})

/**
 * IPC-wrapper contract test for the renderer `transcribe` store action (P4.4):
 * verifies it sends `stt:transcribe` with the open project's ref + the
 * bundle-relative wavRef (NO audio bytes), forwards an optional language pin,
 * unwraps the `{ ok, data|error }` envelope, and guards "no project open".
 *
 * The IPC bridge (`window.api`) is mocked; the project store's `currentRef` is
 * driven directly so the test is deterministic and offline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult } from '../../../shared/ipc'
import type { ProjectRef } from '../../../shared/storage'
import type { Transcript } from '../../../shared/stt'
import { useProjectStore } from '../projectStore'
import { useTimelineStore } from '../timelineStore'

const REF: ProjectRef = { location: 'local', id: 'p1', name: 'p1', path: '/tmp/p1.vproj' }

const invoke = vi.fn()

beforeEach(() => {
  invoke.mockReset()
  vi.stubGlobal('window', { api: { invoke } })
  useProjectStore.setState({ currentRef: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('timelineStore.transcribe (stt:transcribe IPC wrapper)', () => {
  it('errors when no project is open (and never touches IPC)', async () => {
    const result = await useTimelineStore.getState().transcribe('cache/voice.16k.mono.wav')
    expect(result).toEqual({ ok: false, error: 'No project is open.' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('invokes stt:transcribe with ref + wavRef and unwraps the transcript', async () => {
    useProjectStore.setState({ currentRef: REF })
    const transcript: Transcript = {
      language: 'ta',
      words: [{ text: 'வணக்கம்', start: 0, end: 0.4 }]
    }
    const ok: IpcResult<Transcript> = { ok: true, data: transcript }
    invoke.mockResolvedValue(ok)

    const result = await useTimelineStore.getState().transcribe('cache/voice.16k.mono.wav', 'ta')

    expect(invoke).toHaveBeenCalledWith('stt:transcribe', {
      ref: REF,
      wavRef: 'cache/voice.16k.mono.wav',
      language: 'ta'
    })
    expect(result).toEqual({ ok: true, transcript })
  })

  it('omits language for auto-detect when not pinned', async () => {
    useProjectStore.setState({ currentRef: REF })
    invoke.mockResolvedValue({ ok: true, data: { language: 'ta', words: [] } })

    await useTimelineStore.getState().transcribe('cache/x.wav')

    expect(invoke).toHaveBeenCalledWith('stt:transcribe', {
      ref: REF,
      wavRef: 'cache/x.wav',
      language: undefined
    })
  })

  it('passes only the wavRef string — no audio bytes in the payload', async () => {
    useProjectStore.setState({ currentRef: REF })
    invoke.mockResolvedValue({ ok: true, data: { language: 'ta', words: [] } })

    await useTimelineStore.getState().transcribe('cache/x.wav')

    const [, payload] = invoke.mock.calls[0] as [string, { wavRef: unknown }]
    expect(typeof payload.wavRef).toBe('string')
  })

  it('surfaces a main-side error envelope as { ok:false, error }', async () => {
    useProjectStore.setState({ currentRef: REF })
    invoke.mockResolvedValue({ ok: false, error: 'whisper not found' })

    const result = await useTimelineStore.getState().transcribe('cache/x.wav')
    expect(result).toEqual({ ok: false, error: 'whisper not found' })
  })

  it('catches a thrown bridge error', async () => {
    useProjectStore.setState({ currentRef: REF })
    invoke.mockRejectedValue(new Error('bridge down'))

    const result = await useTimelineStore.getState().transcribe('cache/x.wav')
    expect(result).toEqual({ ok: false, error: 'bridge down' })
  })
})

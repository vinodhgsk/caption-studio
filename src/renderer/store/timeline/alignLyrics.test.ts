import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcResult } from '../../../shared/ipc'
import type { ProjectRef } from '../../../shared/storage'
import type { LyricsAlignmentResult } from '../../../shared/lyricsFirst'
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

describe('timelineStore.alignLyrics (stt:alignLyrics IPC wrapper)', () => {
  it('errors when no project is open', async () => {
    const result = await useTimelineStore.getState().alignLyrics('cache/x.wav', 'hello world')
    expect(result).toEqual({ ok: false, error: 'No project is open.' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('invokes stt:alignLyrics and unwraps aligned lines', async () => {
    useProjectStore.setState({ currentRef: REF })
    const alignment: LyricsAlignmentResult = {
      language: 'en',
      lines: [
        {
          index: 0,
          text: 'hello world',
          start: 0.5,
          end: 1.2,
          confidence: 0.9,
          words: [
            { text: 'hello', start: 0.5, end: 0.8, confidence: 0.9 },
            { text: 'world', start: 0.8, end: 1.2, confidence: 0.9 }
          ]
        }
      ]
    }
    const ok: IpcResult<LyricsAlignmentResult> = { ok: true, data: alignment }
    invoke.mockResolvedValue(ok)

    const result = await useTimelineStore
      .getState()
      .alignLyrics('cache/x.wav', 'hello world', 'en')

    expect(invoke).toHaveBeenCalledWith('stt:alignLyrics', {
      ref: REF,
      wavRef: 'cache/x.wav',
      lyrics: 'hello world',
      language: 'en'
    })
    expect(result).toEqual({ ok: true, alignment })
  })

  it('surfaces main-side errors', async () => {
    useProjectStore.setState({ currentRef: REF })
    invoke.mockResolvedValue({ ok: false, error: 'alignment failed' })

    const result = await useTimelineStore.getState().alignLyrics('cache/x.wav', 'text')
    expect(result).toEqual({ ok: false, error: 'alignment failed' })
  })
})

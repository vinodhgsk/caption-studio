// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CAPTION_TRACK_ID } from '../../store/timeline/captionTrack'
import type { Project, ProjectRef } from '../../../shared/storage'

// Mock the preview draw path — we test the ORCHESTRATION (frame loop, batching,
// IPC payloads, return value), not the pixel rendering (drawTextClips runs in the
// live preview every frame and has its own tests). `vi.hoisted` lets the factory
// (hoisted above imports) reference the spy safely.
const { drawTextClips } = vi.hoisted(() => ({ drawTextClips: vi.fn() }))
vi.mock('./preview/PreviewCanvas', () => ({ drawTextClips }))

import { renderCaptionOverlay } from './captionOverlay'

const REF: ProjectRef = { location: 'local', name: 'P', id: 'p1' } as unknown as ProjectRef

function projectWithCaptions(clips: { start: number; dur: number }[]): Project {
  return {
    version: 1,
    id: 'p1',
    name: 'P',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    settings: {
      fps: 30,
      resolution: [1080, 1920],
      aspect: '9:16',
      background: '#000000',
      language: 'ta',
      languages: ['ta']
    },
    storage: { location: 'local', root: '/tmp/p' },
    tracks: [
      {
        id: CAPTION_TRACK_ID,
        type: 'text',
        clips: clips.map((c, i) => ({
          id: `cap-${i}`,
          mediaRef: '',
          in: 0,
          out: c.dur,
          start: c.start,
          transform: {
            x: 0, y: 600, scale: 1, rotation: 0, flipH: false, flipV: false, opacity: 1, z: 0
          },
          text: { lines: ['வணக்கம்'], align: 'center' },
          caption: { words: [] }
        }))
      }
    ]
  } as unknown as Project
}

let invoke: ReturnType<typeof vi.fn>

beforeEach(() => {
  drawTextClips.mockClear()

  // Fake canvas → fake 2D ctx; toBlob returns a tiny fake PNG blob.
  const fakeCtx = { clearRect: vi.fn() }
  const fakeCanvas = {
    width: 0,
    height: 0,
    getContext: () => fakeCtx,
    toBlob: (cb: (b: unknown) => void) =>
      cb({ arrayBuffer: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer })
  }
  vi.spyOn(document, 'createElement').mockReturnValue(fakeCanvas as never)

  invoke = vi.fn(async (channel: string) => {
    if (channel === 'export:captionFramesInit') {
      return { ok: true, data: { dir: '/tmp/p/cache/x-cap', framesPattern: '/tmp/p/cache/x-cap/frame_%06d.png' } }
    }
    if (channel === 'export:captionFramesWrite') return { ok: true, data: { written: 0 } }
    return { ok: true, data: {} }
  })
  ;(window as unknown as { api: unknown }).api = { invoke, on: vi.fn() }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('renderCaptionOverlay', () => {
  it('returns null (and renders nothing) when there is no caption track', async () => {
    const p = projectWithCaptions([])
    p.tracks = []
    const out = await renderCaptionOverlay(p, REF, 30)
    expect(out).toBeNull()
    expect(drawTextClips).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('renders one frame per output frame across the caption span', async () => {
    // Single clip [0, 1.0) at 10 fps → 10 frames.
    const out = await renderCaptionOverlay(projectWithCaptions([{ start: 0, dur: 1.0 }]), REF, 10)
    expect(out).not.toBeNull()
    expect(drawTextClips).toHaveBeenCalledTimes(10)
    // Rendered at the PROJECT canvas size.
    const call = drawTextClips.mock.calls[0]
    expect(call[1]).toBe(1080) // width
    expect(call[2]).toBe(1920) // height
    // Only the caption track's clip is passed (items arg).
    expect(Array.isArray(call[3])).toBe(true)
    expect(out).toMatchObject({
      framesPattern: '/tmp/p/cache/x-cap/frame_%06d.png',
      framesDir: '/tmp/p/cache/x-cap',
      fps: 10,
      startSec: 0
    })
  })

  it('writes frames in batches with a correct running startIndex', async () => {
    // 60 frames @ 24 batch → batches at startIndex 0, 24, 48.
    await renderCaptionOverlay(projectWithCaptions([{ start: 0, dur: 2.0 }]), REF, 30)
    const writes = invoke.mock.calls.filter((c) => c[0] === 'export:captionFramesWrite')
    const starts = writes.map((c) => (c[1] as { startIndex: number }).startIndex)
    expect(starts).toEqual([0, 24, 48])
    const totalFrames = writes.reduce(
      (n, c) => n + (c[1] as { frames: unknown[] }).frames.length,
      0
    )
    expect(totalFrames).toBe(60) // ceil(2.0*30) - floor(0) = 60
  })
})

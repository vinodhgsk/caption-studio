import { describe, expect, it } from 'vitest'
import type { ProjectTrack } from '../../../shared/storage'
import type { ImportMediaResult } from '../../../shared/storage'
import {
  DEFAULT_IMPORT_DURATION_SEC,
  buildImportedClip,
  trackEndSeconds
} from './mediaImport'

const videoResult: ImportMediaResult = {
  mediaRef: 'media/clip.mp4',
  fileName: 'clip.mp4',
  kind: 'video'
}

describe('buildImportedClip', () => {
  it('builds a clip with caller-supplied id/start, in=0, default out, neutral transform', () => {
    const clip = buildImportedClip(videoResult, { id: 'c1', start: 3 })
    expect(clip.id).toBe('c1')
    expect(clip.mediaRef).toBe('media/clip.mp4')
    expect(clip.in).toBe(0)
    expect(clip.out).toBe(DEFAULT_IMPORT_DURATION_SEC)
    expect(clip.start).toBe(3)
    expect(clip.transform).toEqual({
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      flipH: false,
      flipV: false,
      opacity: 1,
      z: 0
    })
  })

  it('honors an explicit durationSec override', () => {
    const clip = buildImportedClip(videoResult, { id: 'c1', start: 0, durationSec: 12 })
    expect(clip.out).toBe(12)
  })
})

describe('trackEndSeconds', () => {
  it('returns 0 for an empty track', () => {
    const track: ProjectTrack = { id: 't', type: 'video', clips: [] }
    expect(trackEndSeconds(track)).toBe(0)
  })

  it('returns the max clip end (start + length)', () => {
    const track: ProjectTrack = {
      id: 't',
      type: 'video',
      clips: [
        { id: 'a', mediaRef: 'media/a.mp4', in: 0, out: 4, start: 0, transform: stubTransform() },
        { id: 'b', mediaRef: 'media/b.mp4', in: 0, out: 3, start: 4, transform: stubTransform() }
      ]
    }
    expect(trackEndSeconds(track)).toBe(7)
  })
})

function stubTransform(): ProjectTrack['clips'][number]['transform'] {
  return { x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false, opacity: 1, z: 0 }
}

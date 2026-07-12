import { describe, expect, it } from 'vitest'
import type { ImportMediaResult } from '../../../shared/storage'
import { defaultClipAudio } from '../../../shared/project-schema'
import { DEFAULT_AUDIO_DURATION_SEC, buildAudioClip } from './audioImport'

const audioResult: ImportMediaResult = {
  mediaRef: 'media/voice.mp3',
  fileName: 'voice.mp3',
  kind: 'audio'
}

describe('buildAudioClip', () => {
  it('builds an audio clip with caller id/start, in=0, default out, neutral mix', () => {
    const clip = buildAudioClip(audioResult, { id: 'a1', start: 2 })
    expect(clip.id).toBe('a1')
    expect(clip.mediaRef).toBe('media/voice.mp3')
    expect(clip.in).toBe(0)
    expect(clip.out).toBe(DEFAULT_AUDIO_DURATION_SEC)
    expect(clip.start).toBe(2)
    expect(clip.audio).toEqual({ gain: 1, fadeInSec: 0, fadeOutSec: 0, muted: false })
  })

  it('honors an explicit durationSec override', () => {
    const clip = buildAudioClip(audioResult, { id: 'a1', start: 0, durationSec: 47 })
    expect(clip.out).toBe(47)
  })

  it('honors an explicit audio mix override', () => {
    const mix = { ...defaultClipAudio(), gain: 0.5, fadeInSec: 1.5, fadeOutSec: 2 }
    const clip = buildAudioClip(audioResult, { id: 'a1', start: 0, audio: mix })
    expect(clip.audio).toEqual(mix)
  })

  it('starts with a neutral transform', () => {
    const clip = buildAudioClip(audioResult, { id: 'a1', start: 0 })
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
})

import { describe, expect, it } from 'vitest'
import { defaultTransform, type Clip, type ClipAudio } from '../../../shared/project-schema'
import type { Project } from '../../../shared/storage'
import { audibleAudioClipsAt, effectivePreviewGain } from './usePreviewAudio'

function makeAudioClip(id: string, start: number, inSec: number, outSec: number): Clip {
  return {
    id,
    mediaRef: `media/${id}.wav`,
    in: inSec,
    out: outSec,
    start,
    transform: defaultTransform(),
    audio: {
      gain: 1,
      fadeInSec: 0,
      fadeOutSec: 0,
      muted: false
    }
  }
}

function makeProject(audioClips: Clip[], videoClips: Clip[] = []): Project {
  return {
    version: 1,
    id: 'p1',
    name: 'P',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    settings: {
      fps: 30,
      resolution: [1920, 1080],
      aspect: '16:9',
      background: '#000000',
      language: 'en',
      languages: ['en']
    },
    storage: { location: 'local', root: '/tmp' },
    tracks: [
      { id: 'a1', type: 'audio', clips: audioClips },
      { id: 'v1', type: 'video', clips: videoClips }
    ]
  }
}

describe('audibleAudioClipsAt', () => {
  it('returns only active clips from audio tracks at playhead time', () => {
    const a = makeAudioClip('a', 1, 0, 5) // active in [1,6)
    const b = makeAudioClip('b', 10, 0, 3) // inactive at t=2
    const v = makeAudioClip('v', 1, 0, 5)
    const project = makeProject([a, b], [v])

    const active = audibleAudioClipsAt(project, 2)

    expect(active.map((clip) => clip.id)).toEqual(['a'])
  })

  it('uses half-open visibility [start, end)', () => {
    const a = makeAudioClip('a', 4, 0, 2) // visible [4,6)
    const project = makeProject([a])

    expect(audibleAudioClipsAt(project, 4).map((clip) => clip.id)).toEqual(['a'])
    expect(audibleAudioClipsAt(project, 5.999).map((clip) => clip.id)).toEqual(['a'])
    expect(audibleAudioClipsAt(project, 6)).toEqual([])
  })
})

describe('effectivePreviewGain', () => {
  it('applies muted and base gain clamps', () => {
    const muted: ClipAudio = { gain: 1, fadeInSec: 0, fadeOutSec: 0, muted: true }
    expect(effectivePreviewGain(muted, 1, 5)).toBe(0)
    expect(effectivePreviewGain({ gain: 2, fadeInSec: 0, fadeOutSec: 0 }, 1, 5)).toBe(1)
    expect(effectivePreviewGain({ gain: -1, fadeInSec: 0, fadeOutSec: 0 }, 1, 5)).toBe(0)
  })

  it('applies fade-in and fade-out factors over clip-local source time', () => {
    const audio: ClipAudio = { gain: 1, fadeInSec: 2, fadeOutSec: 2, muted: false }
    // During fade-in: source=1s of 2s ramp => 0.5
    expect(effectivePreviewGain(audio, 1, 10)).toBeCloseTo(0.5)
    // Fully in-body: 4s with long remaining => 1
    expect(effectivePreviewGain(audio, 4, 10)).toBeCloseTo(1)
    // During fade-out: remaining=1s of 2s ramp => 0.5
    expect(effectivePreviewGain(audio, 9, 10)).toBeCloseTo(0.5)
  })
})

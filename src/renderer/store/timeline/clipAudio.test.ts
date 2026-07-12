import { describe, expect, it } from 'vitest'
import type { Project } from '../../../shared/storage'
import type { Clip } from '../../../shared/project-schema'
import { defaultClipAudio, defaultTransform } from '../../../shared/project-schema'
import { setClipAudio } from './reducers'
import { setClipAudioCommand } from './commands'

function makeAudioClip(id: string, overrides: Partial<Clip> = {}): Clip {
  return {
    id,
    mediaRef: `media/${id}.mp3`,
    in: 0,
    out: 30,
    start: 0,
    transform: defaultTransform(),
    audio: defaultClipAudio(),
    ...overrides
  }
}

function makeProject(clips: Clip[]): Project {
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
      language: 'ta',
      languages: ['ta']
    },
    storage: { location: 'local', root: '/tmp' },
    tracks: [{ id: 'atk', type: 'audio', clips }]
  }
}

describe('setClipAudio reducer', () => {
  it('shallow-merges a partial audio patch, keeping unspecified keys', () => {
    const p0 = makeProject([makeAudioClip('a1')])
    const next = setClipAudio(p0, 'a1', { gain: 0.5 })
    expect(next.tracks[0].clips[0].audio).toEqual({
      gain: 0.5,
      fadeInSec: 0,
      fadeOutSec: 0,
      muted: false
    })
  })

  it('sets fade-in and fade-out independently', () => {
    const p0 = makeProject([makeAudioClip('a1')])
    const next = setClipAudio(setClipAudio(p0, 'a1', { fadeInSec: 1.5 }), 'a1', { fadeOutSec: 2 })
    expect(next.tracks[0].clips[0].audio).toMatchObject({ fadeInSec: 1.5, fadeOutSec: 2 })
  })

  it('seeds a neutral mix when the clip has no audio yet', () => {
    const p0 = makeProject([makeAudioClip('a1', { audio: undefined })])
    const next = setClipAudio(p0, 'a1', { gain: 2 })
    expect(next.tracks[0].clips[0].audio).toEqual({
      gain: 2,
      fadeInSec: 0,
      fadeOutSec: 0,
      muted: false
    })
  })

  it('is immutable and a no-op for an absent clip', () => {
    const p0 = makeProject([makeAudioClip('a1')])
    expect(setClipAudio(p0, 'nope', { gain: 0.1 })).toBe(p0)
    setClipAudio(p0, 'a1', { gain: 0.1 })
    expect(p0.tracks[0].clips[0].audio?.gain).toBe(1) // original untouched
  })
})

describe('setClipAudioCommand (undo round-trip)', () => {
  it('apply then invert restores the original project exactly (full mix)', () => {
    const p0 = makeProject([
      makeAudioClip('a1', { audio: { gain: 0.8, fadeInSec: 1, fadeOutSec: 0, muted: false } })
    ])
    const cmd = setClipAudioCommand(p0, 'a1', { gain: 1.5, fadeOutSec: 2 })
    expect(cmd.invert(cmd.apply(p0))).toEqual(p0)
  })

  it('captures and restores exactly the patched keys prior values', () => {
    const p0 = makeProject([makeAudioClip('a1')]) // neutral defaultClipAudio mix
    const cmd = setClipAudioCommand(p0, 'a1', { muted: true, gain: 0.25 })
    const applied = cmd.apply(p0)
    expect(applied.tracks[0].clips[0].audio).toMatchObject({ muted: true, gain: 0.25 })
    const reverted = cmd.invert(applied)
    expect(reverted.tracks[0].clips[0].audio).toMatchObject({ muted: false, gain: 1 })
  })
})

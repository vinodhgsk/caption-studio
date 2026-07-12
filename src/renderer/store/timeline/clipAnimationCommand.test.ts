import { describe, expect, it } from 'vitest'
import type { Project } from '../../../shared/storage'
import type { Clip } from '../../../shared/project-schema'
import { defaultTransform } from '../../../shared/project-schema'
import { setClipAnimation } from './reducers'
import { setClipAnimationCommand } from './commands'

function makeTextClip(id: string, overrides: Partial<Clip> = {}): Clip {
  return {
    id,
    mediaRef: '',
    in: 0,
    out: 4,
    start: 0,
    transform: defaultTransform(),
    text: { lines: ['Hello world'] },
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
    tracks: [{ id: 'tk', type: 'text', clips }]
  }
}

describe('setClipAnimation reducer', () => {
  it('seeds an animation object and writes one lane', () => {
    const p0 = makeProject([makeTextClip('c1')])
    const next = setClipAnimation(p0, 'c1', { in: { preset: 'fade', durationSec: 0.6, easing: 'easeOut' } })
    expect(next.tracks[0].clips[0].animation).toEqual({
      in: { preset: 'fade', durationSec: 0.6, easing: 'easeOut' }
    })
  })

  it('merges a second lane without disturbing the first (preserves other lanes)', () => {
    const p0 = makeProject([
      makeTextClip('c1', { animation: { in: { preset: 'fade', durationSec: 0.6, easing: 'easeOut' } } })
    ])
    const next = setClipAnimation(p0, 'c1', { loop: { preset: 'pulse', durationSec: 1.8, speed: 1, easing: 'linear' } })
    expect(next.tracks[0].clips[0].animation).toEqual({
      in: { preset: 'fade', durationSec: 0.6, easing: 'easeOut' },
      loop: { preset: 'pulse', durationSec: 1.8, speed: 1, easing: 'linear' }
    })
  })

  it('replaces a patched lane wholesale (set this lane)', () => {
    const p0 = makeProject([
      makeTextClip('c1', { animation: { in: { preset: 'fade', durationSec: 0.6, easing: 'easeOut' } } })
    ])
    const next = setClipAnimation(p0, 'c1', { in: { preset: 'zoom', durationSec: 0.3, easing: 'linear' } })
    expect(next.tracks[0].clips[0].animation?.in).toEqual({ preset: 'zoom', durationSec: 0.3, easing: 'linear' })
  })

  it('is immutable and a no-op for an absent clip', () => {
    const p0 = makeProject([makeTextClip('c1')])
    expect(setClipAnimation(p0, 'nope', { in: { preset: 'fade' } })).toBe(p0)
    setClipAnimation(p0, 'c1', { in: { preset: 'fade' } })
    expect(p0.tracks[0].clips[0].animation).toBeUndefined() // original untouched
  })
})

describe('setClipAnimationCommand (undo round-trip)', () => {
  it('apply then invert restores the original project exactly (lane added from none)', () => {
    const p0 = makeProject([makeTextClip('c1')])
    const cmd = setClipAnimationCommand(p0, 'c1', {
      in: { preset: 'slide-left', durationSec: 0.5, easing: 'easeOut', stagger: { unit: 'character', delaySec: 0.04 } }
    })
    expect(cmd.invert(cmd.apply(p0))).toEqual(p0)
  })

  it('apply then invert restores the prior lane value exactly (lane changed)', () => {
    const p0 = makeProject([
      makeTextClip('c1', { animation: { out: { preset: 'fade', durationSec: 0.6, easing: 'easeIn' } } })
    ])
    const cmd = setClipAnimationCommand(p0, 'c1', { out: { preset: 'shrink', durationSec: 0.2, easing: 'linear' } })
    const applied = cmd.apply(p0)
    expect(applied.tracks[0].clips[0].animation?.out).toMatchObject({ preset: 'shrink' })
    expect(cmd.invert(applied)).toEqual(p0)
  })

  it('inverts a newly-added lane back to undefined (removes the lane on undo)', () => {
    const p0 = makeProject([makeTextClip('c1')])
    const cmd = setClipAnimationCommand(p0, 'c1', { loop: { preset: 'wave', durationSec: 1.6, speed: 1, easing: 'linear' } })
    const reverted = cmd.invert(cmd.apply(p0))
    expect(reverted.tracks[0].clips[0].animation?.loop).toBeUndefined()
  })
})

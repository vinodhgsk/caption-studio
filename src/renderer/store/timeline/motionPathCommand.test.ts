/**
 * P8.8 — motion-path REDUCER + COMMAND tests (Doc 11).
 *
 * Proves `setClipMotionPath` persists / clears `clip.motionPath` immutably and the
 * undoable `setClipMotionPathCommand` round-trips: drawing a first path undoes back
 * to ABSENCE, replacing a path undoes to the prior path, and clearing undoes back to
 * the drawn path. Mirrors the keyframe/animation command conventions.
 */
import { describe, expect, it } from 'vitest'
import type { Project } from '../../../shared/storage'
import type { Clip, ClipMotionPath } from '../../../shared/project-schema'
import { defaultTransform } from '../../../shared/project-schema'
import { setClipMotionPath } from './reducers'
import { setClipMotionPathCommand } from './commands'

function makeClip(id: string, overrides: Partial<Clip> = {}): Clip {
  return {
    id,
    mediaRef: 'media/clip.mp4',
    in: 0,
    out: 4,
    start: 0,
    transform: defaultTransform(),
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
    tracks: [{ id: 'tk', type: 'video', clips }]
  }
}

const samplePath: ClipMotionPath = {
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 50 }
  ],
  ease: 'easeInOut'
}

describe('setClipMotionPath reducer', () => {
  it('writes the motion path onto the clip immutably', () => {
    const p0 = makeProject([makeClip('c1')])
    const p1 = setClipMotionPath(p0, 'c1', samplePath)
    expect(p1).not.toBe(p0)
    expect(p1.tracks[0].clips[0].motionPath).toEqual(samplePath)
    // Original untouched.
    expect(p0.tracks[0].clips[0].motionPath).toBeUndefined()
  })

  it('clears the path (drops the key) on undefined / empty points', () => {
    const p0 = makeProject([makeClip('c1', { motionPath: samplePath })])
    const cleared = setClipMotionPath(p0, 'c1', undefined)
    expect('motionPath' in cleared.tracks[0].clips[0]).toBe(false)
    const emptied = setClipMotionPath(p0, 'c1', { points: [] })
    expect('motionPath' in emptied.tracks[0].clips[0]).toBe(false)
  })

  it('no-op for an absent clip', () => {
    const p0 = makeProject([makeClip('c1')])
    expect(setClipMotionPath(p0, 'nope', samplePath)).toBe(p0)
  })
})

describe('setClipMotionPathCommand (undo round-trip)', () => {
  it('drawing a first path undoes back to absence', () => {
    const p0 = makeProject([makeClip('c1')])
    const cmd = setClipMotionPathCommand(p0, 'c1', samplePath)
    const applied = cmd.apply(p0)
    expect(applied.tracks[0].clips[0].motionPath).toEqual(samplePath)
    const inverted = cmd.invert(applied)
    expect(inverted.tracks[0].clips[0].motionPath).toBeUndefined()
  })

  it('replacing a path undoes to the prior path', () => {
    const prior: ClipMotionPath = { points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }
    const p0 = makeProject([makeClip('c1', { motionPath: prior })])
    const cmd = setClipMotionPathCommand(p0, 'c1', samplePath)
    const applied = cmd.apply(p0)
    expect(applied.tracks[0].clips[0].motionPath).toEqual(samplePath)
    expect(cmd.invert(applied).tracks[0].clips[0].motionPath).toEqual(prior)
  })

  it('clearing a path undoes back to the drawn path', () => {
    const p0 = makeProject([makeClip('c1', { motionPath: samplePath })])
    const cmd = setClipMotionPathCommand(p0, 'c1', undefined)
    const applied = cmd.apply(p0)
    expect('motionPath' in applied.tracks[0].clips[0]).toBe(false)
    expect(cmd.invert(applied).tracks[0].clips[0].motionPath).toEqual(samplePath)
  })
})

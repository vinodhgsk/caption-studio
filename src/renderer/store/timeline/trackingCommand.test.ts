/**
 * P8.9 — clip-tracking REDUCER + COMMAND tests (Doc 11).
 *
 * Proves `setClipTracking` persists / clears `clip.tracking` immutably (the
 * `targetBox` + per-frame `path` shape the P8.10 compositor samples) and the undoable
 * `setClipTrackingCommand` round-trips: a first track undoes back to ABSENCE, a manual
 * correction (re-track) undoes to the prior attachment, and clearing undoes back to
 * the tracked attachment. Mirrors the motion-path command conventions.
 */
import { describe, expect, it } from 'vitest'
import type { Project } from '../../../shared/storage'
import type { Clip, ClipTracking } from '../../../shared/project-schema'
import { defaultTransform } from '../../../shared/project-schema'
import { setClipTracking } from './reducers'
import { setClipTrackingCommand } from './commands'

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

const sampleTracking: ClipTracking = {
  enabled: true,
  target: 'face',
  targetBox: { x: 200, y: 100, width: 80, height: 40, kind: 'face' },
  fps: 30,
  path: [
    { t: 0, x: 200, y: 100, scale: 1, rotation: 0, confidence: 0.9 },
    { t: 1, x: 210, y: 100, scale: 1, rotation: 0, confidence: 0.9 }
  ]
}

describe('setClipTracking reducer', () => {
  it('writes the tracking attachment onto the clip immutably', () => {
    const p0 = makeProject([makeClip('c1')])
    const p1 = setClipTracking(p0, 'c1', sampleTracking)
    expect(p1).not.toBe(p0)
    expect(p1.tracks[0].clips[0].tracking).toEqual(sampleTracking)
    expect(p0.tracks[0].clips[0].tracking).toBeUndefined()
  })

  it('persists the targetBox + per-frame path shape the compositor samples', () => {
    const p1 = setClipTracking(makeProject([makeClip('c1')]), 'c1', sampleTracking)
    const tracking = p1.tracks[0].clips[0].tracking
    expect(tracking?.targetBox).toEqual({ x: 200, y: 100, width: 80, height: 40, kind: 'face' })
    expect(tracking?.path?.[0]).toMatchObject({ t: 0, x: 200, y: 100 })
    expect(tracking?.fps).toBe(30)
  })

  it('clears the tracking (drops the key) on undefined', () => {
    const p0 = makeProject([makeClip('c1', { tracking: sampleTracking })])
    const cleared = setClipTracking(p0, 'c1', undefined)
    expect('tracking' in cleared.tracks[0].clips[0]).toBe(false)
  })

  it('no-op for an absent clip', () => {
    const p0 = makeProject([makeClip('c1')])
    expect(setClipTracking(p0, 'nope', sampleTracking)).toBe(p0)
  })
})

describe('setClipTrackingCommand (undo round-trip)', () => {
  it('a first track undoes back to absence', () => {
    const p0 = makeProject([makeClip('c1')])
    const cmd = setClipTrackingCommand(p0, 'c1', sampleTracking)
    const applied = cmd.apply(p0)
    expect(applied.tracks[0].clips[0].tracking).toEqual(sampleTracking)
    expect(cmd.invert(applied).tracks[0].clips[0].tracking).toBeUndefined()
  })

  it('a manual correction (re-track) undoes to the prior attachment', () => {
    const prior: ClipTracking = {
      enabled: true,
      target: 'object',
      targetBox: { x: 10, y: 10, width: 20, height: 20, kind: 'object' },
      fps: 30,
      path: [{ t: 0, x: 10, y: 10 }]
    }
    const p0 = makeProject([makeClip('c1', { tracking: prior })])
    const cmd = setClipTrackingCommand(p0, 'c1', sampleTracking)
    const applied = cmd.apply(p0)
    expect(applied.tracks[0].clips[0].tracking).toEqual(sampleTracking)
    expect(cmd.invert(applied).tracks[0].clips[0].tracking).toEqual(prior)
  })

  it('clearing undoes back to the tracked attachment', () => {
    const p0 = makeProject([makeClip('c1', { tracking: sampleTracking })])
    const cmd = setClipTrackingCommand(p0, 'c1', undefined)
    const applied = cmd.apply(p0)
    expect('tracking' in applied.tracks[0].clips[0]).toBe(false)
    expect(cmd.invert(applied).tracks[0].clips[0].tracking).toEqual(sampleTracking)
  })
})

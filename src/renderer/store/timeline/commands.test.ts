import { describe, expect, it } from 'vitest'
import type { Project } from '../../../shared/storage'
import type { Clip } from '../../../shared/project-schema'
import { defaultTransform } from '../../../shared/project-schema'
import {
  addClipCommand,
  addKeyframeCommand,
  addTrackCommand,
  deleteKeyframeCommand,
  moveClipCommand,
  moveClipToTrackCommand,
  moveClipToNewTrackCommand,
  moveKeyframeCommand,
  removeClipCommand,
  removeTrackCommand,
  rippleDeleteCommand,
  rippleInsertCommand,
  setClipTransformCommand,
  setKeyframeEasingCommand,
  splitClipCommand,
  trimClipCommand
} from './commands'
import { addKeyframe, getLane } from './keyframes'

function makeClip(id: string, overrides: Partial<Clip> = {}): Clip {
  return {
    id,
    mediaRef: `media/${id}.mp4`,
    in: 0,
    out: 5,
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
    tracks: [{ id: 'tk1', type: 'video', clips }]
  }
}

describe('command factories round-trip (apply then invert == original)', () => {
  it('addClipCommand', () => {
    const p0 = makeProject([])
    const cmd = addClipCommand('tk1', makeClip('c1'))
    expect(cmd.invert(cmd.apply(p0))).toEqual(p0)
  })

  it('removeClipCommand', () => {
    const p0 = makeProject([makeClip('c1'), makeClip('c2')])
    const cmd = removeClipCommand(p0, 'c1')
    expect(cmd.invert(cmd.apply(p0))).toEqual(p0)
  })

  it('moveClipCommand', () => {
    const p0 = makeProject([makeClip('c1', { start: 1 })])
    const cmd = moveClipCommand(p0, 'c1', 7)
    const applied = cmd.apply(p0)
    expect(applied.tracks[0].clips[0].start).toBe(7)
    expect(cmd.invert(applied)).toEqual(p0)
  })

  it("trimClipCommand 'start' round-trips via captured prior bounds", () => {
    const p0 = makeProject([makeClip('c1', { in: 1, out: 5, start: 2 })])
    const cmd = trimClipCommand(p0, 'c1', 'start', 1)
    expect(cmd.invert(cmd.apply(p0))).toEqual(p0)
  })

  it("trimClipCommand 'end' round-trips via captured prior bounds", () => {
    const p0 = makeProject([makeClip('c1', { in: 1, out: 5, start: 2 })])
    const cmd = trimClipCommand(p0, 'c1', 'end', -2)
    expect(cmd.invert(cmd.apply(p0))).toEqual(p0)
  })

  it('trimClipCommand invert restores clamped trims (delta > available range)', () => {
    // Over-trim the left edge well past out - MIN_CLIP_SEC; apply clamps, invert
    // must still restore the exact prior in/out/start (not just -delta).
    const p0 = makeProject([makeClip('c1', { in: 1, out: 5, start: 2 })])
    const cmd = trimClipCommand(p0, 'c1', 'start', 100)
    const applied = cmd.apply(p0)
    expect(applied.tracks[0].clips[0].in).not.toBe(101)
    expect(cmd.invert(applied)).toEqual(p0)
  })

  it('splitClipCommand merges back on invert', () => {
    const p0 = makeProject([makeClip('c1', { in: 0, out: 10, start: 2 })])
    const cmd = splitClipCommand(p0, 'c1', 5, 'c1b')
    const applied = cmd.apply(p0)
    expect(applied.tracks[0].clips).toHaveLength(2)
    expect(cmd.invert(applied)).toEqual(p0)
  })

  it('rippleDeleteCommand', () => {
    const p0 = makeProject([
      makeClip('a', { in: 0, out: 4, start: 0 }),
      makeClip('b', { in: 0, out: 3, start: 4 })
    ])
    const cmd = rippleDeleteCommand(p0, 'a')
    expect(cmd.invert(cmd.apply(p0))).toEqual(p0)
  })

  it('rippleInsertCommand', () => {
    const p0 = makeProject([
      makeClip('a', { in: 0, out: 4, start: 0 }),
      makeClip('b', { in: 0, out: 3, start: 4 })
    ])
    const cmd = rippleInsertCommand(p0, 'tk1', makeClip('ins', { in: 0, out: 2, start: 4 }))
    expect(cmd.invert(cmd.apply(p0))).toEqual(p0)
  })

  it('setClipTransformCommand round-trips x/y (drag-to-move)', () => {
    const p0 = makeProject([makeClip('c1')])
    const cmd = setClipTransformCommand(p0, 'c1', { x: 120, y: -40 })
    const applied = cmd.apply(p0)
    expect(applied.tracks[0].clips[0].transform.x).toBe(120)
    expect(applied.tracks[0].clips[0].transform.y).toBe(-40)
    expect(cmd.invert(applied)).toEqual(p0)
  })

  it('setClipTransformCommand invert restores ONLY the patched keys to their prior values', () => {
    const p0 = makeProject([makeClip('c1', { transform: { ...defaultTransform(), x: 10, scale: 2 } })])
    const cmd = setClipTransformCommand(p0, 'c1', { x: 999 })
    const applied = cmd.apply(p0)
    expect(applied.tracks[0].clips[0].transform.x).toBe(999)
    // scale (not patched) untouched.
    expect(applied.tracks[0].clips[0].transform.scale).toBe(2)
    const inverted = cmd.invert(applied)
    expect(inverted.tracks[0].clips[0].transform.x).toBe(10)
    expect(inverted).toEqual(p0)
  })

  it('setClipTransformCommand round-trips a multi-key patch (rotation/flip/z)', () => {
    const p0 = makeProject([makeClip('c1')])
    const cmd = setClipTransformCommand(p0, 'c1', { rotation: 45, flipH: true, z: 5 })
    expect(cmd.invert(cmd.apply(p0))).toEqual(p0)
  })

  it('setClipTransformCommand round-trips opacity + flipV (P3.12 property controls)', () => {
    const p0 = makeProject([
      makeClip('c1', { transform: { ...defaultTransform(), opacity: 1, flipV: false } })
    ])
    const cmd = setClipTransformCommand(p0, 'c1', { opacity: 0.35, flipV: true })
    const applied = cmd.apply(p0)
    expect(applied.tracks[0].clips[0].transform.opacity).toBe(0.35)
    expect(applied.tracks[0].clips[0].transform.flipV).toBe(true)
    expect(cmd.invert(applied)).toEqual(p0)
  })

  it('setClipTransformCommand round-trips a rotation-only patch (rotation handle)', () => {
    const p0 = makeProject([makeClip('c1', { transform: { ...defaultTransform(), rotation: 0 } })])
    const cmd = setClipTransformCommand(p0, 'c1', { rotation: 137 })
    const applied = cmd.apply(p0)
    expect(applied.tracks[0].clips[0].transform.rotation).toBe(137)
    expect(cmd.invert(applied)).toEqual(p0)
  })

  it('setClipTransformCommand is a no-op pair when the clip is absent', () => {
    const p0 = makeProject([makeClip('c1')])
    const cmd = setClipTransformCommand(p0, 'nope', { x: 5 })
    expect(cmd.apply(p0)).toBe(p0)
    expect(cmd.invert(p0)).toBe(p0)
  })

  it('addTrackCommand appends an empty track and round-trips', () => {
    const p0 = makeProject([makeClip('c1')])
    const cmd = addTrackCommand('tk-new', 'audio')
    const applied = cmd.apply(p0)
    expect(applied.tracks).toHaveLength(2)
    expect(applied.tracks[1]).toEqual({ id: 'tk-new', type: 'audio', clips: [] })
    expect(cmd.invert(applied)).toEqual(p0)
  })

  it('removeTrackCommand deletes a track (and its clips) and round-trips', () => {
    const p0 = makeProject([makeClip('c1'), makeClip('c2')])
    const cmd = removeTrackCommand(p0, 'tk1')
    const applied = cmd.apply(p0)
    expect(applied.tracks).toHaveLength(0)
    expect(cmd.invert(applied)).toEqual(p0)
  })

  it('moveClipToTrackCommand moves across same-type tracks and round-trips', () => {
    // Base project (video track 'tk1') + a second video track 'tk2'.
    const base = makeProject([makeClip('c1', { start: 2 })])
    const p0 = addTrackCommand('tk2', 'video').apply(base)
    const cmd = moveClipToTrackCommand(p0, 'c1', 'tk2', 8)
    const applied = cmd.apply(p0)
    expect(applied.tracks[0].clips).toHaveLength(0)
    expect(applied.tracks[1].clips.map((c) => c.id)).toEqual(['c1'])
    expect(applied.tracks[1].clips[0].start).toBe(8)
    // Undo restores BOTH the original track and the original start.
    expect(cmd.invert(applied)).toEqual(p0)
  })

  it('moveClipToNewTrackCommand spawns a new lane, moves the clip, and round-trips', () => {
    const p0 = makeProject([makeClip('c1', { start: 2 })]) // single video track 'tk1'
    const cmd = moveClipToNewTrackCommand(p0, 'c1', 'newlane', 'video', 8, 1)
    const applied = cmd.apply(p0)
    expect(applied.tracks.map((t) => t.id)).toEqual(['tk1', 'newlane'])
    expect(applied.tracks[0].clips).toHaveLength(0)
    expect(applied.tracks[1].clips.map((c) => c.id)).toEqual(['c1'])
    expect(applied.tracks[1].clips[0].start).toBe(8)
    // Undo restores the original track + start AND removes the new (empty) lane.
    expect(cmd.invert(applied)).toEqual(p0)
  })
})

describe('keyframe-lane commands (P8.6) — apply/invert round-trip', () => {
  // 10s clip so clip-local time clamps to [0, 10].
  const longClip = (id: string): Clip => makeClip(id, { in: 0, out: 10 })

  it('addKeyframeCommand applies + inverts back to a keyframe-less clip', () => {
    const p0 = makeProject([longClip('c1')])
    const cmd = addKeyframeCommand(p0, 'c1', 'x', 4, 120, 'easeIn')
    const applied = cmd.apply(p0)
    expect(getLane(applied.tracks[0].clips[0], 'x')).toEqual([{ t: 4, value: 120, ease: 'easeIn' }])
    // Invert removes the only lane → keyframes key dropped → deep-equal original.
    expect(cmd.invert(applied)).toEqual(p0)
  })

  it('addKeyframeCommand onto a duplicate time inverts to restore the replaced keyframe', () => {
    const p0 = addKeyframe(makeProject([longClip('c1')]), 'c1', 'x', 4, 10, 'linear')
    const cmd = addKeyframeCommand(p0, 'c1', 'x', 4, 99, 'bounce') // replaces t=4
    const applied = cmd.apply(p0)
    expect(getLane(applied.tracks[0].clips[0], 'x')).toEqual([{ t: 4, value: 99, ease: 'bounce' }])
    expect(cmd.invert(applied)).toEqual(p0)
  })

  it('moveKeyframeCommand round-trips (re-sort + clamp captured)', () => {
    let p0 = makeProject([longClip('c1')])
    p0 = addKeyframe(p0, 'c1', 'x', 1, 10)
    p0 = addKeyframe(p0, 'c1', 'x', 5, 50)
    const cmd = moveKeyframeCommand(p0, 'c1', 'x', 0, 8)
    const applied = cmd.apply(p0)
    expect(getLane(applied.tracks[0].clips[0], 'x').map((k) => k.t)).toEqual([5, 8])
    expect(cmd.invert(applied)).toEqual(p0)
  })

  it('deleteKeyframeCommand round-trips (restores the removed keyframe in place)', () => {
    let p0 = makeProject([longClip('c1')])
    p0 = addKeyframe(p0, 'c1', 'x', 1, 10)
    p0 = addKeyframe(p0, 'c1', 'x', 5, 50)
    const cmd = deleteKeyframeCommand(p0, 'c1', 'x', 0)
    const applied = cmd.apply(p0)
    expect(getLane(applied.tracks[0].clips[0], 'x').map((k) => k.t)).toEqual([5])
    expect(cmd.invert(applied)).toEqual(p0)
  })

  it('setKeyframeEasingCommand round-trips the per-segment ease', () => {
    let p0 = makeProject([longClip('c1')])
    p0 = addKeyframe(p0, 'c1', 'x', 1, 10, 'linear')
    const cmd = setKeyframeEasingCommand(p0, 'c1', 'x', 0, 'bounce')
    const applied = cmd.apply(p0)
    expect(getLane(applied.tracks[0].clips[0], 'x')[0].ease).toBe('bounce')
    expect(cmd.invert(applied)).toEqual(p0)
  })

  it('keyframe commands keep per-prop lanes independent on invert', () => {
    let p0 = makeProject([longClip('c1')])
    p0 = addKeyframe(p0, 'c1', 'opacity', 2, 0.5)
    // Add an x keyframe; invert must restore x-less while leaving opacity intact.
    const cmd = addKeyframeCommand(p0, 'c1', 'x', 3, 30)
    const reverted = cmd.invert(cmd.apply(p0))
    expect(reverted).toEqual(p0)
    expect(getLane(reverted.tracks[0].clips[0], 'opacity')).toHaveLength(1)
    expect(getLane(reverted.tracks[0].clips[0], 'x')).toHaveLength(0)
  })
})

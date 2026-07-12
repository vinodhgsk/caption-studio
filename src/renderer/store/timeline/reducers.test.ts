import { describe, expect, it } from 'vitest'
import type { Project } from '../../../shared/storage'
import type { Clip } from '../../../shared/project-schema'
import { defaultTransform } from '../../../shared/project-schema'
import {
  addClip,
  addTrack,
  clipLength,
  insertTrack,
  moveClip,
  moveClipToNewTrack,
  moveClipToTrack,
  removeClip,
  removeTrack,
  rippleDelete,
  rippleInsert,
  setClipTransform,
  splitAtPlayhead,
  trimClip,
  wouldOverlapOnTrack
} from './reducers'

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

describe('addTrack / removeTrack', () => {
  it('addTrack appends a new empty track with the caller-supplied id, immutably', () => {
    const p0 = makeProject([])
    const next = addTrack(p0, 'vid2', 'video')
    expect(next.tracks.map((t) => t.id)).toEqual(['tk1', 'vid2'])
    expect(next.tracks[1]).toEqual({ id: 'vid2', type: 'video', clips: [] })
    expect(p0.tracks).toHaveLength(1)
    expect(next).not.toBe(p0)
  })

  it('addTrack is a no-op when the id already exists', () => {
    const p0 = makeProject([])
    expect(addTrack(p0, 'tk1', 'video')).toBe(p0)
  })

  it('removeTrack drops the track immutably and is a no-op when absent', () => {
    const p0 = makeProject([])
    const added = addTrack(p0, 'vid2', 'video')
    const back = removeTrack(added, 'vid2')
    expect(back.tracks.map((t) => t.id)).toEqual(['tk1'])
    expect(removeTrack(p0, 'nope')).toBe(p0)
  })
})

describe('addClip / removeClip', () => {
  it('addClip appends to the track without mutating the input', () => {
    const p0 = makeProject([])
    const next = addClip(p0, 'tk1', makeClip('c1'))
    expect(next.tracks[0].clips).toHaveLength(1)
    expect(p0.tracks[0].clips).toHaveLength(0)
    expect(next).not.toBe(p0)
  })

  it('addClip is a no-op for an unknown track', () => {
    const p0 = makeProject([])
    expect(addClip(p0, 'nope', makeClip('c1'))).toBe(p0)
  })

  it('removeClip drops the clip immutably', () => {
    const p0 = makeProject([makeClip('c1'), makeClip('c2')])
    const next = removeClip(p0, 'c1')
    expect(next.tracks[0].clips.map((c) => c.id)).toEqual(['c2'])
    expect(p0.tracks[0].clips).toHaveLength(2)
  })
})

describe('moveClip', () => {
  it('sets start without touching in/out or mutating input', () => {
    const p0 = makeProject([makeClip('c1', { start: 0 })])
    const next = moveClip(p0, 'c1', 3)
    expect(next.tracks[0].clips[0].start).toBe(3)
    expect(next.tracks[0].clips[0].in).toBe(0)
    expect(next.tracks[0].clips[0].out).toBe(5)
    expect(p0.tracks[0].clips[0].start).toBe(0)
  })

  it('is a no-op (returns the same reference) when the clip is absent', () => {
    const p0 = makeProject([makeClip('c1')])
    expect(moveClip(p0, 'nope', 3)).toBe(p0)
  })

  it('does not clamp a negative start (clamping is the caller’s job)', () => {
    const p0 = makeProject([makeClip('c1', { start: 4 })])
    expect(moveClip(p0, 'c1', -2).tracks[0].clips[0].start).toBe(-2)
  })

  it('leaves sibling clips untouched (same reference)', () => {
    const p0 = makeProject([makeClip('c1'), makeClip('c2')])
    const next = moveClip(p0, 'c1', 9)
    expect(next.tracks[0].clips[1]).toBe(p0.tracks[0].clips[1])
  })
})

describe('moveClipToTrack', () => {
  // Two same-type (video) tracks + one audio track for type-guard checks.
  function twoVideoTracks(): Project {
    const p = makeProject([makeClip('c1', { start: 2 })])
    const withB = addTrack(p, 'tk2', 'video')
    return addTrack(withB, 'aud1', 'audio')
  }

  it('moves a clip to another same-type track and applies the new start', () => {
    const p0 = twoVideoTracks()
    const next = moveClipToTrack(p0, 'c1', 'tk2', 7)
    expect(next.tracks[0].clips).toHaveLength(0)
    expect(next.tracks[1].clips.map((c) => c.id)).toEqual(['c1'])
    expect(next.tracks[1].clips[0].start).toBe(7)
    // Immutable: the source project is untouched.
    expect(p0.tracks[0].clips).toHaveLength(1)
    expect(next).not.toBe(p0)
  })

  it('is a no-op when the target track type differs from the source', () => {
    const p0 = twoVideoTracks()
    // c1 is on a video track; 'aud1' is audio -> rejected.
    expect(moveClipToTrack(p0, 'c1', 'aud1', 7)).toBe(p0)
  })

  it('is a no-op when the target IS the clip’s current track', () => {
    const p0 = twoVideoTracks()
    expect(moveClipToTrack(p0, 'c1', 'tk1', 7)).toBe(p0)
  })

  it('is a no-op when the clip or the target track is absent', () => {
    const p0 = twoVideoTracks()
    expect(moveClipToTrack(p0, 'nope', 'tk2', 7)).toBe(p0)
    expect(moveClipToTrack(p0, 'c1', 'ghost', 7)).toBe(p0)
  })

  it('preserves the clip’s in/out and other properties across the move', () => {
    const p = makeProject([makeClip('c1', { in: 1, out: 6, start: 2 })])
    const p0 = addTrack(p, 'tk2', 'video')
    const moved = moveClipToTrack(p0, 'c1', 'tk2', 9).tracks[1].clips[0]
    expect(moved.in).toBe(1)
    expect(moved.out).toBe(6)
    expect(moved.start).toBe(9)
    expect(moved.mediaRef).toBe('media/c1.mp4')
  })
})

describe('insertTrack', () => {
  it('inserts an empty track at the given index, immutably', () => {
    const p0 = makeProject([]) // ['tk1']
    const withB = addTrack(p0, 'tk2', 'video') // ['tk1','tk2']
    const next = insertTrack(withB, 'mid', 'video', 1)
    expect(next.tracks.map((t) => t.id)).toEqual(['tk1', 'mid', 'tk2'])
    expect(next.tracks[1]).toEqual({ id: 'mid', type: 'video', clips: [] })
    expect(withB.tracks).toHaveLength(2)
    expect(next).not.toBe(withB)
  })

  it('clamps the index into [0, tracks.length]', () => {
    const p0 = makeProject([]) // ['tk1']
    expect(insertTrack(p0, 'a', 'video', -5).tracks.map((t) => t.id)).toEqual(['a', 'tk1'])
    expect(insertTrack(p0, 'b', 'video', 99).tracks.map((t) => t.id)).toEqual(['tk1', 'b'])
  })

  it('is a no-op when the id already exists', () => {
    const p0 = makeProject([])
    expect(insertTrack(p0, 'tk1', 'video', 0)).toBe(p0)
  })
})

describe('wouldOverlapOnTrack', () => {
  // tk1 holds c1 = [2, 7) (start 2, out-in = 5).
  const p0 = makeProject([makeClip('c1', { start: 2 })])

  it('returns true when the window overlaps an existing clip', () => {
    expect(wouldOverlapOnTrack(p0, 'tk1', 5, 3)).toBe(true) // [5,8) overlaps [2,7)
    expect(wouldOverlapOnTrack(p0, 'tk1', 0, 3)).toBe(true) // [0,3) overlaps [2,7)
  })

  it('returns false when the window is clear (half-open, edges touch)', () => {
    expect(wouldOverlapOnTrack(p0, 'tk1', 7, 2)).toBe(false) // [7,9) touches end -> clear
    expect(wouldOverlapOnTrack(p0, 'tk1', 10, 3)).toBe(false) // far right
  })

  it('skips the ignored clip so a clip never overlaps itself', () => {
    expect(wouldOverlapOnTrack(p0, 'tk1', 3, 2, 'c1')).toBe(false)
  })

  it('returns false for an unknown track', () => {
    expect(wouldOverlapOnTrack(p0, 'ghost', 0, 100)).toBe(false)
  })
})

describe('moveClipToNewTrack', () => {
  it('inserts a new lane at the index and moves the clip onto it', () => {
    const p0 = makeProject([makeClip('c1', { start: 2 })]) // ['tk1']
    const next = moveClipToNewTrack(p0, 'c1', 'newlane', 'video', 8, 1)
    expect(next.tracks.map((t) => t.id)).toEqual(['tk1', 'newlane'])
    expect(next.tracks[0].clips).toHaveLength(0)
    expect(next.tracks[1].clips.map((c) => c.id)).toEqual(['c1'])
    expect(next.tracks[1].clips[0].start).toBe(8)
    expect(p0.tracks[0].clips).toHaveLength(1)
    expect(next).not.toBe(p0)
  })

  it('is a no-op when the clip is absent', () => {
    const p0 = makeProject([makeClip('c1')])
    expect(moveClipToNewTrack(p0, 'nope', 'newlane', 'video', 8, 1)).toBe(p0)
  })

  it('is a no-op when the new type differs from the source track type', () => {
    const p0 = makeProject([makeClip('c1')]) // c1 on a video track
    expect(moveClipToNewTrack(p0, 'c1', 'newlane', 'audio', 8, 1)).toBe(p0)
  })

  it('is a no-op when the new track id already exists', () => {
    const p0 = makeProject([makeClip('c1')])
    expect(moveClipToNewTrack(p0, 'c1', 'tk1', 'video', 8, 1)).toBe(p0)
  })
})

describe('trimClip', () => {
  it("trim 'start' adjusts in and start by delta", () => {
    const p0 = makeProject([makeClip('c1', { in: 1, out: 5, start: 2 })])
    const next = trimClip(p0, 'c1', 'start', 1)
    const c = next.tracks[0].clips[0]
    expect(c.in).toBe(2)
    expect(c.start).toBe(3)
    expect(c.out).toBe(5)
  })

  it("trim 'end' adjusts only out", () => {
    const p0 = makeProject([makeClip('c1', { in: 1, out: 5, start: 2 })])
    const next = trimClip(p0, 'c1', 'end', -1)
    const c = next.tracks[0].clips[0]
    expect(c.out).toBe(4)
    expect(c.in).toBe(1)
    expect(c.start).toBe(2)
  })

  it("trim 'start' moves in and start together by the same (clamped) amount", () => {
    const p0 = makeProject([makeClip('c1', { in: 2, out: 6, start: 5 })])
    const next = trimClip(p0, 'c1', 'start', -1) // drag left edge left by 1s
    const c = next.tracks[0].clips[0]
    expect(c.in).toBe(1)
    expect(c.start).toBe(4)
    expect(c.out).toBe(6)
  })

  it("clamp to media: left edge cannot pull in below 0", () => {
    const p0 = makeProject([makeClip('c1', { in: 1, out: 6, start: 3 })])
    const next = trimClip(p0, 'c1', 'start', -10) // way past source start
    const c = next.tracks[0].clips[0]
    expect(c.in).toBe(0)
    expect(c.start).toBe(2) // start shifted by the applied delta (-1), not -10
    expect(c.out).toBe(6)
  })

  it("clamp to media: left edge cannot pass out - MIN_CLIP_SEC (min length)", () => {
    const p0 = makeProject([makeClip('c1', { in: 0, out: 5, start: 0 })])
    const next = trimClip(p0, 'c1', 'start', 10) // collapse to nothing
    const c = next.tracks[0].clips[0]
    expect(c.in).toBeCloseTo(5 - 1 / 30, 6)
    expect(c.out).toBe(5)
    expect(c.out - c.in).toBeCloseTo(1 / 30, 6)
  })

  it("clamp to media: right edge cannot pull out below in + MIN_CLIP_SEC", () => {
    const p0 = makeProject([makeClip('c1', { in: 1, out: 5, start: 2 })])
    const next = trimClip(p0, 'c1', 'end', -10) // collapse to nothing
    const c = next.tracks[0].clips[0]
    expect(c.out).toBeCloseTo(1 + 1 / 30, 6)
    expect(c.in).toBe(1)
    expect(c.out - c.in).toBeCloseTo(1 / 30, 6)
  })

  it("right edge extends FREELY when sourceDurationSec is undefined (today's case)", () => {
    const p0 = makeProject([makeClip('c1', { in: 0, out: 5, start: 0 })])
    const next = trimClip(p0, 'c1', 'end', 100)
    expect(next.tracks[0].clips[0].out).toBe(105)
  })

  it("right edge clamps to sourceDurationSec when provided (Phase 4 cap)", () => {
    const p0 = makeProject([makeClip('c1', { in: 0, out: 5, start: 0 })])
    const next = trimClip(p0, 'c1', 'end', 100, 8) // source is only 8s long
    expect(next.tracks[0].clips[0].out).toBe(8)
  })

  it('trimClip is immutable (input untouched, new object returned)', () => {
    const p0 = makeProject([makeClip('c1', { in: 1, out: 5, start: 2 })])
    const next = trimClip(p0, 'c1', 'start', 1)
    expect(next).not.toBe(p0)
    expect(p0.tracks[0].clips[0]).toEqual({
      ...p0.tracks[0].clips[0],
      in: 1,
      out: 5,
      start: 2
    })
  })

  it('is a no-op (returns the same reference) when the clip is absent', () => {
    const p0 = makeProject([makeClip('c1')])
    expect(trimClip(p0, 'nope', 'start', 1)).toBe(p0)
  })

  it('a zero delta leaves in/out/start unchanged on either edge', () => {
    const p0 = makeProject([makeClip('c1', { in: 1, out: 5, start: 2 })])
    const left = trimClip(p0, 'c1', 'start', 0).tracks[0].clips[0]
    expect([left.in, left.out, left.start]).toEqual([1, 5, 2])
    const right = trimClip(p0, 'c1', 'end', 0).tracks[0].clips[0]
    expect([right.in, right.out, right.start]).toEqual([1, 5, 2])
  })
})

describe('splitAtPlayhead', () => {
  it('splits into two clips sharing media with adjusted in/out/start', () => {
    const p0 = makeProject([makeClip('c1', { in: 0, out: 10, start: 2 })])
    // Clip spans timeline [2,12]; cut at t=5 -> localOffset 3.
    const next = splitAtPlayhead(p0, 'c1', 5, 'c1b')
    const [left, right] = next.tracks[0].clips
    expect(left.id).toBe('c1')
    expect(left.in).toBe(0)
    expect(left.out).toBe(3)
    expect(left.start).toBe(2)
    expect(left.mediaRef).toBe(right.mediaRef)
    expect(right.id).toBe('c1b')
    expect(right.in).toBe(3)
    expect(right.out).toBe(10)
    expect(right.start).toBe(5)
    // Durations sum to the original.
    expect(clipLength(left) + clipLength(right)).toBe(10)
  })

  it('is a no-op when t is outside the clip span', () => {
    const p0 = makeProject([makeClip('c1', { in: 0, out: 10, start: 2 })])
    expect(splitAtPlayhead(p0, 'c1', 2, 'x')).toBe(p0)
    expect(splitAtPlayhead(p0, 'c1', 12, 'x')).toBe(p0)
  })

  it('is a no-op exactly AT either boundary (start/end are not interior cuts)', () => {
    // Span [2,12]. The guard is `t <= start || t >= end`, so the boundaries
    // themselves never split.
    const p0 = makeProject([makeClip('c1', { in: 0, out: 10, start: 2 })])
    expect(splitAtPlayhead(p0, 'c1', 2, 'x')).toBe(p0) // exactly at start
    expect(splitAtPlayhead(p0, 'c1', 12, 'x')).toBe(p0) // exactly at end
  })

  it('splits one frame inside the start boundary (left collapses to a sliver)', () => {
    // Smallest interior cut just past the start; left keeps a tiny window.
    const p0 = makeProject([makeClip('c1', { in: 0, out: 10, start: 2 })])
    const next = splitAtPlayhead(p0, 'c1', 2 + 1 / 30, 'c1b')
    const [left, right] = next.tracks[0].clips
    expect(left.out).toBeCloseTo(1 / 30, 6)
    expect(right.in).toBeCloseTo(1 / 30, 6)
    expect(right.start).toBeCloseTo(2 + 1 / 30, 6)
    expect(clipLength(left) + clipLength(right)).toBeCloseTo(10, 6)
  })

  it('is a no-op (returns the same reference) when the clip is absent', () => {
    const p0 = makeProject([makeClip('c1', { in: 0, out: 10, start: 2 })])
    expect(splitAtPlayhead(p0, 'nope', 5, 'x')).toBe(p0)
  })

  it('preserves sibling clips and their order around the split', () => {
    const a = makeClip('a', { in: 0, out: 4, start: 0 })
    const b = makeClip('b', { in: 0, out: 10, start: 4 }) // split this one
    const c = makeClip('c', { in: 0, out: 2, start: 14 })
    const p0 = makeProject([a, b, c])
    const next = splitAtPlayhead(p0, 'b', 9, 'b2')
    expect(next.tracks[0].clips.map((cl) => cl.id)).toEqual(['a', 'b', 'b2', 'c'])
    // Untouched neighbours keep their references.
    expect(next.tracks[0].clips[0]).toBe(p0.tracks[0].clips[0])
    expect(next.tracks[0].clips[3]).toBe(p0.tracks[0].clips[2])
  })

  it('is immutable: input project + clips untouched', () => {
    const p0 = makeProject([makeClip('c1', { in: 0, out: 10, start: 2 })])
    const next = splitAtPlayhead(p0, 'c1', 5, 'c1b')
    expect(next).not.toBe(p0)
    expect(p0.tracks[0].clips).toHaveLength(1)
    expect(p0.tracks[0].clips[0].out).toBe(10)
  })
})

describe('rippleDelete', () => {
  it('removes and shifts downstream clips left by the deleted duration', () => {
    const a = makeClip('a', { in: 0, out: 4, start: 0 }) // len 4
    const b = makeClip('b', { in: 0, out: 3, start: 4 })
    const c = makeClip('c', { in: 0, out: 2, start: 7 })
    const p0 = makeProject([a, b, c])
    const next = rippleDelete(p0, 'a')
    const byId = Object.fromEntries(next.tracks[0].clips.map((cl) => [cl.id, cl]))
    expect(byId.a).toBeUndefined()
    expect(byId.b.start).toBe(0) // 4 - 4
    expect(byId.c.start).toBe(3) // 7 - 4
  })

  it('leaves clips BEFORE the deleted clip untouched, shifts only those after', () => {
    const a = makeClip('a', { in: 0, out: 4, start: 0 }) // before, start 0
    const b = makeClip('b', { in: 0, out: 3, start: 4 }) // deleted, len 3
    const c = makeClip('c', { in: 0, out: 2, start: 7 }) // after, start 7
    const p0 = makeProject([a, b, c])
    const next = rippleDelete(p0, 'b')
    const byId = Object.fromEntries(next.tracks[0].clips.map((cl) => [cl.id, cl]))
    expect(byId.a.start).toBe(0) // before the deleted clip: unchanged
    expect(byId.c.start).toBe(4) // 7 - 3
  })

  it('shifts a clip that starts EXACTLY at the deleted clip’s start (>= boundary)', () => {
    // Same-start overlap: the `start >= deleted.start` guard includes it.
    const a = makeClip('a', { in: 0, out: 4, start: 2 }) // deleted, len 4
    const b = makeClip('b', { in: 0, out: 3, start: 2 }) // co-starts, must shift
    const p0 = makeProject([a, b])
    const next = rippleDelete(p0, 'a')
    expect(next.tracks[0].clips.map((cl) => cl.id)).toEqual(['b'])
    expect(next.tracks[0].clips[0].start).toBe(-2) // 2 - 4
  })

  it('is a no-op (returns the same reference) when the clip is absent', () => {
    const p0 = makeProject([makeClip('a', { in: 0, out: 4, start: 0 })])
    expect(rippleDelete(p0, 'nope')).toBe(p0)
  })

  it('is immutable (input untouched, new object returned)', () => {
    const p0 = makeProject([
      makeClip('a', { in: 0, out: 4, start: 0 }),
      makeClip('b', { in: 0, out: 3, start: 4 })
    ])
    const next = rippleDelete(p0, 'a')
    expect(next).not.toBe(p0)
    expect(p0.tracks[0].clips).toHaveLength(2)
    expect(p0.tracks[0].clips[1].start).toBe(4)
  })
})

describe('setClipTransform', () => {
  it('merges the patch into the clip transform immutably, keeping other keys', () => {
    const p0 = makeProject([makeClip('c1')])
    const next = setClipTransform(p0, 'c1', { x: 100, y: -50 })
    const t = next.tracks[0].clips[0].transform
    expect(t.x).toBe(100)
    expect(t.y).toBe(-50)
    // Untouched keys keep their defaults.
    expect(t.scale).toBe(1)
    expect(t.rotation).toBe(0)
    expect(t.z).toBe(0)
    // Immutable: input untouched.
    expect(p0.tracks[0].clips[0].transform.x).toBe(0)
    expect(next).not.toBe(p0)
  })

  it('is general over any transform key (rotation/flip/z for later phases)', () => {
    const p0 = makeProject([makeClip('c1')])
    const next = setClipTransform(p0, 'c1', { rotation: 90, flipH: true, z: 3 })
    const t = next.tracks[0].clips[0].transform
    expect(t.rotation).toBe(90)
    expect(t.flipH).toBe(true)
    expect(t.z).toBe(3)
    expect(t.x).toBe(0)
  })

  it('is a no-op when the clip is absent', () => {
    const p0 = makeProject([makeClip('c1')])
    expect(setClipTransform(p0, 'nope', { x: 5 })).toBe(p0)
  })

  it('leaves other clips untouched', () => {
    const p0 = makeProject([makeClip('c1'), makeClip('c2')])
    const next = setClipTransform(p0, 'c1', { x: 42 })
    expect(next.tracks[0].clips[0].transform.x).toBe(42)
    expect(next.tracks[0].clips[1]).toBe(p0.tracks[0].clips[1])
  })
})

describe('rippleInsert', () => {
  it('shifts clips at/after start right by the inserted duration and adds it', () => {
    const a = makeClip('a', { in: 0, out: 4, start: 0 })
    const b = makeClip('b', { in: 0, out: 3, start: 4 })
    const p0 = makeProject([a, b])
    const ins = makeClip('ins', { in: 0, out: 2, start: 4 }) // len 2, at 4
    const next = rippleInsert(p0, 'tk1', ins)
    const byId = Object.fromEntries(next.tracks[0].clips.map((cl) => [cl.id, cl]))
    expect(byId.a.start).toBe(0) // before insert point, unchanged
    expect(byId.b.start).toBe(6) // 4 + 2
    expect(byId.ins.start).toBe(4)
  })

  it('shifts a clip starting EXACTLY at the insert point (>= boundary)', () => {
    const a = makeClip('a', { in: 0, out: 4, start: 4 }) // co-starts with insert
    const p0 = makeProject([a])
    const ins = makeClip('ins', { in: 0, out: 2, start: 4 }) // len 2
    const next = rippleInsert(p0, 'tk1', ins)
    const byId = Object.fromEntries(next.tracks[0].clips.map((cl) => [cl.id, cl]))
    expect(byId.a.start).toBe(6) // 4 + 2
    expect(byId.ins.start).toBe(4)
  })

  it('appends with no shift when every existing clip is before the insert point', () => {
    const a = makeClip('a', { in: 0, out: 4, start: 0 })
    const p0 = makeProject([a])
    const ins = makeClip('ins', { in: 0, out: 2, start: 10 })
    const next = rippleInsert(p0, 'tk1', ins)
    const byId = Object.fromEntries(next.tracks[0].clips.map((cl) => [cl.id, cl]))
    expect(byId.a.start).toBe(0) // unchanged
    expect(byId.ins.start).toBe(10)
    expect(next.tracks[0].clips).toHaveLength(2)
  })

  it('is a no-op (returns the same reference) when the track is absent', () => {
    const p0 = makeProject([makeClip('a')])
    expect(rippleInsert(p0, 'nope', makeClip('ins'))).toBe(p0)
  })

  it('is immutable (input untouched, new object returned)', () => {
    const p0 = makeProject([makeClip('a', { in: 0, out: 4, start: 4 })])
    const next = rippleInsert(p0, 'tk1', makeClip('ins', { in: 0, out: 2, start: 4 }))
    expect(next).not.toBe(p0)
    expect(p0.tracks[0].clips).toHaveLength(1)
    expect(p0.tracks[0].clips[0].start).toBe(4)
  })
})

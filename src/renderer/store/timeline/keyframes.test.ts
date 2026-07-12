import { describe, expect, it } from 'vitest'
import type { Project } from '../../../shared/storage'
import type { Clip, Keyframe } from '../../../shared/project-schema'
import { defaultTransform } from '../../../shared/project-schema'
import {
  addKeyframe,
  addKeyframeToLane,
  deleteKeyframe,
  deleteKeyframeFromLane,
  getLane,
  moveKeyframe,
  moveKeyframeInLane,
  setKeyframeEaseInLane,
  setKeyframeEasing,
  sortLane
} from './keyframes'

// A 10s-long clip (out - in = 10) so clip-local time clamps to [0, 10].
function makeClip(id: string, overrides: Partial<Clip> = {}): Clip {
  return {
    id,
    mediaRef: `media/${id}.mp4`,
    in: 0,
    out: 10,
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

const DUR = 10

describe('pure lane ops — addKeyframeToLane', () => {
  it('inserts a keyframe and keeps the lane sorted by t', () => {
    let lane: Keyframe[] = []
    lane = addKeyframeToLane(lane, 5, 100, DUR)
    lane = addKeyframeToLane(lane, 1, 10, DUR)
    lane = addKeyframeToLane(lane, 3, 50, DUR)
    expect(lane.map((k) => k.t)).toEqual([1, 3, 5])
    expect(lane.map((k) => k.value)).toEqual([10, 50, 100])
  })

  it('clamps t into [0, duration]', () => {
    let lane: Keyframe[] = []
    lane = addKeyframeToLane(lane, -4, 1, DUR)
    lane = addKeyframeToLane(lane, 99, 2, DUR)
    expect(lane.map((k) => k.t)).toEqual([0, DUR])
  })

  it('replaces an existing keyframe at the same time (one per time)', () => {
    let lane: Keyframe[] = []
    lane = addKeyframeToLane(lane, 4, 100, DUR)
    lane = addKeyframeToLane(lane, 4, 200, DUR, 'easeIn')
    expect(lane).toHaveLength(1)
    expect(lane[0]).toEqual({ t: 4, value: 200, ease: 'easeIn' })
  })

  it('defaults ease to linear and is immutable', () => {
    const lane0: Keyframe[] = []
    const lane1 = addKeyframeToLane(lane0, 2, 5, DUR)
    expect(lane1[0].ease).toBe('linear')
    expect(lane0).toHaveLength(0)
    expect(lane1).not.toBe(lane0)
  })
})

describe('pure lane ops — moveKeyframeInLane', () => {
  const base = (): Keyframe[] => [
    { t: 1, value: 10, ease: 'linear' },
    { t: 5, value: 50, ease: 'easeIn' },
    { t: 8, value: 80, ease: 'linear' }
  ]

  it('moves + re-sorts so the moved keyframe lands in time order', () => {
    const next = moveKeyframeInLane(base(), 0, 6, DUR) // move t=1 to t=6
    expect(next.map((k) => k.t)).toEqual([5, 6, 8])
    // The moved keyframe keeps its value + ease.
    expect(next.find((k) => k.t === 6)).toEqual({ t: 6, value: 10, ease: 'linear' })
  })

  it('clamps the new time into [0, duration]', () => {
    const lo = moveKeyframeInLane(base(), 1, -3, DUR) // move t=5 -> 0
    expect(lo.map((k) => k.t)).toEqual([0, 1, 8])
    const hi = moveKeyframeInLane(base(), 2, 999, DUR) // move t=8 -> DUR
    expect(hi.map((k) => k.t)).toEqual([1, 5, DUR])
  })

  it('optionally updates the value too', () => {
    const next = moveKeyframeInLane(base(), 1, 5, DUR, 555)
    expect(next.find((k) => k.t === 5)).toMatchObject({ value: 555 })
  })

  it('moving ONTO another keyframe time replaces that other one (one per time)', () => {
    const next = moveKeyframeInLane(base(), 0, 5, DUR) // move t=1 onto t=5
    expect(next.map((k) => k.t)).toEqual([5, 8])
    // The moved keyframe (value 10) wins at t=5.
    expect(next.find((k) => k.t === 5)).toMatchObject({ value: 10 })
  })

  it('out-of-range index returns a sorted copy unchanged in content', () => {
    const src = base()
    const next = moveKeyframeInLane(src, 99, 2, DUR)
    expect(next).toEqual(sortLane(src))
    expect(next).not.toBe(src)
  })
})

describe('pure lane ops — deleteKeyframeFromLane / setKeyframeEaseInLane', () => {
  const base = (): Keyframe[] => [
    { t: 1, value: 10 },
    { t: 5, value: 50 },
    { t: 8, value: 80 }
  ]

  it('deletes the keyframe at index, immutably', () => {
    const src = base()
    const next = deleteKeyframeFromLane(src, 1)
    expect(next.map((k) => k.t)).toEqual([1, 8])
    expect(src).toHaveLength(3)
  })

  it('delete out-of-range index is a no-op (sorted copy)', () => {
    const src = base()
    expect(deleteKeyframeFromLane(src, 9)).toEqual(sortLane(src))
  })

  it('setKeyframeEaseInLane updates only the targeted keyframe', () => {
    const next = setKeyframeEaseInLane(base(), 1, 'bounce')
    expect(next[1].ease).toBe('bounce')
    expect(next[0].ease).toBeUndefined()
  })

  it('setKeyframeEaseInLane out-of-range is a no-op (sorted copy)', () => {
    const src = base()
    expect(setKeyframeEaseInLane(src, -1, 'bounce')).toEqual(sortLane(src))
  })
})

describe('project reducers — addKeyframe / per-prop independence', () => {
  it('addKeyframe writes a sorted lane on the clip without mutating input', () => {
    const p0 = makeProject([makeClip('c1')])
    const p1 = addKeyframe(p0, 'c1', 'x', 5, 100)
    const p2 = addKeyframe(p1, 'c1', 'x', 2, 40)
    const lane = getLane(p2.tracks[0].clips[0], 'x')
    expect(lane.map((k) => k.t)).toEqual([2, 5])
    // Input untouched.
    expect(p0.tracks[0].clips[0].keyframes).toBeUndefined()
    expect(p2).not.toBe(p0)
  })

  it('lanes for different props are independent', () => {
    let p = makeProject([makeClip('c1')])
    p = addKeyframe(p, 'c1', 'x', 1, 10)
    p = addKeyframe(p, 'c1', 'opacity', 2, 0.5)
    p = addKeyframe(p, 'c1', 'x', 3, 30)
    const clip = p.tracks[0].clips[0]
    expect(getLane(clip, 'x').map((k) => k.t)).toEqual([1, 3])
    expect(getLane(clip, 'opacity').map((k) => k.t)).toEqual([2])
    expect(getLane(clip, 'scale')).toEqual([])
  })

  it('addKeyframe clamps clip-local time to the clip duration', () => {
    let p = makeProject([makeClip('c1', { out: 4 })]) // duration 4
    p = addKeyframe(p, 'c1', 'x', 99, 1)
    expect(getLane(p.tracks[0].clips[0], 'x')[0].t).toBe(4)
  })

  it('addKeyframe is a no-op for an unknown clip', () => {
    const p0 = makeProject([makeClip('c1')])
    expect(addKeyframe(p0, 'nope', 'x', 1, 1)).toBe(p0)
  })
})

describe('project reducers — move / delete / easing thread onto the clip', () => {
  function withKf(): Project {
    let p = makeProject([makeClip('c1')])
    p = addKeyframe(p, 'c1', 'x', 1, 10, 'linear')
    p = addKeyframe(p, 'c1', 'x', 5, 50, 'easeIn')
    return p
  }

  it('moveKeyframe re-sorts + clamps', () => {
    const p = moveKeyframe(withKf(), 'c1', 'x', 0, 9) // move t=1 -> 9
    expect(getLane(p.tracks[0].clips[0], 'x').map((k) => k.t)).toEqual([5, 9])
  })

  it('deleteKeyframe removes the entry; emptying the last lane drops keyframes entirely', () => {
    let p = withKf()
    p = deleteKeyframe(p, 'c1', 'x', 0)
    expect(getLane(p.tracks[0].clips[0], 'x').map((k) => k.t)).toEqual([5])
    p = deleteKeyframe(p, 'c1', 'x', 0)
    // Last lane removed → keyframes key dropped.
    expect(p.tracks[0].clips[0].keyframes).toBeUndefined()
  })

  it('setKeyframeEasing updates the per-segment ease', () => {
    const p = setKeyframeEasing(withKf(), 'c1', 'x', 0, 'bounce')
    expect(getLane(p.tracks[0].clips[0], 'x')[0].ease).toBe('bounce')
  })
})

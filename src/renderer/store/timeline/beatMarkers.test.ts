import { describe, expect, it } from 'vitest'
import type { Clip, ProjectTrack } from '../../../shared/storage'
import {
  clipBeatTimelineTimes,
  collectBeatMarkers,
  nearestBeat,
  snapTrimEdgeToBeat
} from './beatMarkers'

/** Minimal audio clip with beats; only the fields the mapper reads matter here. */
function audioClip(opts: {
  id?: string
  start: number
  in: number
  out: number
  beats?: number[]
}): Clip {
  return {
    id: opts.id ?? 'a1',
    mediaRef: 'media/song.mp3',
    in: opts.in,
    out: opts.out,
    start: opts.start,
    transform: {} as Clip['transform'],
    audio: opts.beats === undefined ? undefined : { gain: 1, fadeInSec: 0, fadeOutSec: 0, beats: opts.beats }
  }
}

describe('clipBeatTimelineTimes', () => {
  it('returns [] when the clip has no beats', () => {
    expect(clipBeatTimelineTimes(audioClip({ start: 0, in: 0, out: 5 }))).toEqual([])
  })

  it('offsets source beats by start - in', () => {
    // Clip starts at timeline 10s, trimmed to source [2,6]. A source beat at 3s
    // appears at 10 + (3 - 2) = 11s.
    const clip = audioClip({ start: 10, in: 2, out: 6, beats: [3, 4.5] })
    expect(clipBeatTimelineTimes(clip)).toEqual([11, 12.5])
  })

  it('drops beats outside the trimmed [in, out] window', () => {
    const clip = audioClip({ start: 0, in: 2, out: 6, beats: [1, 3, 7] })
    // Only 3 is within [2,6]; it maps to 0 + (3 - 2) = 1.
    expect(clipBeatTimelineTimes(clip)).toEqual([1])
  })
})

describe('collectBeatMarkers', () => {
  it('gathers and sorts beats across tracks, merging near-duplicates', () => {
    const tracks: ProjectTrack[] = [
      {
        id: 't1',
        type: 'audio',
        clips: [audioClip({ id: 'a', start: 0, in: 0, out: 4, beats: [1, 2] })]
      },
      {
        id: 't2',
        type: 'audio',
        clips: [audioClip({ id: 'b', start: 0, in: 0, out: 4, beats: [2.0005, 3] })]
      }
    ]
    // 2 and 2.0005 merge (within 1ms); result sorted + distinct.
    expect(collectBeatMarkers(tracks)).toEqual([1, 2, 3])
  })

  it('returns [] when no clip has beats', () => {
    const tracks: ProjectTrack[] = [
      { id: 't', type: 'video', clips: [audioClip({ start: 0, in: 0, out: 4 })] }
    ]
    expect(collectBeatMarkers(tracks)).toEqual([])
  })
})

describe('nearestBeat', () => {
  const beats = [1, 2.5, 4]
  it('finds the closest beat within tolerance', () => {
    expect(nearestBeat(beats, 2.4, 0.2)).toBe(2.5)
    expect(nearestBeat(beats, 4.1, 0.2)).toBe(4)
  })
  it('returns null when nothing is within tolerance', () => {
    expect(nearestBeat(beats, 3.2, 0.2)).toBeNull()
    expect(nearestBeat([], 1, 0.2)).toBeNull()
  })
})

describe('snapTrimEdgeToBeat', () => {
  const beats = [1, 2.5, 4]

  it('snaps the right (end) edge out to a nearby beat', () => {
    const next = { in: 0, out: 2.45, start: 0 }
    expect(snapTrimEdgeToBeat(next, 'end', beats, 0.2)).toEqual({ in: 0, out: 2.5, start: 0 })
  })

  it('snaps the left (start) edge moving in and start together', () => {
    // start 1.1 → beat 1.0; in shifts by -0.1 too.
    const next = { in: 0.5, out: 3, start: 1.1 }
    const snapped = snapTrimEdgeToBeat(next, 'start', beats, 0.2)
    expect(snapped.start).toBe(1)
    expect(snapped.out).toBe(3)
    expect(snapped.in).toBeCloseTo(0.4, 10)
  })

  it('leaves the edge unchanged when no beat is within tolerance', () => {
    const next = { in: 0, out: 3.2, start: 0 }
    expect(snapTrimEdgeToBeat(next, 'end', beats, 0.2)).toBe(next)
  })

  it('refuses a snap that would invert the clip or push in negative', () => {
    // start edge snapping to beat 1 would push in negative (in 0.05 - 0.1 < 0).
    const next = { in: 0.05, out: 3, start: 1.1 }
    expect(snapTrimEdgeToBeat(next, 'start', beats, 0.2)).toBe(next)
    // end edge snapping to a beat at/under start is rejected.
    const next2 = { in: 0, out: 1.05, start: 1.04 }
    expect(snapTrimEdgeToBeat(next2, 'end', beats, 0.2)).toBe(next2)
  })
})

/**
 * P4.11 — Remove-silence: pure detection + ripple unit tests (Doc 02 §2).
 *
 * Covers (per the runbook): detection finds the right ranges at the threshold
 * boundary, honours the filler list, and the no-silence case; the ripple shifts
 * subsequent clips AND caption-word timing by exactly the removed duration;
 * multiple cuts compose; the round-trip command undo restores; and the total
 * timeline shrinks by the removed total. Pure + deterministic (no IPC/DOM).
 */
import { describe, expect, it } from 'vitest'
import type { Project } from '../../../shared/storage'
import type { Clip } from '../../../shared/project-schema'
import { defaultTransform } from '../../../shared/project-schema'
import type { Word } from '../../../shared/stt'
import {
  detectSilenceRanges,
  mergeRanges,
  remapCaptionWords,
  remapClip,
  rippleRemoveRanges,
  shiftTime,
  totalRemoved,
  type TimeRange
} from './removeSilence'
import { removeSilenceCommand } from './commands'

function word(text: string, start: number, end: number): Word {
  return { text, start, end }
}

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

function makeProject(tracks: Project['tracks']): Project {
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
    tracks
  }
}

// ---------------------------------------------------------------------------
// detectSilenceRanges
// ---------------------------------------------------------------------------
describe('detectSilenceRanges — silence threshold', () => {
  it('finds the gap between words longer than minSilenceSec', () => {
    // word A [0,1], 2s gap, word B [3,4].
    const words = [word('A', 0, 1), word('B', 3, 4)]
    const ranges = detectSilenceRanges(words, { minSilenceSec: 0.5, removeFiller: false })
    expect(ranges).toEqual([{ start: 1, end: 3 }])
  })

  it('keeps a gap exactly AT the threshold (strict >)', () => {
    // gap is exactly 0.5 → kept (not removed).
    const words = [word('A', 0, 1), word('B', 1.5, 2)]
    const ranges = detectSilenceRanges(words, { minSilenceSec: 0.5, removeFiller: false })
    expect(ranges).toEqual([])
  })

  it('removes a gap just OVER the threshold', () => {
    const words = [word('A', 0, 1), word('B', 1.51, 2)]
    const ranges = detectSilenceRanges(words, { minSilenceSec: 0.5, removeFiller: false })
    expect(ranges).toHaveLength(1)
    expect(ranges[0].start).toBeCloseTo(1)
    expect(ranges[0].end).toBeCloseTo(1.51)
  })

  it('no-silence case: dense speech yields no ranges', () => {
    const words = [word('A', 0, 1), word('B', 1.1, 2), word('C', 2.1, 3)]
    const ranges = detectSilenceRanges(words, { minSilenceSec: 0.5, removeFiller: false })
    expect(ranges).toEqual([])
  })

  it('empty transcript yields no ranges', () => {
    expect(detectSilenceRanges([], {})).toEqual([])
  })

  it('keeps padSec of breathing room on each side of a removed gap', () => {
    const words = [word('A', 0, 1), word('B', 3, 4)]
    const ranges = detectSilenceRanges(words, {
      minSilenceSec: 0.5,
      padSec: 0.2,
      removeFiller: false
    })
    expect(ranges[0].start).toBeCloseTo(1.2)
    expect(ranges[0].end).toBeCloseTo(2.8)
  })

  it('removes leading dead air from 0 to the first word', () => {
    const words = [word('A', 2, 3), word('B', 3.1, 4)]
    const ranges = detectSilenceRanges(words, { minSilenceSec: 0.5, removeFiller: false })
    expect(ranges).toEqual([{ start: 0, end: 2 }])
  })

  it('isQuiet veto keeps a non-quiet gap', () => {
    const words = [word('A', 0, 1), word('B', 3, 4)]
    const ranges = detectSilenceRanges(words, {
      minSilenceSec: 0.5,
      removeFiller: false,
      isQuiet: () => false
    })
    expect(ranges).toEqual([])
  })
})

describe('detectSilenceRanges — filler', () => {
  it('flags default filler tokens as removable spans', () => {
    const words = [word('So', 0, 0.4), word('um', 0.4, 0.9), word('yeah', 0.9, 1.3)]
    const ranges = detectSilenceRanges(words, { minSilenceSec: 5 })
    expect(ranges).toEqual([{ start: 0.4, end: 0.9 }])
  })

  it('matches filler case-insensitively and ignores surrounding punctuation', () => {
    const words = [word('Hello', 0, 0.5), word('Um,', 0.5, 1.0), word('world', 1.0, 1.5)]
    const ranges = detectSilenceRanges(words, { minSilenceSec: 5 })
    expect(ranges).toEqual([{ start: 0.5, end: 1.0 }])
  })

  it('honours a custom filler list and ignores defaults', () => {
    const words = [word('um', 0, 0.5), word('basically', 0.5, 1.2)]
    const ranges = detectSilenceRanges(words, {
      minSilenceSec: 5,
      fillerWords: ['basically']
    })
    expect(ranges).toEqual([{ start: 0.5, end: 1.2 }])
  })

  it('removeFiller:false keeps filler words', () => {
    const words = [word('um', 0, 0.5), word('hi', 0.5, 1)]
    expect(detectSilenceRanges(words, { minSilenceSec: 5, removeFiller: false })).toEqual([])
  })

  it('merges a filler span adjacent to a silence gap into one range', () => {
    // gap [1,2.5], then filler 'uh' at [2.5,3] → coalesce to [1,3].
    const words = [word('A', 0, 1), word('uh', 2.5, 3), word('B', 3, 4)]
    const ranges = detectSilenceRanges(words, { minSilenceSec: 0.5 })
    expect(ranges).toEqual([{ start: 1, end: 3 }])
  })
})

// ---------------------------------------------------------------------------
// shiftTime / mergeRanges / totalRemoved
// ---------------------------------------------------------------------------
describe('shiftTime', () => {
  const ranges: TimeRange[] = [
    { start: 1, end: 3 },
    { start: 5, end: 6 }
  ]
  it('leaves time before any range unchanged', () => {
    expect(shiftTime(0.5, ranges)).toBe(0.5)
  })
  it('collapses a time inside a range to its (shifted) start', () => {
    expect(shiftTime(2, ranges)).toBe(1)
  })
  it('subtracts all removed-before for a time after the ranges', () => {
    // total removed before t=7 is (2 + 1) = 3 → 7-3 = 4.
    expect(shiftTime(7, ranges)).toBe(4)
  })
  it('is monotonic non-decreasing', () => {
    let prev = -Infinity
    for (let t = 0; t <= 8; t += 0.25) {
      const v = shiftTime(t, ranges)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })
})

describe('mergeRanges + totalRemoved', () => {
  it('merges overlapping and touching ranges', () => {
    expect(
      mergeRanges([
        { start: 5, end: 6 },
        { start: 1, end: 3 },
        { start: 3, end: 4 }
      ])
    ).toEqual([
      { start: 1, end: 4 },
      { start: 5, end: 6 }
    ])
  })
  it('sums disjoint widths', () => {
    expect(
      totalRemoved([
        { start: 1, end: 3 },
        { start: 5, end: 6 }
      ])
    ).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// remapClip / remapCaptionWords
// ---------------------------------------------------------------------------
describe('remapClip', () => {
  it('shifts a clip wholly after a removed range left by the range width', () => {
    // remove [1,3] (width 2). Clip at start=5, length 4 (in0..out4).
    const clip = makeClip('c', { in: 0, out: 4, start: 5 })
    const next = remapClip(clip, [{ start: 1, end: 3 }])!
    expect(next.start).toBe(3) // 5 - 2
    expect(next.in).toBe(0)
    expect(next.out).toBe(4) // length unchanged
  })

  it('drops a clip fully inside a removed range', () => {
    const clip = makeClip('c', { in: 0, out: 1, start: 1.2 }) // span [1.2,2.2]
    expect(remapClip(clip, [{ start: 1, end: 3 }])).toBeNull()
  })

  it('trims the source window of a clip that straddles a removed range', () => {
    // Clip span [0,4], remove [1,2] (width 1) inside it → kept length 3.
    const clip = makeClip('c', { in: 10, out: 14, start: 0 })
    const next = remapClip(clip, [{ start: 1, end: 2 }])!
    expect(next.start).toBe(0)
    expect(next.out - next.in).toBe(3) // length shrank by 1
    expect(next.in).toBe(11) // front trimmed by the interior removal
  })

  it('shifts caption-word timing by the same map and drops swallowed words', () => {
    const clip = makeClip('cap', {
      in: 0,
      out: 6,
      start: 0,
      caption: {
        words: [
          { text: 'A', start: 0, end: 1 },
          { text: 'gone', start: 1.2, end: 2.8 }, // inside removed [1,3]
          { text: 'B', start: 3, end: 4 }
        ]
      }
    })
    const next = remapClip(clip, [{ start: 1, end: 3 }])!
    expect(next.caption!.words).toEqual([
      { text: 'A', start: 0, end: 1 },
      { text: 'B', start: 1, end: 2 } // shifted left by 2
    ])
  })
})

describe('remapCaptionWords', () => {
  it('shifts surviving words by exactly the removed duration before them', () => {
    const words = [
      { text: 'x', start: 4, end: 5 },
      { text: 'y', start: 5, end: 6 }
    ]
    const shifted = remapCaptionWords(words, [{ start: 1, end: 3 }])
    expect(shifted).toEqual([
      { text: 'x', start: 2, end: 3 },
      { text: 'y', start: 3, end: 4 }
    ])
  })
})

// ---------------------------------------------------------------------------
// rippleRemoveRanges — whole-project, multiple tracks, multiple cuts
// ---------------------------------------------------------------------------
describe('rippleRemoveRanges', () => {
  it('ripples audio + caption tracks together, captions stay aligned', () => {
    const audio = makeClip('a', { mediaRef: 'media/a.mp3', in: 0, out: 10, start: 0 })
    const caption: Clip = makeClip('cap', {
      mediaRef: '',
      in: 0,
      out: 10,
      start: 0,
      caption: {
        words: [
          { text: 'A', start: 0, end: 1 },
          { text: 'B', start: 4, end: 5 },
          { text: 'C', start: 8, end: 9 }
        ]
      }
    })
    const project = makeProject([
      { id: 'ta', type: 'audio', clips: [audio] },
      { id: 'tc', type: 'text', clips: [caption] }
    ])

    // Remove the [1,4] gap (width 3) and [5,8] gap (width 3): total 6.
    const ranges: TimeRange[] = [
      { start: 1, end: 4 },
      { start: 5, end: 8 }
    ]
    const next = rippleRemoveRanges(project, ranges)

    const nextAudio = next.tracks[0].clips[0]
    expect(nextAudio.out - nextAudio.in).toBe(4) // 10 - 6 removed
    expect(nextAudio.start).toBe(0)

    const nextWords = next.tracks[1].clips[0].caption!.words
    // A stays [0,1]; B was [4,5] → minus 3 → [1,2]; C [8,9] → minus 6 → [2,3].
    expect(nextWords).toEqual([
      { text: 'A', start: 0, end: 1 },
      { text: 'B', start: 1, end: 2 },
      { text: 'C', start: 2, end: 3 }
    ])
  })

  it('multiple cuts compose to shift a downstream clip by their total', () => {
    const clip = makeClip('c', { in: 0, out: 2, start: 10 })
    const project = makeProject([{ id: 't', type: 'video', clips: [clip] }])
    const ranges: TimeRange[] = [
      { start: 1, end: 2 },
      { start: 3, end: 5 }
    ] // total 3
    const next = rippleRemoveRanges(project, ranges)
    expect(next.tracks[0].clips[0].start).toBe(7) // 10 - 3
  })

  it('is a no-op (same value) when there are no ranges', () => {
    const project = makeProject([{ id: 't', type: 'video', clips: [makeClip('c')] }])
    expect(rippleRemoveRanges(project, [])).toBe(project)
  })

  it('does not mutate the input project', () => {
    const project = makeProject([{ id: 't', type: 'video', clips: [makeClip('c', { start: 5 })] }])
    const snapshot = JSON.parse(JSON.stringify(project))
    rippleRemoveRanges(project, [{ start: 1, end: 3 }])
    expect(project).toEqual(snapshot)
  })
})

// ---------------------------------------------------------------------------
// removeSilenceCommand — undoable, total-duration shrink
// ---------------------------------------------------------------------------
describe('removeSilenceCommand', () => {
  function captionProject(): Project {
    const caption: Clip = makeClip('cap', {
      mediaRef: '',
      in: 0,
      out: 10,
      start: 0,
      text: { lang: 'ta', lines: ['A B C'] },
      caption: {
        words: [
          { text: 'A', start: 0, end: 1 },
          { text: 'B', start: 4, end: 5 },
          { text: 'C', start: 8, end: 9 }
        ]
      }
    })
    const audio = makeClip('a', { mediaRef: 'media/a.mp3', in: 0, out: 10, start: 0 })
    return makeProject([
      { id: 'ta', type: 'audio', clips: [audio] },
      { id: 'caption-track', type: 'text', clips: [caption] }
    ])
  }

  it('apply shrinks total timeline by the removed total; invert restores exactly', () => {
    const p0 = captionProject()
    const words = p0.tracks[1].clips[0].caption!.words
    const ranges = detectSilenceRanges(words, { minSilenceSec: 0.5, removeFiller: false })
    // Gaps [1,4] and [5,8] → total 6.
    expect(totalRemoved(ranges)).toBe(6)

    const cmd = removeSilenceCommand(p0, ranges)
    const applied = cmd.apply(p0)

    const audioLenBefore = p0.tracks[0].clips[0].out - p0.tracks[0].clips[0].in
    const audioLenAfter = applied.tracks[0].clips[0].out - applied.tracks[0].clips[0].in
    expect(audioLenBefore - audioLenAfter).toBe(6)

    // Undo restores the original project verbatim.
    expect(cmd.invert(applied)).toEqual(p0)
  })

  it('round-trips even with multiple disjoint cuts', () => {
    const p0 = captionProject()
    const ranges: TimeRange[] = [
      { start: 1, end: 4 },
      { start: 5, end: 8 }
    ]
    const cmd = removeSilenceCommand(p0, ranges)
    expect(cmd.invert(cmd.apply(p0))).toEqual(p0)
  })
})

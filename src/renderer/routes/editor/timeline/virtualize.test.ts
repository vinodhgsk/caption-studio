import { describe, expect, it } from 'vitest'
import type { Clip } from '../../../../shared/project-schema'
import { defaultTransform } from '../../../../shared/project-schema'
import type { ProjectTrack } from '../../../../shared/storage'
import { visibleClipsAt } from '../preview/compositor'
import { clipLabel, visibleClips, waveformBars } from './virtualize'

function clip(partial: Partial<Clip>): Clip {
  return {
    id: 'c',
    mediaRef: 'media/x.mp4',
    in: 0,
    out: 1,
    start: 0,
    transform: defaultTransform(),
    ...partial
  }
}

describe('visibleClips', () => {
  // Window [10, 20]; no overscan unless stated. Clip range is [start, start + (out - in)).
  it('excludes a clip fully before the window', () => {
    const c = clip({ id: 'before', start: 0, in: 0, out: 5 }) // [0, 5]
    expect(visibleClips([c], 10, 20, 0)).toEqual([])
  })

  it('excludes a clip fully after the window', () => {
    const c = clip({ id: 'after', start: 30, in: 0, out: 5 }) // [30, 35]
    expect(visibleClips([c], 10, 20, 0)).toEqual([])
  })

  it('includes a clip overlapping the left edge', () => {
    const c = clip({ id: 'left', start: 8, in: 0, out: 4 }) // [8, 12]
    expect(visibleClips([c], 10, 20, 0)).toEqual([c])
  })

  it('includes a clip overlapping the right edge', () => {
    const c = clip({ id: 'right', start: 18, in: 0, out: 6 }) // [18, 24]
    expect(visibleClips([c], 10, 20, 0)).toEqual([c])
  })

  it('includes a clip fully inside the window', () => {
    const c = clip({ id: 'inside', start: 12, in: 0, out: 3 }) // [12, 15]
    expect(visibleClips([c], 10, 20, 0)).toEqual([c])
  })

  it('includes a clip spanning the whole window', () => {
    const c = clip({ id: 'span', start: 0, in: 0, out: 40 }) // [0, 40]
    expect(visibleClips([c], 10, 20, 0)).toEqual([c])
  })

  it('returns an empty array for an empty clip list', () => {
    expect(visibleClips([], 10, 20, 0)).toEqual([])
  })

  it('excludes clips that only touch the overscan boundary (half-open window)', () => {
    // Clip ends exactly at the overscan lower edge (window 10..20, overscan 2 => lo = 8).
    const touchLow = clip({ id: 'touchLow', start: 6, in: 0, out: 2 }) // [6, 8], end === lo
    // Clip starts exactly at the overscan upper edge (hi = 22).
    const touchHigh = clip({ id: 'touchHigh', start: 22, in: 0, out: 3 }) // [22, 25], start === hi
    // Clip just outside the overscan band on the left is excluded.
    const justOutside = clip({ id: 'justOutside', start: 5, in: 0, out: 2.9 }) // [5, 7.9] < lo
    const result = visibleClips([touchLow, touchHigh, justOutside], 10, 20, 2)
    expect(result).toEqual([])
  })

  it('keeps order and selects the subset across many clips', () => {
    const clips = Array.from({ length: 100 }, (_, i) =>
      clip({ id: `c${i}`, start: i, in: 0, out: 1 })
    )
    const result = visibleClips(clips, 10, 20, 0)
    // Half-open intersection keeps clips that actually overlap [10,20): c10..c19.
    expect(result.map((c) => c.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `c${10 + i}`)
    )
  })

  it('excludes malformed negative-duration clips (out < in)', () => {
    const bad = clip({ id: 'bad', start: 10, in: 5, out: 3 })
    expect(visibleClips([bad], 9, 12, 0)).toEqual([])
  })
})

describe('timeline/preview visibility parity', () => {
  const EPS = 1e-6

  it('matches compositor playhead visibility at start/end boundaries', () => {
    const c = clip({ id: 'parity', start: 2, in: 1, out: 4 }) // dur 3 → [2,5)
    const tracks: ProjectTrack[] = [{ id: 't', type: 'video', clips: [c] }]

    const check = (t: number): void => {
      const timelineHas = visibleClips([c], t, t + EPS, 0).length > 0
      const previewHas = visibleClipsAt(tracks, t).length > 0
      expect(timelineHas).toBe(previewHas)
    }

    check(2) // inclusive start
    check(4.999999) // just before end
    check(5) // exclusive end
  })

  it('keeps malformed non-positive duration clips invisible in both paths', () => {
    const bad = clip({ id: 'bad-parity', start: 10, in: 5, out: 3 }) // duration <= 0
    const tracks: ProjectTrack[] = [{ id: 't', type: 'video', clips: [bad] }]
    const timelineHas = visibleClips([bad], 9, 12, 0).length > 0
    const previewHas = visibleClipsAt(tracks, 10).length > 0
    expect(timelineHas).toBe(false)
    expect(previewHas).toBe(false)
  })
})

describe('clipLabel', () => {
  it('derives the basename from a posix mediaRef', () => {
    expect(clipLabel(clip({ mediaRef: 'media/intro.mp4' }))).toBe('intro.mp4')
  })

  it('derives the basename from a windows-style mediaRef', () => {
    expect(clipLabel(clip({ mediaRef: 'media\\clip\\b-roll.mov' }))).toBe('b-roll.mov')
  })

  it('returns the whole ref when there is no separator', () => {
    expect(clipLabel(clip({ mediaRef: 'audio.wav' }))).toBe('audio.wav')
  })

  it('falls back to the clip id when the ref is empty', () => {
    expect(clipLabel(clip({ id: 'fallback', mediaRef: '' }))).toBe('fallback')
  })
})

describe('waveformBars', () => {
  it('returns the requested number of bars in (0, 1]', () => {
    const bars = waveformBars('clip-a', 16)
    expect(bars).toHaveLength(16)
    for (const b of bars) {
      expect(b).toBeGreaterThan(0)
      expect(b).toBeLessThanOrEqual(1)
    }
  })

  it('is deterministic for the same id (no randomness)', () => {
    expect(waveformBars('clip-a', 24)).toEqual(waveformBars('clip-a', 24))
  })

  it('differs across ids', () => {
    expect(waveformBars('clip-a', 24)).not.toEqual(waveformBars('clip-b', 24))
  })

  it('returns an empty array for a non-positive count', () => {
    expect(waveformBars('clip-a', 0)).toEqual([])
    expect(waveformBars('clip-a', -3)).toEqual([])
  })
})

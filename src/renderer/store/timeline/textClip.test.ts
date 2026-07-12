import { describe, expect, it } from 'vitest'
import type { Project } from '../../../shared/storage'
import type { Clip } from '../../../shared/project-schema'
import { defaultTransform } from '../../../shared/project-schema'
import { setClipText, setClipTextLines, addTrack, addClip } from './reducers'
import { setClipTextCommand } from './commands'
import {
  buildTextClip,
  defaultTextFont,
  linesEqual,
  linesToValue,
  valueToLines,
  TEXT_CLIP_MEDIA_REF,
  DEFAULT_TEXT_DURATION_SEC
} from './textClip'
import { DEFAULT_FONT_FAMILY, defaultFallbackChain, GENERIC_SANS } from '../../../shared/fontRegistry'

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

describe('setClipText / setClipTextLines reducers', () => {
  it('creates a text surface when the clip has none, immutably', () => {
    const p0 = makeProject([makeClip('c1')])
    const next = setClipText(p0, 'c1', { lines: ['hello'], align: 'center' })
    expect(next.tracks[0].clips[0].text).toEqual({ lines: ['hello'], align: 'center' })
    expect(p0.tracks[0].clips[0].text).toBeUndefined()
    expect(next).not.toBe(p0)
  })

  it('shallow-merges over an existing text surface (unspecified keys kept)', () => {
    const p0 = makeProject([makeClip('c1', { text: { lines: ['a'], align: 'left' } })])
    const next = setClipText(p0, 'c1', { lines: ['a', 'b'] })
    expect(next.tracks[0].clips[0].text).toEqual({ lines: ['a', 'b'], align: 'left' })
  })

  it('setClipTextLines replaces only lines', () => {
    const p0 = makeProject([makeClip('c1', { text: { lines: ['x'], align: 'right' } })])
    const next = setClipTextLines(p0, 'c1', ['one', 'two', 'three'])
    expect(next.tracks[0].clips[0].text).toEqual({
      lines: ['one', 'two', 'three'],
      align: 'right'
    })
  })

  it('is a no-op when the clip is absent', () => {
    const p0 = makeProject([makeClip('c1')])
    expect(setClipText(p0, 'nope', { lines: ['z'] })).toBe(p0)
  })

  it('leaves other clips untouched', () => {
    const p0 = makeProject([makeClip('c1'), makeClip('c2')])
    const next = setClipTextLines(p0, 'c1', ['edited'])
    expect(next.tracks[0].clips[1]).toBe(p0.tracks[0].clips[1])
  })

  it('handles empty + multi-line manual breaks', () => {
    const p0 = makeProject([makeClip('c1')])
    const next = setClipTextLines(p0, 'c1', ['line 1', '', 'line 3'])
    expect(next.tracks[0].clips[0].text?.lines).toEqual(['line 1', '', 'line 3'])
  })
})

describe('setClipTextCommand round-trip', () => {
  it('apply then invert restores the prior text exactly (existing surface)', () => {
    const p0 = makeProject([makeClip('c1', { text: { lines: ['old'], align: 'left' } })])
    const cmd = setClipTextCommand(p0, 'c1', { lines: ['new', 'second'] })
    expect(cmd.invert(cmd.apply(p0))).toEqual(p0)
  })

  it('invert removes a key that did not exist before (back to undefined)', () => {
    const p0 = makeProject([makeClip('c1')]) // no text surface
    const cmd = setClipTextCommand(p0, 'c1', { lines: ['hi'] })
    const applied = cmd.apply(p0)
    expect(applied.tracks[0].clips[0].text?.lines).toEqual(['hi'])
    const reverted = cmd.invert(applied)
    expect(reverted.tracks[0].clips[0].text?.lines).toBeUndefined()
  })

  it('invert restores ONLY the patched keys to their prior values', () => {
    const p0 = makeProject([makeClip('c1', { text: { lines: ['a'], align: 'center' } })])
    const cmd = setClipTextCommand(p0, 'c1', { lines: ['b'] })
    const reverted = cmd.invert(cmd.apply(p0))
    expect(reverted.tracks[0].clips[0].text).toEqual({ lines: ['a'], align: 'center' })
  })

  it('is a no-op pair when the clip is absent', () => {
    const p0 = makeProject([makeClip('c1')])
    const cmd = setClipTextCommand(p0, 'nope', { lines: ['x'] })
    expect(cmd.invert(cmd.apply(p0))).toEqual(p0)
  })
})

describe('valueToLines (manual breaks)', () => {
  it('splits on \\n — one entry per manual break', () => {
    expect(valueToLines('a\nb\nc')).toEqual(['a', 'b', 'c'])
  })

  it('preserves empty lines (blank manual breaks are real slots)', () => {
    expect(valueToLines('a\n\nc')).toEqual(['a', '', 'c'])
    // Trailing break keeps a final empty entry.
    expect(valueToLines('a\n')).toEqual(['a', ''])
  })

  it('a single (break-free) value is one line', () => {
    expect(valueToLines('hello world')).toEqual(['hello world'])
  })

  it('an empty value is a single empty line (not zero lines)', () => {
    expect(valueToLines('')).toEqual([''])
  })

  it('normalizes CRLF and lone CR to \\n (no stray carriage returns stored)', () => {
    expect(valueToLines('a\r\nb')).toEqual(['a', 'b'])
    expect(valueToLines('a\rb')).toEqual(['a', 'b'])
    expect(valueToLines('a\r\nb\rc\nd')).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('linesToValue + round-trip', () => {
  it('joins with a single \\n per break', () => {
    expect(linesToValue(['a', 'b', 'c'])).toBe('a\nb\nc')
    expect(linesToValue([''])).toBe('')
  })

  it('round-trips lines → value → lines unchanged (incl. empties)', () => {
    for (const lines of [['Text'], ['a', '', 'c'], ['', 'x'], ['only'], ['']]) {
      expect(valueToLines(linesToValue(lines))).toEqual(lines)
    }
  })
})

describe('linesEqual', () => {
  it('true only when count + every entry match', () => {
    expect(linesEqual(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(linesEqual(['a'], ['a', ''])).toBe(false)
    expect(linesEqual(['a', 'b'], ['a', 'c'])).toBe(false)
    expect(linesEqual([], [])).toBe(true)
  })
})

describe('buildTextClip', () => {
  it('builds a valid text clip with the media sentinel + default content', () => {
    const clip = buildTextClip({ id: 't1', start: 2 })
    expect(clip.id).toBe('t1')
    expect(clip.mediaRef).toBe(TEXT_CLIP_MEDIA_REF)
    expect(clip.mediaRef).toBe('')
    expect(clip.in).toBe(0)
    expect(clip.out).toBe(DEFAULT_TEXT_DURATION_SEC)
    expect(clip.start).toBe(2)
    // Indic-first default (P6.17): the new text clip carries the Tamil-capable
    // global default family + the per-script fallback chain so Tamil shapes
    // out of the box without the user picking a font.
    expect(clip.text).toEqual({
      lines: ['Text'],
      align: 'center',
      font: { family: DEFAULT_FONT_FAMILY, fallback: defaultFallbackChain() }
    })
    expect(clip.transform).toEqual(defaultTransform())
  })

  it('defaults to a Tamil-capable family + a fallback chain ending in Latin + generic', () => {
    const f = defaultTextFont()
    const family = f.family as string
    const fallback = f.fallback as string[]
    expect(family).toBe(DEFAULT_FONT_FAMILY)
    expect(family.toLowerCase()).toContain('tamil')
    expect(Array.isArray(fallback)).toBe(true)
    expect(fallback[0]).toBe(DEFAULT_FONT_FAMILY)
    expect(fallback[fallback.length - 1]).toBe(GENERIC_SANS)
    expect(fallback).toContain('Inter')
  })

  it('respects overrides for duration + text content', () => {
    const clip = buildTextClip({
      id: 't2',
      start: 0,
      durationSec: 7,
      text: { lines: ['one', 'two'], align: 'left' }
    })
    expect(clip.out).toBe(7)
    expect(clip.text).toEqual({ lines: ['one', 'two'], align: 'left' })
  })

  it('lands on a text-type track via the pure reducer path', () => {
    const p0 = makeProject([])
    const withTrack = addTrack(p0, 'tx1', 'text')
    const clip = buildTextClip({ id: 't3', start: 0 })
    const next = addClip(withTrack, 'tx1', clip)
    const track = next.tracks.find((t) => t.id === 'tx1')
    expect(track?.type).toBe('text')
    expect(track?.clips).toHaveLength(1)
    expect(track?.clips[0].text?.lines).toEqual(['Text'])
  })
})

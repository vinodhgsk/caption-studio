import { describe, expect, it } from 'vitest'
import type { Project } from '../../../shared/storage'
import type { Clip } from '../../../shared/project-schema'
import type { CaptionLine } from '../../../shared/captionSync'
import {
  CAPTION_TRACK_ID,
  buildCaptionClip,
  setCaptionPositionOnClip,
  setCaptionPositionOnClips
} from './captionTrack'
import { setCaptionPositionCommand } from './commands'

function line(): CaptionLine {
  return {
    text: 'hello world',
    start: 0,
    out: 1,
    words: [
      { text: 'hello', start: 0, end: 0.5 },
      { text: 'world', start: 0.5, end: 1 }
    ]
  }
}

function makeCaptionClip(id: string): Clip {
  return buildCaptionClip({ id, line: line(), lang: 'en' })
}

function makeProject(captionClips: Clip[]): Project {
  return {
    version: 1,
    id: 'p1',
    name: 'P',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    settings: {
      fps: 30,
      resolution: [1080, 1920],
      aspect: '9:16',
      background: '#000000',
      language: 'en',
      languages: ['en']
    },
    storage: { location: 'local', root: '/tmp' },
    tracks: [
      { id: 'vid', type: 'video', clips: [] },
      { id: CAPTION_TRACK_ID, type: 'text', clips: captionClips }
    ]
  }
}

describe('setCaptionPositionOnClip (pure)', () => {
  it('sets transform.y + captionAnchor, leaves other fields intact', () => {
    const clip = makeCaptionClip('c1')
    const out = setCaptionPositionOnClip(clip, 'center', 0)
    expect(out.transform.y).toBe(0)
    expect(out.transform.captionAnchor).toBe('center')
    // content/timing preserved
    expect(out.text?.lines).toEqual(['hello world'])
    expect(out.caption).toEqual(clip.caption)
    // other transform fields unchanged
    expect(out.transform.x).toBe(clip.transform.x)
    expect(out.transform.scale).toBe(clip.transform.scale)
  })

  it('does not mutate the input clip', () => {
    const clip = makeCaptionClip('c1')
    const before = structuredClone(clip)
    setCaptionPositionOnClip(clip, 'custom', 123)
    expect(clip).toEqual(before)
  })
})

describe('setCaptionPositionOnClips (pure)', () => {
  it('positions every caption clip, leaves other tracks alone', () => {
    const p0 = makeProject([makeCaptionClip('c1'), makeCaptionClip('c2')])
    const out = setCaptionPositionOnClips(p0, 'lower-third', 300)
    const track = out.tracks.find((t) => t.id === CAPTION_TRACK_ID)!
    for (const c of track.clips) {
      expect(c.transform.y).toBe(300)
      expect(c.transform.captionAnchor).toBe('lower-third')
    }
    expect(out.tracks.find((t) => t.id === 'vid')).toBe(p0.tracks.find((t) => t.id === 'vid'))
  })

  it('no Caption track → returns the project unchanged', () => {
    const p0: Project = { ...makeProject([]), tracks: [{ id: 'vid', type: 'video', clips: [] }] }
    expect(setCaptionPositionOnClips(p0, 'center', 0)).toBe(p0)
  })
})

describe('setCaptionPositionCommand (undoable)', () => {
  it('switching anchor is undoable — restores prior y/anchor exactly', () => {
    // Start lower-third at y=300.
    const p0 = makeProject([
      setCaptionPositionOnClip(makeCaptionClip('c1'), 'lower-third', 300),
      setCaptionPositionOnClip(makeCaptionClip('c2'), 'lower-third', 300)
    ])
    // Switch to center at y=0.
    const cmd = setCaptionPositionCommand(p0, 'center', 0)
    const applied = cmd.apply(p0)
    const track = applied.tracks.find((t) => t.id === CAPTION_TRACK_ID)!
    for (const c of track.clips) {
      expect(c.transform.y).toBe(0)
      expect(c.transform.captionAnchor).toBe('center')
    }
    // Undo restores the prior lower-third / y=300 exactly.
    expect(cmd.invert(applied)).toEqual(p0)
  })

  it('chained anchor switches each undo one step', () => {
    const p0 = makeProject([makeCaptionClip('c1')])
    const cmd1 = setCaptionPositionCommand(p0, 'lower-third', 300)
    const p1 = cmd1.apply(p0)
    const cmd2 = setCaptionPositionCommand(p1, 'custom', -120)
    const p2 = cmd2.apply(p1)

    expect(p2.tracks.find((t) => t.id === CAPTION_TRACK_ID)!.clips[0].transform.captionAnchor).toBe(
      'custom'
    )
    expect(cmd2.invert(p2)).toEqual(p1)
    expect(cmd1.invert(cmd2.invert(p2))).toEqual(p0)
  })

  it('no Caption track → command is a no-op both ways', () => {
    const p0: Project = { ...makeProject([]), tracks: [{ id: 'vid', type: 'video', clips: [] }] }
    const cmd = setCaptionPositionCommand(p0, 'center', 0)
    expect(cmd.apply(p0)).toBe(p0)
    expect(cmd.invert(p0)).toBe(p0)
  })
})

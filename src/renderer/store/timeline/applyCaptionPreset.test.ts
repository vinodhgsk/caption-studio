import { describe, expect, it } from 'vitest'
import type { Project } from '../../../shared/storage'
import type { Clip } from '../../../shared/project-schema'
import { getCaptionPreset } from '../../../shared/captionPresetRegistry'
import { captionPresetToClipStyle } from '../../../shared/captionPreset'
import {
  CAPTION_TRACK_ID,
  buildCaptionClip,
  stampPresetOntoClip,
  stampPresetOntoClips
} from './captionTrack'
import { applyCaptionPresetCommand } from './commands'
import type { CaptionLine } from '../../../shared/captionSync'

/** A Tamil caption line so lines/lang/words preservation is exercised on Indic text. */
function tamilLine(): CaptionLine {
  const words = [
    { text: 'வணக்கம்', start: 0, end: 0.5 },
    { text: 'நண்பர்களே', start: 0.5, end: 1.2 }
  ]
  return { text: 'வணக்கம் நண்பர்களே', start: 0, out: 1.2, words }
}

/** A caption clip with content + timing, built via the real builder. */
function makeCaptionClip(id: string): Clip {
  return buildCaptionClip({ id, line: tamilLine(), lang: 'ta' })
}

function makeProject(captionClips: Clip[], captions?: Project['captions']): Project {
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
      language: 'ta',
      languages: ['ta']
    },
    storage: { location: 'local', root: '/tmp' },
    tracks: [
      { id: 'vid', type: 'video', clips: [] },
      { id: CAPTION_TRACK_ID, type: 'text', clips: captionClips }
    ],
    ...(captions !== undefined ? { captions } : {})
  }
}

const POP = getCaptionPreset('pop-by-word')!
const TYPEWRITER = getCaptionPreset('typewriter')!

describe('stampPresetOntoClip (pure)', () => {
  it('stamps text/animation/transform from the preset', () => {
    const clip = makeCaptionClip('c1')
    const out = stampPresetOntoClip(clip, POP)
    const style = captionPresetToClipStyle(POP)

    // animation comes wholesale from the preset
    expect(out.animation).toEqual(style.animation)
    // transform merged with the layout-anchor patch
    expect(out.transform).toEqual({ ...clip.transform, ...style.transformPatch })
    // style text fields come from the preset (font/fill/stroke/align…)
    expect(out.text?.font).toEqual(style.text.font)
    expect(out.text?.fill).toEqual(style.text.fill)
    expect(out.text?.align).toEqual(style.text.align)
    expect(out.text?.stroke).toEqual(style.text.stroke)
  })

  it('preserves lines, lang, and caption.words', () => {
    const clip = makeCaptionClip('c1')
    const out = stampPresetOntoClip(clip, POP)
    expect(out.text?.lines).toEqual(['வணக்கம் நண்பர்களே'])
    expect(out.text?.lang).toBe('ta')
    expect(out.caption).toEqual(clip.caption)
    // identity of words content preserved
    expect(out.caption?.words.map((w) => w.text)).toEqual(['வணக்கம்', 'நண்பர்களே'])
  })

  it('does not mutate the input clip', () => {
    const clip = makeCaptionClip('c1')
    const before = structuredClone(clip)
    stampPresetOntoClip(clip, POP)
    expect(clip).toEqual(before)
  })

  it('switching presets replaces style wholesale (no cruft)', () => {
    const clip = makeCaptionClip('c1')
    // pop-by-word HAS a stroke; typewriter has NONE → stroke must disappear.
    const popped = stampPresetOntoClip(clip, POP)
    expect(popped.text?.stroke).toBeDefined()
    const typed = stampPresetOntoClip(popped, TYPEWRITER)
    const typedStyle = captionPresetToClipStyle(TYPEWRITER)
    expect(typed.text?.stroke).toBeUndefined()
    expect(typed.text).toEqual({
      ...typedStyle.text,
      lines: ['வணக்கம் நண்பர்களே'],
      lang: 'ta'
    })
    expect(typed.animation).toEqual(typedStyle.animation)
  })
})

describe('stampPresetOntoClips (pure)', () => {
  it('stamps every caption clip and leaves other tracks alone', () => {
    const p0 = makeProject([makeCaptionClip('c1'), makeCaptionClip('c2')])
    const out = stampPresetOntoClips(p0, POP)
    const captionTrack = out.tracks.find((t) => t.id === CAPTION_TRACK_ID)!
    const style = captionPresetToClipStyle(POP)
    expect(captionTrack.clips).toHaveLength(2)
    for (const c of captionTrack.clips) {
      expect(c.animation).toEqual(style.animation)
      expect(c.text?.font).toEqual(style.text.font)
      expect(c.text?.lines).toEqual(['வணக்கம் நண்பர்களே'])
      expect(c.text?.lang).toBe('ta')
    }
    // the video track is untouched (referential equality kept by map)
    expect(out.tracks.find((t) => t.id === 'vid')).toBe(p0.tracks.find((t) => t.id === 'vid'))
  })

  it('no Caption track → returns the project unchanged', () => {
    const p0: Project = {
      ...makeProject([]),
      tracks: [{ id: 'vid', type: 'video', clips: [] }]
    }
    expect(stampPresetOntoClips(p0, POP)).toBe(p0)
  })
})

describe('applyCaptionPresetCommand (undoable)', () => {
  it('sets captions.styleId and stamps every clip; undo restores exactly', () => {
    const p0 = makeProject([makeCaptionClip('c1'), makeCaptionClip('c2')])
    const cmd = applyCaptionPresetCommand(p0, POP)
    const applied = cmd.apply(p0)

    expect(applied.captions?.styleId).toBe('pop-by-word')
    const track = applied.tracks.find((t) => t.id === CAPTION_TRACK_ID)!
    const style = captionPresetToClipStyle(POP)
    for (const c of track.clips) {
      expect(c.animation).toEqual(style.animation)
      expect(c.text?.lines).toEqual(['வணக்கம் நண்பர்களே'])
      expect(c.caption?.words).toHaveLength(2)
    }

    // undo restores the full prior project (no styleId key, prior clips).
    expect(cmd.invert(applied)).toEqual(p0)
  })

  it('undo drops the styleId key when there was none before', () => {
    const p0 = makeProject([makeCaptionClip('c1')])
    expect(p0.captions).toBeUndefined()
    const cmd = applyCaptionPresetCommand(p0, POP)
    const applied = cmd.apply(p0)
    expect(applied.captions?.styleId).toBe('pop-by-word')
    const undone = cmd.invert(applied)
    expect('captions' in undone).toBe(false)
    expect(undone).toEqual(p0)
  })

  it('preserves an existing captions block (language/transcript) on apply', () => {
    const p0 = makeProject([makeCaptionClip('c1')], {
      language: 'ta',
      transcript: 'cache/transcript.json'
    })
    const cmd = applyCaptionPresetCommand(p0, POP)
    const applied = cmd.apply(p0)
    expect(applied.captions).toEqual({
      language: 'ta',
      transcript: 'cache/transcript.json',
      styleId: 'pop-by-word'
    })
    expect(cmd.invert(applied)).toEqual(p0)
  })

  it('switching presets twice ends in the second preset (no cruft) and undoes cleanly', () => {
    const p0 = makeProject([makeCaptionClip('c1')])
    const cmd1 = applyCaptionPresetCommand(p0, POP)
    const p1 = cmd1.apply(p0)
    const cmd2 = applyCaptionPresetCommand(p1, TYPEWRITER)
    const p2 = cmd2.apply(p1)

    expect(p2.captions?.styleId).toBe('typewriter')
    const typedStyle = captionPresetToClipStyle(TYPEWRITER)
    const clip = p2.tracks.find((t) => t.id === CAPTION_TRACK_ID)!.clips[0]
    // pop-by-word's stroke must be gone (typewriter has none) — no accumulation.
    expect(clip.text?.stroke).toBeUndefined()
    expect(clip.text).toEqual({
      ...typedStyle.text,
      lines: ['வணக்கம் நண்பர்களே'],
      lang: 'ta'
    })

    // peel back to p1, then to p0
    expect(cmd2.invert(p2)).toEqual(p1)
    expect(cmd1.invert(cmd2.invert(p2))).toEqual(p0)
  })
})

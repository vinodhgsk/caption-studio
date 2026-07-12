import { describe, expect, it } from 'vitest'
import type { Project } from '../../../shared/storage'
import type { Transcript, Word } from '../../../shared/stt'
import type { CaptionLine } from '../../../shared/captionSync'
import { groupWordsIntoLines } from '../../../shared/captionSync'
import {
  CAPTION_TRACK_ID,
  CAPTION_TRACK_TYPE,
  buildCaptionClip,
  buildCaptionClips,
  buildCaptionClipsFromTranscript,
  defaultCaptionStyle,
  transcriptFromCaptionClips
} from './captionTrack'
import { generateCaptionsCommand } from './commands'
import { TEXT_CLIP_MEDIA_REF } from './textClip'

/** Deterministic id minter so tests don't depend on crypto.randomUUID. */
function seqIds(prefix = 'cap'): () => string {
  let n = 0
  return () => `${prefix}-${n++}`
}

function word(text: string, start: number, end: number): Word {
  return { text, start, end }
}

function line(text: string, words: Word[]): CaptionLine {
  return { text, start: words[0].start, out: words[words.length - 1].end, words }
}

function makeProject(tracks: Project['tracks'] = []): Project {
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

describe('buildCaptionClip', () => {
  it('maps line.start→clip.start and stores DURATION in clip.out (in=0) with the media sentinel', () => {
    const ln = line('hello world', [word('hello', 1.0, 1.4), word('world', 1.5, 2.0)])
    const clip = buildCaptionClip({ id: 'c1', line: ln, lang: 'en' })
    expect(clip.id).toBe('c1')
    expect(clip.start).toBe(1.0)
    // `out` is the clip DURATION (line span), so the on-screen END is start+out = 2.0.
    expect(clip.out).toBeCloseTo(1.0, 10)
    expect(clip.start + clip.out).toBeCloseTo(2.0, 10)
    expect(clip.in).toBe(0)
    expect(clip.mediaRef).toBe(TEXT_CLIP_MEDIA_REF)
    expect(clip.mediaRef).toBe('')
  })

  it('puts the line text in text.lines and applies the default caption style + lang', () => {
    const ln = line('namaste', [word('namaste', 0, 0.8)])
    const clip = buildCaptionClip({ id: 'c1', line: ln, lang: 'hi' })
    expect(clip.text?.lines).toEqual(['namaste'])
    expect(clip.text?.lang).toBe('hi')
    const style = defaultCaptionStyle()
    expect(clip.text?.align).toBe(style.align)
    expect(clip.text?.font).toEqual(style.font)
    expect(clip.text?.fill).toEqual(style.fill)
    expect(clip.text?.stroke).toEqual(style.stroke)
  })

  it('preserves per-word timing on clip.caption.words (for active-word highlight)', () => {
    const words = [word('one', 0.1, 0.5), word('two', 0.6, 1.0), word('three', 1.1, 1.7)]
    const ln = line('one two three', words)
    const clip = buildCaptionClip({ id: 'c1', line: ln })
    expect(clip.caption?.words).toEqual([
      { text: 'one', start: 0.1, end: 0.5 },
      { text: 'two', start: 0.6, end: 1.0 },
      { text: 'three', start: 1.1, end: 1.7 }
    ])
    // clip END (start + duration) matches the LAST word's end → ±0 frame at the spoken end.
    expect(clip.start + clip.out).toBeCloseTo(1.7, 10)
    // clip.start matches the FIRST word's start.
    expect(clip.start).toBe(0.1)
  })

  it('omits lang when not provided', () => {
    const clip = buildCaptionClip({ id: 'c1', line: line('hi', [word('hi', 0, 0.3)]) })
    expect(clip.text?.lang).toBeUndefined()
  })
})

describe('buildCaptionClips', () => {
  it('N lines → N clips, in order, with sequential ids', () => {
    const lines = [
      line('first', [word('first', 0, 0.5)]),
      line('second', [word('second', 0.6, 1.2)]),
      line('third', [word('third', 1.3, 1.9)])
    ]
    const clips = buildCaptionClips(lines, seqIds(), 'en')
    expect(clips).toHaveLength(3)
    expect(clips.map((c) => c.id)).toEqual(['cap-0', 'cap-1', 'cap-2'])
    expect(clips.map((c) => c.text?.lines?.[0])).toEqual(['first', 'second', 'third'])
    expect(clips.map((c) => c.start)).toEqual([0, 0.6, 1.3])
    // `out` is a DURATION (line span); the on-screen END is start + out.
    expect(clips.map((c) => c.start + c.out)).toEqual([0.5, 1.2, 1.9])
  })

  it('empty lines → empty clip array', () => {
    expect(buildCaptionClips([], seqIds())).toEqual([])
  })
})

describe('buildCaptionClipsFromTranscript', () => {
  it('reuses groupWordsIntoLines and tags clips with the transcript language', () => {
    const words = [word('a', 0, 0.3), word('b', 0.4, 0.7), word('c', 0.8, 1.1)]
    const transcript: Transcript = { language: 'ta', words }
    const opts = { maxCharsPerLine: 3 }
    const clips = buildCaptionClipsFromTranscript(transcript, seqIds(), opts)

    // Same grouping the pure P4.6 helper produces (we do not reimplement it).
    const lines = groupWordsIntoLines(words, opts)
    expect(clips).toHaveLength(lines.length)
    for (let i = 0; i < lines.length; i++) {
      expect(clips[i].start).toBe(lines[i].start)
      // clip END (start + duration) equals the line's absolute end.
      expect(clips[i].start + clips[i].out).toBeCloseTo(lines[i].out, 10)
      expect(clips[i].text?.lines).toEqual([lines[i].text])
    }
    expect(clips.every((c) => c.text?.lang === 'ta')).toBe(true)
  })

  it('empty transcript → empty clip array (no-op generation)', () => {
    const transcript: Transcript = { language: 'ta', words: [] }
    expect(buildCaptionClipsFromTranscript(transcript, seqIds())).toEqual([])
  })

  it('works across the six supported languages (clip END == last word end, ±0)', () => {
    const samples: Array<[Transcript['language'], string]> = [
      ['ta', 'வணக்கம்'],
      ['te', 'నమస్తే'],
      ['ml', 'നമസ്കാരം'],
      ['kn', 'ನಮಸ್ಕಾರ'],
      ['hi', 'नमस्ते'],
      ['en', 'hello']
    ]
    for (const [lang, text] of samples) {
      const transcript: Transcript = { language: lang, words: [word(text, 2.0, 2.9)] }
      const clips = buildCaptionClipsFromTranscript(transcript, seqIds())
      expect(clips).toHaveLength(1)
      expect(clips[0].start).toBe(2.0)
      expect(clips[0].start + clips[0].out).toBeCloseTo(2.9, 10)
      expect(clips[0].text?.lang).toBe(lang)
      expect(clips[0].caption?.words).toEqual([{ text, start: 2.0, end: 2.9 }])
    }
  })
})

describe('generateCaptionsCommand', () => {
  function clipsFrom(lines: CaptionLine[]): ReturnType<typeof buildCaptionClips> {
    return buildCaptionClips(lines, seqIds())
  }

  it('creates the Caption track (well-known id, text type) when none exists', () => {
    const p0 = makeProject()
    const clips = clipsFrom([line('hello', [word('hello', 0, 0.5)])])
    const next = generateCaptionsCommand(p0, clips).apply(p0)
    const track = next.tracks.find((t) => t.id === CAPTION_TRACK_ID)
    expect(track?.type).toBe(CAPTION_TRACK_TYPE)
    expect(track?.clips).toHaveLength(1)
  })

  it('REGENERATION replaces the clips and does NOT duplicate the track', () => {
    const p0 = makeProject()
    const first = clipsFrom([
      line('a', [word('a', 0, 0.5)]),
      line('b', [word('b', 0.6, 1.0)])
    ])
    const p1 = generateCaptionsCommand(p0, first).apply(p0)

    const second = buildCaptionClips([line('only', [word('only', 0, 0.4)])], seqIds('re'))
    const p2 = generateCaptionsCommand(p1, second).apply(p1)

    const captionTracks = p2.tracks.filter((t) => t.id === CAPTION_TRACK_ID)
    expect(captionTracks).toHaveLength(1) // not duplicated
    expect(captionTracks[0].clips).toHaveLength(1) // replaced, not appended
    expect(captionTracks[0].clips[0].text?.lines).toEqual(['only'])
  })

  it('empty clips → caption track exists with zero clips (no-op-ish clear)', () => {
    const p0 = makeProject()
    const next = generateCaptionsCommand(p0, []).apply(p0)
    const track = next.tracks.find((t) => t.id === CAPTION_TRACK_ID)
    expect(track?.clips).toEqual([])
  })

  it('invert removes the track it created (track absent before)', () => {
    const p0 = makeProject()
    const clips = clipsFrom([line('hello', [word('hello', 0, 0.5)])])
    const cmd = generateCaptionsCommand(p0, clips)
    expect(cmd.invert(cmd.apply(p0))).toEqual(p0)
  })

  it('invert restores the prior clip array (track existed before)', () => {
    const p0 = makeProject()
    // Seed an existing Caption track with original clips.
    const seeded = generateCaptionsCommand(
      p0,
      clipsFrom([line('orig', [word('orig', 0, 0.5)])])
    ).apply(p0)

    const regen = buildCaptionClips([line('new', [word('new', 0, 0.4)])], seqIds('n'))
    const cmd = generateCaptionsCommand(seeded, regen)
    const reverted = cmd.invert(cmd.apply(seeded))
    expect(reverted).toEqual(seeded)
  })

  it('leaves non-caption tracks untouched', () => {
    const p0 = makeProject([{ id: 'video-1', type: 'video', clips: [] }])
    const clips = clipsFrom([line('x', [word('x', 0, 0.5)])])
    const next = generateCaptionsCommand(p0, clips).apply(p0)
    expect(next.tracks.find((t) => t.id === 'video-1')).toBe(p0.tracks[0])
  })
})

describe('transcriptFromCaptionClips (Re-sync stored-transcript source)', () => {
  it('flattens per-word timing across clips IN ORDER and recovers the language', () => {
    const transcript: Transcript = {
      language: 'ta',
      words: [
        word('ஒன்று', 0.1, 0.5),
        word('இரண்டு', 0.6, 1.1),
        word('மூன்று', 2.0, 2.6)
      ]
    }
    // Build clips then reconstruct the transcript from them — round-trips words.
    const clips = buildCaptionClipsFromTranscript(transcript, seqIds())
    const recovered = transcriptFromCaptionClips(clips)
    expect(recovered).not.toBeNull()
    expect(recovered?.language).toBe('ta')
    expect(recovered?.words).toEqual(transcript.words)
  })

  it('returns null when no clip carries caption.words (nothing to regroup)', () => {
    // A plain text clip dropped on the track has no caption surface.
    const plain = buildCaptionClips([line('x', [word('x', 0, 0.5)])], seqIds())[0]
    const wordless = { ...plain, caption: undefined }
    expect(transcriptFromCaptionClips([wordless])).toBeNull()
    expect(transcriptFromCaptionClips([])).toBeNull()
  })

  it('falls back to Tamil when no clip has a supported lang tag', () => {
    const clips = buildCaptionClips([line('hi', [word('hi', 0, 0.3)])], seqIds())
    // buildCaptionClips with no lang leaves text.lang undefined.
    const recovered = transcriptFromCaptionClips(clips)
    expect(recovered?.language).toBe('ta')
  })
})

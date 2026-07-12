import { describe, expect, it } from 'vitest'
import type { Transcript } from './stt'
import {
  alignLyricsToTranscript,
  alignedFromForcedWords,
  alignedLyricsToCaptionLines,
  lyricWordSequence,
  parseLyricsInput
} from './lyricsFirst'

// ---------------------------------------------------------------------------
// Syllable/akshara timing
// ---------------------------------------------------------------------------

describe('alignLyricsToTranscript — syllable timing', () => {
  it('produces syllables on a Tamil word with multiple grapheme clusters', () => {
    const transcript: Transcript = {
      language: 'ta',
      words: [{ text: 'நெஞ்சுக்குள்', start: 1.0, end: 2.0 }]
    }
    const out = alignLyricsToTranscript({ lyrics: 'நெஞ்சுக்குள்', transcript })
    const word = out.lines[0].words[0]
    // 'நெஞ்சுக்குள்' has multiple clusters → syllables must be present
    expect(word.syllables).toBeDefined()
    expect(word.syllables!.length).toBeGreaterThan(1)
  })

  it('syllable start/end are within the parent word span', () => {
    const transcript: Transcript = {
      language: 'ta',
      words: [{ text: 'வணக்கம்', start: 0.0, end: 1.0 }]
    }
    const out = alignLyricsToTranscript({ lyrics: 'வணக்கம்', transcript })
    const syls = out.lines[0].words[0].syllables!
    for (const s of syls) {
      expect(s.start).toBeGreaterThanOrEqual(0.0 - 1e-9)
      expect(s.end).toBeLessThanOrEqual(1.0 + 1e-9)
    }
  })

  it('syllables are monotonically ordered (each start >= previous end)', () => {
    const transcript: Transcript = {
      language: 'ta',
      words: [{ text: 'நெஞ்சுக்குள்', start: 1.0, end: 3.0 }]
    }
    const out = alignLyricsToTranscript({ lyrics: 'நெஞ்சுக்குள்', transcript })
    const syls = out.lines[0].words[0].syllables!
    for (let i = 1; i < syls.length; i++) {
      expect(syls[i].start).toBeGreaterThanOrEqual(syls[i - 1].end - 1e-9)
    }
  })

  it('each syllable has an akshara field (non-empty string)', () => {
    const transcript: Transcript = {
      language: 'ta',
      words: [{ text: 'வணக்கம்', start: 0.0, end: 1.0 }]
    }
    const out = alignLyricsToTranscript({ lyrics: 'வணக்கம்', transcript })
    const syls = out.lines[0].words[0].syllables!
    for (const s of syls) {
      expect(typeof s.akshara).toBe('string')
      expect(s.akshara.length).toBeGreaterThan(0)
    }
  })

  it('syllable confidence is slightly lower than parent word confidence', () => {
    const transcript: Transcript = {
      language: 'ta',
      words: [{ text: 'வணக்கம்', start: 0.0, end: 1.0 }]
    }
    const out = alignLyricsToTranscript({ lyrics: 'வணக்கம்', transcript })
    const word = out.lines[0].words[0]
    const syl = word.syllables![0]
    expect(syl.confidence).toBeLessThanOrEqual(word.confidence)
  })

  it('single-cluster word (ASCII) produces no syllables', () => {
    const transcript: Transcript = {
      language: 'en',
      words: [{ text: 'I', start: 0.0, end: 0.2 }]
    }
    const out = alignLyricsToTranscript({ lyrics: 'I', transcript })
    // A single-character word has 1 cluster → splitWordIntoSyllables returns undefined
    expect(out.lines[0].words[0].syllables).toBeUndefined()
  })

  it('alignedLyricsToCaptionLines carries syllables through to caption words', () => {
    const transcript: Transcript = {
      language: 'ta',
      words: [{ text: 'வணக்கம்', start: 0.0, end: 1.0 }]
    }
    const out = alignLyricsToTranscript({ lyrics: 'வணக்கம்', transcript })
    const lines = alignedLyricsToCaptionLines(out.lines)
    expect(lines[0].words[0]).toHaveProperty('syllables')
    expect((lines[0].words[0] as { syllables?: unknown }).syllables).toBeDefined()
  })
})

describe('parseLyricsInput', () => {
  it('parses language + section tags and ignores comments/gaps', () => {
    const parsed = parseLyricsInput(`
[lang: ta]
# comment line
[section: verse]
நெஞ்சுக்குள் ஓடும் நதியே   # inline note
[gap: instrumental]
உன் பேரை சொல்லடி
`)

    expect(parsed.language).toBe('ta')
    expect(parsed.lines).toEqual([
      { text: 'நெஞ்சுக்குள் ஓடும் நதியே', section: 'verse' },
      { text: 'உன் பேரை சொல்லடி', section: 'verse' }
    ])
  })
})

describe('alignLyricsToTranscript', () => {
  it('keeps lyrics text as ground truth while borrowing transcript timing in order', () => {
    const transcript: Transcript = {
      language: 'en',
      words: [
        { text: 'Welcome', start: 0.5, end: 1.0 },
        { text: 'to', start: 1.0, end: 1.2 },
        { text: 'Caption', start: 1.2, end: 1.7 },
        { text: 'Studio', start: 1.7, end: 2.3 }
      ]
    }

    const out = alignLyricsToTranscript({
      lyrics: 'Welcome to\nCaption Studio',
      transcript
    })

    expect(out.language).toBe('en')
    expect(out.lines).toHaveLength(2)
    expect(out.lines[0].text).toBe('Welcome to')
    expect(out.lines[0].start).toBeCloseTo(0.5, 6)
    expect(out.lines[0].end).toBeCloseTo(1.2, 6)
    expect(out.lines[1].text).toBe('Caption Studio')
    expect(out.lines[1].start).toBeCloseTo(1.2, 6)
    expect(out.lines[1].end).toBeCloseTo(2.3, 6)
    expect(out.lines[1].words.map((w) => w.text)).toEqual(['Caption', 'Studio'])
  })

  it('synthesizes monotonic trailing timings when lyrics have extra words', () => {
    const transcript: Transcript = {
      language: 'en',
      words: [{ text: 'Only', start: 2.0, end: 2.5 }]
    }

    const out = alignLyricsToTranscript({
      lyrics: 'Only extra words',
      transcript
    })

    expect(out.lines).toHaveLength(1)
    const words = out.lines[0].words
    expect(words[0].start).toBeCloseTo(2.0, 6)
    expect(words[0].end).toBeCloseTo(2.5, 6)
    expect(words[1].start).toBeGreaterThanOrEqual(words[0].end)
    expect(words[2].start).toBeGreaterThanOrEqual(words[1].end)
    expect(words[1].confidence).toBeLessThan(words[0].confidence)
  })

  it('spreads lyrics across the whole song when no transcript timing exists', () => {
    // STT unavailable → empty transcript. With a known audio duration the words
    // should span [0, duration] instead of piling up at t=0 with a fixed step.
    const out = alignLyricsToTranscript({
      lyrics: 'one two\nthree four',
      transcript: { language: 'en', words: [] },
      audioDurationSec: 8
    })

    expect(out.lines).toHaveLength(2)
    const flat = out.lines.flatMap((l) => l.words)
    expect(flat).toHaveLength(4)
    // 4 words across 8s → 2s per word.
    expect(flat[0].start).toBeCloseTo(0, 6)
    expect(flat[3].end).toBeCloseTo(8, 6)
    // Monotonic and non-overlapping.
    for (let i = 1; i < flat.length; i++) {
      expect(flat[i].start).toBeGreaterThanOrEqual(flat[i - 1].end - 1e-9)
    }
  })

  it('falls back to the fixed step when no duration is provided', () => {
    const out = alignLyricsToTranscript({
      lyrics: 'alpha beta',
      transcript: { language: 'en', words: [] }
    })
    const words = out.lines[0].words
    // Default 0.24s per word from t=0.
    expect(words[0].start).toBeCloseTo(0, 6)
    expect(words[0].end).toBeCloseTo(0.24, 6)
    expect(words[1].start).toBeCloseTo(0.24, 6)
  })
})

describe("alignLyricsToTranscript — 'proportional' strategy", () => {
  it('distributes all lines within the vocal span (first word start → last word end)', () => {
    // Simulates a song: 4 lyric words, 2 STT segments (sparse transcript)
    const transcript: Transcript = {
      language: 'ta',
      words: [
        { text: 'wrong1', start: 2.0, end: 3.0 },
        { text: 'wrong2', start: 3.0, end: 6.0 }
      ]
    }
    const out = alignLyricsToTranscript({
      lyrics: 'வணக்கம்\nஉலகம்',
      transcript,
      strategy: 'proportional'
    })
    // All lines must start at or after vocalStart (2.0) and end at or before vocalEnd (6.0)
    for (const line of out.lines) {
      expect(line.start).toBeGreaterThanOrEqual(2.0 - 1e-9)
      expect(line.end).toBeLessThanOrEqual(6.0 + 1e-9)
    }
    // First line starts at vocalStart, last line ends at vocalEnd
    expect(out.lines[0].start).toBeCloseTo(2.0, 6)
    expect(out.lines[out.lines.length - 1].end).toBeCloseTo(6.0, 6)
  })

  it('text is user lyrics not STT output', () => {
    const transcript: Transcript = {
      language: 'ta',
      words: [{ text: 'wrong', start: 0.0, end: 5.0 }]
    }
    const out = alignLyricsToTranscript({
      lyrics: 'வணக்கம்\nஉலகம்',
      transcript,
      strategy: 'proportional'
    })
    expect(out.lines[0].text).toBe('வணக்கம்')
    expect(out.lines[1].text).toBe('உலகம்')
  })

  it('lines are monotonically ordered (no overlap)', () => {
    const transcript: Transcript = {
      language: 'ta',
      words: [{ text: 'x', start: 0.0, end: 10.0 }]
    }
    const out = alignLyricsToTranscript({
      lyrics: 'ஒன்று\nஇரண்டு\nமூன்று',
      transcript,
      strategy: 'proportional'
    })
    for (let i = 1; i < out.lines.length; i++) {
      expect(out.lines[i].start).toBeGreaterThanOrEqual(out.lines[i - 1].end - 1e-9)
    }
  })

  it('falls back to audioDurationSec span when transcript is empty', () => {
    const out = alignLyricsToTranscript({
      lyrics: 'வணக்கம்\nஉலகம்',
      transcript: { language: 'ta', words: [] },
      audioDurationSec: 10,
      strategy: 'proportional'
    })
    expect(out.lines[0].start).toBeCloseTo(0, 6)
    expect(out.lines[out.lines.length - 1].end).toBeCloseTo(10, 6)
  })

  it("confidence is 0.65 when transcript bounds exist, 0.45 when only audioDurationSec", () => {
    const withTranscript = alignLyricsToTranscript({
      lyrics: 'வணக்கம்\nஉலகம்',
      transcript: { language: 'ta', words: [{ text: 'x', start: 0, end: 5 }] },
      strategy: 'proportional'
    })
    expect(withTranscript.lines[0].confidence).toBeCloseTo(0.65, 6)

    const audioOnly = alignLyricsToTranscript({
      lyrics: 'வணக்கம்\nஉலகம்',
      transcript: { language: 'ta', words: [] },
      audioDurationSec: 10,
      strategy: 'proportional'
    })
    expect(audioOnly.lines[0].confidence).toBeCloseTo(0.45, 6)
  })
})

describe("alignLyricsToTranscript — 'auto' strategy", () => {
  it('uses proportional when lyric words >> transcript words (song case)', () => {
    // 6 lyric words, 1 transcript word → ratio 6 > 3 → proportional
    const transcript: Transcript = {
      language: 'ta',
      words: [{ text: 'stub', start: 1.0, end: 10.0 }]
    }
    const out = alignLyricsToTranscript({
      lyrics: 'வணக்கம் நண்பா\nஆடு பாடு\nவா வா',
      transcript,
      strategy: 'auto'
    })
    // Proportional: all within [1.0, 10.0]
    expect(out.lines[0].start).toBeCloseTo(1.0, 6)
    expect(out.lines[out.lines.length - 1].end).toBeCloseTo(10.0, 6)
    // Text is always user lyrics
    expect(out.lines[0].text).toBe('வணக்கம் நண்பா')
  })

  it('uses monotonic when lyric word count ≈ transcript word count (podcast case)', () => {
    // 2 lyric words, 2 transcript words → ratio 1.0 ≤ 3 → monotonic
    const transcript: Transcript = {
      language: 'ta',
      words: [
        { text: 'வணக்கம்', start: 0.0, end: 0.5 },
        { text: 'உலகம்', start: 0.55, end: 1.1 }
      ]
    }
    const out = alignLyricsToTranscript({
      lyrics: 'வணக்கம்\nஉலகம்',
      transcript,
      strategy: 'auto'
    })
    // Monotonic: line timings match transcript word timings exactly
    expect(out.lines[0].start).toBeCloseTo(0.0, 6)
    expect(out.lines[0].end).toBeCloseTo(0.5, 6)
    expect(out.lines[1].start).toBeCloseTo(0.55, 6)
    expect(out.lines[1].end).toBeCloseTo(1.1, 6)
  })
})

describe("alignLyricsToTranscript — 'segmented' (VAD phrase-sync) strategy", () => {
  const emptyTranscript: Transcript = { language: 'ta', words: [] }

  it('places every line inside a detected vocal region (never in gaps)', () => {
    // Two phrases: [1,2] and [5,6], with instrumental gaps before/between/after.
    const regions = [
      { start: 1.0, end: 2.0 },
      { start: 5.0, end: 6.0 }
    ]
    const out = alignLyricsToTranscript({
      lyrics: 'வணக்கம்\nஉலகம்',
      transcript: emptyTranscript,
      strategy: 'segmented',
      vocalRegions: regions
    })
    // Each line must sit within one of the regions.
    for (const line of out.lines) {
      const inSome = regions.some((r) => line.start >= r.start - 1e-6 && line.end <= r.end + 1e-6)
      expect(inSome).toBe(true)
    }
    // Nothing before the first region (no caption during the intro).
    expect(Math.min(...out.lines.map((l) => l.start))).toBeGreaterThanOrEqual(1.0 - 1e-6)
  })

  it('keeps user lyrics as text and produces monotonic non-overlapping lines', () => {
    const out = alignLyricsToTranscript({
      lyrics: 'ஒன்று\nஇரண்டு\nமூன்று',
      transcript: emptyTranscript,
      strategy: 'segmented',
      vocalRegions: [{ start: 0.0, end: 9.0 }]
    })
    expect(out.lines.map((l) => l.text)).toEqual(['ஒன்று', 'இரண்டு', 'மூன்று'])
    for (let i = 1; i < out.lines.length; i++) {
      expect(out.lines[i].start).toBeGreaterThanOrEqual(out.lines[i - 1].end - 1e-9)
    }
  })

  it('snaps word starts to provided onsets inside the line span', () => {
    // One region [0,4], one line of three words. Onsets at clear attack points.
    const out = alignLyricsToTranscript({
      lyrics: 'aaa bbb ccc',
      transcript: { language: 'en', words: [] },
      strategy: 'segmented',
      vocalRegions: [{ start: 0.0, end: 3.0 }],
      onsets: [0.0, 1.05, 2.02]
    })
    const words = out.lines[0].words
    expect(words).toHaveLength(3)
    // Word 2 and 3 starts should snap onto the onsets near their proportional targets.
    expect(words[1].start).toBeCloseTo(1.05, 2)
    expect(words[2].start).toBeCloseTo(2.02, 2)
    // Onset-anchored words carry the higher segmented confidence.
    expect(words[1].confidence).toBeGreaterThan(0.6)
  })

  it('falls back to proportional when no vocal regions are supplied', () => {
    const out = alignLyricsToTranscript({
      lyrics: 'one two\nthree four',
      transcript: { language: 'en', words: [] },
      audioDurationSec: 8,
      strategy: 'segmented',
      vocalRegions: []
    })
    // Proportional fallback spans [0, audioDuration].
    const flat = out.lines.flatMap((l) => l.words)
    expect(flat[0].start).toBeCloseTo(0, 6)
    expect(flat[flat.length - 1].end).toBeCloseTo(8, 6)
  })
})

describe('lyricWordSequence', () => {
  it('flattens lyric words in reading order, skipping tags and blanks', () => {
    const seq = lyricWordSequence('[lang: ta]\nவணக்கம் உலகம்\n\nநன்றி')
    expect(seq).toEqual(['வணக்கம்', 'உலகம்', 'நன்றி'])
  })
})

describe('alignedFromForcedWords (CTC mapping)', () => {
  it('maps flat word timings to lines, preserving text and order', () => {
    const out = alignedFromForcedWords({
      lyrics: 'வணக்கம் உலகம்\nநன்றி',
      language: 'ta',
      timings: [
        { start: 1.0, end: 1.4, score: 0.9 },
        { start: 1.4, end: 1.9, score: 0.8 },
        { start: 3.0, end: 3.6, score: 0.7 }
      ]
    })
    expect(out.lines).toHaveLength(2)
    expect(out.lines[0].text).toBe('வணக்கம் உலகம்')
    expect(out.lines[0].start).toBeCloseTo(1.0, 6)
    expect(out.lines[0].words.map((w) => w.text)).toEqual(['வணக்கம்', 'உலகம்'])
    expect(out.lines[1].text).toBe('நன்றி')
    expect(out.lines[1].start).toBeCloseTo(3.0, 6)
  })

  it('interpolates a null (unalignable) word between aligned neighbours', () => {
    const out = alignedFromForcedWords({
      lyrics: 'aaa bbb ccc',
      language: 'en',
      timings: [
        { start: 0.0, end: 1.0, score: 0.9 },
        null, // bbb unalignable
        { start: 2.0, end: 3.0, score: 0.9 }
      ]
    })
    const w = out.lines[0].words
    expect(w[1].start).toBeGreaterThanOrEqual(w[0].start)
    expect(w[1].start).toBeLessThanOrEqual(w[2].start)
    expect(w[1].confidence).toBe(0.4) // interpolated → low confidence
  })

  it('clamps an over-extended word end to the next word start', () => {
    const out = alignedFromForcedWords({
      lyrics: 'held next',
      language: 'en',
      timings: [
        { start: 0.0, end: 50.0, score: 0.5 }, // held note reported as 50s
        { start: 5.0, end: 6.0, score: 0.9 }
      ]
    })
    // First word must not swallow the second.
    expect(out.lines[0].words[0].end).toBeLessThanOrEqual(5.0 + 1e-6)
  })

  it('caps a line duration so it never lingers indefinitely', () => {
    const out = alignedFromForcedWords({
      lyrics: 'solo',
      language: 'en',
      timings: [{ start: 10.0, end: 90.0, score: 0.5 }]
    })
    expect(out.lines[0].end - out.lines[0].start).toBeLessThanOrEqual(7 + 1e-6)
  })

  it('returns no lines when nothing aligned (caller falls back)', () => {
    const out = alignedFromForcedWords({
      lyrics: 'a b',
      language: 'en',
      timings: [null, null]
    })
    expect(out.lines).toHaveLength(0)
  })

  it('derives higher confidence from higher acoustic score', () => {
    const out = alignedFromForcedWords({
      lyrics: 'lo hi',
      language: 'en',
      timings: [
        { start: 0.0, end: 0.5, score: 0.1 },
        { start: 0.6, end: 1.1, score: 0.95 }
      ]
    })
    const [lo, hi] = out.lines[0].words
    expect(hi.confidence).toBeGreaterThan(lo.confidence)
  })
})

describe('alignedLyricsToCaptionLines', () => {
  it('converts aligned lines to caption lines preserving confidence', () => {
    const aligned = alignLyricsToTranscript({
      lyrics: 'வணக்கம் உலகம்',
      transcript: {
        language: 'ta',
        words: [
          { text: 'வணக்கம்', start: 0.0, end: 0.5 },
          { text: 'உலகம்', start: 0.55, end: 1.1 }
        ]
      }
    })

    const lines = alignedLyricsToCaptionLines(aligned.lines)
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('வணக்கம் உலகம்')
    expect(lines[0].start).toBeCloseTo(0.0, 6)
    expect(lines[0].out).toBeCloseTo(1.1, 6)
    expect(lines[0].words[0].confidence).toBeTypeOf('number')
  })
})

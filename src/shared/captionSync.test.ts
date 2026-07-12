import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GROUPING_OPTIONS,
  graphemeLength,
  groupWordsIntoLines,
  resyncTranscript,
  type GroupingOptions
} from './captionSync'
import type { Transcript, Word } from './stt'

/**
 * Build a contiguous run of words at 0.5s each starting at `t0`, no gaps, so
 * tests can isolate char/punctuation breaks from pause-gap breaks.
 */
function seq(texts: string[], t0 = 0, dur = 0.5): Word[] {
  let t = t0
  return texts.map((text) => {
    const w: Word = { text, start: t, end: t + dur }
    t += dur
    return w
  })
}

describe('graphemeLength', () => {
  it('counts ASCII as codepoints', () => {
    expect(graphemeLength('hello')).toBe(5)
  })

  it('counts a virama-joined consonant as one cluster, not three codepoints', () => {
    // க் = KA (U+0B95) + VIRAMA (U+0BCD) is ONE grapheme cluster (UAX #29),
    // even though it is two codepoints. This is the case codepoint-counting
    // gets wrong; we must count 1.
    expect(graphemeLength('க்')).toBe(1)
    // The codepoint count would be 2 — proving Intl.Segmenter is in effect.
    expect(Array.from('க்').length).toBe(2)
  })

  it('counts a base + combining mark as one grapheme', () => {
    // தீ = TA (U+0BA4) + vowel sign II (U+0BC0) → one cluster.
    expect(graphemeLength('தீ')).toBe(1)
  })
})

describe('groupWordsIntoLines — options', () => {
  it('exposes CapCut-like defaults', () => {
    expect(DEFAULT_GROUPING_OPTIONS).toEqual({
      maxCharsPerLine: 42,
      maxLines: 2,
      pauseGapSec: 0.7
    })
  })
})

describe('groupWordsIntoLines — edge cases', () => {
  it('returns [] for empty input', () => {
    expect(groupWordsIntoLines([])).toEqual([])
  })

  it('returns a single line for a single word', () => {
    const words = seq(['hello'])
    const lines = groupWordsIntoLines(words)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toEqual({
      text: 'hello',
      start: 0,
      out: 0.5,
      words
    })
  })

  it('keeps a word LONGER than maxCharsPerLine on its own line (never split)', () => {
    const words = seq(['supercalifragilistic'], 0)
    const lines = groupWordsIntoLines(words, { maxCharsPerLine: 5 })
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('supercalifragilistic')
  })
})

describe('groupWordsIntoLines — maxChars wrapping', () => {
  it('wraps when adding a word (incl. the space) would exceed the limit', () => {
    // "aaa bbb" = 7 graphemes; limit 7 fits, limit 6 forces a wrap.
    const words = seq(['aaa', 'bbb'])
    expect(groupWordsIntoLines(words, { maxCharsPerLine: 7 })).toHaveLength(1)
    expect(groupWordsIntoLines(words, { maxCharsPerLine: 6, maxLines: 10 })).toHaveLength(2)
  })

  it('boundary: a word landing EXACTLY at the limit stays on the line', () => {
    // "ab cd" = 5 graphemes; with limit 5 it must NOT wrap.
    const words = seq(['ab', 'cd'])
    const lines = groupWordsIntoLines(words, { maxCharsPerLine: 5 })
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('ab cd')
  })

  it('boundary: one grapheme over the limit DOES wrap', () => {
    // "ab cde" = 6 graphemes; with limit 5 it wraps.
    const words = seq(['ab', 'cde'])
    const lines = groupWordsIntoLines(words, { maxCharsPerLine: 5, maxLines: 10 })
    expect(lines).toHaveLength(2)
    expect(lines.map((l) => l.text)).toEqual(['ab', 'cde'])
  })

  it('greedily fills each line before wrapping', () => {
    const words = seq(['one', 'two', 'six', 'ten'])
    // "one two" = 7, "+ six" = 11 > 10 → wrap. "six ten" = 7.
    const lines = groupWordsIntoLines(words, { maxCharsPerLine: 10, maxLines: 10 })
    expect(lines.map((l) => l.text)).toEqual(['one two', 'six ten'])
  })
})

describe('groupWordsIntoLines — maxLines blocking', () => {
  it('limits a block to maxLines before resetting the block counter', () => {
    // 4 short words, each wider than the limit pairs → force per-word lines.
    const words = seq(['aa', 'bb', 'cc', 'dd'])
    const lines = groupWordsIntoLines(words, { maxCharsPerLine: 2, maxLines: 2 })
    // Each word is its own line (limit 2, "aa bb" = 5 > 2).
    expect(lines.map((l) => l.text)).toEqual(['aa', 'bb', 'cc', 'dd'])
    // Block boundaries are an internal concern; the flat line list is unaffected
    // in count, but timing must remain contiguous and correct.
    expect(lines[0].start).toBe(0)
    expect(lines[3].out).toBe(2)
  })

  it('default maxLines is 2 (two lines fill before the block would reset)', () => {
    const words = seq(['x', 'y', 'z'])
    // limit 1 → each word its own line; with maxLines 2 we still emit 3 lines.
    const lines = groupWordsIntoLines(words, { maxCharsPerLine: 1 })
    expect(lines).toHaveLength(3)
  })

  it('block split: maxLines MULTI-word lines fill, then a new block opens (P4.12 boundary)', () => {
    // Six 3-char words, limit 7 ("aaa bbb" = 7 fits), maxLines 2. The existing
    // suite only covers ONE-word-per-line blocking; this exercises the genuine
    // boundary where two FULL lines close a block and the block counter resets
    // so the next pair starts a fresh block. The flat line list is what the
    // caption clips consume, so we assert the line texts + contiguous timing.
    const words = seq(['aaa', 'bbb', 'ccc', 'ddd', 'eee', 'fff'])
    const lines = groupWordsIntoLines(words, { maxCharsPerLine: 7, maxLines: 2 })
    // line1 "aaa bbb" (block A), line2 "ccc ddd" (block A is now full),
    // line3 "eee fff" (block B). Three lines, each a full pair.
    expect(lines.map((l) => l.text)).toEqual(['aaa bbb', 'ccc ddd', 'eee fff'])
    // Timing stays contiguous across the block boundary (no gap/overlap).
    expect(lines[0].start).toBe(0)
    expect(lines[2].out).toBe(3)
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].start).toBeGreaterThanOrEqual(lines[i - 1].out)
    }
  })

  it('block split boundary: the exact word that fills the last allowed line vs. opens a new block', () => {
    // maxLines 1 → every line is its own block. With limit 7, "aaa bbb" fills the
    // single-line block; "ccc" cannot join (block already has its one line) so it
    // opens a new block. Proves the linesInBlock>=maxLines reset fires at 1.
    const words = seq(['aaa', 'bbb', 'ccc'])
    const lines = groupWordsIntoLines(words, { maxCharsPerLine: 7, maxLines: 1 })
    expect(lines.map((l) => l.text)).toEqual(['aaa bbb', 'ccc'])
  })
})

describe('groupWordsIntoLines — punctuation breaks', () => {
  it('breaks after sentence-ending punctuation', () => {
    const words = seq(['Hello.', 'World'])
    const lines = groupWordsIntoLines(words, { maxCharsPerLine: 100, maxLines: 10 })
    expect(lines.map((l) => l.text)).toEqual(['Hello.', 'World'])
  })

  it('breaks on ? and !', () => {
    const q = groupWordsIntoLines(seq(['Why?', 'Because']), {
      maxCharsPerLine: 100,
      maxLines: 10
    })
    expect(q.map((l) => l.text)).toEqual(['Why?', 'Because'])

    const ex = groupWordsIntoLines(seq(['Stop!', 'Now']), {
      maxCharsPerLine: 100,
      maxLines: 10
    })
    expect(ex.map((l) => l.text)).toEqual(['Stop!', 'Now'])
  })

  it('breaks on the Devanagari danda (।) used by Hindi', () => {
    const words = seq(['नमस्ते।', 'फिर'])
    const lines = groupWordsIntoLines(words, { maxCharsPerLine: 100, maxLines: 10 })
    expect(lines).toHaveLength(2)
  })

  it('does NOT break mid-sentence on a comma', () => {
    const words = seq(['Hello,', 'world'])
    const lines = groupWordsIntoLines(words, { maxCharsPerLine: 100, maxLines: 10 })
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('Hello, world')
  })
})

describe('groupWordsIntoLines — pause-gap splits', () => {
  it('starts a new line when the silent gap exceeds pauseGapSec', () => {
    const first: Word = { text: 'before', start: 0, end: 0.5 }
    // 1.0s gap > default 0.7 → break.
    const second: Word = { text: 'after', start: 1.5, end: 2.0 }
    const lines = groupWordsIntoLines([first, second], { maxCharsPerLine: 100 })
    expect(lines.map((l) => l.text)).toEqual(['before', 'after'])
    expect(lines[1].start).toBe(1.5)
  })

  it('does NOT break when the gap is at or below the threshold', () => {
    const first: Word = { text: 'a', start: 0, end: 0.5 }
    // exactly 0.7s gap is NOT > 0.7 → no break.
    const second: Word = { text: 'b', start: 1.2, end: 1.5 }
    const lines = groupWordsIntoLines([first, second], {
      maxCharsPerLine: 100,
      pauseGapSec: 0.7
    })
    expect(lines).toHaveLength(1)
  })

  it('honors a custom pauseGapSec', () => {
    const first: Word = { text: 'a', start: 0, end: 0.5 }
    const second: Word = { text: 'b', start: 0.8, end: 1.0 }
    // gap 0.3 > 0.2 → break with a tighter threshold.
    const lines = groupWordsIntoLines([first, second], {
      maxCharsPerLine: 100,
      pauseGapSec: 0.2
    })
    expect(lines).toHaveLength(2)
  })
})

describe('groupWordsIntoLines — line shape & timing', () => {
  it('sets start to first word start and out to last word end', () => {
    const words = seq(['one', 'two', 'six'])
    const lines = groupWordsIntoLines(words, { maxCharsPerLine: 100, maxLines: 10 })
    expect(lines).toHaveLength(1)
    expect(lines[0].start).toBe(0)
    expect(lines[0].out).toBe(1.5)
    expect(lines[0].words).toEqual(words)
  })

  it('preserves per-word objects for active-word highlighting', () => {
    const words = seq(['hi', 'there'])
    const lines = groupWordsIntoLines(words, { maxCharsPerLine: 100 })
    expect(lines[0].words[1]).toBe(words[1])
  })

  it('produces lines in timeline order with non-overlapping segments', () => {
    const words = seq(['a', 'b', 'c', 'd'])
    const lines = groupWordsIntoLines(words, { maxCharsPerLine: 1 })
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].start).toBeGreaterThanOrEqual(lines[i - 1].out)
    }
  })

  it('every input word appears in exactly one line', () => {
    const words = seq(['one.', 'two', 'three', 'four'])
    const opts: GroupingOptions = { maxCharsPerLine: 6, maxLines: 2, pauseGapSec: 0.7 }
    const lines = groupWordsIntoLines(words, opts)
    const flat = lines.flatMap((l) => l.words)
    expect(flat).toEqual(words)
  })
})

describe('resyncTranscript', () => {
  it('regroups straight from a stored transcript (never re-transcribes)', () => {
    const transcript: Transcript = {
      language: 'ta',
      words: seq(['vanakkam', 'ulagam'])
    }
    const lines = resyncTranscript(transcript, { maxCharsPerLine: 100 })
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('vanakkam ulagam')
  })

  it('matches groupWordsIntoLines on the same words and options', () => {
    const words = seq(['a', 'b', 'c'])
    const transcript: Transcript = { language: 'en', words }
    const opts = { maxCharsPerLine: 1 }
    expect(resyncTranscript(transcript, opts)).toEqual(groupWordsIntoLines(words, opts))
  })
})

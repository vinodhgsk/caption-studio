/**
 * P4.9 VERIFICATION — "captions appear exactly when words are spoken (±1 frame)".
 *
 * This is a verification suite (no new product code): it drives a fixture
 * transcript with KNOWN word `{start,end}` times through the REAL pipeline
 *   Transcript → groupWordsIntoLines (P4.6) → buildCaptionClips (P4.7)
 * and asserts the two timing contracts of the `caption-sync` skill:
 *
 *   1. Clip-boundary alignment: every caption clip's `start` aligns to its first
 *      word's `start` and its `out` aligns to its last word's `end`, within ±1
 *      frame at the project fps. Tolerance is computed FROM frame.ts
 *      (`secondsToFrame`) — the frame index distance must be <= 1.
 *
 *   2. Active-word mapping: at a sampled playhead time inside a clip, the active
 *      word is the one whose `[start,end]` contains that time (skill §"Active-word
 *      timing"). Covered at exact word starts, exact word ends, and silent gaps.
 *
 * Pure + deterministic: no audio, no whisper binary, no IPC. fps is tested at an
 * integer (30) and a fractional/drop-frame value (29.97).
 */
import { describe, expect, it } from 'vitest'
import type { Transcript, Word } from '../../../shared/stt'
import { groupWordsIntoLines } from '../../../shared/captionSync'
import { buildCaptionClipsFromTranscript } from './captionTrack'
import { secondsToFrame } from './frame'
import { TEXT_CLIP_MEDIA_REF } from './textClip'

/** Deterministic id minter (no crypto.randomUUID dependency). */
function seqIds(prefix = 'cap'): () => string {
  let n = 0
  return () => `${prefix}-${n++}`
}

function word(text: string, start: number, end: number): Word {
  return { text, start, end }
}

/** The two fps the prompt calls out: an integer and a fractional/drop-frame one. */
const FPS_VALUES = [30, 29.97] as const

/**
 * Active-word resolver under the skill's rule: the active word is the one whose
 * half-open-ish interval contains `t`. We treat both endpoints as inclusive
 * ([start,end]) per the skill wording ("whose [start,end] contains the
 * playhead"); when two adjacent words touch, the earlier match wins (first hit),
 * and a time strictly inside a silent gap matches nothing (-1).
 *
 * NOTE: this mirrors what a compositor would do; it is defined HERE in the test
 * (not imported) because the codebase intentionally leaves highlighting to the
 * Phase 5 compositor and only persists per-word `{start,end}` on the clip.
 */
function activeWordIndex(words: Word[], t: number): number {
  for (let i = 0; i < words.length; i++) {
    if (t >= words[i].start && t <= words[i].end) return i
  }
  return -1
}

/**
 * A fixture conversation with realistic, frame-friendly seconds. Two sentences
 * so grouping produces multiple lines/blocks; a deliberate >0.7s pause gap
 * between "world." and "How" forces a block break; words are short so they fit
 * the default 42-grapheme line width (we want to exercise TIMING, not wrapping).
 */
const FIXTURE_WORDS: Word[] = [
  word('Hello', 0.5, 0.92),
  word('there', 1.0, 1.4),
  word('world.', 1.45, 2.0),
  // 0.95s silent gap (> default 0.7s pauseGap) → forces a new block here.
  word('How', 2.95, 3.2),
  word('are', 3.25, 3.5),
  word('you', 3.55, 3.9),
  word('today?', 3.95, 4.6)
]

const FIXTURE: Transcript = { language: 'en', words: FIXTURE_WORDS }

describe('P4.9 — caption clip boundaries align to spoken words within ±1 frame', () => {
  for (const fps of FPS_VALUES) {
    it(`clip.start==firstWord.start & clip END==lastWord.end within ±1 frame @ ${fps}fps`, () => {
      const lines = groupWordsIntoLines(FIXTURE_WORDS)
      const clips = buildCaptionClipsFromTranscript(FIXTURE, seqIds())

      // One clip per grouped line, in order.
      expect(clips).toHaveLength(lines.length)
      expect(clips.length).toBeGreaterThan(1) // fixture really did split into blocks

      for (let i = 0; i < clips.length; i++) {
        const clip = clips[i]
        const ln = lines[i]
        const firstWord = ln.words[0]
        const lastWord = ln.words[ln.words.length - 1]

        // `out` is the clip DURATION (in === 0); the on-screen END is start + out.
        const clipEnd = clip.start + (clip.out - clip.in)

        // Exact equality at the value level (the pipeline copies the float),
        // which trivially satisfies ±1 frame — but we ALSO assert the frame
        // distance explicitly so a future regression that nudges the time is
        // caught at the real tolerance the prompt specifies.
        const startFrameDrift = Math.abs(
          secondsToFrame(clip.start, fps) - secondsToFrame(firstWord.start, fps)
        )
        const outFrameDrift = Math.abs(
          secondsToFrame(clipEnd, fps) - secondsToFrame(lastWord.end, fps)
        )
        expect(startFrameDrift).toBeLessThanOrEqual(1)
        expect(outFrameDrift).toBeLessThanOrEqual(1)

        // And the stronger property the implementation actually guarantees.
        expect(clip.start).toBe(firstWord.start)
        expect(clipEnd).toBeCloseTo(lastWord.end, 10)
      }
    })
  }

  it('every clip spans a positive duration and clips do not overlap in frame space', () => {
    const fps = 30
    const clips = buildCaptionClipsFromTranscript(FIXTURE, seqIds())
    for (const clip of clips) {
      const clipEnd = clip.start + (clip.out - clip.in)
      expect(secondsToFrame(clipEnd, fps)).toBeGreaterThan(secondsToFrame(clip.start, fps))
      expect(clip.in).toBe(0)
      expect(clip.mediaRef).toBe(TEXT_CLIP_MEDIA_REF)
    }
    // Each clip starts no earlier (in frames) than the previous one ended.
    for (let i = 1; i < clips.length; i++) {
      const prevEnd = clips[i - 1].start + (clips[i - 1].out - clips[i - 1].in)
      expect(secondsToFrame(clips[i].start, fps)).toBeGreaterThanOrEqual(
        secondsToFrame(prevEnd, fps)
      )
    }
  })
})

describe('P4.9 — active-word mapping inside a clip (skill §Active-word timing)', () => {
  it('a time INSIDE a word maps to that word', () => {
    const clips = buildCaptionClipsFromTranscript(FIXTURE, seqIds())
    const words = clips[0].caption?.words ?? []
    expect(words.length).toBeGreaterThan(0)
    // Midpoint of the first word.
    const mid = (words[0].start + words[0].end) / 2
    expect(activeWordIndex(words as Word[], mid)).toBe(0)
    // Midpoint of the last word in that clip.
    const last = words.length - 1
    const lastMid = (words[last].start + words[last].end) / 2
    expect(activeWordIndex(words as Word[], lastMid)).toBe(last)
  })

  it('EXACT word start is active (inclusive lower bound)', () => {
    const clips = buildCaptionClipsFromTranscript(FIXTURE, seqIds())
    const words = (clips[0].caption?.words ?? []) as Word[]
    for (let i = 0; i < words.length; i++) {
      // At the exact start of word i, word i is active (it is the first whose
      // [start,end] contains t, since the gap before it belongs to no word).
      expect(activeWordIndex(words, words[i].start)).toBe(i)
    }
  })

  it('EXACT word end maps to a word containing that instant', () => {
    const clips = buildCaptionClipsFromTranscript(FIXTURE, seqIds())
    const words = (clips[0].caption?.words ?? []) as Word[]
    // For each word, its end is contained in [start,end] so it is a valid match;
    // because words in the fixture do not overlap, the match is that very word
    // (no later word starts at or before this end).
    for (let i = 0; i < words.length; i++) {
      const idx = activeWordIndex(words, words[i].end)
      expect(idx).toBe(i)
    }
  })

  it('a time in a SILENT GAP between two words matches no word (-1)', () => {
    const clips = buildCaptionClipsFromTranscript(FIXTURE, seqIds())
    const words = (clips[0].caption?.words ?? []) as Word[]
    // The fixture's first clip is "Hello there world." — gap between "Hello"
    // (ends 0.92) and "there" (starts 1.0) is 0.92..1.0.
    expect(words.length).toBeGreaterThanOrEqual(2)
    const gapTime = (words[0].end + words[1].start) / 2 // 0.96, strictly between
    expect(gapTime).toBeGreaterThan(words[0].end)
    expect(gapTime).toBeLessThan(words[1].start)
    expect(activeWordIndex(words, gapTime)).toBe(-1)
  })

  it('the BLOCK-GAP (the >0.7s pause) falls outside both clips → no active word in either', () => {
    const clips = buildCaptionClipsFromTranscript(FIXTURE, seqIds())
    expect(clips.length).toBeGreaterThanOrEqual(2)
    // "world." ends at 2.0; "How" starts at 2.95. Sample mid-gap at 2.5.
    const tGap = 2.5
    const firstClipWords = (clips[0].caption?.words ?? []) as Word[]
    const secondClipWords = (clips[1].caption?.words ?? []) as Word[]
    expect(activeWordIndex(firstClipWords, tGap)).toBe(-1)
    expect(activeWordIndex(secondClipWords, tGap)).toBe(-1)
    // And the clip whose [start, end] should be active at 2.5 is NEITHER:
    expect(tGap).toBeGreaterThan(clips[0].start + (clips[0].out - clips[0].in))
    expect(tGap).toBeLessThan(clips[1].start)
  })
})

describe('P4.9 — frame-quantized playback finds the right word across the six languages', () => {
  // One short utterance per supported language; we snap a playhead to each
  // frame across the clip and assert that whenever a word is active, the clip
  // covering that frame is the clip that owns the word (boundary correctness
  // survives frame quantization at both an integer and a fractional fps).
  const samples: Array<[Transcript['language'], string]> = [
    ['ta', 'வணக்கம்'],
    ['te', 'నమస్తే'],
    ['ml', 'നമസ്കാരം'],
    ['kn', 'ನಮಸ್ಕಾರ'],
    ['hi', 'नमस्ते'],
    ['en', 'hello']
  ]

  for (const fps of FPS_VALUES) {
    for (const [lang, text] of samples) {
      it(`[${lang}] active word stays within clip bounds when sampling per frame @ ${fps}fps`, () => {
        const words: Word[] = [word(text, 1.0, 1.5), word(text + '?', 1.55, 2.2)]
        const transcript: Transcript = { language: lang, words }
        const clips = buildCaptionClipsFromTranscript(transcript, seqIds())
        expect(clips).toHaveLength(1)
        const clip = clips[0]
        const clipWords = (clip.caption?.words ?? []) as Word[]

        // Walk every frame from the clip's start frame to its END frame
        // (END = start + duration, since `out` is the clip DURATION).
        const startFrame = secondsToFrame(clip.start, fps)
        const clipEnd = clip.start + (clip.out - clip.in)
        const outFrame = secondsToFrame(clipEnd, fps)
        for (let f = startFrame; f <= outFrame; f++) {
          const t = f / fps
          const idx = activeWordIndex(clipWords, t)
          if (idx >= 0) {
            // If a word is active at this frame, that frame is inside the clip
            // (±1 frame of the clip boundaries) — captions land on the word.
            expect(secondsToFrame(t, fps)).toBeGreaterThanOrEqual(startFrame - 1)
            expect(secondsToFrame(t, fps)).toBeLessThanOrEqual(outFrame + 1)
            // And the active word's own boundaries are within ±1 frame of where
            // we observed it (it is the word whose [start,end] contains t).
            expect(t).toBeGreaterThanOrEqual(clipWords[idx].start)
            expect(t).toBeLessThanOrEqual(clipWords[idx].end)
          }
        }

        // Spoken-onset alignment: the first word's start lands on the clip's
        // start within ±1 frame at this fps (the core P4.9 acceptance).
        expect(
          Math.abs(secondsToFrame(clip.start, fps) - secondsToFrame(words[0].start, fps))
        ).toBeLessThanOrEqual(1)
        expect(
          Math.abs(
            secondsToFrame(clip.start + (clip.out - clip.in), fps) -
            secondsToFrame(words[1].end, fps)
          )
        ).toBeLessThanOrEqual(1)
      })
    }
  }
})

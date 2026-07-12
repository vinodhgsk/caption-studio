/**
 * P5.5 — word-by-word reveal driven by transcript word times.
 *
 * Exercises the PURE reveal evaluator {@link evaluateClipReveal} (no canvas/DOM):
 *   - before clip/word start → nothing revealed (opacity 0);
 *   - at each word.start the corresponding word becomes visible;
 *   - mid-reveal easing returns a FRACTIONAL opacity;
 *   - at/after the last word.end every word is fully visible;
 *   - fixed-stagger (bounce) vs transcript-time (pop-by-word) word starts;
 *   - `none` mode shows everything immediately;
 *   - character (typewriter) mode advances by GRAPHEME CLUSTER for Tamil/Indic.
 */
import { describe, expect, it } from 'vitest'
import type { CaptionWord } from '../../../shared/project-schema'
import type { PresetReveal } from '../../../shared/captionPreset'
import {
  REVEAL_WINDOW_SEC,
  applyEasing,
  evaluateClipReveal,
  revealedWordText,
  wordRevealStart
} from './captionReveal'

function w(text: string, start: number, end: number): CaptionWord {
  return { text, start, end }
}

/** Pop-by-word default: word mode, transcript-driven (stagger 0). */
const WORD_REVEAL: PresetReveal = { mode: 'word', staggerSec: 0, easing: 'easeOut' }

/** Three words with realistic, non-overlapping spoken times. */
const WORDS: CaptionWord[] = [w('Hello', 0.5, 0.9), w('there', 1.0, 1.4), w('world', 1.5, 2.0)]
const CLIP_START = 0.5
const LAST_END = 2.0

describe('evaluateClipReveal — word mode (transcript-driven)', () => {
  it('before the clip/first word start → nothing revealed', () => {
    const r = evaluateClipReveal({ words: WORDS, reveal: WORD_REVEAL, clipStart: CLIP_START, t: 0.0 })
    expect(r.words.map((x) => x.opacity)).toEqual([0, 0, 0])
    expect(r.words.every((x) => x.revealedGraphemes === 0)).toBe(true)
  })

  it('at each word.start that word becomes visible (and later words still hidden)', () => {
    // exactly at word[0].start: word 0 begins (opacity 0 at the very first instant
    // of an eased ramp), words 1 & 2 still hidden.
    const r0 = evaluateClipReveal({ words: WORDS, reveal: WORD_REVEAL, clipStart: CLIP_START, t: WORDS[0].start })
    expect(r0.words[1].opacity).toBe(0)
    expect(r0.words[2].opacity).toBe(0)

    // a touch past each word.start (past its reveal window) → that word fully on,
    // later words still off.
    for (let i = 0; i < WORDS.length; i++) {
      const t = WORDS[i].start + REVEAL_WINDOW_SEC + 0.001
      const r = evaluateClipReveal({ words: WORDS, reveal: WORD_REVEAL, clipStart: CLIP_START, t })
      expect(r.words[i].opacity).toBe(1)
      for (let j = i + 1; j < WORDS.length; j++) {
        // later word only on if its own start already passed
        const expectedOn = WORDS[j].start + REVEAL_WINDOW_SEC < t
        expect(r.words[j].opacity > 0).toBe(expectedOn)
      }
    }
  })

  it('mid-reveal returns a FRACTIONAL opacity (eased, strictly between 0 and 1)', () => {
    const t = WORDS[0].start + REVEAL_WINDOW_SEC / 2
    const r = evaluateClipReveal({ words: WORDS, reveal: WORD_REVEAL, clipStart: CLIP_START, t })
    expect(r.words[0].opacity).toBeGreaterThan(0)
    expect(r.words[0].opacity).toBeLessThan(1)
    // easeOut at p=0.5 → 1-(0.5)^2 = 0.75
    expect(r.words[0].opacity).toBeCloseTo(0.75, 5)
  })

  it('at/after the last word.end every word is fully visible', () => {
    for (const t of [LAST_END, LAST_END + 1]) {
      const r = evaluateClipReveal({ words: WORDS, reveal: WORD_REVEAL, clipStart: CLIP_START, t })
      expect(r.words.map((x) => x.opacity)).toEqual([1, 1, 1])
      expect(r.words.map((x) => x.revealedGraphemes)).toEqual([5, 5, 5])
    }
  })

  it('window 0 → instant step (no fractional region)', () => {
    const r = evaluateClipReveal({
      words: WORDS,
      reveal: WORD_REVEAL,
      clipStart: CLIP_START,
      t: WORDS[0].start,
      windowSec: 0
    })
    expect(r.words[0].opacity).toBe(1)
    expect(r.words[1].opacity).toBe(0)
  })
})

describe('evaluateClipReveal — fixed stagger vs transcript times', () => {
  it('staggerSec=0 uses each word.start (transcript-driven)', () => {
    expect(wordRevealStart(WORDS, 0, CLIP_START, 0)).toBe(WORDS[0].start)
    expect(wordRevealStart(WORDS, 2, CLIP_START, 0)).toBe(WORDS[2].start)
  })

  it('staggerSec>0 uses clipStart + index*stagger (bounce cadence, ignores word times)', () => {
    const stagger = 0.06
    expect(wordRevealStart(WORDS, 0, CLIP_START, stagger)).toBe(CLIP_START)
    expect(wordRevealStart(WORDS, 2, CLIP_START, stagger)).toBeCloseTo(CLIP_START + 2 * stagger, 10)

    const bounce: PresetReveal = { mode: 'word', staggerSec: stagger, easing: 'spring' }
    // Just after clipStart + 2*stagger (+ window) all three words are revealed,
    // even though word[2].start (1.5s) is far in the future — stagger overrides.
    const t = CLIP_START + 2 * stagger + REVEAL_WINDOW_SEC + 0.001
    const r = evaluateClipReveal({ words: WORDS, reveal: bounce, clipStart: CLIP_START, t })
    expect(r.words.map((x) => x.opacity)).toEqual([1, 1, 1])
    expect(t).toBeLessThan(WORDS[2].start) // proves it was stagger-driven, not word-time
  })
})

describe('evaluateClipReveal — none mode', () => {
  it('shows every word immediately at any time', () => {
    const none: PresetReveal = { mode: 'none', staggerSec: 0, easing: 'linear' }
    for (const t of [0, 1, 5]) {
      const r = evaluateClipReveal({ words: WORDS, reveal: none, clipStart: CLIP_START, t })
      expect(r.words.map((x) => x.opacity)).toEqual([1, 1, 1])
    }
  })

  it('absent reveal config defaults to none (all visible)', () => {
    const r = evaluateClipReveal({ words: WORDS, clipStart: CLIP_START, t: 0 })
    expect(r.words.map((x) => x.opacity)).toEqual([1, 1, 1])
  })
})

describe('evaluateClipReveal — character (typewriter) advances by GRAPHEME CLUSTER', () => {
  // Tamil "வணக்கம்" — the segmenter clusters base+combining marks; using a fixed
  // stagger lets us count clusters deterministically. We assert the typewriter
  // never reveals a partial cluster (no mid-conjunct slice).
  const tamil = 'வணக்கம்'
  const reveal: PresetReveal = { mode: 'character', staggerSec: 0.05, easing: 'linear' }
  const words: CaptionWord[] = [w(tamil, 1.0, 2.0)]

  it('before the word start → 0 clusters revealed', () => {
    const r = evaluateClipReveal({ words, reveal, clipStart: 1.0, t: 0.5 })
    expect(r.words[0].revealedGraphemes).toBe(0)
    expect(r.words[0].opacity).toBe(0)
  })

  it('reveals one additional grapheme cluster per stagger step', () => {
    // At word.start the first cluster is on; each +0.05s adds one cluster.
    const r0 = evaluateClipReveal({ words, reveal, clipStart: 1.0, t: 1.0 })
    expect(r0.words[0].revealedGraphemes).toBe(1)
    const r1 = evaluateClipReveal({ words, reveal, clipStart: 1.0, t: 1.0 + 0.05 })
    expect(r1.words[0].revealedGraphemes).toBe(2)

    // The revealed prefix is always a whole number of clusters (cluster-safe).
    const prefix1 = revealedWordText(tamil, r1.words[0].revealedGraphemes)
    expect([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(prefix1)].length).toBe(2)
    // and it is a true prefix of the full word
    expect(tamil.startsWith(prefix1)).toBe(true)
  })

  it('after enough time every cluster is revealed (opacity 1, full text)', () => {
    const r = evaluateClipReveal({ words, reveal, clipStart: 1.0, t: 100 })
    expect(r.words[0].opacity).toBe(1)
    expect(revealedWordText(tamil, r.words[0].revealedGraphemes)).toBe(tamil)
  })
})

describe('applyEasing', () => {
  it('clamps and matches known curve values', () => {
    expect(applyEasing(-1, 'linear')).toBe(0)
    expect(applyEasing(2, 'linear')).toBe(1)
    expect(applyEasing(0.5, 'linear')).toBe(0.5)
    expect(applyEasing(0.5, 'easeIn')).toBeCloseTo(0.25, 10)
    expect(applyEasing(0.5, 'easeOut')).toBeCloseTo(0.75, 10)
    expect(applyEasing(0, 'spring')).toBe(0)
    expect(applyEasing(1, 'spring')).toBe(1)
  })
})

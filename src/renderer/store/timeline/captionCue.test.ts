/**
 * P5.7 — sound-effect CUE detection / marking / insertion, and the EXCLUSION of
 * cues from active-word highlight + word-by-word / typewriter reveal.
 *
 * Exercises the PURE cue helpers ({@link isCueText}, {@link isCueWord},
 * {@link markCueWords}, {@link insertCue}, {@link cueDrawStyle}) and verifies the
 * two evaluators ignore cue-flagged words:
 *   - detection finds bracketed cues (`[applause]`, `(laughs)`, `*sighs*`) and
 *     ignores ordinary words (incl. a word merely CONTAINING a parenthetical);
 *   - cue words are excluded from `activeWordIndex` — sweeping the playhead over a
 *     cue yields NO active word (the cue is never highlighted, and a neighbouring
 *     spoken word is not wrongly chosen);
 *   - reveal (word + character) treats a cue as fully visible immediately, never
 *     a typewriter/stagger target;
 *   - manual cue insertion places a flagged, bracket-wrapped cue in time order;
 *   - mixed lines (spoken + cue) behave correctly for both evaluators.
 */
import { describe, expect, it } from 'vitest'
import type { CaptionWord } from '../../../shared/project-schema'
import type { PresetHighlight, PresetReveal } from '../../../shared/captionPreset'
import { secondsToFrame } from './frame'
import {
  DEFAULT_CUE_DRAW_STYLE,
  bracketCueLabel,
  cueDrawStyle,
  insertCue,
  isCueText,
  isCueWord,
  isSpokenWord,
  markCueWords
} from './captionCue'
import { activeWordIndex, evaluateClipHighlight } from './captionHighlight'
import { evaluateClipReveal } from './captionReveal'

function w(text: string, start: number, end: number, kind?: 'spoken' | 'cue'): CaptionWord {
  return kind === undefined ? { text, start, end } : { text, start, end, kind }
}

const WHOLE: PresetHighlight = { enabled: true, activeColor: '#ff2d8b', activeScale: 1.2, style: 'wholeWord' }
const WORD_REVEAL: PresetReveal = { mode: 'word', staggerSec: 0, easing: 'linear' }
const CHAR_REVEAL: PresetReveal = { mode: 'character', staggerSec: 0.05, easing: 'linear' }

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

describe('isCueText — bracketed sound-effect detection', () => {
  it('detects square / paren / asterisk whole-token cues', () => {
    expect(isCueText('[applause]')).toBe(true)
    expect(isCueText('[music]')).toBe(true)
    expect(isCueText('(laughs)')).toBe(true)
    expect(isCueText('(crowd cheering)')).toBe(true)
    expect(isCueText('*sighs*')).toBe(true)
  })

  it('ignores surrounding whitespace', () => {
    expect(isCueText('  [applause] ')).toBe(true)
  })

  it('detects a cue with non-Latin (Tamil) inner content', () => {
    expect(isCueText('[தாளம்]')).toBe(true)
  })

  it('ignores ordinary words and words that merely CONTAIN a bracket', () => {
    expect(isCueText('hello')).toBe(false)
    expect(isCueText('world')).toBe(false)
    expect(isCueText('well(ish)')).toBe(false) // not a whole-token bracket
    expect(isCueText('[]')).toBe(false) // empty inner content
    expect(isCueText('()')).toBe(false)
    expect(isCueText('')).toBe(false)
    expect(isCueText('   ')).toBe(false)
  })
})

describe('isCueWord / isSpokenWord — flag OR text shape', () => {
  it('treats a kind:cue flag as a cue regardless of text', () => {
    expect(isCueWord(w('applause', 0, 1, 'cue'))).toBe(true)
    expect(isSpokenWord(w('applause', 0, 1, 'cue'))).toBe(false)
  })
  it('treats a bracketed text as a cue even without the flag', () => {
    expect(isCueWord(w('[applause]', 0, 1))).toBe(true)
  })
  it('treats a plain word as spoken', () => {
    expect(isCueWord(w('hello', 0, 1))).toBe(false)
    expect(isSpokenWord(w('hello', 0, 1))).toBe(true)
  })
})

describe('markCueWords — pure, immutable flagging', () => {
  it('flags cues and spoken words explicitly without mutating the input', () => {
    const input = [w('Hello', 0, 0.4), w('[applause]', 0.4, 1.0), w('world', 1.0, 1.4)]
    const frozen = JSON.stringify(input)
    const out = markCueWords(input)
    // spoken words stay WITHOUT a kind (implicit default); only cues are flagged.
    expect(out.map((x) => x.kind)).toEqual([undefined, 'cue', undefined])
    // input untouched (still no kind on members)
    expect(JSON.stringify(input)).toBe(frozen)
    expect(out).not.toBe(input)
  })
})

describe('cueDrawStyle', () => {
  it('returns the cue style for a cue and null for a spoken word', () => {
    expect(cueDrawStyle(w('[applause]', 0, 1))).toEqual(DEFAULT_CUE_DRAW_STYLE)
    expect(cueDrawStyle(w('hello', 0, 1))).toBeNull()
    expect(DEFAULT_CUE_DRAW_STYLE.italic).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Manual insertion
// ---------------------------------------------------------------------------

describe('bracketCueLabel', () => {
  it('wraps a bare label and leaves an already-bracketed label as-is', () => {
    expect(bracketCueLabel('applause')).toBe('[applause]')
    expect(bracketCueLabel('laughs', 'paren')).toBe('(laughs)')
    expect(bracketCueLabel('sighs', 'asterisk')).toBe('*sighs*')
    expect(bracketCueLabel('[music]')).toBe('[music]')
  })
})

describe('insertCue — manual cue insertion (time-ordered, flagged)', () => {
  const WORDS = [w('Hello', 0.5, 0.9), w('there', 1.0, 1.4), w('world', 1.5, 2.0)]

  it('inserts a bracket-wrapped, kind:cue word in start order', () => {
    const out = insertCue({ words: WORDS, label: 'applause', start: 1.2, end: 1.3 })
    expect(out.map((x) => x.text)).toEqual(['Hello', 'there', '[applause]', 'world'])
    const cue = out[2]
    expect(cue.kind).toBe('cue')
    expect(cue.start).toBe(1.2)
    expect(cue.end).toBe(1.3)
    expect(WORDS).toHaveLength(3) // input untouched
  })

  it('defaults end to start (zero-length marker) and appends past the last word', () => {
    const out = insertCue({ words: WORDS, label: '[music]', start: 9.0 })
    expect(out[out.length - 1].text).toBe('[music]')
    expect(out[out.length - 1].end).toBe(9.0)
  })

  it('inserts at the front when earlier than every word', () => {
    const out = insertCue({ words: WORDS, label: 'intro', start: 0.0, bracket: 'paren' })
    expect(out[0].text).toBe('(intro)')
    expect(out[0].kind).toBe('cue')
  })
})

// ---------------------------------------------------------------------------
// Highlight exclusion
// ---------------------------------------------------------------------------

describe('activeWordIndex — cues are excluded', () => {
  // spoken, CUE, spoken — the cue occupies [0.9,1.4)
  const MIXED = [w('Hello', 0.5, 0.9), w('[applause]', 0.9, 1.4, 'cue'), w('world', 1.4, 2.0)]

  it('a playhead inside the cue interval selects NO active word', () => {
    expect(activeWordIndex(MIXED, 1.0)).toBe(-1)
    expect(activeWordIndex(MIXED, 1.2)).toBe(-1)
  })

  it('still selects the surrounding spoken words', () => {
    expect(activeWordIndex(MIXED, 0.6)).toBe(0)
    expect(activeWordIndex(MIXED, 1.5)).toBe(2)
  })

  it('detects a cue by its bracketed TEXT even without the kind flag', () => {
    const noFlag = [w('Hi', 0.0, 0.5), w('[music]', 0.5, 1.0), w('end', 1.0, 1.5)]
    expect(activeWordIndex(noFlag, 0.7)).toBe(-1)
  })

  it('frame-by-frame sweep over the cue never highlights it', () => {
    const fps = 30
    const total = secondsToFrame(2.0, fps)
    for (let f = 0; f <= total; f++) {
      const t = f / fps
      const idx = activeWordIndex(MIXED, t)
      expect(idx).not.toBe(1) // the cue (index 1) is NEVER active
    }
  })

  it('evaluateClipHighlight never marks a cue active and keeps spoken pops', () => {
    const overCue = evaluateClipHighlight({ words: MIXED, highlight: WHOLE, t: 1.1 })
    expect(overCue.activeIndex).toBe(-1)
    expect(overCue.words[1].active).toBe(false)

    const overSpoken = evaluateClipHighlight({ words: MIXED, highlight: WHOLE, t: 1.6 })
    expect(overSpoken.activeIndex).toBe(2)
    expect(overSpoken.words[2].active).toBe(true)
    expect(overSpoken.words[2].color).toBe(WHOLE.activeColor)
  })
})

// ---------------------------------------------------------------------------
// Reveal exclusion
// ---------------------------------------------------------------------------

describe('evaluateClipReveal — cues are not revealed like spoken words', () => {
  const MIXED = [w('Hello', 0.5, 0.9), w('[applause]', 1.0, 1.4, 'cue'), w('world', 1.5, 2.0)]

  it('word mode: the cue is fully visible even before its time; spoken words still gate', () => {
    // t before everything: spoken hidden, cue shown in full.
    const early = evaluateClipReveal({ words: MIXED, reveal: WORD_REVEAL, clipStart: 0.5, t: 0.0 })
    expect(early.words[0].opacity).toBe(0) // spoken 'Hello' hidden
    expect(early.words[1].opacity).toBe(1) // cue shown
    expect(early.words[1].revealedGraphemes).toBeGreaterThan(0)
    expect(early.words[2].opacity).toBe(0) // spoken 'world' hidden
  })

  it('character mode: the cue is shown in full, never typed cluster-by-cluster', () => {
    const r = evaluateClipReveal({ words: MIXED, reveal: CHAR_REVEAL, clipStart: 0.5, t: 0.0 })
    const cue = r.words[1]
    expect(cue.opacity).toBe(1)
    // full cluster count for the cue text immediately
    expect(cue.revealedGraphemes).toBe('[applause]'.length)
  })
})

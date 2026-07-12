/**
 * P5.6 — active-word HIGHLIGHT, driven by transcript word times.
 *
 * Exercises the PURE highlight evaluator {@link evaluateClipHighlight} (no
 * canvas/DOM):
 *   - the active word is the one whose `[start,end)` contains `t`;
 *   - a frame-by-frame playhead SWEEP (at 30 and ~29.97 fps) sees the active
 *     index transition within ±1 frame of every word boundary;
 *   - boundary cases: exact word start = active, exact word end = NOT active,
 *     gaps between words = no active word, before/after the line = no active word;
 *   - `wholeWord` swaps to activeColor + scales to activeScale (eased near edges);
 *   - `wipe` progress runs 0 at the word start → 1 at the word end, GRAPHEME
 *     quantized (Tamil/Indic clusters advance one at a time);
 *   - highlight disabled / absent → no active word at all.
 */
import { describe, expect, it } from 'vitest'
import type { CaptionWord } from '../../../shared/project-schema'
import type { PresetHighlight } from '../../../shared/captionPreset'
import { secondsToFrame } from './frame'
import {
  HIGHLIGHT_EASE_WINDOW_SEC,
  activeWordIndex,
  evaluateClipHighlight,
  filledGraphemeCount,
  splitWipe,
  wipeProgressAt
} from './captionHighlight'

function w(text: string, start: number, end: number): CaptionWord {
  return { text, start, end }
}

/** Contiguous words (no gaps): each word's end == the next word's start. */
const WORDS: CaptionWord[] = [w('Hello', 0.5, 0.9), w('there', 0.9, 1.4), w('world', 1.4, 2.0)]

/** Whole-word flip (pop-by-word): color swap + scale pop. */
const WHOLE: PresetHighlight = {
  enabled: true,
  activeColor: '#ff2d8b',
  activeScale: 1.22,
  style: 'wholeWord'
}
/** Karaoke wipe: color fill left-to-right, no scale. */
const WIPE: PresetHighlight = {
  enabled: true,
  activeColor: '#39ff88',
  activeScale: 1,
  style: 'wipe'
}

describe('activeWordIndex — half-open [start,end) membership', () => {
  it('returns the word containing t', () => {
    expect(activeWordIndex(WORDS, 0.6)).toBe(0)
    expect(activeWordIndex(WORDS, 1.0)).toBe(1)
    expect(activeWordIndex(WORDS, 1.5)).toBe(2)
  })

  it('exact word.start is active; exact word.end is NOT (belongs to next word)', () => {
    // start is inclusive
    expect(activeWordIndex(WORDS, WORDS[0].start)).toBe(0)
    expect(activeWordIndex(WORDS, WORDS[1].start)).toBe(1)
    // end is exclusive — at word[0].end the NEXT word (which starts there) is active
    expect(activeWordIndex(WORDS, WORDS[0].end)).toBe(1)
    // the very last word's end → past the line, no active word
    expect(activeWordIndex(WORDS, WORDS[2].end)).toBe(-1)
  })

  it('before the line, after the line → no active word', () => {
    expect(activeWordIndex(WORDS, 0.0)).toBe(-1)
    expect(activeWordIndex(WORDS, 5.0)).toBe(-1)
  })

  it('a GAP between words → no active word', () => {
    const gapped = [w('a', 0.0, 0.4), w('b', 1.0, 1.4)]
    expect(activeWordIndex(gapped, 0.7)).toBe(-1) // 0.4 <= 0.7 < 1.0
    expect(activeWordIndex(gapped, 0.4)).toBe(-1) // exact end of 'a', before 'b'
    expect(activeWordIndex(gapped, 1.0)).toBe(1) // 'b' starts
  })
})

/**
 * Sweep the playhead frame-by-frame across the whole line and, for each word
 * boundary, assert the active-index transition happens within ±1 frame of that
 * boundary. PURE — drives only `evaluateClipHighlight`.
 */
function assertBoundariesWithinOneFrame(words: CaptionWord[], fps: number): void {
  const firstStart = words[0].start
  const lastEnd = words[words.length - 1].end
  const fStart = secondsToFrame(firstStart - 0.2, fps)
  const fEnd = secondsToFrame(lastEnd + 0.2, fps)

  // Record, per frame, which word is active (-1 = none).
  const activeAt = new Map<number, number>()
  for (let f = fStart; f <= fEnd; f++) {
    const t = f / fps
    activeAt.set(f, evaluateClipHighlight({ words, highlight: WHOLE, t }).activeIndex)
  }

  // For each word, the frame where it FIRST becomes active must be within ±1
  // frame of its start, and the frame where it STOPS being active within ±1
  // frame of its end.
  words.forEach((word, i) => {
    let firstActive = -1
    let lastActive = -1
    for (let f = fStart; f <= fEnd; f++) {
      if (activeAt.get(f) === i) {
        if (firstActive === -1) firstActive = f
        lastActive = f
      }
    }
    expect(firstActive, `word ${i} ever active`).toBeGreaterThanOrEqual(0)

    const startFrame = secondsToFrame(word.start, fps)
    // first-active frame is within one frame of the boundary frame
    expect(Math.abs(firstActive - startFrame)).toBeLessThanOrEqual(1)

    // the word turns OFF at its end; the last active frame is the frame just
    // before end. Its frame index is within one frame of the end boundary.
    const endFrame = secondsToFrame(word.end, fps)
    expect(Math.abs(lastActive - endFrame)).toBeLessThanOrEqual(1)
  })
}

describe('evaluateClipHighlight — ±1-frame boundary tracking (sweep)', () => {
  it('active-word index transitions within ±1 frame at 30 fps', () => {
    assertBoundariesWithinOneFrame(WORDS, 30)
  })

  it('active-word index transitions within ±1 frame at 29.97 fps', () => {
    assertBoundariesWithinOneFrame(WORDS, 30000 / 1001)
  })

  it('every swept frame has at most ONE active word', () => {
    const fps = 30
    for (let f = secondsToFrame(0.3, fps); f <= secondsToFrame(2.2, fps); f++) {
      const res = evaluateClipHighlight({ words: WORDS, highlight: WHOLE, t: f / fps })
      const activeCount = res.words.filter((x) => x.active).length
      expect(activeCount).toBeLessThanOrEqual(1)
      // activeIndex agrees with the per-word `active` flags
      if (res.activeIndex >= 0) {
        expect(res.words[res.activeIndex].active).toBe(true)
        expect(activeCount).toBe(1)
      } else {
        expect(activeCount).toBe(0)
      }
    }
  })
})

describe('evaluateClipHighlight — wholeWord color + scale', () => {
  it('active word swaps to activeColor; inactive words have no color', () => {
    const res = evaluateClipHighlight({ words: WORDS, highlight: WHOLE, t: 1.0 })
    expect(res.activeIndex).toBe(1)
    expect(res.words[1].color).toBe(WHOLE.activeColor)
    expect(res.words[0].color).toBeUndefined()
    expect(res.words[2].color).toBeUndefined()
  })

  it('mid-word (past the ease window) the scale reaches activeScale', () => {
    // word[2] spans [1.4,2.0]; sample deep in the middle, well past both ramps.
    const res = evaluateClipHighlight({ words: WORDS, highlight: WHOLE, t: 1.7 })
    expect(res.words[2].scale).toBeCloseTo(WHOLE.activeScale, 5)
  })

  it('near the word start the scale is eased between 1 and activeScale', () => {
    // just after word[2].start, inside the ease window → intermediate scale.
    const t = WORDS[2].start + HIGHLIGHT_EASE_WINDOW_SEC / 2
    const res = evaluateClipHighlight({ words: WORDS, highlight: WHOLE, t })
    const s = res.words[2].scale
    expect(s).toBeGreaterThan(1)
    expect(s).toBeLessThan(WHOLE.activeScale)
  })

  it('easeWindowSec=0 snaps scale to activeScale immediately at the start', () => {
    const res = evaluateClipHighlight({
      words: WORDS,
      highlight: WHOLE,
      t: WORDS[2].start,
      easeWindowSec: 0
    })
    expect(res.words[2].scale).toBe(WHOLE.activeScale)
  })

  it('inactive words always have unit scale and wipeProgress 0', () => {
    const res = evaluateClipHighlight({ words: WORDS, highlight: WHOLE, t: 1.0 })
    expect(res.words[0]).toMatchObject({ active: false, scale: 1, wipeProgress: 0 })
    expect(res.words[2]).toMatchObject({ active: false, scale: 1, wipeProgress: 0 })
  })
})

describe('evaluateClipHighlight — wipe progress (0→1, grapheme-aware)', () => {
  it('wipe is 0 at the word start and 1 at (just before) the word end', () => {
    const word = WORDS[0] // 'Hello' [0.5,0.9]
    expect(wipeProgressAt(word, word.start)).toBeCloseTo(0, 5)
    // a hair before end → fully (or all-but-one-cluster) filled; at exactly end
    // the word is no longer active, so sample just inside.
    const nearEnd = word.end - 1e-6
    expect(wipeProgressAt(word, nearEnd)).toBeGreaterThan(0.7)
  })

  it('wipe progress increases monotonically across the active word', () => {
    const word = WORDS[2] // 'world' [1.4,2.0]
    let prev = -1
    for (let t = word.start; t < word.end; t += 0.02) {
      const p = wipeProgressAt(word, t)
      expect(p).toBeGreaterThanOrEqual(prev)
      prev = p
    }
  })

  it('wipe quantizes to GRAPHEME CLUSTERS for Tamil (Indic) text', () => {
    // வணக்கம் — Tamil; its grapheme-cluster count is fewer than its codepoints.
    const tamil = w('வணக்கம்', 0, 1)
    const res = evaluateClipHighlight({ words: [tamil], highlight: WIPE, t: 0.5 })
    const p = res.words[0].wipeProgress
    // progress is a whole-cluster fraction: p * clusterCount is an integer.
    const filled = filledGraphemeCount(tamil.text, p)
    const totalClusters = filledGraphemeCount(tamil.text, 1) // progress 1 → all clusters
    expect(Number.isInteger(filled)).toBe(true)
    expect(p).toBeCloseTo(filled / totalClusters, 6)
    // and the split lands on a cluster boundary (no dotted-circle artefact).
    const { filled: left, rest } = splitWipe(tamil.text, p)
    expect(left + rest).toBe(tamil.text)
  })

  it('wipe style sets activeColor on the active word but keeps scale 1', () => {
    const res = evaluateClipHighlight({ words: WORDS, highlight: WIPE, t: 1.0 })
    expect(res.activeIndex).toBe(1)
    expect(res.words[1].color).toBe(WIPE.activeColor)
    expect(res.words[1].scale).toBe(1)
    expect(res.words[1].wipeProgress).toBeGreaterThan(0)
  })

  it('splitWipe at progress 0 → all rest; at progress 1 → all filled', () => {
    expect(splitWipe('Hello', 0)).toEqual({ filled: '', rest: 'Hello' })
    expect(splitWipe('Hello', 1)).toEqual({ filled: 'Hello', rest: '' })
  })
})

describe('evaluateClipHighlight — disabled / absent → no active word', () => {
  it('highlight.enabled === false → activeIndex -1, every word inactive', () => {
    const off: PresetHighlight = { ...WHOLE, enabled: false }
    const res = evaluateClipHighlight({ words: WORDS, highlight: off, t: 1.0 })
    expect(res.activeIndex).toBe(-1)
    expect(res.words.every((x) => !x.active && x.scale === 1 && x.wipeProgress === 0)).toBe(true)
    expect(res.words.every((x) => x.color === undefined)).toBe(true)
  })

  it('highlight absent → activeIndex -1, every word inactive', () => {
    const res = evaluateClipHighlight({ words: WORDS, t: 1.0 })
    expect(res.activeIndex).toBe(-1)
    expect(res.words.every((x) => !x.active)).toBe(true)
  })

  it('empty words → empty result, no active word', () => {
    const res = evaluateClipHighlight({ words: [], highlight: WHOLE, t: 1.0 })
    expect(res.activeIndex).toBe(-1)
    expect(res.words).toEqual([])
  })
})

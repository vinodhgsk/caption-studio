/**
 * P8R.2 — Frame reveal effect (Doc 15; skill `reveal-effects`).
 *
 * Exercises the `frame` effect through the PURE engine (no canvas/DOM):
 *   - it is registered + resolvable by `effectId: 'frame'`;
 *   - it emits ONE `frame` overlay around the measured block, expanded by `padding`,
 *     carrying thickness / radius / drawDir params and (optional) color;
 *   - the overlay's `progress` tracks the eased reveal progress at {0,.25,.5,.75,1};
 *   - GATE off → the text is always visible (identity mask); GATE on → the text is
 *     hidden (wipe coverage 0) until the border closes, then revealed (coverage 1);
 *   - defaults apply when the params bag is empty;
 *   - the catalog enumerates `frame` for the gallery.
 */
import { describe, expect, it } from 'vitest'
import type { GlyphBox, GlyphBoxLayout } from '../../routes/editor/preview/textLayout'
import { evaluateRevealEffect, getRevealEffect } from './clipRevealEffect'
import { FRAME_DEFAULTS, REVEAL_EFFECT_CATALOG, SWIPE_DEFAULTS, TYPE_DEFAULTS } from './clipRevealEffects'

const START = 1.0
const PROGRESS = [0, 0.25, 0.5, 0.75, 1] as const

const box = (x: number, y: number, width: number, height: number): GlyphBox => ({
  x,
  y,
  width,
  height
})

/** A block centered on origin: 40×20, top-left at (-20,-10). */
const LAYOUT: GlyphBoxLayout = {
  block: box(-20, -10, 40, 20),
  lines: [
    {
      line: 'hi',
      box: box(-20, -10, 40, 20),
      words: [
        {
          word: 'hi',
          box: box(-20, -10, 40, 20),
          clusters: [
            { cluster: 'h', box: box(-20, -10, 20, 20) },
            { cluster: 'i', box: box(0, -10, 20, 20) }
          ]
        }
      ]
    }
  ]
}

describe('frame effect — registration + catalog', () => {
  it('is registered under effectId "frame"', () => {
    expect(getRevealEffect('frame')).toBeDefined()
  })
  it('appears in the reveal-effect catalog', () => {
    expect(REVEAL_EFFECT_CATALOG.some((e) => e.id === 'frame')).toBe(true)
  })
})

describe('frame effect — border overlay geometry + progress', () => {
  const reveal = { effectId: 'frame', duration: 1, ease: 'linear', params: { padding: 8 } }

  it('emits one frame overlay expanded by padding, progress tracking the reveal', () => {
    for (const p of PROGRESS) {
      const out = evaluateRevealEffect({ reveal, start: START, t: START + p, layout: LAYOUT })
      expect(out.overlays).toHaveLength(1)
      const ov = out.overlays[0]
      expect(ov.kind).toBe('frame')
      // block (-20,-10,40,20) expanded by 8 on every side → (-28,-18,56,36).
      expect(ov.box).toEqual(box(-28, -18, 56, 36))
      expect(ov.progress).toBeCloseTo(p, 6)
      expect(ov.params).toMatchObject({ thickness: FRAME_DEFAULTS.thickness, padding: 8, drawDir: 'cw' })
      // The border persists once drawn → always active.
      expect(out.active).toBe(true)
    }
  })

  it('passes thickness / radius / drawDir / color params through to the overlay', () => {
    const out = evaluateRevealEffect({
      reveal: {
        effectId: 'frame',
        duration: 1,
        params: { thickness: 6, radius: 12, drawDir: 'ccw', color: '#ff0066', padding: 4 }
      },
      start: START,
      t: START + 0.5,
      layout: LAYOUT
    })
    const ov = out.overlays[0]
    expect(ov.color).toBe('#ff0066')
    expect(ov.params).toEqual({ thickness: 6, radius: 12, padding: 4, drawDir: 'ccw' })
    expect(ov.box).toEqual(box(-24, -14, 48, 28)) // padding 4
  })

  it('applies defaults when the params bag is empty', () => {
    const out = evaluateRevealEffect({
      reveal: { effectId: 'frame', duration: 1 },
      start: START,
      t: START + 0.5,
      layout: LAYOUT
    })
    const ov = out.overlays[0]
    expect(ov.color).toBeUndefined() // defaults to text color downstream
    expect(ov.params).toEqual({
      thickness: FRAME_DEFAULTS.thickness,
      radius: FRAME_DEFAULTS.radius,
      padding: FRAME_DEFAULTS.padding,
      drawDir: FRAME_DEFAULTS.drawDir
    })
  })
})

describe('frame effect — text gating', () => {
  it('GATE off (default): the text is always visible (identity mask)', () => {
    const reveal = { effectId: 'frame', duration: 1, ease: 'linear' }
    for (const p of PROGRESS) {
      const out = evaluateRevealEffect({ reveal, start: START, t: START + p, layout: LAYOUT })
      expect(out.mask.kind).toBe('none')
      expect(out.mask.coverage).toBe(1)
    }
  })

  it('GATE on: text hidden (coverage 0) until the border closes, then revealed', () => {
    const reveal = { effectId: 'frame', duration: 1, ease: 'linear', params: { gate: true } }
    // Mid-draw → hidden.
    for (const p of [0, 0.25, 0.5, 0.75]) {
      const out = evaluateRevealEffect({ reveal, start: START, t: START + p, layout: LAYOUT })
      expect(out.mask.kind).toBe('wipe')
      expect(out.mask.coverage).toBe(0)
    }
    // Border closed (progress 1) → text revealed.
    const closed = evaluateRevealEffect({ reveal, start: START, t: START + 1, layout: LAYOUT })
    expect(closed.mask.coverage).toBe(1)
  })
})

describe('swipe effect — registration + catalog', () => {
  it('is registered under effectId "swipe"', () => {
    expect(getRevealEffect('swipe')).toBeDefined()
  })
  it('appears in the reveal-effect catalog', () => {
    expect(REVEAL_EFFECT_CATALOG.some((e) => e.id === 'swipe')).toBe(true)
  })
})

describe('swipe effect — mask reveal + bar overlay', () => {
  const reveal = { effectId: 'swipe', direction: 'r', duration: 1, ease: 'linear' }

  it('reveals glyphs in the bar wake: wipe coverage tracks progress at {0,.25,.5,.75,1}', () => {
    for (const p of PROGRESS) {
      const out = evaluateRevealEffect({ reveal, start: START, t: START + p, layout: LAYOUT })
      expect(out.mask.kind).toBe('wipe')
      expect(out.mask.coverage).toBeCloseTo(p, 6)
      expect(out.mask.direction).toBe('r')
      // The bar sweeps along the front, riding the same progress.
      expect(out.overlays).toHaveLength(1)
      expect(out.overlays[0].kind).toBe('bar')
      expect(out.overlays[0].progress).toBeCloseTo(p, 6)
      expect(out.overlays[0].box).toEqual(LAYOUT.block)
      // Active while sweeping; inactive once fully revealed.
      expect(out.active).toBe(p < 1)
    }
  })

  it('passes barWidth / barColor / softness through and applies defaults', () => {
    const out = evaluateRevealEffect({
      reveal: {
        effectId: 'swipe',
        direction: 'l',
        duration: 1,
        params: { barWidth: 40, barColor: '#00ddff', softness: 6 }
      },
      start: START,
      t: START + 0.5,
      layout: LAYOUT
    })
    expect(out.mask.softness).toBe(6)
    expect(out.overlays[0].color).toBe('#00ddff')
    expect(out.overlays[0].params).toEqual({ barWidth: 40 })
  })

  it('applies defaults when the params bag is empty', () => {
    const out = evaluateRevealEffect({
      reveal: { effectId: 'swipe', duration: 1 },
      start: START,
      t: START + 0.5,
      layout: LAYOUT
    })
    expect(out.mask.softness).toBe(SWIPE_DEFAULTS.softness)
    expect(out.overlays[0].color).toBeUndefined() // defaults to text color downstream
    expect(out.overlays[0].params).toEqual({ barWidth: SWIPE_DEFAULTS.barWidth })
  })
})

describe('type effect — registration + catalog', () => {
  it('is registered under effectId "type"', () => {
    expect(getRevealEffect('type')).toBeDefined()
  })
  it('appears in the reveal-effect catalog', () => {
    expect(REVEAL_EFFECT_CATALOG.some((e) => e.id === 'type')).toBe(true)
  })
})

describe('type effect — typewriter per-cluster reveal', () => {
  // LAYOUT has two clusters: 'h' (x -20) then 'i' (x 0). Linear, duration 1.
  const reveal = { effectId: 'type', duration: 1, ease: 'linear' }

  it('reveals clusters one-by-one: revealed = floor(progress · total) at {0,.25,.5,.75,1}', () => {
    const expected = [0, 0, 1, 1, 2] // total = 2
    PROGRESS.forEach((p, k) => {
      const out = evaluateRevealEffect({ reveal, start: START, t: START + p, layout: LAYOUT })
      expect(out.unit).toBe('char')
      expect(out.perUnit).toHaveLength(2)
      const shown = out.perUnit.filter((u) => u.opacity === 1).length
      expect(shown).toBe(expected[k])
      // The typed prefix is contiguous from index 0.
      for (let i = 0; i < 2; i++) {
        expect(out.perUnit[i].opacity).toBe(i < expected[k] ? 1 : 0)
        expect(out.perUnit[i].coverage).toBe(i < expected[k] ? 1 : 0)
      }
    })
  })

  it('the base block mask stays identity (reveal carried by perUnit)', () => {
    const out = evaluateRevealEffect({ reveal, start: START, t: START + 0.5, layout: LAYOUT })
    expect(out.mask.kind).toBe('none')
    expect(out.mask.coverage).toBe(1)
  })
})

describe('type effect — caret position + blink', () => {
  it('caret sits at the next cluster while typing, then just past the last when done', () => {
    const reveal = { effectId: 'type', duration: 1, ease: 'linear' }
    // Mid: revealed 1 → caret at boxes[1] ('i') left edge x=0.
    const mid = evaluateRevealEffect({ reveal, start: START, t: START + 0.5, layout: LAYOUT })
    const caretMid = mid.overlays.find((o) => o.kind === 'caret')
    expect(caretMid?.box.x).toBe(0)
    // Done: revealed 2 → caret just past last cluster ('i' x0 + width20) → x=20.
    const done = evaluateRevealEffect({ reveal, start: START, t: START + 1, layout: LAYOUT })
    const caretDone = done.overlays.find((o) => o.kind === 'caret')
    expect(caretDone?.box.x).toBe(20)
  })

  it('caret blinks at a duration-independent rate (on first half of each period)', () => {
    // Long duration so progress stays ~0 (caret at start) and blink is isolated.
    const reveal = { effectId: 'type', duration: 100, ease: 'linear', params: { blinkPeriodSec: 1 } }
    const on = evaluateRevealEffect({ reveal, start: START, t: START + 0.2, layout: LAYOUT })
    const off = evaluateRevealEffect({ reveal, start: START, t: START + 0.6, layout: LAYOUT })
    expect(on.overlays[0].params?.on).toBe(true) // phase 0.2 < 0.5
    expect(off.overlays[0].params?.on).toBe(false) // phase 0.6 ≥ 0.5
    // One full period later the blink phase repeats (still typing → still active).
    const onAgain = evaluateRevealEffect({ reveal, start: START, t: START + 1.2, layout: LAYOUT })
    expect(onAgain.overlays[0].params?.on).toBe(true)
  })

  it('caret toggle off → no caret overlay; active follows typing only', () => {
    const reveal = { effectId: 'type', duration: 1, ease: 'linear', params: { caret: false } }
    const mid = evaluateRevealEffect({ reveal, start: START, t: START + 0.5, layout: LAYOUT })
    expect(mid.overlays).toEqual([])
    expect(mid.active).toBe(true) // still typing
    const done = evaluateRevealEffect({ reveal, start: START, t: START + 1, layout: LAYOUT })
    expect(done.active).toBe(false) // typed out, no caret
  })

  it('passes caretColor / tickCue through and applies defaults', () => {
    const out = evaluateRevealEffect({
      reveal: { effectId: 'type', duration: 1, params: { caretColor: '#ffcc00', tickCue: true } },
      start: START,
      t: START + 0.5,
      layout: LAYOUT
    })
    const caret = out.overlays[0]
    expect(caret.color).toBe('#ffcc00')
    expect(caret.params?.tickCue).toBe(true)
    expect(caret.params?.caretWidth).toBe(TYPE_DEFAULTS.caretWidth)
    expect(caret.params?.blinkPeriodSec).toBe(TYPE_DEFAULTS.blinkPeriodSec)
  })
})


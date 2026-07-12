/**
 * P8R.1 — kinetic TEXT REVEAL-EFFECTS engine (Doc 15; skill `reveal-effects`).
 *
 * Exercises the PURE engine (no canvas/DOM) through its public surface:
 *   - {@link resolveRevealEffect} reads the open `clip.animation.reveal` bag into a
 *     typed ref, and IGNORES a Doc-03 `mode`-only caption reveal (no `effectId`);
 *   - {@link evaluateRevealEffect} returns identity when there is no kinetic reveal,
 *     and otherwise drives the `wipe` (one-shot mask) / `glint` (loop overlay) proof
 *     effects at progress {0,.25,.5,.75,1};
 *   - loop continuity: `glint` at the wrap (`phase(0) == phase(period)`);
 *   - {@link revealUnitBoxes} flattens the layout to line / word / cluster boxes;
 *   - {@link registerRevealEffect} registers a custom effect that the evaluator
 *     drives, including the per-unit output channel.
 */
import { describe, expect, it } from 'vitest'
import type { GlyphBox, GlyphBoxLayout } from '../../routes/editor/preview/textLayout'
import {
  IDENTITY_REVEAL_OUTPUT,
  IDENTITY_UNIT,
  evaluateRevealEffect,
  getRevealEffect,
  registerRevealEffect,
  resolveRevealEffect,
  revealUnitBoxes,
  type RevealEffectFn
} from './clipRevealEffect'

const START = 1.0
const PROGRESS = [0, 0.25, 0.5, 0.75, 1] as const

const box = (x: number, y: number, width: number, height: number): GlyphBox => ({
  x,
  y,
  width,
  height
})

/** A minimal two-cluster, one-word, one-line layout: the word "hi". */
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

describe('resolveRevealEffect — schema normalization', () => {
  it('reads the Doc-15 bag (effectId/unit/direction/duration/ease/loop/speed/params)', () => {
    const ref = resolveRevealEffect({
      effectId: 'wipe',
      unit: 'word',
      direction: 'r',
      duration: 0.8,
      ease: 'easeOutCubic',
      loop: false,
      params: { barWidth: 12 }
    })
    expect(ref).toEqual({
      effectId: 'wipe',
      unit: 'word',
      direction: 'r',
      durationSec: 0.8,
      ease: 'easeOutCubic',
      loop: false,
      speed: 1,
      params: { barWidth: 12 }
    })
  })

  it('falls back to durationSec and applies sane defaults', () => {
    const ref = resolveRevealEffect({ effectId: 'glint', durationSec: 2, loop: true, speed: 3 })
    expect(ref?.durationSec).toBe(2)
    expect(ref?.unit).toBe('line') // default
    expect(ref?.direction).toBe('b') // default
    expect(ref?.ease).toBe('linear') // default
    expect(ref?.loop).toBe(true)
    expect(ref?.speed).toBe(3)
    expect(ref?.params).toEqual({})
  })

  it('returns undefined for an absent bag or a Doc-03 mode-only reveal', () => {
    expect(resolveRevealEffect(undefined)).toBeUndefined()
    // A caption (Doc-03) reveal carries `mode`, NOT `effectId` — not hijacked here.
    expect(resolveRevealEffect({ mode: 'word', easing: 'linear' })).toBeUndefined()
    expect(resolveRevealEffect({ effectId: '' })).toBeUndefined()
  })
})

describe('evaluateRevealEffect — identity (no kinetic reveal)', () => {
  it('returns identity when reveal is absent', () => {
    const out = evaluateRevealEffect({ reveal: undefined, start: START, t: 2, layout: LAYOUT })
    expect(out).toBe(IDENTITY_REVEAL_OUTPUT)
    expect(out.active).toBe(false)
    expect(out.mask.kind).toBe('none')
    expect(out.mask.coverage).toBe(1)
  })

  it('returns identity for an unknown effectId', () => {
    const out = evaluateRevealEffect({
      reveal: { effectId: 'does-not-exist' },
      start: START,
      t: 2,
      layout: LAYOUT
    })
    expect(out).toBe(IDENTITY_REVEAL_OUTPUT)
  })

  it('returns identity for a Doc-03 mode-only caption reveal', () => {
    const out = evaluateRevealEffect({
      reveal: { mode: 'character', easing: 'linear' },
      start: START,
      t: 2,
      layout: LAYOUT
    })
    expect(out).toBe(IDENTITY_REVEAL_OUTPUT)
  })
})

describe('evaluateRevealEffect — wipe proof (one-shot mask) at progress points', () => {
  // Linear ease over duration 1 from START → coverage == raw progress.
  const reveal = { effectId: 'wipe', direction: 'l', duration: 1, ease: 'linear' }

  it('mask coverage tracks the eased progress at {0,.25,.5,.75,1}', () => {
    for (const p of PROGRESS) {
      const out = evaluateRevealEffect({ reveal, start: START, t: START + p, layout: LAYOUT })
      expect(out.mask.kind).toBe('wipe')
      expect(out.mask.coverage).toBeCloseTo(p, 6)
      expect(out.mask.direction).toBe('l')
      expect(out.perUnit).toEqual([])
      expect(out.overlays).toEqual([])
      // Active while revealing; identity once fully revealed.
      expect(out.active).toBe(p < 1)
    }
  })

  it('clamps before start (coverage 0) and after duration (coverage 1)', () => {
    expect(evaluateRevealEffect({ reveal, start: START, t: START - 1, layout: LAYOUT }).mask.coverage).toBe(0)
    expect(evaluateRevealEffect({ reveal, start: START, t: START + 5, layout: LAYOUT }).mask.coverage).toBe(1)
  })

  it('a zero-duration reveal snaps instantly (0 before start, 1 at/after)', () => {
    const instant = { effectId: 'wipe', duration: 0 }
    expect(evaluateRevealEffect({ reveal: instant, start: START, t: START - 0.01, layout: LAYOUT }).mask.coverage).toBe(0)
    expect(evaluateRevealEffect({ reveal: instant, start: START, t: START, layout: LAYOUT }).mask.coverage).toBe(1)
  })
})

describe('evaluateRevealEffect — glint proof (loop overlay) + continuity', () => {
  const reveal = { effectId: 'glint', duration: 2, loop: true, speed: 1 }

  it('emits a sheen overlay over the block whose progress rides the wrapped phase', () => {
    const half = evaluateRevealEffect({ reveal, start: START, t: START + 1, layout: LAYOUT })
    expect(half.active).toBe(true)
    expect(half.mask.kind).toBe('none') // base glyphs stay visible
    expect(half.overlays).toHaveLength(1)
    expect(half.overlays[0].kind).toBe('sheen')
    expect(half.overlays[0].progress).toBeCloseTo(0.5, 6) // half a 2s period
    expect(half.overlays[0].box).toEqual(LAYOUT.block)
  })

  it('is SEAMLESS at the wrap: output at phase 0 equals output one period later', () => {
    const at0 = evaluateRevealEffect({ reveal, start: START, t: START, layout: LAYOUT })
    const atPeriod = evaluateRevealEffect({ reveal, start: START, t: START + 2, layout: LAYOUT })
    expect(atPeriod).toEqual(at0)
  })

  it('a 2× speed loop halves the period (phase 0 again at half the time)', () => {
    const fast = { effectId: 'glint', duration: 2, loop: true, speed: 2 }
    const at0 = evaluateRevealEffect({ reveal: fast, start: START, t: START, layout: LAYOUT })
    const atPeriod = evaluateRevealEffect({ reveal: fast, start: START, t: START + 1, layout: LAYOUT })
    expect(atPeriod).toEqual(at0)
  })
})

describe('revealUnitBoxes — flatten layout per unit', () => {
  it('line → one box per line', () => {
    expect(revealUnitBoxes(LAYOUT, 'line')).toEqual([LAYOUT.block])
  })
  it('word → one box per word', () => {
    expect(revealUnitBoxes(LAYOUT, 'word')).toEqual([box(-20, -10, 40, 20)])
  })
  it('char → one box per grapheme cluster, in reading order', () => {
    expect(revealUnitBoxes(LAYOUT, 'char')).toEqual([box(-20, -10, 20, 20), box(0, -10, 20, 20)])
  })
})

describe('registry — a custom effect drives the per-unit channel', () => {
  // A custom per-cluster effect: each unit fades in by its index fraction. Proves
  // registerRevealEffect + the perUnit output channel + revealUnitBoxes indexing.
  const fadeUnits: RevealEffectFn = ({ progress, unit, layout }) => {
    const boxes = revealUnitBoxes(layout, unit)
    return {
      mask: { kind: 'none', coverage: 1, direction: 'l', softness: 0 },
      perUnit: boxes.map((_, i) => ({
        ...IDENTITY_UNIT,
        opacity: i / boxes.length <= progress ? 1 : 0
      })),
      overlays: [],
      unit,
      active: progress < 1
    }
  }

  it('registers and resolves the custom effect', () => {
    registerRevealEffect('test-fade-units', fadeUnits)
    expect(getRevealEffect('test-fade-units')).toBe(fadeUnits)
  })

  it('the evaluator drives it, producing one perUnit entry per cluster', () => {
    registerRevealEffect('test-fade-units', fadeUnits)
    const out = evaluateRevealEffect({
      reveal: { effectId: 'test-fade-units', unit: 'char', duration: 1, ease: 'linear' },
      start: START,
      t: START + 0.5,
      layout: LAYOUT
    })
    expect(out.unit).toBe('char')
    expect(out.perUnit).toHaveLength(2) // 'h', 'i'
    // At progress 0.5: cluster 0 (0/2=0 ≤ .5) visible; cluster 1 (1/2=.5 ≤ .5) visible.
    expect(out.perUnit[0].opacity).toBe(1)
    expect(out.perUnit[1].opacity).toBe(1)
  })
})

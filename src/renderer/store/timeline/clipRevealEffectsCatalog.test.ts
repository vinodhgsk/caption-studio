/**
 * P8R.12 — Reveal-Effects Catalog Test Suite (Doc 15; milestone Phase 8.5).
 *
 * Tests the NINE concrete reveal effects (Frame / Swipe / Type / Slide / Glossy /
 * Appear-by / Stomp / Stripe / Curtain) via the pure evaluator
 * {@link evaluateRevealEffect}. No canvas/DOM/mocks — every assertion is a pure
 * function of deterministic inputs.
 *
 * Coverage acceptance criteria (P8R.12):
 *   1. Each effect is sampled at progress {0, 0.25, 0.5, 0.75, 1.0}.
 *   2. Output shapes (mask.kind, overlay kinds, active flag) are correct at each point.
 *   3. Per-unit arrays (opacity/scale/coverage/tx/ty) match the implementation model.
 *   4. Determinism: same inputs always produce identical outputs.
 *   5. REVEAL_EFFECT_CATALOG has exactly 9 entries with the canonical ids.
 */
import { describe, expect, it } from 'vitest'
// Side-effect import: registers all nine catalog effects into the shared registry.
import '@/store/timeline/clipRevealEffects'
import { REVEAL_EFFECT_CATALOG } from '@/store/timeline/clipRevealEffects'
import { evaluateRevealEffect, resolveRevealEffect } from '@/store/timeline/clipRevealEffect'
import type { GlyphBoxLayout } from '@/routes/editor/preview/textLayout'

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

/**
 * A two-word, ten-cluster layout ("hello world") used by all effects.
 * Cluster boxes are 11px wide, 30px tall; words separated by a 10px gap.
 * The block spans x=-60..60, y=-15..15 (120×30 px, centered at origin).
 */
const LAYOUT: GlyphBoxLayout = {
  block: { x: -60, y: -15, width: 120, height: 30 },
  lines: [
    {
      line: 'hello world',
      box: { x: -60, y: -15, width: 120, height: 30 },
      words: [
        {
          word: 'hello',
          box: { x: -60, y: -15, width: 55, height: 30 },
          clusters: [
            { cluster: 'h', box: { x: -60, y: -15, width: 11, height: 30 } },
            { cluster: 'e', box: { x: -49, y: -15, width: 11, height: 30 } },
            { cluster: 'l', box: { x: -38, y: -15, width: 11, height: 30 } },
            { cluster: 'l', box: { x: -27, y: -15, width: 11, height: 30 } },
            { cluster: 'o', box: { x: -16, y: -15, width: 11, height: 30 } }
          ]
        },
        {
          word: 'world',
          box: { x: 5, y: -15, width: 55, height: 30 },
          clusters: [
            { cluster: 'w', box: { x: 5, y: -15, width: 11, height: 30 } },
            { cluster: 'o', box: { x: 16, y: -15, width: 11, height: 30 } },
            { cluster: 'r', box: { x: 27, y: -15, width: 11, height: 30 } },
            { cluster: 'l', box: { x: 38, y: -15, width: 11, height: 30 } },
            { cluster: 'd', box: { x: 49, y: -15, width: 11, height: 30 } }
          ]
        }
      ]
    }
  ]
}

const START = 2.0
const PROG = [0, 0.25, 0.5, 0.75, 1] as const

/** Evaluate an effect at a given raw progress fraction (linear ease so p === eased p). */
function evalAt(effectId: string, p: number, extra?: Record<string, unknown>) {
  return evaluateRevealEffect({
    reveal: { effectId, duration: 1, ease: 'linear', ...extra },
    start: START,
    t: START + p,
    layout: LAYOUT
  })
}

// ---------------------------------------------------------------------------
// 11. Named-variants smoke test — catalog membership
// ---------------------------------------------------------------------------

describe('REVEAL_EFFECT_CATALOG — catalog membership', () => {
  const EXPECTED_IDS = ['frame', 'swipe', 'type', 'slide', 'glossy', 'appearBy', 'stomp', 'stripe', 'curtain']

  it('has exactly 9 entries', () => {
    expect(REVEAL_EFFECT_CATALOG).toHaveLength(9)
  })

  it('contains each of the canonical effect ids', () => {
    const ids = REVEAL_EFFECT_CATALOG.map((e) => e.id)
    for (const id of EXPECTED_IDS) {
      expect(ids).toContain(id)
    }
  })

  it('ids are in the canonical gallery order', () => {
    expect(REVEAL_EFFECT_CATALOG.map((e) => e.id)).toEqual(EXPECTED_IDS)
  })

  it('each entry exposes a function as fn', () => {
    for (const entry of REVEAL_EFFECT_CATALOG) {
      expect(typeof entry.fn).toBe('function')
    }
  })
})

// ---------------------------------------------------------------------------
// 1. Frame effect
// ---------------------------------------------------------------------------

describe('frame effect', () => {
  const ID = 'frame'

  it('emits exactly one overlay of kind "frame" at each progress point', () => {
    for (const p of PROG) {
      const out = evalAt(ID, p)
      expect(out.overlays).toHaveLength(1)
      expect(out.overlays[0].kind).toBe('frame')
    }
  })

  it('overlay.progress tracks the eased progress at each sample point', () => {
    for (const p of PROG) {
      const out = evalAt(ID, p)
      expect(out.overlays[0].progress).toBeCloseTo(p, 5)
    }
  })

  it('mask is identity (kind:none, coverage:1) when gate is false (default)', () => {
    for (const p of PROG) {
      const out = evalAt(ID, p)
      expect(out.mask.kind).toBe('none')
      expect(out.mask.coverage).toBe(1)
    }
  })

  it('active is always true (the border persists as a decoration)', () => {
    for (const p of PROG) {
      const out = evalAt(ID, p)
      expect(out.active).toBe(true)
    }
  })

  it('frame box is the block expanded by padding (default 8px)', () => {
    const out = evalAt(ID, 0.5)
    const { x, y, width, height } = out.overlays[0].box
    expect(x).toBeCloseTo(LAYOUT.block.x - 8, 5)
    expect(y).toBeCloseTo(LAYOUT.block.y - 8, 5)
    expect(width).toBeCloseTo(LAYOUT.block.width + 16, 5)
    expect(height).toBeCloseTo(LAYOUT.block.height + 16, 5)
  })

  describe('gate:true — text hidden until border finishes', () => {
    function evalGate(p: number) {
      return evaluateRevealEffect({
        reveal: { effectId: ID, duration: 1, ease: 'linear', params: { gate: true } },
        start: START,
        t: START + p,
        layout: LAYOUT
      })
    }

    it('mask.coverage is 0 while progress < 1', () => {
      for (const p of PROG.filter((x) => x < 1)) {
        const out = evalGate(p)
        expect(out.mask.kind).toBe('wipe')
        expect(out.mask.coverage).toBe(0)
      }
    })

    it('mask.coverage is 1 when progress === 1', () => {
      const out = evalGate(1)
      expect(out.mask.coverage).toBe(1)
    })
  })
})

// ---------------------------------------------------------------------------
// 2. Swipe effect
// ---------------------------------------------------------------------------

describe('swipe effect', () => {
  const ID = 'swipe'

  it('mask.kind is "wipe" at every progress point', () => {
    for (const p of PROG) {
      const out = evalAt(ID, p)
      expect(out.mask.kind).toBe('wipe')
    }
  })

  it('mask.coverage approximately equals progress', () => {
    for (const p of PROG) {
      const out = evalAt(ID, p)
      expect(out.mask.coverage).toBeCloseTo(p, 5)
    }
  })

  it('emits exactly one overlay of kind "bar"', () => {
    for (const p of PROG) {
      const out = evalAt(ID, p)
      expect(out.overlays).toHaveLength(1)
      expect(out.overlays[0].kind).toBe('bar')
    }
  })

  it('active is true while sweeping (p < 1) and false when fully revealed', () => {
    for (const p of PROG) {
      const out = evalAt(ID, p)
      expect(out.active).toBe(p < 1)
    }
  })

  it('preserves direction for each of l/r/t/b', () => {
    for (const dir of ['l', 'r', 't', 'b'] as const) {
      const out = evaluateRevealEffect({
        reveal: { effectId: ID, duration: 1, ease: 'linear', direction: dir },
        start: START,
        t: START + 0.5,
        layout: LAYOUT
      })
      expect(out.mask.direction).toBe(dir)
      expect(out.overlays[0].direction).toBe(dir)
    }
  })
})

// ---------------------------------------------------------------------------
// 3. Type effect
// ---------------------------------------------------------------------------

describe('type effect', () => {
  const ID = 'type'

  // 10 clusters total (5 in "hello" + 5 in "world")
  const TOTAL_CHARS = 10

  it('unit is always "char"', () => {
    for (const p of PROG) {
      const out = evalAt(ID, p)
      expect(out.unit).toBe('char')
    }
  })

  it('at p=0: all perUnit have opacity 0 (nothing typed yet)', () => {
    const out = evalAt(ID, 0)
    expect(out.perUnit).toHaveLength(TOTAL_CHARS)
    expect(out.perUnit.every((u) => u.opacity === 0)).toBe(true)
  })

  it('at p=0.5: exactly 5 clusters are revealed (opacity=1), 5 are unrevealed (opacity=0)', () => {
    // revealed = min(10, floor(0.5*10 + 1e-9)) = 5
    const out = evalAt(ID, 0.5)
    const revealed = out.perUnit.filter((u) => u.opacity === 1).length
    const hidden = out.perUnit.filter((u) => u.opacity === 0).length
    expect(revealed).toBe(5)
    expect(hidden).toBe(5)
    // Revealed are the FIRST 5 (reading order)
    for (let i = 0; i < 5; i++) expect(out.perUnit[i].opacity).toBe(1)
    for (let i = 5; i < 10; i++) expect(out.perUnit[i].opacity).toBe(0)
  })

  it('at p=1: all perUnit have opacity 1 (fully typed)', () => {
    const out = evalAt(ID, 1)
    expect(out.perUnit).toHaveLength(TOTAL_CHARS)
    expect(out.perUnit.every((u) => u.opacity === 1)).toBe(true)
  })

  it('coverage mirrors opacity for each unit', () => {
    for (const p of PROG) {
      const out = evalAt(ID, p)
      for (const u of out.perUnit) {
        expect(u.coverage).toBe(u.opacity)
      }
    }
  })

  it('mask is identity (the block stays unclipped)', () => {
    for (const p of PROG) {
      const out = evalAt(ID, p)
      expect(out.mask.kind).toBe('none')
      expect(out.mask.coverage).toBe(1)
    }
  })

  it('caret overlay is present (kind:"caret") at all progress points', () => {
    for (const p of PROG) {
      const out = evalAt(ID, p)
      expect(out.overlays).toHaveLength(1)
      expect(out.overlays[0].kind).toBe('caret')
    }
  })

  it('caret.params.on blinks — alternates across different localSec values', () => {
    // Default blinkPeriodSec = 1.06; phase < 0.5 → on:true; phase >= 0.5 → on:false.
    // at0 computed below for reference but the key assertions are on atHalfPeriod + atStart.
    // At localSec = 0.5 + 0.53 = offset past half-period → on:false
    // localSec = 0.53s → phase = 0.53/1.06 = 0.5 → on:false (phase < 0.5 is false)
    const atHalfPeriod = evaluateRevealEffect({
      reveal: { effectId: ID, duration: 2, ease: 'linear' },
      start: START,
      t: START + 0.53, // localSec = 0.53; phase = 0.53/1.06 = 0.5 → on:false
      layout: LAYOUT
    })
    // at localSec=0 → phase=0 → on:true
    const atStart = evaluateRevealEffect({
      reveal: { effectId: ID, duration: 2, ease: 'linear' },
      start: START,
      t: START + 0, // localSec = 0 → phase = 0 → on:true
      layout: LAYOUT
    })
    expect(atStart.overlays[0].params?.on).toBe(true)
    // phase = 0.53/1.06 = exactly 0.5, and condition is phase < 0.5, so on:false
    expect(atHalfPeriod.overlays[0].params?.on).toBe(false)
  })

  it('active is always true (caret keeps blinking even after typing)', () => {
    for (const p of PROG) {
      const out = evalAt(ID, p)
      expect(out.active).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// 4. Slide effect
// ---------------------------------------------------------------------------

describe('slide effect', () => {
  const ID = 'slide'

  // Default: stagger=0.3, unit='line' (the resolveRevealEffect default).
  // Override to 'char' for the 10-cluster fixture.
  function evalSlide(p: number, extra?: Record<string, unknown>) {
    return evaluateRevealEffect({
      reveal: { effectId: ID, duration: 1, ease: 'linear', unit: 'char', ...extra },
      start: START,
      t: START + p,
      layout: LAYOUT
    })
  }

  it('mask is identity (no block-level clipping)', () => {
    for (const p of PROG) {
      const out = evalSlide(p)
      expect(out.mask.kind).toBe('none')
    }
  })

  it('produces one perUnit entry per cluster (10 entries in char mode)', () => {
    for (const p of PROG) {
      const out = evalSlide(p)
      expect(out.perUnit).toHaveLength(10)
    }
  })

  it('at p=0: all units have coverage=0 (no unit has started moving yet)', () => {
    // stagger=0.3 (default), unitStart(0) = (0/9)*0.3 = 0, up = clamp01((0-0)/0.7) = 0
    // coverage = up > 0 ? 1 : 0 = 0 for ALL units (rawProgress=0 means up=0 for each)
    const out = evalSlide(0)
    for (const u of out.perUnit) {
      expect(u.coverage).toBe(0)
    }
  })

  it('at p=0.5: some units are visible (coverage=1) and some are still clipped (coverage=0)', () => {
    const out = evalSlide(0.5)
    const visible = out.perUnit.filter((u) => u.coverage === 1).length
    const clipped = out.perUnit.filter((u) => u.coverage === 0).length
    // At p=0.5: units with unitStart <= 0.5 have started; unitStart(i) = (i/9)*0.3
    // unitStart(9) = 0.3, so all units have unitStart <= 0.3 < 0.5 → all have up > 0
    // Actually: unitStart(i) = (i/9)*0.3, for i=0..9 → range 0..0.3
    // up(i) = clamp01((0.5 - unitStart(i)) / 0.7)
    // At p=0.5, up(0) = 0.5/0.7 ≈ 0.714 > 0 → coverage=1
    // All units have unitStart <= 0.3 < 0.5, so up > 0 for all → coverage=1 for all
    expect(visible).toBeGreaterThan(0)
    expect(visible + clipped).toBe(10)
  })

  it('at p=1: all units have coverage=1 (settled)', () => {
    // unitStart(9) = 0.3, up = clamp01((1-0.3)/0.7) = 1, coverage = 1
    const out = evalSlide(1)
    for (const u of out.perUnit) {
      expect(u.coverage).toBe(1)
    }
  })

  it('direction "b": ty starts at box.height, ty → 0 as unit settles', () => {
    // At p=0 (up=0): factor = springFactor(0) = 1, ty = box.height * 1 = 30
    const at0 = evaluateRevealEffect({
      reveal: { effectId: ID, duration: 1, ease: 'linear', unit: 'char', direction: 'b' },
      start: START,
      t: START + 0,
      layout: LAYOUT
    })
    // All units at start: ty = height * springFactor(0) = 30 * 1 = 30
    for (const u of at0.perUnit) {
      expect(u.ty).toBeCloseTo(30, 5)
      expect(u.tx).toBeCloseTo(0, 5)
    }

    // At p=1 (up=1 for all): springFactor(1)=0, ty → 0
    const at1 = evaluateRevealEffect({
      reveal: { effectId: ID, duration: 1, ease: 'linear', unit: 'char', direction: 'b' },
      start: START,
      t: START + 1,
      layout: LAYOUT
    })
    for (const u of at1.perUnit) {
      expect(u.ty).toBeCloseTo(0, 5)
    }
  })

  it('active is true while in progress (p < 1) and false when fully revealed', () => {
    for (const p of PROG) {
      const out = evalSlide(p)
      expect(out.active).toBe(p < 1)
    }
  })
})

// ---------------------------------------------------------------------------
// 5. Glossy effect
// ---------------------------------------------------------------------------

describe('glossy effect', () => {
  const ID = 'glossy'

  function evalGlossy(p: number, extra?: Record<string, unknown>) {
    return evaluateRevealEffect({
      reveal: { effectId: ID, duration: 1, ease: 'linear', ...extra },
      start: START,
      t: START + p,
      layout: LAYOUT
    })
  }

  it('mask is identity (base glyphs always fully visible)', () => {
    for (const p of PROG) {
      const out = evalGlossy(p)
      expect(out.mask.kind).toBe('none')
      expect(out.mask.coverage).toBe(1)
    }
  })

  it('emits exactly one overlay of kind "sheen"', () => {
    for (const p of PROG) {
      const out = evalGlossy(p)
      expect(out.overlays).toHaveLength(1)
      expect(out.overlays[0].kind).toBe('sheen')
    }
  })

  it('overlay.progress tracks the eased progress', () => {
    for (const p of PROG) {
      const out = evalGlossy(p)
      expect(out.overlays[0].progress).toBeCloseTo(p, 5)
    }
  })

  it('default angle is 45 degrees', () => {
    for (const p of PROG) {
      const out = evalGlossy(p)
      expect(out.overlays[0].params?.angle).toBe(45)
    }
  })

  it('active is true in loop mode regardless of progress', () => {
    for (const p of PROG) {
      const out = evaluateRevealEffect({
        reveal: { effectId: ID, duration: 2, ease: 'linear', loop: true },
        start: START,
        t: START + p,
        layout: LAYOUT
      })
      expect(out.active).toBe(true)
    }
  })

  it('loop continuity: output at phase 0 equals output at phase 1 (one period later)', () => {
    // With loop:true, duration:2, speed:1 — period = 2s. At t=START and t=START+2
    // the wrapped phase is identically 0, so output must be equal (seamless wrap).
    const loopReveal = { effectId: ID, duration: 2, ease: 'linear', loop: true }
    const at0 = evaluateRevealEffect({ reveal: loopReveal, start: START, t: START, layout: LAYOUT })
    const atPeriod = evaluateRevealEffect({ reveal: loopReveal, start: START, t: START + 2, layout: LAYOUT })
    expect(atPeriod).toEqual(at0)
  })
})

// ---------------------------------------------------------------------------
// 6. Appear By effect
// ---------------------------------------------------------------------------

describe('appearBy effect', () => {
  const ID = 'appearBy'

  // Default params: stagger=0.4, scaleFrom=0.8, unit via evaluateRevealEffect = 'line'
  // Override to 'char' for per-cluster testing.
  function evalAppearBy(p: number, extra?: Record<string, unknown>) {
    return evaluateRevealEffect({
      reveal: { effectId: ID, duration: 1, ease: 'linear', unit: 'char', ...extra },
      start: START,
      t: START + p,
      layout: LAYOUT
    })
  }

  it('mask is identity (reveal is entirely per-unit)', () => {
    for (const p of PROG) {
      const out = evalAppearBy(p)
      expect(out.mask.kind).toBe('none')
    }
  })

  it('produces 10 perUnit entries in char mode (one per cluster)', () => {
    for (const p of PROG) {
      const out = evalAppearBy(p)
      expect(out.perUnit).toHaveLength(10)
    }
  })

  it('at p=0: all opacity=0, all scale=scaleFrom (0.8)', () => {
    // stagger=0.4, unitStart(0)=0, up=clamp01((0-0)/0.6)=0
    // opacity=0, scale=lerp(0.8,1,0)=0.8
    const out = evalAppearBy(0)
    for (const u of out.perUnit) {
      expect(u.opacity).toBeCloseTo(0, 5)
      expect(u.scale).toBeCloseTo(0.8, 5)
    }
  })

  it('at p=1: all opacity=1, all scale=1.0', () => {
    // unitStart(9) = (9/9)*0.4 = 0.4; up = clamp01((1-0.4)/0.6) = 1
    // opacity=1, scale=lerp(0.8,1,1)=1
    const out = evalAppearBy(1)
    for (const u of out.perUnit) {
      expect(u.opacity).toBeCloseTo(1, 5)
      expect(u.scale).toBeCloseTo(1, 5)
    }
  })

  it('at p=0.5: some units are visible (opacity=1) and some are still appearing (opacity between 0 and 1 or 0)', () => {
    // stagger=0.4, unitDuration=0.6
    // unitStart(0)=0, up = (0.5-0)/0.6 ≈ 0.833 → opacity≈0.833, scale=lerp(0.8,1,0.833)≈0.967
    // unitStart(9)=0.4, up = (0.5-0.4)/0.6 ≈ 0.167 → opacity≈0.167
    const out = evalAppearBy(0.5)
    // Unit 0 should be mostly visible
    expect(out.perUnit[0].opacity).toBeGreaterThan(0.5)
    // Unit 9 should be just starting to appear
    expect(out.perUnit[9].opacity).toBeGreaterThan(0)
    expect(out.perUnit[9].opacity).toBeLessThan(1)
  })

  it('produces 2 perUnit entries in word mode', () => {
    const out = evaluateRevealEffect({
      reveal: { effectId: ID, duration: 1, ease: 'linear', unit: 'word' },
      start: START,
      t: START + 0.5,
      layout: LAYOUT
    })
    expect(out.perUnit).toHaveLength(2)
  })

  it('active is true while revealing (p < 1) and false when complete', () => {
    for (const p of PROG) {
      const out = evalAppearBy(p)
      expect(out.active).toBe(p < 1)
    }
  })
})

// ---------------------------------------------------------------------------
// 7. Stomp effect
// ---------------------------------------------------------------------------

describe('stomp effect', () => {
  const ID = 'stomp'

  // Default params: scaleFrom=2.5, overshoot=0.15, blurIn=true, stagger=0.2
  function evalStomp(p: number, extra?: Record<string, unknown>) {
    return evaluateRevealEffect({
      reveal: { effectId: ID, duration: 1, ease: 'linear', unit: 'word', ...extra },
      start: START,
      t: START + p,
      layout: LAYOUT
    })
  }

  it('produces 2 perUnit entries in word mode (one per word)', () => {
    for (const p of PROG) {
      const out = evalStomp(p)
      expect(out.perUnit).toHaveLength(2)
    }
  })

  it('at p=0: unit 0 has scale=scaleFrom (2.5) and opacity=0', () => {
    // unitStart(0)=0, up=clamp01((0-0)/(1-0.2))=0 → stompScale(0)=scaleFrom=2.5, opacity=clamp01(0/0.4)=0
    const out = evalStomp(0)
    expect(out.perUnit[0].scale).toBeCloseTo(2.5, 4)
    expect(out.perUnit[0].opacity).toBeCloseTo(0, 5)
  })

  it('at p=1: all units scale ≈ 1.0 (settled) and opacity = 1', () => {
    // unitStart(0)=0, up=clamp01(1/(0.8))=1 → stompScale(1)=1, opacity=clamp01(1/0.4)=1
    // unitStart(1)=0.2, up=clamp01((1-0.2)/0.8)=1 → same
    const out = evalStomp(1)
    for (const u of out.perUnit) {
      expect(u.scale).toBeCloseTo(1, 2)
      expect(u.opacity).toBeCloseTo(1, 5)
    }
  })

  it('emits one overlay with params.blurIn=true (default)', () => {
    const out = evalStomp(0.5)
    expect(out.overlays).toHaveLength(1)
    expect(out.overlays[0].params?.blurIn).toBe(true)
  })

  it('active is true while stomping (p < 1) and false when complete', () => {
    for (const p of PROG) {
      const out = evalStomp(p)
      expect(out.active).toBe(p < 1)
    }
  })
})

// ---------------------------------------------------------------------------
// 8. Stripe effect
// ---------------------------------------------------------------------------

describe('stripe effect', () => {
  const ID = 'stripe'
  const DEFAULT_STRIPE_COUNT = 3

  function evalStripe(p: number, extra?: Record<string, unknown>) {
    return evaluateRevealEffect({
      reveal: { effectId: ID, duration: 1, ease: 'linear', ...extra },
      start: START,
      t: START + p,
      layout: LAYOUT
    })
  }

  it('emits exactly stripeCount (3) overlays of kind "stripe"', () => {
    for (const p of PROG) {
      const out = evalStripe(p)
      expect(out.overlays).toHaveLength(DEFAULT_STRIPE_COUNT)
      for (const overlay of out.overlays) {
        expect(overlay.kind).toBe('stripe')
      }
    }
  })

  it('at p=0: mask.coverage ≈ 0 (no bars have swept yet)', () => {
    const out = evalStripe(0)
    // coverage = clamp01(0 * (1 + 1/3)) = 0
    expect(out.mask.coverage).toBeCloseTo(0, 5)
  })

  it('at p=1: mask.coverage = 1 (fully revealed — sweepRange clamps to 1)', () => {
    const out = evalStripe(1)
    // coverage = clamp01(1 * (1 + 1/3)) = clamp01(4/3) = 1
    expect(out.mask.coverage).toBe(1)
  })

  it('mask.kind is "wipe" throughout', () => {
    for (const p of PROG) {
      const out = evalStripe(p)
      expect(out.mask.kind).toBe('wipe')
    }
  })

  it('active is true while sweeping (p < 1) and false when done', () => {
    for (const p of PROG) {
      const out = evalStripe(p)
      expect(out.active).toBe(p < 1)
    }
  })

  it('respects a custom stripeCount', () => {
    const out = evalStripe(0.5, { params: { stripeCount: 5 } })
    expect(out.overlays).toHaveLength(5)
  })
})

// ---------------------------------------------------------------------------
// 9. Curtain effect
// ---------------------------------------------------------------------------

describe('curtain effect', () => {
  const ID = 'curtain'

  function evalCurtain(p: number, direction: string, extra?: Record<string, unknown>) {
    return evaluateRevealEffect({
      reveal: { effectId: ID, duration: 1, ease: 'linear', direction, ...extra },
      start: START,
      t: START + p,
      layout: LAYOUT
    })
  }

  it('direction:"center" — mask.kind is "split", coverage ≈ p, 2 panel overlays', () => {
    for (const p of PROG) {
      const out = evalCurtain(p, 'center')
      expect(out.mask.kind).toBe('split')
      expect(out.mask.coverage).toBeCloseTo(p, 5)
      expect(out.overlays).toHaveLength(2)
      for (const overlay of out.overlays) {
        expect(overlay.kind).toBe('panel')
      }
    }
  })

  it('direction:"center" — left panel goes left, right panel goes right', () => {
    const out = evalCurtain(0.5, 'center')
    expect(out.overlays[0].direction).toBe('l')
    expect(out.overlays[1].direction).toBe('r')
  })

  it('direction:"t" — mask.kind is "wipe", mask.direction is "t", 1 panel overlay', () => {
    for (const p of PROG) {
      const out = evalCurtain(p, 't')
      expect(out.mask.kind).toBe('wipe')
      expect(out.mask.direction).toBe('t')
      expect(out.overlays).toHaveLength(1)
      expect(out.overlays[0].kind).toBe('panel')
    }
  })

  it('direction:"b" — mask.kind is "wipe", coverage ≈ p', () => {
    for (const p of PROG) {
      const out = evalCurtain(p, 'b')
      expect(out.mask.kind).toBe('wipe')
      expect(out.mask.coverage).toBeCloseTo(p, 5)
    }
  })

  it('active is true while revealing (p < 1) and false when complete', () => {
    for (const p of PROG) {
      for (const dir of ['center', 't', 'b', 'l', 'r'] as const) {
        const out = evalCurtain(p, dir)
        expect(out.active).toBe(p < 1)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 10. Determinism / export parity — same inputs → strict equality
// ---------------------------------------------------------------------------

describe('export parity — determinism across all nine effects', () => {
  const EFFECT_IDS = ['frame', 'swipe', 'type', 'slide', 'glossy', 'appearBy', 'stomp', 'stripe', 'curtain']

  const BASE_PROGRESS_POINTS = [0, 0.25, 0.5, 0.75, 1] as const

  for (const effectId of EFFECT_IDS) {
    it(`${effectId}: calling evaluateRevealEffect twice with the same inputs yields identical outputs`, () => {
      for (const p of BASE_PROGRESS_POINTS) {
        const opts = {
          reveal: { effectId, duration: 1, ease: 'linear', unit: 'char' } as Record<string, unknown>,
          start: START,
          t: START + p,
          layout: LAYOUT
        }
        const out1 = evaluateRevealEffect(opts)
        const out2 = evaluateRevealEffect(opts)
        expect(out2).toEqual(out1)
      }
    })
  }
})

// ---------------------------------------------------------------------------
// resolveRevealEffect — discriminator check (Doc-03 mode-only reveals not hijacked)
// ---------------------------------------------------------------------------

describe('resolveRevealEffect — discriminator', () => {
  it('returns undefined for a Doc-03 mode-only reveal (no effectId)', () => {
    expect(resolveRevealEffect({ mode: 'word', easing: 'linear' })).toBeUndefined()
  })

  it('returns a ref for each of the nine catalog effect ids', () => {
    const EXPECTED_IDS = ['frame', 'swipe', 'type', 'slide', 'glossy', 'appearBy', 'stomp', 'stripe', 'curtain']
    for (const id of EXPECTED_IDS) {
      const ref = resolveRevealEffect({ effectId: id, duration: 1 })
      expect(ref).not.toBeUndefined()
      expect(ref?.effectId).toBe(id)
    }
  })
})

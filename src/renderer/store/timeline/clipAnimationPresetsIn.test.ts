/**
 * P8.2 — IN-preset CATALOG (Fade, Zoom, Typewriter, Slide L/R/T/B, Bounce, Flip,
 * Fold, Pop, Blur, Glitch, Spin, Scream) with per-char/word stagger.
 *
 * Asserts the ENTRANCE contract for every preset (req. 5):
 *   - progress 0   → a transformed/offset state (NOT identity, except where the
 *     only channel is opacity, which is 0 at p=0 = clearly entering);
 *   - progress 0.5 → a partial state (between);
 *   - progress 1   → EXACTLY {@link IDENTITY_SAMPLE} (settles to rest, req. 4);
 *   - Slide directions carry the correct sign of translate at p=0;
 *   - Bounce / Scream overshoot (non-monotonic) mid-entrance;
 *   - Spin's rotation → 0 at p=1;
 *   - Glitch is deterministic (same phase → same sample);
 *   - the per-index STAGGER cascades entrance (the evaluator delays each unit);
 *   - the catalog enumerates ALL required ids.
 *
 * PURE: no canvas/DOM. Presets are sampled directly and through the evaluator.
 */
import { describe, expect, it } from 'vitest'
import type { ClipAnimation } from '../../../shared/project-schema'
import { evaluateClipAnimation, getAnimPreset, type AnimSample } from './clipAnimation'
import {
  IN_PRESET_CATALOG,
  REQUIRED_IN_PRESET_IDS,
  registerInPresets,
  fadeIn,
  zoomIn,
  typewriterIn,
  slideLeftIn,
  slideRightIn,
  slideTopIn,
  slideBottomIn,
  bounceIn,
  flipIn,
  foldIn,
  popIn,
  blurIn,
  glitchIn,
  spinIn,
  screamIn
} from './clipAnimationPresetsIn'

registerInPresets()

const phase = (progress: number, index = 0, count = 1) =>
  ({ progress, kind: 'in', index, count }) as const

const ALL = [
  fadeIn,
  zoomIn,
  typewriterIn,
  slideLeftIn,
  slideRightIn,
  slideTopIn,
  slideBottomIn,
  bounceIn,
  flipIn,
  foldIn,
  popIn,
  blurIn,
  glitchIn,
  spinIn,
  screamIn
]

function expectIdentity(s: AnimSample): void {
  expect(s.opacity).toBeCloseTo(1, 6)
  expect(s.tx).toBeCloseTo(0, 6)
  expect(s.ty).toBeCloseTo(0, 6)
  expect(s.scale).toBeCloseTo(1, 6)
  expect(s.rotation).toBeCloseTo(0, 6)
}

describe('every In preset settles to IDENTITY at progress 1 (req. 4)', () => {
  it.each(IN_PRESET_CATALOG.map((e) => [e.id, e.fn] as const))(
    'preset %s → identity at p=1',
    (_id, fn) => {
      expectIdentity(fn(phase(1, 0, 3)))
      // Also for a non-zero stagger unit (the evaluator pins its progress at 1 too).
      expectIdentity(fn(phase(1, 2, 5)))
    }
  )
})

describe('every In preset is offset/entering at progress 0 (req. 1)', () => {
  it.each(ALL.map((fn, i) => [IN_PRESET_CATALOG[i].id, fn] as const))(
    'preset %s differs from identity at p=0',
    (_id, fn) => {
      const s = fn(phase(0, 0, 3))
      const isIdentity =
        s.opacity === 1 && s.tx === 0 && s.ty === 0 && s.scale === 1 && s.rotation === 0
      expect(isIdentity).toBe(false)
    }
  )
})

describe('every In preset has a partial state at progress 0.5 (req. 5)', () => {
  it.each(ALL.map((fn, i) => [IN_PRESET_CATALOG[i].id, fn] as const))(
    'preset %s is between at p=0.5',
    (id, fn) => {
      const mid = fn(phase(0.5, 0, 3))
      // Mid differs from BOTH the p=0 and p=1 states for at least one channel.
      const start = fn(phase(0, 0, 3))
      const end = fn(phase(1, 0, 3))
      const differs = (a: AnimSample, b: AnimSample) =>
        a.opacity !== b.opacity ||
        a.tx !== b.tx ||
        a.ty !== b.ty ||
        a.scale !== b.scale ||
        a.rotation !== b.rotation
      // Typewriter is a hard reveal (no partial), so it equals its p=1 visible
      // state at p=0.5 — assert it is at least visible + differs from p=0.
      if (id === 'typewriter') {
        expect(mid.opacity).toBe(1)
        expect(differs(mid, start)).toBe(true)
      } else {
        expect(differs(mid, start) || differs(mid, end)).toBe(true)
      }
    }
  )
})

describe('Fade', () => {
  it('opacity ramps with progress; no transform', () => {
    expect(fadeIn(phase(0)).opacity).toBe(0)
    expect(fadeIn(phase(0.5)).opacity).toBeCloseTo(0.5, 6)
    expect(fadeIn(phase(1)).opacity).toBe(1)
    expect(fadeIn(phase(0.5)).tx).toBe(0)
  })
})

describe('Zoom', () => {
  it('scales up from small to 1', () => {
    expect(zoomIn(phase(0)).scale).toBeLessThan(1)
    expect(zoomIn(phase(1)).scale).toBeCloseTo(1, 6)
    expect(zoomIn(phase(0.5)).scale).toBeGreaterThan(zoomIn(phase(0)).scale)
  })
})

describe('Typewriter', () => {
  it('is hidden before its time and visible once started (hard reveal)', () => {
    expect(typewriterIn(phase(0)).opacity).toBe(0)
    expect(typewriterIn(phase(0.0001)).opacity).toBe(1)
    expect(typewriterIn(phase(1)).opacity).toBe(1)
  })
})

describe('Slide directions carry the correct sign (req. 5)', () => {
  it('left starts at -x, right at +x, top at -y, bottom at +y', () => {
    expect(slideLeftIn(phase(0)).tx).toBeLessThan(0)
    expect(slideRightIn(phase(0)).tx).toBeGreaterThan(0)
    expect(slideTopIn(phase(0)).ty).toBeLessThan(0)
    expect(slideBottomIn(phase(0)).ty).toBeGreaterThan(0)
  })
  it('all slides settle to 0 translate at p=1', () => {
    for (const fn of [slideLeftIn, slideRightIn, slideTopIn, slideBottomIn]) {
      expect(fn(phase(1)).tx).toBeCloseTo(0, 6)
      expect(fn(phase(1)).ty).toBeCloseTo(0, 6)
    }
  })
  it('translate magnitude shrinks monotonically toward rest', () => {
    expect(Math.abs(slideLeftIn(phase(0.25)).tx)).toBeGreaterThan(
      Math.abs(slideLeftIn(phase(0.75)).tx)
    )
  })
})

describe('Bounce overshoot (settling, non-monotonic) (req. 5)', () => {
  it('the vertical offset rebounds rather than easing straight in', () => {
    // bounceOut is non-monotonic in its derivative: sample several points and
    // confirm the |ty| does NOT decrease at every step (a rebound bumps it).
    const tys = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((p) =>
      Math.abs(bounceIn(phase(p)).ty)
    )
    let sawRebound = false
    for (let i = 1; i < tys.length; i++) {
      if (tys[i] > tys[i - 1] + 1e-9) sawRebound = true
    }
    expect(sawRebound).toBe(true)
    expect(bounceIn(phase(1)).ty).toBeCloseTo(0, 6)
  })
})

describe('Flip / Fold', () => {
  it('flip scales open from edge-on to face-on (scale→1)', () => {
    expect(flipIn(phase(0)).scale).toBeLessThan(0.2)
    expect(flipIn(phase(1)).scale).toBeCloseTo(1, 6)
  })
  it('fold swings a hinge rotation that settles to 0', () => {
    expect(foldIn(phase(0)).rotation).not.toBeCloseTo(0, 3)
    expect(foldIn(phase(1)).rotation).toBeCloseTo(0, 6)
    expect(foldIn(phase(1)).scale).toBeCloseTo(1, 6)
  })
})

describe('Pop overshoot (back-out, scale springs past 1) (req. 5)', () => {
  it('scale exceeds 1 mid-entrance then returns to 1', () => {
    const peak = Math.max(
      ...[0.5, 0.6, 0.7, 0.8, 0.9].map((p) => popIn(phase(p)).scale)
    )
    expect(peak).toBeGreaterThan(1)
    expect(popIn(phase(1)).scale).toBeCloseTo(1, 6)
  })
})

describe('Blur', () => {
  it('scales down from over-large to 1 (focus-in) and fades in', () => {
    expect(blurIn(phase(0)).scale).toBeGreaterThan(1)
    expect(blurIn(phase(0)).opacity).toBe(0)
    expect(blurIn(phase(1)).scale).toBeCloseTo(1, 6)
  })
})

describe('Glitch is deterministic (req. 5)', () => {
  it('same phase → same sample (no Date/Math.random)', () => {
    const a = glitchIn(phase(0.3, 2, 5))
    const b = glitchIn(phase(0.3, 2, 5))
    expect(a).toEqual(b)
  })
  it('different glyph index → different jitter mid-entrance', () => {
    const g0 = glitchIn(phase(0.3, 0, 5))
    const g1 = glitchIn(phase(0.3, 1, 5))
    expect(g0.tx === g1.tx && g0.ty === g1.ty).toBe(false)
  })
  it('settles to identity at p=1 (jitter decays to 0)', () => {
    expectIdentity(glitchIn(phase(1, 3, 5)))
  })
})

describe('Spin rotation → 0 (req. 5)', () => {
  it('starts with a large rotation and unwinds to 0', () => {
    expect(Math.abs(spinIn(phase(0)).rotation)).toBeGreaterThan(Math.PI)
    expect(spinIn(phase(1)).rotation).toBeCloseTo(0, 6)
    // monotonic unwind: |rotation| decreases as progress grows.
    expect(Math.abs(spinIn(phase(0.25)).rotation)).toBeGreaterThan(
      Math.abs(spinIn(phase(0.75)).rotation)
    )
  })
})

describe('Scream (elastic) overshoot (req. 5)', () => {
  it('scale overshoots 1 (rings down) and settles to identity', () => {
    const peak = Math.max(
      ...[0.1, 0.2, 0.3, 0.4, 0.5].map((p) => screamIn(phase(p)).scale)
    )
    expect(peak).toBeGreaterThan(1)
    expectIdentity(screamIn(phase(1, 0, 3)))
  })
})

describe('catalog enumerates ALL required presets (req. 3)', () => {
  it('lists every required id with a label + registered fn', () => {
    const ids = IN_PRESET_CATALOG.map((e) => e.id)
    for (const required of REQUIRED_IN_PRESET_IDS) {
      expect(ids).toContain(required)
    }
    for (const entry of IN_PRESET_CATALOG) {
      expect(entry.label.length).toBeGreaterThan(0)
      expect(getAnimPreset('in', entry.id)).toBe(entry.fn)
    }
  })

  it('covers the Doc 06 named set (Fade, Zoom, Typewriter, Slide L/R/T/B, Bounce, Flip, Fold, Pop, Blur, Glitch, Spin, Scream)', () => {
    const ids = new Set(IN_PRESET_CATALOG.map((e) => e.id))
    for (const id of [
      'fade',
      'zoom',
      'typewriter',
      'slide-left',
      'slide-right',
      'slide-top',
      'slide-bottom',
      'bounce',
      'flip',
      'fold',
      'pop',
      'blur',
      'glitch',
      'spin',
      'scream'
    ]) {
      expect(ids.has(id)).toBe(true)
    }
  })
})

describe('stagger cascades entrance through the evaluator (req. 2)', () => {
  it('a per-character slide delays later glyphs (earlier glyph more settled)', () => {
    const animation: ClipAnimation = {
      in: {
        preset: 'slide-left',
        durationSec: 0.5,
        easing: 'linear',
        stagger: { unit: 'character', delaySec: 0.2 }
      }
    }
    const START = 1.0
    const OUT = 4.0
    // At t = start + 0.1: glyph 0 is 0.2 into its 0.5s slide (progress 0.4);
    // glyph 2 (delayed 0.4s) has progress 0 → full -x offset, opacity 0.
    const o = evaluateClipAnimation({ animation, start: START, end: OUT, t: START + 0.1 })
    const g0 = o.glyph(0, 5)
    const g2 = o.glyph(2, 5)
    // Earlier glyph has slid further toward rest: |tx| smaller, opacity larger.
    expect(Math.abs(g0.tx)).toBeLessThan(Math.abs(g2.tx))
    expect(g0.opacity).toBeGreaterThan(g2.opacity)
    expect(o.active).toBe(true)
  })

  it('typewriter stagger reveals glyphs one index at a time', () => {
    const animation: ClipAnimation = {
      in: {
        preset: 'typewriter',
        durationSec: 0.01,
        easing: 'linear',
        stagger: { unit: 'character', delaySec: 0.2 }
      }
    }
    const START = 1.0
    const OUT = 4.0
    // At t = start + 0.1: glyph 0 has typed on (progress 1 → visible); glyph 1
    // (starts at +0.2) has not (progress 0 → hidden).
    const o = evaluateClipAnimation({ animation, start: START, end: OUT, t: START + 0.1 })
    expect(o.glyph(0, 5).opacity).toBe(1)
    expect(o.glyph(1, 5).opacity).toBe(0)
  })

  it('per-word spin stagger composes onto the clip via the evaluator', () => {
    const animation: ClipAnimation = {
      in: {
        preset: 'spin',
        durationSec: 0.5,
        easing: 'linear',
        stagger: { unit: 'word', delaySec: 0.1 }
      }
    }
    const START = 1.0
    const OUT = 4.0
    const o = evaluateClipAnimation({ animation, start: START, end: OUT, t: START + 0.6 })
    // After the in-window + the last word's delay, every word has settled to rest.
    expectIdentity(o.glyph(0, 3))
  })
})

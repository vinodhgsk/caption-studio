/**
 * P8.3 — OUT-preset CATALOG (Fade, Zoom, Slide L/R/T/B, Bounce, Glitch, Blur, Flip,
 * Fold, Shrink) over the trailing `out.durationSec`, with per-char/word stagger.
 *
 * Asserts the EXIT contract for every preset (req. 5), using the evaluator's
 * ENTRANCE-style out progress (progress 1 = START of out window = REST; progress 0 =
 * end of out window = GONE):
 *   - progress 1   → EXACTLY {@link IDENTITY_SAMPLE} (resting at the start of the exit);
 *   - progress 0.5 → a partial state (between rest and gone);
 *   - progress 0   → fully animated out (fade opacity 0, shrink scale 0, slide off by
 *     direction sign);
 *   - Slide directions carry the correct sign of translate at p=0 (gone);
 *   - Glitch is deterministic (same phase → same sample);
 *   - the per-index STAGGER cascades the exit through the evaluator;
 *   - compose In + Out on one clip: the In region settles to rest, the Out region leaves;
 *   - the catalog enumerates ALL required ids.
 *
 * PURE: no canvas/DOM. Presets are sampled directly and through the evaluator.
 */
import { describe, expect, it } from 'vitest'
import type { ClipAnimation } from '../../../shared/project-schema'
import {
  evaluateClipAnimation,
  getAnimPreset,
  outProgress,
  type AnimLane,
  type AnimSample
} from './clipAnimation'
import {
  OUT_PRESET_CATALOG,
  REQUIRED_OUT_PRESET_IDS,
  registerOutPresets,
  fadeOut,
  zoomOut,
  slideLeftOut,
  slideRightOut,
  slideTopOut,
  slideBottomOut,
  bounceOutPreset,
  glitchOut,
  blurOut,
  flipOut,
  foldOut,
  shrinkOut,
  burstOut
} from './clipAnimationPresetsOut'

registerOutPresets()

// The evaluator feeds OUT presets an entrance-style progress: 1 = rest, 0 = gone.
const phase = (progress: number, index = 0, count = 1) =>
  ({ progress, kind: 'out', index, count }) as const

const ALL = [
  fadeOut,
  zoomOut,
  slideLeftOut,
  slideRightOut,
  slideTopOut,
  slideBottomOut,
  bounceOutPreset,
  glitchOut,
  blurOut,
  flipOut,
  foldOut,
  shrinkOut,
  burstOut
]

function expectIdentity(s: AnimSample): void {
  expect(s.opacity).toBeCloseTo(1, 6)
  expect(s.tx).toBeCloseTo(0, 6)
  expect(s.ty).toBeCloseTo(0, 6)
  expect(s.scale).toBeCloseTo(1, 6)
  expect(s.rotation).toBeCloseTo(0, 6)
}

describe('every Out preset is at REST (IDENTITY) at the start of the out window (req. 5)', () => {
  it.each(OUT_PRESET_CATALOG.map((e) => [e.id, e.fn] as const))(
    'preset %s → identity at progress 1 (rest)',
    (_id, fn) => {
      expectIdentity(fn(phase(1, 0, 3)))
      // Also for a non-zero stagger unit (its progress is pinned at 1 while lingering).
      expectIdentity(fn(phase(1, 2, 5)))
    }
  )
})

describe('every Out preset is GONE (displaced/faded) at the end of the out window (req. 5)', () => {
  it.each(ALL.map((fn, i) => [OUT_PRESET_CATALOG[i].id, fn] as const))(
    'preset %s differs from identity at progress 0 (gone)',
    (_id, fn) => {
      const s = fn(phase(0, 0, 3))
      const isIdentity =
        s.opacity === 1 && s.tx === 0 && s.ty === 0 && s.scale === 1 && s.rotation === 0
      expect(isIdentity).toBe(false)
    }
  )
})

describe('every Out preset has a partial state at progress 0.5 (req. 5)', () => {
  it.each(ALL.map((fn, i) => [OUT_PRESET_CATALOG[i].id, fn] as const))(
    'preset %s is between rest and gone at p=0.5',
    (_id, fn) => {
      const mid = fn(phase(0.5, 0, 3))
      const rest = fn(phase(1, 0, 3))
      const goneState = fn(phase(0, 0, 3))
      const differs = (a: AnimSample, b: AnimSample) =>
        a.opacity !== b.opacity ||
        a.tx !== b.tx ||
        a.ty !== b.ty ||
        a.scale !== b.scale ||
        a.rotation !== b.rotation
      expect(differs(mid, rest) || differs(mid, goneState)).toBe(true)
    }
  )
})

describe('Fade out', () => {
  it('opacity ramps from 1 (rest) to 0 (gone); no transform', () => {
    expect(fadeOut(phase(1)).opacity).toBe(1)
    expect(fadeOut(phase(0.5)).opacity).toBeCloseTo(0.5, 6)
    expect(fadeOut(phase(0)).opacity).toBe(0)
    expect(fadeOut(phase(0.5)).tx).toBe(0)
  })
})

describe('Zoom out', () => {
  it('scales UP and fades as it leaves', () => {
    expect(zoomOut(phase(1)).scale).toBeCloseTo(1, 6)
    expect(zoomOut(phase(0)).scale).toBeGreaterThan(1)
    expect(zoomOut(phase(0)).opacity).toBe(0)
  })
})

describe('Slide out directions carry the correct sign (req. 5)', () => {
  it('left goes to -x, right to +x, top to -y, bottom to +y when gone', () => {
    expect(slideLeftOut(phase(0)).tx).toBeLessThan(0)
    expect(slideRightOut(phase(0)).tx).toBeGreaterThan(0)
    expect(slideTopOut(phase(0)).ty).toBeLessThan(0)
    expect(slideBottomOut(phase(0)).ty).toBeGreaterThan(0)
  })
  it('all slides are at 0 translate at rest (progress 1)', () => {
    for (const fn of [slideLeftOut, slideRightOut, slideTopOut, slideBottomOut]) {
      expect(fn(phase(1)).tx).toBeCloseTo(0, 6)
      expect(fn(phase(1)).ty).toBeCloseTo(0, 6)
    }
  })
  it('translate magnitude grows as it leaves (more displaced nearer gone)', () => {
    expect(Math.abs(slideLeftOut(phase(0.25)).tx)).toBeGreaterThan(
      Math.abs(slideLeftOut(phase(0.75)).tx)
    )
  })
})

describe('Bounce out anticipates then leaves (settling, non-monotonic) (req. 5)', () => {
  it('vertical offset rebounds on the way out and is 0 at rest', () => {
    expect(bounceOutPreset(phase(1)).ty).toBeCloseTo(0, 6)
    const tys = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((p) =>
      Math.abs(bounceOutPreset(phase(p)).ty)
    )
    let sawRebound = false
    for (let i = 1; i < tys.length; i++) {
      if (tys[i] < tys[i - 1] - 1e-9) sawRebound = true
    }
    expect(sawRebound).toBe(true)
    expect(bounceOutPreset(phase(0)).ty).not.toBeCloseTo(0, 3)
  })
})

describe('Glitch out is deterministic (req. 5)', () => {
  it('same phase → same sample (no Date/Math.random)', () => {
    const a = glitchOut(phase(0.3, 2, 5))
    const b = glitchOut(phase(0.3, 2, 5))
    expect(a).toEqual(b)
  })
  it('different glyph index → different jitter mid-exit', () => {
    const g0 = glitchOut(phase(0.3, 0, 5))
    const g1 = glitchOut(phase(0.3, 1, 5))
    expect(g0.tx === g1.tx && g0.ty === g1.ty).toBe(false)
  })
  it('is at identity at rest (jitter is 0 at progress 1)', () => {
    expectIdentity(glitchOut(phase(1, 3, 5)))
  })
})

describe('Blur out', () => {
  it('scales up (defocus) and fades as it leaves; rest is identity', () => {
    expect(blurOut(phase(0)).scale).toBeGreaterThan(1)
    expect(blurOut(phase(0)).opacity).toBe(0)
    expect(blurOut(phase(1)).scale).toBeCloseTo(1, 6)
  })
})

describe('Flip / Fold out', () => {
  it('flip scales from face-on (rest) toward edge-on (gone)', () => {
    expect(flipOut(phase(1)).scale).toBeCloseTo(1, 6)
    expect(flipOut(phase(0)).scale).toBeLessThan(0.2)
  })
  it('fold swings a hinge rotation that is 0 at rest and folds shut when gone', () => {
    expect(foldOut(phase(1)).rotation).toBeCloseTo(0, 6)
    expect(foldOut(phase(1)).scale).toBeCloseTo(1, 6)
    expect(foldOut(phase(0)).rotation).not.toBeCloseTo(0, 3)
    expect(foldOut(phase(0)).scale).toBeLessThan(0.2)
  })
})

describe('Shrink out scale → 0 (req. 5)', () => {
  it('scales from 1 (rest) down to 0 (gone) and fades', () => {
    expect(shrinkOut(phase(1)).scale).toBeCloseTo(1, 6)
    expect(shrinkOut(phase(0)).scale).toBeCloseTo(0, 6)
    expect(shrinkOut(phase(0)).opacity).toBe(0)
    // monotonic collapse
    expect(shrinkOut(phase(0.25)).scale).toBeLessThan(shrinkOut(phase(0.75)).scale)
  })
})

describe('Burst (elastic) out overshoot (req. 5)', () => {
  it('scale overshoots while leaving and is identity at rest', () => {
    const peak = Math.max(...[0.1, 0.2, 0.3, 0.4, 0.5].map((p) => burstOut(phase(p)).scale))
    expect(peak).toBeGreaterThan(1)
    expectIdentity(burstOut(phase(1, 0, 3)))
  })
})

describe('outProgress timing convention (req. 2)', () => {
  const lane: AnimLane = { preset: 'fade', durationSec: 0.5, easing: 'linear' }
  const OUT = 4.0
  it('is 1 at/before the start of the out window (rest)', () => {
    expect(outProgress(lane, OUT, OUT - 0.5)).toBe(1)
    expect(outProgress(lane, OUT, OUT - 0.6)).toBe(1)
  })
  it('counts down to 0 at the end of the out window (gone)', () => {
    expect(outProgress(lane, OUT, OUT)).toBe(0)
    expect(outProgress(lane, OUT, OUT - 0.25)).toBeCloseTo(0.5, 6)
  })
})

describe('catalog enumerates ALL required presets (req. 4)', () => {
  it('lists every required id with a label + registered fn', () => {
    const ids = OUT_PRESET_CATALOG.map((e) => e.id)
    for (const required of REQUIRED_OUT_PRESET_IDS) {
      expect(ids).toContain(required)
    }
    for (const entry of OUT_PRESET_CATALOG) {
      expect(entry.label.length).toBeGreaterThan(0)
      expect(getAnimPreset('out', entry.id)).toBe(entry.fn)
    }
  })

  it('covers the Doc 06 named set (Fade, Zoom, Slide L/R/T/B, Bounce, Glitch, Blur, Flip, Fold, Shrink)', () => {
    const ids = new Set(OUT_PRESET_CATALOG.map((e) => e.id))
    for (const id of [
      'fade',
      'zoom',
      'slide-left',
      'slide-right',
      'slide-top',
      'slide-bottom',
      'bounce',
      'glitch',
      'blur',
      'flip',
      'fold',
      'shrink'
    ]) {
      expect(ids.has(id)).toBe(true)
    }
  })
})

describe('Out preset renders fully out at clip.out through the evaluator (req. 1)', () => {
  it('fade opacity → 0 at clip.out; shrink scale → 0; slide-left tx < 0', () => {
    const START = 1.0
    const OUT = 4.0
    const mk = (preset: string): ClipAnimation => ({
      out: { preset, durationSec: 0.5, easing: 'linear' }
    })
    // At t === OUT the clip is fully gone.
    const fade = evaluateClipAnimation({ animation: mk('fade'), start: START, end: OUT, t: OUT })
    expect(fade.clip.opacity).toBeCloseTo(0, 6)
    const shrink = evaluateClipAnimation({ animation: mk('shrink'), start: START, end: OUT, t: OUT })
    expect(shrink.clip.scale).toBeCloseTo(0, 6)
    const slide = evaluateClipAnimation({
      animation: mk('slide-left'),
      start: START,
      end: OUT,
      t: OUT
    })
    expect(slide.clip.tx).toBeLessThan(0)
  })

  it('is at REST (identity) at the start of the out window through the evaluator', () => {
    const START = 1.0
    const OUT = 4.0
    const animation: ClipAnimation = { out: { preset: 'shrink', durationSec: 0.5, easing: 'linear' } }
    // t = OUT - 0.5 is the start of the out window → rest.
    const o = evaluateClipAnimation({ animation, start: START, end: OUT, t: OUT - 0.5 })
    expectIdentity(o.clip)
  })
})

describe('In + Out coexist on one clip (req. 2)', () => {
  const START = 1.0
  const OUT = 5.0
  const animation: ClipAnimation = {
    in: { preset: 'fade', durationSec: 0.5, easing: 'linear' },
    out: { preset: 'shrink', durationSec: 0.5, easing: 'linear' }
  }

  it('In region animates the entrance', () => {
    const o = evaluateClipAnimation({ animation, start: START, end: OUT, t: START + 0.25 })
    // Mid-entrance: fading in (opacity < 1), shrink-out at rest (scale 1).
    expect(o.clip.opacity).toBeCloseTo(0.5, 6)
    expect(o.clip.scale).toBeCloseTo(1, 6)
  })

  it('the resting middle settles to IDENTITY (windows do not overlap)', () => {
    const o = evaluateClipAnimation({ animation, start: START, end: OUT, t: 3.0 })
    expectIdentity(o.clip)
  })

  it('Out region animates the exit (In already settled to rest)', () => {
    const o = evaluateClipAnimation({ animation, start: START, end: OUT, t: OUT - 0.25 })
    // Mid-exit: In has long settled (opacity contribution 1), shrink collapsing.
    expect(o.clip.scale).toBeLessThan(1)
    expect(o.clip.scale).toBeGreaterThan(0)
  })

  it('fully gone at clip.out (Out wins; In is at rest opacity 1)', () => {
    const o = evaluateClipAnimation({ animation, start: START, end: OUT, t: OUT })
    expect(o.clip.opacity).toBeCloseTo(0, 6)
    expect(o.clip.scale).toBeCloseTo(0, 6)
  })
})

describe('stagger cascades the exit through the evaluator (req. 3)', () => {
  it('a per-character slide-out makes earlier glyphs leave first (later glyphs linger)', () => {
    const animation: ClipAnimation = {
      out: {
        preset: 'slide-left',
        durationSec: 0.5,
        easing: 'linear',
        stagger: { unit: 'character', delaySec: 0.2 }
      }
    }
    const START = 1.0
    const OUT = 5.0
    // At t near the end of the window, an earlier glyph (index 0) has left more than a
    // later glyph (index 2), which still lingers nearer rest.
    const o = evaluateClipAnimation({ animation, start: START, end: OUT, t: OUT - 0.1 })
    const g0 = o.glyph(0, 5)
    const g2 = o.glyph(2, 5)
    expect(Math.abs(g0.tx)).toBeGreaterThan(Math.abs(g2.tx))
    expect(g0.opacity).toBeLessThan(g2.opacity)
    expect(o.active).toBe(true)
  })

  it('a per-word shrink-out staggers whole words on exit', () => {
    const animation: ClipAnimation = {
      out: {
        preset: 'shrink',
        durationSec: 0.5,
        easing: 'linear',
        stagger: { unit: 'word', delaySec: 0.1 }
      }
    }
    const START = 1.0
    const OUT = 5.0
    const o = evaluateClipAnimation({ animation, start: START, end: OUT, t: OUT - 0.1 })
    // Earlier word collapsed further (smaller scale) than the later, lingering word.
    expect(o.glyph(0, 3).scale).toBeLessThan(o.glyph(2, 3).scale)
  })
})

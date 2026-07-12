/**
 * P8.1 — clip ANIMATION evaluator (in/out/loop + per-char/word stagger).
 *
 * Exercises the PURE evaluator {@link evaluateClipAnimation} (no canvas/DOM):
 *   - identity output when no animation is configured (existing render unchanged);
 *   - IN progress: 0 at start, partial mid, 1 at end (eased), and the `fade`
 *     proof preset's opacity tracks it;
 *   - OUT progress symmetric: 1 before the out window, partial mid, 0 at out;
 *   - LOOP continuity (phase at 0 == phase at 1, value seamless) + speed scales
 *     the period;
 *   - per-index stagger delays each unit's entrance;
 *   - composition with a per-cluster transform (P6.5 `ClusterTransform`).
 */
import { describe, expect, it } from 'vitest'
import type { ClipAnimation } from '../../../shared/project-schema'
import type { ClusterTransform } from '../../routes/editor/preview/textLayout'
import {
  composeSamples,
  evaluateClipAnimation,
  IDENTITY_SAMPLE,
  inProgress,
  loopPhase,
  outProgress,
  resolveLane,
  resolveLoopLane,
  staggerUnitCount
} from './clipAnimation'

const START = 1.0
const OUT = 4.0

describe('evaluateClipAnimation — identity (no animation)', () => {
  it('returns the identity output when animation is absent', () => {
    const o = evaluateClipAnimation({ animation: undefined, start: START, end: OUT, t: 2 })
    expect(o.active).toBe(false)
    expect(o.clip).toEqual(IDENTITY_SAMPLE)
    expect(o.glyph(0, 5)).toEqual(IDENTITY_SAMPLE)
  })

  it('returns identity when every lane is `none`/unknown preset', () => {
    const animation: ClipAnimation = { in: { preset: 'none', durationSec: 0.5, easing: 'linear' } }
    const o = evaluateClipAnimation({ animation, start: START, end: OUT, t: 2 })
    expect(o.active).toBe(false)
    expect(o.clip).toEqual(IDENTITY_SAMPLE)
  })
})

describe('IN progress + fade preset', () => {
  const lane = resolveLane({ preset: 'fade', durationSec: 1.0, easing: 'linear' })!

  it('is 0 at start, partial at mid, 1 at end', () => {
    expect(inProgress(lane, START, START)).toBeCloseTo(0, 6)
    expect(inProgress(lane, START, START + 0.5)).toBeCloseTo(0.5, 6)
    expect(inProgress(lane, START, START + 1.0)).toBeCloseTo(1, 6)
    expect(inProgress(lane, START, START + 2.0)).toBeCloseTo(1, 6) // pinned after
  })

  it('the fade preset opacity tracks IN progress', () => {
    const animation: ClipAnimation = { in: { preset: 'fade', durationSec: 1.0, easing: 'linear' } }
    const at = (t: number) => evaluateClipAnimation({ animation, start: START, end: OUT, t })
    expect(at(START).clip.opacity).toBeCloseTo(0, 6)
    expect(at(START + 0.5).clip.opacity).toBeCloseTo(0.5, 6)
    expect(at(START + 1.0).clip.opacity).toBeCloseTo(1, 6)
    expect(at(START).active).toBe(true) // opacity 0 != 1 → active
  })

  it('a zero-duration IN snaps to 1 at/after start', () => {
    const z = resolveLane({ preset: 'fade', durationSec: 0, easing: 'linear' })!
    expect(inProgress(z, START, START - 0.001)).toBe(0)
    expect(inProgress(z, START, START)).toBe(1)
  })
})

describe('OUT progress (symmetric to IN)', () => {
  const lane = resolveLane({ preset: 'fade', durationSec: 1.0, easing: 'linear' })!

  it('is 1 before the out window, partial mid, 0 at out', () => {
    expect(outProgress(lane, OUT, OUT - 1.5)).toBeCloseTo(1, 6) // before window
    expect(outProgress(lane, OUT, OUT - 1.0)).toBeCloseTo(1, 6) // window edge
    expect(outProgress(lane, OUT, OUT - 0.5)).toBeCloseTo(0.5, 6)
    expect(outProgress(lane, OUT, OUT)).toBeCloseTo(0, 6)
  })

  it('the fade preset fades the clip out over the trailing window', () => {
    const animation: ClipAnimation = { out: { preset: 'fade', durationSec: 1.0, easing: 'linear' } }
    const at = (t: number) => evaluateClipAnimation({ animation, start: START, end: OUT, t })
    expect(at(OUT - 1.5).clip.opacity).toBeCloseTo(1, 6)
    expect(at(OUT - 0.5).clip.opacity).toBeCloseTo(0.5, 6)
    expect(at(OUT).clip.opacity).toBeCloseTo(0, 6)
  })

  it('prefers `end` over deprecated `out` when both are provided', () => {
    const animation: ClipAnimation = { out: { preset: 'fade', durationSec: 1.0, easing: 'linear' } }
    const o = evaluateClipAnimation({
      animation,
      start: START,
      end: 10,
      out: 2,
      t: 9.5
    })
    // If deprecated `out` were used, t=9.5 would be long after fade-out (opacity 0).
    // Using `end`=10 means we're mid fade window [9,10], opacity ~0.5.
    expect(o.clip.opacity).toBeCloseTo(0.5, 6)
  })
})

describe('LOOP continuity + speed scaling', () => {
  const lane = resolveLoopLane({ preset: 'pulse', durationSec: 2.0, easing: 'linear', speed: 1 })!

  it('phase wraps seamlessly: phase(start) == phase(start + period)', () => {
    const period = lane.durationSec / lane.speed
    expect(loopPhase(lane, START, START)).toBeCloseTo(0, 6)
    expect(loopPhase(lane, START, START + period)).toBeCloseTo(0, 6)
    expect(loopPhase(lane, START, START + period / 2)).toBeCloseTo(0.5, 6)
  })

  it('the pulse preset value is identical at phase 0 and phase 1 (no jump at wrap)', () => {
    const animation: ClipAnimation = {
      loop: { preset: 'pulse', durationSec: 2.0, easing: 'linear', speed: 1 }
    }
    const period = 2.0
    const a = evaluateClipAnimation({ animation, start: START, end: OUT, t: START })
    const b = evaluateClipAnimation({ animation, start: START, end: OUT, t: START + period })
    expect(b.clip.scale).toBeCloseTo(a.clip.scale, 6)
    // mid-cycle differs (it actually animates)
    const mid = evaluateClipAnimation({ animation, start: START, end: OUT, t: START + period / 4 })
    expect(mid.clip.scale).not.toBeCloseTo(a.clip.scale, 3)
    expect(a.active).toBe(true) // a configured loop is always active
  })

  it('speed scales the period: 2x speed halves the cycle length', () => {
    const fast = resolveLoopLane({ preset: 'pulse', durationSec: 2.0, easing: 'linear', speed: 2 })!
    // period = 2/2 = 1s, so phase at +0.5s is mid-cycle (0.5).
    expect(loopPhase(fast, START, START + 0.5)).toBeCloseTo(0.5, 6)
    expect(loopPhase(fast, START, START + 1.0)).toBeCloseTo(0, 6)
  })
})

describe('per-character / per-word STAGGER', () => {
  it('delays each unit entrance by index * delaySec', () => {
    const animation: ClipAnimation = {
      in: {
        preset: 'fade',
        durationSec: 0.5,
        easing: 'linear',
        stagger: { unit: 'character', delaySec: 0.2 }
      }
    }
    // At t just after start, unit 0 has begun fading; unit 2 (delayed 0.4s) has not.
    const t = START + 0.1
    const o = evaluateClipAnimation({ animation, start: START, end: OUT, t })
    expect(o.glyph(0, 5).opacity).toBeGreaterThan(0) // started
    expect(o.glyph(2, 5).opacity).toBeCloseTo(0, 6) // delayed 0.4s → not yet
    expect(o.active).toBe(true)
  })

  it('later-indexed units catch up once their delay elapses', () => {
    const animation: ClipAnimation = {
      in: {
        preset: 'fade',
        durationSec: 0.5,
        easing: 'linear',
        stagger: { unit: 'word', delaySec: 0.2 }
      }
    }
    // unit 2 starts at start + 0.4 and finishes at +0.9. Sample at +0.9 → fully in.
    const o = evaluateClipAnimation({ animation, start: START, end: OUT, t: START + 0.9 })
    expect(o.glyph(2, 5).opacity).toBeCloseTo(1, 6)
  })

  it('no stagger → glyph sample equals the clip sample', () => {
    const animation: ClipAnimation = { in: { preset: 'fade', durationSec: 1, easing: 'linear' } }
    const o = evaluateClipAnimation({ animation, start: START, end: OUT, t: START + 0.5 })
    expect(o.glyph(3, 5)).toEqual(o.clip)
  })
})

describe('composition with a per-cluster transform (P6.5)', () => {
  it('composes the glyph sample onto a ClusterTransform additively/multiplicatively', () => {
    const animation: ClipAnimation = {
      loop: { preset: 'pulse', durationSec: 2.0, easing: 'linear', speed: 1 }
    }
    // pulse at phase 1/4 → scale = 1 + 0.08*sin(pi/2) = 1.08.
    const o = evaluateClipAnimation({ animation, start: START, end: OUT, t: START + 0.5 })
    const g = o.glyph(0, 1)
    expect(g.scale).toBeCloseTo(1.08, 6)

    // A straight arc cluster (curve=0 baseline): x=100, y=50, rotation=0, scale=1.
    const cluster: ClusterTransform = { cluster: 'கி', x: 100, y: 50, rotation: 0, scale: 1 }
    // Compose exactly as the draw path does: translate adds, rotation adds, scale multiplies.
    const composedX = cluster.x + g.tx
    const composedY = cluster.y + g.ty
    const composedRot = cluster.rotation + g.rotation
    const composedScale = cluster.scale * g.scale
    expect(composedX).toBeCloseTo(100, 6) // pulse has no translate
    expect(composedY).toBeCloseTo(50, 6)
    expect(composedRot).toBeCloseTo(0, 6)
    expect(composedScale).toBeCloseTo(1.08, 6)
  })

  it('composeSamples folds with IDENTITY as the neutral element', () => {
    const s = { opacity: 0.5, tx: 3, ty: -2, scale: 2, rotation: 0.1 }
    expect(composeSamples(s, IDENTITY_SAMPLE)).toEqual(s)
    expect(composeSamples(IDENTITY_SAMPLE, s)).toEqual(s)
    // multiply opacity/scale, add tx/ty/rotation
    const t = { opacity: 0.5, tx: 1, ty: 1, scale: 3, rotation: 0.2 }
    expect(composeSamples(s, t)).toEqual({
      opacity: 0.25,
      tx: 4,
      ty: -1,
      scale: 6,
      rotation: 0.30000000000000004
    })
  })
})

describe('staggerUnitCount (indic-text cluster vs word)', () => {
  it('counts words across lines', () => {
    expect(staggerUnitCount(['hello there', 'world'], 'word')).toBe(3)
    expect(staggerUnitCount([''], 'word')).toBe(0)
  })

  it('counts grapheme clusters (Tamil conjunct = one cluster)', () => {
    // `கி` is a single grapheme cluster (base + vowel sign).
    expect(staggerUnitCount(['கி'], 'character')).toBe(1)
    expect(staggerUnitCount(['ab'], 'character')).toBe(2)
  })
})

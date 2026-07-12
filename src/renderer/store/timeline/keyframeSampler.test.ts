/**
 * P8.7 — keyframe SAMPLER + preview composition tests (Doc 11; skill keyframe-engine).
 *
 * Proves the PURE evaluator behind keyframe-driven props: exact values at keyframe
 * times, eased interpolation between keyframes (linear + a non-linear segment),
 * clamp-hold before-first / after-last, single-kf constant, multi-prop independence,
 * rotation deg→rad / opacity / scale semantics, composition order with the base
 * transform + an animation sample, and empty keyframes → identity.
 */
import { describe, it, expect } from 'vitest'
import type { ClipKeyframes, Keyframe } from '../../../shared/project-schema'
import { ease } from '../../../shared/easing'
import { composeSamples, IDENTITY_SAMPLE, type AnimSample } from './clipAnimation'
import {
  sampleLane,
  sampleKeyframes,
  keyframeSample,
  sampleClipKeyframeSample,
  composeKeyframeWithAnimation,
  type KeyframeSampleValues
} from './keyframeSampler'

const kf = (t: number, value: number, e?: Keyframe['ease']): Keyframe =>
  e === undefined ? { t, value } : { t, value, ease: e }

describe('sampleLane — single lane interpolation', () => {
  it('empty lane → undefined (prop omitted)', () => {
    expect(sampleLane([], 0)).toBeUndefined()
    expect(sampleLane([], 5)).toBeUndefined()
  })

  it('single keyframe → constant for all time', () => {
    const lane = [kf(2, 42)]
    expect(sampleLane(lane, 0)).toBe(42)
    expect(sampleLane(lane, 2)).toBe(42)
    expect(sampleLane(lane, 100)).toBe(42)
    expect(sampleLane(lane, -10)).toBe(42)
  })

  it('returns EXACT keyframe values at keyframe times', () => {
    const lane = [kf(0, 10), kf(1, 30), kf(2, -5)]
    expect(sampleLane(lane, 0)).toBe(10)
    expect(sampleLane(lane, 1)).toBe(30)
    expect(sampleLane(lane, 2)).toBe(-5)
  })

  it('clamp-holds before the first and after the last keyframe', () => {
    const lane = [kf(1, 10), kf(3, 50)]
    expect(sampleLane(lane, -2)).toBe(10) // before first → first value
    expect(sampleLane(lane, 0.5)).toBe(10)
    expect(sampleLane(lane, 1)).toBe(10) // at first
    expect(sampleLane(lane, 4)).toBe(50) // after last → last value
    expect(sampleLane(lane, 999)).toBe(50)
  })

  it('LINEAR segment lerps between bracketing keyframes', () => {
    const lane = [kf(0, 0, 'linear'), kf(10, 100, 'linear')]
    expect(sampleLane(lane, 2.5)).toBeCloseTo(25, 10)
    expect(sampleLane(lane, 5)).toBeCloseTo(50, 10)
    expect(sampleLane(lane, 7.5)).toBeCloseTo(75, 10)
  })

  it('NON-LINEAR (easeInQuad) segment eases between keyframes', () => {
    const lane = [kf(0, 0, 'easeInQuad'), kf(1, 100, 'easeInQuad')]
    // easeInQuad(p) = p*p → at p=0.5 the eased value is 0.25 → 25.
    expect(sampleLane(lane, 0.5)).toBeCloseTo(100 * ease('easeInQuad', 0.5), 10)
    expect(sampleLane(lane, 0.5)).toBeCloseTo(25, 10)
    // Endpoints still hit exact values regardless of ease.
    expect(sampleLane(lane, 0)).toBe(0)
    expect(sampleLane(lane, 1)).toBe(100)
  })

  it('the LEAVING keyframe governs its segment (per-segment ease)', () => {
    // Segment [0,1] eases easeInQuad (kf0.ease); segment [1,2] is linear (kf1.ease).
    const lane = [kf(0, 0, 'easeInQuad'), kf(1, 10, 'linear'), kf(2, 20, 'linear')]
    expect(sampleLane(lane, 0.5)).toBeCloseTo(10 * ease('easeInQuad', 0.5), 10) // 2.5
    expect(sampleLane(lane, 1.5)).toBeCloseTo(15, 10) // linear mid of 10→20
  })

  it('absent ease defaults to linear', () => {
    const lane = [kf(0, 0), kf(4, 8)]
    expect(sampleLane(lane, 1)).toBeCloseTo(2, 10)
    expect(sampleLane(lane, 3)).toBeCloseTo(6, 10)
  })

  it('sample at progress {0,.25,.5,.75,1} on a known lane matches expected', () => {
    // 0→200 over t∈[0,1], linear → value = 200*p exactly at each progress.
    const lane = [kf(0, 0, 'linear'), kf(1, 200, 'linear')]
    expect(sampleLane(lane, 0)).toBeCloseTo(0, 10)
    expect(sampleLane(lane, 0.25)).toBeCloseTo(50, 10)
    expect(sampleLane(lane, 0.5)).toBeCloseTo(100, 10)
    expect(sampleLane(lane, 0.75)).toBeCloseTo(150, 10)
    expect(sampleLane(lane, 1)).toBeCloseTo(200, 10)
  })

  it('degenerate zero-width interior segment snaps to the later value (no NaN)', () => {
    // Three keyframes where the MIDDLE pair shares a time; sampling at that time
    // hits the zero-span guard (not the clamp-hold, which only covers the ends).
    const lane = [kf(0, 0), kf(1, 5), kf(1, 9), kf(2, 20)]
    const v = sampleLane(lane, 1)
    expect(Number.isNaN(v as number)).toBe(false)
    expect(v).toBe(9)
  })
})

describe('sampleKeyframes — multi-prop, only props with lanes', () => {
  it('empty / undefined keyframes → {}', () => {
    expect(sampleKeyframes(undefined, 0)).toEqual({})
    expect(sampleKeyframes({}, 5)).toEqual({})
  })

  it('returns ONLY props that have a (non-empty) lane', () => {
    const keyframes: ClipKeyframes = {
      x: [kf(0, 0, 'linear'), kf(1, 100, 'linear')],
      opacity: [kf(0, 1)]
    }
    const out = sampleKeyframes(keyframes, 0.5)
    expect(out.x).toBeCloseTo(50, 10)
    expect(out.opacity).toBe(1)
    expect('y' in out).toBe(false)
    expect('scale' in out).toBe(false)
    expect('rotation' in out).toBe(false)
  })

  it('an empty lane is treated as no override', () => {
    const keyframes: ClipKeyframes = { x: [], y: [kf(0, 7)] }
    const out = sampleKeyframes(keyframes, 0)
    expect('x' in out).toBe(false)
    expect(out.y).toBe(7)
  })

  it('lanes are INDEPENDENT — each prop sampled on its own timing', () => {
    const keyframes: ClipKeyframes = {
      x: [kf(0, 0, 'linear'), kf(2, 20, 'linear')], // mid at t=1 → 10
      scale: [kf(0, 1, 'linear'), kf(1, 3, 'linear')] // already at last at t=1 → 3
    }
    const out = sampleKeyframes(keyframes, 1)
    expect(out.x).toBeCloseTo(10, 10)
    expect(out.scale).toBeCloseTo(3, 10)
  })
})

describe('keyframeSample — units / semantics into an AnimSample', () => {
  it('empty values → IDENTITY_SAMPLE (neutral)', () => {
    expect(keyframeSample({})).toEqual(IDENTITY_SAMPLE)
  })

  it('x/y map to ADDITIVE tx/ty (px)', () => {
    const s = keyframeSample({ x: 30, y: -12 })
    expect(s.tx).toBe(30)
    expect(s.ty).toBe(-12)
    expect(s.scale).toBe(1) // untouched multiply neutral
    expect(s.opacity).toBe(1)
    expect(s.rotation).toBe(0)
  })

  it('scale maps to MULTIPLICATIVE scale', () => {
    expect(keyframeSample({ scale: 2.5 }).scale).toBe(2.5)
  })

  it('opacity maps to MULTIPLICATIVE opacity', () => {
    expect(keyframeSample({ opacity: 0.4 }).opacity).toBe(0.4)
  })

  it('rotation is converted DEGREES → RADIANS', () => {
    expect(keyframeSample({ rotation: 180 }).rotation).toBeCloseTo(Math.PI, 10)
    expect(keyframeSample({ rotation: 90 }).rotation).toBeCloseTo(Math.PI / 2, 10)
    expect(keyframeSample({ rotation: 0 }).rotation).toBe(0)
  })
})

describe('sampleClipKeyframeSample — end-to-end sample → AnimSample', () => {
  it('no keyframes → IDENTITY_SAMPLE (req. 4: unchanged rendering)', () => {
    expect(sampleClipKeyframeSample(undefined, 1.23)).toBe(IDENTITY_SAMPLE)
    expect(sampleClipKeyframeSample({}, 1.23)).toEqual(IDENTITY_SAMPLE)
  })

  it('samples + maps in one step at a clip-local time', () => {
    const keyframes: ClipKeyframes = {
      x: [kf(0, 0, 'linear'), kf(1, 100, 'linear')],
      rotation: [kf(0, 0, 'linear'), kf(1, 90, 'linear')]
    }
    const s = sampleClipKeyframeSample(keyframes, 0.5)
    expect(s.tx).toBeCloseTo(50, 10)
    expect(s.rotation).toBeCloseTo((45 * Math.PI) / 180, 10) // 45deg → rad
  })
})

describe('composition order with base transform + animation sample (req. 2)', () => {
  it('compose order keyframes → animation: tx/rotation ADD, scale/opacity MULTIPLY', () => {
    const kfS: AnimSample = keyframeSample({ x: 20, scale: 2, opacity: 0.5, rotation: 0 })
    const animS: AnimSample = { opacity: 0.5, tx: 5, ty: 0, scale: 3, rotation: 0 }
    const composed = composeKeyframeWithAnimation(kfS, animS)
    expect(composed.tx).toBe(25) // 20 + 5
    expect(composed.scale).toBe(6) // 2 * 3
    expect(composed.opacity).toBe(0.25) // 0.5 * 0.5
  })

  it('folding onto a base transform: kf x ADDS to translate, scale MULTIPLIES', () => {
    // Simulate the preview fold: base translate 960px, base scale 1.
    const baseTranslateX = 960
    const baseScale = 1
    const kfS = sampleClipKeyframeSample({ x: [kf(0, 40)], scale: [kf(0, 1.5)] }, 0)
    const clipSample = composeSamples(kfS, IDENTITY_SAMPLE) // no in/out/loop animation
    expect(baseTranslateX + clipSample.tx).toBe(1000)
    expect(baseScale * clipSample.scale).toBe(1.5)
  })

  it('keyframe opacity multiplies an animation fade (both applied)', () => {
    const kfS = sampleClipKeyframeSample({ opacity: [kf(0, 0.8)] }, 0)
    const fade: AnimSample = { ...IDENTITY_SAMPLE, opacity: 0.5 } // mid fade-in
    const composed = composeKeyframeWithAnimation(kfS, fade)
    expect(composed.opacity).toBeCloseTo(0.4, 10) // 0.8 * 0.5
  })

  it('IDENTITY animation + identity keyframes compose to identity', () => {
    const composed = composeKeyframeWithAnimation(IDENTITY_SAMPLE, IDENTITY_SAMPLE)
    expect(composed).toEqual(IDENTITY_SAMPLE)
  })
})

describe('determinism', () => {
  it('same inputs → same output', () => {
    const keyframes: ClipKeyframes = { x: [kf(0, 0, 'easeInOut'), kf(2, 50, 'linear')] }
    const a = sampleKeyframes(keyframes, 0.873)
    const b = sampleKeyframes(keyframes, 0.873)
    expect(a).toEqual(b)
    const expected: KeyframeSampleValues = { x: 50 * ease('easeInOut', 0.873 / 2) }
    expect(a.x).toBeCloseTo(expected.x as number, 10)
  })
})

/**
 * P8.13 — MILESTONE 8 seal: an INTEGRATION test that exercises the whole Phase-8
 * stack through its public composed entry points (not the per-module units, which
 * are covered by `clipAnimation.test`, `clipAnimationPresetsLoop.test`,
 * `trackingSampler.test`, and `beatDetect.test`). It proves the four milestone
 * guarantees end-to-end:
 *
 *   1. SAMPLE EVALUATOR at progress {0, .25, .5, .75, 1} — a linear `fade` IN
 *      folded through {@link composeClipSample} yields opacity exactly equal to the
 *      canonical progress fractions (the evaluator is sampled at the five points the
 *      runbook calls out), and the other channels stay identity.
 *   2. LOOP CONTINUITY — a `pulse` loop is SEAMLESS: the composed sample at loop
 *      phase 0 equals the sample at phase 1 (one full period later), so the wrap is
 *      invisible, and the period scales with `speed`.
 *   3. TRACKING on a KNOWN-MOTION clip — a synthetic path with a known linear
 *      subject displacement makes the attached text follow it: at the five progress
 *      points the composed `tx`/`ty` track the known motion (relative to the picked
 *      target), with the manual anchor added on top.
 *   4. BEATS vs METRONOME — a synthetic click train at a fixed period is detected by
 *      {@link detectBeats}: one beat per click, in order, with the inter-beat
 *      interval matching the metronome period (tempo grid recovered).
 *
 * PURE throughout — no canvas / DOM / IPC — so the milestone is deterministic.
 */
import { describe, expect, it } from 'vitest'
import type { ClipAnimation, ClipTracking } from '../../../shared/project-schema'
import type { TrackSample } from '../../../shared/tracking'
import { detectBeats } from '../../../shared/beatDetect'
import { IDENTITY_SAMPLE, evaluateClipAnimation } from './clipAnimation'
import { composeClipSample } from './keyframeSampler'

/** The five canonical progress points the runbook samples the evaluator at. */
const PROGRESS = [0, 0.25, 0.5, 0.75, 1] as const

const START = 1.0
const OUT = 4.0
/** Clip-local duration used to map a progress fraction → a clip-local time. */
const DURATION = 1.0

describe('P8.13 milestone — sample evaluator at progress {0,.25,.5,.75,1}', () => {
  // A linear `fade` IN over the whole DURATION: eased progress == raw progress, so
  // opacity at progress p is exactly p.
  const animation: ClipAnimation = {
    in: { preset: 'fade', durationSec: DURATION, easing: 'linear' }
  }

  it('folds the in-animation opacity through composeClipSample at each progress point', () => {
    for (const p of PROGRESS) {
      const t = START + p * DURATION
      const anim = evaluateClipAnimation({ animation, start: START, end: OUT, t }).clip
      const sample = composeClipSample({
        keyframeT: t - START,
        pathProgress: p,
        animation: anim
      })
      // Opacity tracks the linear IN progress exactly; nothing else moved.
      expect(sample.opacity).toBeCloseTo(p, 6)
      expect(sample.tx).toBeCloseTo(0, 6)
      expect(sample.ty).toBeCloseTo(0, 6)
      expect(sample.scale).toBeCloseTo(1, 6)
      expect(sample.rotation).toBeCloseTo(0, 6)
    }
  })

  it('is identity (no animation) at every progress point when no animation is set', () => {
    for (const p of PROGRESS) {
      const sample = composeClipSample({
        keyframeT: p * DURATION,
        pathProgress: p,
        animation: IDENTITY_SAMPLE
      })
      expect(sample).toEqual(IDENTITY_SAMPLE)
    }
  })
})

describe('P8.13 milestone — loop continuity (seamless wrap + speed)', () => {
  const animation: ClipAnimation = {
    loop: { preset: 'pulse', durationSec: 2.0, easing: 'linear', speed: 1 }
  }

  it('the composed sample at phase 0 equals the sample at exactly one period later', () => {
    const period = 2.0 // durationSec / speed
    const at = (t: number) => {
      const anim = evaluateClipAnimation({ animation, start: START, end: OUT, t }).clip
      return composeClipSample({ keyframeT: t - START, pathProgress: 0, animation: anim })
    }
    const a = at(START) // phase 0
    const b = at(START + period) // phase 1 → wraps to 0
    expect(b.opacity).toBeCloseTo(a.opacity, 6)
    expect(b.tx).toBeCloseTo(a.tx, 6)
    expect(b.ty).toBeCloseTo(a.ty, 6)
    expect(b.scale).toBeCloseTo(a.scale, 6)
    expect(b.rotation).toBeCloseTo(a.rotation, 6)
  })

  it('a 2× speed loop completes a full cycle in half the time (still seamless)', () => {
    const fast: ClipAnimation = {
      loop: { preset: 'pulse', durationSec: 2.0, easing: 'linear', speed: 2 }
    }
    const at = (t: number) => evaluateClipAnimation({ animation: fast, start: START, end: OUT, t }).clip
    // period = durationSec / speed = 1.0 → phase wraps after 1s.
    expect(at(START + 1.0).scale).toBeCloseTo(at(START).scale, 6)
  })
})

describe('P8.13 milestone — tracking on a known-motion clip', () => {
  // Subject moves a KNOWN +100px in x and +40px in y, linearly over DURATION.
  // fps=10 → 11 samples covering [0,1]; sampleTrackPath interpolates between them.
  const samples: TrackSample[] = Array.from({ length: 11 }, (_, k) => {
    const localT = k / 10
    return { t: localT, x: localT * 100, y: localT * 40 }
  })
  // Picked at the subject's start position so the pick-time offset is ~0.
  const tracking: ClipTracking = {
    enabled: true,
    fps: 10,
    targetBox: { x: 0, y: 0, width: 50, height: 50, kind: 'object' },
    path: samples,
    anchor: { dx: 5, dy: -3 }
  }

  it('the attached text follows the known displacement (+anchor) at each progress point', () => {
    for (const p of PROGRESS) {
      const t = START + p * DURATION
      const sample = composeClipSample({
        keyframeT: t - START,
        pathProgress: p,
        tracking,
        trackingT: t - START,
        animation: IDENTITY_SAMPLE
      })
      // tx = subjectX(p) - pickX + anchor.dx = 100*p - 0 + 5; ty = 40*p + (-3).
      expect(sample.tx).toBeCloseTo(100 * p + 5, 5)
      expect(sample.ty).toBeCloseTo(40 * p - 3, 5)
    }
  })

  it('a disabled attachment leaves the text unmoved (identity)', () => {
    const off: ClipTracking = { ...tracking, enabled: false }
    const sample = composeClipSample({
      keyframeT: 0.5,
      pathProgress: 0.5,
      tracking: off,
      trackingT: 0.5,
      animation: IDENTITY_SAMPLE
    })
    expect(sample).toEqual(IDENTITY_SAMPLE)
  })
})

describe('P8.13 milestone — beats vs metronome', () => {
  const SAMPLE_RATE = 44100
  const PERIOD_SEC = 0.5 // 120 BPM metronome
  const CLICK_COUNT = 8
  /** Silent lead-in so the FIRST click also has a rising edge to detect. */
  const LEAD_SEC = 0.25

  /**
   * Synthesize a metronome: silence with a short exponentially-decaying tone burst
   * (a sharp onset) at each click time. Deterministic — no randomness.
   */
  function metronome(): Float32Array {
    const totalSec = LEAD_SEC + PERIOD_SEC * CLICK_COUNT
    const buf = new Float32Array(Math.ceil(totalSec * SAMPLE_RATE))
    const burstSec = 0.02
    const burstLen = Math.floor(burstSec * SAMPLE_RATE)
    for (let c = 0; c < CLICK_COUNT; c++) {
      const onset = Math.floor((LEAD_SEC + c * PERIOD_SEC) * SAMPLE_RATE)
      for (let i = 0; i < burstLen && onset + i < buf.length; i++) {
        const env = Math.exp(-12 * (i / burstLen)) // sharp attack, fast decay
        buf[onset + i] = env * Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE)
      }
    }
    return buf
  }

  it('detects one beat per click with the metronome period recovered', () => {
    const beats = detectBeats(metronome(), SAMPLE_RATE)

    // One detected onset per click (allow ±1 for boundary frames).
    expect(beats.length).toBeGreaterThanOrEqual(CLICK_COUNT - 1)
    expect(beats.length).toBeLessThanOrEqual(CLICK_COUNT + 1)

    // Sorted ascending.
    for (let i = 1; i < beats.length; i++) expect(beats[i]).toBeGreaterThan(beats[i - 1])

    // The inter-beat interval recovers the metronome PERIOD (tempo grid), robust to
    // a small constant detection latency.
    for (let i = 1; i < beats.length; i++) {
      expect(beats[i] - beats[i - 1]).toBeCloseTo(PERIOD_SEC, 1)
    }
  })

  it('each click has a detected beat near its onset (constant latency only)', () => {
    const beats = detectBeats(metronome(), SAMPLE_RATE)
    expect(beats.length).toBe(CLICK_COUNT)
    // Measure the latency from the first click onset, then assert every click aligns
    // to a beat at that same offset within a tight tolerance.
    const latency = beats[0] - LEAD_SEC
    for (let c = 0; c < beats.length; c++) {
      const expected = LEAD_SEC + c * PERIOD_SEC + latency
      expect(beats[c]).toBeCloseTo(expected, 1)
    }
    expect(Math.abs(latency)).toBeLessThan(0.05)
  })

  it('returns no beats for pure silence', () => {
    const silence = new Float32Array(SAMPLE_RATE) // 1s of zeros
    expect(detectBeats(silence, SAMPLE_RATE)).toEqual([])
  })
})

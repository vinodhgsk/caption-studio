/**
 * P8.4 — LOOP-preset CATALOG (Wave, Bounce, Shake, Pulse/Breathe, Spin, Flicker,
 * Float/Drift, Donut) — continuous, speed-scaled loops over the clip's life.
 *
 * Asserts the SEAMLESS contract (req. 2 — THE correctness property) for every loop
 * preset plus the per-glyph / speed / determinism behaviours:
 *   - SEAMLESS: `f(phase = 0)` === `f(phase → 1)` within epsilon for every preset
 *     (no jump at the wrap), with Spin treated MODULARLY (2π ≡ 0);
 *   - SPEED: a faster speed advances `loopPhase` faster (period = durationSec/speed);
 *   - WAVE/DONUT are per-GLYPH: different glyph indices sit at different cycle points
 *     (a travelling wave / orbiting beads);
 *   - SHAKE/FLICKER are deterministic (same phase → same sample) AND periodic+seamless;
 *   - PULSE scale oscillates around 1;
 *   - the catalog enumerates ALL required ids;
 *   - a loop composes through the evaluator and is `active` for the clip's life,
 *     and coexists with an In entrance (req. — composes with effects).
 *
 * PURE: no canvas/DOM. Presets are sampled directly and through the evaluator.
 */
import { describe, expect, it } from 'vitest'
import type { ClipAnimation } from '../../../shared/project-schema'
import {
  evaluateClipAnimation,
  getAnimPreset,
  loopPhase,
  type LoopLane
} from './clipAnimation'
import {
  LOOP_PRESET_CATALOG,
  REQUIRED_LOOP_PRESET_IDS,
  registerLoopPresets,
  waveLoop,
  bounceLoop,
  shakeLoop,
  pulseLoop,
  spinLoop,
  flickerLoop,
  floatLoop,
  donutLoop
} from './clipAnimationPresetsLoop'

registerLoopPresets()

const TAU = 2 * Math.PI
const EPS = 1e-6

// The evaluator feeds LOOP presets the wrapped continuous phase ∈ [0,1).
const phase = (progress: number, index = 0, count = 1) =>
  ({ progress, kind: 'loop', index, count }) as const

/** Wrap a rotation to [0, 2π) so 2π ≡ 0 — the modular comparison Spin needs. */
function wrapRot(r: number): number {
  const m = r % TAU
  return m < 0 ? m + TAU : m
}

/**
 * Circular angular distance ∈ [0, π]: treats angles modulo 2π so that 0 and a value
 * just under 2π are considered ADJACENT (distance → 0), not 2π apart. This is the
 * correct way to assert Spin's modular seamlessness at the wrap boundary.
 */
function angDist(a: number, b: number): number {
  const d = wrapRot(a - b)
  return Math.min(d, TAU - d)
}

describe('every Loop preset is SEAMLESS: f(0) === f(phase→1) (req. 2)', () => {
  // phase→1 is the limit just before the wrap; sample very close to 1.
  const NEAR_ONE = 1 - 1e-9
  it.each(LOOP_PRESET_CATALOG.map((e) => [e.id, e.fn] as const))(
    'preset %s has no jump at the wrap (whole-clip)',
    (id, fn) => {
      const at0 = fn(phase(0))
      const at1 = fn(phase(NEAR_ONE))
      expect(at0.opacity).toBeCloseTo(at1.opacity, 4)
      expect(at0.tx).toBeCloseTo(at1.tx, 4)
      expect(at0.ty).toBeCloseTo(at1.ty, 4)
      expect(at0.scale).toBeCloseTo(at1.scale, 4)
      // Spin is modular: compare angular distance (2π ≡ 0).
      if (id === 'spin') {
        expect(angDist(at0.rotation, at1.rotation)).toBeCloseTo(0, 4)
      } else {
        expect(at0.rotation).toBeCloseTo(at1.rotation, 4)
      }
    }
  )

  it.each(LOOP_PRESET_CATALOG.map((e) => [e.id, e.fn] as const))(
    'preset %s is seamless per-glyph too (index 2 of 5)',
    (id, fn) => {
      const at0 = fn(phase(0, 2, 5))
      const at1 = fn(phase(NEAR_ONE, 2, 5))
      expect(at0.tx).toBeCloseTo(at1.tx, 4)
      expect(at0.ty).toBeCloseTo(at1.ty, 4)
      expect(at0.scale).toBeCloseTo(at1.scale, 4)
      expect(at0.opacity).toBeCloseTo(at1.opacity, 4)
      if (id === 'spin') {
        expect(angDist(at0.rotation, at1.rotation)).toBeCloseTo(0, 4)
      } else {
        expect(at0.rotation).toBeCloseTo(at1.rotation, 4)
      }
    }
  )
})

describe('every Loop preset actually MOVES across the cycle (not constant) (req. 1)', () => {
  it.each(LOOP_PRESET_CATALOG.map((e) => [e.id, e.fn] as const))(
    'preset %s differs from its phase-0 value somewhere mid-cycle',
    (_id, fn) => {
      const base = fn(phase(0, 1, 4))
      let moved = false
      for (const p of [0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9]) {
        const s = fn(phase(p, 1, 4))
        const differs =
          Math.abs(s.opacity - base.opacity) > EPS ||
          Math.abs(s.tx - base.tx) > EPS ||
          Math.abs(s.ty - base.ty) > EPS ||
          Math.abs(s.scale - base.scale) > EPS ||
          Math.abs(wrapRot(s.rotation) - wrapRot(base.rotation)) > EPS
        if (differs) moved = true
      }
      expect(moved).toBe(true)
    }
  )
})

describe('Wave is a per-GLYPH travelling wave (req. 3)', () => {
  it('different glyph indices sit at different vertical offsets at the same phase', () => {
    const p = 0.0
    const g0 = waveLoop(phase(p, 0, 6)).ty
    const g1 = waveLoop(phase(p, 1, 6)).ty
    const g2 = waveLoop(phase(p, 2, 6)).ty
    // Not all equal → the wave is travelling across glyphs.
    expect(g0 === g1 && g1 === g2).toBe(false)
  })
  it('whole-clip (count 1) is a single in-phase bob: ty = 0 at phase 0', () => {
    expect(waveLoop(phase(0)).ty).toBeCloseTo(0, 6)
    expect(waveLoop(phase(0.25)).ty).toBeCloseTo(14, 6)
  })
})

describe('Donut is a per-GLYPH circular path (req. 3)', () => {
  it('traces a circle: tx^2 + ty^2 is ~constant (radius) across phase', () => {
    const r2 = (p: number) => {
      const s = donutLoop(phase(p, 0, 1))
      return s.tx * s.tx + s.ty * s.ty
    }
    const base = r2(0)
    for (const p of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      expect(r2(p)).toBeCloseTo(base, 4)
    }
    expect(base).toBeGreaterThan(0)
  })
  it('different glyphs orbit at different points of the ring (beads)', () => {
    const a = donutLoop(phase(0, 0, 8))
    const b = donutLoop(phase(0, 2, 8))
    expect(a.tx === b.tx && a.ty === b.ty).toBe(false)
  })
})

describe('Pulse / Breathe scale oscillates around 1 (req. 5)', () => {
  it('scale crosses above and below 1 over the cycle, centred at 1', () => {
    expect(pulseLoop(phase(0)).scale).toBeCloseTo(1, 6)
    expect(pulseLoop(phase(0.25)).scale).toBeGreaterThan(1)
    expect(pulseLoop(phase(0.75)).scale).toBeLessThan(1)
    // Symmetric about 1.
    const up = pulseLoop(phase(0.25)).scale - 1
    const down = 1 - pulseLoop(phase(0.75)).scale
    expect(up).toBeCloseTo(down, 6)
  })
})

describe('Spin rotates a full turn per period and wraps MODULARLY (req. 2 + 5)', () => {
  it('rotation goes 0 → 2π across the cycle', () => {
    expect(spinLoop(phase(0)).rotation).toBeCloseTo(0, 6)
    expect(spinLoop(phase(0.5)).rotation).toBeCloseTo(Math.PI, 6)
    expect(spinLoop(phase(1 - 1e-12)).rotation).toBeCloseTo(TAU, 4)
  })
  it('2π ≡ 0 (modular wrap → seamless orientation)', () => {
    expect(angDist(spinLoop(phase(0)).rotation, spinLoop(phase(1 - 1e-12)).rotation)).toBeCloseTo(
      0,
      4
    )
  })
})

describe('Shake is deterministic + periodic + seamless (req. 2 + 5)', () => {
  it('same phase → same sample (no Date/Math.random)', () => {
    expect(shakeLoop(phase(0.37, 2, 5))).toEqual(shakeLoop(phase(0.37, 2, 5)))
  })
  it('different glyph index → different (seeded) jitter', () => {
    const a = shakeLoop(phase(0.37, 0, 5))
    const b = shakeLoop(phase(0.37, 1, 5))
    expect(a.tx === b.tx && a.ty === b.ty).toBe(false)
  })
  it('seamless: tx/ty at phase 0 === at phase →1', () => {
    const at0 = shakeLoop(phase(0, 3, 5))
    const at1 = shakeLoop(phase(1 - 1e-9, 3, 5))
    expect(at0.tx).toBeCloseTo(at1.tx, 4)
    expect(at0.ty).toBeCloseTo(at1.ty, 4)
  })
})

describe('Flicker is deterministic + periodic + seamless, stays readable (req. 2 + 5)', () => {
  it('same phase → same opacity', () => {
    expect(flickerLoop(phase(0.42)).opacity).toBe(flickerLoop(phase(0.42)).opacity)
  })
  it('opacity stays within [0,1] and flickers (varies across phase)', () => {
    const vals = [0, 0.2, 0.4, 0.6, 0.8].map((p) => flickerLoop(phase(p)).opacity)
    for (const v of vals) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
    expect(new Set(vals).size).toBeGreaterThan(1)
  })
  it('seamless: opacity at phase 0 === at phase →1', () => {
    expect(flickerLoop(phase(0)).opacity).toBeCloseTo(flickerLoop(phase(1 - 1e-9)).opacity, 4)
  })
})

describe('Bounce / Float return to origin at the wrap (seamless) (req. 2)', () => {
  it('bounce ty is 0 at phase 0 and dips negative mid-cycle', () => {
    expect(bounceLoop(phase(0)).ty).toBeCloseTo(0, 6)
    expect(bounceLoop(phase(0.5)).ty).toBeLessThan(0)
    expect(bounceLoop(phase(1 - 1e-9)).ty).toBeCloseTo(0, 4)
  })
  it('float traces a smooth path starting and ending at the origin', () => {
    expect(floatLoop(phase(0)).tx).toBeCloseTo(0, 6)
    expect(floatLoop(phase(0)).ty).toBeCloseTo(0, 6)
    expect(floatLoop(phase(1 - 1e-9)).tx).toBeCloseTo(0, 4)
    expect(floatLoop(phase(1 - 1e-9)).ty).toBeCloseTo(0, 4)
  })
})

describe('speed scales the loop period (req. 1)', () => {
  const mk = (speed: number): LoopLane => ({
    preset: 'pulse',
    durationSec: 2,
    speed,
    easing: 'linear'
  })
  it('a faster speed advances phase faster at the same elapsed time', () => {
    const start = 0
    const t = 0.5 // elapsed
    const slow = loopPhase(mk(1), start, t) // period 2 → phase 0.25
    const fast = loopPhase(mk(2), start, t) // period 1 → phase 0.5
    expect(slow).toBeCloseTo(0.25, 6)
    expect(fast).toBeCloseTo(0.5, 6)
    expect(fast).toBeGreaterThan(slow)
  })
  it('phase wraps to [0,1) over multiple periods', () => {
    const lane = mk(1) // period 2
    expect(loopPhase(lane, 0, 2)).toBeCloseTo(0, 6) // one full period → back to 0
    expect(loopPhase(lane, 0, 3)).toBeCloseTo(0.5, 6)
  })
})

describe('catalog enumerates ALL required loop presets (req. 4)', () => {
  it('lists every required id with a label + registered fn', () => {
    const ids = LOOP_PRESET_CATALOG.map((e) => e.id)
    for (const required of REQUIRED_LOOP_PRESET_IDS) {
      expect(ids).toContain(required)
    }
    for (const entry of LOOP_PRESET_CATALOG) {
      expect(entry.label.length).toBeGreaterThan(0)
      expect(entry.defaultDurationSec).toBeGreaterThan(0)
      expect(getAnimPreset('loop', entry.id)).toBe(entry.fn)
    }
  })
  it('marks Wave + Donut as per-glyph and the rest whole-clip', () => {
    const byId = new Map(LOOP_PRESET_CATALOG.map((e) => [e.id, e]))
    expect(byId.get('wave')?.perGlyph).toBe(true)
    expect(byId.get('donut')?.perGlyph).toBe(true)
    for (const id of ['bounce', 'shake', 'pulse', 'spin', 'flicker', 'float']) {
      expect(byId.get(id)?.perGlyph).toBe(false)
    }
  })
})

describe('Loop composes through the evaluator and is active for the clip life (req. — composes with effects)', () => {
  const START = 1.0
  const OUT = 5.0
  const mk = (preset: string, extra: Record<string, unknown> = {}): ClipAnimation => ({
    loop: { preset, durationSec: 2, speed: 1, easing: 'linear', ...extra }
  })

  it('a configured loop is active and moves the clip transform mid-life', () => {
    const o = evaluateClipAnimation({ animation: mk('spin'), start: START, end: OUT, t: START + 0.5 })
    expect(o.active).toBe(true)
    // 0.5s into a 2s period → phase 0.25 → rotation π/2.
    expect(o.clip.rotation).toBeCloseTo(Math.PI / 2, 6)
  })

  it('per-glyph wave gives different glyphs different offsets through glyph()', () => {
    const o = evaluateClipAnimation({ animation: mk('wave'), start: START, end: OUT, t: START })
    const a = o.glyph(0, 6)
    const b = o.glyph(2, 6)
    expect(a.ty === b.ty).toBe(false)
  })

  it('loop coexists with an IN entrance (composes): mid-entrance opacity < 1 while the loop spins', () => {
    const animation: ClipAnimation = {
      in: { preset: 'fade', durationSec: 0.5, easing: 'linear' },
      loop: { preset: 'spin', durationSec: 2, speed: 1, easing: 'linear' }
    }
    const o = evaluateClipAnimation({ animation, start: START, end: OUT, t: START + 0.25 })
    // Fade mid-entrance halves opacity; the spin contributes rotation simultaneously.
    expect(o.clip.opacity).toBeCloseTo(0.5, 6)
    expect(o.clip.rotation).toBeCloseTo((TAU * 0.25) / 2, 6) // phase 0.125 → rotation
  })

  it('a per-character loop stagger shifts unit phases (and stays active)', () => {
    const o = evaluateClipAnimation({
      animation: mk('pulse', { stagger: { unit: 'character', delaySec: 0.3 } }),
      start: START,
      end: OUT,
      t: START + 0.5
    })
    expect(o.active).toBe(true)
    // Different units sample the pulse at different phases → different scales.
    expect(o.glyph(0, 4).scale === o.glyph(1, 4).scale).toBe(false)
  })
})

/**
 * LOOP-preset CATALOG (P8.4 — Doc 06 §"Loop presets"; skills `keyframe-engine`
 * + `indic-text`).
 *
 * The full CONTINUOUS animation library, built ON TOP of the P8.1 evaluator
 * (`clipAnimation.ts`) and MIRRORING the P8.2 / P8.3 In/Out catalogs
 * (`clipAnimationPresetsIn.ts` / `...Out.ts`). Each preset is a PURE function
 * `(AnimPhase) → AnimSample` registered under kind `'loop'` via
 * {@link registerAnimPreset}; the evaluator owns all timing/speed/stagger and
 * feeds each preset the WRAPPED continuous phase ∈ [0,1) from {@link loopPhase}
 * (already speed-scaled: period = `durationSec / speed`, and already SHIFTED for
 * the unit's stagger index). A preset only describes the SHAPE of the cycle as a
 * function of phase — nothing about time, period, or speed.
 *
 * SEAMLESS CONTRACT (req. 2 — THE critical correctness property): every loop
 * preset is a SEAMLESS, continuous function of phase, i.e. `f(phase → 1) === f(0)`
 * within epsilon, so when {@link loopPhase} wraps 1 → 0 there is NO visible jump.
 * This is guaranteed structurally:
 *   - sin/cos presets (Wave, Bounce, Pulse, Float, Donut) read `2π·phase`, and a
 *     full turn of sine/cosine is periodic (`sin(2π) === sin(0)`), so the value at
 *     phase 1 equals the value at phase 0 exactly;
 *   - Spin's rotation is `2π·phase`, which we treat MODULARLY — `2π` ≡ `0` as a
 *     rotation, so the visible orientation is identical at phase 0 and phase 1
 *     (the rotation channel is composed mod 2π by the draw path; tests assert the
 *     wrap is modular);
 *   - Shake / Flicker are deterministic, periodic functions of `2π·phase` (a sum
 *     of sines / harmonics), so they too return to their phase-0 value at phase 1.
 * Nothing in this module reads Date / Math.random — the cycle is a pure function
 * of phase, so preview and export are identical.
 *
 * PER-GLYPH (req. 3): Wave and Donut are per-GLYPH travelling presets. They read
 * `index`/`count` to offset each glyph's phase along the travelling wave / around
 * the circular path, so the motion sweeps across the text rather than moving the
 * whole clip in lock-step. The per-glyph phase offset is `index / count` of a
 * full cycle (a fraction of 2π), which keeps the per-glyph function ITSELF seamless
 * (it is still `sin/cos(2π·phase + constant)`). All other presets are whole-clip:
 * they ignore `index`/`count` and animate the clip transform uniformly.
 *
 * STAGGER (req. — shared with In/Out): the evaluator may ALSO apply a per-unit
 * time stagger before computing the phase (a `loop.stagger`), which shifts a unit's
 * phase by a time delay; that is orthogonal to the intrinsic per-glyph travelling
 * offset Wave/Donut add here. Both compose.
 *
 * SPEED (req. 1): speed-scaling lives entirely in {@link loopPhase} (period =
 * `durationSec / speed`), so a faster speed advances `phase` faster and the same
 * seamless preset cycles quicker — the preset functions here are speed-agnostic.
 *
 * GALLERY (req. 4): {@link LOOP_PRESET_CATALOG} enumerates every preset (id + label)
 * for the P8.5 panel gallery.
 */
import {
  IDENTITY_SAMPLE,
  registerAnimPreset,
  type AnimPhase,
  type AnimPreset
} from './clipAnimation'

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

const TAU = 2 * Math.PI

/** The cycle angle for a phase ∈ [0,1): `2π·phase`. `angle(0) ≡ angle(1)` (mod 2π). */
function angle(phase: number): number {
  return TAU * phase
}

/**
 * The per-glyph travelling phase OFFSET, in radians: glyph `index` of `count` is
 * shifted by `index/count` of a full cycle. Reading `2π·(phase + index/count)`
 * keeps the per-glyph function itself a pure sine/cosine of phase, so it remains
 * seamless (`f(phase→1) === f(0)`) while neighbouring glyphs sit at different points
 * of the cycle — a travelling wave / a bead moving around the donut. PURE.
 */
function glyphOffset(index: number, count: number): number {
  if (!(count > 1) || index <= 0) return 0
  return TAU * (index / count)
}

/**
 * Deterministic periodic jitter ∈ [-1, 1] for Shake/Flicker. It is a SUM of sines
 * whose frequencies are INTEGER multiples of the base cycle, so the whole sum is
 * periodic with period 1 in `phase` (each term returns to its phase-0 value at
 * phase 1 → the sum is seamless). The per-unit `seed` shifts the phases so different
 * glyphs jitter differently, but every unit is still seamless. Pure: no Date/random.
 */
function periodicNoise(phase: number, seed: number): number {
  const a = angle(phase)
  // Integer harmonics (1,2,3) → period exactly 1 in phase; seed offsets per unit.
  const v =
    0.6 * Math.sin(a + seed * 1.7) +
    0.3 * Math.sin(2 * a + seed * 3.1) +
    0.1 * Math.sin(3 * a + seed * 5.3)
  // The amplitude sum is 0.6+0.3+0.1 = 1.0, so v ∈ [-1, 1].
  return v
}

// ---------------------------------------------------------------------------
// The Loop-preset functions (each: phase ∈ [0,1) → sample; f(0) === f(1))
// ---------------------------------------------------------------------------

/** Displacement amplitudes (px) / scale deltas tuned for a readable caption. */
const WAVE_PX = 14
const BOUNCE_PX = 16
const SHAKE_PX = 6
const FLOAT_PX = 8
const DONUT_PX = 12
const PULSE_AMT = 0.08

/**
 * Wave — a travelling vertical sine: each GLYPH bobs up/down on `sin(2π·phase +
 * glyphOffset)`, so the crest sweeps across the text (req. 3 per-glyph). Whole-clip
 * (index 0 / count 1) it is a single in-phase bob. Seamless: `sin` of a full turn.
 */
const waveLoop: AnimPreset = ({ progress, index, count }: AnimPhase) => ({
  ...IDENTITY_SAMPLE,
  ty: WAVE_PX * Math.sin(angle(progress) + glyphOffset(index, count))
})

/**
 * Bounce — a periodic vertical hop using `|sin|`-style energy but kept SEAMLESS by
 * driving it from a full cosine cycle: `ty = -A·(1 - cos(2π·phase))/2` dips down and
 * returns, with `f(0) === f(1) === 0`. A whole-clip bob (no per-glyph offset).
 */
const bounceLoop: AnimPreset = ({ progress }: AnimPhase) => ({
  ...IDENTITY_SAMPLE,
  // (1 - cos) is 0 at phase 0 and 1; peaks at phase 0.5 → one smooth hop per cycle.
  ty: -BOUNCE_PX * (1 - Math.cos(angle(progress))) * 0.5
})

/**
 * Shake — a deterministic horizontal jitter (and a touch of vertical) that is
 * periodic + seamless via {@link periodicNoise}. Whole-clip by default; per-unit
 * seeding (the `index`) gives a different but still-seamless shudder per glyph when
 * sampled through `glyph()`. No Date/random (req. 2 deterministic).
 */
const shakeLoop: AnimPreset = ({ progress, index }: AnimPhase) => ({
  ...IDENTITY_SAMPLE,
  tx: SHAKE_PX * periodicNoise(progress, index + 1),
  ty: 0.4 * SHAKE_PX * periodicNoise(progress, index + 13)
})

/**
 * Pulse / Breathe — scale breathes around 1 on a full sine cycle (replaces/extends
 * the P8.1 proof `pulse`). `scale = 1 + A·sin(2π·phase)` oscillates symmetrically
 * about 1 and `f(0) === f(1) === 1`. Whole-clip.
 */
const pulseLoop: AnimPreset = ({ progress }: AnimPhase) => ({
  ...IDENTITY_SAMPLE,
  scale: 1 + PULSE_AMT * Math.sin(angle(progress))
})

/**
 * Spin — continuous rotation: ONE full turn per period (`rotation = 2π·phase`). At
 * phase 1 the rotation is `2π`, which as an ANGLE is identical to `0` — so the loop
 * is seamless MODULO 2π (req. 2 "spin wraps modularly"). The draw path applies the
 * rotation mod 2π, and tests assert `2π ≡ 0`. Whole-clip.
 */
const spinLoop: AnimPreset = ({ progress }: AnimPhase) => ({
  ...IDENTITY_SAMPLE,
  rotation: angle(progress)
})

/**
 * Flicker — a deterministic opacity flicker: opacity wobbles within a band around a
 * high baseline on a periodic noise so it never fully disappears (a readable
 * flicker). Seamless + deterministic via {@link periodicNoise} (req. 2). Whole-clip.
 */
const FLICKER_BASE = 0.75
const FLICKER_AMP = 0.25
const flickerLoop: AnimPreset = ({ progress, index }: AnimPhase) => {
  // Map periodic noise [-1,1] → [base-amp, base+amp]; clamped to [0,1] for safety.
  const o = FLICKER_BASE + FLICKER_AMP * periodicNoise(progress, index + 7)
  return {
    ...IDENTITY_SAMPLE,
    opacity: o < 0 ? 0 : o > 1 ? 1 : o
  }
}

/**
 * Float / Drift — a slow gentle drift: the clip traces a small smooth ellipse via
 * `cos`/`sin` (x on cosine, y on a half-frequency... no — kept to integer harmonics
 * to stay seamless). `tx = A·sin(2π·phase)`, `ty = (A/2)·cos(2π·phase) - A/2` so the
 * path is a gentle oval and `f(0) === f(1)`. Whole-clip; reads as a lazy bob/drift.
 */
const floatLoop: AnimPreset = ({ progress }: AnimPhase) => {
  const a = angle(progress)
  return {
    ...IDENTITY_SAMPLE,
    tx: FLOAT_PX * Math.sin(a),
    // Offset so y starts at 0 (cos(0)=1 → term 0) and returns at phase 1.
    ty: 0.5 * FLOAT_PX * (Math.cos(a) - 1)
  }
}

/**
 * Donut — a circular translate path: each GLYPH orbits a small circle, offset around
 * the ring by its index so the glyphs are beads travelling around the donut (req. 3
 * per-glyph). `tx = R·cos(θ)`, `ty = R·sin(θ)` with `θ = 2π·phase + glyphOffset`.
 * Seamless: a full revolution returns to the start (`f(0) === f(1)`).
 */
const donutLoop: AnimPreset = ({ progress, index, count }: AnimPhase) => {
  const theta = angle(progress) + glyphOffset(index, count)
  return {
    ...IDENTITY_SAMPLE,
    tx: DONUT_PX * Math.cos(theta),
    ty: DONUT_PX * Math.sin(theta)
  }
}

// ---------------------------------------------------------------------------
// Catalog + registration
// ---------------------------------------------------------------------------

/** A catalog entry for the P8.5 panel gallery: stable id, human label, default speed. */
export interface LoopPresetEntry {
  /** Stable preset id (registered under kind `'loop'`; persisted to `clip.animation.loop.preset`). */
  id: string
  /** Human-readable gallery label. */
  label: string
  /** The loop period (seconds) the panel should default to at speed 1. */
  defaultDurationSec: number
  /** True when the preset's motion is intrinsically per-GLYPH (Wave, Donut). */
  perGlyph: boolean
  /** The pure preset function (also registered in the global registry). */
  fn: AnimPreset
}

/**
 * The FULL Loop-preset catalog (req. 1 + 4). Order is the gallery order. Each `fn` is
 * registered under kind `'loop'` (below) so {@link getAnimPreset}('loop', id) resolves
 * it, and the panel enumerates this list for its thumbnails.
 */
export const LOOP_PRESET_CATALOG: readonly LoopPresetEntry[] = [
  { id: 'wave', label: 'Wave', defaultDurationSec: 1.6, perGlyph: true, fn: waveLoop },
  { id: 'bounce', label: 'Bounce', defaultDurationSec: 1.0, perGlyph: false, fn: bounceLoop },
  { id: 'shake', label: 'Shake', defaultDurationSec: 0.5, perGlyph: false, fn: shakeLoop },
  { id: 'pulse', label: 'Pulse / Breathe', defaultDurationSec: 1.8, perGlyph: false, fn: pulseLoop },
  { id: 'spin', label: 'Spin', defaultDurationSec: 2.0, perGlyph: false, fn: spinLoop },
  { id: 'flicker', label: 'Flicker', defaultDurationSec: 0.6, perGlyph: false, fn: flickerLoop },
  { id: 'float', label: 'Float / Drift', defaultDurationSec: 3.0, perGlyph: false, fn: floatLoop },
  { id: 'donut', label: 'Donut', defaultDurationSec: 2.0, perGlyph: true, fn: donutLoop }
]

/** Register the full Loop catalog into the shared evaluator registry. Idempotent. */
export function registerLoopPresets(): void {
  for (const entry of LOOP_PRESET_CATALOG) {
    registerAnimPreset('loop', entry.id, entry.fn)
  }
}

// Register on import so any consumer that imports the catalog (or this module's
// side-effect) gets the presets wired without an explicit call. Re-registering is
// harmless (the registry overwrites by id with the same fns). This intentionally
// REPLACES the P8.1 proof `pulse` with the catalog `pulse` (same id, equivalent shape).
registerLoopPresets()

/** The set of required Loop-preset ids (Doc 06 §"Loop presets"; P8.4), for tests/validation. */
export const REQUIRED_LOOP_PRESET_IDS: readonly string[] = [
  'wave',
  'bounce',
  'shake',
  'pulse',
  'spin',
  'flicker',
  'float',
  'donut'
]

export {
  waveLoop,
  bounceLoop,
  shakeLoop,
  pulseLoop,
  spinLoop,
  flickerLoop,
  floatLoop,
  donutLoop
}

/**
 * Clip ANIMATION evaluator (P8.1 — Doc 06 text animation; skills `keyframe-engine`
 * + `indic-text`).
 *
 * Given a clip's animation config (`clip.animation = { in, out, loop }`), the
 * clip's `[start, out]` span, and the current playhead time, this computes —
 * PURELY, with NO canvas / DOM / Date — the clip's animated OUTPUT at that time:
 * an opacity, a transform offset (translate / scale / rotation), and a per-glyph
 * offset function for per-character / per-word staggered presets.
 *
 *   IN   plays over `[start, start + in.durationSec]`              (entrance)
 *   OUT  plays over `[out - out.durationSec, out]`                  (exit)
 *   LOOP plays continuously for the clip's life, speed-scaled + seamless (`f(0)==f(1)`)
 *
 * SPLIT (parity): this evaluator is the SINGLE source of truth the live preview
 * (`PreviewCanvas`) and the future export read, so an animation looks identical in
 * both. The draw code only MULTIPLIES the clip alpha by `output.opacity` and
 * COMPOSES `output.transform` onto the clip transform (and `output.glyph(i)` onto
 * each per-cluster transform). No animation math lives in the draw code.
 *
 * P8.1 SCOPE: the evaluation MODEL + the composition primitives. The actual In /
 * Out / Loop preset CATALOGS are P8.2 / P8.3 / P8.4 — a preset is just a function
 * `(phase) → AnimSample` registered by id here, and this module ships the
 * built-in registry plus ONE trivial proof preset per kind (`fade` in/out,
 * `pulse` loop) so the wiring + tests are exercised end-to-end. Adding the full
 * catalog is purely registering more functions; the evaluator does not change.
 *
 * HEADLESS-SAFE + PURE: deterministic, measurer-free. Same inputs → same output.
 */
import type { ClipAnimation } from '../../../shared/project-schema'
import type { Easing } from '../../../shared/captionPreset'
import { ease, type EasingSpec } from '../../../shared/easing'
import { splitGraphemes } from '../../../shared/captionSync'

// ---------------------------------------------------------------------------
// Output shape — what the draw path composes per clip per frame
// ---------------------------------------------------------------------------

/**
 * An animation SAMPLE — a delta applied ON TOP of the clip's static transform /
 * each per-cluster transform. Everything is an ADDITIVE/MULTIPLICATIVE neutral by
 * default so the IDENTITY sample ({@link IDENTITY_SAMPLE}) changes nothing:
 *   - `opacity`  MULTIPLIES the clip alpha (1 = unchanged).
 *   - `tx`/`ty`  ADD to the translate, in px (0 = unchanged).
 *   - `scale`    MULTIPLIES the scale (1 = unchanged).
 *   - `rotation` ADDS to the rotation, in RADIANS (0 = unchanged).
 *
 * Community animation extensions (P8C — optional; absent = identity / no-op):
 *   - `scaleX`/`scaleY`: non-uniform scale (jelly-squash; absent → use `scale`).
 *   - `blur`: gaussian blur radius in px (focus-blur-in, perspective-slam).
 *   - `letterSpacing`: em tracking (focus-blur-in).
 *   - `glowIntensity`: neon glow intensity 0–1 (neon-flicker).
 *   - `gradientOffset`: shimmer gradient phase 0–1 (shimmer-gradient).
 *   - `fontWeight`: variable-font wght axis 100–900 (variable-weight-wave).
 *   - `glyphOverride`: content substitution string (scramble-decode).
 */
export interface AnimSample {
  /** Multiplicative opacity factor in [0,1]. */
  opacity: number
  /** Additive x translation, px. */
  tx: number
  /** Additive y translation, px. */
  ty: number
  /** Multiplicative uniform scale. */
  scale: number
  /** Additive rotation, radians. */
  rotation: number
  // --- Community animation extensions (optional — identity/absent when unused) ---
  /** Non-uniform X scale multiplier (jelly-squash). Absent → inherit `scale`. */
  scaleX?: number
  /** Non-uniform Y scale multiplier (jelly-squash). Absent → inherit `scale`. */
  scaleY?: number
  /** Gaussian blur radius, px (focus-blur-in, perspective-slam). Absent → 0. */
  blur?: number
  /** Letter-spacing / tracking in em units (focus-blur-in). Absent → 0. */
  letterSpacing?: number
  /** Neon glow intensity 0–1 (neon-flicker). Absent → 1 (full glow). */
  glowIntensity?: number
  /** Shimmer gradient phase 0–1 (shimmer-gradient). Absent → no shift. */
  gradientOffset?: number
  /** Variable-font wght axis value 100–900 (variable-weight-wave). Absent → inherited. */
  fontWeight?: number
  /** Content substitution for scramble-decode. Absent → show original glyph. */
  glyphOverride?: string
}

/** The no-op sample: composes to leave a transform/opacity unchanged. */
export const IDENTITY_SAMPLE: AnimSample = Object.freeze({
  opacity: 1,
  tx: 0,
  ty: 0,
  scale: 1,
  rotation: 0,
})

/**
 * The full animation OUTPUT for a clip at a given playhead time. `clip` is the
 * whole-clip sample (applied once to the clip transform/alpha). `glyph(index,
 * count)` returns the per-unit sample for a STAGGERED preset (each glyph/word
 * delayed by its index); for a non-staggered animation it returns the same
 * `clip` sample for every index. The draw path composes `glyph` onto each
 * per-cluster transform (P6.5 `layoutArcClusters`) / per-word slot. PURE.
 */
export interface AnimationOutput {
  /** Whole-clip sample (the un-staggered, clip-level transform + opacity). */
  clip: AnimSample
  /**
   * Per-unit sample. `index` is the 0-based glyph (grapheme cluster) or word
   * index; `count` is the total number of units (so a preset can normalize the
   * stagger). Returns {@link IDENTITY_SAMPLE} for a finished/inactive animation.
   */
  glyph: (index: number, count: number) => AnimSample
  /** True when ANY animation is active at this time (an effect is being applied). */
  active: boolean
}

/** The identity output — nothing animating; the draw path renders unchanged. */
export const IDENTITY_OUTPUT: AnimationOutput = {
  clip: IDENTITY_SAMPLE,
  glyph: () => IDENTITY_SAMPLE,
  active: false,
}

// ---------------------------------------------------------------------------
// Preset model — a preset is a pure function of phase + the active easing
// ---------------------------------------------------------------------------

/**
 * The PHASE a preset function is sampled at. `progress` is the eased 0→1 (for
 * in/out) or the raw continuous phase (for loop). `kind` tells a shared preset
 * which direction it runs. `index`/`count` are the staggered unit position (the
 * evaluator already applied the per-unit time delay before sampling, so a preset
 * sees the phase ALREADY shifted for that unit). PURE inputs only.
 */
export interface AnimPhase {
  /** Eased progress: in/out 0→1; loop is the wrapped continuous phase (also 0→1). */
  progress: number
  /** Which lane this is — lets one function serve both in and out. */
  kind: 'in' | 'out' | 'loop'
  /** Unit index for stagger (0 for the clip-level sample). */
  index: number
  /** Total unit count (1 for the clip-level sample). */
  count: number
}

/** A preset: phase → sample. PURE. (P8.2–P8.4 register the full catalog.) */
export type AnimPreset = (phase: AnimPhase) => AnimSample

// ---------------------------------------------------------------------------
// Built-in preset registry (P8.1 proof presets; P8.2–P8.4 extend this)
// ---------------------------------------------------------------------------

const IN_PRESETS = new Map<string, AnimPreset>()
const OUT_PRESETS = new Map<string, AnimPreset>()
const LOOP_PRESETS = new Map<string, AnimPreset>()

function registryFor(kind: 'in' | 'out' | 'loop'): Map<string, AnimPreset> {
  return kind === 'in' ? IN_PRESETS : kind === 'out' ? OUT_PRESETS : LOOP_PRESETS
}

/**
 * Register an animation preset under `id` for a lane. P8.2 (In), P8.3 (Out), and
 * P8.4 (Loop) call this to populate the full catalogs WITHOUT touching the
 * evaluator. Re-registering an id overwrites it. Returns nothing. PURE-ish (only
 * mutates the module registry; the preset fn itself must be pure).
 */
export function registerAnimPreset(kind: 'in' | 'out' | 'loop', id: string, fn: AnimPreset): void {
  registryFor(kind).set(id, fn)
}

/** Look up a registered preset (or `undefined` for `none`/unknown ids). */
export function getAnimPreset(kind: 'in' | 'out' | 'loop', id: string): AnimPreset | undefined {
  return registryFor(kind).get(id)
}

// --- P8.1 proof presets (one per lane) so the pipeline is exercised end-to-end.

/**
 * `fade` (in/out): opacity ramps 0→1 (the eased `progress` already encodes the
 * direction — for OUT the evaluator feeds `1 - rawProgress`, so a single function
 * fades both ways). No transform delta. The simplest correct entrance/exit.
 */
const fadePreset: AnimPreset = ({ progress }) => ({
  ...IDENTITY_SAMPLE,
  opacity: progress,
})

/**
 * `pulse` (loop): a seamless breathe — scale oscillates around 1 over one period.
 * `f(phase 0) === f(phase 1)` (a full sine cycle) so the loop has NO jump at wrap.
 */
const pulsePreset: AnimPreset = ({ progress }) => ({
  ...IDENTITY_SAMPLE,
  scale: 1 + 0.08 * Math.sin(progress * 2 * Math.PI),
})

registerAnimPreset('in', 'fade', fadePreset)
registerAnimPreset('out', 'fade', fadePreset)
registerAnimPreset('loop', 'pulse', pulsePreset)

// ---------------------------------------------------------------------------
// Config normalization — read the open `clip.animation` bag into typed refs
// ---------------------------------------------------------------------------

/** A normalized in/out animation lane resolved off `clip.animation`. */
export interface AnimLane {
  preset: string
  durationSec: number
  easing: Easing
  /** Stagger unit + per-unit delay (P8.1 per-char/word). Absent → no stagger. */
  stagger?: AnimStagger
}

/** A normalized loop lane resolved off `clip.animation.loop`. */
export interface LoopLane {
  preset: string
  /** Loop PERIOD in seconds at speed 1 (`durationSec`); the period scales by 1/speed. */
  durationSec: number
  /** Speed multiplier (>0). Default 1. Higher = faster cycles. */
  speed: number
  easing: Easing
  stagger?: AnimStagger
}

/**
 * Per-character / per-word STAGGER (P8.1). Each unit's animation is delayed by
 * `index * delaySec`. `unit: 'character'` advances by GRAPHEME CLUSTER (indic-text)
 * so a Tamil/Indic conjunct animates as ONE unit; `unit: 'word'` delays whole words.
 */
export interface AnimStagger {
  unit: 'character' | 'word'
  /** Per-index delay, seconds (>= 0). */
  delaySec: number
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback
}
function easingOf(v: unknown): Easing {
  return str(v, 'linear') as Easing
}

function staggerOf(ref: Record<string, unknown> | undefined): AnimStagger | undefined {
  const s = ref?.stagger
  if (typeof s !== 'object' || s === null) return undefined
  const obj = s as Record<string, unknown>
  const unit = obj.unit === 'word' ? 'word' : obj.unit === 'character' ? 'character' : undefined
  if (unit === undefined) return undefined
  const delaySec = num(obj.delaySec, 0)
  if (delaySec <= 0) return undefined
  return { unit, delaySec }
}

/** Resolve an in/out lane from the open `clip.animation[key]` bag (or `undefined`). */
export function resolveLane(ref: Record<string, unknown> | undefined): AnimLane | undefined {
  if (ref === undefined) return undefined
  const preset = str(ref.preset, 'none')
  if (preset === 'none') return undefined
  return {
    preset,
    durationSec: Math.max(0, num(ref.durationSec, 0)),
    easing: easingOf(ref.easing),
    stagger: staggerOf(ref),
  }
}

/** Resolve the loop lane from `clip.animation.loop` (or `undefined`). */
export function resolveLoopLane(ref: Record<string, unknown> | undefined): LoopLane | undefined {
  if (ref === undefined) return undefined
  const preset = str(ref.preset, 'none')
  if (preset === 'none') return undefined
  // The loop period comes from `durationSec`; `speed` scales it (default 1).
  return {
    preset,
    durationSec: Math.max(0, num(ref.durationSec, 1)) || 1,
    speed: Math.max(1e-6, num(ref.speed, 1)),
    easing: easingOf(ref.easing),
    stagger: staggerOf(ref),
  }
}

// ---------------------------------------------------------------------------
// Composition — fold samples together (loop over in/out, glyph over clip, etc.)
// ---------------------------------------------------------------------------

/**
 * Compose two samples: opacity + scale MULTIPLY; tx/ty/rotation ADD. The optional
 * community extension fields from `b` OVERRIDE the corresponding fields from `a`
 * when present (a preset that sets `blur` wins; a preset without it inherits `a`'s).
 * Associative, with {@link IDENTITY_SAMPLE} as the neutral element, so a draw path
 * can fold an arbitrary stack (clip × loop × glyph) without ordering surprises. PURE.
 */
export function composeSamples(a: AnimSample, b: AnimSample): AnimSample {
  const result: AnimSample = {
    opacity: a.opacity * b.opacity,
    tx: a.tx + b.tx,
    ty: a.ty + b.ty,
    scale: a.scale * b.scale,
    rotation: a.rotation + b.rotation,
  }
  // Community extension fields: b's value wins when defined, else inherit a's.
  if (b.scaleX !== undefined || a.scaleX !== undefined) result.scaleX = b.scaleX ?? a.scaleX
  if (b.scaleY !== undefined || a.scaleY !== undefined) result.scaleY = b.scaleY ?? a.scaleY
  if (b.blur !== undefined || a.blur !== undefined) result.blur = (b.blur ?? 0) + (a.blur ?? 0)
  if (b.letterSpacing !== undefined || a.letterSpacing !== undefined) result.letterSpacing = (b.letterSpacing ?? 0) + (a.letterSpacing ?? 0)
  if (b.glowIntensity !== undefined) result.glowIntensity = b.glowIntensity
  else if (a.glowIntensity !== undefined) result.glowIntensity = a.glowIntensity
  if (b.gradientOffset !== undefined) result.gradientOffset = b.gradientOffset
  else if (a.gradientOffset !== undefined) result.gradientOffset = a.gradientOffset
  if (b.fontWeight !== undefined) result.fontWeight = b.fontWeight
  else if (a.fontWeight !== undefined) result.fontWeight = a.fontWeight
  if (b.glyphOverride !== undefined) result.glyphOverride = b.glyphOverride
  else if (a.glyphOverride !== undefined) result.glyphOverride = a.glyphOverride
  return result
}

// ---------------------------------------------------------------------------
// The evaluator
// ---------------------------------------------------------------------------

/** Inputs the caller resolves off the clip + playhead. */
export interface EvaluateAnimationOptions {
  /** The clip's animation bundle (`clip.animation`); absent → identity output. */
  animation?: ClipAnimation
  /** Clip timeline start (`clip.start`), seconds — anchors the IN window + loop. */
  start: number
  /**
   * Clip timeline END (`clip.start + clipDuration(clip)`), seconds — anchors
   * the OUT window. Preferred field for call sites.
   */
  end?: number
  /**
   * @deprecated Use `end` (timeline end) instead. Kept for backward
   * compatibility with existing tests/callers.
   */
  out?: number
  /** Current playhead time, seconds (same reference as `start`/`out`). */
  t: number
  /**
   * Unit COUNT for stagger normalization (glyph clusters or words). When a
   * stagger is configured the evaluator needs to know how many units exist so a
   * per-unit delay can be applied; the draw path passes the laid-out count. When
   * omitted it falls back to the per-call `glyph(index,count)` `count` argument.
   */
  unitCount?: number
}

/**
 * Eased IN progress at time `t`: 0 before `start`, ramps 0→1 over `durationSec`,
 * pinned at 1 after. A zero-duration IN is an instant snap to 1. Returns the
 * eased value (the preset receives this directly). Exported for tests. PURE.
 */
export function inProgress(lane: AnimLane, start: number, t: number): number {
  if (lane.durationSec <= 0) return t >= start ? 1 : 0
  const raw = (t - start) / lane.durationSec
  return ease(lane.easing as EasingSpec, raw)
}

/**
 * Eased OUT progress at time `t`, expressed as the ENTRANCE-style 0→1 the preset
 * consumes (so a `fade` preset fades OUT by reading opacity = progress): it is 1
 * before the out window, ramps 1→0 over the trailing `durationSec`, and is 0 at/
 * after `out`. i.e. `progress = ease(timeUntilOut / durationSec)`. Exported for
 * tests. PURE.
 */
export function outProgress(lane: AnimLane, out: number, t: number): number {
  if (lane.durationSec <= 0) return t >= out ? 0 : 1
  const start = out - lane.durationSec
  if (t <= start) return 1
  if (t >= out) return 0
  const untilOut = (out - t) / lane.durationSec
  return ease(lane.easing as EasingSpec, untilOut)
}

/**
 * Continuous LOOP phase at time `t`, wrapped to `[0,1)`. The period is
 * `durationSec / speed` (higher speed → shorter period → faster cycles); a seamless
 * loop preset (e.g. a full sine cycle) has `f(0) === f(1)` so the wrap is invisible.
 * Anchored at `start` so the loop is deterministic regardless of where playback
 * began. Exported for tests. PURE.
 */
export function loopPhase(lane: LoopLane, start: number, t: number): number {
  const period = lane.durationSec / lane.speed
  if (!(period > 0)) return 0
  const elapsed = t - start
  const phase = (elapsed % period) / period
  return phase < 0 ? phase + 1 : phase
}

/**
 * The number of stagger units at time `t` is fixed, but each unit's effective
 * time is shifted by `index * delaySec`. This returns the SHIFTED time for the
 * IN lane (unit starts later) and OUT lane (later units START exiting later too,
 * i.e. they LINGER). For loop, the shift offsets the unit's phase. PURE helper.
 */
function staggeredTime(t: number, index: number, stagger: AnimStagger | undefined): number {
  if (stagger === undefined || index <= 0) return t
  return t - index * stagger.delaySec
}

/**
 * PURE animation evaluator: returns the {@link AnimationOutput} for a clip at
 * playhead time `t`. Composition rules:
 *   - The CLIP sample is `compose(in, out, loop)` evaluated at the un-staggered
 *     (index 0) time. With no animation configured it is {@link IDENTITY_SAMPLE}
 *     and `active` is false — the draw path renders exactly as before (req. 4).
 *   - The `glyph(index, count)` sample re-evaluates in/out (and loop) at the
 *     index-staggered time, so each glyph/word enters/exits offset by
 *     `index * delaySec`. With no stagger configured it returns the clip sample.
 *
 * `in`/`out`/`loop` all compose, so an entrance + a continuous loop coexist (the
 * loop runs underneath; the entrance multiplies opacity / adds offset on top).
 */
export function evaluateClipAnimation(opts: EvaluateAnimationOptions): AnimationOutput {
  const { animation, start, t } = opts
  const out = opts.end ?? opts.out
  if (out === undefined) return IDENTITY_OUTPUT
  if (animation === undefined) return IDENTITY_OUTPUT

  const inLane = resolveLane(animation.in as Record<string, unknown> | undefined)
  const outLane = resolveLane(animation.out as Record<string, unknown> | undefined)
  const loopLane = resolveLoopLane(animation.loop as Record<string, unknown> | undefined)

  if (inLane === undefined && outLane === undefined && loopLane === undefined) {
    return IDENTITY_OUTPUT
  }

  const inFn = inLane ? getAnimPreset('in', inLane.preset) : undefined
  const outFn = outLane ? getAnimPreset('out', outLane.preset) : undefined
  const loopFn = loopLane ? getAnimPreset('loop', loopLane.preset) : undefined

  // Sample one lane stack at a given (already-staggered) time for unit `index`.
  const sampleAt = (time: number, index: number, count: number): AnimSample => {
    let acc = IDENTITY_SAMPLE
    if (inLane && inFn) {
      const p = inProgress(inLane, start, time)
      acc = composeSamples(acc, inFn({ progress: p, kind: 'in', index, count }))
    }
    if (outLane && outFn) {
      const p = outProgress(outLane, out, time)
      acc = composeSamples(acc, outFn({ progress: p, kind: 'out', index, count }))
    }
    if (loopLane && loopFn) {
      const phase = loopPhase(loopLane, start, time)
      acc = composeSamples(acc, loopFn({ progress: phase, kind: 'loop', index, count }))
    }
    return acc
  }

  const clip = sampleAt(t, 0, 1)

  // `active` = any visible delta from identity (a fade mid-entrance, a loop, etc.).
  const active =
    clip.opacity !== 1 ||
    clip.tx !== 0 ||
    clip.ty !== 0 ||
    clip.scale !== 1 ||
    clip.rotation !== 0 ||
    inLane?.stagger !== undefined ||
    outLane?.stagger !== undefined ||
    loopLane?.stagger !== undefined ||
    // A configured loop is always "active" (it animates for the whole clip).
    loopLane !== undefined

  const glyph = (index: number, count: number): AnimSample => {
    const total = opts.unitCount ?? count
    // Stagger applies per lane; we shift each lane's time independently so an IN
    // stagger and a LOOP stagger can differ. Use the IN stagger for the IN/OUT
    // shift (entrance/exit cascade) and the loop stagger for the loop phase.
    let acc = IDENTITY_SAMPLE
    if (inLane && inFn) {
      const time = staggeredTime(t, index, inLane.stagger)
      const p = inProgress(inLane, start, time)
      acc = composeSamples(acc, inFn({ progress: p, kind: 'in', index, count: total }))
    }
    if (outLane && outFn) {
      const time = staggeredTime(t, index, outLane.stagger)
      const p = outProgress(outLane, out, time)
      acc = composeSamples(acc, outFn({ progress: p, kind: 'out', index, count: total }))
    }
    if (loopLane && loopFn) {
      const time = staggeredTime(t, index, loopLane.stagger)
      const phase = loopPhase(loopLane, start, time)
      acc = composeSamples(acc, loopFn({ progress: phase, kind: 'loop', index, count: total }))
    }
    return acc
  }

  return { clip, glyph, active }
}

/**
 * Convenience: the stagger UNIT COUNT for a clip's text given its lines — words
 * across all lines, or grapheme clusters (indic-text) across all lines, per the
 * configured stagger unit. The draw path passes this as `unitCount` so a per-unit
 * delay can be normalized against the real laid-out count. Pure; cluster-safe.
 */
export function staggerUnitCount(lines: readonly string[], unit: 'character' | 'word'): number {
  if (unit === 'word') {
    return lines.reduce((n, line) => n + (line.length === 0 ? 0 : line.split(' ').length), 0)
  }
  return lines.reduce((n, line) => n + splitGraphemes(line).length, 0)
}

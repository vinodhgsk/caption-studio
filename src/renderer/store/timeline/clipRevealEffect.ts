/**
 * Kinetic TEXT REVEAL-EFFECTS engine (P8R.1 — Doc 15; skills `reveal-effects`,
 * `text-render`, `keyframe-engine`, `indic-text`).
 *
 * This is the Doc-15 counterpart to the Doc-06 animation evaluator
 * ({@link import('./clipAnimation').evaluateClipAnimation}): given a clip's reveal
 * config (`clip.animation.reveal`), the clip's `start`, the playhead time, and the
 * laid-out glyph boxes, it computes — PURELY, with NO canvas / DOM / Date — the
 * reveal OUTPUT at that time: a block-level clip {@link RevealMask}, an optional
 * per-unit (char/word/line) sample list, and a list of decorative
 * {@link RevealOverlay}s (border, sweep bar, sheen band, stripes, curtain panels).
 *
 * NOT the same as the Doc-03 caption reveal in `captionReveal.ts`: that one is the
 * transcript-driven word/character POP (keyed off `reveal.mode`) and reads the SAME
 * open `clip.animation.reveal` bag. The two coexist by DISCRIMINATOR — a Doc-15
 * kinetic reveal is present only when the bag carries a non-empty `effectId`, so a
 * `mode`-only (Doc-03) reveal is never hijacked here, and vice-versa.
 *
 * SPLIT (parity): like the animation evaluator, this is the SINGLE source of truth
 * the live preview AND the headless export read, so a reveal looks identical in
 * both. The draw path consumes `{ mask, perUnit, overlays }` to clip the base glyph
 * layer, transform each unit, and paint the overlays — no reveal math lives in the
 * draw code (`ffmpeg-export` bakes the identical frame).
 *
 * P8R.1 SCOPE: the evaluation MODEL + the composition output shapes + the registry,
 * plus TWO trivial proof effects (`wipe`, a one-shot block mask; `glint`, a looping
 * sheen overlay) so the wiring + tests are exercised end-to-end. The nine real
 * effects (Frame / Swipe / Type / Slide / Glossy / Appear-by / Stomp / Stripe /
 * Curtain) are P8R.2–P8R.10 — each is just a registered {@link RevealEffectFn}; the
 * evaluator does not change.
 *
 * HEADLESS-SAFE + PURE: deterministic, measurer-free. Same inputs → same output.
 * One-shot effects are functions of EASED progress `p ∈ [0,1]` over `duration`;
 * loop effects (Glossy + any `loop:true` variant) are functions of a wrapped,
 * speed-scaled phase `∈ [0,1)` that is SEAMLESS at the wrap (`phase(0) == phase(period)`).
 */
import type { Easing } from '../../../shared/captionPreset'
import { clamp01, ease } from '../../../shared/easing'
import type { GlyphBox, GlyphBoxLayout } from '../../routes/editor/preview/textLayout'

// ---------------------------------------------------------------------------
// Output shapes — what the draw path composes per clip per frame
// ---------------------------------------------------------------------------

/** The unit a per-unit reveal is indexed by (grapheme cluster / word / line). */
export type RevealUnitKind = 'char' | 'word' | 'line'

/** The axis/edge a wipe, slide, or split travels along. */
export type RevealDirection = 'l' | 'r' | 't' | 'b' | 'center'

/**
 * A BLOCK-LEVEL clip mask over the base glyph layer:
 *   - `none`  → no clipping; the glyphs are fully visible (`coverage` is 1).
 *   - `wipe`  → a single moving edge travels along `direction`; `coverage` is the
 *               fraction already revealed (0 → nothing, 1 → all).
 *   - `split` → a symmetric reveal opening from `center`/edges; `coverage` is the
 *               opened fraction (curtain).
 * `softness` is the edge feather in px (0 = a hard edge). The draw path turns this
 * into the actual clip rect / gradient; this stays a pure, resolution-relative
 * description so preview and export build the SAME region.
 */
export interface RevealMask {
  kind: 'none' | 'wipe' | 'split'
  /** Revealed fraction 0→1. */
  coverage: number
  direction: RevealDirection
  /** Edge feather, px (0 = hard). */
  softness: number
}

/** The no-op mask: nothing clipped (the base glyphs render fully). */
export const IDENTITY_MASK: RevealMask = Object.freeze({
  kind: 'none',
  coverage: 1,
  direction: 'l',
  softness: 0,
})

/**
 * A per-unit (char/word/line) reveal sample: a transform delta applied ON TOP of
 * each unit's static position, plus a per-unit clip `coverage` (for a masked slide
 * where each unit is clipped to its own box). Neutral defaults leave a unit
 * unchanged (opacity/scale 1, tx/ty/rotation 0, coverage 1).
 */
export interface RevealUnit {
  /** Multiplicative opacity 0→1. */
  opacity: number
  /** Additive x translation, px. */
  tx: number
  /** Additive y translation, px. */
  ty: number
  /** Multiplicative uniform scale. */
  scale: number
  /** Additive rotation, radians. */
  rotation: number
  /** Per-unit clip coverage 0→1 (1 = unclipped). */
  coverage: number
}

/** The neutral per-unit sample — leaves a unit untouched. */
export const IDENTITY_UNIT: RevealUnit = Object.freeze({
  opacity: 1,
  tx: 0,
  ty: 0,
  scale: 1,
  rotation: 0,
  coverage: 1,
})

/**
 * A decorative overlay drawn WITHIN the reveal stack (so it stacks predictably with
 * Doc 04 effects + Doc 05 decorations): a Frame border, a Swipe bar, a Glossy sheen
 * band, Stripe bars, Curtain panels, or a typewriter caret. `box` is in the
 * block-center-relative px space of {@link GlyphBox}; `progress` is this overlay's
 * own 0→1 sweep/draw amount; `color` defaults to the text color (resolved by the
 * panel/UI, P8R.11). `params` carries effect-specific knobs (band width, stripe gap,
 * border thickness, caret blink state…).
 */
export interface RevealOverlay {
  kind: 'frame' | 'bar' | 'sheen' | 'stripe' | 'panel' | 'caret' | 'liquid' | 'particles'
  box: GlyphBox
  /** This overlay's sweep/draw progress 0→1. */
  progress: number
  direction: RevealDirection
  /** Hex color; absent → the draw path uses the text color. */
  color?: string
  params?: Record<string, unknown>
}

/**
 * The full reveal OUTPUT for a clip at a given playhead time. The draw path:
 *   1. clips the base glyph layer by `mask`,
 *   2. composes `perUnit[i]` onto unit `i`'s transform (when non-empty),
 *   3. paints each `overlays[]` entry.
 * `unit` tells the draw path how `perUnit` is indexed. `active` is false when the
 * reveal contributes nothing (fully revealed, no overlays) so the draw path can
 * skip the reveal stack entirely.
 */
export interface RevealEffectOutput {
  mask: RevealMask
  perUnit: RevealUnit[]
  overlays: RevealOverlay[]
  unit: RevealUnitKind
  active: boolean
}

/** The identity output — nothing revealing; the draw path renders unchanged. */
export const IDENTITY_REVEAL_OUTPUT: RevealEffectOutput = {
  mask: IDENTITY_MASK,
  perUnit: [],
  overlays: [],
  unit: 'line',
  active: false,
}

// ---------------------------------------------------------------------------
// Effect model — an effect is a pure function of phase + layout
// ---------------------------------------------------------------------------

/**
 * The PHASE a reveal effect is sampled at. `progress` is the EASED 0→1 for a
 * one-shot effect, or the wrapped, speed-scaled phase 0→1 for a `loop` effect (the
 * evaluator already applied easing / wrapping). `localSec` is the RAW clip-local
 * time (`t - clip.start`, seconds) for time-based sub-animations whose rate is
 * INDEPENDENT of the reveal duration — e.g. a Type caret blink that keeps blinking
 * at a fixed Hz even after the text finishes typing (and `progress` saturates at 1).
 * `direction` + `unit` are the resolved config; `params` is the effect's open knob
 * bag; `layout` is the laid-out glyph geometry (block / line / word / cluster boxes)
 * the effect reads for per-unit samples + overlay geometry. PURE inputs only.
 */
export interface RevealPhase {
  /** Eased one-shot progress 0→1, or the wrapped loop phase 0→1. */
  progress: number
  /** Raw clip-local time (`t - start`), seconds — for duration-independent blinks/ticks. */
  localSec: number
  /** True when this is a continuous loop effect (`progress` is a wrapped phase). */
  loop: boolean
  direction: RevealDirection
  unit: RevealUnitKind
  params: Record<string, unknown>
  layout: GlyphBoxLayout
}

/** A reveal effect: phase → output. PURE. (P8R.2–P8R.10 register the catalog.) */
export type RevealEffectFn = (phase: RevealPhase) => RevealEffectOutput

// ---------------------------------------------------------------------------
// Effect registry (P8R.1 proof effects; P8R.2–P8R.10 extend this)
// ---------------------------------------------------------------------------

const REVEAL_EFFECTS = new Map<string, RevealEffectFn>()

/**
 * Register a reveal effect under `effectId`. P8R.2–P8R.10 call this to populate the
 * full catalog WITHOUT touching the evaluator. Re-registering an id overwrites it.
 * The effect fn itself must be PURE.
 */
export function registerRevealEffect(id: string, fn: RevealEffectFn): void {
  REVEAL_EFFECTS.set(id, fn)
}

/** Look up a registered reveal effect (or `undefined` for an unknown id). */
export function getRevealEffect(id: string): RevealEffectFn | undefined {
  return REVEAL_EFFECTS.get(id)
}

// --- P8R.1 proof effects (one one-shot, one loop) so the pipeline is exercised.

/**
 * `wipe` (one-shot, MASK proof): a single edge travels along `direction`, revealing
 * the block; `coverage` tracks the eased `progress`. The simplest correct reveal —
 * it exercises the `mask` output channel end-to-end. Active until fully revealed.
 */
const wipeEffect: RevealEffectFn = ({ progress, direction, unit }) => ({
  mask: { kind: 'wipe', coverage: progress, direction, softness: 0 },
  perUnit: [],
  overlays: [],
  unit,
  active: progress < 1,
})

/**
 * `glint` (loop, OVERLAY proof): a sheen band sweeps across the (already-visible)
 * glyphs; the band position rides the wrapped loop `progress`, so its geometry at
 * phase 0 equals phase 1 (SEAMLESS at the wrap). Exercises the `overlays` channel +
 * the loop timing path. The base glyphs stay fully visible (identity mask).
 */
const glintEffect: RevealEffectFn = ({ progress, direction, unit, layout }) => ({
  mask: { ...IDENTITY_MASK },
  perUnit: [],
  overlays: [{ kind: 'sheen', box: layout.block, progress, direction }],
  unit,
  active: true,
})

registerRevealEffect('wipe', wipeEffect)
registerRevealEffect('glint', glintEffect)

// ---------------------------------------------------------------------------
// Config normalization — read the open `clip.animation.reveal` bag into a ref
// ---------------------------------------------------------------------------

/** A normalized Doc-15 reveal config resolved off `clip.animation.reveal`. */
export interface RevealEffectRef {
  effectId: string
  unit: RevealUnitKind
  direction: RevealDirection
  /** Reveal length, seconds (one-shot) / loop PERIOD at speed 1 (loop). */
  durationSec: number
  ease: Easing
  /** Continuous loop (Glossy / any loop variant) vs one-shot reveal. */
  loop: boolean
  /** Loop speed multiplier (>0); scales the period by 1/speed. Default 1. */
  speed: number
  /** Effect-specific knob bag (passed through to the effect fn). */
  params: Record<string, unknown>
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}
function unitOf(v: unknown): RevealUnitKind {
  return v === 'char' || v === 'word' || v === 'line' ? v : 'line'
}
function directionOf(v: unknown): RevealDirection {
  return v === 'l' || v === 'r' || v === 't' || v === 'b' || v === 'center' ? v : 'b'
}
function paramsOf(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
}

/**
 * Resolve a Doc-15 {@link RevealEffectRef} from the open `clip.animation.reveal`
 * bag, or `undefined` when there is no kinetic reveal to apply. Returns `undefined`
 * unless the bag carries a non-empty `effectId` (so a Doc-03 `mode`-only caption
 * reveal is never mistaken for a kinetic effect). `duration` is read in seconds
 * (the Doc-15 schema field), falling back to `durationSec` for consistency with the
 * animation lanes. PURE.
 */
export function resolveRevealEffect(
  ref: Record<string, unknown> | undefined
): RevealEffectRef | undefined {
  if (ref === undefined) return undefined
  const effectId = ref.effectId
  if (typeof effectId !== 'string' || effectId.length === 0) return undefined
  return {
    effectId,
    unit: unitOf(ref.unit),
    direction: directionOf(ref.direction),
    durationSec: Math.max(0, num(ref.duration ?? ref.durationSec, 0)),
    ease: (typeof ref.ease === 'string' && ref.ease.length > 0 ? ref.ease : 'linear') as Easing,
    loop: bool(ref.loop, false),
    speed: Math.max(1e-6, num(ref.speed, 1)),
    params: paramsOf(ref.params),
  }
}

// ---------------------------------------------------------------------------
// Per-unit geometry helper (consumed by every per-unit effect, P8R.5/7/8)
// ---------------------------------------------------------------------------

/**
 * Flatten a {@link GlyphBoxLayout} into the ordered list of boxes for `unit`:
 *   - `line` → one box per line, top-to-bottom,
 *   - `word` → one box per word, reading order,
 *   - `char` → one box per GRAPHEME CLUSTER (indic-text), reading order — a Tamil
 *     conjunct is ONE box, never split per codepoint.
 * The index of each box matches the `perUnit[]` index a per-unit effect returns, so
 * the draw path can pair `perUnit[i]` with `revealUnitBoxes(layout, unit)[i]`. PURE.
 */
export function revealUnitBoxes(layout: GlyphBoxLayout, unit: RevealUnitKind): GlyphBox[] {
  if (unit === 'line') return layout.lines.map((l) => l.box)
  if (unit === 'word') return layout.lines.flatMap((l) => l.words.map((w) => w.box))
  return layout.lines.flatMap((l) => l.words.flatMap((w) => w.clusters.map((c) => c.box)))
}

// ---------------------------------------------------------------------------
// The evaluator
// ---------------------------------------------------------------------------

/** Inputs the caller resolves off the clip + playhead + layout. */
export interface EvaluateRevealEffectOptions {
  /** The clip's reveal config (`clip.animation.reveal`); absent / non-effect → identity. */
  reveal?: Record<string, unknown>
  /** The clip's timeline start (`clip.start`), seconds — anchors the reveal window. */
  start: number
  /** Current playhead time, seconds (same reference as `start`). */
  t: number
  /** The clip's laid-out glyph geometry (block / line / word / cluster boxes). */
  layout: GlyphBoxLayout
}

/**
 * PURE reveal-effect evaluator: returns the {@link RevealEffectOutput} for a clip at
 * playhead time `t`. Returns {@link IDENTITY_REVEAL_OUTPUT} when there is no kinetic
 * reveal (absent config, a Doc-03 `mode`-only reveal, or an unknown `effectId`), so
 * the draw path renders exactly as before.
 *
 * TIMING:
 *   - ONE-SHOT (`loop:false`): `progress = ease(easeSpec, clamp01((t - start) / duration))`;
 *     a zero-duration reveal is an instant snap (0 before `start`, 1 after).
 *   - LOOP (`loop:true`): `progress = wrap(((t - start) % period) / period)` with
 *     `period = duration / speed` — a wrapped phase that is SEAMLESS at the wrap
 *     (`phase(start) == phase(start + period)`); no easing is applied to the wrap so
 *     a seamless effect stays seamless.
 */
export function evaluateRevealEffect(opts: EvaluateRevealEffectOptions): RevealEffectOutput {
  const ref = resolveRevealEffect(opts.reveal)
  if (ref === undefined) return IDENTITY_REVEAL_OUTPUT
  const fn = getRevealEffect(ref.effectId)
  if (fn === undefined) return IDENTITY_REVEAL_OUTPUT

  const local = opts.t - opts.start
  let progress: number
  if (ref.loop) {
    const period = ref.durationSec / ref.speed
    if (period > 0) {
      const phase = (local % period) / period
      progress = phase < 0 ? phase + 1 : phase
    } else {
      progress = 0
    }
  } else if (ref.durationSec <= 0) {
    progress = local >= 0 ? 1 : 0
  } else {
    progress = ease(ref.ease, clamp01(local / ref.durationSec))
  }

  return fn({
    progress,
    localSec: local,
    loop: ref.loop,
    direction: ref.direction,
    unit: ref.unit,
    params: ref.params,
    layout: opts.layout,
  })
}

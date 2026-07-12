/**
 * REVEAL-EFFECT CATALOG (P8R.2+ — Doc 15; skill `reveal-effects`).
 *
 * The real kinetic reveal effects (Frame / Swipe / Type / Slide / Glossy /
 * Appear-by / Stomp / Stripe / Curtain), built ON TOP of the P8R.1 engine
 * (`clipRevealEffect.ts`). Each effect is a PURE {@link RevealEffectFn} registered
 * under its `effectId` via {@link registerRevealEffect}; the engine owns all timing
 * (one-shot eased progress / loop wrapped phase) and feeds each effect its
 * `progress`, resolved `direction`/`unit`, open `params` bag, and the laid-out glyph
 * geometry. An effect only describes the SHAPE of the reveal as a function of
 * progress — nothing about time, duration, or the clip.
 *
 * This file grows one effect per prompt (P8R.2 Frame, P8R.3 Swipe, …, P8R.10
 * Curtain); the engine never changes. Effects self-register on import (idempotent),
 * and {@link REVEAL_EFFECT_CATALOG} enumerates them for the P8R.11 panel gallery.
 *
 * DETERMINISM / PARITY: pure, measurer-free, no Date/Math.random — the same phase
 * always yields the same output, in preview AND headless export.
 */
import type { GlyphBox } from '../../routes/editor/preview/textLayout'
import type { Easing } from '../../../shared/captionPreset'
import { clamp01, lerp } from '../../../shared/easing'
import {
  IDENTITY_MASK,
  IDENTITY_UNIT,
  registerRevealEffect,
  revealUnitBoxes,
  type RevealEffectFn,
  type RevealMask,
  type RevealOverlay,
  type RevealUnit
} from './clipRevealEffect'

// ---------------------------------------------------------------------------
// Small pure param readers (the params bag is open `unknown`)
// ---------------------------------------------------------------------------

/** Read a finite number param, or `fallback`. PURE. */
function numParam(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

// ---------------------------------------------------------------------------
// P8R.2 — Frame
// ---------------------------------------------------------------------------

/** Resolved Frame params (the open `reveal.params` bag, defaulted). */
export interface FrameParams {
  /** Border color; absent → the draw path uses the text color. */
  color?: string
  /** Stroke thickness, px. */
  thickness: number
  /** Corner radius, px (0 = square corners). */
  radius: number
  /** Inset/outset padding from the measured text box, px. */
  padding: number
  /** Draw direction around the box: clockwise / counter-clockwise. */
  drawDir: 'cw' | 'ccw'
  /** When true, the text stays HIDDEN until the border finishes drawing. */
  gate: boolean
}

/** Frame defaults — a thin square border, 8px padding, clockwise, no gate. */
export const FRAME_DEFAULTS: Readonly<FrameParams> = Object.freeze({
  thickness: 3,
  radius: 0,
  padding: 8,
  drawDir: 'cw',
  gate: false
})

/**
 * `frame` (P8R.2): an animated rectangular BORDER draws around the measured text
 * box. The border box is the laid-out `block` expanded by `padding` on every side;
 * the overlay's `progress` is the eased draw amount (0 → nothing drawn, 1 → the
 * border is closed). The actual stroke geometry (which fraction of the perimeter is
 * drawn, from which corner, cw/ccw) is rendered by the draw path from the overlay's
 * `progress` + `params` — this stays a pure description so preview and export draw
 * the SAME border.
 *
 * GATE: when `params.gate` is true the text is held HIDDEN (a `wipe` mask at
 * coverage 0) until the border closes (`progress >= 1`), then revealed; otherwise
 * the text is always visible (identity mask) and only the border animates. The
 * border overlay PERSISTS after the draw completes (it is a decoration that animated
 * in), so the effect stays `active`.
 */
const frameEffect: RevealEffectFn = ({ progress, direction, unit, params, layout }) => {
  const padding = numParam(params.padding, FRAME_DEFAULTS.padding)
  const thickness = numParam(params.thickness, FRAME_DEFAULTS.thickness)
  const radius = numParam(params.radius, FRAME_DEFAULTS.radius)
  const drawDir = params.drawDir === 'ccw' ? 'ccw' : 'cw'
  const gate = params.gate === true
  const color = typeof params.color === 'string' ? params.color : undefined

  const block = layout.block
  const frameBox: GlyphBox = {
    x: block.x - padding,
    y: block.y - padding,
    width: block.width + 2 * padding,
    height: block.height + 2 * padding
  }

  // Gating: hide the text until the border finishes drawing, then show it.
  const mask: RevealMask = gate
    ? { kind: 'wipe', coverage: progress >= 1 ? 1 : 0, direction, softness: 0 }
    : { ...IDENTITY_MASK }

  return {
    mask,
    perUnit: [],
    overlays: [
      {
        kind: 'frame',
        box: frameBox,
        progress,
        direction,
        color,
        params: { thickness, radius, padding, drawDir }
      }
    ],
    unit,
    // The border is a persistent decoration once drawn → the reveal stack always runs.
    active: true
  }
}

// ---------------------------------------------------------------------------
// P8R.3 — Swipe
// ---------------------------------------------------------------------------

/** Resolved Swipe params (the open `reveal.params` bag, defaulted). */
export interface SwipeParams {
  /** Bar color; absent → the draw path uses the text color. */
  barColor?: string
  /** Bar width along the sweep axis, px. */
  barWidth: number
  /** Mask edge feather, px (0 = a hard reveal edge). */
  softness: number
}

/** Swipe defaults — a 24px hard-edged bar. */
export const SWIPE_DEFAULTS: Readonly<SwipeParams> = Object.freeze({
  barWidth: 24,
  softness: 0
})

/**
 * `swipe` (P8R.3): a solid color BAR sweeps across the text box along `direction`
 * (l/r/t/b) and the glyphs are revealed in its WAKE via a clip mask. Two outputs
 * compose:
 *   - a `wipe` MASK whose `coverage` is the eased `progress` — the glyphs behind the
 *     bar (already swept) are visible, ahead of it hidden (`softness` feathers the
 *     reveal edge);
 *   - a `bar` OVERLAY positioned at the sweep front: its `progress` rides the same
 *     reveal progress so the draw path can place the leading bar at `coverage` along
 *     the axis (`barWidth`/`barColor` from params).
 *
 * The bar travels with the reveal front, so at `progress 0` nothing is revealed and
 * the bar sits at the start edge; at `progress 1` everything is revealed and the bar
 * has swept off the far edge. Once fully revealed the effect is INACTIVE (the bar is
 * gone and the mask is full) so the draw path can skip the reveal stack.
 */
const swipeEffect: RevealEffectFn = ({ progress, direction, unit, params, layout }) => {
  const barWidth = numParam(params.barWidth, SWIPE_DEFAULTS.barWidth)
  const softness = numParam(params.softness, SWIPE_DEFAULTS.softness)
  const barColor = typeof params.barColor === 'string' ? params.barColor : undefined

  return {
    mask: { kind: 'wipe', coverage: progress, direction, softness },
    perUnit: [],
    overlays: [
      {
        kind: 'bar',
        box: layout.block,
        progress,
        direction,
        color: barColor,
        params: { barWidth }
      }
    ],
    unit,
    // Active while sweeping; once fully revealed the bar is gone + mask is full.
    active: progress < 1
  }
}

// ---------------------------------------------------------------------------
// P8R.4 — Type
// ---------------------------------------------------------------------------

/** Resolved Type params (the open `reveal.params` bag, defaulted). */
export interface TypeParams {
  /** Whether to draw the blinking caret. */
  caret: boolean
  /** Caret color; absent → the draw path uses the text color. */
  caretColor?: string
  /** Caret width, px. */
  caretWidth: number
  /** Blink period, seconds (one on+off cycle); the rate is duration-independent. */
  blinkPeriodSec: number
  /** Emit a key-tick cue per typed cluster (the draw/audio path plays it). */
  tickCue: boolean
}

/** Type defaults — a 2px caret blinking ~once/sec, no key-tick cue. */
export const TYPE_DEFAULTS: Readonly<TypeParams> = Object.freeze({
  caret: true,
  caretWidth: 2,
  blinkPeriodSec: 1.06,
  tickCue: false
})

/**
 * The blink phase ∈ [0,1) for a caret at clip-local time `t` with `periodSec` per
 * on+off cycle. The caret is ON for the first half of each period (`phase < 0.5`).
 * Wrapped to handle negative `t` (before the clip start). PURE.
 */
function blinkPhase(t: number, periodSec: number): number {
  const m = (t % periodSec) / periodSec
  return m < 0 ? m + 1 : m
}

/**
 * `type` (P8R.4): a TYPEWRITER reveal — grapheme clusters appear one-by-one with a
 * blinking caret. Speed follows `duration ÷ glyphCount`: cluster `i` is revealed once
 * `progress ≥ (i+1)/total` (i.e. `revealed = floor(progress · total)`), so typing
 * STARTS at `1/total` and COMPLETES exactly at `progress 1`. Output:
 *   - `perUnit[i]` (unit `char`): opacity/coverage 1 for typed clusters, 0 ahead of
 *     the cursor — the draw path shows only the typed prefix.
 *   - a `caret` OVERLAY at the cursor (the next cluster's left edge, or just past the
 *     last cluster when done). Its `params.on` is the blink state, derived from
 *     `localSec` at a FIXED rate so the caret keeps blinking after typing finishes
 *     (when `progress` has saturated at 1). `tickCue` is passed through for the
 *     audio/draw path to play a key-tick per typed cluster.
 *
 * Per-cluster (indic-text) so a Tamil/Indic conjunct types as ONE unit. The block
 * mask stays identity — the reveal is carried by `perUnit`, not a block clip.
 */
const typeEffect: RevealEffectFn = ({ progress, params, layout, localSec }) => {
  const boxes = revealUnitBoxes(layout, 'char')
  const total = boxes.length
  // Even typewriter: revealed = floor(progress · total) → starts at 1/total, ends at 1.
  const revealed = total === 0 ? 0 : Math.min(total, Math.floor(progress * total + 1e-9))

  const perUnit = boxes.map((_, i) => ({
    ...IDENTITY_UNIT,
    opacity: i < revealed ? 1 : 0,
    coverage: i < revealed ? 1 : 0
  }))

  const showCaret = params.caret !== false // default true
  const overlays: RevealOverlay[] = []
  if (showCaret && total > 0) {
    const caretWidth = numParam(params.caretWidth, TYPE_DEFAULTS.caretWidth)
    const periodSec = Math.max(1e-6, numParam(params.blinkPeriodSec, TYPE_DEFAULTS.blinkPeriodSec))
    const caretColor = typeof params.caretColor === 'string' ? params.caretColor : undefined
    const tickCue = params.tickCue === true
    // Cursor sits at the next cluster to type, or just past the last when done.
    const atEnd = revealed >= total
    const target = atEnd ? boxes[total - 1] : boxes[revealed]
    const caretBox: GlyphBox = {
      x: atEnd ? target.x + target.width : target.x,
      y: target.y,
      width: caretWidth,
      height: target.height
    }
    const phase = blinkPhase(localSec, periodSec)
    overlays.push({
      kind: 'caret',
      box: caretBox,
      progress: phase,
      direction: 'l',
      color: caretColor,
      params: { caretWidth, on: phase < 0.5, blinkPeriodSec: periodSec, tickCue, revealed, total }
    })
  }

  return {
    mask: { ...IDENTITY_MASK },
    perUnit,
    overlays,
    unit: 'char',
    // Active while typing OR while a (blinking) caret is shown.
    active: revealed < total || (showCaret && total > 0)
  }
}

// ---------------------------------------------------------------------------
// P8R.5 — Slide
// ---------------------------------------------------------------------------

/** Resolved Slide params (the open `reveal.params` bag, defaulted). */
export interface SlideParams {
  /** Overshoot fraction: 0 = no overshoot, 0.12 = 12% spring-back. */
  overshoot: number
  /** Stagger fraction: 0 = all units move together, 0.3 = stagger occupies 30% of the timeline. */
  stagger: number
}

/** Slide defaults — slight overshoot, 30% stagger. */
export const SLIDE_DEFAULTS: Readonly<SlideParams> = Object.freeze({
  overshoot: 0.12,
  stagger: 0.3
})

/**
 * `slide` (P8R.5): a MASKED DIRECTIONAL SLIDE — each unit (char/word/line) translates
 * FROM an offset (off-screen in `direction`) INTO its final position while clipped to its
 * own final box so neighbouring text does not bleed through.
 *
 * This is distinct from a plain Slide-In (P8.2/Doc 06) in two ways:
 *   1. Each unit is CLIPPED to its own box (`coverage` on the `RevealUnit`).
 *   2. An optional `overshoot` provides a spring-settle that the simple translate lacks.
 *
 * Per-unit stagger: unit `i` of `total` starts at `rawProgress = i/total * stagger`
 * and finishes at `rawProgress = unitStart + (1 - stagger)`. Local progress:
 *   `up = clamp01((rawProgress - unitStart) / unitDuration)`.
 * The overshoot ramp: at `up < 0.7` the unit undershoots toward the final position;
 * at `up ∈ [0.7, 0.85)` it overshoots by `overshoot`; at `up ∈ [0.85, 1]` it
 * settles smoothly to 0. The block mask is IDENTITY — reveal is per-unit coverage.
 */
const slideEffect: RevealEffectFn = ({ progress, direction, unit, params, layout }) => {
  const overshoot = clamp01(numParam(params.overshoot, SLIDE_DEFAULTS.overshoot))
  const stagger = clamp01(numParam(params.stagger, SLIDE_DEFAULTS.stagger))
  const boxes = revealUnitBoxes(layout, unit)
  const total = boxes.length

  if (total === 0) {
    return { mask: { ...IDENTITY_MASK }, perUnit: [], overlays: [], unit, active: progress < 1 }
  }

  const unitDuration = 1 - stagger

  /** Spring-like translate factor: 0 at start, overshoots, then settles to 0. */
  function springFactor(up: number): number {
    if (up <= 0) return 1
    if (up >= 1) return 0
    if (up < 0.7) {
      // Ease in from 1 → (overshoot) during 0..0.7
      const t = up / 0.7
      return lerp(1, -overshoot, t * t * (3 - 2 * t))
    }
    if (up < 0.85) {
      // Overshoot: -overshoot → 0 during 0.7..0.85
      const t = (up - 0.7) / 0.15
      return lerp(-overshoot, 0, t * t * (3 - 2 * t))
    }
    // Settle: 0 → 0 (already settled, just guarantee)
    return 0
  }

  const perUnit: RevealUnit[] = boxes.map((box, i) => {
    const unitStart = total > 1 ? (i / (total - 1)) * stagger : 0
    const up = clamp01(unitDuration > 0 ? (progress - unitStart) / unitDuration : progress >= unitStart ? 1 : 0)
    const factor = springFactor(up)

    // Translate offset: starts at one full box dimension in `direction`.
    let tx = 0
    let ty = 0
    if (direction === 'l') tx = -box.width * factor
    else if (direction === 'r') tx = box.width * factor
    else if (direction === 't') ty = -box.height * factor
    else /* 'b' or 'center' */ ty = box.height * factor

    // coverage: 0 until the unit starts moving; 1 once it has settled.
    const coverage = up > 0 ? 1 : 0

    return { ...IDENTITY_UNIT, tx, ty, coverage }
  })

  return {
    mask: { ...IDENTITY_MASK },
    perUnit,
    overlays: [],
    unit,
    active: progress < 1
  }
}

// ---------------------------------------------------------------------------
// P8R.6 — Glossy
// ---------------------------------------------------------------------------

/** Resolved Glossy params (the open `reveal.params` bag, defaulted). */
export interface GlossyParams {
  /** Diagonal sweep angle, degrees. */
  angle: number
  /** Band width, px. */
  bandWidth: number
  /** Peak opacity of the sheen, 0–1. */
  intensity: number
  /** Sheen color; absent → text color. */
  color?: string
}

/** Glossy defaults — 45° diagonal, 40px band, 0.8 intensity. */
export const GLOSSY_DEFAULTS: Readonly<GlossyParams> = Object.freeze({
  angle: 45,
  bandWidth: 40,
  intensity: 0.8
})

/**
 * `glossy` (P8R.6): a specular SHEEN BAND sweeps diagonally across the filled glyphs.
 * Supports one-shot (progress 0→1) and looping (loop mode, progress is a wrapped
 * phase 0→1). The band position at progress `p`:
 *   `bandCenter = p * (diagonal + bandWidth) - bandWidth / 2`
 * along the block diagonal determined by `angle`. This is emitted as a single `'sheen'`
 * overlay; the draw path renders it as an angle-clipped highlight strip over the glyphs.
 * The base glyphs stay fully visible (identity mask); the sheen adds a highlight on top.
 * Active permanently in loop mode; in one-shot mode active while p < 1 + bandWidth/diagonal.
 */
const glossyEffect: RevealEffectFn = ({ progress, direction, unit, params, layout, loop }) => {
  const angle = numParam(params.angle, GLOSSY_DEFAULTS.angle)
  const bandWidth = numParam(params.bandWidth, GLOSSY_DEFAULTS.bandWidth)
  const intensity = clamp01(numParam(params.intensity, GLOSSY_DEFAULTS.intensity))
  const color = typeof params.color === 'string' ? params.color : undefined

  const block = layout.block
  // Diagonal length across the block (the band sweeps this distance).
  const diagonal = Math.sqrt(block.width * block.width + block.height * block.height)
  // Band center position along the sweep axis at this progress.
  const bandCenter = progress * (diagonal + bandWidth) - bandWidth / 2

  const overlay: RevealOverlay = {
    kind: 'sheen',
    box: block,
    progress,
    direction,
    color,
    params: { angle, bandWidth, intensity, bandCenter, diagonal }
  }

  return {
    mask: { ...IDENTITY_MASK },
    perUnit: [],
    overlays: [overlay],
    unit,
    active: loop || progress < 1
  }
}

// ---------------------------------------------------------------------------
// P8R.7 — Appear By
// ---------------------------------------------------------------------------

/** Resolved AppearBy params (the open `reveal.params` bag, defaulted). */
export interface AppearByParams {
  /** Stagger fraction: fraction of the total duration used for spreading starts across units. */
  stagger: number
  /** Starting scale for each unit (0.8 = units scale up from 80%). */
  scaleFrom: number
}

/** AppearBy defaults — 40% stagger, scale from 0.8. */
export const APPEAR_BY_DEFAULTS: Readonly<AppearByParams> = Object.freeze({
  stagger: 0.4,
  scaleFrom: 0.8
})

/**
 * `appearBy` (P8R.7): a STAGGERED FADE+SCALE reveal by Character/Word/Line. Each unit
 * fades in from `opacity=0,scale=scaleFrom` to `opacity=1,scale=1.0` with its own
 * local progress offset by its stagger position.
 *
 * Per-unit stagger: unit `i` of `total` starts at rawProgress `= i/(total-1) * stagger`
 * (or 0 for a single unit) and its individual duration is `1 - stagger`.
 * Local progress: `up = clamp01((rawProgress - unitStart) / unitDuration)`.
 * Output: `perUnit[i]` with `opacity = up`, `scale = lerp(scaleFrom, 1, up)`.
 * The block mask stays IDENTITY — reveal is entirely per-unit.
 */
const appearByEffect: RevealEffectFn = ({ progress, unit, params, layout }) => {
  const stagger = clamp01(numParam(params.stagger, APPEAR_BY_DEFAULTS.stagger))
  const scaleFrom = clamp01(numParam(params.scaleFrom, APPEAR_BY_DEFAULTS.scaleFrom))
  const boxes = revealUnitBoxes(layout, unit)
  const total = boxes.length

  if (total === 0) {
    return { mask: { ...IDENTITY_MASK }, perUnit: [], overlays: [], unit, active: progress < 1 }
  }

  const unitDuration = 1 - stagger

  const perUnit: RevealUnit[] = boxes.map((_, i) => {
    const unitStart = total > 1 ? (i / (total - 1)) * stagger : 0
    const up = clamp01(unitDuration > 0 ? (progress - unitStart) / unitDuration : progress >= unitStart ? 1 : 0)
    return {
      ...IDENTITY_UNIT,
      opacity: up,
      scale: lerp(scaleFrom, 1, up)
    }
  })

  return {
    mask: { ...IDENTITY_MASK },
    perUnit,
    overlays: [],
    unit,
    active: progress < 1
  }
}

// ---------------------------------------------------------------------------
// P8R.8 — Stomp
// ---------------------------------------------------------------------------

/** Resolved Stomp params (the open `reveal.params` bag, defaulted). */
export interface StompParams {
  /** Starting scale — units begin at this scale and slam down to 1.0. */
  scaleFrom: number
  /** Overshoot fraction (spring below 1.0 before settling). */
  overshoot: number
  /** Whether the start is blurry (passed in params for the draw path). */
  blurIn: boolean
  /** Stagger fraction between words. */
  stagger: number
}

/** Stomp defaults — 2.5× scale, 15% overshoot, blur, 20% stagger. */
export const STOMP_DEFAULTS: Readonly<StompParams> = Object.freeze({
  scaleFrom: 2.5,
  overshoot: 0.15,
  blurIn: true,
  stagger: 0.2
})

/**
 * `stomp` (P8R.8): IMPACT ENTRANCE — units slam from large scale (`scaleFrom`) down
 * to 1.0 with squash and overshoot. Usually used per-word and can be beat-synced.
 *
 * Scale ramp (three segments, per-unit local progress `up`):
 *   - [0, 0.6]: scale from `scaleFrom` → `1 + overshoot`  (slam in)
 *   - [0.6, 0.8]: scale from `1 + overshoot` → `1 - overshoot*0.3`  (squash)
 *   - [0.8, 1.0]: scale from `1 - overshoot*0.3` → 1.0  (settle)
 * Opacity fades in during [0, 0.4] of unit progress.
 * `blurIn` is passed through to the draw path (it applies a canvas blur at scale peak).
 */
const stompEffect: RevealEffectFn = ({ progress, unit, params, layout }) => {
  const scaleFrom = Math.max(1, numParam(params.scaleFrom, STOMP_DEFAULTS.scaleFrom))
  const overshoot = clamp01(numParam(params.overshoot, STOMP_DEFAULTS.overshoot))
  const blurIn = params.blurIn !== false // default true
  const stagger = clamp01(numParam(params.stagger, STOMP_DEFAULTS.stagger))
  const boxes = revealUnitBoxes(layout, unit)
  const total = boxes.length

  if (total === 0) {
    return { mask: { ...IDENTITY_MASK }, perUnit: [], overlays: [], unit, active: progress < 1 }
  }

  const unitDuration = 1 - stagger

  function stompScale(up: number): number {
    if (up <= 0) return scaleFrom
    if (up >= 1) return 1
    if (up < 0.6) {
      const t = up / 0.6
      return lerp(scaleFrom, 1 + overshoot, t * t * (3 - 2 * t))
    }
    if (up < 0.8) {
      const t = (up - 0.6) / 0.2
      return lerp(1 + overshoot, 1 - overshoot * 0.3, t * t * (3 - 2 * t))
    }
    const t = (up - 0.8) / 0.2
    return lerp(1 - overshoot * 0.3, 1, t * t * (3 - 2 * t))
  }

  const perUnit: RevealUnit[] = boxes.map((_, i) => {
    const unitStart = total > 1 ? (i / (total - 1)) * stagger : 0
    const up = clamp01(unitDuration > 0 ? (progress - unitStart) / unitDuration : progress >= unitStart ? 1 : 0)
    const scale = stompScale(up)
    const opacity = clamp01(up / 0.4)
    return {
      ...IDENTITY_UNIT,
      scale,
      opacity,
      // Pass blurIn and scalePeak through coverage field carrier — the draw path
      // reads the overlay params; we emit a single overlay for the draw path to use.
    }
  })

  // Emit one overlay carrying blurIn + scalePeak for the draw path.
  const overlay: RevealOverlay = {
    kind: 'bar', // re-use 'bar' kind — draw path checks params.blurIn to distinguish
    box: layout.block,
    progress,
    direction: 'b',
    params: { blurIn, scalePeak: scaleFrom, overshoot }
  }

  return {
    mask: { ...IDENTITY_MASK },
    perUnit,
    overlays: [overlay],
    unit,
    active: progress < 1
  }
}

// ---------------------------------------------------------------------------
// P8R.9 — Stripe
// ---------------------------------------------------------------------------

/** Resolved Stripe params (the open `reveal.params` bag, defaulted). */
export interface StripeParams {
  /** Number of stripe bars. */
  stripeCount: number
  /** Stripe angle, degrees. */
  angle: number
  /** Gap as a fraction of bar period (0 = no gap, 0.3 = 30% gap between bars). */
  gap: number
  /** Stripe color; absent → text color. */
  color?: string
}

/** Stripe defaults — 3 bars, 45° angle, 30% gap. */
export const STRIPE_DEFAULTS: Readonly<StripeParams> = Object.freeze({
  stripeCount: 3,
  angle: 45,
  gap: 0.3
})

/**
 * `stripe` (P8R.9): parallel DIAGONAL STRIPE BARS wipe across the text box in
 * `direction` to reveal the text sequentially. Each bar sweeps across; in its wake
 * the text is revealed via a block `wipe` mask whose coverage tracks the furthest
 * bar's lead edge.
 *
 * At progress `p`, bar `k` (0..stripeCount-1) has swept `p * (1 + 1/stripeCount)`
 * of the block along `direction`, staggered by `k/stripeCount`. The combined mask
 * coverage is the minimum of the lead edge of bar 0 → reveals more as bars sweep.
 * Each bar is emitted as a `'stripe'` overlay with its current center position.
 */
const stripeEffect: RevealEffectFn = ({ progress, direction, unit, params, layout }) => {
  const stripeCount = Math.max(1, Math.round(numParam(params.stripeCount, STRIPE_DEFAULTS.stripeCount)))
  const angle = numParam(params.angle, STRIPE_DEFAULTS.angle)
  const gap = clamp01(numParam(params.gap, STRIPE_DEFAULTS.gap))
  const color = typeof params.color === 'string' ? params.color : undefined

  const block = layout.block

  // The total sweep range is (1 + 1/stripeCount) so that the last bar clears the block.
  const sweepRange = 1 + 1 / stripeCount

  // Build one overlay per bar, staggered.
  const overlays: RevealOverlay[] = []
  for (let k = 0; k < stripeCount; k++) {
    // Bar k's sweep start fraction (bar starts entering at progress = k/stripeCount / sweepRange)
    const barSweep = clamp01(progress * sweepRange - k / stripeCount)
    overlays.push({
      kind: 'stripe',
      box: block,
      progress: barSweep,
      direction,
      color,
      params: { angle, gap, barIndex: k, stripeCount }
    })
  }

  // Block wipe coverage: the leading edge of bar 0 (first bar) drives the reveal.
  const coverage = clamp01(progress * sweepRange)

  return {
    mask: { kind: 'wipe', coverage, direction, softness: 0 },
    perUnit: [],
    overlays,
    unit,
    active: progress < 1
  }
}

// ---------------------------------------------------------------------------
// P8R.10 — Curtain
// ---------------------------------------------------------------------------

/** Resolved Curtain params (the open `reveal.params` bag, defaulted). */
export interface CurtainParams {
  /** Edge feather, px (0 = hard edge). */
  softness: number
  /** Curtain panel color; absent → text color. */
  color?: string
}

/** Curtain defaults — 8px softness, no color (uses text color). */
export const CURTAIN_DEFAULTS: Readonly<CurtainParams> = Object.freeze({
  softness: 8
})

/**
 * `curtain` (P8R.10): a CURTAIN-OPEN MASK reveal. The behavior depends on `direction`:
 *   - `'center'`: split — both halves slide outward from the center. Uses `kind:'split'`.
 *   - `'t'`: single curtain slides UP (wipe upward).
 *   - `'b'`: single curtain slides DOWN (wipe downward).
 *   - `'l'`: single curtain slides LEFT.
 *   - `'r'`: single curtain slides RIGHT.
 *
 * `color` panels (optional): emit `'panel'` overlays representing the sliding curtain
 * panels so the draw path can paint the colored curtain surface as it opens.
 */
const curtainEffect: RevealEffectFn = ({ progress, direction, unit, params, layout }) => {
  const softness = Math.max(0, numParam(params.softness, CURTAIN_DEFAULTS.softness))
  const color = typeof params.color === 'string' ? params.color : undefined

  const block = layout.block

  const mask: RevealMask = direction === 'center'
    ? { kind: 'split', coverage: progress, direction: 'center', softness }
    : { kind: 'wipe', coverage: progress, direction, softness }

  // Emit panel overlays — the colored curtain sheets.
  const overlays: RevealOverlay[] = []
  if (direction === 'center') {
    // Two panels: left slides left, right slides right.
    overlays.push({
      kind: 'panel',
      box: { x: block.x, y: block.y, width: block.width / 2, height: block.height },
      progress,
      direction: 'l',
      color,
      params: { softness, half: 'left' }
    })
    overlays.push({
      kind: 'panel',
      box: { x: block.x + block.width / 2, y: block.y, width: block.width / 2, height: block.height },
      progress,
      direction: 'r',
      color,
      params: { softness, half: 'right' }
    })
  } else {
    overlays.push({
      kind: 'panel',
      box: block,
      progress,
      direction,
      color,
      params: { softness }
    })
  }

  return {
    mask,
    perUnit: [],
    overlays,
    unit,
    active: progress < 1
  }
}

// ---------------------------------------------------------------------------
// Catalog + registration
// ---------------------------------------------------------------------------

/** A catalog entry for the P8R.11 panel gallery: stable id, human label, default ease. */
export interface RevealEffectEntry {
  /** Stable effect id (registered + persisted to `clip.animation.reveal.effectId`). */
  id: string
  /** Human-readable gallery label. */
  label: string
  /** The easing the panel should default the reveal ramp to for this effect. */
  defaultEasing: Easing
  /** Whether this effect is a continuous loop by default (Glossy). */
  loop: boolean
  /** The pure effect function (also registered in the global registry). */
  fn: RevealEffectFn
}

/**
 * The reveal-effect catalog. Order is the gallery order. Each `fn` is registered
 * under its `id` (below) so {@link import('./clipRevealEffect').getRevealEffect}(id)
 * resolves it, and the panel enumerates this list for its thumbnails. Grows one
 * entry per P8R.2–P8R.10 prompt.
 */
export const REVEAL_EFFECT_CATALOG: readonly RevealEffectEntry[] = [
  { id: 'frame', label: 'Frame', defaultEasing: 'easeInOut', loop: false, fn: frameEffect },
  { id: 'swipe', label: 'Swipe', defaultEasing: 'easeInOut', loop: false, fn: swipeEffect },
  { id: 'type', label: 'Type', defaultEasing: 'linear', loop: false, fn: typeEffect },
  { id: 'slide', label: 'Slide', defaultEasing: 'easeOut', loop: false, fn: slideEffect },
  { id: 'glossy', label: 'Glossy', defaultEasing: 'linear', loop: true, fn: glossyEffect },
  { id: 'appearBy', label: 'Appear By', defaultEasing: 'easeOut', loop: false, fn: appearByEffect },
  { id: 'stomp', label: 'Stomp', defaultEasing: 'easeInOut', loop: false, fn: stompEffect },
  { id: 'stripe', label: 'Stripe', defaultEasing: 'easeInOut', loop: false, fn: stripeEffect },
  { id: 'curtain', label: 'Curtain', defaultEasing: 'easeInOut', loop: false, fn: curtainEffect }
]

/** Register the full reveal-effect catalog into the shared engine registry. Idempotent. */
export function registerRevealEffects(): void {
  for (const entry of REVEAL_EFFECT_CATALOG) {
    registerRevealEffect(entry.id, entry.fn)
  }
}

// Register on import so any consumer that imports this module (or its side-effect)
// gets the effects wired without an explicit call. Re-registering overwrites by id.
registerRevealEffects()

export {
  frameEffect,
  swipeEffect,
  typeEffect,
  slideEffect,
  glossyEffect,
  appearByEffect,
  stompEffect,
  stripeEffect,
  curtainEffect
}

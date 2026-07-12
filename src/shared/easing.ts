/**
 * Shared EASING + interpolation library (P8.1 — Doc 06 text animation; skill
 * `keyframe-engine`).
 *
 * The SINGLE source of truth for every easing curve in the app: caption reveal
 * (P5.5 `captionReveal`), active-word highlight (P5.6 `captionHighlight`), the
 * in/out/loop animation evaluator (P8.1+ `clipAnimation`), and the keyframe-motion
 * sampler (P11). Before this module each consumer carried its own `applyEasing`
 * switch; they now all delegate here so a curve cannot drift between features and
 * the eases are unit-tested once.
 *
 * keyframe-engine CONTRACT (SKILL.md "Easing"):
 *   > Named eases (linear, easeIn/Out/InOut, cubic-bezier(p1,p2,p3,p4), spring).
 *   > Provide a registry `ease(name, p) -> p'`.
 * {@link ease} is that registry. Every named curve is PURE + deterministic (no
 * time-of-day state — SKILL.md "Determinism"): same input `p` → same `p'`, so the
 * whole animation stack is reproducible and testable.
 *
 * CURVE CONTRACT (what tests assert):
 *   - All curves are defined on `p ∈ [0,1]` (input is clamped first).
 *   - The "ramp" curves (linear / easeIn* / easeOut* / easeInOut* / ease /
 *     cubicBezier(default) / spring(default)) satisfy `f(0)=0` and `f(1)=1`.
 *   - `linear` is the identity; `easeIn*` start slow, `easeOut*` end slow,
 *     `easeInOut*` are symmetric. These are MONOTONIC non-decreasing.
 *   - `bounce` and `elastic` are SETTLING curves: `f(0)=0`, `f(1)=1`, but they
 *     OVERSHOOT/oscillate in between (NOT monotonic) — used for entrance/exit
 *     "pop"/"scream" presets where the value springs past its target and settles.
 *
 * HEADLESS-SAFE + PURE: no DOM / canvas / electron / node / Date. The renderer, a
 * vitest engine, and the export path import this identically.
 */

/** Clamp a number into `[0,1]`. */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** Linear interpolate from `a` to `b` by `p` (NOT clamped — caller clamps `p`). */
export function lerp(a: number, b: number, p: number): number {
  return a + (b - a) * p
}

// ---------------------------------------------------------------------------
// Named easing curves (each: [0,1] → settled value; ramps hit 0→0, 1→1)
// ---------------------------------------------------------------------------

/** Identity ramp. */
export function linear(p: number): number {
  return p
}

/** Quadratic ease-in (slow start). */
export function easeInQuad(p: number): number {
  return p * p
}
/** Quadratic ease-out (slow end). */
export function easeOutQuad(p: number): number {
  return 1 - (1 - p) * (1 - p)
}
/** Quadratic ease-in-out (symmetric). */
export function easeInOutQuad(p: number): number {
  return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
}

/** Cubic ease-in. */
export function easeInCubic(p: number): number {
  return p * p * p
}
/** Cubic ease-out. */
export function easeOutCubic(p: number): number {
  return 1 - Math.pow(1 - p, 3)
}
/** Cubic ease-in-out. */
export function easeInOutCubic(p: number): number {
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
}

/**
 * Smoothstep — the symmetric S-curve `3p² − 2p³`. `f(0)=0`, `f(0.5)=0.5`,
 * `f(1)=1`, zero slope at both ends. The generic `ease`/`spring` ramp used where a
 * gentle non-overshooting acceleration+deceleration is wanted.
 */
export function smoothstep(p: number): number {
  return p * p * (3 - 2 * p)
}

// ---------------------------------------------------------------------------
// Cubic-bezier (CSS-style timing function) — keyframe-engine `cubic-bezier(...)`
// ---------------------------------------------------------------------------

/**
 * Evaluate a CSS-style cubic-bezier timing function with control points
 * `(x1,y1)` and `(x2,y2)` (the endpoints are fixed at `(0,0)` and `(1,1)`), at
 * input `p` (the x/time axis). Returns the y/value. PURE.
 *
 * The bezier is parametric in `u ∈ [0,1]`; we solve `bezierX(u) = p` for `u`
 * (Newton-Raphson with a bisection fallback) then evaluate `bezierY(u)`. With the
 * fixed endpoints `f(0)=0` and `f(1)=1` always hold. Standard named curves:
 *   - `ease`        → (0.25, 0.1, 0.25, 1)
 *   - `easeIn`      → (0.42, 0, 1, 1)
 *   - `easeOut`     → (0, 0, 0.58, 1)
 *   - `easeInOut`   → (0.42, 0, 0.58, 1)
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, p: number): number {
  if (p <= 0) return 0
  if (p >= 1) return 1

  // Bernstein-form coefficients for a cubic bezier with P0=0, P3=1.
  const ax = 3 * x1 - 3 * x2 + 1
  const bx = 3 * x2 - 6 * x1
  const cx = 3 * x1
  const ay = 3 * y1 - 3 * y2 + 1
  const by = 3 * y2 - 6 * y1
  const cy = 3 * y1

  const sampleX = (u: number): number => ((ax * u + bx) * u + cx) * u
  const sampleY = (u: number): number => ((ay * u + by) * u + cy) * u
  const sampleDX = (u: number): number => (3 * ax * u + 2 * bx) * u + cx

  // Solve sampleX(u) = p for u, starting from u = p (a good guess for monotone X).
  let u = p
  for (let i = 0; i < 8; i++) {
    const x = sampleX(u) - p
    if (Math.abs(x) < 1e-7) return sampleY(u)
    const dx = sampleDX(u)
    if (Math.abs(dx) < 1e-7) break
    u -= x / dx
  }
  // Bisection fallback if Newton stalled.
  let lo = 0
  let hi = 1
  u = p
  for (let i = 0; i < 32; i++) {
    const x = sampleX(u)
    if (Math.abs(x - p) < 1e-7) break
    if (x < p) lo = u
    else hi = u
    u = (lo + hi) / 2
  }
  return sampleY(u)
}

// ---------------------------------------------------------------------------
// Settling curves (overshoot / oscillate then settle to 1) — bounce, elastic
// ---------------------------------------------------------------------------

/**
 * Bounce ease-out: the value approaches 1 by bouncing (decaying parabolic
 * rebounds), like a ball dropping. `f(0)=0`, `f(1)=1`. NOT monotonic — it touches
 * its peaks below 1 and settles at 1. The canonical Robert Penner bounce. Used for
 * `Bounce` in/out presets.
 */
export function bounceOut(p: number): number {
  const n1 = 7.5625
  const d1 = 2.75
  if (p < 1 / d1) return n1 * p * p
  if (p < 2 / d1) {
    p -= 1.5 / d1
    return n1 * p * p + 0.75
  }
  if (p < 2.5 / d1) {
    p -= 2.25 / d1
    return n1 * p * p + 0.9375
  }
  p -= 2.625 / d1
  return n1 * p * p + 0.984375
}

/** Bounce ease-in (mirror of {@link bounceOut}). */
export function bounceIn(p: number): number {
  return 1 - bounceOut(1 - p)
}

/**
 * Elastic ease-out: an exponentially-decaying sine that OVERSHOOTS 1 and rings
 * down, like a plucked spring/elastic band. `f(0)=0`, `f(1)=1`. NOT monotonic —
 * exceeds 1 mid-curve. Backs the `spring` (when overshoot wanted) / `Scream`
 * elastic preset. `period` controls the oscillation rate.
 */
export function elasticOut(p: number, period = 0.3): number {
  if (p <= 0) return 0
  if (p >= 1) return 1
  const c = (2 * Math.PI) / period
  return Math.pow(2, -10 * p) * Math.sin((p - period / 4) * c) + 1
}

// ---------------------------------------------------------------------------
// The named-easing registry — keyframe-engine `ease(name, p) -> p'`
// ---------------------------------------------------------------------------

/**
 * Built-in named easing curves. The string union spans the {@link captionPreset}
 * `Easing` enum (`linear`/`ease`/`easeIn`/`easeOut`/`easeInOut`/`spring`) PLUS the
 * richer curves the animation/keyframe layers need (`bounce`, `elastic`, cubic
 * variants). Every name resolves through {@link ease}. The preset-facing `Easing`
 * type is a SUBSET, so a preset easing is always a valid `EasingName`.
 */
export type EasingName =
  | 'linear'
  | 'ease'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'easeInQuad'
  | 'easeOutQuad'
  | 'easeInOutQuad'
  | 'easeInCubic'
  | 'easeOutCubic'
  | 'easeInOutCubic'
  | 'spring'
  | 'bounce'
  | 'bounceIn'
  | 'elastic'

/**
 * The built-in named easing curves as a runtime array (the value mirror of the
 * {@link EasingName} union), in a stable order for UI dropdowns (P8.5 Animation
 * panel easing select). The list IS the keys of {@link RAMP_FNS}; a test pins the
 * two in sync so a new curve cannot be added to one without the other. PURE data.
 */
export const EASING_NAMES: readonly EasingName[] = [
  'linear',
  'ease',
  'easeIn',
  'easeOut',
  'easeInOut',
  'easeInQuad',
  'easeOutQuad',
  'easeInOutQuad',
  'easeInCubic',
  'easeOutCubic',
  'easeInOutCubic',
  'spring',
  'bounce',
  'bounceIn',
  'elastic'
] as const

/** A cubic-bezier easing spec `[x1,y1,x2,y2]` (keyframe-engine `cubic-bezier`). */
export type CubicBezierSpec = readonly [number, number, number, number]

/** Anything {@link ease} accepts: a named curve, a cubic-bezier tuple, or a fn. */
export type EasingSpec = EasingName | CubicBezierSpec | ((p: number) => number)

const RAMP_FNS: Record<EasingName, (p: number) => number> = {
  linear,
  // `ease` = CSS default cubic-bezier(0.25,0.1,0.25,1).
  ease: (p) => cubicBezier(0.25, 0.1, 0.25, 1, p),
  // The bare `easeIn`/`easeOut`/`easeInOut` are QUADRATIC — the gentle curves the
  // reveal (P5.5) + highlight (P5.6) shipped with (p², 1-(1-p)²). The CUBIC and
  // higher variants are available under their explicit names below.
  easeIn: easeInQuad,
  easeOut: easeOutQuad,
  easeInOut: easeInOutQuad,
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
  // `spring` here is the non-overshoot smoothstep so existing reveal/highlight
  // callers (which clamp opacity to [0,1]) keep monotonic 0→1 behavior. The
  // OVERSHOOTING spring is `elastic` (an explicit choice for in/out presets).
  spring: smoothstep,
  bounce: bounceOut,
  bounceIn,
  elastic: (p) => elasticOut(p)
}

/**
 * Apply a named curve / cubic-bezier / custom function to a normalized progress
 * `p`. The keyframe-engine `ease(name, p) -> p'` registry. Input is clamped to
 * `[0,1]` (so callers may pass raw `(t-start)/dur`). PURE + deterministic.
 *
 *   - string  → looked up in the built-in table (unknown → `linear`).
 *   - `[x1,y1,x2,y2]` → {@link cubicBezier}.
 *   - function → invoked directly (escape hatch for a bespoke curve).
 */
export function ease(spec: EasingSpec, p: number): number {
  const x = clamp01(p)
  if (typeof spec === 'function') return spec(x)
  if (Array.isArray(spec)) return cubicBezier(spec[0], spec[1], spec[2], spec[3], x)
  const fn = RAMP_FNS[spec as EasingName]
  return fn ? fn(x) : x
}

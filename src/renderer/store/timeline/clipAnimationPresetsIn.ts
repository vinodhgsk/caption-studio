/**
 * IN-preset CATALOG (P8.2 — Doc 06 §"In presets"; skills `keyframe-engine`
 * + `indic-text`).
 *
 * The full ENTRANCE animation library, built ON TOP of the P8.1 evaluator
 * (`clipAnimation.ts`). Each preset is a PURE function `(AnimPhase) → AnimSample`
 * registered under kind `'in'` via {@link registerAnimPreset}; the evaluator owns
 * all timing/easing/stagger and feeds each preset its eased `progress` (0→1),
 * already SHIFTED for the unit's stagger index. A preset only describes the SHAPE
 * of the motion as a function of progress — nothing about time, duration, or which
 * glyph it is (beyond the `index`/`count` it may read for a deterministic seed).
 *
 * ENTRANCE CONTRACT (req. 1 + 4): each preset animates FROM an offset/transformed
 * state (at `progress === 0`) INTO the resting state (at `progress === 1`). At
 * `progress === 1` EVERY preset returns {@link IDENTITY_SAMPLE} EXACTLY — no
 * residual translate/scale/rotation/opacity — so once the in-duration elapses the
 * clip sits at rest and composes cleanly with out/loop/effects (no drift). This is
 * achieved by interpolating every channel toward its identity value with `progress`
 * (or a `1 - progress` factor on the offset), so the offset term vanishes at 1.
 *
 * STAGGER (req. 2): the evaluator delays each unit's time by `index * delaySec`
 * BEFORE computing `progress`, so a staggered glyph/word simply sees a smaller
 * `progress` than its earlier siblings — the SAME preset function produces the
 * cascade with no per-preset stagger code. `index`/`count` are still passed so a
 * preset that wants index-dependent VARIATION (Glitch's seeded jitter) can read
 * them; the motion shape is otherwise identical per unit.
 *
 * DETERMINISM (req. 3): pure, measurer-free, no Date/Math.random — Glitch derives
 * its jitter from a deterministic hash of `(index, progress)` so the same phase
 * always yields the same sample. Same inputs → same output, in preview + export.
 *
 * GALLERY (req. 3): {@link IN_PRESET_CATALOG} enumerates every preset (id + label +
 * the easing the panel should default to) for the P8.5 panel gallery.
 */
import { bounceOut, elasticOut } from '../../../shared/easing'
import {
  IDENTITY_SAMPLE,
  registerAnimPreset,
  type AnimPreset
} from './clipAnimation'

// ---------------------------------------------------------------------------
// Small pure helpers (interpolation toward the resting/identity value)
// ---------------------------------------------------------------------------

/** Linear blend a→b by p (p already clamped/eased by the evaluator). */
function mix(a: number, b: number, p: number): number {
  return a + (b - a) * p
}

/**
 * The "remaining offset" factor: `1 - progress`, clamped to `[0,1]`. An entrance
 * channel that starts displaced by `D` writes `D * remain(progress)` so the offset
 * is full at progress 0 and EXACTLY 0 at progress 1 (settles to identity).
 */
function remain(progress: number): number {
  const r = 1 - progress
  return r < 0 ? 0 : r > 1 ? 1 : r
}

/**
 * Deterministic hash → a value in [-1, 1]. Pure (no Math.random): mixes the two
 * inputs with integer hashing so Glitch produces reproducible per-unit jitter that
 * differs across glyphs and across the entrance but is identical for identical
 * inputs (req. 3 determinism + req. 5 "glitch deterministic").
 */
function signedHash(a: number, b: number): number {
  // Quantize the continuous inputs so the hash is stable per sampled phase.
  let h = (Math.floor(a * 1000) | 0) ^ ((Math.floor(b * 9973) | 0) * 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  // Map the unsigned 32-bit hash into [-1, 1].
  return ((h >>> 0) / 0xffffffff) * 2 - 1
}

// ---------------------------------------------------------------------------
// The In-preset functions (each: phase → sample; identity at progress 1)
// ---------------------------------------------------------------------------

/** A baseline displacement scale (px) for the translate-style presets. */
const SLIDE_PX = 120

/** Fade — opacity ramps 0→1; no transform. The minimal entrance. */
const fadeIn: AnimPreset = ({ progress }) => ({
  ...IDENTITY_SAMPLE,
  opacity: progress
})

/** Zoom — scale grows from a small fraction up to 1; fades in alongside. */
const zoomIn: AnimPreset = ({ progress }) => ({
  ...IDENTITY_SAMPLE,
  opacity: progress,
  scale: mix(0.2, 1, progress)
})

/**
 * Typewriter — a HARD per-glyph reveal. Because the evaluator staggers each unit's
 * `progress`, a glyph is either still pending (`progress <= 0` → invisible) or has
 * begun (`progress > 0` → fully visible): the glyph "types on" the instant its
 * staggered time arrives, with NO partial fade, giving the characteristic typed
 * cadence. At progress 1 it is the identity (visible). Clip-level (index 0, no
 * stagger) it just snaps visible like the rest.
 */
const typewriterIn: AnimPreset = ({ progress }) => ({
  ...IDENTITY_SAMPLE,
  opacity: progress > 0 ? 1 : 0
})

/** Build a directional Slide preset that translates in from (dx,dy)*SLIDE_PX. */
function slideFrom(dx: number, dy: number): AnimPreset {
  return ({ progress }) => {
    const r = remain(progress)
    return {
      ...IDENTITY_SAMPLE,
      opacity: progress,
      tx: dx * SLIDE_PX * r,
      ty: dy * SLIDE_PX * r
    }
  }
}

/** Slide from the LEFT (enters moving right): starts at -x, settles at 0. */
const slideLeftIn = slideFrom(-1, 0)
/** Slide from the RIGHT (enters moving left): starts at +x, settles at 0. */
const slideRightIn = slideFrom(1, 0)
/** Slide from the TOP (enters moving down): starts at -y, settles at 0. */
const slideTopIn = slideFrom(0, -1)
/** Slide from the BOTTOM (enters moving up): starts at +y, settles at 0. */
const slideBottomIn = slideFrom(0, 1)

/**
 * Bounce — drops in from above and settles with a decaying bounce. The evaluator's
 * eased progress drives the SHAPE here directly: we run the raw progress through
 * {@link bounceOut} so the vertical offset rebounds. `bounceOut(1) === 1` so at
 * progress 1 the offset term is `(1 - 1) === 0` → identity.
 */
const bounceIn: AnimPreset = ({ progress }) => {
  const settled = bounceOut(progress) // 0→1, with parabolic rebounds
  return {
    ...IDENTITY_SAMPLE,
    opacity: progress <= 0 ? 0 : 1,
    ty: -SLIDE_PX * (1 - settled)
  }
}

/**
 * Flip — a vertical card-flip faked via scaleY (we only carry a uniform scale, so
 * approximate the perspective flip as a vertical squash that opens up: scale grows
 * from ~0 as the card turns face-on). Settles to scale 1 at progress 1. (A true
 * rotateX needs a 3D transform the canvas path lacks; this reads as a flip-open.)
 */
const flipIn: AnimPreset = ({ progress }) => ({
  ...IDENTITY_SAMPLE,
  opacity: progress,
  // |cos| of a quarter-turn → 0 at start (edge-on), 1 at end (face-on).
  scale: mix(0.05, 1, Math.sin((progress * Math.PI) / 2))
})

/**
 * Fold — unfolds into place: starts folded shut (tiny scale, tipped) and rotates +
 * scales open to rest. Distinct from Flip by adding a settling rotation (a hinge
 * swing) alongside the scale. Both the rotation and the scale offset vanish at
 * progress 1.
 */
const foldIn: AnimPreset = ({ progress }) => {
  const r = remain(progress)
  return {
    ...IDENTITY_SAMPLE,
    opacity: progress,
    scale: mix(0.1, 1, progress),
    // Swing from -0.6 rad (folded) to 0; eased toward 0 by `r`.
    rotation: -0.6 * r
  }
}

/**
 * Pop / Scale-up — an overshoot pop: scale springs PAST 1 then settles back. Uses
 * a back-style overshoot `1 + c*(1-p)*p`-ish curve via easing; here we layer an
 * elastic-flavored overshoot but force exact identity at the end. At progress 1 the
 * overshoot term is 0 so scale === 1.
 */
const popIn: AnimPreset = ({ progress }) => {
  // Back-out overshoot: peaks above 1 around p≈0.7, returns to 1 at p=1.
  const c = 1.70158
  const p = progress
  const back = p <= 0 ? 0 : 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2)
  return {
    ...IDENTITY_SAMPLE,
    opacity: progress <= 0 ? 0 : 1,
    scale: back
  }
}

/**
 * Blur — a fake focus-in. The canvas draw path does not consume a real gaussian
 * blur radius today, so we APPROXIMATE the defocus through the channels the
 * pipeline DOES compose: a slight scale-up (over-large → settling, like a defocused
 * halo shrinking to a sharp glyph) plus an opacity ramp. This reads as a
 * blurred-then-sharp focus-in while remaining a pure AnimSample. At progress 1 the
 * scale is 1 and opacity is 1 (fully settled to identity). If a future pipeline
 * gains a blur channel, this is the single place to add `blurPx: 8 * remain(p)`.
 */
const blurIn: AnimPreset = ({ progress }) => ({
  ...IDENTITY_SAMPLE,
  opacity: progress,
  scale: mix(1.15, 1, progress)
})

/**
 * Glitch — a seeded jitter entrance: the glyph snaps in with deterministic
 * positional jitter + opacity flicker that DECAYS as progress→1. Pure: the jitter
 * comes from {@link signedHash} of `(index, quantized progress)`, so the same phase
 * always yields the same offset (req. 5 "glitch deterministic"). At progress 1 the
 * jitter factor `r` is 0 → identity.
 */
const glitchIn: AnimPreset = ({ progress, index }) => {
  const r = remain(progress)
  const jx = signedHash(index + 1, progress)
  const jy = signedHash(index + 31, progress + 0.5)
  // Flicker: a deterministic on/off-ish opacity that resolves to `progress`.
  const flick = signedHash(index + 7, progress + 0.25)
  const opacity = progress <= 0 ? 0 : Math.max(0, Math.min(1, progress + 0.4 * flick * r))
  return {
    ...IDENTITY_SAMPLE,
    opacity,
    tx: jx * 40 * r,
    ty: jy * 40 * r
  }
}

/**
 * Spin — rotates into place: starts a full turn off (a couple of revolutions) and
 * unwinds to 0 rotation while fading + scaling up. The rotation offset is
 * `TURNS * 2π * remain(progress)`, which is exactly 0 at progress 1 (settles to
 * rest, req. 5 "spin rotation→0").
 */
const SPIN_TURNS = 1.5
const spinIn: AnimPreset = ({ progress }) => {
  const r = remain(progress)
  return {
    ...IDENTITY_SAMPLE,
    opacity: progress,
    scale: mix(0.3, 1, progress),
    rotation: SPIN_TURNS * 2 * Math.PI * r
  }
}

/**
 * Scream (elastic) — an aggressive elastic settle: scale OVERSHOOTS hard and rings
 * down via {@link elasticOut}, with a deterministic shake superimposed that decays
 * to nothing. `elasticOut(1) === 1` and the shake's `r` factor is 0 at progress 1,
 * so it settles EXACTLY to identity. Reads as the text slamming in and quivering.
 */
const screamIn: AnimPreset = ({ progress, index }) => {
  const r = remain(progress)
  const elastic = elasticOut(progress) // overshoots 1, rings down to 1
  const shakeX = signedHash(index + 3, progress) * 18 * r
  const shakeY = signedHash(index + 17, progress + 0.5) * 18 * r
  return {
    ...IDENTITY_SAMPLE,
    opacity: progress <= 0 ? 0 : 1,
    scale: mix(0.4, 1, elastic),
    tx: shakeX,
    ty: shakeY
  }
}

// ---------------------------------------------------------------------------
// Catalog + registration
// ---------------------------------------------------------------------------

/** A catalog entry for the P8.5 panel gallery: stable id, human label, default ease. */
export interface InPresetEntry {
  /** Stable preset id (registered under kind `'in'`; persisted to `clip.animation.in.preset`). */
  id: string
  /** Human-readable gallery label. */
  label: string
  /** The easing the panel should default the duration ramp to for this preset. */
  defaultEasing: import('../../../shared/captionPreset').Easing
  /** The pure preset function (also registered in the global registry). */
  fn: AnimPreset
}

/**
 * The FULL In-preset catalog (req. 1 + 3). Order is the gallery order. Each `fn` is
 * registered under kind `'in'` (below) so {@link getAnimPreset}('in', id) resolves
 * it, and the panel enumerates this list for its thumbnails.
 */
export const IN_PRESET_CATALOG: readonly InPresetEntry[] = [
  { id: 'fade', label: 'Fade', defaultEasing: 'easeOut', fn: fadeIn },
  { id: 'zoom', label: 'Zoom', defaultEasing: 'easeOut', fn: zoomIn },
  { id: 'typewriter', label: 'Typewriter', defaultEasing: 'linear', fn: typewriterIn },
  { id: 'slide-left', label: 'Slide Left', defaultEasing: 'easeOut', fn: slideLeftIn },
  { id: 'slide-right', label: 'Slide Right', defaultEasing: 'easeOut', fn: slideRightIn },
  { id: 'slide-top', label: 'Slide Top', defaultEasing: 'easeOut', fn: slideTopIn },
  { id: 'slide-bottom', label: 'Slide Bottom', defaultEasing: 'easeOut', fn: slideBottomIn },
  { id: 'bounce', label: 'Bounce', defaultEasing: 'linear', fn: bounceIn },
  { id: 'flip', label: 'Flip', defaultEasing: 'easeOut', fn: flipIn },
  { id: 'fold', label: 'Fold', defaultEasing: 'easeOut', fn: foldIn },
  { id: 'pop', label: 'Pop', defaultEasing: 'easeOut', fn: popIn },
  { id: 'blur', label: 'Blur', defaultEasing: 'easeOut', fn: blurIn },
  { id: 'glitch', label: 'Glitch', defaultEasing: 'linear', fn: glitchIn },
  { id: 'spin', label: 'Spin', defaultEasing: 'easeOut', fn: spinIn },
  { id: 'scream', label: 'Scream', defaultEasing: 'linear', fn: screamIn }
]

/** Register the full In catalog into the shared evaluator registry. Idempotent. */
export function registerInPresets(): void {
  for (const entry of IN_PRESET_CATALOG) {
    registerAnimPreset('in', entry.id, entry.fn)
  }
}

// Register on import so any consumer that imports the catalog (or this module's
// side-effect) gets the presets wired without an explicit call. Re-registering is
// harmless (the registry overwrites by id with the same fns).
registerInPresets()

/** The set of required In-preset ids (Doc 06 §"In presets"), for tests/validation. */
export const REQUIRED_IN_PRESET_IDS: readonly string[] = [
  'fade',
  'zoom',
  'typewriter',
  'slide-left',
  'slide-right',
  'slide-top',
  'slide-bottom',
  'bounce',
  'flip',
  'fold',
  'pop',
  'blur',
  'glitch',
  'spin',
  'scream'
]

export {
  fadeIn,
  zoomIn,
  typewriterIn,
  slideLeftIn,
  slideRightIn,
  slideTopIn,
  slideBottomIn,
  bounceIn,
  flipIn,
  foldIn,
  popIn,
  blurIn,
  glitchIn,
  spinIn,
  screamIn
}

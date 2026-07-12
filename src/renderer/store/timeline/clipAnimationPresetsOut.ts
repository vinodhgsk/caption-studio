/**
 * OUT-preset CATALOG (P8.3 — Doc 06 §"Out presets"; skills `keyframe-engine`
 * + `indic-text`).
 *
 * The full EXIT animation library, built ON TOP of the P8.1 evaluator
 * (`clipAnimation.ts`) and MIRRORING the P8.2 In catalog
 * (`clipAnimationPresetsIn.ts`). Each preset is a PURE function
 * `(AnimPhase) → AnimSample` registered under kind `'out'` via
 * {@link registerAnimPreset}; the evaluator owns all timing/easing/stagger and
 * feeds each preset its eased `progress`, already SHIFTED for the unit's stagger
 * index.
 *
 * TIMING CONVENTION (req. 2 — THE critical contract): the evaluator's
 * {@link outProgress} expresses the trailing-out window as an ENTRANCE-style
 * `progress` so a single channel formula serves both lanes:
 *
 *     progress === 1  ⟺  t at the START of the out window  ⟺  the clip is at REST
 *     progress === 0  ⟺  t at the END of the out window (`clip.out`)  ⟺  fully GONE
 *
 * i.e. `progress` counts DOWN 1→0 across the trailing `out.durationSec`. Therefore
 * an OUT preset uses EXACTLY the same shape as its IN twin: it returns
 * {@link IDENTITY_SAMPLE} at `progress === 1` (resting at the start of the exit) and
 * its fully-displaced / faded / off-screen state at `progress === 0` (gone). Every
 * channel interpolates toward identity with `progress` (or scales its offset by
 * `1 - progress`), so the offset is 0 at progress 1 and full at progress 0. This is
 * the reverse of the In contract (which settles at p=1 too, but ENTERS from p=0):
 * here the clip LEAVES toward p=0.
 *
 * IN + OUT COEXIST (req. 2): In affects `[start, start+in.dur]` and settles to rest
 * at the end of that window; Out affects `[out-out.dur, out]` and is at rest at the
 * START of that window. For any sane clip (`in.dur + out.dur <= out-start`) the two
 * windows do not overlap, so between them the clip sits at IDENTITY and the two
 * lanes never fight. Even if they DID overlap, both settle to identity at the
 * resting boundary, and {@link composeSamples} multiplies opacity / adds offset, so
 * the composition is well-defined (identity is the neutral element).
 *
 * STAGGER (req. 3): the evaluator delays each unit's time by `index * delaySec`
 * BEFORE computing `progress`. For OUT this means a later unit's `outProgress` stays
 * nearer 1 LONGER (it LINGERS at rest while earlier units have already begun to
 * leave) — the natural exit cascade — with NO per-preset stagger code. `index`/
 * `count` are still passed for index-dependent VARIATION (Glitch's seeded jitter).
 *
 * DETERMINISM (req. 4): pure, measurer-free, no Date/Math.random — Glitch derives
 * its jitter from a deterministic hash of `(index, progress)`. Same inputs → same
 * output, in preview + export.
 *
 * GALLERY (req. 4): {@link OUT_PRESET_CATALOG} enumerates every preset (id + label +
 * default easing) for the P8.5 panel gallery.
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
 * The "remaining offset" factor: `1 - progress`, clamped to `[0,1]`. For OUT this is
 * 0 at the rest boundary (progress 1) and 1 when fully gone (progress 0), so an exit
 * channel that ends displaced by `D` writes `D * gone(progress)` — exactly 0 at rest
 * and full at the end of the out window.
 */
function gone(progress: number): number {
  const r = 1 - progress
  return r < 0 ? 0 : r > 1 ? 1 : r
}

/**
 * Deterministic hash → a value in [-1, 1]. Pure (no Math.random): mixes the two
 * inputs with integer hashing so Glitch produces reproducible per-unit jitter that
 * differs across glyphs and across the exit but is identical for identical inputs
 * (req. 4 determinism + req. 5 "glitch deterministic"). Shares the algorithm with
 * the In catalog (kept local so the modules stay independent).
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
// The Out-preset functions (each: phase → sample; identity at progress 1 = rest,
// fully gone at progress 0 = end of out window)
// ---------------------------------------------------------------------------

/** A baseline displacement scale (px) for the translate-style presets. */
const SLIDE_PX = 120

/** Fade — opacity ramps from 1 (rest) down to 0 (gone). The minimal exit. */
const fadeOut: AnimPreset = ({ progress }) => ({
  ...IDENTITY_SAMPLE,
  opacity: progress
})

/**
 * Zoom — the text scales UP and away while fading out (a "zoom past camera" exit):
 * at rest (progress 1) scale 1 / opacity 1; gone (progress 0) it has blown up to a
 * large scale with opacity 0. `gone(progress)` drives both, so the offset vanishes
 * at rest.
 */
const zoomOut: AnimPreset = ({ progress }) => ({
  ...IDENTITY_SAMPLE,
  opacity: progress,
  scale: mix(1, 1.8, gone(progress))
})

/** Build a directional Slide preset that translates OUT toward (dx,dy)*SLIDE_PX. */
function slideTo(dx: number, dy: number): AnimPreset {
  return ({ progress }) => {
    const g = gone(progress)
    return {
      ...IDENTITY_SAMPLE,
      opacity: progress,
      tx: dx * SLIDE_PX * g,
      ty: dy * SLIDE_PX * g
    }
  }
}

/** Slide out to the LEFT (exits moving left): rest at 0, gone at -x. */
const slideLeftOut = slideTo(-1, 0)
/** Slide out to the RIGHT (exits moving right): rest at 0, gone at +x. */
const slideRightOut = slideTo(1, 0)
/** Slide out to the TOP (exits moving up): rest at 0, gone at -y. */
const slideTopOut = slideTo(0, -1)
/** Slide out to the BOTTOM (exits moving down): rest at 0, gone at +y. */
const slideBottomOut = slideTo(0, 1)

/**
 * Bounce — ANTICIPATE then leave: the text first crouches/rebounds (a bounce wind-up)
 * and then drops away downward. We run the EXIT amount through {@link bounceOut} so
 * the vertical offset rebounds on the way out. `bounceOut(0) === 0` so at rest
 * (progress 1 → gone 0) the offset is 0 (identity); as progress→0 the offset grows
 * with rebounds. Opacity holds until it is clearly leaving, then drops.
 */
const bounceOutPreset: AnimPreset = ({ progress }) => {
  const g = gone(progress) // 0 at rest → 1 when gone
  const rebound = bounceOut(g) // rebounds on the way out
  return {
    ...IDENTITY_SAMPLE,
    opacity: progress >= 1 ? 1 : 1 - g, // fades as it leaves; exactly 1 at rest
    ty: SLIDE_PX * rebound
  }
}

/**
 * Flip — a vertical card-flip faked via uniform scale (the canvas path carries no 3D
 * rotateX): the card turns from face-on (scale 1, rest) to edge-on (scale ~0, gone),
 * fading out. Mirror of the In flip. At progress 1 the scale is exactly 1.
 */
const flipOut: AnimPreset = ({ progress }) => ({
  ...IDENTITY_SAMPLE,
  opacity: progress,
  // |sin| of a quarter-turn → 1 at rest (face-on), ~0 when gone (edge-on).
  scale: mix(0.05, 1, Math.sin((progress * Math.PI) / 2))
})

/**
 * Fold — folds SHUT and away: from rest (scale 1, no hinge) it scales down and swings
 * a hinge rotation closed as it leaves. Distinct from Flip by the settling rotation.
 * Both the rotation and the scale offset are 0 at progress 1 (rest). Mirror of In fold.
 */
const foldOut: AnimPreset = ({ progress }) => {
  const g = gone(progress)
  return {
    ...IDENTITY_SAMPLE,
    opacity: progress,
    scale: mix(1, 0.1, g),
    // Swing from 0 (rest) toward -0.6 rad (folded shut) as it leaves.
    rotation: -0.6 * g
  }
}

/**
 * Blur — a fake focus-OUT. The canvas draw path does not consume a real gaussian
 * blur radius today, so we APPROXIMATE the defocus through the channels the pipeline
 * DOES compose: a slight scale-up (sharp glyph → defocused halo growing) plus an
 * opacity ramp down. Mirror of In blur. At progress 1 the scale is 1 and opacity 1
 * (rest). If a future pipeline gains a blur channel, add `blurPx: 8 * gone(p)` here.
 */
const blurOut: AnimPreset = ({ progress }) => ({
  ...IDENTITY_SAMPLE,
  opacity: progress,
  scale: mix(1, 1.15, gone(progress))
})

/**
 * Glitch — a seeded jitter EXIT: the glyph shudders apart with deterministic
 * positional jitter + opacity flicker that GROWS as it leaves (progress→0). Pure: the
 * jitter comes from {@link signedHash} of `(index, quantized progress)`, so the same
 * phase always yields the same offset (req. 5 "glitch deterministic"). At progress 1
 * the jitter factor `g` is 0 → identity (rest).
 */
const glitchOut: AnimPreset = ({ progress, index }) => {
  const g = gone(progress)
  const jx = signedHash(index + 1, progress)
  const jy = signedHash(index + 31, progress + 0.5)
  // Flicker: a deterministic opacity wobble that resolves to `progress` (1 at rest).
  const flick = signedHash(index + 7, progress + 0.25)
  const opacity = progress >= 1 ? 1 : Math.max(0, Math.min(1, progress + 0.4 * flick * g))
  return {
    ...IDENTITY_SAMPLE,
    opacity,
    tx: jx * 40 * g,
    ty: jy * 40 * g
  }
}

/**
 * Shrink — the text scales DOWN to nothing and fades out (a "vanish to a point"
 * exit). At rest (progress 1) scale 1 / opacity 1; gone (progress 0) scale 0 /
 * opacity 0. The minimal scale-collapse exit; mirror of the In zoom shape but
 * collapsing rather than growing.
 */
const shrinkOut: AnimPreset = ({ progress }) => ({
  ...IDENTITY_SAMPLE,
  opacity: progress,
  scale: mix(0, 1, progress)
})

/**
 * Zoom-burst (elastic) — an aggressive elastic OVERSHOOT exit: scale rings out via
 * {@link elasticOut} (overshooting on the way out) while a deterministic shake is
 * superimposed and a fade applies. Provided as an expressive counterpart; settles to
 * identity at rest. (Not in the REQUIRED set but enumerable for the gallery.)
 */
const burstOut: AnimPreset = ({ progress, index }) => {
  const g = gone(progress)
  const elastic = elasticOut(g) // 0 at rest → rings out toward 1
  const shakeX = signedHash(index + 3, progress) * 18 * g
  const shakeY = signedHash(index + 17, progress + 0.5) * 18 * g
  return {
    ...IDENTITY_SAMPLE,
    opacity: progress,
    scale: mix(1, 2.2, elastic),
    tx: shakeX,
    ty: shakeY
  }
}

// ---------------------------------------------------------------------------
// Catalog + registration
// ---------------------------------------------------------------------------

/** A catalog entry for the P8.5 panel gallery: stable id, human label, default ease. */
export interface OutPresetEntry {
  /** Stable preset id (registered under kind `'out'`; persisted to `clip.animation.out.preset`). */
  id: string
  /** Human-readable gallery label. */
  label: string
  /** The easing the panel should default the duration ramp to for this preset. */
  defaultEasing: import('../../../shared/captionPreset').Easing
  /** The pure preset function (also registered in the global registry). */
  fn: AnimPreset
}

/**
 * The FULL Out-preset catalog (req. 1 + 4). Order is the gallery order. Each `fn` is
 * registered under kind `'out'` (below) so {@link getAnimPreset}('out', id) resolves
 * it, and the panel enumerates this list for its thumbnails.
 */
export const OUT_PRESET_CATALOG: readonly OutPresetEntry[] = [
  { id: 'fade', label: 'Fade', defaultEasing: 'easeIn', fn: fadeOut },
  { id: 'zoom', label: 'Zoom', defaultEasing: 'easeIn', fn: zoomOut },
  { id: 'slide-left', label: 'Slide Left', defaultEasing: 'easeIn', fn: slideLeftOut },
  { id: 'slide-right', label: 'Slide Right', defaultEasing: 'easeIn', fn: slideRightOut },
  { id: 'slide-top', label: 'Slide Top', defaultEasing: 'easeIn', fn: slideTopOut },
  { id: 'slide-bottom', label: 'Slide Bottom', defaultEasing: 'easeIn', fn: slideBottomOut },
  { id: 'bounce', label: 'Bounce', defaultEasing: 'linear', fn: bounceOutPreset },
  { id: 'glitch', label: 'Glitch', defaultEasing: 'linear', fn: glitchOut },
  { id: 'blur', label: 'Blur', defaultEasing: 'easeIn', fn: blurOut },
  { id: 'flip', label: 'Flip', defaultEasing: 'easeIn', fn: flipOut },
  { id: 'fold', label: 'Fold', defaultEasing: 'easeIn', fn: foldOut },
  { id: 'shrink', label: 'Shrink', defaultEasing: 'easeIn', fn: shrinkOut },
  { id: 'burst', label: 'Burst', defaultEasing: 'linear', fn: burstOut }
]

/** Register the full Out catalog into the shared evaluator registry. Idempotent. */
export function registerOutPresets(): void {
  for (const entry of OUT_PRESET_CATALOG) {
    registerAnimPreset('out', entry.id, entry.fn)
  }
}

// Register on import so any consumer that imports the catalog (or this module's
// side-effect) gets the presets wired without an explicit call. Re-registering is
// harmless (the registry overwrites by id with the same fns).
registerOutPresets()

/** The set of required Out-preset ids (Doc 06 §"Out presets"; P8.3), for tests/validation. */
export const REQUIRED_OUT_PRESET_IDS: readonly string[] = [
  'fade',
  'zoom',
  'slide-left',
  'slide-right',
  'slide-top',
  'slide-bottom',
  'bounce',
  'glitch',
  'blur',
  'flip',
  'fold',
  'shrink'
]

export {
  fadeOut,
  zoomOut,
  slideLeftOut,
  slideRightOut,
  slideTopOut,
  slideBottomOut,
  bounceOutPreset,
  glitchOut,
  blurOut,
  flipOut,
  foldOut,
  shrinkOut,
  burstOut
}

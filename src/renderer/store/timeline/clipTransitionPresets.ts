/**
 * Transition presets (P9.2) — four built-in presets registered into the
 * transition engine registry on module import.
 *
 * ALL functions are PURE: no DOM, no Date, no Math.random.
 * Glitch uses an inline mulberry32 PRNG seeded deterministically from progress.
 *
 * Presets:
 *   dissolve — simple cross-fade (opacity only)
 *   slide    — directional wipe (l/r/t/b)
 *   zoom     — scale-based transition (in/out variant via params.variant)
 *   glitch   — seeded digital-glitch effect (translate jitter + brief cuts)
 */

import {
  registerTransition,
  type TransitionPhase,
  type TransitionSample
} from './clipTransition'

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface TransitionEntry {
  id: string
  label: string
  defaultDirection?: 'l' | 'r' | 't' | 'b'
  defaultDuration: number
}

export const TRANSITION_CATALOG: readonly TransitionEntry[] = [
  { id: 'dissolve', label: 'Dissolve', defaultDuration: 0.5 },
  { id: 'slide', label: 'Slide', defaultDirection: 'l', defaultDuration: 0.5 },
  { id: 'zoom', label: 'Zoom', defaultDuration: 0.5 },
  { id: 'glitch', label: 'Glitch', defaultDuration: 0.4 }
] as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default canvas dimensions (project resolution) used when not overridden by params. */
const DEFAULT_W = 1920
const DEFAULT_H = 1080

/** Clamp a value to [0, 1]. */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * Mulberry32 PRNG — pure, deterministic, no Math.random.
 * Returns a value in [0, 1).
 * Reference: https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
 */
function mulberry32(seed: number): number {
  let t = seed + 0x6d2b79f5
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 0x100000000
}

// ---------------------------------------------------------------------------
// dissolve — cross-fade (opacity 1→0 for A, 0→1 for B, no transform)
// ---------------------------------------------------------------------------

function dissolve(phase: TransitionPhase): TransitionSample {
  const p = clamp01(phase.progress)
  return {
    aOpacity: 1 - p,
    aTx: 0,
    aTy: 0,
    aScale: 1,
    bOpacity: p,
    bTx: 0,
    bTy: 0,
    bScale: 1
  }
}

// ---------------------------------------------------------------------------
// slide — directional wipe
//   l: A slides left (-x), B enters from the right (+x)
//   r: A slides right (+x), B enters from the left (-x)
//   t: A slides up (-y), B enters from the bottom (+y)
//   b: A slides down (+y), B enters from the top (-y)
// ---------------------------------------------------------------------------

function slide(phase: TransitionPhase): TransitionSample {
  const p = clamp01(phase.progress)
  const dir = phase.direction ?? 'l'

  const w = typeof phase.params['width'] === 'number' ? phase.params['width'] : DEFAULT_W
  const h = typeof phase.params['height'] === 'number' ? phase.params['height'] : DEFAULT_H

  let aTx = 0
  let aTy = 0
  let bTx = 0
  let bTy = 0

  switch (dir) {
    case 'l':
      // A exits left, B enters from right
      aTx = -p * w
      bTx = (1 - p) * w
      break
    case 'r':
      // A exits right, B enters from left
      aTx = p * w
      bTx = -(1 - p) * w
      break
    case 't':
      // A exits up, B enters from bottom
      aTy = -p * h
      bTy = (1 - p) * h
      break
    case 'b':
      // A exits down, B enters from top
      aTy = p * h
      bTy = -(1 - p) * h
      break
  }

  return {
    aOpacity: 1,
    aTx,
    aTy,
    aScale: 1,
    bOpacity: 1,
    bTx,
    bTy,
    bScale: 1
  }
}

// ---------------------------------------------------------------------------
// zoom — scale-based transition
//   Default (zoom-in on A): A zooms in (scale 1→1.5) while fading out; B
//     fades in at identity scale.
//   params.variant === 'out': A stays at identity and fades; B zooms in from
//     small (0.5→1) while fading in.
// ---------------------------------------------------------------------------

function zoom(phase: TransitionPhase): TransitionSample {
  const p = clamp01(phase.progress)
  const variant = typeof phase.params['variant'] === 'string' ? phase.params['variant'] : 'in'

  if (variant === 'out') {
    // B zooms from 0.5→1 while fading in; A fades out at scale 1
    return {
      aOpacity: 1 - p,
      aTx: 0,
      aTy: 0,
      aScale: 1,
      bOpacity: p,
      bTx: 0,
      bTy: 0,
      bScale: 0.5 + p * 0.5
    }
  }

  // Default (zoom-in on A): A zooms from 1→1.5 while fading out; B fades in
  return {
    aOpacity: 1 - p,
    aTx: 0,
    aTy: 0,
    aScale: 1 + p * 0.5,
    bOpacity: p,
    bTx: 0,
    bTy: 0,
    bScale: 1
  }
}

// ---------------------------------------------------------------------------
// glitch — deterministic digital-glitch using mulberry32
//   Clean at p < 0.05 and p > 0.95; chaotic in the middle.
//   Seed is derived from Math.floor(progress * 30) so each 1/30-second
//   "frame bucket" has a consistent jitter (preview and export agree).
// ---------------------------------------------------------------------------

/** Maximum pixel jitter magnitude for the glitch effect. */
const GLITCH_JITTER_PX = 48

function glitch(phase: TransitionPhase): TransitionSample {
  const p = clamp01(phase.progress)

  // Clean entry/exit zones — no jitter near the edges.
  if (p < 0.05 || p > 0.95) {
    return {
      aOpacity: 1 - p,
      aTx: 0,
      aTy: 0,
      aScale: 1,
      bOpacity: p,
      bTx: 0,
      bTy: 0,
      bScale: 1
    }
  }

  // Deterministic seed from the "frame bucket" so the same frame always renders
  // the same jitter (preview/export parity).
  const frameBucket = Math.floor(p * 30)
  const rA1 = mulberry32(frameBucket * 3 + 1)
  const rA2 = mulberry32(frameBucket * 3 + 2)
  const rB1 = mulberry32(frameBucket * 3 + 3)
  const rB2 = mulberry32(frameBucket * 3 + 4)

  // Brief full-cut flash: occasionally show only A or only B (cuts every ~3 frames).
  const cutSeed = mulberry32(frameBucket * 7 + 13)
  if (cutSeed < 0.15) {
    // Flash to A only
    return {
      aOpacity: 1,
      aTx: 0,
      aTy: 0,
      aScale: 1,
      bOpacity: 0,
      bTx: 0,
      bTy: 0,
      bScale: 1
    }
  }
  if (cutSeed < 0.3) {
    // Flash to B only
    return {
      aOpacity: 0,
      aTx: 0,
      aTy: 0,
      aScale: 1,
      bOpacity: 1,
      bTx: 0,
      bTy: 0,
      bScale: 1
    }
  }

  // Chaotic middle: jitter both A and B with a dissolve base.
  const aTx = (rA1 - 0.5) * 2 * GLITCH_JITTER_PX
  const aTy = (rA2 - 0.5) * 2 * GLITCH_JITTER_PX * 0.5
  const bTx = (rB1 - 0.5) * 2 * GLITCH_JITTER_PX
  const bTy = (rB2 - 0.5) * 2 * GLITCH_JITTER_PX * 0.5

  return {
    aOpacity: 1 - p,
    aTx,
    aTy,
    aScale: 1,
    bOpacity: p,
    bTx,
    bTy,
    bScale: 1
  }
}

// ---------------------------------------------------------------------------
// Registration — runs on first import
// ---------------------------------------------------------------------------

registerTransition('dissolve', dissolve)
registerTransition('slide', slide)
registerTransition('zoom', zoom)
registerTransition('glitch', glitch)

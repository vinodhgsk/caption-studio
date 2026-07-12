/**
 * COMMUNITY-REFERENCE TEXT ANIMATIONS (P8C.1–P8C.19 — Doc 17).
 *
 * Seventeen named presets inspired by external CodePen demos, registered under
 * the `"community/"` namespace in the existing animation and reveal registries.
 *
 * REGISTRATION: all presets self-register on import via {@link registerCommunityAnimations}.
 * The function is idempotent (re-registering overwrites with the same function).
 *
 * PURITY: every evaluator function is PURE — no DOM, no Date, no Math.random.
 * Seeded randomness uses {@link mulberry32} with {@link hashSeed} derived from
 * (clipIndex/unitIndex, unitIndex, frameTick) so headless export is identical to
 * live preview.
 *
 * PER-GRAPHEME: per-letter work uses `index`/`count` from the AnimPhase — the
 * evaluator already staggers these per grapheme cluster (indic-text).
 */

import { clamp01, lerp, elasticOut, easeOutCubic } from '../../../shared/easing'
import {
  IDENTITY_SAMPLE,
  registerAnimPreset,
  type AnimPreset,
  type AnimSample,
} from './clipAnimation'
import {
  IDENTITY_MASK,
  IDENTITY_UNIT,
  registerRevealEffect,
  revealUnitBoxes,
  type RevealEffectFn,
  type RevealUnit,
} from './clipRevealEffect'
import { typeEffect } from './clipRevealEffects'
import { glossyEffect } from './clipRevealEffects'

// ---------------------------------------------------------------------------
// PRNG utilities (pure, seeded — no Math.random)
// ---------------------------------------------------------------------------

/**
 * Mulberry32 PRNG: maps a 32-bit integer seed to a float in [0, 1).
 * Deterministic, pure, no wall-clock state.
 */
export function mulberry32(seed: number): number {
  let t = (seed >>> 0) + 0x6d2b79f5
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 0xffffffff
}

/**
 * Mix three integer inputs into a 32-bit unsigned integer seed.
 * Used to seed PRNG from (clipIndex, unitIndex, frameTick).
 */
export function hashSeed(a: number, b: number, c: number): number {
  let h = ((a * 2654435761) >>> 0) ^ ((b * 1013904223) >>> 0) ^ ((c * 1664525) >>> 0)
  h ^= h >>> 16
  return h >>> 0
}

// ---------------------------------------------------------------------------
// Shared pure helpers
// ---------------------------------------------------------------------------

const TAU = 2 * Math.PI

/** easeOutBack: 1 + c3*(p-1)^3 + c1*(p-1)^2 (CSS back easing, overshoots slightly). */
function easeOutBack(p: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2)
}

/** Fractional part: frac(x) = x - floor(x), always in [0,1). */
function frac(x: number): number {
  return x - Math.floor(x)
}

// ---------------------------------------------------------------------------
// P8C.2 — community/wave-ripple (loop)
// ---------------------------------------------------------------------------
// Per-unit sine-wave Y offset: dy_i = -amplitude * sin(2π*progress - k*i + phase)
// where k = 2π/wavelength (wavelength in unit offsets, not seconds).
// Also optional tiltCouple rotation and scaleY lift.

const waveRippleLoop: AnimPreset = ({ progress, index, count }) => {
  // Params (hard-coded defaults; panels can override via stagger/speed).
  const amplitude = 0.15 * 16 // 0.15em in px (16 = approx em)
  const wavelength = 6
  const phaseOffset = 0
  const tiltCouple = 0

  const k = TAU / wavelength
  const theta = TAU * progress - k * index + phaseOffset

  const dy = -amplitude * Math.sin(theta)
  const rotation = count > 1 ? tiltCouple * Math.cos(theta) : 0

  return {
    ...IDENTITY_SAMPLE,
    ty: dy,
    rotation,
  }
}

// ---------------------------------------------------------------------------
// P8C.3 — community/glitch-split (in)
// ---------------------------------------------------------------------------
// Decaying random per-unit translate + rotation jitter, amplitude = splitDistance*(1-progress).

const glitchSplitIn: AnimPreset = ({ progress, index }) => {
  const splitDistance = 3 // character widths approximated as fraction of 16px
  const jitter = 1.5 // degrees
  const tick = Math.floor(progress * 60)
  const seed1 = hashSeed(index + 1, tick, 13)
  const seed2 = hashSeed(index + 7, tick, 29)
  const amp = splitDistance * 16 * (1 - clamp01(progress))
  const tx = (mulberry32(seed1) - 0.5) * amp * 2
  const rotation = (mulberry32(seed2) - 0.5) * (jitter * Math.PI / 180) * (1 - clamp01(progress))
  const opacity = clamp01(progress * 2)

  return {
    ...IDENTITY_SAMPLE,
    opacity,
    tx,
    rotation,
  }
}

// ---------------------------------------------------------------------------
// P8C.4 — community/typewriter-caret (reveal)
// Thin wrapper delegating to the existing `typeEffect`.
// ---------------------------------------------------------------------------

// (Registered below — delegating directly to the imported typeEffect.)

// ---------------------------------------------------------------------------
// P8C.5 — community/kinetic-3d (in + loop)
// ---------------------------------------------------------------------------
// Approximates 3D Y-axis rotation as: scaleY = cos(theta), ty = sin(theta)*depth

const kinetic3dIn: AnimPreset = ({ progress, index }) => {
  const maxAngle = 90
  const stagger = 0.05
  const p = clamp01(progress - index * stagger)
  const easedP = easeOutBack(p)
  const theta = maxAngle * (1 - easedP) * (Math.PI / 180)
  const scaleY = Math.cos(theta)
  const ty = Math.sin(theta) * 8
  const opacity = clamp01(p * 3)

  return {
    ...IDENTITY_SAMPLE,
    opacity,
    scaleY: Math.max(0, scaleY),
    ty,
  }
}

const kinetic3dLoop: AnimPreset = ({ progress, index }) => {
  const maxAngle = 20
  const wavelength = 4
  const k = TAU / wavelength
  const theta = maxAngle * Math.sin(TAU * progress - k * index) * (Math.PI / 180)
  const scaleY = Math.cos(theta)
  const ty = Math.sin(theta) * 8

  return {
    ...IDENTITY_SAMPLE,
    scaleY: Math.max(0.01, scaleY),
    ty,
  }
}

// ---------------------------------------------------------------------------
// P8C.6 — community/scramble-decode (in)
// ---------------------------------------------------------------------------
// Per-unit: before lockTime show glyphOverride (random charset char); after show original.

const SCRAMBLE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

const scrambleDecodeIn: AnimPreset = ({ progress, index, count }) => {
  const tickHz = 20
  const spread = 0.7
  const tick = Math.floor(progress * tickHz)
  const lockFraction = count > 1 ? (index / (count - 1)) * spread : 0
  const locked = progress >= lockFraction

  const opacity = clamp01(progress * 1.5)
  const sample: AnimSample = {
    ...IDENTITY_SAMPLE,
    opacity,
  }

  if (!locked) {
    const seed = hashSeed(index, tick, 99)
    const charIdx = Math.floor(mulberry32(seed) * SCRAMBLE_CHARSET.length)
    sample.glyphOverride = SCRAMBLE_CHARSET[charIdx]
  }

  return sample
}

// ---------------------------------------------------------------------------
// P8C.7 — community/gloss-sweep (reveal loop)
// ---------------------------------------------------------------------------
// Thin wrapper around glossyEffect, already loop-capable.
// (Registered as reveal effect delegating to glossyEffect.)

// ---------------------------------------------------------------------------
// P8C.8 — community/mask-line-rise (reveal)
// ---------------------------------------------------------------------------
// Line-by-line masked slide-up.

const maskLineRiseEffect: RevealEffectFn = ({ progress, unit, params, layout }) => {
  const lineStagger = typeof params.lineStagger === 'number' ? params.lineStagger : 0.12
  const ε = 1e-6

  const boxes = revealUnitBoxes(layout, 'line')
  const Nlines = boxes.length

  if (Nlines === 0) {
    return { mask: { ...IDENTITY_MASK }, perUnit: [], overlays: [], unit, active: progress < 1 }
  }

  const maxStagger = (Nlines - 1) * lineStagger
  const segmentDuration = Math.max(ε, 1 - maxStagger)

  const perUnit: RevealUnit[] = boxes.map((box, L) => {
    const unitStart = L * lineStagger
    const pL = easeOutCubic(clamp01((progress - unitStart) / segmentDuration))
    const dy = (1 - pL) * box.height

    return {
      ...IDENTITY_UNIT,
      ty: dy,
      opacity: pL > 0 ? 1 : 0,
      coverage: pL > 0 ? 1 : 0,
    }
  })

  return {
    mask: { ...IDENTITY_MASK },
    perUnit,
    overlays: [],
    unit: 'line',
    active: progress < 1,
  }
}

// ---------------------------------------------------------------------------
// P8C.9 — community/elastic-word-pop (in)
// ---------------------------------------------------------------------------
// Per-unit (word by convention via stagger): scale with elasticOut, alternating kick.

const elasticWordPopIn: AnimPreset = ({ progress, index, count }) => {
  const wordStagger = 0.08
  const period = 0.35
  const kick = 6 * (Math.PI / 180)
  const segment = Math.max(0.01, 1 - (count - 1) * wordStagger)

  const unitStart = index * wordStagger
  const pw = clamp01((progress - unitStart) / segment)
  const scaleFactor = elasticOut(pw, period)
  const rotation = (1 - clamp01(pw)) * kick * (index % 2 === 0 ? 1 : -1)
  const opacity = clamp01(pw * 3)

  return {
    ...IDENTITY_SAMPLE,
    opacity,
    scale: scaleFactor,
    rotation,
  }
}

// ---------------------------------------------------------------------------
// P8C.10 — community/focus-blur-in (in)
// ---------------------------------------------------------------------------
// Whole-clip blur + letterSpacing + scale animate in.

const focusBlurIn: AnimPreset = ({ progress }) => {
  const maxBlur = 12
  const maxTracking = 0.4
  const startOpacity = 0
  const zoom = 0.06

  const q = easeOutCubic(progress)
  const opacity = lerp(startOpacity, 1, q)
  const scale = lerp(1 + zoom, 1, q)
  const blur = (1 - q) * maxBlur
  const letterSpacing = (1 - q) * maxTracking

  return {
    ...IDENTITY_SAMPLE,
    opacity,
    scale,
    blur,
    letterSpacing,
  }
}

// ---------------------------------------------------------------------------
// P8C.11 — community/char-drop-tumble (in)
// ---------------------------------------------------------------------------
// Per-unit: drop from above with easeOutBack settle + seeded rotation.

const charDropTumbleIn: AnimPreset = ({ progress, index, count }) => {
  const charStagger = 0.04
  const dropHeight = 1.2 * 16 // 1.2em in px
  const maxRot = 40 * (Math.PI / 180)
  const segment = Math.max(0.01, 1 - (count - 1) * charStagger)

  const unitStart = index * charStagger
  const pi = clamp01((progress - unitStart) / segment)
  const b = easeOutBack(pi)

  const dy = (1 - b) * (-dropHeight)
  const seed = hashSeed(index, 0, 7)
  const seededRot = (mulberry32(seed) * 2 - 1) * maxRot
  const rotation = (1 - clamp01(pi)) * seededRot
  const opacity = clamp01(pi * 4)

  return {
    ...IDENTITY_SAMPLE,
    opacity,
    ty: dy,
    rotation,
  }
}

// ---------------------------------------------------------------------------
// P8C.12 — community/shimmer-gradient (loop)
// ---------------------------------------------------------------------------
// Emit gradientOffset = frac(progress * speed) for the draw path to shift the fill.

const shimmerGradientLoop: AnimPreset = ({ progress }) => {
  const speed = 0.5

  return {
    ...IDENTITY_SAMPLE,
    gradientOffset: frac(progress * speed),
  }
}

// ---------------------------------------------------------------------------
// P8C.13 — community/jelly-squash (loop)
// ---------------------------------------------------------------------------
// Non-uniform per-unit scale wave.

const jellySquashLoop: AnimPreset = ({ progress, index }) => {
  const amplitude = 0.18
  const phaseStep = 0.5
  const squashSink = amplitude * 4

  const s = Math.sin(TAU * progress - phaseStep * index)
  const scaleX = 1 - amplitude * s * 0.7 // couple = 0.7, inverse for X
  const scaleY = 1 + amplitude * s
  const ty = squashSink * Math.max(0, s)

  return {
    ...IDENTITY_SAMPLE,
    scaleX: Math.max(0.1, scaleX),
    scaleY: Math.max(0.1, scaleY),
    ty,
  }
}

// ---------------------------------------------------------------------------
// P8C.14 — community/neon-flicker (in)
// ---------------------------------------------------------------------------
// Startup flicker sequence then steady hum glow.

const neonFlickerIn: AnimPreset = ({ progress, index }) => {
  const startup = 0.5
  const humHz = 0.6
  const humDepth = 0.12

  let glowIntensity: number

  if (progress < startup) {
    // Startup: seeded flicker table per unit
    const tick = Math.floor(progress * 30)
    const seed = hashSeed(index, tick, 3)
    const r = mulberry32(seed)
    // Three states: off (0), dim (0.4), full (1.0)
    glowIntensity = r < 0.25 ? 0 : r < 0.55 ? 0.4 : 1.0
  } else {
    // Steady hum phase
    const p = progress
    glowIntensity = 1 - humDepth * (0.5 + 0.5 * Math.sin(TAU * humHz * p))
  }

  const opacity = clamp01(progress * 2)

  return {
    ...IDENTITY_SAMPLE,
    opacity,
    glowIntensity: clamp01(glowIntensity),
  }
}

// ---------------------------------------------------------------------------
// P8C.15 — community/liquid-fill (reveal)
// ---------------------------------------------------------------------------
// Wavy alpha-mask fill; returns a 'liquid' overlay carrying level + wave params.

const liquidFillEffect: RevealEffectFn = ({ progress, params, layout }) => {
  const fillColor = typeof params.fillColor === 'string' ? params.fillColor : '#19a0ff'
  const waveAmp = typeof params.waveAmp === 'number' ? params.waveAmp : 0.06
  const waveLen = typeof params.waveLen === 'number' ? params.waveLen : 1.5
  const waveSpeed = typeof params.waveSpeed === 'number' ? params.waveSpeed : 0.6

  const level = easeOutCubic(progress)

  return {
    mask: { ...IDENTITY_MASK },
    perUnit: [],
    overlays: [
      {
        kind: 'liquid',
        box: layout.block,
        progress,
        direction: 'b',
        color: fillColor,
        params: { level, waveAmp, waveLen, waveSpeed },
      },
    ],
    unit: 'line',
    active: progress < 1,
  }
}

// ---------------------------------------------------------------------------
// P8C.16 — community/particle-assemble (reveal)
// ---------------------------------------------------------------------------
// Seeded particle system overlay; draw path computes particles from seed + glyph boxes.

const particleAssembleEffect: RevealEffectFn = ({ progress, params, layout }) => {
  const density = typeof params.density === 'number' ? params.density : 1
  const scatter = typeof params.scatter === 'number' ? params.scatter : 2.5
  const dotSize = typeof params.dotSize === 'number' ? params.dotSize : 2
  const converge = typeof params.converge === 'number' ? params.converge : 0.8
  const solidify = params.solidify !== false
  const seed = typeof params.seed === 'string' ? params.seed.length : 42

  return {
    mask: { ...IDENTITY_MASK },
    perUnit: [],
    overlays: [
      {
        kind: 'particles',
        box: layout.block,
        progress,
        direction: 'b',
        params: { seed, density, scatter, dotSize, converge, solidify, progress },
      },
    ],
    unit: 'char',
    active: progress < 1,
  }
}

// ---------------------------------------------------------------------------
// P8C.17 — community/perspective-slam (in)
// ---------------------------------------------------------------------------
// Per-unit perspective entrance: scale from far (small) to near (1), with blur.

const perspectiveSlamIn: AnimPreset = ({ progress, index, count }) => {
  const slamStagger = 0.06
  const maxBlur = 8
  const startScale = 0.05
  const startRotX = 35

  const segment = Math.max(0.01, 1 - (count - 1) * slamStagger)
  const unitStart = index * slamStagger
  const pw = clamp01((progress - unitStart) / segment)
  const e = easeOutBack(pw)

  const scale = lerp(startScale, 1, clamp01(e))
  const ty = (1 - easeOutCubic(pw)) * startRotX
  const blur = (1 - easeOutCubic(pw)) * maxBlur
  const opacity = clamp01(pw * 3)

  return {
    ...IDENTITY_SAMPLE,
    opacity,
    scale,
    ty,
    blur,
  }
}

// ---------------------------------------------------------------------------
// P8C.18 — community/variable-weight-wave (loop)
// ---------------------------------------------------------------------------
// Per-unit variable-font wght axis wave.

const variableWeightWaveLoop: AnimPreset = ({ progress, index }) => {
  const wghtMin = 200
  const wghtMax = 800
  const phaseStep = 0.6
  const cycleCount = 1

  const mid = (wghtMin + wghtMax) / 2
  const amp = (wghtMax - wghtMin) / 2
  const ph = TAU * progress * cycleCount - phaseStep * index
  const fontWeight = mid + amp * Math.sin(ph)

  return {
    ...IDENTITY_SAMPLE,
    fontWeight: Math.max(100, Math.min(900, fontWeight)),
  }
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/** A catalog entry for the community panel gallery. */
export interface CommunityAnimEntry {
  /** Stable preset id, e.g. `"community/wave-ripple"`. */
  id: string
  /** Human-readable gallery label. */
  label: string
  /** One-line description. */
  description: string
  /** Source CodePen URL (best-guess reference). */
  sourcePen: string
  /** Which animation slot this fills. */
  slot: 'in' | 'loop' | 'reveal'
  /** Default params for the panel UI. */
  defaultParams: Record<string, unknown>
  /** True if this is a continuous loop animation. */
  loop: boolean
}

/** The full community animation catalog (17 entries). */
export const COMMUNITY_ANIM_CATALOG: readonly CommunityAnimEntry[] = [
  {
    id: 'community/wave-ripple',
    label: 'Wave Ripple',
    description: 'Per-letter travelling sine-wave bounce',
    sourcePen: 'https://codepen.io/GreenSock/pen/wvwEOZL',
    slot: 'loop',
    defaultParams: { amplitude: 0.15, wavelength: 6, speed: 1, phase: 0, tiltCouple: 0 },
    loop: true,
  },
  {
    id: 'community/glitch-split',
    label: 'Glitch Split',
    description: 'Seeded decaying positional glitch entrance',
    sourcePen: 'https://codepen.io/aaroniker/pen/KGpXZo',
    slot: 'in',
    defaultParams: { splitDistance: 3, jitter: 1.5, intensity: 1 },
    loop: false,
  },
  {
    id: 'community/typewriter-caret',
    label: 'Typewriter Caret',
    description: 'Typewriter reveal with blinking caret',
    sourcePen: 'https://codepen.io/GreenSock/pen/NWRoQwM',
    slot: 'reveal',
    defaultParams: { caret: true, caretWidth: 2, blinkPeriodSec: 1.06, tickCue: false },
    loop: false,
  },
  {
    id: 'community/kinetic-3d',
    label: 'Kinetic 3D',
    description: 'Per-letter 3D Y-axis rotation approximated in 2D',
    sourcePen: 'https://codepen.io/GreenSock/pen/BaoBgmP',
    slot: 'in',
    defaultParams: { axis: 'x', maxAngle: 90, stagger: 0.05, depth: 0 },
    loop: false,
  },
  {
    id: 'community/scramble-decode',
    label: 'Scramble Decode',
    description: 'Characters randomise then lock to their final glyph',
    sourcePen: 'https://codepen.io/johanmouchet/pen/OXxvqM',
    slot: 'in',
    defaultParams: { tickHz: 20, spread: 0.7, charset: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' },
    loop: false,
  },
  {
    id: 'community/gloss-sweep',
    label: 'Gloss Sweep',
    description: 'Specular sheen band sweeps across text in a loop',
    sourcePen: 'https://codepen.io/GreenSock/pen/oNXxYMe',
    slot: 'reveal',
    defaultParams: { angle: 45, bandWidth: 40, intensity: 0.8, speed: 0.5 },
    loop: true,
  },
  {
    id: 'community/mask-line-rise',
    label: 'Mask Line Rise',
    description: 'Lines masked-slide up from below, staggered',
    sourcePen: 'https://codepen.io/gabriellewee/pen/vYNrqXB',
    slot: 'reveal',
    defaultParams: { lineStagger: 0.12, overshoot: 0, direction: 'up' },
    loop: false,
  },
  {
    id: 'community/elastic-word-pop',
    label: 'Elastic Word Pop',
    description: 'Words elastic-bounce in with alternating kick',
    sourcePen: 'https://codepen.io/GreenSock/pen/WNjYLXo',
    slot: 'in',
    defaultParams: { wordStagger: 0.08, amplitude: 1.0, period: 0.35, kick: 6 },
    loop: false,
  },
  {
    id: 'community/focus-blur-in',
    label: 'Focus Blur In',
    description: 'Defocused blur and wide tracking collapse to sharp',
    sourcePen: 'https://codepen.io/GreenSock/pen/PomrLzv',
    slot: 'in',
    defaultParams: { maxBlur: 12, maxTracking: 0.4, startOpacity: 0, zoom: 0.06 },
    loop: false,
  },
  {
    id: 'community/char-drop-tumble',
    label: 'Char Drop Tumble',
    description: 'Characters drop from above with seeded tumble rotation',
    sourcePen: 'https://codepen.io/GreenSock/pen/GRJwLNP',
    slot: 'in',
    defaultParams: { charStagger: 0.04, dropHeight: 1.2, spread: 0.4, maxRot: 40 },
    loop: false,
  },
  {
    id: 'community/shimmer-gradient',
    label: 'Shimmer Gradient',
    description: 'Animated gradient fill phase scrolls across text',
    sourcePen: 'https://codepen.io/GreenSock/pen/jOBMGWB',
    slot: 'loop',
    defaultParams: { angle: 90, speed: 0.5, scale: 1.5 },
    loop: true,
  },
  {
    id: 'community/jelly-squash',
    label: 'Jelly Squash',
    description: 'Per-letter non-uniform scale jelly wave',
    sourcePen: 'https://codepen.io/johanmouchet/pen/qBbRRJP',
    slot: 'loop',
    defaultParams: { amplitude: 0.18, couple: 0.7, speed: 1.2, phaseStep: 0.5, anchor: 'bottom' },
    loop: true,
  },
  {
    id: 'community/neon-flicker',
    label: 'Neon Flicker',
    description: 'Startup flicker sequence transitioning to neon hum glow',
    sourcePen: 'https://codepen.io/P1N2O/pen/pyBNzX',
    slot: 'in',
    defaultParams: { startup: 0.5, humHz: 0.6, humDepth: 0.12, seed: 'default' },
    loop: false,
  },
  {
    id: 'community/liquid-fill',
    label: 'Liquid Fill',
    description: 'Wavy animated fill surface rises to fill text',
    sourcePen: 'https://codepen.io/Alca/pen/VwwzKXo',
    slot: 'reveal',
    defaultParams: { fillColor: '#19a0ff', emptyStyle: 'outline', waveAmp: 0.06, waveLen: 1.5, waveSpeed: 0.6 },
    loop: false,
  },
  {
    id: 'community/particle-assemble',
    label: 'Particle Assemble',
    description: 'Seeded particles converge from scatter to form glyphs',
    sourcePen: 'https://codepen.io/GreenSock/pen/eYdyVVe',
    slot: 'reveal',
    defaultParams: { density: 1, scatter: 2.5, dotSize: 2, converge: 0.8, solidify: true, seed: 'clipId' },
    loop: false,
  },
  {
    id: 'community/perspective-slam',
    label: 'Perspective Slam',
    description: 'Words slam in with perspective depth and motion blur',
    sourcePen: 'https://codepen.io/GreenSock/pen/oNXxYMe',
    slot: 'in',
    defaultParams: { unit: 'word', startZ: -800, startRotX: 35, startSkew: 8, overshoot: 1.2, maxBlur: 8, slamStagger: 0.06 },
    loop: false,
  },
  {
    id: 'community/variable-weight-wave',
    label: 'Variable Weight Wave',
    description: 'Variable-font wght axis waves across text letters',
    sourcePen: 'https://codepen.io/GreenSock/pen/BaoBgmP',
    slot: 'loop',
    defaultParams: { wghtMin: 200, wghtMax: 800, wdthMin: 100, wdthMax: 100, speed: 0.7, phaseStep: 0.6 },
    loop: true,
  },
]

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

let _registered = false

/**
 * Register all 17 community presets into the existing animation + reveal registries
 * under the `"community/"` namespace. Idempotent — safe to call multiple times.
 * Auto-called on module import.
 */
export function registerCommunityAnimations(): void {
  if (_registered) return
  _registered = true

  // P8C.2 — wave-ripple (loop)
  registerAnimPreset('loop', 'community/wave-ripple', waveRippleLoop)

  // P8C.3 — glitch-split (in)
  registerAnimPreset('in', 'community/glitch-split', glitchSplitIn)

  // P8C.4 — typewriter-caret (reveal) — delegates to existing typeEffect
  registerRevealEffect('community/typewriter-caret', typeEffect)

  // P8C.5 — kinetic-3d (in + loop)
  registerAnimPreset('in', 'community/kinetic-3d', kinetic3dIn)
  registerAnimPreset('loop', 'community/kinetic-3d', kinetic3dLoop)

  // P8C.6 — scramble-decode (in)
  registerAnimPreset('in', 'community/scramble-decode', scrambleDecodeIn)

  // P8C.7 — gloss-sweep (reveal loop) — delegates to existing glossyEffect
  registerRevealEffect('community/gloss-sweep', glossyEffect)

  // P8C.8 — mask-line-rise (reveal)
  registerRevealEffect('community/mask-line-rise', maskLineRiseEffect)

  // P8C.9 — elastic-word-pop (in)
  registerAnimPreset('in', 'community/elastic-word-pop', elasticWordPopIn)

  // P8C.10 — focus-blur-in (in)
  registerAnimPreset('in', 'community/focus-blur-in', focusBlurIn)

  // P8C.11 — char-drop-tumble (in)
  registerAnimPreset('in', 'community/char-drop-tumble', charDropTumbleIn)

  // P8C.12 — shimmer-gradient (loop)
  registerAnimPreset('loop', 'community/shimmer-gradient', shimmerGradientLoop)

  // P8C.13 — jelly-squash (loop)
  registerAnimPreset('loop', 'community/jelly-squash', jellySquashLoop)

  // P8C.14 — neon-flicker (in)
  registerAnimPreset('in', 'community/neon-flicker', neonFlickerIn)

  // P8C.15 — liquid-fill (reveal)
  registerRevealEffect('community/liquid-fill', liquidFillEffect)

  // P8C.16 — particle-assemble (reveal)
  registerRevealEffect('community/particle-assemble', particleAssembleEffect)

  // P8C.17 — perspective-slam (in)
  registerAnimPreset('in', 'community/perspective-slam', perspectiveSlamIn)

  // P8C.18 — variable-weight-wave (loop)
  registerAnimPreset('loop', 'community/variable-weight-wave', variableWeightWaveLoop)
}

// Auto-register on import (idempotent — safe for HMR / multiple imports).
registerCommunityAnimations()

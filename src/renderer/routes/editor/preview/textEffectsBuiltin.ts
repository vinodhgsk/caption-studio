/**
 * Built-in effect-renderer registration (P7.1/P7.2 — Doc 04; skill `text-render`).
 *
 * This is the ONE module BOTH the preview (`PreviewCanvas`) AND the export engine
 * import to populate the {@link registerEffectRenderer} registry, so neither side
 * can drift in WHICH effects exist (export parity, master plan §6). P7.2–P7.6 add
 * their renderers here (glow/neon → P7.2, glitch → P7.3, 3d/retro/blur/echo → P7.4),
 * keeping every effect's paint in the headless-importable render layer.
 *
 * P7.1 shipped ONE proof renderer (`blur`) to demonstrate the stack composes; P7.6
 * UPGRADES it to a real layered Gaussian-style blur (filter path + low-alpha ring
 * fallback) and adds the `echo`/double-exposure renderer (offset translucent copies).
 * P7.2 adds the two LUMINOUS effects — `glow` and `neon` — both built on the same
 * "shadow-as-bloom" technique (paint the glyph with `ctx.shadowColor`/`shadowBlur`
 * set so the glyph casts a soft colored halo, no offset).
 * P7.3 adds `glitch` — an RGB CHANNEL SPLIT (chromatic aberration: the glyph
 * re-stamped in pure R/G/B offset along `angle` by splitDistance*intensity and
 * composited with an additive `lighter` blend) PLUS a DETERMINISTIC seeded
 * scanline/jitter modulation driven by `frequency`. P7.4 adds `3d` (extruded offset
 * wall) and `retro` (palette + grain + chroma). With P7.6 every Doc 04 type now has a
 * renderer — none stay unregistered.
 *
 * DETERMINISM (parity-check skill): the glitch jitter is NEVER `Math.random`/`Date`.
 * It is a SEEDED PRNG ({@link mulberry32}) keyed by the token's stable identity
 * ({@link hashSeed} of `token.text`), so the SAME token renders the SAME glitch in
 * preview and in the headless export (master plan §6 parity).
 *
 * PARAM→CANVAS MATH is centralized in the small PURE helpers below
 * ({@link resolveGlowBlur}, {@link resolveNeonBlur}, {@link withAlpha},
 * {@link clamp01}) so the renderers stay thin canvas calls and the math is unit
 * testable without a canvas. Each renderer RESTORES every `ctx.shadow*` /
 * `globalAlpha` it touches (its own `save()/restore()`) so the bloom never leaks
 * into the next effect or the highlight overlay.
 *
 * IDEMPOTENT: {@link registerBuiltinEffects} can be called many times (each side at
 * startup, tests between cases) — re-registration just overwrites with the same fn.
 */
import { registerEffectRenderer } from './textEffectsPipeline'
import type { GlyphToken } from './textPaintPipeline'
import type { ShadowOffset } from './textShadowSpec'

// ───────────────────────────────────────────────────────────────────────────
// PURE param→canvas helpers (no canvas, no DOM — unit-testable on their own).
// ───────────────────────────────────────────────────────────────────────────

/** Clamp a value into 0..1 (used for the per-pass alpha math). */
export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}

/**
 * Resolve a GLOW's effective blur radius in CSS px: `radius * intensity`, floored
 * at 0 (a negative/NaN radius or zero intensity → 0 → the renderer no-ops). This is
 * the single place the glow "amount" slider (intensity) scales the halo size.
 */
export function resolveGlowBlur(radius: number, intensity: number): number {
  const r = Number.isFinite(radius) ? radius : 0
  const i = clamp01(intensity)
  return Math.max(0, r * i)
}

/**
 * Resolve a NEON's outer-bloom blur radius in CSS px. Same `radius * intensity` as
 * glow — the neon's distinguishing look comes from the extra bright CORE drawn on
 * top, not from a different bloom formula.
 */
export function resolveNeonBlur(radius: number, intensity: number): number {
  return resolveGlowBlur(radius, intensity)
}

/**
 * Resolve a NEON's effective inner-core line width in CSS px: `core * intensity`,
 * floored at 0. The core is the crisp bright tube edge drawn over the bloom; at
 * intensity 0 it collapses to 0 (no core) alongside the (also-0) bloom.
 */
export function resolveNeonCore(core: number, intensity: number): number {
  const c = Number.isFinite(core) ? core : 0
  const i = clamp01(intensity)
  return Math.max(0, c * i)
}

// ───────────────────────────────────────────────────────────────────────────
// GLITCH (P7.3): RGB channel split + scanline/jitter helpers (PURE).
//
// PARITY NOTE: preview MUST equal export (master plan §6, parity-check skill). So
// every "random" wobble here is DETERMINISTIC — derived from a SEEDED PRNG keyed
// by STABLE inputs (the token text + integer position). The SAME token renders the
// SAME glitch in preview and in the headless export. No Math.random, no Date.
// ───────────────────────────────────────────────────────────────────────────

/** A single channel's planar offset (px) from the glyph origin. */
export interface ChannelOffset {
  /** Which RGB channel this layer isolates. */
  channel: 'r' | 'g' | 'b'
  /** Horizontal offset in px (signed). */
  dx: number
  /** Vertical offset in px (signed). */
  dy: number
}

/**
 * Compute the THREE RGB-split channel offsets for the classic chromatic-aberration
 * look. The split MAGNITUDE is `splitDistance * intensity` (the intensity slider
 * scales severity); the direction is `angle` degrees. The RED channel is pushed
 * one way, the BLUE channel the OPPOSITE way, and GREEN stays centered — so the
 * colored fringes show on either side of the glyph. PURE + testable.
 *
 *   angle 0   → red +x, blue -x  (horizontal split, the classic look)
 *   angle 90  → red +y, blue -y  (vertical split)
 *
 * `splitDistance` 0 OR `intensity` 0 → all three offsets are (0,0) (no split).
 */
export function resolveChannelOffsets(
  splitDistance: number,
  intensity: number,
  angleDeg: number
): ChannelOffset[] {
  const d = Number.isFinite(splitDistance) ? Math.max(0, splitDistance) : 0
  const i = clamp01(intensity)
  const mag = d * i
  const rad = (Number.isFinite(angleDeg) ? angleDeg : 0) * (Math.PI / 180)
  const ux = Math.cos(rad)
  const uy = Math.sin(rad)
  // Round to avoid sub-pixel float dust differing between platforms (parity).
  const dx = round3(mag * ux)
  const dy = round3(mag * uy)
  return [
    { channel: 'r', dx, dy },
    { channel: 'g', dx: 0, dy: 0 },
    { channel: 'b', dx: round3(-dx), dy: round3(-dy) }
  ]
}

/** Round to 3 decimals — kills cross-platform float dust so parity holds. Also
 * normalizes -0 → 0 so opposite-channel offsets read clean (no signed zero). */
function round3(v: number): number {
  const r = Math.round(v * 1000) / 1000
  return r === 0 ? 0 : r
}

/**
 * The per-channel canvas fill color that ISOLATES one RGB channel. Painting the
 * glyph in pure red / green / blue and compositing the three with a `lighter`
 * (additive) blend reconstructs the split: where the offsets overlap the channels
 * sum back to (near) the original, and where they don't the lone-channel fringe
 * shows. PURE.
 */
export function channelFillColor(channel: 'r' | 'g' | 'b', alpha: number): string {
  const a = clamp01(alpha)
  if (channel === 'r') return `rgba(255, 0, 0, ${a})`
  if (channel === 'g') return `rgba(0, 255, 0, ${a})`
  return `rgba(0, 0, 255, ${a})`
}

/**
 * A tiny DETERMINISTIC string→32-bit hash (FNV-1a). Used to seed the jitter PRNG
 * from the token's STABLE identity (its text), so the seed is the same in preview
 * and export. PURE.
 */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5
  for (let k = 0; k < text.length; k++) {
    h ^= text.charCodeAt(k)
    // FNV prime multiply, kept in 32-bit via Math.imul.
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * A DETERMINISTIC PRNG (mulberry32). Given a seed it returns a function producing a
 * repeatable sequence of floats in [0,1). SAME seed → SAME sequence (the property
 * the parity tests assert); different seeds diverge. PURE — no Math.random, no Date,
 * no shared mutable global. This is what makes the jitter parity-safe: the export
 * engine seeds it from the same token identity and gets pixel-identical wobble.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A single seeded scanline displacement: the band's vertical center + its shove. */
export interface ScanlineJitter {
  /** Fractional vertical position 0..1 of the band's center. */
  at: number
  /** Signed horizontal shove in px for the band (bounded by maxShift). */
  shift: number
}

/**
 * Build the DETERMINISTIC scanline jitter bands for a token. `frequency` sets HOW
 * MANY bands (busier distortion) and the per-band horizontal `shift` is bounded by
 * `maxShift = splitDistance * intensity` (so jitter never exceeds the split scale)
 * and scaled by intensity. The bands are produced from a {@link mulberry32} stream
 * seeded by the token's stable identity — same token ⇒ same bands in preview and
 * export. PURE.
 *
 * `frequency` 0 OR `intensity` 0 → no bands (empty array → no jitter).
 */
export function resolveScanlineJitter(
  seed: number,
  frequency: number,
  intensity: number,
  maxShift: number
): ScanlineJitter[] {
  const i = clamp01(intensity)
  const f = Number.isFinite(frequency) ? Math.max(0, frequency) : 0
  const bound = Number.isFinite(maxShift) ? Math.max(0, maxShift) : 0
  // Number of bands = floor(frequency) scaled by intensity; at least 0.
  const count = Math.floor(f * i)
  if (count <= 0 || bound <= 0) return []
  const rng = mulberry32(seed)
  const bands: ScanlineJitter[] = []
  for (let b = 0; b < count; b++) {
    const at = round3(rng())
    // rng()*2-1 ∈ [-1,1) → signed shove bounded by ±bound, scaled by intensity.
    const shift = round3((rng() * 2 - 1) * bound * i)
    bands.push({ at, shift })
  }
  return bands
}

/**
 * Hex color → an `rgba()` string at `alpha` (0..1). Accepts `#rgb`, `#rgba`,
 * `#rrggbb`, `#rrggbbaa`; an existing alpha in the hex is MULTIPLIED by `alpha`.
 * Anything unparseable falls back to the hex itself (canvas still accepts a named/
 * hex color; we just can't fold alpha in). PURE.
 */
export function withAlpha(hex: string, alpha: number): string {
  const a = clamp01(alpha)
  const m = /^#([0-9a-fA-F]{3,8})$/.exec(hex)
  if (!m) return hex
  const h = m[1]
  let r: number
  let g: number
  let b: number
  let baseA = 1
  if (h.length === 3 || h.length === 4) {
    r = parseInt(h[0] + h[0], 16)
    g = parseInt(h[1] + h[1], 16)
    b = parseInt(h[2] + h[2], 16)
    if (h.length === 4) baseA = parseInt(h[3] + h[3], 16) / 255
  } else if (h.length === 6 || h.length === 8) {
    r = parseInt(h.slice(0, 2), 16)
    g = parseInt(h.slice(2, 4), 16)
    b = parseInt(h.slice(4, 6), 16)
    if (h.length === 8) baseA = parseInt(h.slice(6, 8), 16) / 255
  } else {
    return hex
  }
  const finalA = clamp01(baseA * a)
  return `rgba(${r}, ${g}, ${b}, ${finalA})`
}

// ───────────────────────────────────────────────────────────────────────────
// 3D DEPTH (P7.4): extruded offset layers (PURE step generator).
//
// A 3D extrude is conceptually the SAME stepped-offset trail as a long shadow
// (textShadowSpec.longShadowSteps): a stack of SOLID glyph copies, each nudged a
// little further along the extrude `angle`, painted FARTHEST-first so the face
// glyph sits on top of the side wall. Where this differs from a long shadow:
//   - the slider is a STEP COUNT (`depth`), not a px `length` — `depth` integer
//     copies are drawn one px-step apart (scaled by intensity), so the slider maps
//     directly to "how thick the extrusion reads";
//   - each step optionally carries a `shade` 0..1 that DARKENS the side color with
//     depth (the back of the wall is darker than the front) for a lit 3D look.
// Keeping this as its own PURE generator (rather than calling longShadowSteps)
// lets us attach per-step shading and a count-driven depth while still MIRRORING
// the long-shadow geometry (same unit-direction math, same farthest-first order).
// ───────────────────────────────────────────────────────────────────────────

/** One extrude layer: a planar offset (font-px) from the glyph origin + its shade. */
export interface ExtrudeStep extends ShadowOffset {
  /**
   * Shade factor 0..1 used to DARKEN the side color for this step (0 = blackest /
   * farthest back, 1 = full side color / nearest the face). Pure data; the renderer
   * multiplies the side color's RGB by this to fake directional lighting on the wall.
   */
  shade: number
}

/** Per-step px spacing of the extrude wall — small so the solid copies overlap into
 * a continuous wall at typical caption font sizes (mirrors LONG_SHADOW_STEP_PX). */
export const EXTRUDE_STEP_PX = 1

/**
 * PURE step generator for the 3D extrude wall. `depth` is the number of side copies
 * to stack; it is SCALED by `intensity` (`floor(depth * intensity)`) so the master
 * "amount" slider thins/thickens the extrusion (and intensity 0 → no wall). Each
 * step k = 1..count is offset `k * {@link EXTRUDE_STEP_PX}` px along `angleDeg`
 * (same convention as the shadow/long-shadow angle: 0°→right, 90°→down, ±180°→left,
 * 45°→down-right), and the list is returned FARTHEST-first (largest offset → 1) so
 * the caller paints back-to-front, the face glyph landing on top.
 *
 * SHADING: each step carries a `shade` 0..1 that rises from the back of the wall to
 * the front — `shade[k] = k / count` — so the renderer can darken the farthest
 * copies (a lit 3D side). The NEAREST step (k = count) is `shade = 1` (full side
 * color); the farthest (k = 1) is the darkest. Single-step walls get `shade = 1`.
 *
 * Degenerate inputs → EMPTY list (no wall): depth <= 0, intensity <= 0, or a
 * non-finite angle/depth (count floors to 0). Headless + deterministic (no random).
 */
export function extrudeSteps(angleDeg: number, depth: number, intensity: number): ExtrudeStep[] {
  const d = Number.isFinite(depth) && depth > 0 ? depth : 0
  const i = clamp01(intensity)
  const count = Math.floor(d * i)
  if (count <= 0) return []
  const rad = ((Number.isFinite(angleDeg) ? angleDeg : 0) * Math.PI) / 180
  // Snap axis-aligned components clean (mirrors longShadowSteps) so a 0/90/180/-90
  // angle yields exactly-axis offsets with no float dust (parity).
  const snap = (v: number): number => (Math.abs(v) < 1e-9 ? 0 : round3(v))
  const ux = snap(Math.cos(rad))
  const uy = snap(Math.sin(rad))
  const steps: ExtrudeStep[] = []
  // Farthest-first: k = count down to 1 so the caller paints back-to-front. Shade
  // RISES toward the front: the farthest copy (k = count) is darkest, the nearest
  // (k = 1) is full side color (shade 1) — a lit wall (back darker than front).
  for (let k = count; k >= 1; k--) {
    const dist = k * EXTRUDE_STEP_PX
    const shade = round3((count - k + 1) / count)
    steps.push({ x: round3(ux * dist), y: round3(uy * dist), shade })
  }
  return steps
}

/**
 * Hex side color DARKENED by a `shade` factor 0..1 (multiplies RGB by `shade`) and
 * emitted as an `rgba()` at `alpha`. `shade` 1 → the side color unchanged; `shade`
 * 0 → black. Used to fake directional lighting down the extrude wall (back darker
 * than front). Unparseable hex falls back to {@link withAlpha} (no shading). PURE.
 */
export function shadeColor(hex: string, shade: number, alpha: number): string {
  const s = clamp01(shade)
  const a = clamp01(alpha)
  const m = /^#([0-9a-fA-F]{3,8})$/.exec(hex)
  if (!m) return withAlpha(hex, alpha)
  const h = m[1]
  let r: number
  let g: number
  let b: number
  let baseA = 1
  if (h.length === 3 || h.length === 4) {
    r = parseInt(h[0] + h[0], 16)
    g = parseInt(h[1] + h[1], 16)
    b = parseInt(h[2] + h[2], 16)
    if (h.length === 4) baseA = parseInt(h[3] + h[3], 16) / 255
  } else if (h.length === 6 || h.length === 8) {
    r = parseInt(h.slice(0, 2), 16)
    g = parseInt(h.slice(2, 4), 16)
    b = parseInt(h.slice(4, 6), 16)
    if (h.length === 8) baseA = parseInt(h.slice(6, 8), 16) / 255
  } else {
    return withAlpha(hex, alpha)
  }
  const finalA = clamp01(baseA * a)
  return `rgba(${Math.round(r * s)}, ${Math.round(g * s)}, ${Math.round(b * s)}, ${finalA})`
}

// ───────────────────────────────────────────────────────────────────────────
// RETRO / VINTAGE (P7.4): warm palette tint + deterministic film grain +
// SLIGHT chroma shift (PURE resolvers).
//
// A retro look layers three small graded passes over the glyph:
//   1. PALETTE TINT — re-stamp the glyph in the palette `color` at a fractional
//      alpha (`resolvePaletteTint`) so the glyph reads graded TOWARD the warm
//      vintage hue (a translucent color wash), not fully replaced. The grade
//      strength scales with intensity.
//   2. FILM GRAIN — a sprinkle of tiny deterministic speckles
//      (`resolveGrainSpeckles`) over the glyph box. Count scales by grain*intensity;
//      positions/alpha come from a SEEDED mulberry32 stream keyed by the token's
//      stable identity (hashSeed(token.text)) so preview == export (NO Math.random/
//      Date). This is the SAME PRNG the glitch jitter uses (reused, not forked).
//   3. SLIGHT CHROMA — a small R/B split (`resolveChromaOffsets`) for subtle color
//      fringing. DELIBERATELY SMALLER than the glitch split for comparable params:
//      scaled by RETRO_CHROMA_FACTOR (< 1), so retro reads as gentle aberration
//      rather than the harsh glitch tear.
// All three resolve PURE + are unit-testable without a canvas; the renderer stays a
// thin sequence of canvas stamps inside its own save()/restore().
// ───────────────────────────────────────────────────────────────────────────

/**
 * How much SMALLER the retro chroma split is than the glitch split for the same
 * px/intensity input. Retro is a SUBTLE aberration, so its split magnitude is this
 * fraction (< 1) of what {@link resolveChannelOffsets} would produce for the same
 * distance — the parity tests assert retro split < glitch split for comparable params.
 */
export const RETRO_CHROMA_FACTOR = 0.4

/** A retro speckle: a tiny grain dot at a fractional box position with an alpha. */
export interface GrainSpeckle {
  /** Fractional horizontal position 0..1 across the glyph box. */
  fx: number
  /** Fractional vertical position 0..1 across the glyph box. */
  fy: number
  /** Speckle alpha 0..1 (how visible this grain dot is). */
  alpha: number
}

/**
 * Resolve the PALETTE-TINT alpha: how strongly the glyph is graded toward the
 * vintage `color`. The grade is `intensity` scaled by a fixed ceiling so even full
 * intensity is a translucent WASH (the glyph keeps its body, just warms toward the
 * palette) rather than an opaque recolor. `intensity` 0 → 0 (no tint). PURE.
 */
export function resolvePaletteTintAlpha(intensity: number): number {
  // Ceiling < 1 so the tint never fully replaces the glyph color — it grades toward
  // the palette. Rounded so the alpha is parity-stable across platforms.
  return round3(clamp01(intensity) * 0.65)
}

/**
 * The palette-tint FILL color: the vintage `color` at the resolved tint alpha
 * (folded with the pass `baseAlpha` from the pipeline's globalAlpha). At
 * `intensity` 0 the alpha is 0 → a transparent (no-op) wash. PURE — thin wrapper
 * over {@link withAlpha} + {@link resolvePaletteTintAlpha}.
 */
export function resolvePaletteTintColor(color: string, intensity: number, baseAlpha: number): string {
  const tint = resolvePaletteTintAlpha(intensity)
  return withAlpha(color, tint * clamp01(baseAlpha))
}

/**
 * Build the DETERMINISTIC film-grain speckles for a token. The number of speckles is
 * `floor(grain * intensity * GRAIN_DENSITY)` (so the `grain` slider AND the master
 * intensity both scale how much grain shows); each speckle's fractional position +
 * alpha come from a {@link mulberry32} stream seeded by the token's stable identity —
 * SAME token + params ⇒ SAME speckle pattern in preview and export (parity-safe; no
 * Math.random/Date). PURE.
 *
 * `grain` 0 OR `intensity` 0 → no speckles (empty array → no grain).
 */
export const GRAIN_DENSITY = 40

export function resolveGrainSpeckles(
  seed: number,
  grain: number,
  intensity: number
): GrainSpeckle[] {
  const g = Number.isFinite(grain) ? clamp01(grain) : 0
  const i = clamp01(intensity)
  const count = Math.floor(g * i * GRAIN_DENSITY)
  if (count <= 0) return []
  const rng = mulberry32(seed)
  const speckles: GrainSpeckle[] = []
  for (let k = 0; k < count; k++) {
    const fx = round3(rng())
    const fy = round3(rng())
    // Per-speckle alpha 0.3..0.6 (a soft grain fleck), scaled by grain so heavier
    // grain reads denser AND a touch stronger. Bounded + rounded for parity.
    const alpha = round3((0.3 + rng() * 0.3) * g)
    speckles.push({ fx, fy, alpha })
  }
  return speckles
}

/**
 * Resolve the retro SLIGHT-chroma channel offsets — a small R/B split (green
 * centered) for subtle vintage fringing. It REUSES the glitch split math
 * ({@link resolveChannelOffsets}) but with the distance pre-scaled by
 * {@link RETRO_CHROMA_FACTOR} (< 1), so the retro split is strictly SMALLER than the
 * glitch split for the SAME `chroma`/`intensity`/`angle`. `chroma` 0 OR `intensity` 0
 * → all offsets (0,0) (no fringing). PURE.
 */
export function resolveChromaOffsets(
  chroma: number,
  intensity: number,
  angleDeg = 0
): ChannelOffset[] {
  const c = Number.isFinite(chroma) ? Math.max(0, chroma) : 0
  return resolveChannelOffsets(c * RETRO_CHROMA_FACTOR, intensity, angleDeg)
}

// ───────────────────────────────────────────────────────────────────────────
// BLUR (P7.6): layered Gaussian-style blur of the glyph layer (PURE resolver).
//
// PARAM→PX is a single pure fn ({@link resolveBlurRadius}): the blurred copy uses
// `radius * intensity` CSS px (the master "amount" slider scales how soft the blur
// reads); a negative/NaN radius or zero intensity → 0 → the renderer no-ops.
//
// TWO RENDER PATHS (documented at the renderer):
//   1. FILTER path (preferred): a real Gaussian via `ctx.filter = blur(Npx)`. This is
//      what a real canvas (and the headless `skia-canvas`/`@napi-rs/canvas` export
//      backends) apply, so preview == export when the backend supports `filter`.
//   2. FALLBACK path: when `ctx.filter` is unavailable/unsupported, approximate a
//      Gaussian by stamping the glyph at several small ring offsets at LOW alpha
//      ({@link blurFallbackOffsets}) so the overlapping translucent copies smear into
//      a soft blob. PURE + deterministic (fixed ring geometry, no random).
// ───────────────────────────────────────────────────────────────────────────

/**
 * Resolve a BLUR's effective radius in CSS px: `radius * intensity`, floored at 0
 * (negative/NaN radius or zero intensity → 0 → no-op). The single place the blur
 * "amount" slider (intensity) scales the softness. PURE.
 */
export function resolveBlurRadius(radius: number, intensity: number): number {
  const r = Number.isFinite(radius) ? radius : 0
  const i = clamp01(intensity)
  return Math.max(0, r * i)
}

/** A fallback blur sample: a planar offset (px) from the glyph origin + its alpha. */
export interface BlurSample {
  /** Horizontal offset in px (signed). */
  x: number
  /** Vertical offset in px (signed). */
  y: number
  /** Per-sample alpha 0..1 (low, so the overlapping copies sum into a soft blob). */
  alpha: number
}

/** How many points around each ring of the fallback blur (8 = octagonal smear). */
export const BLUR_FALLBACK_SPOKES = 8
/** How many concentric rings the fallback blur stamps (scaled samples per radius). */
export const BLUR_FALLBACK_RINGS = 2

/**
 * Approximate a Gaussian blur of radius `r` (px) as a set of LOW-alpha glyph stamps
 * arranged on concentric rings around the origin (plus the center). With no real
 * `ctx.filter`, painting the glyph at each of these offsets at a small alpha makes the
 * overlapping translucent copies smear into a soft blob — a cheap Gaussian stand-in.
 * The center sample is brightest; the ring samples fade with distance. PURE +
 * deterministic (fixed angular geometry, no random) so preview == export on a backend
 * without `filter`. `r <= 0` → empty (no-op).
 */
export function blurFallbackOffsets(r: number): BlurSample[] {
  const radius = Number.isFinite(r) ? Math.max(0, r) : 0
  if (radius <= 0) return []
  const samples: BlurSample[] = []
  // Center sample (the core of the blob) at a modest alpha.
  samples.push({ x: 0, y: 0, alpha: round3(0.5) })
  for (let ring = 1; ring <= BLUR_FALLBACK_RINGS; ring++) {
    const dist = (radius * ring) / BLUR_FALLBACK_RINGS
    // Outer rings are dimmer (Gaussian tails) — alpha decays with the ring index.
    const ringAlpha = round3(0.25 / ring)
    for (let s = 0; s < BLUR_FALLBACK_SPOKES; s++) {
      const ang = (s / BLUR_FALLBACK_SPOKES) * Math.PI * 2
      samples.push({
        x: round3(Math.cos(ang) * dist),
        y: round3(Math.sin(ang) * dist),
        alpha: ringAlpha
      })
    }
  }
  return samples
}

// ───────────────────────────────────────────────────────────────────────────
// ECHO / DOUBLE-EXPOSURE (P7.6): offset translucent copies trailing the glyph
// (PURE copy generator).
//
// An echo is the SAME stepped-offset trail geometry as a long shadow / the 3D
// extrude wall (longShadowSteps / extrudeSteps): `count` glyph copies, each nudged a
// little further along `angle`, painted FARTHEST-first so the nearest copy sits just
// behind the face. Where it differs: each copy is TRANSLUCENT and its alpha DECAYS
// per copy by `falloff` (a motion-echo / double-exposure look), and the spacing is a
// `distance` px step (not a px length). Keeping it a PURE generator
// ({@link echoCopies}) mirrors the long-shadow geometry while attaching the per-copy
// decaying alpha — unit-testable without a canvas, deterministic (no random).
// ───────────────────────────────────────────────────────────────────────────

/** One echo copy: a planar offset (px) from the glyph origin + its alpha. */
export interface EchoCopy {
  /** Horizontal offset in px (signed). */
  x: number
  /** Vertical offset in px (signed). */
  y: number
  /** Copy alpha 0..1 — decays per copy by `falloff` (farther = fainter). */
  alpha: number
}

/**
 * PURE generator for the ECHO / double-exposure copies. `count` translucent glyph
 * copies are stepped `distance` px apart along `angleDeg` (same angle convention as
 * the shadow/extrude: 0°→right, 90°→down, ±180°→left, 45°→down-right). `count` is
 * SCALED by `intensity` (`floor(count * intensity)`) so the master "amount" slider
 * thins/thickens the trail (and intensity 0 → no copies).
 *
 * ALPHA DECAY: copy k = 1..count (1 = nearest the face, count = farthest) fades by
 * `falloff` per step — `alpha[k] = falloff^k` — so the nearest copy is brightest and
 * each successive copy is `falloff`× fainter (a motion echo). `falloff` is clamped to
 * 0..1; every alpha is bounded to 0..1.
 *
 * ORDER: returned FARTHEST-first (k = count down to 1) so the caller paints
 * back-to-front (each closer/brighter copy lands on top of the farther/fainter ones),
 * the face glyph landing on top of all of them.
 *
 * Degenerate inputs → EMPTY list (no echo): count <= 0, distance <= 0, intensity <= 0,
 * falloff <= 0 (every copy would be invisible), or a non-finite angle/count/distance.
 * Deterministic (no random) so preview == export.
 */
export function echoCopies(
  count: number,
  distance: number,
  angleDeg: number,
  falloff: number,
  intensity: number
): EchoCopy[] {
  const c = Number.isFinite(count) && count > 0 ? count : 0
  const d = Number.isFinite(distance) && distance > 0 ? distance : 0
  const i = clamp01(intensity)
  const f = clamp01(falloff)
  const n = Math.floor(c * i)
  // distance 0 / count 0 / intensity 0 / falloff 0 → nothing visible → empty (no-op).
  if (n <= 0 || d <= 0 || f <= 0) return []
  const rad = ((Number.isFinite(angleDeg) ? angleDeg : 0) * Math.PI) / 180
  // Snap axis-aligned components clean (mirrors extrudeSteps/longShadowSteps) so a
  // 0/90/180/-90 angle yields exactly-axis offsets with no float dust (parity).
  const snap = (v: number): number => (Math.abs(v) < 1e-9 ? 0 : round3(v))
  const ux = snap(Math.cos(rad))
  const uy = snap(Math.sin(rad))
  const copies: EchoCopy[] = []
  // Farthest-first: k = n down to 1 so the caller paints back-to-front. The nearest
  // copy (k = 1) is brightest (falloff^1); the farthest (k = n) is faintest (falloff^n).
  for (let k = n; k >= 1; k--) {
    const dist = k * d
    const alpha = clamp01(round3(Math.pow(f, k)))
    copies.push({ x: round3(ux * dist), y: round3(uy * dist), alpha })
  }
  return copies
}

// ───────────────────────────────────────────────────────────────────────────
// Registration.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Register every built-in effect renderer into the process-global registry. Safe to
 * call repeatedly. Call ONCE at renderer startup and once in the export engine setup.
 */
export function registerBuiltinEffects(): void {
  // ── BLUR (P7.6): real layered Gaussian-style blur of the glyph ────────────
  // P7.1 shipped a PROOF blur here; P7.6 UPGRADES it to a real, headless-parity blur.
  // PARAM→PX is the pure resolveBlurRadius (`radius * intensity`); two render paths:
  //
  //   1. FILTER path (preferred): set `ctx.filter = blur(Npx)` and re-stamp the glyph,
  //      so a real Gaussian softens the copy. This is what a real canvas + the export
  //      backends that support `filter` apply, so preview == export there.
  //   2. FALLBACK path: when `ctx.filter` is missing/unsupported, stamp the glyph at
  //      the LOW-alpha ring offsets from blurFallbackOffsets — the overlapping
  //      translucent copies smear into a soft blob (a deterministic Gaussian stand-in).
  //
  // The blurred copy is composited BEHIND the (already-painted) face glyph with
  // 'destination-over' so the soft blur reads as a halo under the crisp text rather
  // than overpainting it. Opacity rides the pipeline's globalAlpha. Every filter /
  // composite / alpha touch is scoped in save()/restore() and we RESET ctx.filter to
  // 'none' explicitly so the blur never leaks into the next effect or the highlight.
  registerEffectRenderer('blur', (ctx, token, params, context) => {
    const radius = resolveBlurRadius(params.radius, context.intensity)
    if (radius <= 0) return // radius 0 / intensity 0 → true no-op.
    ctx.save()
    // Drop the blurred copy UNDER the existing pixels (the crisp face stays on top).
    ctx.globalCompositeOperation = 'destination-over'

    // Detect a usable `ctx.filter`: setting it must "stick" (a stub ctx that ignores
    // the setter, or one without the property, reads back unchanged → use the fallback).
    let filterOk = false
    try {
      ctx.filter = `blur(${radius}px)`
      filterOk = ctx.filter === `blur(${radius}px)`
    } catch {
      filterOk = false
    }

    if (filterOk) {
      // FILTER path: one re-stamp under the real Gaussian filter.
      ctx.fillText(token.text, token.x, token.y)
    } else {
      // FALLBACK path: low-alpha ring stamps smear into a soft blob. Make sure no
      // stale/partial filter is applied, then accumulate the samples at their alphas.
      try {
        ctx.filter = 'none'
      } catch {
        /* no filter support at all — the ring stamps alone still read as a blur */
      }
      const baseAlpha = ctx.globalAlpha
      for (const sample of blurFallbackOffsets(radius)) {
        ctx.globalAlpha = clamp01(baseAlpha * sample.alpha)
        ctx.fillText(token.text, token.x + sample.x, token.y + sample.y)
      }
      ctx.globalAlpha = baseAlpha
    }

    // Reset filter + composite explicitly (restore() also reverts them) so the blur
    // never leaks into the next effect or the highlight overlay.
    try {
      ctx.filter = 'none'
    } catch {
      /* no-op on a ctx without filter support */
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.restore()
  })

  // ── ECHO / DOUBLE-EXPOSURE (P7.6): offset translucent copies trailing glyph ─
  // Technique: build the echo TRAIL as `count` translucent glyph copies stepped along
  // `angle` `distance` px apart (echoCopies — count scaled by intensity), painted
  // FARTHEST-first (back-to-front), each copy's alpha DECAYING per copy by `falloff`
  // (falloff^k) so it reads as a motion echo / double-exposure. The copies are dropped
  // BEHIND the (already-painted) face with 'destination-over' so the face stays crisp
  // on top and the fading copies trail behind it. The copy fill is the CURRENT fill
  // color folded with each copy's decaying alpha AND the pipeline's globalAlpha (so the
  // effect's master opacity scales the whole trail). intensity scales the count; opacity
  // rides globalAlpha. All composite/alpha touches are scoped in save()/restore() and
  // composite is reset so nothing leaks forward.
  registerEffectRenderer('echo', (ctx, token, params, context) => {
    const copies = echoCopies(
      params.count,
      params.distance,
      params.angle,
      params.falloff,
      context.intensity
    )
    if (copies.length === 0) return // count 0 / distance 0 / intensity 0 / falloff 0 → no-op.
    ctx.save()
    const baseAlpha = ctx.globalAlpha
    // Drop the trail UNDER the face (destination-over) so the crisp glyph stays on top.
    ctx.globalCompositeOperation = 'destination-over'
    for (const copy of copies) {
      ctx.globalAlpha = clamp01(baseAlpha * copy.alpha)
      ctx.fillText(token.text, token.x + copy.x, token.y + copy.y)
    }
    ctx.globalAlpha = baseAlpha
    // Reset composite explicitly (restore() also reverts it) so nothing leaks forward.
    ctx.globalCompositeOperation = 'source-over'
    ctx.restore()
  })

  // ── GLOW (P7.2): a soft luminous halo around the glyph ───────────────────
  // Technique: re-stamp the glyph using the canvas drop-shadow as a BLOOM — set
  // `shadowColor` to the glow color and `shadowBlur` to radius*intensity with ZERO
  // offset, so the glyph casts an even halo in every direction. We stamp the bloom
  // a couple of times (additive accumulation) so the halo builds intensity, then
  // re-paint the glyph body ON TOP with the shadow cleared so the text stays crisp
  // and legible (glow behind, glyph on top). Honors opacity via the pipeline's
  // globalAlpha (already multiplied in) — we further fold it into the halo color so
  // the bloom fades with the effect. Every shadow*/alpha touch is scoped in
  // save()/restore() so nothing leaks into the next pass.
  registerEffectRenderer('glow', (ctx, token, params, context) => {
    const blur = resolveGlowBlur(params.radius, context.intensity)
    if (blur <= 0) return
    ctx.save()
    // Two bloom passes accumulate a brighter, fuller halo (each casts the colored
    // shadow with no offset). The color carries the current effect alpha so opacity
    // fades the glow; the canvas alpha was already set by the pipeline.
    ctx.shadowColor = withAlpha(params.color, ctx.globalAlpha)
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
    for (const factor of [1, 0.5]) {
      ctx.shadowBlur = blur * factor
      ctx.fillText(token.text, token.x, token.y)
    }
    // Re-stamp the glyph body with NO shadow so the text reads on top of its halo.
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.fillText(token.text, token.x, token.y)
    ctx.restore()
  })

  // ── NEON (P7.2): tight bright core + saturated outer bloom (neon tube) ────
  // Technique: first an OUTER GLOW like `glow` (colored shadow bloom, radius*
  // intensity) to lay the saturated halo. Then the crisp NEON TUBE on top: a bright
  // white-hot CORE stroke (line width = core*intensity) so the glyph edge reads as a
  // lit tube, plus a final color fill so the body picks up the neon hue. The core is
  // drawn with the shadow CLEARED (sharp), while a slightly-blurred color stroke
  // under it gives the tube its colored edge bleed. Opacity rides the pipeline's
  // globalAlpha; we fold it into the bloom color too. All shadow*/lineWidth/strokeStyle
  // touches are scoped in save()/restore() so the tube never leaks forward.
  registerEffectRenderer('neon', (ctx, token, params, context) => {
    const blur = resolveNeonBlur(params.radius, context.intensity)
    const coreWidth = resolveNeonCore(params.core, context.intensity)
    // Both the bloom and the core scale with intensity; intensity 0 → both 0 → no-op.
    if (blur <= 0 && coreWidth <= 0) return
    ctx.save()
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0

    // 1) OUTER saturated bloom (two accumulating passes, like glow).
    if (blur > 0) {
      ctx.shadowColor = withAlpha(params.color, ctx.globalAlpha)
      for (const factor of [1, 0.5]) {
        ctx.shadowBlur = blur * factor
        ctx.fillText(token.text, token.x, token.y)
      }
    }

    // 2) COLORED TUBE edge — a stroke in the neon color with a small residual blur,
    //    so the tube has a tight colored bleed hugging the glyph.
    if (coreWidth > 0) {
      ctx.lineJoin = 'round'
      ctx.strokeStyle = withAlpha(params.color, ctx.globalAlpha)
      ctx.lineWidth = coreWidth * 2
      ctx.shadowColor = withAlpha(params.color, ctx.globalAlpha)
      ctx.shadowBlur = Math.min(blur, coreWidth * 2)
      ctx.strokeText(token.text, token.x, token.y)

      // 3) BRIGHT CORE — a sharp white-hot inner stroke (no shadow) = the lit tube.
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = coreWidth
      ctx.strokeText(token.text, token.x, token.y)
    }

    // 4) Neon-colored BODY fill on top (no shadow) so the glyph reads in the hue.
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.fillStyle = withAlpha(params.color, ctx.globalAlpha)
    ctx.fillText(token.text, token.x, token.y)

    ctx.restore()
  })

  // ── GLITCH (P7.3): RGB channel split + scanline/jitter distortion ─────────
  // Technique:
  //  1) RGB CHANNEL SPLIT (chromatic aberration): re-stamp the glyph THREE times —
  //     once each in pure R / G / B (channelFillColor) — with the R and B layers
  //     offset along `angle` by ±(splitDistance*intensity) and G centered
  //     (resolveChannelOffsets). The three layers composite with the `lighter`
  //     (ADDITIVE) blend so where they overlap they sum back toward the original
  //     glyph and where they don't the lone red/blue FRINGE shows — the classic
  //     RGB-split look.
  //  2) SCANLINE/JITTER: `frequency` controls how many horizontal bands get a small
  //     extra horizontal shove; each band is an EXTRA additive R/B re-stamp nudged
  //     by a DETERMINISTIC seeded amount (resolveScanlineJitter, seeded from the
  //     token text — see parity note above), bounded by the split magnitude.
  // Everything is scoped in save()/restore() — including globalCompositeOperation,
  // which we set to 'lighter' for the additive composite and the pipeline restores
  // (we also reset it ourselves so nothing leaks into the next effect/highlight).
  registerEffectRenderer('glitch', (ctx, token, params, context) => {
    const offsets = resolveChannelOffsets(params.splitDistance, context.intensity, params.angle)
    const splitMag = Math.max(0, params.splitDistance) * clamp01(context.intensity)
    const bands = resolveScanlineJitter(
      hashSeed(token.text),
      params.frequency,
      context.intensity,
      splitMag
    )
    const hasSplit = splitMag > 0
    // Nothing to do: no split AND no jitter (intensity 0 / splitDistance 0 / freq 0).
    if (!hasSplit && bands.length === 0) {
      // Still paint the base glyph once so the effect layer is not a hole? No — when
      // there is nothing to distort the glyph is already painted by earlier passes;
      // a true no-op keeps intensity 0 / disabled byte-identical to no effect.
      return
    }
    ctx.save()
    const alpha = ctx.globalAlpha
    // Additive composite so the three channels sum back toward the original.
    ctx.globalCompositeOperation = 'lighter'

    // 1) RGB channel split — three additive single-channel stamps.
    for (const o of offsets) {
      ctx.fillStyle = channelFillColor(o.channel, alpha)
      ctx.fillText(token.text, token.x + o.dx, token.y + o.dy)
    }

    // 2) Seeded scanline jitter — extra red/blue stamps shoved horizontally. These
    //    accumulate additively on top of the split (still 'lighter') for the torn,
    //    busy scanline look. Deterministic: `bands` came from the seeded PRNG.
    for (const band of bands) {
      ctx.fillStyle = channelFillColor('r', alpha)
      ctx.fillText(token.text, token.x + band.shift, token.y)
      ctx.fillStyle = channelFillColor('b', alpha)
      ctx.fillText(token.text, token.x - band.shift, token.y)
    }

    // Reset composite explicitly (belt-and-braces; restore() also reverts it) so the
    // additive mode never leaks into the next effect or the highlight overlay.
    ctx.globalCompositeOperation = 'source-over'
    ctx.restore()
  })

  // ── 3D DEPTH (P7.4): extruded offset layers behind the glyph ──────────────
  // Technique: build the extrude WALL as a stack of SOLID glyph copies stepped along
  // `angle` for `depth` steps (extrudeSteps — count scaled by intensity), painted
  // FARTHEST-first (back-to-front) in the side `color`, each step DARKENED with depth
  // (shadeColor) so the back of the wall reads darker than the front (faked lighting).
  // The wall is drawn FIRST so it sits BEHIND; the base FACE glyph is then re-stamped
  // on top (no offset) in the current fill so the text stays crisp and reads as the
  // lit front of a 3D extrusion. intensity scales how many copies (depth) + the shade
  // contrast; opacity rides the pipeline's globalAlpha (folded into each side color).
  // All fill/style touches are scoped in save()/restore() so nothing leaks forward.
  registerEffectRenderer('3d', (ctx, token, params, context) => {
    const steps = extrudeSteps(params.angle, params.depth, context.intensity)
    if (steps.length === 0) return // depth 0 / intensity 0 → no wall → true no-op.
    ctx.save()
    const alpha = ctx.globalAlpha
    // The base FACE glyph is ALREADY painted (pass 5 runs effects AFTER fill), so we
    // drop the wall BEHIND it with the 'destination-over' composite — new draws land
    // UNDER the existing pixels. The face therefore stays crisp on top while the side
    // copies extrude behind it. Painted FARTHEST-first within destination-over each
    // closer copy still lands under the prior (and under the face), so the wall reads
    // as a continuous solid extrusion with the nearest side just behind the face.
    ctx.globalCompositeOperation = 'destination-over'
    for (const step of steps) {
      ctx.fillStyle = shadeColor(params.color, step.shade, alpha)
      ctx.fillText(token.text, token.x + step.x, token.y + step.y)
    }
    // Reset composite explicitly (restore() also reverts it) so nothing leaks forward.
    ctx.globalCompositeOperation = 'source-over'
    ctx.restore()
  })

  // ── BEVEL / EMBOSS (gloss): a lit rim carved into the glyph ───────────────
  // Technique: with 'source-atop' (new paint shows ONLY where the glyph body is
  // already painted), stamp an offset copy of the glyph in the SHADOW color toward
  // the light direction and a HIGHLIGHT copy the opposite way. Each offset copy,
  // clipped to the glyph, leaves a thin dark rim on one side and a bright specular
  // rim on the lit side — the rounded, polished-metal bevel + top gloss (§2.4). The
  // face stays intact between the rims. intensity scales the rim inset; opacity
  // rides the pipeline globalAlpha. All state is scoped in save()/restore().
  registerEffectRenderer('bevel', (ctx, token, params, context) => {
    const size = params.size * clamp01(context.intensity)
    if (size <= 0) return
    const rad = ((Number.isFinite(params.angle) ? params.angle : 90) * Math.PI) / 180
    const dx = round3(Math.cos(rad))
    const dy = round3(Math.sin(rad))
    ctx.save()
    const alpha = ctx.globalAlpha
    ctx.globalCompositeOperation = 'source-atop'
    // Dark rim on the shadow side (offset toward the light so the shaded edge sits
    // opposite the highlight), then the bright specular rim on the lit side on top.
    ctx.fillStyle = withAlpha(params.shadow, alpha * 0.85)
    ctx.fillText(token.text, token.x + dx * size, token.y + dy * size)
    ctx.fillStyle = withAlpha(params.highlight, alpha)
    ctx.fillText(token.text, token.x - dx * size, token.y - dy * size)
    ctx.globalCompositeOperation = 'source-over'
    ctx.restore()
  })

  // ── RETRO / VINTAGE (P7.4): warm palette + film grain + slight chroma ─────
  // Technique (three thin graded passes over the already-painted glyph):
  //  1) SLIGHT CHROMA — a small R/B split (resolveChromaOffsets), composited
  //     'lighter' (additive) like glitch but DELIBERATELY smaller (RETRO_CHROMA_FACTOR)
  //     so it reads as gentle vintage fringing, not a glitch tear. Painted first so
  //     the tint + grain sit on top of the fringe.
  //  2) PALETTE TINT — re-stamp the glyph in the vintage `color` at a fractional alpha
  //     (resolvePaletteTintColor) so the glyph grades TOWARD the warm palette hue
  //     (a translucent wash, not an opaque recolor). Strength scales with intensity.
  //  3) FILM GRAIN — a DETERMINISTIC sprinkle of tiny speckles over the glyph box
  //     (resolveGrainSpeckles), seeded by the token's stable identity (hashSeed) via
  //     the SAME mulberry32 PRNG the glitch jitter uses — so preview == export (no
  //     Math.random/Date). Count scales by grain*intensity.
  // intensity scales every pass (tint depth, grain count, chroma magnitude); opacity
  // rides the pipeline's globalAlpha (folded into each color). intensity 0 (or grain 0
  // + chroma 0) collapses to just the tint (or a full no-op at intensity 0). All
  // composite/style touches are scoped in save()/restore() so nothing leaks forward.
  registerEffectRenderer('retro', (ctx, token, params, context) => {
    const intensity = clamp01(context.intensity)
    const tintAlpha = resolvePaletteTintAlpha(intensity)
    const chroma = resolveChromaOffsets(params.chroma, intensity)
    const hasChroma = chroma.some((o) => o.dx !== 0 || o.dy !== 0)
    const speckles = resolveGrainSpeckles(hashSeed(token.text), params.grain, intensity)
    // True no-op when intensity is 0: no tint, no chroma, no grain (byte-identical to
    // no effect / disabled — matches glitch/3d).
    if (tintAlpha <= 0 && !hasChroma && speckles.length === 0) return
    ctx.save()
    const alpha = ctx.globalAlpha

    // 1) SLIGHT CHROMA — small additive R/B split (green centered) for fringing.
    if (hasChroma) {
      ctx.globalCompositeOperation = 'lighter'
      for (const o of chroma) {
        ctx.fillStyle = channelFillColor(o.channel, alpha)
        ctx.fillText(token.text, token.x + o.dx, token.y + o.dy)
      }
      ctx.globalCompositeOperation = 'source-over'
    }

    // 2) PALETTE TINT — translucent warm wash graded toward the vintage color.
    if (tintAlpha > 0) {
      ctx.fillStyle = resolvePaletteTintColor(params.color, intensity, alpha)
      ctx.fillText(token.text, token.x, token.y)
    }

    // 3) FILM GRAIN — deterministic speckles clipped to the glyph so the grain reads
    //    ON the text. We CLIP to the glyph path (so dots outside the letters do not
    //    show) then stamp each speckle as a 1px dot at its fractional box position.
    if (speckles.length > 0) {
      const box = grainBox(ctx, token)
      // Clip to the glyph so grain only speckles the letters (degrades to the box if
      // the headless ctx lacks path ops). Scoped in its own save()/restore().
      ctx.save()
      try {
        ctx.beginPath()
        ctx.clip()
      } catch {
        /* a context without path/clip support degrades to an unclipped speckle */
      }
      for (const sp of speckles) {
        ctx.fillStyle = withAlpha(params.color, sp.alpha * alpha)
        const px = box.x + sp.fx * box.w
        const py = box.y + sp.fy * box.h
        ctx.fillRect(px, py, 1, 1)
      }
      ctx.restore()
    }

    // Reset composite explicitly (restore() also reverts it) so nothing leaks forward.
    ctx.globalCompositeOperation = 'source-over'
    ctx.restore()
  })
}

/**
 * The approximate glyph BOX (origin + width/height) the grain speckles sprinkle over.
 * Uses `ctx.measureText` when available; falls back to a small fixed box so the
 * headless engine (a stub ctx) still produces a deterministic, finite box. The grain
 * is fractional within this box so it scales with the glyph size. PURE-ish (only
 * reads ctx metrics; no draws).
 */
function grainBox(
  ctx: CanvasRenderingContext2D,
  token: GlyphToken
): { x: number; y: number; w: number; h: number } {
  let w = 0
  let asc = 0
  let desc = 0
  try {
    const m = ctx.measureText(token.text)
    w = Number.isFinite(m.width) ? m.width : 0
    asc = Number.isFinite(m.actualBoundingBoxAscent) ? m.actualBoundingBoxAscent : 0
    desc = Number.isFinite(m.actualBoundingBoxDescent) ? m.actualBoundingBoxDescent : 0
  } catch {
    /* stub ctx without measureText → fall through to the fixed fallback below */
  }
  if (w <= 0) w = Math.max(1, token.text.length * 8)
  const h = asc + desc > 0 ? asc + desc : 16
  // Baseline-relative box: text sits on token.y, ascent above, descent below.
  return { x: token.x, y: token.y - (asc > 0 ? asc : h * 0.8), w, h }
}

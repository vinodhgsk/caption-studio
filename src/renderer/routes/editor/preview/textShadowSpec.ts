/**
 * Resolve a text clip's SHADOW (P6.13 — Doc 10 shadow; skill `text-render`).
 *
 * `clip.text.shadow` mirrors the preset `PresetShadow` shape verbatim
 * (`{ color, opacity, blur, angle, distance, inner, long }`). This module is the
 * SINGLE pure projection from that open bag onto a strongly-typed
 * {@link ResolvedTextShadow}, plus the SINGLE place that applies a resolved drop
 * shadow to a `CanvasRenderingContext2D` ({@link applyDropShadow} / {@link clearShadow}).
 * The thumbnail render (`captionTextRender`), the live preview
 * (`PreviewCanvas.drawTextClips`), and the export path all consume these, so a
 * shadow casts identically (preview = export, master plan §6).
 *
 * SHADOW MODEL — designed so the next two prompts slot in with NO caller churn:
 *   - P6.13 (this prompt): a DROP shadow — color + opacity + blur + angle(±180°)
 *                          + distance, projected to canvas `shadowColor`/`shadowBlur`/
 *                          `shadowOffsetX`/`shadowOffsetY`. Surfaced as
 *                          {@link ResolvedTextShadow.kind} `'drop'`.
 *   - P6.14 (inner+long):  `inner: true` → an INNER shadow (drawn by clipping to the
 *                          glyph + casting the shadow from a knocked-out fill, NOT a
 *                          canvas `shadow*`); `long: true` → a LONG/extruded shadow
 *                          (a stepped stack of offset copies along the angle). Both
 *                          are surfaced HERE as the resolved `kind` (`'inner'`/`'long'`)
 *                          + the same geometry ({@link ShadowOffset} / step vector), so
 *                          the draw caller dispatches on `kind` without re-resolving.
 *   - P6.15 (render order):the canonical order is SHADOW → FILL → STROKE → effects.
 *                          This module gives the caller a SHADOW PASS it issues FIRST
 *                          (before fill/stroke) — see {@link shadowDrawPlan}. Locking
 *                          the order is P6.15's job; this prompt already paints the
 *                          shadow pass before the fill so the order is correct.
 *
 * ANGLE CONVENTION (canvas space, y grows DOWN):
 *   0°   → shadow to the RIGHT   (offsetX = +distance, offsetY = 0)
 *   90°  → shadow DOWN           (offsetX = 0,         offsetY = +distance)
 *   -90° → shadow UP             (offsetX = 0,         offsetY = -distance)
 *   180° / -180° → shadow LEFT   (offsetX = -distance, offsetY = 0)
 *   45°  → DOWN-RIGHT,  -135° → UP-LEFT
 * i.e. offsetX = distance·cos(angle), offsetY = distance·sin(angle). The angle is
 * accepted across the FULL ±180° range (the TextPanel slider's range); any finite
 * angle resolves correctly (the trig is periodic) so values outside ±180° still work.
 *
 * AVOIDING A DOUBLED SHADOW: a canvas `shadow*` is cast by EVERY draw op while it is
 * set. If both the stroke pass and the fill pass ran with the shadow live, the glyph
 * would cast the shadow TWICE (stroke silhouette + fill silhouette), darkening it.
 * The convention here (and at the call sites) is: the shadow is cast by the FIRST
 * (widest, outermost) paint op — the widest stroke layer when there is a stroke, else
 * the fill — and {@link clearShadow} is called before the remaining passes so they
 * paint with NO shadow. The glyph silhouette thus casts exactly ONE shadow.
 *
 * PURE + headless-safe: {@link shadowOffset} / {@link resolveTextShadow} have NO
 * DOM/canvas (the unit tests assert them directly). Only {@link applyDropShadow} /
 * {@link clearShadow} touch a `CanvasRenderingContext2D`, and they only SET thin
 * `shadow*` properties a stubbed ctx accepts.
 */
import { isHexColor, rgbaFromHexSafe } from './textFillSpec'

/** A pure angle+distance → canvas offset, in the text's LOCAL (font-px) space. */
export interface ShadowOffset {
  /** offsetX = distance·cos(angle). +x is RIGHT. */
  x: number
  /** offsetY = distance·sin(angle). +y is DOWN (canvas convention). */
  y: number
}

/**
 * Which kind of shadow a resolved spec describes (P6.14): `'drop'` is the P6.13
 * canvas `shadow*` drop shadow; `'inner'` is a shadow cast INSIDE the glyph (the
 * body looks cut out); `'long'` is a flat extruded trail of solid offset copies.
 * {@link resolveTextShadow} maps the `inner`/`long` flags on `clip.text.shadow`
 * onto this `kind`, and the draw caller dispatches on it (each kind reuses the same
 * angle+distance geometry — {@link shadowOffset} / {@link longShadowSteps}).
 */
export type ShadowKind = 'drop' | 'inner' | 'long'

/**
 * A resolved shadow — the baked rgba color (hex + opacity), the blur radius, the
 * angle→distance offset, and the `kind`. Everything a draw path needs with NO
 * canvas. A `null` resolve (see {@link resolveTextShadow}) means "no shadow".
 */
export interface ResolvedTextShadow {
  kind: ShadowKind
  /** rgba() string (hex + opacity baked) the canvas accepts as `shadowColor`. */
  color: string
  /** Blur radius in px (>= 0) → `ctx.shadowBlur`. */
  blur: number
  /** Offset from angle+distance → `ctx.shadowOffsetX/Y`. */
  offset: ShadowOffset
  /** The raw angle in degrees (kept for P6.14's long-shadow step direction). */
  angleDeg: number
  /** The raw distance in px (kept for P6.14's long-shadow step length). */
  distance: number
}

/** Defaults a shadow's color/opacity fall back to when absent/invalid. */
export interface TextShadowDefaults {
  /** Hex color used when the shadow omits / malforms its color. */
  hex: string
  /** Opacity 0..1 baked into the color when none is present (legacy compat). */
  opacity: number
}

/** A soft black drop shadow — the historical text-shadow default. */
export const DEFAULT_TEXT_SHADOW: TextShadowDefaults = { hex: '#000000', opacity: 0.6 }

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * PURE angle+distance → canvas offset (the load-bearing geometry of P6.13). Given
 * an `angleDeg` (DEGREES, ±180° and beyond — the trig is periodic) and a `distance`
 * (px), returns `{ x, y }` where:
 *   - x = distance·cos(angle)  (+x is RIGHT)
 *   - y = distance·sin(angle)  (+y is DOWN — canvas y grows down)
 * so 0°→right, 90°→down, -90°→up, 180°/-180°→left, 45°→down-right, -135°→up-left.
 *
 * A near-zero component is SNAPPED to exactly 0 so axis-aligned angles
 * (0/±90/±180°) give clean offsets free of float dust (e.g. 180° → x exactly
 * -distance, y exactly 0). A non-finite/negative distance yields a zero offset.
 */
export function shadowOffset(angleDeg: number, distance: number): ShadowOffset {
  const d = isFiniteNum(distance) && distance > 0 ? distance : 0
  if (d === 0) return { x: 0, y: 0 }
  const rad = ((isFiniteNum(angleDeg) ? angleDeg : 0) * Math.PI) / 180
  const snap = (v: number): number => (Math.abs(v) < 1e-9 ? 0 : v)
  return { x: snap(Math.cos(rad)) * d, y: snap(Math.sin(rad)) * d }
}

/**
 * Resolve a clip's open `clip.text.shadow` bag (or `undefined`) into a typed
 * {@link ResolvedTextShadow}, or `null` when there is NO shadow. PURE.
 *
 * Backward compatible / tolerant:
 *   - No `shadow` at all          → `null` (no shadow).
 *   - `distance <= 0`             → `null` (the slider's zero position = no shadow).
 *   - missing `opacity`           → `defaults.opacity` (legacy shape still casts).
 *   - invalid / missing color     → `defaults.hex` baked at the opacity.
 *   - missing `blur`              → 0 (a crisp offset shadow, no blur).
 *   - `inner` / `long` flags      → resolved into `kind` (DROP for P6.13; P6.14
 *                                   maps them to `'inner'`/`'long'`). Today an
 *                                   inner/long flag still resolves to a DROP shadow
 *                                   so an existing preset never loses its shadow.
 *
 * The `angle` is taken VERBATIM (any finite value; the ±180° slider range is the
 * UI's, the math is periodic) and fed to {@link shadowOffset}.
 */
export function resolveTextShadow(
  shadow: unknown,
  defaults: TextShadowDefaults = DEFAULT_TEXT_SHADOW
): ResolvedTextShadow | null {
  if (!isObj(shadow)) return null

  const distance = isFiniteNum(shadow.distance) ? (shadow.distance as number) : 0
  // distance <= 0 → no shadow (the UI's "off"/zero-distance state).
  if (!(distance > 0)) return null

  const hex = isHexColor(shadow.color) ? (shadow.color as string) : defaults.hex
  const opacity = isFiniteNum(shadow.opacity) ? clamp01(shadow.opacity as number) : defaults.opacity
  const blur = isFiniteNum(shadow.blur) && (shadow.blur as number) > 0 ? (shadow.blur as number) : 0
  const angleDeg = isFiniteNum(shadow.angle) ? (shadow.angle as number) : 0

  // P6.14: map the inner/long flags to the resolved `kind`. `long` wins over
  // `inner` when (illegally) both are set — a long/extruded shadow is the more
  // dominant look. A shadow with neither flag is a plain DROP shadow (P6.13).
  // The draw caller dispatches on this `kind` (drop → canvas shadow*; inner →
  // clipped inverse; long → stepped solid offsets) without re-resolving.
  const long = shadow.long === true
  const inner = shadow.inner === true
  const kind: ShadowKind = long ? 'long' : inner ? 'inner' : 'drop'

  return {
    kind,
    color: rgbaFromHexSafe(hex, opacity, defaults.hex),
    blur,
    offset: shadowOffset(angleDeg, distance),
    angleDeg,
    distance
  }
}

/** True when a resolved shadow is present (non-null). Sugar for call sites. */
export function hasShadow(shadow: ResolvedTextShadow | null): shadow is ResolvedTextShadow {
  return shadow !== null
}

/**
 * Apply a resolved DROP shadow to a canvas context so the NEXT draw op casts it.
 * Sets `shadowColor`/`shadowBlur`/`shadowOffsetX`/`shadowOffsetY`. PURE side-effect
 * on `ctx` only. The offset is in the text's LOCAL (font-px) space, so the
 * compositor transform carries it to screen px (preview = export).
 *
 * The CALLER must {@link clearShadow} before the subsequent passes so the glyph
 * casts exactly ONE shadow (see the module's "avoiding a doubled shadow" note).
 */
export function applyDropShadow(ctx: CanvasRenderingContext2D, shadow: ResolvedTextShadow): void {
  ctx.shadowColor = shadow.color
  ctx.shadowBlur = shadow.blur
  ctx.shadowOffsetX = shadow.offset.x
  ctx.shadowOffsetY = shadow.offset.y
}

/** Clear any shadow on the context so subsequent draw ops cast NONE. */
export function clearShadow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
}

// ---------------------------------------------------------------------------
// P6.14 — LONG (extruded) shadow geometry
// ---------------------------------------------------------------------------

/**
 * PURE step generator for a LONG (classic "long shadow" / extruded) shadow. A long
 * shadow is NOT a blurred canvas `shadow*`: it is a flat trail of SOLID copies of
 * the glyph, each nudged a little further along the shadow direction, stacked from
 * the FARTHEST step back up to the nearest so the glyph sits on top of the trail.
 *
 * Given the shadow `angleDeg` (same convention as {@link shadowOffset}: 0°→right,
 * 90°→down, -90°→up, ±180°→left), a total `length` (px, how far the trail extends)
 * and a `stepPx` (px between consecutive copies), returns the ordered list of
 * `{ x, y }` offsets (LOCAL font-px space) at which to draw a solid copy of the
 * glyph. The list is ordered FARTHEST-first (largest offset → smallest) so the
 * caller paints back-to-front and the trail reads as a continuous solid extrusion.
 *
 * Geometry:
 *   - unit direction = (cos(angle), sin(angle)) (axis-aligned angles snapped clean).
 *   - the trail covers offsets stepPx, 2·stepPx, … up to and INCLUDING `length`.
 *   - count = floor(length / stepPx); a final step lands exactly on `length` (the
 *     last `floor` multiple), so the trail never overshoots the requested length.
 *   - step[k] (k = 1..count) = (k·stepPx·cos, k·stepPx·sin), returned farthest-first.
 *
 * Degenerate inputs yield an EMPTY list (no trail): length <= 0, stepPx <= 0, or a
 * non-finite angle/length/step. A `stepPx >= length` with `length > 0` yields a
 * single step at `length`. Pure + headless — the unit tests assert it directly.
 */
export function longShadowSteps(angleDeg: number, length: number, stepPx: number): ShadowOffset[] {
  const len = isFiniteNum(length) && length > 0 ? length : 0
  const step = isFiniteNum(stepPx) && stepPx > 0 ? stepPx : 0
  if (len === 0 || step === 0) return []
  const rad = ((isFiniteNum(angleDeg) ? angleDeg : 0) * Math.PI) / 180
  const snap = (v: number): number => (Math.abs(v) < 1e-9 ? 0 : v)
  const ux = snap(Math.cos(rad))
  const uy = snap(Math.sin(rad))
  const count = Math.max(1, Math.floor(len / step))
  const steps: ShadowOffset[] = []
  // Farthest-first: k = count down to 1 so the caller paints back-to-front. Each
  // offset is the smaller of (k·step) and `length` so the trail never overshoots
  // the requested length (a step >= length collapses to a single step AT length).
  for (let k = count; k >= 1; k--) {
    const d = Math.min(k * step, len)
    steps.push({ x: ux * d, y: uy * d })
  }
  return steps
}

/**
 * Default step size (px) for the long-shadow trail. Small enough that the solid
 * copies overlap into a continuous extrusion at typical caption font sizes; the
 * caller may pass its own step. Exported so the live preview + thumbnail + export
 * (and the unit tests' expected counts) all use the SAME spacing — one geometry.
 */
export const LONG_SHADOW_STEP_PX = 1

/**
 * Default extrusion LENGTH (px) for a long shadow when the shadow's `distance`
 * does not directly carry it. A long shadow reads best when it extends well past a
 * plain drop offset, so the resolved `distance` is multiplied by this factor at the
 * call site (see {@link longShadowLength}); kept here so preview/export/thumbnail agree.
 */
export const LONG_SHADOW_DISTANCE_FACTOR = 6

/**
 * Map a resolved shadow's `distance` to the long-shadow trail LENGTH. PURE. The
 * trail extends `distance · {@link LONG_SHADOW_DISTANCE_FACTOR}` px along the angle
 * (a drop shadow's `distance` is a single small offset; a long shadow extrudes much
 * farther), so the SAME `distance` slider drives both looks sensibly.
 */
export function longShadowLength(distance: number): number {
  const d = isFiniteNum(distance) && distance > 0 ? distance : 0
  return d * LONG_SHADOW_DISTANCE_FACTOR
}

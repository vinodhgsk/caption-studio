/**
 * Resolve a text clip's FILL (P6.7 — Doc 10 color; skill `text-render`).
 *
 * `clip.text.fill` is an OPEN `Record<string, unknown>` (project-schema), written
 * by the Color panel and by P5.4's preset->clip mapping. This module is the
 * SINGLE pure projection from that open bag onto a strongly-typed
 * {@link ResolvedTextFill}, plus the SINGLE place that turns a resolved fill into
 * a canvas paint ({@link fillToCanvasPaint}). The thumbnail render
 * (`captionTextRender`) and the live preview (`PreviewCanvas.drawTextClips`) both
 * consume these, so a solid color + opacity paints identically (preview = export,
 * master plan §6).
 *
 * UNIFIED FILL MODEL — designed so P6.8 (gradient) and P6.9 (per-word color) slot
 * in here with no caller churn:
 *   - P6.7 (this prompt): `{ type:'solid', value/color: hex, opacity }`.
 *   - P6.8 (gradient):    `{ type:'gradient', value: GradientStop[], opacity, angle? }`
 *                         — extend {@link resolveTextFill}'s gradient branch + the
 *                         gradient arm of {@link fillToCanvasPaint}.
 *   - P6.9 (per-word):    a per-run color overrides the BASE fill. Callers ask
 *                         {@link resolveRunColor} for a run's effective color string
 *                         (run color baked at the base fill opacity, else the base
 *                         solid color). One override point, one place to test.
 *
 * PURE + headless-safe: `resolveTextFill` / `rgbaFromHexSafe` / `resolveRunColor`
 * have NO DOM/canvas (the unit tests assert them directly). Only
 * {@link fillToCanvasPaint} touches a `CanvasRenderingContext2D`, and only for the
 * gradient arm — the solid arm returns a plain string a stubbed ctx accepts.
 */
import type { GradientStop } from '../../../../shared/captionPreset'

/** A resolved fill — a solid color (opacity baked) or an ordered gradient. */
export type ResolvedTextFill =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; stops: GradientStop[]; opacity: number; angleDeg: number }

/** The default fill a text clip falls back to when `clip.text.fill` is absent. */
export interface TextFillDefaults {
  /** Hex color used when no fill / no valid color is present. */
  hex: string
  /** Opacity 0..1 used when no explicit opacity is present (backward compat). */
  opacity: number
}

/** A solid white, fully-opaque fill — the historical text-clip placeholder. */
export const DEFAULT_TEXT_FILL: TextFillDefaults = { hex: '#ffffff', opacity: 1 }

function isStr(v: unknown): v is string {
  return typeof v === 'string'
}
function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** Clamp a number into [0,1]. */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

/**
 * Normalize a `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa` hex (with or without `#`) to its
 * r/g/b channels (0..255), or `null` when the string is not a valid hex. Short
 * forms are expanded (`#abc` -> `#aabbcc`); an alpha nibble/byte is dropped (the
 * opacity argument is the single source of alpha so the model stays one-knob).
 */
function hexChannels(hex: string): { r: number; g: number; b: number } | null {
  if (!isStr(hex) || !HEX_RE.test(hex)) return null
  let h = hex.replace('#', '')
  if (h.length === 3 || h.length === 4) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  if (h.length === 8) h = h.slice(0, 6)
  // length is now 6
  const n = parseInt(h.slice(0, 6), 16)
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
}

/** True when `v` is a syntactically valid hex color (3/4/6/8 digits, `#` optional). */
export function isHexColor(v: unknown): boolean {
  return isStr(v) && HEX_RE.test(v)
}

/**
 * A hex color + an opacity 0..1 -> an `rgba(...)` string the canvas accepts.
 * Opacity is CLAMPED to [0,1]. An invalid/empty hex falls back to `fallbackHex`
 * (defaults to white) so a malformed color never produces an unpaintable style.
 * This is the centralized, testable hex+opacity -> rgba used everywhere.
 */
export function rgbaFromHexSafe(hex: string, opacity: number, fallbackHex = '#ffffff'): string {
  const ch = hexChannels(hex) ?? hexChannels(fallbackHex) ?? { r: 255, g: 255, b: 255 }
  const a = isFiniteNum(opacity) ? clamp01(opacity) : 1
  return `rgba(${ch.r}, ${ch.g}, ${ch.b}, ${a})`
}

/**
 * Resolve a clip's open `text.fill` bag (or `undefined`) into a typed
 * {@link ResolvedTextFill}, filling missing/invalid fields from `defaults`. PURE.
 *
 * Backward compatible:
 *   - No `fill` at all            -> default solid (white, opacity 1).
 *   - `{ type:'solid', value }`   -> the preset/clip shape (value = hex).
 *   - `{ type:'solid', color }`   -> the Color-panel shape (color = hex).
 *   - missing `opacity`           -> `defaults.opacity` (existing clips stay opaque).
 *   - invalid hex                 -> `defaults.hex` (never an unpaintable color).
 *
 * Gradient (P6.8) is resolved structurally here already (stops + opacity + angle)
 * so a preset-applied gradient survives; the Color panel only edits solid for now.
 */
export function resolveTextFill(
  fill: Record<string, unknown> | undefined,
  defaults: TextFillDefaults = DEFAULT_TEXT_FILL
): ResolvedTextFill {
  const f = fill ?? {}
  const opacity = isFiniteNum(f.opacity) ? clamp01(f.opacity as number) : defaults.opacity

  if (f.type === 'gradient') {
    const raw = Array.isArray(f.value) ? (f.value as unknown[]) : []
    const stops: GradientStop[] = raw
      .filter(
        (s): s is GradientStop =>
          typeof s === 'object' &&
          s !== null &&
          isFiniteNum((s as GradientStop).offset) &&
          isHexColor((s as GradientStop).color)
      )
      .map((s) => ({ offset: clamp01(s.offset), color: s.color }))
    const angleDeg = isFiniteNum(f.angle) ? (f.angle as number) : 0
    // A gradient needs >= 2 valid stops to paint; degrade to a solid otherwise so
    // the text is never invisible (a half-built gradient still shows something).
    if (stops.length >= 2) return { type: 'gradient', stops, opacity, angleDeg }
    const only = stops[0]?.color ?? defaults.hex
    return { type: 'solid', color: rgbaFromHexSafe(only, opacity, defaults.hex) }
  }

  // Solid (default). Accept BOTH `value` (preset/clip shape) and `color`
  // (Color-panel shape) for the hex — preferring `color` when both are present.
  const hex = isHexColor(f.color)
    ? (f.color as string)
    : isHexColor(f.value)
      ? (f.value as string)
      : defaults.hex
  return { type: 'solid', color: rgbaFromHexSafe(hex, opacity, defaults.hex) }
}

/** Linear-gradient endpoints, in the text block's CENTERED local space. */
export interface GradientEndpoints {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * PURE angle -> gradient endpoint math (P6.8), independent of any canvas, so the
 * geometry is unit-testable and preview/export provably agree. Given an angle in
 * DEGREES and the text block's `w`×`h`, returns the start/end points of a linear
 * gradient EXPRESSED IN THE BLOCK'S CENTERED LOCAL SPACE (origin at the block
 * center, where the preview/thumbnail draw the text). The endpoints sit on the
 * block boundary so the gradient SPANS the full text in the requested direction:
 *
 *   - 0°   -> left → right        (x: -w/2 → +w/2,  y: 0)
 *   - 90°  -> top → bottom        (x: 0,  y: -h/2 → +h/2)   [canvas y grows down]
 *   - 180° -> right → left
 *   - 270° -> bottom → top
 *
 * The endpoint is the projection of the unit angle vector onto the block's half
 * extents: a direction (cosθ, sinθ) is scaled so its longer axis just reaches the
 * block edge. A zero/degenerate block falls back to a 1px span so the gradient is
 * always paintable. {@link fillToCanvasPaint} builds the CanvasGradient from this.
 */
export function gradientEndpoints(angleDeg: number, w: number, h: number): GradientEndpoints {
  const halfW = Math.max(0.5, (Number.isFinite(w) ? w : 1) / 2)
  const halfH = Math.max(0.5, (Number.isFinite(h) ? h : 1) / 2)
  const rad = (angleDeg * Math.PI) / 180
  // Direction vector; snap near-zero components to exactly 0 so axis-aligned
  // angles (0/90/180/270) give clean endpoints free of float dust.
  const snap = (v: number): number => (Math.abs(v) < 1e-9 ? 0 : v)
  const dx = snap(Math.cos(rad))
  const dy = snap(Math.sin(rad))
  // Scale the direction so it reaches the block boundary along its dominant axis.
  // (Project the box half-extents onto the direction: pick the smallest positive
  //  t such that |t·dx| = halfW OR |t·dy| = halfH — i.e. the edge first hit.)
  const tx = dx === 0 ? Infinity : halfW / Math.abs(dx)
  const ty = dy === 0 ? Infinity : halfH / Math.abs(dy)
  const t = Math.min(tx, ty)
  const ex = dx * t
  const ey = dy * t
  return { x0: -ex, y0: -ey, x1: ex, y1: ey }
}

/**
 * Normalize a gradient's stops for painting: CLAMP each offset to [0,1] and SORT
 * ascending by offset (a stable sort preserves input order for equal offsets).
 * PURE — used by {@link fillToCanvasPaint} so canvas `addColorStop` always gets
 * monotonic offsets (some canvas impls require ascending), and unit-testable.
 */
export function normalizeGradientStops(stops: GradientStop[]): GradientStop[] {
  return stops
    .map((s) => ({ offset: clamp01(s.offset), color: s.color }))
    .sort((a, b) => a.offset - b.offset)
}

/**
 * Turn a resolved fill into a canvas paint (a color string, or a `CanvasGradient`).
 * SOLID returns the baked rgba string (no canvas touched). GRADIENT builds a linear
 * gradient SPANNING the `blockW`×`blockH` text bounds at the fill's angle (endpoints
 * from the pure {@link gradientEndpoints}), with each stop's opacity baked through
 * {@link rgbaFromHexSafe} and offsets sorted + clamped via {@link normalizeGradientStops}.
 *
 * `blockH` is optional for backward compatibility — when omitted (older callers /
 * the thumbnail) the gradient spans a square `blockW`×`blockW`, so a horizontal
 * (angle 0) gradient is unchanged. A 2+-stop gradient paints; a degenerate
 * (< 2 stops) one is collapsed to a solid by {@link resolveTextFill} before here.
 *
 * This is the SINGLE "resolve fill -> canvas paint" point: P6.8 refines the
 * gradient geometry/angle here; P6.9's per-word override is applied by the CALLER
 * swapping the solid color (see {@link resolveRunColor}) before/while painting,
 * so the base-fill plumbing here stays untouched.
 */
export function fillToCanvasPaint(
  ctx: CanvasRenderingContext2D,
  fill: ResolvedTextFill,
  blockW: number,
  blockH?: number
): string | CanvasGradient {
  if (fill.type === 'solid') return fill.color
  const h = blockH !== undefined && Number.isFinite(blockH) ? blockH : blockW
  const { x0, y0, x1, y1 } = gradientEndpoints(fill.angleDeg, blockW, h)
  const grad = ctx.createLinearGradient(x0, y0, x1, y1)
  for (const stop of normalizeGradientStops(fill.stops)) {
    grad.addColorStop(stop.offset, rgbaFromHexSafe(stop.color, fill.opacity))
  }
  return grad
}

/**
 * Resolve a single text RUN's effective fill color string, given the clip's base
 * resolved fill (P6.9 per-word color — designed here, applied by the caller).
 *
 * A run MAY carry its own `color` (hex) that OVERRIDES the base fill for that run
 * (text-render "fill ... per-word"). The override is baked at the base fill's
 * opacity so a per-word color honors the same master opacity. When the run has no
 * color override:
 *   - solid base     -> the base solid color (already opacity-baked).
 *   - gradient base  -> `null`, meaning "use the gradient paint" (the caller keeps
 *                       the gradient; a run override is the only way to opt a word
 *                       out of the gradient into a flat color).
 *
 * Returns a ready-to-assign `ctx.fillStyle` string, or `null` to keep the base
 * gradient paint. PURE.
 */
export function resolveRunColor(
  base: ResolvedTextFill,
  run: { color?: unknown } | undefined,
  baseOpacity: number
): string | null {
  const override = run?.color
  if (isHexColor(override)) return rgbaFromHexSafe(override as string, baseOpacity)
  return base.type === 'solid' ? base.color : null
}

// ---------------------------------------------------------------------------
// P6.9 — the `clip.text.runs[]` model + word→run mapping
// ---------------------------------------------------------------------------

/**
 * One TEXT RUN on a caption clip (`clip.text.runs[i]`). A run is positional: run
 * `i` maps to WORD `i` (the i-th token in `clip.caption.words`, same order the
 * per-word draw path lays out). A run currently carries an optional per-word
 * `color` OVERRIDE (a hex that replaces the base fill for that word) — the field
 * is OPTIONAL and the type stays open (extra keys allowed) so later phases can
 * hang more per-word style (weight/italic/etc.) off the same run without a schema
 * break. A run whose `color` is absent/`null` keeps the base fill for that word.
 */
export interface TextRun {
  /** Per-word fill override (hex). Absent/null → that word uses the base fill. */
  color?: string | null
  /** Open for forward-compat (future per-word style); ignored by P6.9. */
  [k: string]: unknown
}

/**
 * Normalize a clip's open `clip.text.runs` bag into a typed `TextRun[]`. PURE +
 * tolerant: a non-array (or absent) `runs` → `[]`; each entry that is not an
 * object becomes an empty run `{}`; a `color` that is not a valid hex string is
 * dropped (treated as "no override") so a malformed run never paints garbage.
 * The array length is preserved (it is positional — index = word index), so a
 * runs array SHORTER or LONGER than the word count is handled by the caller
 * indexing into it: a missing index → base fill; an extra index → ignored.
 */
export function normalizeTextRuns(runs: unknown): TextRun[] {
  if (!Array.isArray(runs)) return []
  return runs.map((r) => {
    if (typeof r !== 'object' || r === null) return {}
    const obj = r as Record<string, unknown>
    const color = isHexColor(obj.color) ? (obj.color as string) : null
    return { ...obj, color }
  })
}

/**
 * Effective fill color for WORD `i`, given the base resolved fill, the (already
 * normalized) `runs`, the word index, and the base opacity. Thin wrapper over
 * {@link resolveRunColor} that owns the word→run index mapping + out-of-bounds
 * handling: `runs[i]` (`undefined` when `i` is past the runs array) feeds straight
 * into {@link resolveRunColor}, so a SHORTER runs array → those words use the base
 * fill, and a LONGER one → extra runs are simply never indexed. PURE.
 *
 * PRECEDENCE (low → high): base fill (solid/gradient)  <  run color  <  the
 * active-word highlight color. This helper covers base < run; the active-word
 * highlight is applied by the caller AFTER this (it overwrites `ctx.fillStyle`),
 * preserving the existing P5.6 precedence.
 */
export function runColorForWord(
  base: ResolvedTextFill,
  runs: readonly TextRun[],
  index: number,
  baseOpacity: number
): string | null {
  return resolveRunColor(base, runs[index], baseOpacity)
}

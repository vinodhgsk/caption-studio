/**
 * Resolve a text clip's STROKE (P6.10 — Doc 10 stroke; skill `text-render`).
 *
 * `clip.text.stroke` is an OPEN `unknown[]` (project-schema) — an ORDERED LIST of
 * outline layers `[{ color, width }]`. A SINGLE stroke is just a 1-element list,
 * so the model is identical from one layer (P6.10) to many stacked layers (P6.11)
 * to a hollow / outline-only body (P6.12). This module is the SINGLE pure
 * projection from that open bag onto a strongly-typed {@link ResolvedTextStroke},
 * plus the SINGLE place that applies a stroke layer to a `CanvasRenderingContext2D`
 * ({@link applyStrokeLayer}). The thumbnail render (`captionTextRender`), the live
 * preview (`PreviewCanvas.drawTextClips`), and the export path all consume these,
 * so an outline paints identically (preview = export, master plan §6).
 *
 * STACK / RENDER MODEL — designed so the next two prompts slot in with no caller
 * churn:
 *   - P6.10 (this prompt): a single stroke layer (color + thickness slider).
 *   - P6.11 (stacking):    >1 layer; painted OUTSIDE-IN (WIDEST first) so a thinner
 *                          layer stacks ON TOP for a multi-ring outline. Already
 *                          honored here — {@link resolveTextStroke} sorts widest-first.
 *   - P6.12 (hollow):      a `hollow` flag means "draw the stroke but NOT the fill"
 *                          (transparent glyph body). Surfaced as
 *                          {@link ResolvedTextStroke.hollow}; the draw caller skips
 *                          the fill when set. Read here so one place owns the shape.
 *
 * DRAW ORDER (P6.10): stroke is painted UNDER the fill (stroke first, then fill on
 * top) so the outline FRAMES the glyph. The canonical full order shadow→fill→stroke
 * is locked by P6.15; for now the caller paints stroke layers, then the fill on top.
 *
 * PURE + headless-safe: {@link resolveTextStroke} / {@link strokeLayerWidth} have
 * NO DOM/canvas (the unit tests assert them directly). Only {@link applyStrokeLayer}
 * touches a `CanvasRenderingContext2D`, and it only SETS thin properties
 * (strokeStyle/lineWidth/lineJoin/miterLimit) a stubbed ctx accepts.
 */
import { isHexColor, rgbaFromHexSafe } from './textFillSpec'

/** One resolved stroke layer — a baked rgba color + a pixel width (> 0). */
export interface ResolvedStrokeLayer {
  /** rgba() string (hex + opacity baked) the canvas accepts as `strokeStyle`. */
  color: string
  /** Outline width in px (> 0 — zero-width layers are dropped on resolve). */
  width: number
}

/**
 * A resolved stroke: the ordered layer list (WIDEST first, ready to paint
 * outside-in) plus the `hollow` flag (P6.12 — when true the caller skips the fill
 * so only the outline shows). An empty `layers` list = no stroke.
 */
export interface ResolvedTextStroke {
  /** Outline layers, WIDEST first (paint in order → thinner layers land on top). */
  layers: ResolvedStrokeLayer[]
  /** Hollow / outline-only body (P6.12): draw the stroke, skip the fill. */
  hollow: boolean
}

/** Defaults a stroke layer's color/opacity fall back to when absent/invalid. */
export interface TextStrokeDefaults {
  /** Hex color used when a layer omits / malforms its color. */
  hex: string
  /** Opacity 0..1 baked into a layer color when none is present. */
  opacity: number
}

/** A solid black, fully-opaque stroke color — the historical outline default. */
export const DEFAULT_TEXT_STROKE: TextStrokeDefaults = { hex: '#000000', opacity: 1 }

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * One stroke layer's open bag → its effective width in px, or 0 when absent /
 * invalid / non-positive. PURE. A width <= 0 means "no stroke" for that layer
 * (the thickness slider's 0 position) — such layers are dropped by
 * {@link resolveTextStroke} so a 0-width stroke never paints.
 */
export function strokeLayerWidth(layer: unknown): number {
  if (typeof layer !== 'object' || layer === null) return 0
  const w = (layer as { width?: unknown }).width
  return isFiniteNum(w) && w > 0 ? w : 0
}

/**
 * Resolve a clip's open `clip.text.stroke` bag (a list of layers, or `undefined`)
 * into a typed {@link ResolvedTextStroke}. PURE.
 *
 * Model: `clip.text.stroke` is an ORDERED LIST `[{ color, width }]`; a single
 * stroke is a 1-element list. Each layer's `width` must be > 0 to paint (a slider
 * at 0 → that layer is DROPPED). Surviving layers are SORTED WIDEST-FIRST so the
 * caller paints them outside-in (a thinner layer lands on top → multi-ring stack,
 * P6.11). Colors are baked through {@link rgbaFromHexSafe} at the layer's opacity
 * (or the default), with an invalid color falling back to `defaults.hex`.
 *
 * Backward compatible / tolerant:
 *   - No `stroke` at all            → `{ layers: [], hollow: false }` (no outline).
 *   - A non-array `stroke`          → no outline (never throws).
 *   - A layer missing `opacity`     → `defaults.opacity` (legacy `{color,width}` opaque).
 *   - A 0 / negative / missing width → that layer dropped (single stroke at 0 = none).
 *   - `hollow` is read from the FIRST layer OR a top-level `stroke.hollow`-style
 *     marker via {@link resolveStrokeHollow} (P6.12 surfaces the toggle).
 */
export function resolveTextStroke(
  stroke: unknown,
  defaults: TextStrokeDefaults = DEFAULT_TEXT_STROKE
): ResolvedTextStroke {
  if (!Array.isArray(stroke)) return { layers: [], hollow: false }

  const layers: ResolvedStrokeLayer[] = []
  for (const raw of stroke) {
    const width = strokeLayerWidth(raw)
    if (width <= 0) continue
    const bag = raw as Record<string, unknown>
    const hex = isHexColor(bag.color) ? (bag.color as string) : defaults.hex
    const opacity = isFiniteNum(bag.opacity) ? clamp01(bag.opacity as number) : defaults.opacity
    layers.push({ color: rgbaFromHexSafe(hex, opacity, defaults.hex), width })
  }
  // OUTSIDE-IN: widest first so a thinner layer paints on top (P6.11 stacking).
  // Stable sort keeps the author's order for equal widths.
  layers.sort((a, b) => b.width - a.width)

  return { layers, hollow: resolveStrokeHollow(stroke) }
}

/**
 * Whether the stroke is HOLLOW / outline-only (P6.12 — transparent glyph body, the
 * fill is skipped). PURE + the SINGLE place that owns "is this stroke hollow". The
 * toggle is read tolerantly from a `hollow === true` marker on ANY entry in the
 * list — the TextPanel toggle (P6.12) stamps it onto every persisted layer (so it
 * survives add/remove a layer), and it equally honors a bare sentinel object
 * `{ hollow: true }` anywhere in the list. PURE / backward compatible:
 *   - No `stroke`, a non-array, or no marked entry → false (solid body, P6.10/P6.11).
 *   - Marked but EMPTY of paintable layers → still true, but {@link resolveTextStroke}
 *     yields `layers: []`, so the draw paths paint nothing (no fill AND no outline).
 *     The UI nudges the user to add a layer; this never crashes.
 */
export function resolveStrokeHollow(stroke: unknown): boolean {
  if (!Array.isArray(stroke)) return false
  return stroke.some(
    (l) => typeof l === 'object' && l !== null && (l as { hollow?: unknown }).hollow === true
  )
}

/**
 * Apply a single stroke LAYER to a canvas context, then return — the caller issues
 * the `strokeText` (kept thin so the per-word / per-cluster / curved draw paths all
 * reuse the SAME layer setup). Sets `strokeStyle` + `lineWidth` from the layer and
 * a sensible `lineJoin`/`miterLimit` for clean glyph corners (round joins avoid the
 * spikes a sharp miter throws on thin serifs). PURE side-effect on `ctx` only.
 *
 * The `width` is already in the clip's LOCAL (font-px) space, so the canvas
 * transform (the compositor's translate/scale) carries it to screen px — preview
 * and export scale the outline identically.
 */
export function applyStrokeLayer(ctx: CanvasRenderingContext2D, layer: ResolvedStrokeLayer): void {
  ctx.strokeStyle = layer.color
  ctx.lineWidth = layer.width
  ctx.lineJoin = 'round'
  ctx.miterLimit = 2
}

/** True when a resolved stroke has at least one paintable layer. */
export function hasStroke(stroke: ResolvedTextStroke): boolean {
  return stroke.layers.length > 0
}

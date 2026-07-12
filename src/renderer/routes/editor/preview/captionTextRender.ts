/**
 * Faithful caption-preset text render (P5.3 — Doc 03; skills `text-render` +
 * `preview-compositor`).
 *
 * This is the SINGLE caption text-render path the preset-gallery thumbnails AND
 * the main preview share, so a thumbnail looks like what applying the preset
 * produces (master-plan parity — one shape, no preview-only renderer). It builds
 * on the existing pure layout math (`layoutTextLines` / `textBlockSize`) rather
 * than re-implementing line stacking: this module adds ONLY the typography that
 * a {@link CaptionPreset} carries (font / fill / stroke / shadow / background
 * decoration) on top of that stacking.
 *
 * SPLIT (testable vs. canvas):
 *   - {@link presetToTextDrawSpec} is PURE — it projects a preset onto a flat
 *     "draw spec" (CSS font shorthand, fill descriptor, stroke layers, shadow,
 *     background box) with NO canvas / DOM. This is what the focused unit tests
 *     exercise (no pixel snapshots).
 *   - {@link drawPresetCaption} owns the imperative `<canvas>` side-effects: it
 *     reads the spec, MEASURES via the injected `ctx.measureText`, lays lines out
 *     with the shared `layoutTextLines`, and paints background → shadow/stroke →
 *     fill. The thumbnail and (later) the live preview both call this.
 *
 * Indic note: line layout already counts/breaks by the caller's lines; the
 * grapheme-cluster REVEAL (typewriter / wipe) is P5.5/P5.6. The thumbnail is a
 * representative STATIC frame, so it draws the full sample string — but the
 * font/fallback chain resolved here is the Indic-capable default so Tamil shapes.
 */
import type {
  CaptionPreset,
  GradientStop,
  PresetFill,
  PresetFont,
  PresetShadow,
  PresetStrokeLayer
} from '../../../../shared/captionPreset'
import { layoutGlyphBoxes, layoutTextLines, textBlockSize, type MeasureWidth, type TextAlign } from './textLayout'
import { clamp01 as sharedClamp01, fillToCanvasPaint, rgbaFromHexSafe } from './textFillSpec'
import { resolveTextStroke, type ResolvedTextStroke } from './textStrokeSpec'
import { resolveTextShadow, type ResolvedTextShadow } from './textShadowSpec'
import { paintGlyphPasses, type EffectsPass } from './textPaintPipeline'
import {
  drawDecorationBackground,
  drawDecorationRules,
  drawHighlightBars,
  resolveDecoration,
  resolveRule,
  type ResolvedBackground,
  type ResolvedHighlightBar,
  type ResolvedTextRule
} from './textDecorationSpec'

// ---------------------------------------------------------------------------
// Pure: preset → flat draw spec
// ---------------------------------------------------------------------------

/**
 * A background box behind the caption text (mirrors preset `decoration.background`).
 * This IS the shared {@link ResolvedBackground} (P7.8) the live preview + export
 * draw, so a thumbnail's bubble matches the applied caption (one resolver, one rect
 * math). Symmetric `paddingX`/`paddingY` carry the preset's single `padding`.
 */
export type DrawBackgroundSpec = ResolvedBackground

/** A fill descriptor — solid hex (with opacity) or an ordered gradient stop list. */
export type DrawFillSpec =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; stops: GradientStop[]; opacity: number }

/**
 * A flat, canvas-agnostic description of how to paint a caption with a preset.
 * Everything here is data the unit tests can assert without a canvas; the canvas
 * draw routine ({@link drawPresetCaption}) consumes it verbatim.
 */
export interface TextDrawSpec {
  /** CSS `font` shorthand (style weight size family, fallback joined). */
  font: string
  /** Font size in px (drives line height / measurement / layout). */
  fontSizePx: number
  /** Line-height multiple. */
  lineHeight: number
  /** Extra tracking px (canvas `letterSpacing`, when supported). */
  letterSpacing: number
  fill: DrawFillSpec
  /** Outline layers, painted WIDEST first so thinner layers stack on top. */
  stroke: { color: string; width: number }[]
  /**
   * Resolved shadow (P6.13) ready for `ctx.shadow*`, or `null` for no shadow. The
   * SHARED {@link ResolvedTextShadow} the live preview + export also use, so a
   * thumbnail casts the same shadow as the applied caption (one shape).
   */
  shadow: ResolvedTextShadow | null
  background: DrawBackgroundSpec | null
  /**
   * Per-line UNDERLINE rule (P7.9), or `null` for none. The SHARED
   * {@link ResolvedTextRule} the live preview + export draw, so a thumbnail's
   * underline scales + sits at the baseline exactly like the applied caption.
   */
  underline?: ResolvedTextRule | null
  /** Per-line STRIKETHROUGH rule (P7.9), or `null` for none. */
  strike?: ResolvedTextRule | null
  /**
   * Per-word / full-line highlight BARS (P7.10 — the marker/highlighter look), or
   * `null` for none. The SHARED {@link ResolvedHighlightBar} the live preview + export
   * draw, so a thumbnail's bars frame the run bounds exactly like the applied caption.
   */
  highlight?: ResolvedHighlightBar | null
  /**
   * Phase-7 EFFECTS pass (P7.1 — Doc 04), run at the canonical pass-5 hook over the
   * painted glyph. OPTIONAL: omitted today (a preset thumbnail has no effect stack),
   * so the thumbnail output is unchanged. Plumbed through {@link drawPresetCaption}
   * so a future per-clip thumbnail can build it with `composeEffectsPass` and render
   * the SAME effect stack as the live preview (parity). `undefined` → no-op.
   */
  effects?: EffectsPass
}

/** Quote a font family token if it contains spaces (CSS `font` shorthand). */
function quoteFamily(family: string): string {
  return /\s/.test(family) ? `"${family}"` : family
}

/**
 * The full CSS `font` family list: the preset family first, then its fallback
 * chain (de-duplicated, family first). Each space-containing token is quoted.
 */
export function fontFamilyList(font: PresetFont): string {
  const families = [font.family, ...(font.fallback ?? [])]
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const f of families) {
    const key = f.trim()
    if (key.length === 0 || seen.has(key)) continue
    seen.add(key)
    ordered.push(quoteFamily(key))
  }
  return ordered.join(', ')
}

/**
 * Build the CSS `font` shorthand for a preset font: `[italic] weight size family`.
 * Weight maps `'bold'`/`'normal'`/numeric straight through (canvas accepts all).
 */
export function cssFontShorthand(font: PresetFont): string {
  const style = font.italic ? 'italic ' : ''
  const weight = typeof font.weight === 'number' ? String(font.weight) : font.weight
  return `${style}${weight} ${font.size}px ${fontFamilyList(font)}`
}

/** Clamp a number into [0,1]. Re-exported shared impl (single source of truth). */
const clamp01 = sharedClamp01

/**
 * A hex color + an opacity 0..1 → an `rgba(...)` string the canvas accepts.
 * Delegates to the shared {@link rgbaFromHexSafe} (P6.7) so the thumbnail, the live
 * preview, and the export path bake hex+opacity identically (one source of truth);
 * opacity is clamped to [0,1] and an invalid hex falls back to white.
 */
export function rgbaFromHex(hex: string, opacity: number): string {
  return rgbaFromHexSafe(hex, opacity)
}

/** Build the fill descriptor from a preset fill (solid bakes opacity; gradient keeps stops). */
function resolveFill(fill: PresetFill): DrawFillSpec {
  if (fill.type === 'gradient') {
    const stops = Array.isArray(fill.value) ? (fill.value as GradientStop[]) : []
    return { type: 'gradient', stops, opacity: clamp01(fill.opacity) }
  }
  const hex = typeof fill.value === 'string' ? fill.value : '#ffffff'
  return { type: 'solid', color: rgbaFromHex(hex, fill.opacity) }
}

/**
 * Build the resolved shadow (P6.13) from a preset shadow; `null` when absent. The
 * angle→offset + color baking is the SHARED {@link resolveTextShadow} the live
 * preview + export use, so a thumbnail's shadow geometry matches the applied
 * caption exactly (one resolver). A `distance <= 0` resolves to `null` (no shadow).
 */
function resolveShadow(shadow: PresetShadow | undefined): ResolvedTextShadow | null {
  return resolveTextShadow(shadow)
}

/**
 * Build the stroke layer list, painted WIDEST first so thinner layers sit on top.
 * Delegates to the shared {@link resolveTextStroke} (P6.10) — the SINGLE stroke
 * resolver the live preview + export also use — so the thumbnail outline matches
 * the applied caption (one shape). Preset stroke colors are plain hex (opacity 1),
 * which the shared resolver bakes to rgba identically to the preview path.
 */
function resolveStroke(stroke: PresetStrokeLayer[] | undefined): { color: string; width: number }[] {
  return resolveTextStroke(stroke).layers
}

/**
 * PURE projection of a {@link CaptionPreset} onto a flat {@link TextDrawSpec}.
 * No canvas / DOM — the unit tests assert this directly. The canvas routine and
 * the live preview both consume the result, so the thumbnail and the applied
 * caption share ONE description.
 */
export function presetToTextDrawSpec(preset: CaptionPreset): TextDrawSpec {
  const bg = preset.decoration?.background
  const deco = preset.decoration as Record<string, unknown> | undefined
  return {
    font: cssFontShorthand(preset.font),
    fontSizePx: preset.font.size,
    lineHeight: preset.font.lineHeight,
    letterSpacing: preset.font.letterSpacing,
    fill: resolveFill(preset.fill),
    stroke: resolveStroke(preset.stroke),
    shadow: resolveShadow(preset.shadow),
    // Per-line underline/strike (P7.9) — resolved with the SHARED rule resolver so a
    // preset thumbnail draws the same baseline-aware, size-scaled rules as the applied
    // caption. Absent → `null` (no rule), so an existing preset's thumbnail is unchanged.
    underline: resolveRule(deco?.underline),
    strike: resolveRule(deco?.strike),
    // Highlight BARS (P7.10) — the marker/highlighter look, resolved with the SHARED
    // decoration resolver from the preset's open `decoration` bag (`highlightBar` /
    // legacy `highlight`). Distinct from the caption active-word `preset.highlight`
    // (P5.6). Absent → `null`, so an existing preset's thumbnail is unchanged.
    highlight: resolveDecoration(deco).highlight,
    background:
      bg === undefined
        ? null
        : {
            color: rgbaFromHex(bg.color, bg.opacity),
            paddingX: Math.max(0, bg.padding),
            paddingY: Math.max(0, bg.padding),
            radius: Math.max(0, bg.radius)
          }
  }
}

// ---------------------------------------------------------------------------
// Pure: fit a spec into a small thumbnail (so big preset fonts still fit)
// ---------------------------------------------------------------------------

/** Sample caption text the gallery renders for every preset (one short line). */
export const SAMPLE_CAPTION_TEXT = 'Sample Caption'

/**
 * Compute the uniform scale that fits a measured text block (at the spec's font
 * size) inside a thumbnail of `boxW`×`boxH`, leaving `marginPx` of breathing
 * room on every side (and room for the background padding). Never upscales past
 * 1 (a small caption stays its size); clamps to a small floor so it stays legible.
 *
 * PURE — `blockW`/`blockH` come from the shared `textBlockSize`, so this is fully
 * testable without a canvas.
 */
export function fitScale(
  blockW: number,
  blockH: number,
  boxW: number,
  boxH: number,
  padding: number,
  marginPx: number
): number {
  const availW = boxW - 2 * (marginPx + padding)
  const availH = boxH - 2 * (marginPx + padding)
  if (blockW <= 0 || blockH <= 0 || availW <= 0 || availH <= 0) return 1
  const scale = Math.min(availW / blockW, availH / blockH, 1)
  return Math.max(scale, 0.05)
}

// ---------------------------------------------------------------------------
// Canvas draw (side-effecting) — reuses the shared layout math
// ---------------------------------------------------------------------------

/** Options for {@link drawPresetCaption}. */
export interface DrawPresetCaptionOptions {
  /** Canvas width in px (backing-store pixels). */
  width: number
  /** Canvas height in px. */
  height: number
  /** The lines to render (a thumbnail passes `[SAMPLE_CAPTION_TEXT]`). */
  lines: string[]
  align?: TextAlign
  /** Optional backdrop fill behind everything (thumbnail card background). */
  backdrop?: string
  /** Inner margin kept clear when auto-fitting the text into the box. */
  marginPx?: number
}

/**
 * Paint a caption with `spec` onto a 2D canvas, REUSING the shared
 * `textBlockSize` / `layoutTextLines` math for line stacking + alignment (no
 * separate text layout). Each line block is painted through the SINGLE canonical
 * pipeline ({@link paintGlyphPasses}) the live preview uses, so the thumbnail
 * follows the EXACT SAME locked order (P6.15): background box → shadow → stroke
 * (widest→thinnest) → fill → inner shadow → effects hook. The block is auto-fit
 * (downscaled only) so a large preset font still fits a small thumbnail.
 *
 * The DECORATION layers here follow the locked `DECORATION_RENDER_ORDER` (P7.12) —
 * the SINGLE documented order this and `PreviewCanvas.drawTextClips` both obey, so
 * preview == thumbnail == export: clip-bg → background bubble → highlight bars →
 * [glyph passes incl. effects] → underline/strike.
 *
 * Returns the applied uniform scale (useful for tests/telemetry). Safe to call
 * with a stubbed `ctx` in non-DOM environments.
 */
export function drawPresetCaption(
  ctx: CanvasRenderingContext2D,
  spec: TextDrawSpec,
  opts: DrawPresetCaptionOptions
): number {
  const { width, height, lines } = opts
  const align: TextAlign = opts.align ?? 'center'
  const margin = opts.marginPx ?? 8

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, width, height)
  if (opts.backdrop !== undefined) {
    ctx.fillStyle = opts.backdrop
    ctx.fillRect(0, 0, width, height)
  }

  // Measure with the resolved font (shared layout math is measurer-injected).
  // letterSpacing is fed to the layout math AND set on the context below so the
  // measured block width and the painted advance agree (preview = export).
  ctx.font = spec.font
  const measure: MeasureWidth = (line) => ctx.measureText(line).width
  const block = textBlockSize(lines, spec.fontSizePx, spec.lineHeight, measure, spec.letterSpacing)
  const padding = spec.background?.paddingX ?? 0
  const scale = fitScale(block.w, block.h, width, height, padding, margin)

  ctx.save()
  ctx.translate(width / 2, height / 2)
  ctx.scale(scale, scale)

  // Background BUBBLE behind the (local-space) block — the SHARED P7.8 draw, so the
  // thumbnail frames the block exactly as the live preview + export do (one rect
  // math, one fill). The block box is centered on the local origin.
  drawDecorationBackground(ctx, spec.background, {
    x: -block.w / 2,
    y: -block.h / 2,
    width: block.w,
    height: block.h
  })

  // Highlight BARS (P7.10): drawn AFTER the bubble and BEFORE the glyph passes
  // (render order: bubble → highlight bars → glyphs → underline/strike), framing the
  // run/word/line bounds from `layoutGlyphBoxes`. Same SHARED draw the live preview +
  // export run, so the thumbnail's bars match the applied caption. `null` → no-op.
  const highlight = spec.highlight ?? null
  if (highlight !== null) {
    const barLines = layoutGlyphBoxes(
      lines,
      { fontSizePx: spec.fontSizePx, lineHeightMult: spec.lineHeight, align, letterSpacing: spec.letterSpacing },
      measure
    ).lines
    drawHighlightBars(ctx, highlight, barLines)
  }

  const laid = layoutTextLines(lines, spec.fontSizePx, spec.lineHeight, align, measure, spec.letterSpacing)
  ctx.font = spec.font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if ('letterSpacing' in ctx) {
    try {
      ;(ctx as unknown as { letterSpacing: string }).letterSpacing = `${spec.letterSpacing}px`
    } catch {
      /* not supported in this canvas impl — tracking is cosmetic, skip */
    }
  }

  // Wrap the spec's widest-first stroke layers as a ResolvedTextStroke so the
  // canonical pipeline frames the glyph identically to the live preview. Preset
  // strokes are never hollow (the hollow body is a clip-level P6.12 toggle).
  const stroke: ResolvedTextStroke | null =
    spec.stroke.length > 0 ? { layers: spec.stroke, hollow: false } : null
  const linePaint = fillStyle(ctx, spec.fill, block.w)

  for (const l of laid) {
    if (l.line.length === 0) continue
    // The SINGLE canonical pipeline (P6.15): shadow (drop/long behind) → stroke
    // (widest→thinnest) → fill → inner shadow → effects hook. Same order + same
    // function the live preview runs, so the thumbnail = the applied caption.
    paintGlyphPasses({
      ctx,
      token: { text: l.line, x: l.x, y: l.y },
      shadow: spec.shadow,
      stroke,
      effects: spec.effects,
      fill: (c, tk) => {
        c.fillStyle = linePaint
        c.fillText(tk.text, tk.x, tk.y)
      }
    })
  }

  // Per-line underline / strike rules (P7.9) — one baseline-aware, size-scaled rule
  // per visual line, spanning the measured line box (alignment-aware). Uses the SAME
  // shared draw the live preview/export run, so the thumbnail rule matches the applied
  // caption. Default rule color = the solid glyph fill (gradient → white fallback).
  const underline = spec.underline ?? null
  const strike = spec.strike ?? null
  if (underline !== null || strike !== null) {
    const boxes = layoutGlyphBoxes(
      lines,
      { fontSizePx: spec.fontSizePx, lineHeightMult: spec.lineHeight, align, letterSpacing: spec.letterSpacing },
      measure
    ).lines.map((lb) => lb.box)
    const ruleFill = spec.fill.type === 'solid' ? spec.fill.color : 'rgba(255, 255, 255, 1)'
    drawDecorationRules(ctx, underline, strike, boxes, spec.fontSizePx, ruleFill)
  }

  ctx.restore()
  return scale
}

/**
 * Resolve a fill spec to a canvas fill style (string or a CanvasGradient).
 * Delegates to the shared {@link fillToCanvasPaint} (P6.7) so the thumbnail and the
 * live preview build the SAME paint; the thumbnail gradient is horizontal (angle 0).
 */
function fillStyle(
  ctx: CanvasRenderingContext2D,
  fill: DrawFillSpec,
  blockW: number
): string | CanvasGradient {
  if (fill.type === 'solid') return fillToCanvasPaint(ctx, fill, blockW)
  return fillToCanvasPaint(ctx, { type: 'gradient', stops: fill.stops, opacity: fill.opacity, angleDeg: 0 }, blockW)
}

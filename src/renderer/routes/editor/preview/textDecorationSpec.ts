/**
 * Resolve a text clip's DECORATIONS (P7.8+ — Doc 05 decorations; skill `text-render`).
 *
 * `clip.text.decoration` is an OPEN `Record<string, unknown>` (project-schema),
 * mirroring the preset `PresetDecoration` shape:
 *   `{ background:{color,opacity,padding,radius}, underline, strike,
 *      highlight:{color,opacity,radius}, emoji[] }`
 * This module is the SINGLE pure projection from that open bag onto a
 * strongly-typed {@link ResolvedDecoration}, plus the SINGLE place that draws each
 * decoration onto a `CanvasRenderingContext2D`. The thumbnail render
 * (`captionTextRender`), the live preview (`PreviewCanvas.drawTextClips`), and the
 * export path all consume these, so a decoration paints identically everywhere
 * (preview = export, master plan §6).
 *
 * It mirrors the existing `textFillSpec` / `textStrokeSpec` / `textShadowSpec`
 * pattern: a PURE resolver + PURE geometry helpers (unit-tested directly with no
 * canvas), and thin canvas helpers that only issue path/fill ops a stubbed ctx
 * accepts.
 *
 * DECORATION MODEL — designed so the rest of Phase 7 slots in with NO caller churn:
 *   - P7.8 (this prompt): the BACKGROUND BUBBLE — a rounded rect behind the whole
 *     measured text block (color + opacity + padding + corner radius). Surfaced as
 *     {@link ResolvedDecoration.background} and drawn by {@link drawDecorationBackground}.
 *   - P7.9 (underline/strike): baseline-aware rules per line. Will surface as
 *     `underline` / `strike` flags (already resolved here as booleans) + a per-line
 *     draw that reads the {@link GlyphBox} line boxes — same `layoutGlyphBoxes`
 *     geometry the bubble's block box comes from.
 *   - P7.10 (this prompt): highlight BARS — per-word / full-line colored rounded rects
 *     behind glyphs (a marker/highlighter look). Surfaced as {@link ResolvedHighlightBar}
 *     on {@link ResolvedDecoration.highlight} and drawn by {@link drawHighlightBars},
 *     which reuses {@link bubbleRect} per word/line box (the rect math is box-agnostic
 *     on purpose). NAMED `highlightBar` in the persisted bag — DISTINCT from the
 *     caption active-word `PresetHighlight` (P5.6), which is a karaoke color/scale on
 *     the spoken word and lives on the preset, NOT on `clip.text.decoration`.
 *   - P7.11 (inline emoji): emoji tokens in the run flow — orthogonal to the rect
 *     math here; will hang off `clip.text.decoration.emoji[]` (resolved as a list).
 *   - P7.12 (panel + render order): the canonical order is clip-bg → DECORATIONS →
 *     effects → glyph passes. The bubble specifically goes behind the WHOLE block,
 *     before the shadow/stroke/fill glyph passes; this module gives the caller the
 *     background draw it issues FIRST (see {@link drawDecorationBackground}).
 *
 * BLOCK vs PER-LINE (the decision, documented):
 *   The background bubble frames the WHOLE measured text BLOCK (one rounded rect
 *   behind every line), NOT a rect per line. This matches the established caption
 *   look (one bubble behind a multi-line caption, as CapCut/most presets do) and
 *   the existing thumbnail renderer (`drawPresetCaption` already drew one block
 *   box). Per-line / per-word boxes are the HIGHLIGHT-BAR territory (P7.10) — and
 *   because {@link bubbleRect} takes ANY box, that prompt reuses it per line/word
 *   with no new geometry. The block box comes from the shared `textBlockSize` /
 *   `layoutGlyphBoxes` (P6.4), so the bubble tightly frames text + padding and
 *   lines up with the glyphs across multi-line text.
 *
 * PURE + headless-safe: {@link bubbleRect} / {@link resolveDecoration} have NO
 * DOM/canvas (the unit tests assert them directly). Only {@link drawDecorationBackground}
 * / {@link pathRoundRect} touch a `CanvasRenderingContext2D`, and only to SET thin
 * properties + issue path/fill ops a stubbed ctx accepts.
 */
import { clamp01, isHexColor, rgbaFromHexSafe } from './textFillSpec'
import type { GlyphBox } from './textLayout'

/**
 * THE LOCKED DECORATION RENDER ORDER (P7.12 — Doc 05; skill `text-render`).
 *
 * This is the SINGLE canonical statement of where each decoration sits relative to
 * the clip background and the Phase-7 effect stack, shared by EVERY draw path
 * (live preview `PreviewCanvas.drawTextClips`, thumbnail/export
 * `drawPresetCaption`), so preview == export == thumbnail. The runbook contract is
 * "decorations render BENEATH effects, ABOVE clip bg":
 *
 *   0. CLIP BACKGROUND        — the compositor backdrop / underlying video frame.
 *   1. BACKGROUND BUBBLE      — one rounded rect behind the WHOLE text block
 *                               (`drawDecorationBackground`). ABOVE clip bg.
 *   2. HIGHLIGHT BARS         — per-word / per-line marker rects at run bounds
 *                               (`drawHighlightBars`). ABOVE the bubble.
 *   --- glyph layer (one pass-pipeline per token, `paintGlyphPasses`) -------------
 *   3. shadow (drop/long)     — behind the glyph body.
 *   4. stroke                 — widest → thinnest.
 *   5. fill                   — the glyph body.
 *   6. inner shadow           — over the body.
 *   7. EFFECTS                — the ordered `text.effects[]` stack (Doc 04), composed
 *                               at pass 5 of the pipeline OVER the painted glyph.
 *   ------------------------------------------------------------------------------
 *   8. UNDERLINE / STRIKE     — baseline-aware per-line rules (`drawDecorationRules`),
 *                               drawn just after the glyph fill so they read against
 *                               the baseline / x-height. They sit WITH the glyphs but,
 *                               per the contract, beneath the effects' final composite
 *                               (effects compose during the glyph passes, step 7).
 *   9. active-word highlight  — the karaoke overlay (P5.6 `PresetHighlight`), painted
 *                               LAST; NOT a `text.decoration` (a preset concern).
 *
 * The BACKGROUND-TYPE decorations (bubble, bars) are above the clip bg and below the
 * glyph/effects layer; the LINE decorations (underline/strike) ride with the glyphs
 * but beneath the effect composite — exactly the "beneath effects, above clip bg"
 * contract. The numeric `step` is the load-bearing ordering both draw paths assert
 * against in `textDecorationSpec.test.ts`.
 */
export const DECORATION_RENDER_ORDER = {
  clipBackground: 0,
  backgroundBubble: 1,
  highlightBars: 2,
  glyphShadow: 3,
  glyphStroke: 4,
  glyphFill: 5,
  glyphInnerShadow: 6,
  effects: 7,
  underlineStrike: 8,
  activeWordHighlight: 9
} as const

/**
 * A resolved background bubble — the baked rgba color (hex + opacity), symmetric
 * padding (x/y), and a corner radius, ready for {@link bubbleRect} + a fill. A
 * `null` background (see {@link resolveDecoration}) means "no bubble".
 */
export interface ResolvedBackground {
  /** rgba() string (hex + opacity baked) the canvas accepts as `fillStyle`. */
  color: string
  /** Horizontal padding px (>= 0) added to EACH side of the text box. */
  paddingX: number
  /** Vertical padding px (>= 0) added to the TOP and BOTTOM of the text box. */
  paddingY: number
  /** Corner radius px (>= 0); clamped to half the rect's min dimension at draw. */
  radius: number
}

/**
 * A resolved per-line RULE — an underline or a strikethrough (P7.9). A `null` rule
 * (see {@link resolveDecoration}) means "no rule". The geometry (thickness + the
 * exact y) is computed PER LINE at draw time by {@link underlineGeometry} /
 * {@link strikeGeometry} from the font size + line box, so a rule scales with the
 * font and sits correctly relative to the baseline at ANY size. Only the COLOR and
 * an optional thickness OVERRIDE are author-controlled here.
 */
export interface ResolvedTextRule {
  /**
   * The rule's stroke color — an rgba() string the canvas accepts. `null` means
   * "use the glyph FILL color" (the typographic default: an underline matches the
   * text). The draw path passes the resolved fill color in for the `null` case.
   */
  color: string | null
  /**
   * An explicit thickness OVERRIDE in px (> 0), or `null` to derive it from the
   * font size ({@link ruleThickness}). An override still does NOT scale with size.
   */
  thickness: number | null
}

/**
 * Which boxes a highlight BAR (P7.10) frames: one bar per WORD box, or one bar per
 * LINE box. This is the marker/highlighter MODE — distinct from the caption
 * active-word system (P5.6 `PresetHighlight`), which is a karaoke COLOR/SCALE on the
 * spoken word, not a static marker bar.
 */
export type HighlightBarMode = 'word' | 'line'

/**
 * A resolved highlight BAR (P7.10 — the marker/highlighter look): a colored rounded
 * rect drawn BEHIND the glyphs (above the background bubble, below the glyph passes),
 * either per WORD box or per LINE box ({@link mode}). The baked rgba {@link color}
 * (hex + opacity), symmetric padding (x/y) the run/word/line box is expanded by, and
 * a corner radius — reusing {@link bubbleRect} per box. A `null` highlight (see
 * {@link resolveDecoration}) means "no bars".
 *
 * NAMED `highlightBar` / `marker` in the persisted bag (NOT `PresetHighlight`) so it
 * never collides with the caption active-word highlight (P5.6), which lives on the
 * preset, not on `clip.text.decoration`.
 */
export interface ResolvedHighlightBar {
  /** rgba() string (hex + opacity baked) the canvas accepts as `fillStyle`. */
  color: string
  /** `'word'` → one bar per word box; `'line'` → one bar per line box. */
  mode: HighlightBarMode
  /** Horizontal padding px (>= 0) the framed box is expanded by on EACH side. */
  paddingX: number
  /** Vertical padding px (>= 0) the framed box is expanded by TOP + BOTTOM. */
  paddingY: number
  /** Corner radius px (>= 0); clamped to half the rect's min dimension at draw. */
  radius: number
}

/**
 * A resolved decoration bundle. {@link background} (P7.8) + {@link underline} /
 * {@link strike} (P7.9) + {@link highlight} (P7.10) are all drawn today. A
 * fully-absent / no-op decoration resolves every field to `null`.
 */
export interface ResolvedDecoration {
  /** The background bubble behind the whole text block, or `null` for none. */
  background: ResolvedBackground | null
  /** Per-line underline rule (P7.9), or `null` for none. */
  underline: ResolvedTextRule | null
  /** Per-line strikethrough rule (P7.9), or `null` for none. */
  strike: ResolvedTextRule | null
  /** Per-word / full-line highlight BARS (P7.10 marker look), or `null` for none. */
  highlight: ResolvedHighlightBar | null
}

/** Defaults a background's color/opacity fall back to when absent/invalid. */
export interface DecorationDefaults {
  /** Hex color a background falls back to when it omits / malforms its color. */
  hex: string
  /** Opacity 0..1 baked when the background omits an explicit opacity. */
  opacity: number
}

/** A semi-transparent black bubble — the historical caption-box default. */
export const DEFAULT_DECORATION_BACKGROUND: DecorationDefaults = { hex: '#000000', opacity: 0.5 }

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}
/** A finite non-negative number, else `fallback`. */
function nonNeg(v: unknown, fallback = 0): number {
  return isFiniteNum(v) && v >= 0 ? v : fallback
}

/**
 * The rounded-rect geometry of a background bubble, in the SAME centered local px
 * space the draw path uses (the caller paints it before translating into glyph
 * space; it is relative to the block center exactly like a {@link GlyphBox}).
 * `x`/`y` are the TOP-LEFT corner; `w`/`h` the size; `r` the (already clamped)
 * corner radius.
 */
export interface BubbleRect {
  x: number
  y: number
  w: number
  h: number
  /** Corner radius, CLAMPED to half the smaller of `w`/`h` (so it never overlaps). */
  r: number
}

/**
 * PURE bubble-rect math (the load-bearing geometry of P7.8). Expand a measured
 * text `box` (a {@link GlyphBox} — the whole block box, or any per-line/word box a
 * later prompt passes) by `paddingX` on each horizontal side and `paddingY` on the
 * top + bottom, and CLAMP the corner `radius` to half the smaller of the resulting
 * width/height so the rounded corners never overlap (a huge radius → a stadium/pill,
 * never an invalid path).
 *
 *   w = box.width  + 2·paddingX
 *   h = box.height + 2·paddingY
 *   x = box.x − paddingX,  y = box.y − paddingY
 *   r = clamp(radius, 0, min(w, h) / 2)
 *
 * Negative padding/radius are floored to 0 (the slider's zero position). A degenerate
 * (zero-size) box still yields a valid rect (w/h floored at 0, r at 0). PURE — the
 * unit tests assert it directly with no canvas.
 */
export function bubbleRect(
  box: GlyphBox,
  paddingX: number,
  paddingY: number,
  radius: number
): BubbleRect {
  const px = nonNeg(paddingX)
  const py = nonNeg(paddingY)
  const w = Math.max(0, box.width) + 2 * px
  const h = Math.max(0, box.height) + 2 * py
  const x = box.x - px
  const y = box.y - py
  const r = Math.max(0, Math.min(nonNeg(radius), w / 2, h / 2))
  return { x, y, w, h, r }
}

/**
 * Resolve a clip's open `clip.text.decoration` bag (or `undefined`) into a typed
 * {@link ResolvedDecoration}. PURE.
 *
 * Backward compatible / tolerant — a clip without decorations, or with a malformed
 * one, resolves to an all-`null`/`false` (no-op) decoration so existing clips never
 * gain a bubble:
 *   - No `decoration` / non-object        → no background, no rules, no highlight.
 *   - No `background` / non-object         → `background: null` (no bubble).
 *   - `background.opacity <= 0`            → `null` (a fully transparent bubble = none).
 *   - missing `opacity`                    → `defaults.opacity`.
 *   - invalid / missing color              → `defaults.hex` baked at the opacity.
 *   - `padding` (a single number)          → used for BOTH x and y; `paddingX`/`paddingY`
 *                                            override it per axis when present.
 *   - missing / negative padding / radius  → 0.
 *
 * `padding` accepts EITHER a single number (symmetric, the Doc-05 shape) OR explicit
 * `paddingX` / `paddingY` overrides, so the simple slider stays one knob while a
 * future per-axis control slots in with no resolver change.
 */
export function resolveDecoration(
  decoration: unknown,
  defaults: DecorationDefaults = DEFAULT_DECORATION_BACKGROUND
): ResolvedDecoration {
  if (!isObj(decoration)) {
    return { background: null, underline: null, strike: null, highlight: null }
  }

  return {
    background: resolveBackground(decoration.background, defaults),
    underline: resolveRule(decoration.underline),
    strike: resolveRule(decoration.strike),
    // The marker/highlighter BARS — read from `highlightBar` (preferred, distinct
    // from `PresetHighlight`) OR a legacy `highlight` key, never the caption
    // active-word system. `highlightBar` wins when both are present.
    highlight: resolveHighlightBar(decoration.highlightBar ?? decoration.highlight)
  }
}

/**
 * Resolve an `underline` / `strike` sub-bag into a {@link ResolvedTextRule}, or
 * `null` for "no rule". PURE + backward compatible. ACCEPTS:
 *   - `true`                    → an ON rule with NO color (matches the glyph fill)
 *                                 and a size-derived thickness.
 *   - `false` / absent / junk   → `null` (no rule — existing clips never gain one).
 *   - `{ enabled:false }`       → `null`.
 *   - `{ enabled?:true, color?, thickness? }` → an ON rule; a valid hex color bakes
 *     to opaque rgba (a rule is its own solid line; opacity rides the clip alpha),
 *     a positive finite `thickness` is a px OVERRIDE, else both fall back (color →
 *     glyph fill, thickness → size-derived).
 *
 * An object WITHOUT `enabled` is treated as ON (authoring `{ color: '#f00' }` means
 * "underline in red"); only an explicit `enabled:false` turns it off.
 */
export function resolveRule(rule: unknown): ResolvedTextRule | null {
  if (rule === true) return { color: null, thickness: null }
  if (!isObj(rule)) return null
  if (rule.enabled === false) return null
  const color = isHexColor(rule.color) ? rgbaFromHexSafe(rule.color as string, 1) : null
  const thickness = isFiniteNum(rule.thickness) && rule.thickness > 0 ? rule.thickness : null
  return { color, thickness }
}

/** Resolve the `decoration.background` sub-bag (or `null`). PURE. */
function resolveBackground(
  background: unknown,
  defaults: DecorationDefaults
): ResolvedBackground | null {
  if (!isObj(background)) return null

  const opacity = isFiniteNum(background.opacity) ? clamp01(background.opacity) : defaults.opacity
  // A fully-transparent bubble is "no bubble" (the slider's zero position).
  if (!(opacity > 0)) return null

  const hex = isHexColor(background.color) ? (background.color as string) : defaults.hex
  // `padding` (symmetric) is the Doc-05 single-knob shape; explicit paddingX/paddingY
  // override per axis when a future control supplies them.
  const symmetric = nonNeg(background.padding)
  const paddingX = isFiniteNum(background.paddingX) ? nonNeg(background.paddingX) : symmetric
  const paddingY = isFiniteNum(background.paddingY) ? nonNeg(background.paddingY) : symmetric

  return {
    color: rgbaFromHexSafe(hex, opacity, defaults.hex),
    paddingX,
    paddingY,
    radius: nonNeg(background.radius)
  }
}

/** The highlighter-pen yellow a bar falls back to when it omits / malforms its color. */
export const DEFAULT_HIGHLIGHT_BAR_HEX = '#ffe600'
/** A highlighter bar is semi-transparent by default (it sits BEHIND the glyphs). */
export const DEFAULT_HIGHLIGHT_BAR_OPACITY = 0.4

/**
 * Resolve a `decoration.highlightBar` (or legacy `decoration.highlight`) sub-bag into
 * a typed {@link ResolvedHighlightBar} (P7.10 — the marker/highlighter BARS), or
 * `null` for "no bars". PURE + backward compatible / tolerant:
 *   - non-object / absent          → `null` (existing clips never gain bars).
 *   - `enabled:false`              → `null`.
 *   - `opacity <= 0`               → `null` (a fully-transparent bar = none).
 *   - missing `opacity`            → {@link DEFAULT_HIGHLIGHT_BAR_OPACITY}.
 *   - invalid / missing color      → {@link DEFAULT_HIGHLIGHT_BAR_HEX} baked at opacity.
 *   - `mode` other than `'line'`   → `'word'` (per-word is the default marker look).
 *   - `padding` (a single number)  → BOTH x and y; `paddingX`/`paddingY` override
 *                                    per axis when present.
 *   - missing / negative padding / radius → 0.
 *
 * An object WITHOUT `enabled` is treated as ON (authoring `{ color:'#ff0' }` means
 * "highlight in yellow"); only an explicit `enabled:false` turns it off — matching
 * {@link resolveRule}. This is DISTINCT from the caption active-word `PresetHighlight`
 * (P5.6); it never reads that system.
 */
function resolveHighlightBar(highlight: unknown): ResolvedHighlightBar | null {
  if (!isObj(highlight)) return null
  if (highlight.enabled === false) return null
  const opacity = isFiniteNum(highlight.opacity) ? clamp01(highlight.opacity) : DEFAULT_HIGHLIGHT_BAR_OPACITY
  if (!(opacity > 0)) return null
  const hex = isHexColor(highlight.color) ? (highlight.color as string) : DEFAULT_HIGHLIGHT_BAR_HEX
  const mode: HighlightBarMode = highlight.mode === 'line' ? 'line' : 'word'
  const symmetric = nonNeg(highlight.padding)
  const paddingX = isFiniteNum(highlight.paddingX) ? nonNeg(highlight.paddingX) : symmetric
  const paddingY = isFiniteNum(highlight.paddingY) ? nonNeg(highlight.paddingY) : symmetric
  return {
    color: rgbaFromHexSafe(hex, opacity, DEFAULT_HIGHLIGHT_BAR_HEX),
    mode,
    paddingX,
    paddingY,
    radius: nonNeg(highlight.radius)
  }
}

/** True when a resolved decoration would draw a background bubble. Sugar. */
export function hasBackground(decoration: ResolvedDecoration): boolean {
  return decoration.background !== null
}

// ---------------------------------------------------------------------------
// Canvas draw (side-effecting) — thin. The geometry is in `bubbleRect` above.
// ---------------------------------------------------------------------------

/**
 * Path a rounded rectangle on `ctx` (radius already clamped by {@link bubbleRect}).
 * Thin + shared so the bubble, the thumbnail, and a future highlight bar (P7.10)
 * path identically. A 0 radius gives sharp corners (Doc 05 "0 = sharp"). PURE
 * side-effect on `ctx` only (begins + closes a path; the caller fills/strokes).
 */
export function pathRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * Draw the background BUBBLE behind a measured text `box` (the whole block box). The
 * SINGLE place a resolved {@link ResolvedBackground} is painted, so the thumbnail,
 * the live preview, and export draw one identical bubble. Issued FIRST (before the
 * shadow/stroke/fill glyph passes) so it sits BEHIND the text (P7.12 render order:
 * clip-bg → decoration bubble → effects/glyphs).
 *
 * `box` is in the block-center-relative local space (a {@link GlyphBox}); the caller
 * has already applied the clip transform, so the bubble scales/positions with the
 * text. {@link bubbleRect} owns the padding-expansion + radius-clamp math; this just
 * paths + fills. A `null` background is a cheap no-op. PURE side-effect on `ctx`.
 */
export function drawDecorationBackground(
  ctx: CanvasRenderingContext2D,
  background: ResolvedBackground | null,
  box: GlyphBox
): void {
  if (background === null) return
  const rect = bubbleRect(box, background.paddingX, background.paddingY, background.radius)
  if (rect.w <= 0 || rect.h <= 0) return
  ctx.save()
  ctx.fillStyle = background.color
  pathRoundRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.r)
  ctx.fill()
  ctx.restore()
}

// ---------------------------------------------------------------------------
// P7.9 — underline + strikethrough (baseline-aware, scales with font size).
// ---------------------------------------------------------------------------

/**
 * The drawable geometry of one per-line rule (underline / strike): a horizontal
 * segment from `x` to `x + w` at `y`, painted `thickness` px tall. In the SAME
 * block-center-relative px space as a {@link GlyphBox} (the caller has applied the
 * clip transform, so the rule scales/positions with the text). PURE math.
 */
export interface RuleGeometry {
  /** Left edge, px relative to the block center (the line box's left edge). */
  x: number
  /** Center-line y of the rule, px relative to the block center. */
  y: number
  /** Span width — the MEASURED line advance (honors alignment via the line box x). */
  w: number
  /** Stroke thickness in px (> 0). */
  thickness: number
}

/**
 * Default rule thickness for a font `size`, scaled so a hairline looks right at
 * any size: `size / 16` (e.g. 1px @16, ~2.5px @40, 6.25px @100), floored at 1px so
 * a tiny font still draws a visible line. PURE. An author thickness OVERRIDE
 * (resolved on {@link ResolvedTextRule}) bypasses this.
 */
export function ruleThickness(size: number, override?: number | null): number {
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) return override
  const s = Number.isFinite(size) && size > 0 ? size : 0
  return Math.max(1, s / 16)
}

/**
 * The line box's BASELINE y, derived from its line-height slot. The draw path uses
 * `ctx.textBaseline = 'middle'`, so glyphs are centered on the slot's vertical
 * MIDPOINT (`box.y + box.height/2`); a real alphabetic baseline sits BELOW that
 * midpoint by roughly the ascent-vs-cap offset. We approximate the baseline as
 * `midpoint + size * BASELINE_BELOW_MIDDLE` so the underline lands just under the
 * descenders consistently across sizes (the offset scales with `size`). PURE.
 */
const BASELINE_BELOW_MIDDLE = 0.35

/**
 * UNDERLINE geometry for a `lineBox` at font `size` (P7.9): a segment spanning the
 * line box width, sitting just BELOW the baseline. Baseline-aware + size-scaling —
 * both the baseline offset (≈`size·0.35` below the slot midpoint) and the small
 * gap below the baseline (≈`size·0.12`) scale with `size`, so it looks right at any
 * size; thickness is {@link ruleThickness}(`size`, override). The span uses the
 * line box's `x`/`width`, so it honors alignment (left/center/right shift x). PURE.
 */
export function underlineGeometry(
  lineBox: GlyphBox,
  size: number,
  thicknessOverride?: number | null
): RuleGeometry {
  const middle = lineBox.y + lineBox.height / 2
  const baseline = middle + size * BASELINE_BELOW_MIDDLE
  const gap = size * 0.12
  const thickness = ruleThickness(size, thicknessOverride)
  // Center-line of the rule = baseline + gap + half the thickness, so the TOP of the
  // stroke clears the baseline by `gap` regardless of thickness.
  return { x: lineBox.x, y: baseline + gap + thickness / 2, w: lineBox.width, thickness }
}

/**
 * STRIKETHROUGH geometry for a `lineBox` at font `size` (P7.9): a segment spanning
 * the line box width, through the line's MID / x-height. We place it slightly ABOVE
 * the slot midpoint (`midpoint − size·0.05`) so it crosses the x-height middle of
 * lowercase glyphs (not the descender region), scaling with `size`; thickness is
 * {@link ruleThickness}. Span honors alignment via the line box x/width. PURE.
 */
export function strikeGeometry(
  lineBox: GlyphBox,
  size: number,
  thicknessOverride?: number | null
): RuleGeometry {
  const middle = lineBox.y + lineBox.height / 2
  const thickness = ruleThickness(size, thicknessOverride)
  return { x: lineBox.x, y: middle - size * 0.05, w: lineBox.width, thickness }
}

/**
 * Draw ONE per-line rule segment (underline / strike) on `ctx`. Painted as a filled
 * RECT (not a stroked line) so a sub-pixel thickness still lands crisply and the
 * thickness is exact. The `color` is the resolved rule color, falling back to
 * `fillColor` (the glyph fill) when the rule has no explicit color — so by default
 * an underline matches the text. A zero/negative-width span is a no-op (empty line).
 * PURE side-effect on `ctx`.
 */
export function drawTextRule(
  ctx: CanvasRenderingContext2D,
  geom: RuleGeometry,
  color: string
): void {
  if (!(geom.w > 0) || !(geom.thickness > 0)) return
  ctx.save()
  ctx.fillStyle = color
  ctx.fillRect(geom.x, geom.y - geom.thickness / 2, geom.w, geom.thickness)
  ctx.restore()
}

/**
 * Draw the per-line underline + strike rules for a whole text block (P7.9). For
 * each non-empty line box it computes the baseline-aware, size-scaled geometry and
 * paints a filled rule rect. Drawn WITH the fill (just after the glyph body) so it
 * is visible: the underline reads under the glyphs at the baseline; the strike
 * crosses the x-height OVER the body. `lineBoxes` come from `layoutGlyphBoxes`; the
 * rule color falls back to `fillColor` (the glyph fill) when unset. The SINGLE place
 * preview + thumbnail + export paint rules, so they align identically everywhere.
 * PURE side-effect on `ctx`.
 */
export function drawDecorationRules(
  ctx: CanvasRenderingContext2D,
  underline: ResolvedTextRule | null,
  strike: ResolvedTextRule | null,
  lineBoxes: readonly GlyphBox[],
  size: number,
  fillColor: string
): void {
  if (underline === null && strike === null) return
  for (const box of lineBoxes) {
    if (!(box.width > 0)) continue
    if (underline !== null) {
      drawTextRule(ctx, underlineGeometry(box, size, underline.thickness), underline.color ?? fillColor)
    }
    if (strike !== null) {
      drawTextRule(ctx, strikeGeometry(box, size, strike.thickness), strike.color ?? fillColor)
    }
  }
}

/** True when a resolved decoration would draw at least one per-line rule. Sugar. */
export function hasRules(decoration: ResolvedDecoration): boolean {
  return decoration.underline !== null || decoration.strike !== null
}

// ---------------------------------------------------------------------------
// P7.10 — highlight BARS (marker/highlighter, per-word or full-line).
// ---------------------------------------------------------------------------

/** True when a resolved decoration would draw at least one highlight bar. Sugar. */
export function hasHighlightBars(decoration: ResolvedDecoration): boolean {
  return decoration.highlight !== null
}

/**
 * Select the BOXES a highlight bar (P7.10) frames, given its {@link ResolvedHighlightBar.mode}
 * and the per-line / per-word geometry from `layoutGlyphBoxes`. PURE — the box math is
 * the run bounds the glyphs lay out against (so a bar frames the actual text):
 *   - `'word'` → every non-empty WORD box (`lines[].words[].box`) — the run/word
 *     bounds — so each word gets its own bar (a true highlighter look).
 *   - `'line'` → every non-empty LINE box (`lines[].box`) — one bar per visual line.
 *
 * Empty boxes (a blank line / zero-width word) are dropped so a blank manual break
 * never draws a stray bar. Returns the boxes in draw order (top-to-bottom, then
 * left-to-right within a line for word mode).
 */
export function highlightBarBoxes(
  mode: HighlightBarMode,
  lineBoxes: readonly { box: GlyphBox; words: readonly { box: GlyphBox }[] }[]
): GlyphBox[] {
  const out: GlyphBox[] = []
  for (const line of lineBoxes) {
    if (mode === 'line') {
      if (line.box.width > 0) out.push(line.box)
    } else {
      for (const w of line.words) {
        if (w.box.width > 0) out.push(w.box)
      }
    }
  }
  return out
}

/**
 * Draw the highlight BARS (P7.10 — the marker/highlighter look) for a whole text
 * block: a colored rounded rect behind the glyphs, ONE per word box (`mode:'word'`)
 * or ONE per line box (`mode:'line'`), reusing {@link bubbleRect} per box (the rect
 * math is box-agnostic on purpose — the SAME geometry the background bubble uses).
 *
 * Drawn AFTER the background bubble (P7.8) and BEFORE the glyph passes (P7.10 sits in
 * the middle of the render order: clip-bg → bubble → highlight bars → glyphs →
 * underline/strike), so the bars read like a highlighter PEN beneath the text. The
 * boxes come from `layoutGlyphBoxes` (run bounds), so a bar frames the actual text
 * and lines up across multi-line text. The SINGLE place preview + thumbnail + export
 * paint the bars, so they align identically everywhere. PURE side-effect on `ctx`.
 */
export function drawHighlightBars(
  ctx: CanvasRenderingContext2D,
  highlight: ResolvedHighlightBar | null,
  lineBoxes: readonly { box: GlyphBox; words: readonly { box: GlyphBox }[] }[]
): void {
  if (highlight === null) return
  const boxes = highlightBarBoxes(highlight.mode, lineBoxes)
  if (boxes.length === 0) return
  ctx.save()
  ctx.fillStyle = highlight.color
  for (const box of boxes) {
    const rect = bubbleRect(box, highlight.paddingX, highlight.paddingY, highlight.radius)
    if (rect.w <= 0 || rect.h <= 0) continue
    pathRoundRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.r)
    ctx.fill()
  }
  ctx.restore()
}

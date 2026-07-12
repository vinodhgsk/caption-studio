/**
 * Resolve a clip's typographic controls (P6.3 — Doc 08; skill `text-render`).
 *
 * `clip.text.font` is an OPEN `Record<string, unknown>` (project-schema), written
 * by the Fonts/Text panel and by P5.4's preset→clip mapping. This module is the
 * SINGLE pure projection from that open bag onto a strongly-typed
 * {@link ResolvedTextFont} the preview draw path (`PreviewCanvas.drawTextClips`)
 * and the export path both consume — so the same controls (size, bold/weight,
 * italic, letterSpacing, lineHeight, family + fallback) drive measurement,
 * layout, and the canvas `ctx.font` identically (preview = export, master plan §6).
 *
 * It mirrors `captionTextRender.cssFontShorthand` / `fontFamilyList` but reads the
 * loose clip shape (which carries a `bold` boolean alongside numeric `weight`,
 * per `captionPresetToClipStyle`) rather than a typed `PresetFont`. PURE +
 * headless-safe: no DOM/canvas — the unit tests assert the resolved spec + the
 * CSS shorthand directly, and `measuredLineWidth` consumes `letterSpacing`.
 */
import { fontFamilyList } from './captionTextRender'
import type { PresetFont } from '../../../../shared/captionPreset'
import { resolveFontForText, cssFamilyList } from '../../../../shared/fontRegistry'
import type { Script } from '../../../../shared/scriptDetect'

/** The strongly-typed typography a text clip carries, with defaults filled in. */
export interface ResolvedTextFont {
  family: string
  fallback: string[]
  sizePx: number
  /** Numeric/keyword weight passed straight to the CSS `font` shorthand. */
  weight: number | 'normal' | 'bold'
  italic: boolean
  /** Extra tracking px (may be negative). */
  letterSpacing: number
  /** Line-height multiple (> 0). */
  lineHeight: number
  /**
   * Signed curve / arc amount (P6.5): 0 = straight, positive = arc bends UP
   * (apex/peak at the line center, ends fall away — convex), negative = arc bends
   * DOWN (valley at center — concave). Magnitude maps to how much of a circle the
   * line wraps (see {@link ../textLayout}.layoutArcClusters). Clamped to [-1, 1].
   */
  curve: number
}

/** Defaults a text clip falls back to when a field is absent on `clip.text.font`. */
export interface TextFontDefaults {
  family: string
  sizePx: number
  lineHeight: number
}

function isStr(v: unknown): v is string {
  return typeof v === 'string'
}
function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * Resolve the typography from a clip's open `text.font` bag (or `undefined`),
 * filling each missing/invalid field from `defaults`. The `bold` boolean (set by
 * the preset→clip mapping + the panel's bold toggle) maps to weight `'bold'` when
 * no explicit numeric `weight` is present, so the toggle round-trips. PURE.
 */
export function resolveTextFont(
  font: Record<string, unknown> | undefined,
  defaults: TextFontDefaults
): ResolvedTextFont {
  const f = font ?? {}

  const family = isStr(f.family) && f.family.trim().length > 0 ? f.family : defaults.family
  const sizePx = isFiniteNum(f.size) && (f.size as number) > 0 ? (f.size as number) : defaults.sizePx
  const lineHeight =
    isFiniteNum(f.lineHeight) && (f.lineHeight as number) > 0 ? (f.lineHeight as number) : defaults.lineHeight
  const letterSpacing = isFiniteNum(f.letterSpacing) ? (f.letterSpacing as number) : 0
  const italic = f.italic === true
  // Curve (P6.5): clamp to [-1, 1]; missing/invalid → 0 (straight, no behavior change).
  const curve = isFiniteNum(f.curve) ? Math.max(-1, Math.min(1, f.curve as number)) : 0

  // Weight: an explicit numeric/keyword weight wins; else the `bold` boolean.
  let weight: number | 'normal' | 'bold'
  if (isFiniteNum(f.weight)) weight = f.weight as number
  else if (f.weight === 'bold' || f.weight === 'normal') weight = f.weight
  else weight = f.bold === true ? 'bold' : 'normal'

  const fallback = Array.isArray(f.fallback) ? (f.fallback.filter(isStr) as string[]) : []

  return { family, fallback, sizePx, weight, italic, letterSpacing, lineHeight, curve }
}

/**
 * Build the CSS `font` shorthand for a {@link ResolvedTextFont}: `[italic] weight
 * size family-list`. Reuses `captionTextRender.fontFamilyList` (family + de-duped
 * fallback, space-containing tokens quoted) so the clip render resolves the same
 * glyph source as a preset/preview swatch. Bold/italic are reflected here.
 *
 * NOTE: this builds the family list from the clip's chosen `family` + its persisted
 * `fallback` AS-IS. For script-correct rendering (so Tamil text never tofus when
 * the chosen family is Latin-only) the draw path should instead resolve the family
 * list per-run via {@link resolveFontForRun} and pass it to {@link fontShorthandWithList}.
 */
export function resolvedFontShorthand(font: ResolvedTextFont): string {
  // fontFamilyList wants a PresetFont-shaped {family, fallback}; pass a minimal
  // object satisfying that surface (only family/fallback are read).
  const list = fontFamilyList({ family: font.family, fallback: font.fallback } as PresetFont)
  return fontShorthandWithList(font, list)
}

/**
 * Build the CSS `font` shorthand from a resolved {@link ResolvedTextFont} (for
 * style/weight/size) plus an ALREADY-BUILT CSS family `list` — so the draw path
 * can feed a per-script-resolved family list (from {@link resolveFontForRun}).
 * Bold/italic/size are reflected here exactly as in {@link resolvedFontShorthand}.
 */
export function fontShorthandWithList(font: ResolvedTextFont, list: string): string {
  const style = font.italic ? 'italic ' : ''
  const weight = typeof font.weight === 'number' ? String(font.weight) : font.weight
  return `${style}${weight} ${font.sizePx}px ${list}`
}

/**
 * Resolve the SCRIPT-CORRECT CSS family list for a run of text (P6.17 — indic-text
 * per-script fonts/fallback). Given the clip's resolved typography (its chosen
 * `family` + persisted `text.font.fallback`) and the text/script of the run, this
 * delegates to the registry's {@link resolveFontForText} so a font that COVERS the
 * run's script always leads (Tamil text → a Tamil-capable family first), ending in
 * a Latin family + generic. The result is a CSS family list (space-containing
 * tokens quoted, de-duped) ready for `ctx.font` / {@link fontShorthandWithList}.
 *
 * This is the single helper the draw path (PreviewCanvas.drawTextClips) and the
 * export path call so Tamil/Telugu/Malayalam/Kannada/Devanagari never render tofu
 * because the chosen family lacked the script's glyphs. PURE.
 */
export function resolveFontForRun(font: ResolvedTextFont, scriptOrText: Script | string): string {
  const chain = resolveFontForText({ family: font.family, fallback: font.fallback }, scriptOrText)
  return cssFamilyList(chain)
}

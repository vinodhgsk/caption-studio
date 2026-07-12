/**
 * Pure text-layout math (P3.14, Doc 01 — multi-line text with manual breaks).
 *
 * NO DOM / canvas import — text width measurement is INJECTED as a function so
 * the math unit-tests in the vitest `node` env (the canvas passes
 * `ctx.measureText(s).width`). The drawing surface (`PreviewCanvas.tsx`) calls
 * these helpers then `ctx.fillText` per laid-out line; this module owns only the
 * positioning arithmetic.
 *
 * SCOPE: this lays out the manual lines in `clip.text.lines`, stacked by line
 * height and horizontally aligned, honoring the typographic controls from
 * `clip.text.font` (P6.3): SIZE + lineHeight drive vertical stacking, and
 * letterSpacing widens each line's measured advance by `(clusters-1)*spacing`.
 * Font FAMILY / weight / italic affect the INJECTED measurer (the caller sets
 * `ctx.font` before measuring) so they flow in for free. FILL/STROKE/SHADOW and
 * automatic word-wrap stay out of this module — it owns only positioning math.
 *
 * letterSpacing is applied in GRAPHEME CLUSTERS (indic-text): a Tamil conjunct
 * is one cluster and gets one inter-cluster gap, matching how a complex-script
 * shaper advances. The math is pure + measurer-injected so letterSpacing /
 * lineHeight are unit-testable with no canvas (the canvas passes
 * `ctx.measureText(s).width` + the same letterSpacing it sets on the context).
 */
import { graphemeLength } from '../../../../shared/captionSync'
import { segmentClusters } from '../../../../shared/textShaping'
import { layoutArcClusters, lineClusters } from '../../../../shared/arcLayout'
import type { GlyphBox, GlyphBoxLayout, LaidOutCluster, LineBox, WordBox } from '../../../../shared/arcLayout'

export type { ClusterTransform, GlyphBox, GlyphBoxLayout, LaidOutCluster, LineBox, WordBox } from '../../../../shared/arcLayout'
export { layoutArcClusters, lineClusters }

/** Horizontal alignment of the text block (mirrors `ClipText.align`). */
export type TextAlign = 'left' | 'center' | 'right'

/** A width measurer for one line of text at the laid-out font, in px. */
export type MeasureWidth = (line: string) => number

/**
 * The measured ADVANCE width of one line including letterSpacing, in px. The base
 * glyph advance comes from the injected `measureWidth`; letterSpacing adds one
 * gap BETWEEN each adjacent grapheme cluster, i.e. `(clusters - 1) * spacing`
 * (never after the last cluster — matching canvas `letterSpacing` and a shaper's
 * cluster advances). Empty/single-cluster lines get no extra spacing. PURE.
 */
export function measuredLineWidth(
  line: string,
  measureWidth: MeasureWidth,
  letterSpacing = 0
): number {
  const base = measureWidth(line)
  if (letterSpacing === 0 || line.length === 0) return base
  const clusters = graphemeLength(line)
  if (clusters <= 1) return base
  return base + (clusters - 1) * letterSpacing
}

/** A single laid-out line: its text + position RELATIVE TO THE BLOCK CENTER. */
export interface LaidOutLine {
  line: string
  /**
   * x of the line's anchor relative to the block center. With a `'center'`
   * canvas `textAlign` the anchor is the line's horizontal midpoint, so this is
   * always 0 for center; for left/right it shifts so the block's left/right
   * edge is flush. The caller should set `ctx.textAlign = 'center'` and add this
   * x to the block center.
   */
  x: number
  /**
   * y of the line's BASELINE relative to the block center (caller adds the block
   * center y). Lines stack top-to-bottom; with `ctx.textBaseline = 'middle'`
   * this centers the block vertically on the transform origin.
   */
  y: number
}

/** The bounding size of a laid-out text block, in px. */
export interface TextBlockSize {
  w: number
  h: number
}

/**
 * Total block size of `lines` at `fontSizePx` with `lineHeightMult` (e.g. 1.2)
 * and optional `letterSpacing` px (P6.3).
 *
 * - Width  = the widest measured line INCLUDING letterSpacing advance
 *   (`measuredLineWidth`), 0 when there are no lines.
 * - Height = `lines.length * fontSizePx * lineHeightMult` — lineHeight drives the
 *   vertical stacking; each line, including empty ones, occupies a full slot so
 *   blank lines add vertical space.
 *
 * `measureWidth` is injected so this is testable without a canvas; `letterSpacing`
 * defaults to 0 so existing callers are unaffected.
 */
export function textBlockSize(
  lines: readonly string[],
  fontSizePx: number,
  lineHeightMult: number,
  measureWidth: MeasureWidth,
  letterSpacing = 0
): TextBlockSize {
  if (lines.length === 0) return { w: 0, h: 0 }
  let maxW = 0
  for (const line of lines) {
    const w = measuredLineWidth(line, measureWidth, letterSpacing)
    if (w > maxW) maxW = w
  }
  return { w: maxW, h: lines.length * fontSizePx * lineHeightMult }
}

/**
 * Lay out `lines` relative to the block CENTER (so the caller draws each at
 * `centerX + x`, `centerY + y`).
 *
 * Vertical: lines stack top-to-bottom by `fontSizePx * lineHeightMult`; the
 * block is centered on y=0, so the first line's baseline sits above center and
 * each subsequent line drops by one line height. Designed for
 * `ctx.textBaseline = 'middle'` so each `y` is the vertical midpoint of its slot.
 *
 * Horizontal: with `ctx.textAlign = 'center'` the anchor is the line midpoint.
 * - `'center'` → x = 0 for every line (all centered on the block center).
 * - `'left'`   → each line's LEFT edge flush to the block's left edge:
 *                x = -(blockW - lineW) / 2.
 * - `'right'`  → each line's RIGHT edge flush to the block's right edge:
 *                x = +(blockW - lineW) / 2.
 *
 * Empty lines produce an entry (with width 0) so blank manual breaks still take
 * a vertical slot.
 */
/** A single laid-out word within a line: its text + per-word draw geometry. */
export interface LaidOutWord {
  word: string
  /**
   * x of the word's CENTER relative to the line's center (so a caller drawing
   * with `ctx.textAlign='center'` adds this to the line's center x). Left-to-right
   * order; a single trailing space between words is included in spacing but the
   * drawn token excludes it.
   */
  x: number
  /** The word's measured width in px (excludes the inter-word space). */
  width: number
}

/**
 * Lay out the WORDS of a single line left-to-right, returning each word's
 * center-x relative to the LINE center (pair with {@link layoutTextLines} which
 * gives the line center). Words are separated by a single measured space. This is
 * the geometry the word-by-word reveal / active-word highlight draws against so
 * each word can be painted (or faded) independently while matching the exact
 * positions of the whole-line render.
 *
 * `measureWidth` is injected so this is testable without a canvas. PURE.
 */
export function layoutWordsInLine(
  words: readonly string[],
  measureWidth: MeasureWidth,
  letterSpacing = 0
): LaidOutWord[] {
  if (words.length === 0) return []
  // The inter-word space is one cluster flanked by two cluster boundaries (gap
  // before it from the preceding word, gap after it to the next word), so its
  // contribution is the space glyph advance plus TWO letterSpacing gaps. This
  // keeps the per-word totals equal to the whole-line `measuredLineWidth`.
  const spaceW = measureWidth(' ') + 2 * letterSpacing
  const widths = words.map((w) => measuredLineWidth(w, measureWidth, letterSpacing))
  const totalW = widths.reduce((a, b) => a + b, 0) + spaceW * (words.length - 1)
  // Cursor walks the left edge of the line (line center is 0, so start at -total/2).
  let cursor = -totalW / 2
  return words.map((word, i) => {
    const width = widths[i]
    const x = cursor + width / 2
    cursor += width + spaceW
    return { word, x, width }
  })
}

export function layoutTextLines(
  lines: readonly string[],
  fontSizePx: number,
  lineHeightMult: number,
  align: TextAlign,
  measureWidth: MeasureWidth,
  letterSpacing = 0
): LaidOutLine[] {
  const lineH = fontSizePx * lineHeightMult
  const block = textBlockSize(lines, fontSizePx, lineHeightMult, measureWidth, letterSpacing)
  // Center the stack on y=0: the first line's slot-center is half a line height
  // below the top edge (-h/2), i.e. -h/2 + lineH/2.
  const firstCenterY = -block.h / 2 + lineH / 2
  return lines.map((line, i) => {
    const y = firstCenterY + i * lineH
    let x = 0
    if (align !== 'center') {
      const lineW = measuredLineWidth(line, measureWidth, letterSpacing)
      const slack = (block.w - lineW) / 2
      // `+ 0` normalizes -0 → 0 so the widest line's x is a clean 0.
      x = (align === 'left' ? -slack : slack) + 0
    }
    return { line, x, y }
  })
}

// ---------------------------------------------------------------------------
// P6.4 — per-glyph / per-word / per-line bounding boxes (decorations + animation)
// ---------------------------------------------------------------------------
// GlyphBox, LaidOutCluster, WordBox, LineBox, GlyphBoxLayout, ClusterTransform
// live in shared/arcLayout so the FFmpeg export path can import them directly.

/** Options for {@link layoutGlyphBoxes} — mirrors {@link layoutTextLines}'s knobs. */
export interface GlyphBoxOptions {
  fontSizePx: number
  lineHeightMult: number
  align: TextAlign
  letterSpacing?: number
}

/**
 * Lay out the full per-line / per-word / per-grapheme-cluster bounding-box
 * geometry of a text block (P6.4), in the block-center-relative coordinate space
 * the draw path uses. This is the geometry decorations (underline, highlight box,
 * background bubble) and per-character/word animation read against; because it
 * reuses {@link layoutTextLines} (line x/y + alignment), {@link measuredLineWidth}
 * (letterSpacing-aware advance) and {@link layoutWordsInLine} (per-word center-x),
 * a box drawn here lines up with the glyph the draw path paints — preview = export.
 *
 * Tiling guarantees (all in grapheme clusters, indic-text):
 *   - Per-word boxes tile a line: adjacent word boxes are separated by exactly the
 *     inter-word space advance (space glyph + 2·letterSpacing) and the union spans
 *     the line box width.
 *   - Per-cluster boxes tile a word: adjacent cluster boxes are separated by exactly
 *     `letterSpacing`; a Tamil conjunct is ONE cluster (one box), never split per
 *     codepoint. Each cluster box width is its own measured glyph advance.
 *   - All y/height come from the line-height slot, so alignment shifts x and
 *     lineHeight sets y consistently with {@link layoutTextLines}.
 *
 * Words are split on single spaces (matching {@link layoutWordsInLine}); a token's
 * leading-edge cursor is derived from the line box left edge so cluster/word/line
 * boxes share one origin. `measureWidth` is injected so this is canvas-free. PURE.
 */
export function layoutGlyphBoxes(
  lines: readonly string[],
  opts: GlyphBoxOptions,
  measureWidth: MeasureWidth
): GlyphBoxLayout {
  const { fontSizePx, lineHeightMult, align } = opts
  const letterSpacing = opts.letterSpacing ?? 0
  const lineH = fontSizePx * lineHeightMult
  const size = textBlockSize(lines, fontSizePx, lineHeightMult, measureWidth, letterSpacing)
  const block: GlyphBox = { x: -size.w / 2, y: -size.h / 2, width: size.w, height: size.h }

  // Reuse the line layout for per-line x (alignment) + y (line-height stacking).
  const laidLines = layoutTextLines(lines, fontSizePx, lineHeightMult, align, measureWidth, letterSpacing)

  const lineBoxes: LineBox[] = laidLines.map(({ line, x: lineCenterX, y: lineCenterY }) => {
    const lineW = measuredLineWidth(line, measureWidth, letterSpacing)
    // The line's slot: top = baseline-row midpoint − half a line height (matches
    // `ctx.textBaseline='middle'`); left = its center minus half its advance.
    const top = lineCenterY - lineH / 2
    const lineLeft = lineCenterX - lineW / 2
    const lineBox: GlyphBox = { x: lineLeft, y: top, width: lineW, height: lineH }

    // Split into words exactly as the draw path does (single-space separator).
    const tokens = line.length === 0 ? [] : line.split(' ')
    const placedWords = layoutWordsInLine(tokens, measureWidth, letterSpacing)

    const words: WordBox[] = placedWords.map(({ word, x: wordCenterX, width }) => {
      // `wordCenterX` is relative to the LINE center; shift into block space.
      const wordLeft = lineCenterX + wordCenterX - width / 2
      const wordBox: GlyphBox = { x: wordLeft, y: top, width, height: lineH }

      // Per-cluster boxes tile the word: each cluster's advance, separated by
      // letterSpacing. Grapheme-cluster aware so an Indic conjunct is one box.
      // Segment via the shared shaper so layout and the shaping pipeline (P6.18)
      // consume ONE segmentation — preview↔export parity (indic-text).
      const clusterTexts = segmentClusters(word)
      let cursor = wordLeft
      const clusters: LaidOutCluster[] = clusterTexts.map((cluster, idx) => {
        const cw = measureWidth(cluster)
        const cx = cursor
        // Advance by the glyph width plus one inter-cluster gap (never after the
        // last cluster), matching `measuredLineWidth`'s `(n-1)*letterSpacing`.
        cursor += cw + (idx < clusterTexts.length - 1 ? letterSpacing : 0)
        return { cluster, box: { x: cx, y: top, width: cw, height: lineH } }
      })

      return { word, box: wordBox, clusters }
    })

    return { line, box: lineBox, words }
  })

  return { block, lines: lineBoxes }
}

// P6.5 — arc/curved text: ClusterTransform, layoutArcClusters, lineClusters
// live in shared/arcLayout (re-exported above) so the FFmpeg export path can
// import the same math without going through the renderer tree.

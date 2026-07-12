/**
 * Pure geometric types for glyph layout and the arc/curved-text engine (P6.5).
 *
 * Lives in `shared/` so the FFmpeg export path can consume `layoutArcClusters`
 * with identical math to the Canvas preview. NO DOM / canvas import — pure
 * arithmetic only. The preview compositor and the export renderer both call
 * `layoutArcClusters` to position clusters; they never reimplement it.
 */

/** A measured glyph bounding box, px relative to the block center. */
export interface GlyphBox {
  /** Left edge, px relative to the block center. */
  x: number
  /** Top edge, px relative to the block center. */
  y: number
  /** Box width in px. */
  width: number
  /** Box height in px (one line-height slot). */
  height: number
}

/** A single grapheme cluster + its box (indic-text: one box per visible cluster). */
export interface LaidOutCluster {
  /** The cluster text (a Tamil conjunct like `கி` / `க்ஷி` is ONE cluster). */
  cluster: string
  /** The cluster's box, relative to the block center (see {@link GlyphBox}). */
  box: GlyphBox
}

/** A word, its box, and the per-cluster boxes that tile it left-to-right. */
export interface WordBox {
  word: string
  /** The word's box (excludes the inter-word space), relative to the block center. */
  box: GlyphBox
  /** The grapheme clusters of the word, in order, each with its own box. */
  clusters: LaidOutCluster[]
}

/** A line, its box, and the per-word boxes that tile it left-to-right. */
export interface LineBox {
  line: string
  /** The full line box (its measured advance width × the line-height slot). */
  box: GlyphBox
  /** The words of the line, in order, each with its box + cluster boxes. */
  words: WordBox[]
}

/** The nested geometry of a whole text block: line → word → cluster boxes. */
export interface GlyphBoxLayout {
  /** The block's own bounding box, centered on the origin. */
  block: GlyphBox
  /** Per-line boxes, top-to-bottom. */
  lines: LineBox[]
}

/**
 * A composable per-cluster transform (P6.5). The draw path places one cluster by
 * `translate(x,y) → rotate(rotation) → scale(scale)` ABOUT the cluster origin,
 * then paints the cluster centered. This is an ADDITIVE layer on top of the
 * straight layout: at `curve === 0` it is exactly the straight baseline
 * (`x` = cluster center, `y` = baseline, `rotation` = 0, `scale` = 1), so a later
 * keyframe/animation phase can COMPOSE its own per-cluster delta on top without
 * the arc being baked irreversibly into the glyphs. Coordinates are in the same
 * block-center-relative px space as {@link GlyphBox} (the caller adds the block
 * center x/y exactly as for the straight path).
 */
export interface ClusterTransform {
  /** The cluster text (a Tamil conjunct is ONE cluster → ONE transform). */
  cluster: string
  /** x of the cluster CENTER, px relative to the block center. */
  x: number
  /** y of the cluster CENTER (baseline-row midpoint), px relative to the block center. */
  y: number
  /** Rotation in RADIANS applied about the cluster center (tangent to the arc). */
  rotation: number
  /** Uniform scale about the cluster center; defaults to 1 (reserved for animation). */
  scale: number
}

/**
 * Map a clamped curve amount to the half-angle (radians) the line's HALF-WIDTH
 * subtends at the arc center. `|curve| = 1` wraps the line over a half-circle
 * (each half spans 90°); smaller magnitudes flatten toward a straight line. Pure.
 */
function arcHalfAngle(curveMag: number): number {
  return curveMag * (Math.PI / 2)
}

/**
 * Lay the grapheme clusters of ONE line along an arc controlled by `curve`, on
 * top of the straight per-cluster geometry from `layoutGlyphBoxes` (P6.4).
 * Reuses the cluster CENTER x/advances already measured there — this never
 * re-measures glyphs. PURE + canvas-free + testable.
 *
 * CONVENTION (signed `curve`, clamp to [-1, 1] expected from the resolver):
 *   - `curve === 0` → straight: each transform is `{x: clusterCenterX, y:
 *     baselineY, rotation: 0, scale: 1}` — identical to the straight draw.
 *   - `curve > 0`  → arc bends UP: the APEX is at the line center and the ends
 *     fall away (a "rainbow"/convex arc).
 *   - `curve < 0`  → arc bends DOWN: a valley at center, ends rise (concave).
 *
 * The line's measured width maps to an arc of total angle `2 * arcHalfAngle`; a
 * cluster's center-x (relative to the line center) is its FRACTION along that arc,
 * so cluster ORDER and inter-cluster SPACING are preserved monotonically. Each
 * cluster is rotated to the arc TANGENT at its position so glyphs sit upright.
 *
 * `lineBox` + `clusters` come straight from a {@link LineBox} (flatten its words'
 * clusters in order). `lineCenterY` is the line's baseline-row midpoint. Returns
 * one transform per cluster, in left-to-right order.
 */
export function layoutArcClusters(
  clusters: readonly LaidOutCluster[],
  lineBox: GlyphBox,
  lineCenterY: number,
  curve: number
): ClusterTransform[] {
  const lineCenterX = lineBox.x + lineBox.width / 2
  const centers = clusters.map((c) => ({
    cluster: c.cluster,
    cx: c.box.x + c.box.width / 2 - lineCenterX
  }))

  const halfWidth = lineBox.width / 2
  if (curve === 0 || halfWidth <= 0) {
    return centers.map(({ cluster, cx }) => ({
      cluster,
      x: lineCenterX + cx,
      y: lineCenterY,
      rotation: 0,
      scale: 1
    }))
  }

  const sign = curve < 0 ? -1 : 1
  const halfAngle = arcHalfAngle(Math.abs(curve))
  const radius = halfWidth / halfAngle

  return centers.map(({ cluster, cx }) => {
    const theta = (cx / halfWidth) * halfAngle
    const x = lineCenterX + radius * Math.sin(theta)
    const drop = radius * (1 - Math.cos(theta))
    const y = lineCenterY + sign * drop
    const rotation = sign * theta
    return { cluster, x, y, rotation, scale: 1 }
  })
}

/**
 * Flatten a {@link LineBox}'s per-word cluster boxes into one ordered cluster
 * list so {@link layoutArcClusters} can place a whole line. Word order is
 * preserved; inter-word spaces are not clusters. Pure.
 */
export function lineClusters(lineBox: LineBox): LaidOutCluster[] {
  const out: LaidOutCluster[] = []
  for (const w of lineBox.words) out.push(...w.clusters)
  return out
}

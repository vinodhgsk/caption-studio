/**
 * Complex-script shaping CONTRACT + grapheme-cluster segmentation (P6.18 — Doc 08;
 * skills `indic-text`, `text-render`).
 *
 * The app is Indic-first. Tamil (`கி`, `க்ஷி`), Devanagari (`क्षि`), and the other
 * supported Indic scripts render correctly ONLY when every per-character feature
 * (typewriter, per-char stagger, reveal `unit:"char"`, active-word/karaoke
 * highlight, letterSpacing, decorations, animation) operates on EXTENDED GRAPHEME
 * CLUSTERS, never on raw code points (indic-text "cardinal rule"). This module is
 * the single place that turns a run of text into the atomic units the renderer may
 * move/color/time/break, plus the advances those units occupy.
 *
 * THE PARITY CONTRACT (preview ↔ export):
 *   The preview compositor (Canvas/WebGL) and the headless export (FFmpeg burn-in
 *   via libass/freetype+harfbuzz) MUST shape identically (indic-text "Determinism /
 *   parity"). They achieve this by consuming ONE segmentation: both paths call
 *   {@link shapeRun} with a {@link TextShaper}. The segmentation (which code points
 *   group into a cluster, and their left-to-right order) is produced HERE — by
 *   `Intl.Segmenter` grapheme rules via {@link splitGraphemes} — so it does not vary
 *   with the renderer. Only the ADVANCE of each cluster is measurer-specific, and
 *   that measurer is INJECTED, so a deterministic mock (tests), the canvas
 *   `ctx.measureText` (preview), and a freetype/harfbuzz metric source (export) can
 *   all be plugged in WITHOUT changing the cluster sequence.
 *
 * PLUGGABILITY: {@link TextShaper} is an interface. The shipped
 * {@link GraphemeClusterShaper} yields grapheme clusters + injected advances and is
 * what preview and export both use today. A real native HarfBuzz binding (emitting
 * positioned `{glyphId,x,y,cluster}`) can be dropped in behind the same interface
 * later — `cluster` indices stay aligned to this segmentation so downstream
 * per-cluster logic is unchanged.
 *
 * HEADLESS-SAFE + PURE: no DOM / canvas / electron / node imports. The renderer, a
 * vitest engine, and the export path import this identically (mirrors
 * {@link ./scriptDetect} and {@link ./captionSync}).
 */
import { splitGraphemes } from './captionSync'
import { detectScript, type Script } from './scriptDetect'

// ---------------------------------------------------------------------------
// Segmentation — grapheme clusters (the atomic unit; indic-text cardinal rule)
// ---------------------------------------------------------------------------

/**
 * Measure the advance width (px) of a single shaped unit (one grapheme cluster, or
 * any string for a whole-line fast path) at the resolved font. INJECTED so this
 * module is canvas-free: the preview passes `ctx.measureText(s).width`, the export
 * passes a freetype/harfbuzz advance, tests pass a deterministic stub. The same
 * function the layout math already takes ({@link ../renderer/routes/editor/preview/textLayout}'s
 * `MeasureWidth`), so one measurer feeds shaping AND layout.
 */
export type MeasureAdvance = (text: string) => number

/**
 * One shaped, positioned cluster — the atomic unit downstream code may move,
 * color, time, break, or animate (indic-text). `cluster` is the visible text of an
 * EXTENDED GRAPHEME CLUSTER: a Tamil `கி` (base + vowel sign) or Devanagari `क्षि`
 * (conjunct + matra) is ONE cluster, never split per code point. `index` is the
 * cluster's 0-based position in the run (stable across preview/export — it is the
 * HarfBuzz `cluster` value in a future native binding). `advance` is its width in
 * px from the injected measurer; `x` is its left edge (running sum of advances +
 * inter-cluster letterSpacing), so `x` + `advance` walks the run with no gaps.
 */
export interface ShapedCluster {
  /** Visible text of the grapheme cluster (atomic — a conjunct is one cluster). */
  cluster: string
  /** 0-based cluster index within the run (HarfBuzz `cluster`-compatible). */
  index: number
  /** Left edge of the cluster, px from the run origin (letterSpacing folded in). */
  x: number
  /** Glyph advance of the cluster, px, from the injected {@link MeasureAdvance}. */
  advance: number
}

/** The result of shaping one run: its clusters + total advance + detected script. */
export interface ShapedRun {
  /** The original run text (unchanged). */
  text: string
  /** Clusters left-to-right; `length` is the cluster COUNT used for per-char logic. */
  clusters: ShapedCluster[]
  /**
   * Total advance width of the run, px: sum of cluster advances + `(n-1)` inter-
   * cluster `letterSpacing` gaps (never after the last cluster). Matches
   * `measuredLineWidth` for the same input + measurer + letterSpacing.
   */
  advance: number
  /** Dominant script of the run (drives font/fallback selection upstream). */
  script: Script
}

/**
 * Segment `text` into its extended grapheme clusters (indic-text). DELEGATES to
 * {@link splitGraphemes} so the cluster boundaries are IDENTICAL to the layout,
 * reveal, karaoke and line-wrap code that already counts in grapheme clusters —
 * the single source of truth keeps every per-character feature consistent and
 * makes the segmentation ICU-version-stable (tests assert equality with
 * `splitGraphemes`, not hard-coded counts). Pure.
 */
export function segmentClusters(text: string): string[] {
  return splitGraphemes(text)
}

/**
 * Number of grapheme clusters in `text` (indic-text cluster COUNT). This — not
 * `text.length` / code-point count — drives typewriter speed, per-char stagger,
 * reveal `unit:"char"`, and `maxCharsPerLine`. Pure.
 */
export function clusterCount(text: string): number {
  return segmentClusters(text).length
}

// ---------------------------------------------------------------------------
// The pluggable shaper interface (preview AND export share one implementation)
// ---------------------------------------------------------------------------

/**
 * A complex-script shaper (indic-text / text-render). It turns a run of text into
 * positioned grapheme clusters. The CONTRACT both renderers honor:
 *   - `segment(text)` MUST return extended grapheme clusters (matras/conjuncts kept
 *     whole, reordering handled by the platform/HarfBuzz at draw time within the
 *     cluster) — i.e. exactly {@link splitGraphemes}. This is deterministic and
 *     renderer-independent, which is what guarantees preview↔export parity.
 *   - `shape(text, measure, letterSpacing)` MUST place those clusters left-to-right
 *     with the injected advances + inter-cluster letterSpacing.
 *
 * Pluggable + stubbable: preview/export both use {@link GraphemeClusterShaper}; a
 * native HarfBuzz binding can implement the same interface later. The `id` is for
 * the parity content-hash / debugging (a preview/export shaper-id mismatch is a
 * hard error per indic-text).
 */
export interface TextShaper {
  /** Stable identifier for parity assertions (preview and export must match). */
  readonly id: string
  /** Segment `text` into extended grapheme clusters (atomic units). */
  segment(text: string): string[]
  /** Shape a run into positioned clusters using the injected advance measurer. */
  shape(text: string, measure: MeasureAdvance, letterSpacing?: number): ShapedRun
}

/**
 * The default, deterministic shaper used by BOTH preview and export (P6.18). It
 * segments by grapheme clusters ({@link splitGraphemes}) and lays them out with the
 * injected {@link MeasureAdvance} + inter-cluster letterSpacing. Because the
 * segmentation is renderer-independent and the only renderer-specific input
 * (advances) is injected, the SAME cluster sequence is produced everywhere — that
 * is the parity guarantee. A real HarfBuzz binding can replace this behind
 * {@link TextShaper} without changing the cluster contract.
 *
 * letterSpacing is applied in clusters (indic-text): one gap BETWEEN adjacent
 * clusters, none after the last — matching `measuredLineWidth` and canvas
 * `letterSpacing`, so a shaped run's `advance` equals the laid-out line width.
 */
export class GraphemeClusterShaper implements TextShaper {
  readonly id = 'grapheme-cluster@1'

  segment(text: string): string[] {
    return segmentClusters(text)
  }

  shape(text: string, measure: MeasureAdvance, letterSpacing = 0): ShapedRun {
    return shapeRun(text, measure, letterSpacing, this)
  }
}

/** The process-wide default shaper instance (preview + export import this). */
export const DEFAULT_SHAPER: TextShaper = new GraphemeClusterShaper()

/**
 * Shape one run into positioned {@link ShapedCluster}s (the free-function core the
 * shaper class delegates to, so callers can shape with an explicit shaper or the
 * {@link DEFAULT_SHAPER}). Walks the clusters left-to-right summing advances + one
 * inter-cluster `letterSpacing` gap each. PURE + deterministic + measurer-injected.
 *
 * Empty `text` → an empty run (`clusters: []`, `advance: 0`). A single cluster gets
 * no letterSpacing. The `index` of each cluster is its position in the run, stable
 * across preview/export (HarfBuzz `cluster`-compatible).
 */
export function shapeRun(
  text: string,
  measure: MeasureAdvance,
  letterSpacing = 0,
  shaper: TextShaper = DEFAULT_SHAPER
): ShapedRun {
  const parts = shaper.segment(text)
  const clusters: ShapedCluster[] = []
  let x = 0
  for (let i = 0; i < parts.length; i++) {
    const cluster = parts[i]
    const advance = measure(cluster)
    clusters.push({ cluster, index: i, x, advance })
    // Advance past the glyph; add an inter-cluster gap except after the last one.
    x += advance + (i < parts.length - 1 ? letterSpacing : 0)
  }
  return {
    text,
    clusters,
    advance: x,
    script: detectScript(text)
  }
}

/**
 * Convenience: the cluster strings a {@link TextShaper} produces for `text`,
 * without advances (for code that only needs the atomic units, e.g. counting or
 * splitting). Defaults to the {@link DEFAULT_SHAPER}. Pure.
 */
export function shapeClusters(text: string, shaper: TextShaper = DEFAULT_SHAPER): string[] {
  return shaper.segment(text)
}

// ---------------------------------------------------------------------------
// Syllable splitting (syllable-level karaoke; indic-text "Syllable splitting")
// ---------------------------------------------------------------------------

/**
 * A syllable as a half-open range of CLUSTER indices `[start, end)` into the run's
 * {@link segmentClusters} output. Timing for per-syllable karaoke is interpolated
 * across these ranges (ties into `caption-sync`), so the range is expressed in the
 * SAME cluster units the rest of the pipeline uses — never code points — and a
 * syllable boundary never falls inside a cluster.
 */
export interface SyllableRange {
  /** Visible text of the syllable (its clusters joined). */
  text: string
  /** First cluster index of the syllable (inclusive). */
  start: number
  /** One past the last cluster index of the syllable (exclusive). */
  end: number
}

/**
 * Dependent vowel-sign (matra) ranges per Indic script. A cluster STARTING with a
 * dependent sign cannot begin a new syllable — it attaches to the preceding
 * consonant cluster. (Tamil `கி` is already one cluster, but `க்ஷி` segments to
 * `க்` + `ஷி` under ICU, and a leading independent vowel sign should not split.)
 */
const DEPENDENT_SIGN_RANGES: Partial<Record<Script, ReadonlyArray<[number, number]>>> = {
  // Tamil vowel signs U+0BBE–0BCD (matras + virama).
  tamil: [[0x0bbe, 0x0bcd]],
  // Telugu vowel signs + virama.
  telugu: [[0x0c3e, 0x0c56]],
  // Kannada vowel signs + virama.
  kannada: [[0x0cbe, 0x0cd6]],
  // Malayalam vowel signs + virama.
  malayalam: [[0x0d3e, 0x0d4d]],
  // Devanagari vowel signs + virama.
  devanagari: [[0x093e, 0x094d]]
}

/** True when a cluster's FIRST code point is a dependent vowel sign for `script`. */
function startsWithDependentSign(cluster: string, script: Script): boolean {
  const ranges = DEPENDENT_SIGN_RANGES[script]
  if (!ranges || cluster.length === 0) return false
  const cp = cluster.codePointAt(0)
  if (cp === undefined) return false
  return ranges.some(([lo, hi]) => cp >= lo && cp <= hi)
}

/** True when a cluster ENDS in a virama (a trailing dead consonant seeks the next). */
function endsWithVirama(cluster: string, script: Script): boolean {
  if (cluster.length === 0) return false
  const cps = Array.from(cluster)
  const last = cps[cps.length - 1].codePointAt(0)
  if (last === undefined) return false
  // Per-script virama code points.
  const VIRAMA: Partial<Record<Script, number>> = {
    tamil: 0x0bcd,
    telugu: 0x0c4d,
    kannada: 0x0ccd,
    malayalam: 0x0d4d,
    devanagari: 0x094d
  }
  return VIRAMA[script] === last
}

/**
 * Split `text` into syllable ranges for syllable-level karaoke (indic-text). A
 * syllable = a consonant cluster + its following vowel (sign or inherent), grouped
 * with leading virama-joined conjuncts. Operating on grapheme clusters, the
 * heuristic is:
 *   - Start a new syllable at each cluster, EXCEPT
 *   - a cluster that begins with a dependent vowel sign attaches to the previous
 *     syllable, and
 *   - a syllable whose current last cluster ends in a VIRAMA (a "dead" consonant
 *     seeking a conjunct) absorbs the next cluster (so `க்` + `ஷி` → one syllable
 *     `க்ஷி`, mirroring the Devanagari `क्षि` single cluster).
 * For Latin (no matras/virama) every cluster is its own syllable — callers should
 * prefer word-level highlight there; this only refines Indic timing.
 *
 * `lang` is the run's language code (e.g. `ta`/`hi`); the script is detected from
 * the text so a mixed/explicit `lang` still segments by what is actually written.
 * Ranges are half-open `[start,end)` cluster indices, contiguous and covering all
 * clusters in order. When unsure, the safe fallback is fewer, larger syllables (the
 * skill: "fall back to word-level rather than risk a wrong split"). Pure.
 */
export function splitSyllables(text: string, _lang?: string): SyllableRange[] {
  const clusters = segmentClusters(text)
  if (clusters.length === 0) return []
  const script = detectScript(text)

  const ranges: SyllableRange[] = []
  let start = 0
  let absorbNext = false

  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i]
    const isFirst = i === start
    if (!isFirst) {
      // Decide whether `c` opens a NEW syllable or joins the current one.
      const joins = absorbNext || startsWithDependentSign(c, script)
      if (!joins) {
        // Close the current syllable [start, i) and open a new one at i.
        ranges.push({ text: clusters.slice(start, i).join(''), start, end: i })
        start = i
      }
    }
    // A trailing virama means the next cluster is a conjunct continuation.
    absorbNext = endsWithVirama(c, script)
  }
  ranges.push({ text: clusters.slice(start).join(''), start, end: clusters.length })
  return ranges
}

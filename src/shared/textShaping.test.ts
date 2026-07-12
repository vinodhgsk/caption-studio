/**
 * Tests for the shaping/segmentation contract (P6.18 — indic-text / text-render).
 *
 * The spec is the `indic-text` skill. These tests assert:
 *   - grapheme-cluster segmentation for Tamil `கி` / `க்ஷி` and Devanagari `क्षि`
 *     matches `splitGraphemes` exactly (ICU-version-stable — no hard-coded counts
 *     that could drift across ICU/Node versions);
 *   - the {@link TextShaper} interface returns clusters + advances;
 *   - the PREVIEW shaper and the EXPORT shaper produce IDENTICAL cluster sequences
 *     for the same input + font (deterministic mock measurer) — the parity guarantee;
 *   - matra/reordering cases never split mid-cluster;
 *   - it integrates with {@link layoutGlyphBoxes} (same cluster boundaries).
 */
import { describe, it, expect } from 'vitest'
import { splitGraphemes } from './captionSync'
import {
  segmentClusters,
  clusterCount,
  shapeRun,
  shapeClusters,
  splitSyllables,
  GraphemeClusterShaper,
  DEFAULT_SHAPER,
  type MeasureAdvance,
  type TextShaper
} from './textShaping'
import { layoutGlyphBoxes } from '../renderer/routes/editor/preview/textLayout'

// Known Indic test strings (indic-text "Determinism / parity").
const TAMIL_KI = 'கி' // KA U+0B95 + vowel sign I U+0BBF → one cluster
const TAMIL_KSHI = 'க்ஷி' // KA + virama + SSA + vowel sign I
const DEVANAGARI_KSHI = 'क्षि' // KA + virama + SSA + vowel sign I → one cluster (InCB)

/**
 * A deterministic, font-independent advance measurer for tests: each grapheme
 * cluster advances by a fixed width per CODE POINT (so a 2-codepoint cluster like
 * `கி` is wider than a 1-codepoint one) — fully reproducible, no canvas/DOM.
 */
const mockMeasure: MeasureAdvance = (s: string) => Array.from(s).length * 10

describe('segmentClusters — atomic grapheme clusters (indic-text cardinal rule)', () => {
  it('Tamil கி is ONE cluster, equal to splitGraphemes', () => {
    expect(segmentClusters(TAMIL_KI)).toEqual(splitGraphemes(TAMIL_KI))
    expect(clusterCount(TAMIL_KI)).toBe(1)
    // It is more than one code point — proving we are not counting code points.
    expect(Array.from(TAMIL_KI).length).toBeGreaterThan(1)
  })

  it('Tamil க்ஷி segments per ICU rules, equal to splitGraphemes', () => {
    // Assert against splitGraphemes (ICU-stable) rather than a fixed count.
    expect(segmentClusters(TAMIL_KSHI)).toEqual(splitGraphemes(TAMIL_KSHI))
    // Whatever ICU yields, each cluster is non-empty and they re-join to the input.
    const clusters = segmentClusters(TAMIL_KSHI)
    expect(clusters.join('')).toBe(TAMIL_KSHI)
    expect(clusters.every((c) => c.length > 0)).toBe(true)
  })

  it('Devanagari क्षि segments per ICU rules, equal to splitGraphemes', () => {
    expect(segmentClusters(DEVANAGARI_KSHI)).toEqual(splitGraphemes(DEVANAGARI_KSHI))
    expect(segmentClusters(DEVANAGARI_KSHI).join('')).toBe(DEVANAGARI_KSHI)
  })

  it('clusterCount drives per-char logic, not code-point length', () => {
    // Tamil கி: 1 cluster but 2 code points.
    expect(clusterCount(TAMIL_KI)).toBe(splitGraphemes(TAMIL_KI).length)
    expect(clusterCount('')).toBe(0)
    expect(clusterCount('abc')).toBe(3)
  })
})

describe('TextShaper — clusters + advances', () => {
  it('shapes a run into positioned clusters with advances', () => {
    const run = shapeRun('abc', mockMeasure, 0)
    expect(run.clusters.map((c) => c.cluster)).toEqual(['a', 'b', 'c'])
    expect(run.clusters.map((c) => c.advance)).toEqual([10, 10, 10])
    expect(run.clusters.map((c) => c.x)).toEqual([0, 10, 20])
    expect(run.clusters.map((c) => c.index)).toEqual([0, 1, 2])
    expect(run.advance).toBe(30)
  })

  it('folds letterSpacing BETWEEN clusters only (not after the last)', () => {
    const run = shapeRun('abc', mockMeasure, 5)
    // x: 0, 10+5, 25+5 ; advance: 30 base + 2 gaps * 5 = 40
    expect(run.clusters.map((c) => c.x)).toEqual([0, 15, 30])
    expect(run.advance).toBe(40)
  })

  it('treats Tamil கி as a single advance unit (one cluster, not two)', () => {
    const run = shapeRun(TAMIL_KI, mockMeasure, 7)
    expect(run.clusters).toHaveLength(1)
    expect(run.clusters[0].cluster).toBe(TAMIL_KI)
    // Single cluster → no inter-cluster letterSpacing applied.
    expect(run.advance).toBe(mockMeasure(TAMIL_KI))
  })

  it('empty text yields an empty run', () => {
    const run = shapeRun('', mockMeasure)
    expect(run.clusters).toEqual([])
    expect(run.advance).toBe(0)
  })

  it('reports the detected script of the run', () => {
    expect(shapeRun(TAMIL_KSHI, mockMeasure).script).toBe('tamil')
    expect(shapeRun(DEVANAGARI_KSHI, mockMeasure).script).toBe('devanagari')
    expect(shapeRun('hello', mockMeasure).script).toBe('latin')
  })

  it('the class shaper delegates to shapeRun and exposes a stable id', () => {
    const shaper = new GraphemeClusterShaper()
    expect(shaper.id).toBe('grapheme-cluster@1')
    expect(shaper.segment(TAMIL_KSHI)).toEqual(segmentClusters(TAMIL_KSHI))
    const run = shaper.shape('abc', mockMeasure, 5)
    expect(run).toEqual(shapeRun('abc', mockMeasure, 5, shaper))
  })
})

describe('preview ↔ export parity — one segmentation, two renderers', () => {
  // Simulate the two render paths as two TextShaper instances. The PREVIEW shaper
  // is the platform/canvas implementation; the EXPORT shaper is the headless
  // FFmpeg/libass implementation. Both MUST share the grapheme segmentation.
  const previewShaper: TextShaper = new GraphemeClusterShaper()
  const exportShaper: TextShaper = new GraphemeClusterShaper()

  // Different measurers (preview canvas metrics vs export freetype metrics) MUST
  // NOT change the cluster sequence — only advances may differ.
  const previewMeasure: MeasureAdvance = (s) => Array.from(s).length * 10
  const exportMeasure: MeasureAdvance = (s) => Array.from(s).length * 13.5

  const inputs = [TAMIL_KI, TAMIL_KSHI, DEVANAGARI_KSHI, 'Hello world', 'தமிழ் காப்ஷன்']

  it.each(inputs)('produces identical cluster sequences for %s', (text) => {
    const a = previewShaper.shape(text, previewMeasure)
    const b = exportShaper.shape(text, exportMeasure)
    // Cluster TEXT + INDEX + ORDER are identical across paths (parity).
    expect(a.clusters.map((c) => c.cluster)).toEqual(b.clusters.map((c) => c.cluster))
    expect(a.clusters.map((c) => c.index)).toEqual(b.clusters.map((c) => c.index))
    expect(a.script).toBe(b.script)
    // Only the advances differ (font metrics), proving the divergence is metric-only.
    expect(a.advance).not.toBe(b.advance)
  })

  it('shaper ids are equal so a parity content-hash check would pass', () => {
    expect(previewShaper.id).toBe(exportShaper.id)
  })

  it('segmentation is independent of the measurer entirely', () => {
    expect(shapeClusters(TAMIL_KSHI, previewShaper)).toEqual(shapeClusters(TAMIL_KSHI, exportShaper))
  })
})

describe('no cluster is split mid-way (matras / reordering)', () => {
  // For each sampled fraction of the run, the prefix of fully-revealed clusters
  // must always re-join to a clean prefix of the segmentation — never half a
  // cluster (which would render a dotted-circle artefact).
  const samples = [0, 0.25, 0.5, 0.75, 1]
  const inputs = [TAMIL_KI, TAMIL_KSHI, DEVANAGARI_KSHI]

  it.each(inputs)('reveal of %s never splits a cluster', (text) => {
    const clusters = segmentClusters(text)
    for (const t of samples) {
      const revealed = Math.round(t * clusters.length)
      const shown = clusters.slice(0, revealed).join('')
      // The shown text is exactly a concatenation of whole clusters.
      expect(segmentClusters(shown)).toEqual(clusters.slice(0, revealed))
      // And it is a genuine prefix of the original (no reordering corruption).
      expect(text.startsWith(shown)).toBe(true)
    }
  })
})

describe('splitSyllables — cluster-index ranges for karaoke', () => {
  it('returns contiguous, covering ranges in cluster units', () => {
    const text = 'தமிழ்'
    const clusters = segmentClusters(text)
    const syll = splitSyllables(text, 'ta')
    // Ranges are contiguous and cover every cluster.
    expect(syll[0].start).toBe(0)
    expect(syll[syll.length - 1].end).toBe(clusters.length)
    for (let i = 1; i < syll.length; i++) expect(syll[i].start).toBe(syll[i - 1].end)
    // Each range's text is the join of its clusters (no mid-cluster split).
    for (const s of syll) expect(s.text).toBe(clusters.slice(s.start, s.end).join(''))
  })

  it('absorbs a virama-trailing conjunct into one syllable (க்ஷி)', () => {
    // க்ஷி segments to க் + ஷி; the trailing virama on க் means ஷி joins it.
    const syll = splitSyllables(TAMIL_KSHI, 'ta')
    expect(syll).toHaveLength(1)
    expect(syll[0].text).toBe(TAMIL_KSHI)
  })

  it('treats each Latin cluster as its own syllable', () => {
    const syll = splitSyllables('cat', 'en')
    expect(syll.map((s) => s.text)).toEqual(['c', 'a', 't'])
  })

  it('empty input yields no syllables', () => {
    expect(splitSyllables('', 'ta')).toEqual([])
  })
})

describe('integrates with layoutGlyphBoxes (same cluster boundaries)', () => {
  it('per-cluster boxes match the shaper segmentation for Tamil க்ஷி', () => {
    const layout = layoutGlyphBoxes(
      [TAMIL_KSHI],
      { fontSizePx: 40, lineHeightMult: 1.2, align: 'center', letterSpacing: 0 },
      mockMeasure
    )
    const word = layout.lines[0].words[0]
    const layoutClusters = word.clusters.map((c) => c.cluster)
    // The boxes are tiled per the SAME segmentation the shaper produces.
    expect(layoutClusters).toEqual(segmentClusters(TAMIL_KSHI))
    expect(layoutClusters).toEqual(DEFAULT_SHAPER.segment(TAMIL_KSHI))
  })

  it('a Tamil கி word produces exactly one cluster box', () => {
    const layout = layoutGlyphBoxes(
      [TAMIL_KI],
      { fontSizePx: 40, lineHeightMult: 1.2, align: 'left' },
      mockMeasure
    )
    expect(layout.lines[0].words[0].clusters).toHaveLength(1)
  })

  it('cluster x-positions from the shaper match the layout box left-edges', () => {
    // With center align + single word, the shaper run advance equals the line box
    // width, and cluster order/advances align with the layout cluster boxes.
    const word = 'காப்ஷன்'
    const layout = layoutGlyphBoxes(
      [word],
      { fontSizePx: 40, lineHeightMult: 1, align: 'left', letterSpacing: 3 },
      mockMeasure
    )
    const run = shapeRun(word, mockMeasure, 3)
    const boxes = layout.lines[0].words[0].clusters
    expect(boxes.map((b) => b.cluster)).toEqual(run.clusters.map((c) => c.cluster))
    // Relative spacing between consecutive cluster left-edges matches advances+ls.
    for (let i = 1; i < boxes.length; i++) {
      const layoutGap = boxes[i].box.x - boxes[i - 1].box.x
      const shaperGap = run.clusters[i].x - run.clusters[i - 1].x
      expect(layoutGap).toBeCloseTo(shaperGap, 6)
    }
  })
})

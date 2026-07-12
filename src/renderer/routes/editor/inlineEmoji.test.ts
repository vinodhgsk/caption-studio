/**
 * Inline emoji in the run flow (P7.11 — Doc 05; skills `text-render`, `indic-text`).
 *
 * These tests VERIFY that emoji require no special-casing: because emoji are
 * extended grapheme clusters and the whole pipeline is cluster-based, an emoji
 * embedded in the run flows/measures/wraps/animates as ONE cluster — exactly like a
 * letter or a Tamil conjunct. We assert:
 *   - emoji are single grapheme clusters (simple 🎉, skin-tone 👍🏽, ZWJ 👩‍👩‍👧),
 *     equal to `splitGraphemes` / `segmentClusters` (ICU-version-stable — asserted
 *     against the shared segmenter, not hard-coded code-point counts);
 *   - a mixed text+emoji line lays out with the emoji occupying ONE cluster box at
 *     the measured advance (`layoutGlyphBoxes`);
 *   - emoji participate in word boxes + line width + shaping (`shapeRun`);
 *   - an emoji at a curve/reveal cluster index gets a per-cluster transform like any
 *     cluster (`layoutArcClusters`, `revealedWordText`);
 *   - a Tamil + emoji mixed line clusters correctly (conjunct + emoji each one cluster);
 *   - the minimal cursor-aware insertion helper never splits a cluster.
 *
 * The mock measurer counts CODE POINTS (`Array.from`), modelling a real measurer
 * where ONE emoji cluster is ONE advance unit (a single 🎉 advances by one unit,
 * not two UTF-16 units) — the canvas `ctx.measureText` does the same per cluster.
 */
import { describe, it, expect } from 'vitest'
import { splitGraphemes } from '../../../shared/captionSync'
import { segmentClusters, shapeRun, DEFAULT_SHAPER, type MeasureAdvance } from '../../../shared/textShaping'
import {
  layoutGlyphBoxes,
  layoutArcClusters,
  lineClusters,
  measuredLineWidth,
  type MeasureWidth
} from './preview/textLayout'
import { revealedWordText } from '../../store/timeline/captionReveal'
import { insertEmojiAtCluster, appendEmoji, isSingleCluster } from './inlineEmoji'

// Emoji fixtures (each is ONE extended grapheme cluster under Unicode rules):
const PARTY = '🎉' // simple emoji — U+1F389 (one cluster, 2 UTF-16 units)
const THUMB_TONE = '👍🏽' // U+1F44D + skin-tone modifier U+1F3FD → ONE cluster
const FAMILY = '👩‍👩‍👧' // ZWJ sequence woman+woman+girl → ONE cluster

/**
 * Deterministic, font-independent measurer counting CODE POINTS so an emoji
 * cluster's advance models a single emoji glyph box (1 unit per code point × 10).
 * This proves the layout uses the INJECTED advance per cluster, not `.length`.
 */
const measure: MeasureWidth & MeasureAdvance = (s: string) => Array.from(s).length * 10

describe('emoji is ONE grapheme cluster (ICU-stable, equal to splitGraphemes)', () => {
  it.each([
    ['simple 🎉', PARTY],
    ['skin-tone 👍🏽', THUMB_TONE],
    ['ZWJ 👩‍👩‍👧', FAMILY]
  ])('%s segments to a single cluster', (_label, emoji) => {
    // Asserted against the shared segmenter (no hard-coded counts → ICU-stable).
    expect(segmentClusters(emoji)).toEqual(splitGraphemes(emoji))
    expect(segmentClusters(emoji)).toHaveLength(1)
    expect(segmentClusters(emoji)[0]).toBe(emoji)
    // ...and it is MORE than one UTF-16 unit, proving we are not counting units.
    expect(emoji.length).toBeGreaterThan(1)
    expect(isSingleCluster(emoji)).toBe(true)
  })

  it.each([
    ['skin-tone 👍🏽', THUMB_TONE],
    ['ZWJ 👩‍👩‍👧', FAMILY]
  ])('%s is a MULTI-codepoint single cluster (modifier/ZWJ not split)', (_label, emoji) => {
    // The modifier/ZWJ cases are >1 code point yet still ONE cluster.
    expect(Array.from(emoji).length).toBeGreaterThan(1)
    expect(segmentClusters(emoji)).toHaveLength(1)
  })

  it('a ZWJ family is NOT split at the ZWJ joiners', () => {
    const clusters = segmentClusters(FAMILY)
    expect(clusters).toHaveLength(1)
    // The joined sequence stays whole — never the three separate people glyphs.
    expect(clusters[0]).toBe(FAMILY)
    expect(clusters[0]).toContain('‍')
  })

  it('a skin-tone modifier stays attached to its base emoji', () => {
    expect(segmentClusters(THUMB_TONE)).toEqual([THUMB_TONE])
    // The base 👍 alone vs the modified 👍🏽 are both single clusters of different width.
    expect(measure('👍')).toBeLessThan(measure(THUMB_TONE))
  })

  it('two emoji are TWO clusters (insertion guard rejects a multi-cluster token)', () => {
    expect(segmentClusters(PARTY + PARTY)).toHaveLength(2)
    expect(isSingleCluster(PARTY + PARTY)).toBe(false)
    expect(isSingleCluster('ab')).toBe(false)
  })
})

describe('emoji flows inline: one cluster box at the measured advance', () => {
  const line = 'Great 🎉 job'

  it('the emoji occupies exactly one cluster box of its measured advance', () => {
    const layout = layoutGlyphBoxes(
      [line],
      { fontSizePx: 40, lineHeightMult: 1.2, align: 'center' },
      measure
    )
    // Words: "Great", "🎉", "job" (single-space split, as the draw path does).
    const words = layout.lines[0].words
    expect(words.map((w) => w.word)).toEqual(['Great', '🎉', 'job'])
    const emojiWord = words[1]
    // The emoji word is ONE cluster box (not two code-point boxes).
    expect(emojiWord.clusters).toHaveLength(1)
    expect(emojiWord.clusters[0].cluster).toBe(PARTY)
    // Its box width is the MEASURED advance of the emoji (injected measurer).
    expect(emojiWord.clusters[0].box.width).toBe(measure(PARTY))
    expect(emojiWord.box.width).toBe(measure(PARTY))
  })

  it('the emoji contributes its advance to the LINE width', () => {
    // Line width includes the emoji's advance just like any cluster. Use the
    // skin-tone emoji (2 code points → advance 20) vs a 1-codepoint letter so the
    // difference is the emoji's extra advance — not a coincidence of equal widths.
    const withEmoji = measuredLineWidth('Great 👍🏽 job', measure)
    const withLetter = measuredLineWidth('Great x job', measure)
    expect(withEmoji - withLetter).toBe(measure(THUMB_TONE) - measure('x'))
    // The emoji's own advance is part of the measured line (sanity).
    expect(measuredLineWidth(line, measure)).toBeGreaterThan(measuredLineWidth('Great  job', measure))
  })

  it('shapeRun places the emoji as one positioned cluster (parity with layout)', () => {
    const run = shapeRun(line, measure, 0)
    const emoji = run.clusters.find((c) => c.cluster === PARTY)
    expect(emoji).toBeDefined()
    expect(emoji!.advance).toBe(measure(PARTY))
    // The shaper segmentation matches the layout segmentation (one source of truth).
    expect(run.clusters.map((c) => c.cluster)).toEqual(DEFAULT_SHAPER.segment(line))
  })

  it('an emoji at a WRAP boundary is one indivisible token', () => {
    // An emoji-only word never splits across a wrap: it is a single cluster word.
    const layout = layoutGlyphBoxes(
      ['done', '🎉'],
      { fontSizePx: 30, lineHeightMult: 1, align: 'left' },
      measure
    )
    const second = layout.lines[1]
    expect(second.words).toHaveLength(1)
    expect(second.words[0].clusters).toHaveLength(1)
    expect(second.words[0].clusters[0].cluster).toBe(PARTY)
  })
})

describe('emoji animates with the text (per-cluster transforms)', () => {
  const line = 'hi 🎉👍🏽'

  it('an emoji at a curve gets a per-cluster arc transform like any cluster', () => {
    const layout = layoutGlyphBoxes(
      [line],
      { fontSizePx: 40, lineHeightMult: 1.2, align: 'center' },
      measure
    )
    const lineBox = layout.lines[0]
    const clusters = lineClusters(lineBox)
    // The clusters are: h, i, 🎉, 👍🏽 (the space is not a visible cluster).
    expect(clusters.map((c) => c.cluster)).toEqual(['h', 'i', PARTY, THUMB_TONE])

    // Line center y = slot top + half height (the LaidOutLine.y baseline-row midpoint).
    const lineCenterY = lineBox.box.y + lineBox.box.height / 2
    const transforms = layoutArcClusters(clusters, lineBox.box, lineCenterY, 0.8)
    // One transform per cluster, including each emoji — they curve with the text.
    expect(transforms).toHaveLength(clusters.length)
    const emojiTr = transforms.find((t) => t.cluster === PARTY)!
    const familyTr = transforms.find((t) => t.cluster === THUMB_TONE)!
    expect(emojiTr).toBeDefined()
    // A non-center cluster on a curve has a non-zero rotation (it tilts to the arc).
    expect(emojiTr.rotation).not.toBe(0)
    expect(familyTr.rotation).not.toBe(0)
  })

  it('curve=0 leaves the emoji at its straight cluster center (animation-compose base)', () => {
    const layout = layoutGlyphBoxes(
      [line],
      { fontSizePx: 40, lineHeightMult: 1.2, align: 'center' },
      measure
    )
    const lineBox = layout.lines[0]
    const clusters = lineClusters(lineBox)
    const lineCenterY = lineBox.box.y + lineBox.box.height / 2
    const flat = layoutArcClusters(clusters, lineBox.box, lineCenterY, 0)
    const emojiCluster = clusters.find((c) => c.cluster === PARTY)!
    const emojiFlat = flat.find((t) => t.cluster === PARTY)!
    // At curve 0 the transform is the straight cluster center (no rotation/scale).
    expect(emojiFlat.x).toBeCloseTo(emojiCluster.box.x + emojiCluster.box.width / 2, 6)
    expect(emojiFlat.rotation).toBe(0)
    expect(emojiFlat.scale).toBe(1)
  })

  it('character reveal advances over the emoji as one cluster (never half)', () => {
    const word = 'a🎉b'
    const clusters = splitGraphemes(word) // ['a','🎉','b']
    // Revealing 2 clusters shows the letter + the WHOLE emoji, not a broken half.
    expect(revealedWordText(word, 0)).toBe('')
    expect(revealedWordText(word, 1)).toBe('a')
    expect(revealedWordText(word, 2)).toBe('a' + PARTY)
    expect(revealedWordText(word, 3)).toBe(word)
    // Each revealed prefix re-segments to a clean cluster prefix (no mid-cluster cut).
    for (let n = 0; n <= clusters.length; n++) {
      expect(splitGraphemes(revealedWordText(word, n))).toEqual(clusters.slice(0, n))
    }
  })
})

describe('Tamil + emoji mixed line clusters correctly', () => {
  const line = 'கி🎉👩‍👩‍👧' // Tamil conjunct + party + ZWJ family, no spaces (one word)

  it('the conjunct and each emoji are each ONE cluster', () => {
    expect(segmentClusters(line)).toEqual(['கி', PARTY, FAMILY])
  })

  it('lays out as three cluster boxes (conjunct + 2 emoji), measured advances', () => {
    const layout = layoutGlyphBoxes(
      [line],
      { fontSizePx: 48, lineHeightMult: 1.2, align: 'left' },
      measure
    )
    const clusters = layout.lines[0].words[0].clusters
    expect(clusters.map((c) => c.cluster)).toEqual(['கி', PARTY, FAMILY])
    // Each box width is its own measured advance (conjunct 2 cp, family 5 cp incl. ZWJ).
    expect(clusters[0].box.width).toBe(measure('கி'))
    expect(clusters[1].box.width).toBe(measure(PARTY))
    expect(clusters[2].box.width).toBe(measure(FAMILY))
    // Cluster boxes tile left-to-right with no overlap (each starts at the prev right).
    for (let i = 1; i < clusters.length; i++) {
      expect(clusters[i].box.x).toBeCloseTo(clusters[i - 1].box.x + clusters[i - 1].box.width, 6)
    }
  })
})

describe('insertEmojiAtCluster — cursor-aware, never splits a cluster', () => {
  it('inserts at a cluster index, splicing between clusters', () => {
    // "ab" → insert 🎉 at cluster index 1 → "a🎉b".
    expect(insertEmojiAtCluster('ab', PARTY, 1)).toBe('a' + PARTY + 'b')
  })

  it('clamps an out-of-range index to the nearest end (prepend / append)', () => {
    expect(insertEmojiAtCluster('ab', PARTY, -5)).toBe(PARTY + 'ab')
    expect(insertEmojiAtCluster('ab', PARTY, 99)).toBe('ab' + PARTY)
  })

  it('never splits an existing multi-codepoint cluster', () => {
    // Insert BETWEEN the Tamil conjunct and the emoji (cluster index 1), not inside.
    const out = insertEmojiAtCluster('கி🎉', THUMB_TONE, 1)
    expect(segmentClusters(out)).toEqual(['கி', THUMB_TONE, PARTY])
  })

  it('inserts a ZWJ emoji as one whole cluster', () => {
    const out = insertEmojiAtCluster('hi', FAMILY, 2)
    expect(segmentClusters(out)).toEqual(['h', 'i', FAMILY])
  })

  it('appendEmoji adds the emoji as a trailing cluster', () => {
    const out = appendEmoji('ok', PARTY)
    expect(segmentClusters(out)).toEqual(['o', 'k', PARTY])
  })
})

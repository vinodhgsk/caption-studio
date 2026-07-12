import { describe, expect, it } from 'vitest'
import { splitGraphemes } from '../../../../shared/captionSync'
import {
  layoutArcClusters,
  layoutGlyphBoxes,
  layoutTextLines,
  layoutWordsInLine,
  lineClusters,
  measuredLineWidth,
  textBlockSize,
  type MeasureWidth
} from './textLayout'

/** Deterministic measurer: each char is 10px wide (no canvas needed). */
const measure10: MeasureWidth = (line) => line.length * 10

describe('layoutWordsInLine', () => {
  it('empty word list → no entries', () => {
    expect(layoutWordsInLine([], measure10)).toEqual([])
  })

  it('places words left-to-right, centered on the line center, with one space between', () => {
    // 'ab'(20) + ' '(10) + 'cd'(20) → total 50; left edge at -25.
    const placed = layoutWordsInLine(['ab', 'cd'], measure10)
    expect(placed.map((p) => p.width)).toEqual([20, 20])
    // word0 center: -25 + 10 = -15 ; word1 center: -25 + 20 + 10 + 10 = 15
    expect(placed[0].x).toBe(-15)
    expect(placed[1].x).toBe(15)
    // symmetric about 0
    expect(placed[0].x).toBe(-placed[1].x)
  })
})

describe('textBlockSize', () => {
  it('returns zero size for no lines', () => {
    expect(textBlockSize([], 64, 1.2, measure10)).toEqual({ w: 0, h: 0 })
  })

  it('width is the widest line; height stacks by line height', () => {
    const size = textBlockSize(['ab', 'abcd'], 100, 1.5, measure10)
    expect(size.w).toBe(40) // 'abcd' = 4 * 10
    expect(size.h).toBe(2 * 100 * 1.5) // 300
  })

  it('counts empty lines as full vertical slots', () => {
    const size = textBlockSize(['a', '', 'c'], 50, 1.2, measure10)
    expect(size.h).toBe(3 * 50 * 1.2)
    expect(size.w).toBe(10)
  })
})

describe('layoutTextLines y-stacking', () => {
  it('single line is centered on y=0', () => {
    const laid = layoutTextLines(['hello'], 100, 1.2, 'center', measure10)
    expect(laid).toHaveLength(1)
    expect(laid[0].y).toBe(0)
  })

  it('multi-line stacks by one line height, centered on the block', () => {
    const laid = layoutTextLines(['a', 'b', 'c'], 100, 1.0, 'center', measure10)
    // lineH = 100, block h = 300, first center = -150 + 50 = -100.
    expect(laid.map((l) => l.y)).toEqual([-100, 0, 100])
  })
})

describe('layoutTextLines x-alignment', () => {
  it('center → x is 0 for every line', () => {
    const laid = layoutTextLines(['ab', 'abcd'], 64, 1.2, 'center', measure10)
    expect(laid.map((l) => l.x)).toEqual([0, 0])
  })

  it('left → narrower lines shift left by half the slack', () => {
    const laid = layoutTextLines(['ab', 'abcd'], 64, 1.2, 'left', measure10)
    // block w = 40. 'ab' (20): slack = (40-20)/2 = 10 → x = -10. 'abcd': x = 0.
    expect(laid[0].x).toBe(-10)
    expect(laid[1].x).toBe(0)
  })

  it('right → narrower lines shift right by half the slack', () => {
    const laid = layoutTextLines(['ab', 'abcd'], 64, 1.2, 'right', measure10)
    expect(laid[0].x).toBe(10)
    expect(laid[1].x).toBe(0)
  })

  it('keeps an entry (width 0) for empty lines', () => {
    const laid = layoutTextLines(['', 'abc'], 64, 1.2, 'left', measure10)
    expect(laid).toHaveLength(2)
    expect(laid[0].line).toBe('')
    // empty line width 0 → slack = 30/2 = 15 → x = -15
    expect(laid[0].x).toBe(-15)
  })

  it('empty input → empty layout', () => {
    expect(layoutTextLines([], 64, 1.2, 'center', measure10)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// P6.3 — letterSpacing + lineHeight typographic controls
// ---------------------------------------------------------------------------

describe('measuredLineWidth (letterSpacing)', () => {
  it('no spacing → base measured width', () => {
    expect(measuredLineWidth('abcd', measure10, 0)).toBe(40)
  })

  it('adds (clusters-1)*spacing to the base width', () => {
    // 'abcd' = 4 clusters → 3 gaps. base 40 + 3*5 = 55.
    expect(measuredLineWidth('abcd', measure10, 5)).toBe(40 + 3 * 5)
  })

  it('single cluster / empty line gets no extra spacing', () => {
    expect(measuredLineWidth('a', measure10, 5)).toBe(10)
    expect(measuredLineWidth('', measure10, 5)).toBe(0)
  })

  it('negative spacing tightens the line', () => {
    expect(measuredLineWidth('abc', measure10, -2)).toBe(30 - 2 * 2)
  })
})

describe('textBlockSize with letterSpacing', () => {
  it('letterSpacing increases the measured block width by (n-1)*spacing', () => {
    const base = textBlockSize(['abcde'], 64, 1.2, measure10) // 50
    const spaced = textBlockSize(['abcde'], 64, 1.2, measure10, 4) // +4*4
    expect(base.w).toBe(50)
    expect(spaced.w).toBe(50 + 4 * 4)
    // height (line stacking) is unaffected by letterSpacing
    expect(spaced.h).toBe(base.h)
  })

  it('width tracks the widest line including its own spacing', () => {
    // 'ab'(20)+1gap*sp ; 'abcd'(40)+3gap*sp → with sp=10: 30 vs 70 → 70.
    const size = textBlockSize(['ab', 'abcd'], 64, 1.2, measure10, 10)
    expect(size.w).toBe(40 + 3 * 10)
  })
})

describe('textBlockSize / layoutTextLines lineHeight', () => {
  it('lineHeight scales block height and per-line y stacking', () => {
    const tight = textBlockSize(['a', 'b', 'c'], 100, 1.0, measure10)
    const loose = textBlockSize(['a', 'b', 'c'], 100, 1.5, measure10)
    expect(tight.h).toBe(300)
    expect(loose.h).toBe(450)

    const laidTight = layoutTextLines(['a', 'b', 'c'], 100, 1.0, 'center', measure10)
    const laidLoose = layoutTextLines(['a', 'b', 'c'], 100, 1.5, 'center', measure10)
    // tight: lineH 100 → [-100, 0, 100]; loose: lineH 150 → [-150, 0, 150]
    expect(laidTight.map((l) => l.y)).toEqual([-100, 0, 100])
    expect(laidLoose.map((l) => l.y)).toEqual([-150, 0, 150])
  })

  it('size scales metrics (block height = lines * size * lineHeight)', () => {
    const small = textBlockSize(['x', 'y'], 40, 1.2, measure10)
    const big = textBlockSize(['x', 'y'], 80, 1.2, measure10)
    expect(small.h).toBe(2 * 40 * 1.2)
    expect(big.h).toBe(2 * 80 * 1.2)
    expect(big.h).toBe(small.h * 2)
  })
})

describe('layoutTextLines x-alignment honors letterSpacing', () => {
  it('left alignment uses the spaced widths for slack', () => {
    // sp=10: 'ab' spaced=30, 'abcd' spaced=70 → block 70.
    // 'ab' slack=(70-30)/2=20 → x=-20 ; 'abcd' x=0.
    const laid = layoutTextLines(['ab', 'abcd'], 64, 1.2, 'left', measure10, 10)
    expect(laid[0].x).toBe(-20)
    expect(laid[1].x).toBe(0)
  })
})

describe('layoutWordsInLine with letterSpacing', () => {
  it('widens each word and the inter-word gap by letterSpacing', () => {
    // sp=10: 'ab' spaced=30, 'cd' spaced=30; space ' '(10)+sp(10)+sp(10)=30.
    // total = 30 + 30 + 30 = 90 → left edge -45.
    const placed = layoutWordsInLine(['ab', 'cd'], measure10, 10)
    expect(placed.map((p) => p.width)).toEqual([30, 30])
    // word0 center: -45 + 15 = -30 ; word1 center: -45 + 30 + 30 + 15 = 30
    expect(placed[0].x).toBe(-30)
    expect(placed[1].x).toBe(30)
    expect(placed[0].x).toBe(-placed[1].x)
  })
})

// ---------------------------------------------------------------------------
// P6.4 — per-line / per-word / per-grapheme-cluster bounding boxes
// ---------------------------------------------------------------------------

describe('layoutGlyphBoxes — block + line boxes', () => {
  it('block box is centered on the origin and matches textBlockSize', () => {
    const size = textBlockSize(['ab', 'abcd'], 100, 1.2, measure10)
    const { block } = layoutGlyphBoxes(
      ['ab', 'abcd'],
      { fontSizePx: 100, lineHeightMult: 1.2, align: 'center' },
      measure10
    )
    expect(block).toEqual({ x: -size.w / 2, y: -size.h / 2, width: size.w, height: size.h })
  })

  it('line box height is the line-height slot; y stacks by line height', () => {
    const { lines } = layoutGlyphBoxes(
      ['a', 'b', 'c'],
      { fontSizePx: 100, lineHeightMult: 1.0, align: 'center' },
      measure10
    )
    // lineH=100; centers at [-100,0,100] → tops at [-150,-50,50].
    expect(lines.map((l) => l.box.height)).toEqual([100, 100, 100])
    expect(lines.map((l) => l.box.y)).toEqual([-150, -50, 50])
  })

  it('lineHeight sets per-line y (looser line height spreads boxes)', () => {
    const loose = layoutGlyphBoxes(
      ['a', 'b'],
      { fontSizePx: 100, lineHeightMult: 1.5, align: 'center' },
      measure10
    )
    // lineH=150; block h=300; centers [-75,75] → tops [-150, 0]; height 150.
    expect(loose.lines.map((l) => l.box.y)).toEqual([-150, 0])
    expect(loose.lines.map((l) => l.box.height)).toEqual([150, 150])
  })
})

describe('layoutGlyphBoxes — per-word boxes tile a line', () => {
  it('adjacent word boxes are separated by exactly the space advance and span the line', () => {
    const sp = 0
    const { lines } = layoutGlyphBoxes(
      ['ab cd ef'],
      { fontSizePx: 64, lineHeightMult: 1.2, align: 'center' },
      measure10
    )
    const [line] = lines
    const [w0, w1, w2] = line.words
    expect(line.words.map((w) => w.word)).toEqual(['ab', 'cd', 'ef'])
    // Each word 20px; the gap between consecutive word boxes is the space (10).
    const spaceAdvance = 10 + 2 * sp
    expect(w1.box.x - (w0.box.x + w0.box.width)).toBeCloseTo(spaceAdvance)
    expect(w2.box.x - (w1.box.x + w1.box.width)).toBeCloseTo(spaceAdvance)
    // Words + 2 spaces sum to the line width.
    const wordsSum = line.words.reduce((a, w) => a + w.box.width, 0)
    expect(wordsSum + 2 * spaceAdvance).toBeCloseTo(line.box.width)
    // The union of words spans the line box edge-to-edge.
    expect(w0.box.x).toBeCloseTo(line.box.x)
    expect(w2.box.x + w2.box.width).toBeCloseTo(line.box.x + line.box.width)
  })

  it('letterSpacing widens the gap between adjacent word boxes', () => {
    const { lines } = layoutGlyphBoxes(
      ['ab cd'],
      { fontSizePx: 64, lineHeightMult: 1.2, align: 'center', letterSpacing: 6 },
      measure10
    )
    const [w0, w1] = lines[0].words
    // space advance = 10 + 2*6 = 22.
    expect(w1.box.x - (w0.box.x + w0.box.width)).toBeCloseTo(22)
  })
})

describe('layoutGlyphBoxes — per-cluster boxes tile a word', () => {
  it('cluster boxes tile the word width with no overlap (no spacing)', () => {
    const { lines } = layoutGlyphBoxes(
      ['abcd'],
      { fontSizePx: 64, lineHeightMult: 1.2, align: 'center' },
      measure10
    )
    const word = lines[0].words[0]
    expect(word.clusters.map((c) => c.cluster)).toEqual(['a', 'b', 'c', 'd'])
    // Each 10px, abutting; first starts at the word left, last ends at word right.
    for (let i = 1; i < word.clusters.length; i++) {
      const prev = word.clusters[i - 1].box
      const cur = word.clusters[i].box
      expect(cur.x).toBeCloseTo(prev.x + prev.width)
    }
    expect(word.clusters[0].box.x).toBeCloseTo(word.box.x)
    const last = word.clusters[word.clusters.length - 1].box
    expect(last.x + last.width).toBeCloseTo(word.box.x + word.box.width)
  })

  it('letterSpacing widens gaps between cluster boxes (one gap per boundary)', () => {
    const sp = 7
    const { lines } = layoutGlyphBoxes(
      ['abc'],
      { fontSizePx: 64, lineHeightMult: 1.2, align: 'center', letterSpacing: sp },
      measure10
    )
    const cs = lines[0].words[0].clusters
    expect(cs[1].box.x - (cs[0].box.x + cs[0].box.width)).toBeCloseTo(sp)
    expect(cs[2].box.x - (cs[1].box.x + cs[1].box.width)).toBeCloseTo(sp)
    // Last cluster's right edge still aligns to the (spaced) word right edge.
    const last = cs[cs.length - 1].box
    expect(last.x + last.width).toBeCloseTo(
      lines[0].words[0].box.x + lines[0].words[0].box.width
    )
  })
})

describe('layoutGlyphBoxes — Indic grapheme clusters (indic-text)', () => {
  // Tamil: 'கி' = க (U+0B95) + ி (U+0BBF) → one extended grapheme cluster (a
  // consonant + dependent vowel sign), so it must be ONE box, not two. The
  // conjunct 'க்ஷி' (க + virama + ஷ + ி) tiles per grapheme cluster — exactly
  // what splitGraphemes yields — and each box covers WHOLE codepoints, never
  // splitting a cluster mid-codepoint.
  const tamil = 'கி'
  const conjunct = 'க்ஷி'
  // Width by codepoint count so a multi-codepoint cluster is still one box and
  // its box width equals the sum of its codepoints' advances.
  const measureByCodepoint: MeasureWidth = (s) => Array.from(s).length * 10

  it('groups a consonant+vowel-sign into ONE box (not per codepoint)', () => {
    const { lines } = layoutGlyphBoxes(
      [tamil],
      { fontSizePx: 64, lineHeightMult: 1.2, align: 'center' },
      measureByCodepoint
    )
    const word = lines[0].words[0]
    // 'கி' is 2 codepoints but ONE cluster → one box that spans both codepoints.
    expect(word.clusters).toHaveLength(1)
    expect(word.clusters[0].cluster).toBe(tamil)
    expect(word.clusters[0].box.width).toBeCloseTo(20)
  })

  it('tiles a conjunct word into one box PER GRAPHEME CLUSTER, each covering whole codepoints', () => {
    const expected = splitGraphemes(conjunct)
    const { lines } = layoutGlyphBoxes(
      [conjunct],
      { fontSizePx: 64, lineHeightMult: 1.2, align: 'center' },
      measureByCodepoint
    )
    const word = lines[0].words[0]
    // One box per grapheme cluster (indic-text), in order — NEVER per codepoint.
    expect(word.clusters.map((c) => c.cluster)).toEqual(expected)
    // Each cluster's box width is its own whole-codepoint advance (no fractional
    // split): summing them gives the whole-word codepoint advance.
    for (const c of word.clusters) {
      expect(c.box.width).toBeCloseTo(Array.from(c.cluster).length * 10)
    }
    // Cluster boxes tile the word abutting (no letterSpacing) and span it fully.
    expect(word.clusters[0].box.x).toBeCloseTo(word.box.x)
    const last = word.clusters[word.clusters.length - 1].box
    expect(last.x + last.width).toBeCloseTo(word.box.x + word.box.width)
  })
})

describe('layoutGlyphBoxes — alignment shifts boxes', () => {
  it('left / center / right shift the line + word + cluster boxes consistently', () => {
    const opts = { fontSizePx: 64, lineHeightMult: 1.2 } as const
    const left = layoutGlyphBoxes(['ab', 'abcd'], { ...opts, align: 'left' }, measure10)
    const center = layoutGlyphBoxes(['ab', 'abcd'], { ...opts, align: 'center' }, measure10)
    const right = layoutGlyphBoxes(['ab', 'abcd'], { ...opts, align: 'right' }, measure10)
    // Narrow line 'ab' (20px) inside block width 40: slack 10 each side.
    // left → flush left at block left (-20); center → centered (-10); right → -20+20=0.
    expect(left.lines[0].box.x).toBeCloseTo(-20)
    expect(center.lines[0].box.x).toBeCloseTo(-10)
    expect(right.lines[0].box.x).toBeCloseTo(0)
    // The wide line spans the full block regardless of alignment.
    expect(left.lines[1].box.x).toBeCloseTo(-20)
    expect(right.lines[1].box.x).toBeCloseTo(-20)
    // First cluster of the narrow line tracks its line's left edge under each align.
    expect(left.lines[0].words[0].clusters[0].box.x).toBeCloseTo(left.lines[0].box.x)
    expect(right.lines[0].words[0].clusters[0].box.x).toBeCloseTo(right.lines[0].box.x)
  })
})

describe('layoutArcClusters (P6.5 curved/arc text)', () => {
  /** Lay out the single line 'abcd' (center-aligned) and return its arc transforms. */
  const arcOf = (text: string, curve: number, ls = 0) => {
    const boxes = layoutGlyphBoxes([text], { fontSizePx: 64, lineHeightMult: 1.2, align: 'center', letterSpacing: ls }, measure10)
    const lineBox = boxes.lines[0]
    const lineCenterY = layoutTextLines([text], 64, 1.2, 'center', measure10, ls)[0].y
    return layoutArcClusters(lineClusters(lineBox), lineBox.box, lineCenterY, curve)
  }

  it('curve=0 → transforms equal the straight baseline (x advances, y=baseline, rotation=0, scale=1)', () => {
    const straight = arcOf('abcd', 0)
    // The straight per-cluster centers from layoutGlyphBoxes for comparison.
    const boxes = layoutGlyphBoxes(['abcd'], { fontSizePx: 64, lineHeightMult: 1.2, align: 'center' }, measure10)
    const baseY = layoutTextLines(['abcd'], 64, 1.2, 'center', measure10)[0].y
    const clusters = lineClusters(boxes.lines[0])
    straight.forEach((tr, i) => {
      const cx = clusters[i].box.x + clusters[i].box.width / 2
      expect(tr.x).toBeCloseTo(cx)
      expect(tr.y).toBeCloseTo(baseY)
      expect(tr.rotation).toBe(0)
      expect(tr.scale).toBe(1)
    })
  })

  it('one transform per grapheme cluster, in left-to-right order', () => {
    const arc = arcOf('abcd', 0.5)
    expect(arc.map((t) => t.cluster)).toEqual(['a', 'b', 'c', 'd'])
    // x strictly increasing → cluster ORDER preserved along the arc.
    for (let i = 1; i < arc.length; i++) expect(arc[i].x).toBeGreaterThan(arc[i - 1].x)
  })

  it('symmetric curve → symmetric left/right rotation signs with a peak/center axis', () => {
    const arc = arcOf('abcd', 0.6)
    // 4 clusters → centers at -15,-5,5,15 (symmetric about 0). Outer rotations
    // are opposite sign and equal magnitude; inner likewise.
    expect(arc[0].rotation).toBeLessThan(0) // left half: negative (ccw)
    expect(arc[3].rotation).toBeGreaterThan(0) // right half: positive (cw)
    expect(arc[0].rotation).toBeCloseTo(-arc[3].rotation)
    expect(arc[1].rotation).toBeCloseTo(-arc[2].rotation)
    // Apex at center: the center clusters sit ABOVE (smaller y) than the ends for curve > 0.
    expect(arc[1].y).toBeLessThan(arc[0].y)
    expect(arc[2].y).toBeLessThan(arc[3].y)
  })

  it('curve sign flips vertical bow + rotation direction (up vs down)', () => {
    const up = arcOf('abcd', 0.6)
    const down = arcOf('abcd', -0.6)
    up.forEach((tr, i) => {
      // y mirrored about the baseline; rotations negated.
      const baseY = layoutTextLines(['abcd'], 64, 1.2, 'center', measure10)[0].y
      expect(down[i].y - baseY).toBeCloseTo(-(tr.y - baseY))
      expect(down[i].rotation).toBeCloseTo(-tr.rotation)
      expect(down[i].x).toBeCloseTo(tr.x) // horizontal placement unchanged
    })
  })

  it('larger |curve| → more rotation + more vertical displacement at the ends', () => {
    const small = arcOf('abcd', 0.2)
    const large = arcOf('abcd', 0.8)
    const baseY = layoutTextLines(['abcd'], 64, 1.2, 'center', measure10)[0].y
    // End-cluster rotation magnitude grows with curve.
    expect(Math.abs(large[3].rotation)).toBeGreaterThan(Math.abs(small[3].rotation))
    // End-cluster vertical drop from baseline grows with curve.
    expect(Math.abs(large[3].y - baseY)).toBeGreaterThan(Math.abs(small[3].y - baseY))
  })

  it('arc length preserves cluster order + monotonic spacing along the curve', () => {
    const arc = arcOf('abcdef', 0.7)
    // Arc-length between adjacent clusters = chord distance; equal straight
    // spacing (each glyph 10px) maps to ~equal arc spacing → distances near-equal
    // and order preserved (strictly increasing x already checked above).
    const dists: number[] = []
    for (let i = 1; i < arc.length; i++) {
      const dx = arc[i].x - arc[i - 1].x
      const dy = arc[i].y - arc[i - 1].y
      dists.push(Math.hypot(dx, dy))
    }
    // All chord distances within a tight band of each other (uniform spacing).
    const min = Math.min(...dists)
    const max = Math.max(...dists)
    expect(max - min).toBeLessThan(min * 0.1)
  })

  it('Tamil grapheme clusters place one transform per cluster (indic-text)', () => {
    // 'கி' is ONE extended grapheme cluster; two of them = two clusters.
    const tamil = 'கிகி'
    expect(splitGraphemes(tamil)).toHaveLength(2)
    const arc = arcOf(tamil, 0.5)
    expect(arc).toHaveLength(2)
    expect(arc.map((t) => t.cluster)).toEqual(['கி', 'கி'])
    // Symmetric pair about the center: opposite rotation signs, mirrored x.
    expect(arc[0].rotation).toBeCloseTo(-arc[1].rotation)
    expect(arc[0].x).toBeCloseTo(-arc[1].x)
  })

  it('degenerate single cluster → no rotation regardless of curve', () => {
    const arc = arcOf('a', 0.9)
    expect(arc).toHaveLength(1)
    expect(arc[0].rotation).toBe(0)
    expect(arc[0].scale).toBe(1)
  })
})

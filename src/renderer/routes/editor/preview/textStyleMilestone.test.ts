/**
 * MILESTONE 6 roll-up (P6.19 — Docs 08/10 typography; skills `text-render`,
 * `indic-text`).
 *
 * This is the milestone GATE for "full font + fill + stroke + shadow control,
 * Indic scripts shape correctly." It does NOT re-run the focused unit suites
 * (fontParse / importFont / textFillSpec / textStrokeSpec / textShadowSpec /
 * textShaping each already cover their own resolve/parse/geometry rules). Instead
 * it asserts the INTEGRATION + PARITY guarantees that no single focused suite owns:
 *
 *   1. IMPORTED-FONT RELOAD PARITY — persist a project's font manifest, reopen it
 *      into a FRESH registry via rehydrateProjectFonts, and assert the
 *      re-registered FontEntry equals the originally-imported one (family, scripts,
 *      weights, styles, and bundle-relative file refs). Catches a manifest <-> entry
 *      round-trip drift that would make an imported family render differently after
 *      reload / on another machine.
 *
 *   2. GRADIENT + PER-WORD COLOR SNAPSHOT — a representative clip with a multi-stop
 *      gradient base fill + per-word run overrides → snapshot the RESOLVED fill draw
 *      spec (resolveTextFill + per-word runColorForWord) so any drift in the
 *      resolved color model is caught structurally.
 *
 *   3. STROKE STACKING (pipeline integration) — a 2–3 layer stroke resolved
 *      widest-first, painted through the canonical paintGlyphPasses pipeline onto a
 *      recording ctx, asserting the visible stroke order is widest → thinnest and
 *      the fill lands on top.
 *
 *   4. SHADOW GEOMETRY across ±180° — sweep the angle every 30° from -180 to 180
 *      and assert shadowOffset = (distance·cosθ, distance·sinθ) with the correct
 *      quadrant signs, plus the long-shadow step direction matches the same angle.
 *
 *   5. INDIC SHAPING + GRAPHEME-CLUSTER PARITY (the centerpiece) — Tamil கி / க்ஷி
 *      and Devanagari क्षि segment identically through the shared shaper, and the
 *      PREVIEW shaper and the EXPORT-contract shaper (same segmentation, different
 *      injected measurer) produce IDENTICAL cluster sequences + indices. Reveal /
 *      karaoke never splits mid-cluster.
 *
 * Deterministic + pure: no real font binaries, no canvas pixels, no whisper. The
 * shadow/fill/shaping assertions are over pure functions; the stroke-stacking test
 * uses a recording ctx (no real CanvasRenderingContext2D). Snapshots are structural
 * data, written on first run.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  addEntryToManifest,
  buildImportedFontEntry,
  emptyFontManifest,
  manifestEntryToFontEntry,
  FONT_MEDIA_DIR,
  type FontManifest,
  type FontMetadata
} from '../../../../shared/fontParse'
import { createFontRegistry } from '../../../../shared/fontRegistry'
import type { FontEntry } from '../../../../shared/fontRegistry'
import type { FontFileRef } from '../../../../shared/fontRegistry'
import type { Project } from '../../../../shared/storage'
import { rehydrateProjectFonts } from '../../../store/fonts/importFont'
import { __resetLoadedFontFaces } from '../../../store/fonts/fontFaceLoader'

import {
  resolveTextFill,
  normalizeTextRuns,
  runColorForWord,
  type ResolvedTextFill
} from './textFillSpec'
import { resolveTextStroke } from './textStrokeSpec'
import { shadowOffset, longShadowSteps } from './textShadowSpec'
import { paintGlyphPasses, type GlyphToken } from './textPaintPipeline'

import { splitGraphemes } from '../../../../shared/captionSync'
import {
  segmentClusters,
  shapeRun,
  GraphemeClusterShaper,
  type MeasureAdvance,
  type TextShaper
} from '../../../../shared/textShaping'

// ===========================================================================
// 1. IMPORTED-FONT RELOAD PARITY — persist manifest → reopen → identical entry
// ===========================================================================

beforeEach(() => {
  // In the vitest `node` env `document` is undefined, so loadImportedFontFaces is
  // a guarded no-op — the manifest <-> registry round-trip is what we assert.
  __resetLoadedFontFaces()
})

describe('M6.1 imported-font reload parity (persist → reopen → identical entry)', () => {
  /** Build the FontEntry an import would register for a Tamil family. */
  function importedTamilEntry(): FontEntry {
    const meta: FontMetadata = {
      family: 'Acme Tamil',
      subfamily: 'Bold',
      weight: 700,
      italic: false,
      fromNameTable: true
    }
    const fileRef: FontFileRef = {
      path: `${FONT_MEDIA_DIR}/AcmeTamil-Bold.ttf`,
      weight: 700,
      italic: false
    }
    // No scripts override → inferScripts('Acme Tamil') = ['tamil','latin'].
    return buildImportedFontEntry(meta, fileRef)
  }

  it('re-registers a family whose entry equals the originally imported one', async () => {
    // --- IMPORT (session 1): build the entry + persist it into the manifest. ----
    const original = importedTamilEntry()
    const manifest: FontManifest = addEntryToManifest(emptyFontManifest(), original)

    // sanity: the persisted record is portable (bundle-relative paths only).
    expect(manifest.imported).toHaveLength(1)
    expect(manifest.imported[0].files.every((f) => f.path.startsWith(`${FONT_MEDIA_DIR}/`))).toBe(
      true
    )

    // --- PERSIST → REOPEN (session 2): a FRESH registry + the saved manifest. ----
    const reopenedProject = { fonts: manifest } as Pick<Project, 'fonts'>
    const reg = createFontRegistry()
    expect(reg.hasFont('Acme Tamil')).toBe(false)

    const registered = await rehydrateProjectFonts(reopenedProject, '/bundles/P.vproj', reg)
    expect(registered).toEqual(['Acme Tamil'])

    // The re-registered entry must MATCH the original import (parity guarantee):
    // same family, scripts, weights, styles, and bundle-relative file refs.
    const reloaded = reg.getFont('Acme Tamil')
    expect(reloaded).toBeDefined()
    expect(reloaded!.family).toBe(original.family)
    expect(reloaded!.source).toBe('imported')
    expect(reloaded!.scripts).toEqual(original.scripts) // ['tamil','latin']
    expect(reloaded!.weights).toEqual(original.weights) // [700]
    expect(reloaded!.styles).toEqual(original.styles) // ['normal'] (italic:false)
    expect(reloaded!.files).toEqual(original.files) // bundle-relative ref preserved
  })

  it('the manifest record round-trips to the same FontEntry (no field drift)', () => {
    const original = importedTamilEntry()
    const manifest = addEntryToManifest(emptyFontManifest(), original)

    // manifestEntryToFontEntry is the single re-hydration projection — its output
    // must equal the original entry on every render-affecting field.
    const roundTripped = manifestEntryToFontEntry(manifest.imported[0])
    expect(roundTripped.family).toBe(original.family)
    expect(roundTripped.scripts).toEqual(original.scripts)
    expect(roundTripped.weights).toEqual(original.weights)
    expect(roundTripped.styles).toEqual(original.styles)
    expect(roundTripped.files).toEqual(original.files)
    expect(roundTripped.source).toBe('imported')
  })

  it('reload is idempotent: a second reopen re-registers the identical entry', async () => {
    const original = importedTamilEntry()
    const manifest = addEntryToManifest(emptyFontManifest(), original)
    const project = { fonts: manifest } as Pick<Project, 'fonts'>

    const regA = createFontRegistry()
    const regB = createFontRegistry()
    await rehydrateProjectFonts(project, '/bundles/P.vproj', regA)
    await rehydrateProjectFonts(project, '/bundles/P.vproj', regB)

    // Two independent reopens yield byte-for-byte equal entries (deterministic).
    expect(regA.getFont('Acme Tamil')).toEqual(regB.getFont('Acme Tamil'))
  })
})

// ===========================================================================
// 2. GRADIENT + PER-WORD COLOR SNAPSHOT — resolved fill spec + per-word overrides
// ===========================================================================

describe('M6.2 gradient + per-word color resolved-fill snapshot', () => {
  // A representative clip.text.fill bag: a 3-stop linear gradient at 45°.
  const fillBag: Record<string, unknown> = {
    type: 'gradient',
    angle: 45,
    opacity: 0.9,
    value: [
      { offset: 0, color: '#ff0000' },
      { offset: 0.5, color: '#00ff00' },
      { offset: 1, color: '#0000ff' }
    ]
  }

  // Three words; word 1 ("WORLD") overrides to a flat color, words 0 + 2 inherit
  // the gradient base (run color → null = keep the gradient paint).
  const words = ['HELLO', 'WORLD', 'CAPTION']
  const runsBag: unknown[] = [
    {}, // word 0 → base gradient
    { color: '#ffcc00' }, // word 1 → flat override
    { color: 'not-a-hex' } // word 2 → invalid → dropped → base gradient
  ]

  it('snapshots the resolved gradient fill + per-word color spec', () => {
    const base: ResolvedTextFill = resolveTextFill(fillBag)
    const baseOpacity = base.type === 'gradient' ? base.opacity : 1
    const runs = normalizeTextRuns(runsBag)

    const perWord = words.map((word, i) => ({
      word,
      // null = keep the gradient paint; a string = a flat per-word override.
      color: runColorForWord(base, runs, i, baseOpacity)
    }))

    expect({ base, perWord }).toMatchSnapshot('gradient+per-word fill spec')
  })

  it('structural invariants: gradient stops sorted, override baked at base opacity', () => {
    const base = resolveTextFill(fillBag)
    expect(base.type).toBe('gradient')
    if (base.type !== 'gradient') return
    // 3 stops, in ascending offset order, angle preserved.
    expect(base.stops.map((s) => s.offset)).toEqual([0, 0.5, 1])
    expect(base.angleDeg).toBe(45)
    expect(base.opacity).toBeCloseTo(0.9, 6)

    const runs = normalizeTextRuns(runsBag)
    // word 0 + word 2 inherit the gradient (null = use the gradient paint).
    expect(runColorForWord(base, runs, 0, base.opacity)).toBeNull()
    expect(runColorForWord(base, runs, 2, base.opacity)).toBeNull()
    // word 1 override is baked at the BASE opacity (0.9), not full opacity.
    expect(runColorForWord(base, runs, 1, base.opacity)).toBe('rgba(255, 204, 0, 0.9)')
    // a word index past the runs array inherits the base (no override).
    expect(runColorForWord(base, runs, 99, base.opacity)).toBeNull()
  })
})

// ===========================================================================
// 3. STROKE STACKING — widest-first through the canonical paint pipeline
// ===========================================================================

interface Op {
  op: 'fillText' | 'strokeText'
  text: string
  style: string
  lineWidth: number
}

/** A minimal recording ctx that logs the paint-op sequence + per-op state. */
function recordingCtx(): { ctx: CanvasRenderingContext2D; ops: Op[] } {
  const ops: Op[] = []
  const state = {
    shadowColor: 'transparent',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    fillStyle: '' as string,
    strokeStyle: '',
    lineWidth: 0,
    lineJoin: '',
    miterLimit: 0,
    globalCompositeOperation: 'source-over'
  }
  const ctx = {
    save() {},
    restore() {},
    fillText(text: string) {
      ops.push({ op: 'fillText', text, style: String(state.fillStyle), lineWidth: state.lineWidth })
    },
    strokeText(text: string) {
      ops.push({
        op: 'strokeText',
        text,
        style: String(state.strokeStyle),
        lineWidth: state.lineWidth
      })
    }
  }
  Object.defineProperties(ctx, {
    shadowColor: { get: () => state.shadowColor, set: (v) => (state.shadowColor = v) },
    shadowBlur: { get: () => state.shadowBlur, set: (v) => (state.shadowBlur = v) },
    shadowOffsetX: { get: () => state.shadowOffsetX, set: (v) => (state.shadowOffsetX = v) },
    shadowOffsetY: { get: () => state.shadowOffsetY, set: (v) => (state.shadowOffsetY = v) },
    fillStyle: { get: () => state.fillStyle, set: (v) => (state.fillStyle = v) },
    strokeStyle: { get: () => state.strokeStyle, set: (v) => (state.strokeStyle = v) },
    lineWidth: { get: () => state.lineWidth, set: (v) => (state.lineWidth = v) },
    lineJoin: { get: () => state.lineJoin, set: (v) => (state.lineJoin = v) },
    miterLimit: { get: () => state.miterLimit, set: (v) => (state.miterLimit = v) },
    globalCompositeOperation: {
      get: () => state.globalCompositeOperation,
      set: (v) => (state.globalCompositeOperation = v)
    }
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops }
}

describe('M6.3 stroke stacking — widest-first through the pipeline', () => {
  it('resolves a 3-layer stack widest-first and paints in that order with fill on top', () => {
    // Author order is NOT widest-first — the resolver must reorder.
    const strokeBag: unknown[] = [
      { color: '#ffffff', width: 2 }, // thinnest (authored first)
      { color: '#ff0000', width: 8 }, // widest
      { color: '#000000', width: 5 } // middle
    ]
    const stroke = resolveTextStroke(strokeBag)
    // Resolve order is widest → thinnest.
    expect(stroke.layers.map((l) => l.width)).toEqual([8, 5, 2])
    expect(stroke.hollow).toBe(false)

    const { ctx, ops } = recordingCtx()
    const token: GlyphToken = { text: 'Ab', x: 0, y: 0 }
    paintGlyphPasses({
      ctx,
      token,
      shadow: null,
      stroke,
      fill: (c, tk) => {
        c.fillStyle = 'rgba(0, 0, 255, 1)'
        c.fillText(tk.text, tk.x, tk.y)
      }
    })

    // The visible stroke layers paint WIDEST → thinnest.
    const strokeOps = ops.filter((o) => o.op === 'strokeText')
    expect(strokeOps.map((o) => o.lineWidth)).toEqual([8, 5, 2])
    expect(strokeOps.map((o) => o.style)).toEqual([
      'rgba(255, 0, 0, 1)',
      'rgba(0, 0, 0, 1)',
      'rgba(255, 255, 255, 1)'
    ])

    // The FILL lands AFTER every stroke layer (on top of the stack).
    const fillIdx = ops.findIndex((o) => o.op === 'fillText')
    const lastStrokeIdx = ops.map((o) => o.op).lastIndexOf('strokeText')
    expect(fillIdx).toBeGreaterThan(lastStrokeIdx)
    expect(ops[fillIdx].style).toBe('rgba(0, 0, 255, 1)')
  })

  it('a hollow 2-layer stack paints both strokes but NO fill body', () => {
    const strokeBag: unknown[] = [
      { color: '#000000', width: 6, hollow: true },
      { color: '#ffffff', width: 2, hollow: true }
    ]
    const stroke = resolveTextStroke(strokeBag)
    expect(stroke.hollow).toBe(true)
    expect(stroke.layers.map((l) => l.width)).toEqual([6, 2])

    const { ctx, ops } = recordingCtx()
    let filled = false
    paintGlyphPasses({
      ctx,
      token: { text: 'Ab', x: 0, y: 0 },
      shadow: null,
      stroke,
      fill: () => {
        filled = true
      }
    })
    expect(filled).toBe(false)
    expect(ops.every((o) => o.op === 'strokeText')).toBe(true)
    expect(ops.map((o) => o.lineWidth)).toEqual([6, 2])
  })
})

// ===========================================================================
// 4. SHADOW GEOMETRY across ±180° — offset = (d·cosθ, d·sinθ), quadrant signs
// ===========================================================================

describe('M6.4 shadow geometry across the full ±180° range', () => {
  const DISTANCE = 10

  // Every 30° from -180 to 180 inclusive.
  const angles: number[] = []
  for (let a = -180; a <= 180; a += 30) angles.push(a)

  it.each(angles)('offset at %i° equals (d·cosθ, d·sinθ)', (angle) => {
    const off = shadowOffset(angle, DISTANCE)
    const rad = (angle * Math.PI) / 180
    expect(off.x).toBeCloseTo(DISTANCE * Math.cos(rad), 6)
    expect(off.y).toBeCloseTo(DISTANCE * Math.sin(rad), 6)
  })

  it('axis-aligned angles snap to clean offsets (no float dust)', () => {
    expect(shadowOffset(0, DISTANCE)).toEqual({ x: 10, y: 0 }) // right
    expect(shadowOffset(90, DISTANCE)).toEqual({ x: 0, y: 10 }) // down
    expect(shadowOffset(-90, DISTANCE)).toEqual({ x: 0, y: -10 }) // up
    expect(shadowOffset(180, DISTANCE)).toEqual({ x: -10, y: 0 }) // left
    expect(shadowOffset(-180, DISTANCE)).toEqual({ x: -10, y: 0 }) // left (mirror)
  })

  it('quadrant signs are correct across all four diagonals', () => {
    // canvas y grows DOWN → +sin = down.
    const q = (a: number): { sx: number; sy: number } => {
      const o = shadowOffset(a, DISTANCE)
      return { sx: Math.sign(o.x), sy: Math.sign(o.y) }
    }
    expect(q(45)).toEqual({ sx: 1, sy: 1 }) // down-right
    expect(q(135)).toEqual({ sx: -1, sy: 1 }) // down-left
    expect(q(-45)).toEqual({ sx: 1, sy: -1 }) // up-right
    expect(q(-135)).toEqual({ sx: -1, sy: -1 }) // up-left
  })

  it('long-shadow steps extrude in the SAME direction as the drop offset', () => {
    for (const angle of angles) {
      const steps = longShadowSteps(angle, 24, 6) // length 24, step 6 → 4 steps
      expect(steps.length).toBeGreaterThan(0)
      const drop = shadowOffset(angle, 1) // unit direction
      // The FARTHEST step (first, farthest-first ordering) points the same way.
      const farthest = steps[0]
      const mag = Math.hypot(farthest.x, farthest.y)
      if (mag > 0) {
        // Each step's direction matches the drop direction's signs.
        expect(Math.sign(farthest.x)).toBe(Math.sign(drop.x === 0 ? 0 : drop.x))
        expect(Math.sign(farthest.y)).toBe(Math.sign(drop.y === 0 ? 0 : drop.y))
      }
      // Ordered farthest-first: magnitudes are non-increasing.
      for (let i = 1; i < steps.length; i++) {
        const prev = Math.hypot(steps[i - 1].x, steps[i - 1].y)
        const cur = Math.hypot(steps[i].x, steps[i].y)
        expect(prev).toBeGreaterThanOrEqual(cur - 1e-9)
      }
    }
  })
})

// ===========================================================================
// 5. INDIC SHAPING + GRAPHEME-CLUSTER PARITY (preview ↔ export) — centerpiece
// ===========================================================================

const TAMIL_KI = 'கி' // KA U+0B95 + vowel sign I U+0BBF
const TAMIL_KSHI = 'க்ஷி' // KA + virama + SSA + vowel sign I
const DEVANAGARI_KSHI = 'क्षि' // KA + virama + SSA + vowel sign I

describe('M6.5 Indic shaping + grapheme-cluster preview↔export parity', () => {
  // Two TextShaper instances standing in for the two render paths. Both share the
  // grapheme segmentation; only the injected advance measurer differs (preview
  // canvas metrics vs export freetype/harfbuzz metrics).
  const previewShaper: TextShaper = new GraphemeClusterShaper()
  const exportShaper: TextShaper = new GraphemeClusterShaper()
  const previewMeasure: MeasureAdvance = (s) => Array.from(s).length * 10
  const exportMeasure: MeasureAdvance = (s) => Array.from(s).length * 13.5

  it('Tamil கி is exactly ONE cluster (matches splitGraphemes)', () => {
    expect(segmentClusters(TAMIL_KI)).toEqual(splitGraphemes(TAMIL_KI))
    expect(segmentClusters(TAMIL_KI)).toHaveLength(1)
    // It is multi-codepoint → we are counting clusters, not code points.
    expect(Array.from(TAMIL_KI).length).toBeGreaterThan(1)
  })

  it('க்ஷி and क्षि segment per ICU and re-join to the input', () => {
    for (const text of [TAMIL_KSHI, DEVANAGARI_KSHI]) {
      const clusters = segmentClusters(text)
      expect(clusters).toEqual(splitGraphemes(text))
      expect(clusters.join('')).toBe(text)
      expect(clusters.every((c) => c.length > 0)).toBe(true)
    }
  })

  const inputs = [TAMIL_KI, TAMIL_KSHI, DEVANAGARI_KSHI, 'தமிழ் காப்ஷன்', 'Hello world']

  it.each(inputs)('preview and export shape %s into IDENTICAL cluster sequences', (text) => {
    const a = previewShaper.shape(text, previewMeasure)
    const b = exportShaper.shape(text, exportMeasure)

    // PARITY GATE: cluster text, index, and order are identical across paths.
    expect(a.clusters.map((c) => c.cluster)).toEqual(b.clusters.map((c) => c.cluster))
    expect(a.clusters.map((c) => c.index)).toEqual(b.clusters.map((c) => c.index))
    expect(a.script).toBe(b.script)
    // The shaper IDs match → a parity content-hash check would pass.
    expect(previewShaper.id).toBe(exportShaper.id)

    // The ONLY divergence is the metric (advances), proving the segmentation is
    // renderer-independent. Non-empty runs measure differently per measurer.
    if (a.clusters.length > 0) {
      expect(a.advance).not.toBe(b.advance)
    }
  })

  it('cluster counts match preview↔export (the count drives per-char logic)', () => {
    for (const text of inputs) {
      const previewCount = previewShaper.shape(text, previewMeasure).clusters.length
      const exportCount = exportShaper.shape(text, exportMeasure).clusters.length
      expect(previewCount).toBe(exportCount)
      expect(previewCount).toBe(segmentClusters(text).length)
    }
  })

  it('snapshots the exact cluster sequences (catches a future ICU/shaper drift)', () => {
    const sequences = Object.fromEntries(
      [TAMIL_KI, TAMIL_KSHI, DEVANAGARI_KSHI].map((text) => [text, segmentClusters(text)])
    )
    expect(sequences).toMatchSnapshot('indic cluster sequences')
  })

  it('reveal / karaoke never splits mid-cluster for Tamil கி, க்ஷி, Devanagari क्षि', () => {
    const samples = [0, 0.25, 0.5, 0.75, 1]
    for (const text of [TAMIL_KI, TAMIL_KSHI, DEVANAGARI_KSHI]) {
      const clusters = segmentClusters(text)
      for (const t of samples) {
        const revealed = Math.round(t * clusters.length)
        const shown = clusters.slice(0, revealed).join('')
        // The shown prefix is a whole number of clusters — never half of one.
        expect(segmentClusters(shown)).toEqual(clusters.slice(0, revealed))
        // And it is a genuine prefix of the original (no reorder corruption).
        expect(text.startsWith(shown)).toBe(true)
      }
    }
  })

  it('the shaper advance equals the laid-out run width for the same measurer', () => {
    // A single, shared measurer means shape().advance is the canonical run width
    // every per-char/layout path tiles to — preview and export tile identically.
    const run = shapeRun('காப்ஷன்', previewMeasure, 3)
    const byHand =
      run.clusters.reduce((sum, c) => sum + c.advance, 0) + (run.clusters.length - 1) * 3
    expect(run.advance).toBeCloseTo(byHand, 6)
  })
})

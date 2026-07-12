/**
 * MILESTONE 7 roll-up — golden op-trace snapshots + stacking-order integration
 * (P7.13 — Doc 04 effects + Doc 05 decorations; skills `text-render`, `parity-check`).
 *
 * This is the INTEGRATION test that completes "effects + bubbles render in preview".
 * It deliberately does NOT re-run the focused per-effect / per-decoration unit math
 * that P7.2–P7.12 already ship (RGB-split offsets, extrude steps, bubbleRect, rule
 * geometry, …). Instead it exercises the WHOLE stack the way preview/export do and
 * locks the milestone's two cross-cutting guarantees:
 *
 *   1. GOLDEN op traces — each of the 7 effects, rendered through the REAL registry
 *      (`registerBuiltinEffects`) + the REAL pass-5 hook of `paintGlyphPasses`, emits
 *      a deterministic, ordered sequence of canvas ops we `toMatchSnapshot`. Seeded
 *      effects (glitch/retro) are asserted stable by rendering TWICE and comparing,
 *      in addition to the snapshot.
 *
 *   2. STACKING order — one clip combining a background bubble + highlight bars +
 *      multiple effects + a multi-layer stroke + a shadow + an underline, drawn
 *      through the SHARED `drawPresetCaption` path, hits each layer in the canonical
 *      order (`DECORATION_RENDER_ORDER` + the `paintGlyphPasses` pass order):
 *        clip-bg → bubble → bars → (shadow → stroke → fill → inner → effects)
 *        → underline/strike → highlight.
 *
 * "Golden image" here = an op-TRACE snapshot (there is no headless canvas / real
 * pixels in this repo). We capture the ordered canvas ops a recording ctx logs, which
 * is exactly how every existing effect test asserts. Fully deterministic + pure: no
 * Math.random, no Date, no whisper/pixel readback.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { composeEffectsPass, unregisterEffectRenderer } from './textEffectsPipeline'
import { registerBuiltinEffects } from './textEffectsBuiltin'
import { paintGlyphPasses, type EffectsPass, type GlyphToken } from './textPaintPipeline'
import type { ResolvedTextShadow } from './textShadowSpec'
import type { ResolvedTextStroke } from './textStrokeSpec'
import {
  bubbleRect,
  resolveDecoration,
  type ResolvedHighlightBar
} from './textDecorationSpec'
import { drawPresetCaption, type TextDrawSpec } from './captionTextRender'
import {
  defaultTextEffect,
  type TextEffect,
  type TextEffectType
} from '../../../../shared/textEffect'

const ALL_TYPES: TextEffectType[] = ['glow', 'neon', 'glitch', '3d', 'retro', 'blur', 'echo']
const TOKEN: GlyphToken = { text: 'Ab', x: 10, y: 20 }

// ---------------------------------------------------------------------------
// A recording ctx that logs the ORDERED sequence of canvas ops + the state each
// op was issued with. This IS the golden artifact — a deterministic op trace, not
// real pixels (the repo has no headless canvas). Property reads/writes are backed
// by a state object so a renderer that reads back `ctx.filter`/`globalAlpha`/etc.
// behaves like a real ctx. `filter` is intentionally a NO-OP setter (the set never
// "sticks") so the blur renderer takes its deterministic ring-stamp FALLBACK path —
// the headless-engine path — giving a stable trace.
// ---------------------------------------------------------------------------
interface TraceOp {
  op: string
  text?: string
  x?: number
  y?: number
  alpha: number
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  composite: string
  shadowColor: string
  shadowBlur: number
}

function tracingCtx(): { ctx: CanvasRenderingContext2D; ops: TraceOp[]; depth: () => number } {
  const ops: TraceOp[] = []
  let saveDepth = 0
  const s = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    shadowColor: 'transparent',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    fillStyle: '' as string | CanvasGradient,
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
    miterLimit: 10,
    filter: 'none',
    font: '',
    textAlign: '',
    textBaseline: '',
    letterSpacing: ''
  }
  const snap = (op: string, text?: string, x?: number, y?: number): TraceOp => ({
    op,
    text,
    x,
    y,
    alpha: round4(s.globalAlpha),
    fillStyle: String(s.fillStyle),
    strokeStyle: s.strokeStyle,
    lineWidth: s.lineWidth,
    composite: s.globalCompositeOperation,
    shadowColor: s.shadowColor,
    shadowBlur: round4(s.shadowBlur)
  })
  const ctx = {
    save() {
      saveDepth += 1
    },
    restore() {
      saveDepth -= 1
    },
    setTransform() {},
    clearRect() {},
    translate() {},
    scale() {},
    rotate() {},
    beginPath() {
      ops.push(snap('beginPath'))
    },
    moveTo() {},
    arcTo() {},
    closePath() {},
    clip() {
      ops.push(snap('clip'))
    },
    fill() {
      ops.push(snap('rectFill'))
    },
    fillRect(x: number, y: number) {
      ops.push(snap('fillRect', undefined, x, y))
    },
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: (t: string) => ({
      width: t.length * 10,
      actualBoundingBoxAscent: 12,
      actualBoundingBoxDescent: 4
    }),
    fillText(text: string, x: number, y: number) {
      ops.push(snap('fillText', text, x, y))
    },
    strokeText(text: string, x: number, y: number) {
      ops.push(snap('strokeText', text, x, y))
    }
  }
  Object.defineProperties(ctx, {
    globalAlpha: { get: () => s.globalAlpha, set: (v) => (s.globalAlpha = v) },
    globalCompositeOperation: {
      get: () => s.globalCompositeOperation,
      set: (v) => (s.globalCompositeOperation = v)
    },
    shadowColor: { get: () => s.shadowColor, set: (v) => (s.shadowColor = v) },
    shadowBlur: { get: () => s.shadowBlur, set: (v) => (s.shadowBlur = v) },
    shadowOffsetX: { get: () => s.shadowOffsetX, set: (v) => (s.shadowOffsetX = v) },
    shadowOffsetY: { get: () => s.shadowOffsetY, set: (v) => (s.shadowOffsetY = v) },
    fillStyle: { get: () => s.fillStyle, set: (v) => (s.fillStyle = v) },
    strokeStyle: { get: () => s.strokeStyle, set: (v) => (s.strokeStyle = v) },
    lineWidth: { get: () => s.lineWidth, set: (v) => (s.lineWidth = v) },
    lineJoin: { get: () => s.lineJoin, set: (v) => (s.lineJoin = v) },
    miterLimit: { get: () => s.miterLimit, set: (v) => (s.miterLimit = v) },
    // filter setter is a NO-OP (never sticks) → the blur renderer uses its
    // deterministic ring-stamp fallback (the headless path), keeping a stable trace.
    filter: { get: () => 'none', set: () => {} },
    font: { get: () => s.font, set: (v) => (s.font = v) },
    textAlign: { get: () => s.textAlign, set: (v) => (s.textAlign = v) },
    textBaseline: { get: () => s.textBaseline, set: (v) => (s.textBaseline = v) },
    letterSpacing: { get: () => s.letterSpacing, set: (v) => (s.letterSpacing = v) }
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops, depth: () => saveDepth }
}

function round4(v: number): number {
  if (!Number.isFinite(v)) return v
  return Math.round(v * 10000) / 10000
}

/**
 * Render ONE token through the FULL canonical pipeline (`paintGlyphPasses`) with the
 * effect stack composed by the REAL registry. This is the preview/export draw of a
 * single glyph token — the effects compose at pass 5 over the painted body. The fill
 * paints a solid red body so the trace shows the body the effects decorate.
 */
function renderThroughPipeline(
  ctx: CanvasRenderingContext2D,
  effects: TextEffect[],
  opts: { shadow?: ResolvedTextShadow | null; stroke?: ResolvedTextStroke | null; token?: GlyphToken } = {}
): void {
  const pass: EffectsPass | undefined = composeEffectsPass(effects)
  paintGlyphPasses({
    ctx,
    token: opts.token ?? TOKEN,
    shadow: opts.shadow ?? null,
    stroke: opts.stroke ?? null,
    fill: (c, tk) => {
      c.fillStyle = 'rgba(255, 0, 0, 1)'
      c.fillText(tk.text, tk.x, tk.y)
    },
    effects: pass
  })
}

/** Project the op trace to the load-bearing fields (stable, snapshot-friendly). */
function golden(ops: TraceOp[]): Array<Record<string, unknown>> {
  return ops.map((o) => {
    const out: Record<string, unknown> = { op: o.op, composite: o.composite, alpha: o.alpha }
    if (o.op === 'fillText' || o.op === 'strokeText') {
      out.text = o.text
      out.x = o.x
      out.y = o.y
      out.shadowColor = o.shadowColor
      out.shadowBlur = o.shadowBlur
      if (o.op === 'fillText') out.fillStyle = o.fillStyle
      else {
        out.strokeStyle = o.strokeStyle
        out.lineWidth = o.lineWidth
      }
    }
    if (o.op === 'fillRect') {
      out.x = o.x
      out.y = o.y
      out.fillStyle = o.fillStyle
    }
    return out
  })
}

/** A representative, deterministic effect config per type (full intensity/opacity). */
function representative(type: TextEffectType): TextEffect {
  return defaultTextEffect(type) as TextEffect
}

beforeEach(() => {
  for (const t of ALL_TYPES) unregisterEffectRenderer(t)
  registerBuiltinEffects()
})
afterEach(() => {
  for (const t of ALL_TYPES) unregisterEffectRenderer(t)
  registerBuiltinEffects()
})

// ═══════════════════════════════════════════════════════════════════════════
// 1. PER-EFFECT GOLDEN OP-TRACE SNAPSHOTS — each effect through the real
//    registry + the real pass-5 hook of paintGlyphPasses.
// ═══════════════════════════════════════════════════════════════════════════
describe('golden op-trace per effect (registry + paintGlyphPasses pass 5)', () => {
  for (const type of ALL_TYPES) {
    it(`${type}: representative glyph token → stable op trace`, () => {
      const a = tracingCtx()
      const b = tracingCtx()
      renderThroughPipeline(a.ctx, [representative(type)])
      renderThroughPipeline(b.ctx, [representative(type)])

      // Determinism: two independent renders of the SAME token+effect produce the
      // IDENTICAL op stream (seeded effects included — no Math.random/Date).
      expect(golden(a.ops)).toEqual(golden(b.ops))
      // The body fill (pass 3) is always present and PRECEDES the effect ops (pass 5).
      const bodyIdx = a.ops.findIndex((o) => o.op === 'fillText' && o.fillStyle === 'rgba(255, 0, 0, 1)')
      expect(bodyIdx).toBe(0)
      // ctx fully unwound (every save matched a restore).
      expect(a.depth()).toBe(0)
      // The golden artifact.
      expect(golden(a.ops)).toMatchSnapshot()
    })
  }

  it('seeded effects (glitch, retro) are stable across runs AND keyed by token text', () => {
    for (const type of ['glitch', 'retro'] as TextEffectType[]) {
      const same1 = tracingCtx()
      const same2 = tracingCtx()
      renderThroughPipeline(same1.ctx, [representative(type)], { token: { text: 'Hello', x: 0, y: 0 } })
      renderThroughPipeline(same2.ctx, [representative(type)], { token: { text: 'Hello', x: 0, y: 0 } })
      expect(golden(same1.ops)).toEqual(golden(same2.ops))

      const other = tracingCtx()
      renderThroughPipeline(other.ctx, [representative(type)], { token: { text: 'World', x: 0, y: 0 } })
      // A different token text drives a different seed → a different jitter/grain trace.
      expect(golden(other.ops)).not.toEqual(golden(same1.ops))
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. EFFECT STACK ORDER MATTERS — glow→neon vs neon→glow differ in op order.
// ═══════════════════════════════════════════════════════════════════════════
describe('effect stack ORDER changes the op trace', () => {
  const glow = (): TextEffect => ({ ...defaultTextEffect('glow'), params: { radius: 10, color: '#ffffff' } })
  const neon = (): TextEffect =>
    ({ ...defaultTextEffect('neon'), params: { radius: 12, color: '#00eaff', core: 2 } })

  it('glow→neon and neon→glow produce DIFFERENT op sequences', () => {
    const gn = tracingCtx()
    const ng = tracingCtx()
    renderThroughPipeline(gn.ctx, [glow(), neon()])
    renderThroughPipeline(ng.ctx, [neon(), glow()])
    // Same set of ops, different ORDER → the traces are not equal.
    expect(golden(gn.ops)).not.toEqual(golden(ng.ops))
  })

  it('glow→neon golden trace', () => {
    const { ctx, ops } = tracingCtx()
    renderThroughPipeline(ctx, [glow(), neon()])
    expect(golden(ops)).toMatchSnapshot()
  })

  it('neon→glow golden trace', () => {
    const { ctx, ops } = tracingCtx()
    renderThroughPipeline(ctx, [neon(), glow()])
    expect(golden(ops)).toMatchSnapshot()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. DECORATION EXTREMES — resolved specs + bubble-rect geometry at the edges.
// ═══════════════════════════════════════════════════════════════════════════
describe('decoration extremes (resolved specs + geometry snapshots)', () => {
  const BLOCK = { x: -100, y: -20, width: 200, height: 40 }

  it('bubble — huge radius collapses to a pill (clamped to half min dim)', () => {
    const resolved = resolveDecoration({
      background: { color: '#101820', opacity: 1, padding: 0, radius: 9999 }
    })
    const rect = bubbleRect(BLOCK, resolved.background!.paddingX, resolved.background!.paddingY, resolved.background!.radius)
    // zero padding → rect == block; radius clamps to half the min dimension (h/2 = 20).
    expect(rect).toEqual({ x: -100, y: -20, w: 200, h: 40, r: 20 })
    expect({ resolved: resolved.background, rect }).toMatchSnapshot()
  })

  it('bubble — full opacity vs zero opacity (zero = no bubble at all)', () => {
    const full = resolveDecoration({ background: { color: '#ff0000', opacity: 1, padding: 8, radius: 4 } })
    const zero = resolveDecoration({ background: { color: '#ff0000', opacity: 0, padding: 8, radius: 4 } })
    expect(full.background?.color).toBe('rgba(255, 0, 0, 1)')
    expect(zero.background).toBeNull() // a fully-transparent bubble resolves to "none"
    expect({ full: full.background, zero: zero.background }).toMatchSnapshot()
  })

  it('bubble — zero padding hugs the block exactly', () => {
    const r = resolveDecoration({ background: { color: '#000000', opacity: 0.5, padding: 0, radius: 0 } })
    const rect = bubbleRect(BLOCK, r.background!.paddingX, r.background!.paddingY, r.background!.radius)
    expect(rect).toEqual({ x: -100, y: -20, w: 200, h: 40, r: 0 })
    expect(rect).toMatchSnapshot()
  })

  it('highlight bars — per-word vs full-line resolved spec', () => {
    const word = resolveDecoration({ highlightBar: { color: '#ffe600', opacity: 0.4, mode: 'word', padding: 2, radius: 2 } })
    const line = resolveDecoration({ highlightBar: { color: '#ffe600', opacity: 0.4, mode: 'line', padding: 2, radius: 2 } })
    expect(word.highlight?.mode).toBe('word')
    expect(line.highlight?.mode).toBe('line')
    expect({ word: word.highlight, line: line.highlight }).toMatchSnapshot()
  })

  it('highlight bar — full opacity vs zero opacity (zero = no bars)', () => {
    const full = resolveDecoration({ highlightBar: { color: '#00ff00', opacity: 1, mode: 'word' } })
    const zero = resolveDecoration({ highlightBar: { color: '#00ff00', opacity: 0, mode: 'word' } })
    expect(full.highlight?.color).toBe('rgba(0, 255, 0, 1)')
    expect(zero.highlight).toBeNull()
    expect({ full: full.highlight, zero: zero.highlight }).toMatchSnapshot()
  })

  it('underline + strike at a LARGE font size — size-scaled rule traces', () => {
    // Render a clip with underline + strike at size 120 through the shared path and
    // snapshot the filled-rule spans (fillRect) — they scale with the font size.
    const spec: TextDrawSpec = {
      font: 'normal 120px Inter',
      fontSizePx: 120,
      lineHeight: 1.2,
      letterSpacing: 0,
      fill: { type: 'solid', color: 'rgba(255, 255, 255, 1)' },
      stroke: [],
      shadow: null,
      background: null,
      underline: { color: '#ff0000', thickness: null },
      strike: { color: null, thickness: null }
    }
    const { ctx, ops } = tracingCtx()
    drawPresetCaption(ctx, spec, { width: 1200, height: 600, lines: ['Big'] })
    const rules = ops.filter((o) => o.op === 'fillRect')
    // Underline + strike → two filled rule spans per non-empty line.
    expect(rules.length).toBeGreaterThanOrEqual(2)
    expect(rules.map((o) => ({ x: round4(o.x!), y: round4(o.y!), fillStyle: o.fillStyle }))).toMatchSnapshot()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. STACKING ORDER — the milestone integration guarantee. One clip combining
//    bubble + highlight bars + a multi-layer stroke + a shadow + MULTIPLE effects
//    + an underline, drawn through the SHARED drawPresetCaption path, hits each
//    layer in the canonical order:
//      clip-bg → bubble → bars → (shadow → stroke → fill → inner → effects)
//      → underline/strike → highlight.
// ═══════════════════════════════════════════════════════════════════════════
describe('FULL stacking order (bubble + bars + stroke + shadow + effects + underline)', () => {
  function dropShadow(): ResolvedTextShadow {
    return {
      kind: 'drop',
      color: 'rgba(0, 0, 0, 0.6)',
      blur: 3,
      offset: { x: 2, y: 2 },
      angleDeg: 45,
      distance: 3
    }
  }
  const bar: ResolvedHighlightBar = {
    color: 'rgba(255, 230, 0, 0.4)',
    mode: 'line',
    paddingX: 2,
    paddingY: 2,
    radius: 2
  }
  // A REAL composed effect stack (glow then 3d) — the same pass the preview builds.
  // Built INSIDE fullSpec (i.e. after beforeEach registers the renderers) so the
  // registry is populated when composeEffectsPass snapshots its active list.
  function fullSpec(): TextDrawSpec {
    const effects: EffectsPass = composeEffectsPass([
      { ...defaultTextEffect('glow'), params: { radius: 10, color: '#ffffff' } },
      { ...defaultTextEffect('3d'), params: { depth: 4, angle: 45, color: '#000000' } }
    ])!
    return {
      font: 'normal 60px Inter',
      fontSizePx: 60,
      lineHeight: 1.2,
      letterSpacing: 0,
      fill: { type: 'solid', color: 'rgba(255, 0, 0, 1)' },
      stroke: [
        { color: 'rgba(0, 0, 0, 1)', width: 8 },
        { color: 'rgba(255, 255, 255, 1)', width: 3 }
      ],
      shadow: dropShadow(),
      background: { color: 'rgba(0, 0, 0, 0.5)', paddingX: 16, paddingY: 16, radius: 12 },
      highlight: bar,
      underline: { color: '#00ff00', thickness: null },
      effects
    }
  }

  it('hits each layer in the canonical order (single combined clip)', () => {
    const { ctx, ops } = tracingCtx()
    drawPresetCaption(ctx, fullSpec(), { width: 1200, height: 600, lines: ['Stack'] })

    // ── Identify each layer by its signature op. ──────────────────────────
    // Layer 1+2: the bubble + the line bar are rounded-rect FILLS (`fill()`).
    const lastRectFill = ops.map((o) => o.op).lastIndexOf('rectFill')
    const rectFills = ops.filter((o) => o.op === 'rectFill')
    // Layer 3: SHADOW — a stroke issued while a (non-transparent) shadow is live.
    const shadowIdx = ops.findIndex(
      (o) => o.op === 'strokeText' && o.shadowColor !== 'transparent'
    )
    // Layer 4: STROKE — visible stroke layers (widest 8 → thinnest 3), shadow cleared.
    const visibleStrokes = ops.filter(
      (o) => o.op === 'strokeText' && o.shadowColor === 'transparent' && o.lineWidth > 0
    )
    // Layer 5: FILL — the body in solid red.
    const bodyIdx = ops.findIndex((o) => o.op === 'fillText' && o.fillStyle === 'rgba(255, 0, 0, 1)')
    // Layer 7: EFFECTS — the 3d wall stamps under destination-over compose after fill.
    const effectIdx = ops.findIndex((o) => o.op === 'fillText' && o.composite === 'destination-over')
    // Layer 8: UNDERLINE — a filled rule span (`fillRect`).
    const underlineIdx = ops.findIndex((o) => o.op === 'fillRect')

    // ── Canonical order assertions. ───────────────────────────────────────
    // 1+2. Bubble + line bar = exactly two rounded-rect fills, BOTH before any glyph.
    expect(rectFills).toHaveLength(2)
    expect(lastRectFill).toBeLessThan(shadowIdx)

    // 3. Shadow cast first within the glyph passes (a live-shadow stroke exists).
    expect(shadowIdx).toBeGreaterThan(lastRectFill)

    // 4. Visible strokes widest→thinnest, AFTER the shadow, with the shadow cleared.
    expect(visibleStrokes.map((o) => o.lineWidth)).toEqual([8, 3])
    const firstVisibleStrokeIdx = ops.indexOf(visibleStrokes[0])
    expect(firstVisibleStrokeIdx).toBeGreaterThan(shadowIdx)

    // 5. Body fill after the last stroke.
    const lastStrokeIdx = ops.map((o) => o.op).lastIndexOf('strokeText')
    expect(bodyIdx).toBeGreaterThan(lastStrokeIdx)

    // 7. Effects compose AFTER the body fill (pass 5 of the pipeline).
    expect(effectIdx).toBeGreaterThan(bodyIdx)

    // 8. Underline rule drawn AFTER the effect composite (beneath effects, with glyphs).
    expect(underlineIdx).toBeGreaterThan(effectIdx)

    // No rounded-rect bubble/bar fill leaks AFTER the glyph layer (all are pre-glyph).
    expect(ops.slice(shadowIdx).filter((o) => o.op === 'rectFill')).toHaveLength(0)
  })

  it('the combined-clip op trace is a stable golden artifact', () => {
    const a = tracingCtx()
    const b = tracingCtx()
    drawPresetCaption(a.ctx, fullSpec(), { width: 1200, height: 600, lines: ['Stack'] })
    drawPresetCaption(b.ctx, fullSpec(), { width: 1200, height: 600, lines: ['Stack'] })
    // Deterministic across runs.
    expect(golden(a.ops)).toEqual(golden(b.ops))
    expect(golden(a.ops)).toMatchSnapshot()
  })
})

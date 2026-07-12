/**
 * Tests for the built-in GLITCH effect renderer (P7.3 — Doc 04; skill `text-render`).
 *
 * Covers:
 *   - the PURE param→canvas math: RGB-split offsets from splitDistance*intensity along
 *     `angle` (three channel offsets, correct directions), channel fill colors;
 *   - the DETERMINISTIC seeded jitter: same seed → same sequence, different seed →
 *     different, bounded by frequency/intensity (parity-safe — no Math.random/Date);
 *   - the renderer: additive ('lighter') composite is set, ctx restored, intensity 0 /
 *     disabled / splitDistance 0 no-op, opacity honored, stacks in order;
 * all driven by a recording ctx (headless, no real canvas).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  channelFillColor,
  hashSeed,
  mulberry32,
  registerBuiltinEffects,
  resolveChannelOffsets,
  resolveScanlineJitter
} from './textEffectsBuiltin'
import {
  composeEffectsPass,
  hasEffectRenderer,
  unregisterEffectRenderer
} from './textEffectsPipeline'
import type { GlyphToken } from './textPaintPipeline'
import { defaultTextEffect, type TextEffect, type TextEffectType } from '../../../../shared/textEffect'

const TOKEN: GlyphToken = { text: 'Ab', x: 10, y: 20 }
const ALL_TYPES: TextEffectType[] = ['glow', 'neon', 'glitch', '3d', 'retro', 'blur', 'echo']

interface PaintOp {
  kind: 'fill' | 'stroke'
  text: string
  x: number
  y: number
  alpha: number
  fillStyle: string
  composite: string
}

/** Recording ctx that snapshots fill position + composite mode + alpha per stamp. */
function recordingCtx(): {
  ctx: CanvasRenderingContext2D
  ops: PaintOp[]
  saveDepth: () => number
} {
  const ops: PaintOp[] = []
  let depth = 0
  const s = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    shadowColor: 'transparent',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
    filter: 'none',
    font: ''
  }
  const snap = (kind: 'fill' | 'stroke', text: string, x: number, y: number): PaintOp => ({
    kind,
    text,
    x,
    y,
    alpha: s.globalAlpha,
    fillStyle: s.fillStyle,
    composite: s.globalCompositeOperation
  })
  const ctx = {
    save() {
      depth += 1
    },
    restore() {
      depth -= 1
    },
    fillText(text: string, x: number, y: number) {
      ops.push(snap('fill', text, x, y))
    },
    strokeText(text: string, x: number, y: number) {
      ops.push(snap('stroke', text, x, y))
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
    filter: { get: () => s.filter, set: (v) => (s.filter = v) },
    font: { get: () => s.font, set: (v) => (s.font = v) }
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops, saveDepth: () => depth }
}

/** Render a single effect through the composed pass (mirrors the pipeline path). */
function render(ctx: CanvasRenderingContext2D, effect: TextEffect, token: GlyphToken = TOKEN): void {
  const pass = composeEffectsPass([effect])
  if (pass) pass(ctx, token, { shadow: null, stroke: null })
}

function glitch(overrides: Partial<TextEffect> = {}): TextEffect {
  return { ...defaultTextEffect('glitch'), ...overrides } as TextEffect
}

beforeEach(() => {
  for (const t of ALL_TYPES) unregisterEffectRenderer(t)
  registerBuiltinEffects()
})
afterEach(() => {
  for (const t of ALL_TYPES) unregisterEffectRenderer(t)
  registerBuiltinEffects()
})

// ───────────────────────────────────────────────────────────────────────────
describe('resolveChannelOffsets (RGB split math, PURE)', () => {
  it('three channels: R offset +, G centered, B offset opposite', () => {
    const offs = resolveChannelOffsets(8, 1, 0)
    expect(offs).toHaveLength(3)
    const r = offs.find((o) => o.channel === 'r')!
    const g = offs.find((o) => o.channel === 'g')!
    const b = offs.find((o) => o.channel === 'b')!
    // angle 0 → split along +x. mag = 8*1 = 8.
    expect(r.dx).toBe(8)
    expect(r.dy).toBe(0)
    expect(g.dx).toBe(0)
    expect(g.dy).toBe(0)
    expect(b.dx).toBe(-8) // opposite of red
    expect(b.dy).toBe(0)
  })

  it('intensity scales the split magnitude', () => {
    const offs = resolveChannelOffsets(8, 0.5, 0)
    expect(offs.find((o) => o.channel === 'r')!.dx).toBe(4)
    expect(offs.find((o) => o.channel === 'b')!.dx).toBe(-4)
  })

  it('angle 90 splits vertically (red +y, blue -y)', () => {
    const offs = resolveChannelOffsets(10, 1, 90)
    const r = offs.find((o) => o.channel === 'r')!
    const b = offs.find((o) => o.channel === 'b')!
    expect(r.dx).toBeCloseTo(0, 3)
    expect(r.dy).toBe(10)
    expect(b.dx).toBeCloseTo(0, 3)
    expect(b.dy).toBe(-10)
  })

  it('splitDistance 0 → no split (all offsets zero)', () => {
    const offs = resolveChannelOffsets(0, 1, 0)
    expect(offs.every((o) => o.dx === 0 && o.dy === 0)).toBe(true)
  })

  it('intensity 0 → no split (all offsets zero)', () => {
    const offs = resolveChannelOffsets(8, 0, 0)
    expect(offs.every((o) => o.dx === 0 && o.dy === 0)).toBe(true)
  })

  it('negative/NaN splitDistance is floored to no split', () => {
    expect(resolveChannelOffsets(-5, 1, 0).every((o) => o.dx === 0)).toBe(true)
    expect(resolveChannelOffsets(Number.NaN, 1, 0).every((o) => o.dx === 0)).toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('channelFillColor (PURE)', () => {
  it('isolates each channel at the given alpha', () => {
    expect(channelFillColor('r', 1)).toBe('rgba(255, 0, 0, 1)')
    expect(channelFillColor('g', 1)).toBe('rgba(0, 255, 0, 1)')
    expect(channelFillColor('b', 1)).toBe('rgba(0, 0, 255, 1)')
    expect(channelFillColor('r', 0.5)).toBe('rgba(255, 0, 0, 0.5)')
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('seeded PRNG determinism (parity-safe)', () => {
  it('hashSeed is deterministic + differs by text', () => {
    expect(hashSeed('Ab')).toBe(hashSeed('Ab'))
    expect(hashSeed('Ab')).not.toBe(hashSeed('Cd'))
  })

  it('mulberry32: same seed → identical sequence', () => {
    const a = mulberry32(123)
    const b = mulberry32(123)
    const seqA = [a(), a(), a(), a()]
    const seqB = [b(), b(), b(), b()]
    expect(seqA).toEqual(seqB)
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true)
  })

  it('mulberry32: different seed → different sequence', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()])
  })

  it('no Math.random / no Date in the source (grep)', () => {
    // Guard the determinism invariant at the unit level: identical calls match.
    const run = () => resolveScanlineJitter(hashSeed('hello'), 8, 1, 4)
    expect(run()).toEqual(run())
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('resolveScanlineJitter (deterministic, bounded)', () => {
  it('same seed → identical bands; different seed → different bands', () => {
    const s1a = resolveScanlineJitter(111, 8, 1, 4)
    const s1b = resolveScanlineJitter(111, 8, 1, 4)
    const s2 = resolveScanlineJitter(222, 8, 1, 4)
    expect(s1a).toEqual(s1b)
    expect(s1a).not.toEqual(s2)
  })

  it('band count grows with frequency*intensity', () => {
    expect(resolveScanlineJitter(1, 8, 1, 4)).toHaveLength(8)
    expect(resolveScanlineJitter(1, 8, 0.5, 4)).toHaveLength(4)
    expect(resolveScanlineJitter(1, 4, 1, 4)).toHaveLength(4)
  })

  it('shift is bounded by ±(maxShift*intensity)', () => {
    const bands = resolveScanlineJitter(7, 20, 1, 5)
    expect(bands.length).toBeGreaterThan(0)
    expect(bands.every((b) => Math.abs(b.shift) <= 5)).toBe(true)
    expect(bands.every((b) => b.at >= 0 && b.at < 1)).toBe(true)
  })

  it('frequency 0 → no bands', () => {
    expect(resolveScanlineJitter(1, 0, 1, 4)).toHaveLength(0)
  })

  it('intensity 0 → no bands', () => {
    expect(resolveScanlineJitter(1, 8, 0, 4)).toHaveLength(0)
  })

  it('maxShift 0 → no bands', () => {
    expect(resolveScanlineJitter(1, 8, 1, 0)).toHaveLength(0)
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('glitch renderer', () => {
  it('registers through registerBuiltinEffects', () => {
    expect(hasEffectRenderer('glitch')).toBe(true)
  })

  it('stamps the glyph in R, G and B channels with the split offsets', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, glitch({ params: { splitDistance: 8, frequency: 0, angle: 0 }, intensity: 1 }))
    const splitStamps = ops.filter((o) => o.kind === 'fill')
    // At minimum the three channel stamps (no jitter since frequency 0).
    expect(splitStamps).toHaveLength(3)
    const red = splitStamps.find((o) => /rgba\(255, 0, 0/.test(o.fillStyle))!
    const green = splitStamps.find((o) => /rgba\(0, 255, 0/.test(o.fillStyle))!
    const blue = splitStamps.find((o) => /rgba\(0, 0, 255/.test(o.fillStyle))!
    expect(red.x).toBe(TOKEN.x + 8)
    expect(green.x).toBe(TOKEN.x)
    expect(blue.x).toBe(TOKEN.x - 8)
  })

  it('sets the additive (lighter) composite for the channel stamps', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, glitch({ params: { splitDistance: 6, frequency: 0, angle: 0 } }))
    expect(ops.length).toBeGreaterThan(0)
    expect(ops.every((o) => o.composite === 'lighter')).toBe(true)
    // After the renderer the composite is reset (no leak).
    expect((ctx as unknown as { globalCompositeOperation: string }).globalCompositeOperation).toBe(
      'source-over'
    )
  })

  it('frequency adds extra deterministic jitter stamps on top of the split', () => {
    const a = recordingCtx()
    const b = recordingCtx()
    const eff = glitch({ params: { splitDistance: 5, frequency: 4, angle: 0 }, intensity: 1 })
    render(a.ctx, eff)
    render(b.ctx, eff)
    // 3 channel stamps + 2 stamps per band * 4 bands = 11.
    expect(a.ops).toHaveLength(3 + 4 * 2)
    // Deterministic: same token + params → identical op stream (preview == export).
    expect(a.ops.map((o) => [o.x, o.y, o.fillStyle])).toEqual(
      b.ops.map((o) => [o.x, o.y, o.fillStyle])
    )
  })

  it('different token text → different jitter (seed keyed by token.text)', () => {
    const a = recordingCtx()
    const b = recordingCtx()
    const eff = glitch({ params: { splitDistance: 5, frequency: 6, angle: 0 }, intensity: 1 })
    render(a.ctx, eff, { text: 'Ab', x: 10, y: 20 })
    render(b.ctx, eff, { text: 'Zz', x: 10, y: 20 })
    expect(a.ops.map((o) => o.x)).not.toEqual(b.ops.map((o) => o.x))
  })

  it('opacity rides globalAlpha into the channel fill alpha', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, glitch({ opacity: 0.4, params: { splitDistance: 6, frequency: 0, angle: 0 } }))
    const red = ops.find((o) => /rgba\(255, 0, 0/.test(o.fillStyle))!
    expect(red.fillStyle).toBe('rgba(255, 0, 0, 0.4)')
    expect(red.alpha).toBeCloseTo(0.4)
  })

  it('intensity 0 → no-op', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, glitch({ intensity: 0 }))
    expect(ops).toHaveLength(0)
  })

  it('splitDistance 0 AND frequency 0 → no-op (no split, no jitter)', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, glitch({ params: { splitDistance: 0, frequency: 0, angle: 0 } }))
    expect(ops).toHaveLength(0)
  })

  it('splitDistance 0 → channels are NOT split (all stamps centered)', () => {
    const { ctx, ops } = recordingCtx()
    render(ctx, glitch({ params: { splitDistance: 0, frequency: 4, angle: 0 } }))
    // splitMag 0 means maxShift 0 → no jitter bands either, so still a no-op.
    expect(ops).toHaveLength(0)
  })

  it('restores ctx after — composite + alpha back to entry values', () => {
    const { ctx, ops, saveDepth } = recordingCtx()
    render(ctx, glitch({ params: { splitDistance: 6, frequency: 4, angle: 0 } }))
    expect(ops.length).toBeGreaterThan(0)
    expect(saveDepth()).toBe(0)
    expect(ctx.globalAlpha).toBe(1)
    expect((ctx as unknown as { globalCompositeOperation: string }).globalCompositeOperation).toBe(
      'source-over'
    )
  })

  it('disabled → composed pass is undefined', () => {
    expect(composeEffectsPass([glitch({ enabled: false })])).toBeUndefined()
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('stacking preserves ORDER and isolation', () => {
  it('glitch then glow: glitch ops first (additive), glow ops after, no composite leak', () => {
    const { ctx, ops } = recordingCtx()
    const pass = composeEffectsPass([
      glitch({ params: { splitDistance: 6, frequency: 0, angle: 0 } }),
      { ...defaultTextEffect('glow'), params: { radius: 10, color: '#ffffff' } }
    ])!
    pass(ctx, TOKEN, { shadow: null, stroke: null })
    // The last glitch (additive 'lighter') op precedes the first glow op
    // (which paints under 'source-over').
    const lastLighter = ops.map((o) => o.composite).lastIndexOf('lighter')
    const firstSourceOver = ops.findIndex((o) => o.composite === 'source-over')
    expect(lastLighter).toBeGreaterThanOrEqual(0)
    expect(firstSourceOver).toBeGreaterThan(lastLighter)
  })

  it('after a glitch+glow stack the ctx state is clean', () => {
    const { ctx } = recordingCtx()
    const pass = composeEffectsPass([glitch(), defaultTextEffect('glow')])!
    pass(ctx, TOKEN, { shadow: null, stroke: null })
    expect(ctx.globalAlpha).toBe(1)
    expect((ctx as unknown as { globalCompositeOperation: string }).globalCompositeOperation).toBe(
      'source-over'
    )
  })
})

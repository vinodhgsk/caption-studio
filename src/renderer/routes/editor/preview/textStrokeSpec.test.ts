import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEXT_STROKE,
  applyStrokeLayer,
  hasStroke,
  resolveStrokeHollow,
  resolveTextStroke,
  strokeLayerWidth,
  type ResolvedStrokeLayer
} from './textStrokeSpec'

describe('strokeLayerWidth — a layer bag → its paintable width', () => {
  it('returns a positive width verbatim', () => {
    expect(strokeLayerWidth({ width: 4 })).toBe(4)
    expect(strokeLayerWidth({ color: '#000', width: 2.5 })).toBe(2.5)
  })

  it('treats 0 / negative / missing / non-finite as no stroke (0)', () => {
    expect(strokeLayerWidth({ width: 0 })).toBe(0)
    expect(strokeLayerWidth({ width: -3 })).toBe(0)
    expect(strokeLayerWidth({})).toBe(0)
    expect(strokeLayerWidth({ width: Number.NaN })).toBe(0)
    expect(strokeLayerWidth({ width: 'fat' })).toBe(0)
  })

  it('returns 0 for a non-object layer', () => {
    expect(strokeLayerWidth(null)).toBe(0)
    expect(strokeLayerWidth(undefined)).toBe(0)
    expect(strokeLayerWidth(5)).toBe(0)
  })
})

describe('resolveTextStroke — clip.text.stroke list → resolved stroke', () => {
  it('REQUIREMENT: a single stroke layer resolves with color + width', () => {
    const out = resolveTextStroke([{ color: '#ff0000', width: 4 }])
    expect(out.layers).toEqual([{ color: 'rgba(255, 0, 0, 1)', width: 4 }])
    expect(out.hollow).toBe(false)
  })

  it('REQUIREMENT: list model with ONE layer (a single stroke = a 1-element list)', () => {
    const out = resolveTextStroke([{ color: '#000000', width: 3 }])
    expect(out.layers).toHaveLength(1)
    expect(out.layers[0]).toEqual({ color: 'rgba(0, 0, 0, 1)', width: 3 })
  })

  it('REQUIREMENT: width 0 → no stroke (the layer is dropped)', () => {
    expect(resolveTextStroke([{ color: '#000000', width: 0 }]).layers).toEqual([])
    expect(resolveTextStroke([{ color: '#000000', width: -2 }]).layers).toEqual([])
    expect(hasStroke(resolveTextStroke([{ color: '#000000', width: 0 }]))).toBe(false)
  })

  it('REQUIREMENT: missing / legacy / malformed stroke shape resolves to no stroke', () => {
    expect(resolveTextStroke(undefined)).toEqual({ layers: [], hollow: false })
    expect(resolveTextStroke(null)).toEqual({ layers: [], hollow: false })
    expect(resolveTextStroke('nope')).toEqual({ layers: [], hollow: false })
    expect(resolveTextStroke({})).toEqual({ layers: [], hollow: false })
    expect(resolveTextStroke([])).toEqual({ layers: [], hollow: false })
  })

  it('BACKWARD COMPAT: a legacy { color, width } layer (no opacity) is fully opaque', () => {
    expect(resolveTextStroke([{ color: '#112233', width: 2 }]).layers).toEqual([
      { color: 'rgba(17, 34, 51, 1)', width: 2 }
    ])
  })

  it('bakes a per-layer opacity into the color', () => {
    expect(resolveTextStroke([{ color: '#ffffff', width: 5, opacity: 0.5 }]).layers).toEqual([
      { color: 'rgba(255, 255, 255, 0.5)', width: 5 }
    ])
  })

  it('falls back to the default hex for an invalid layer color', () => {
    expect(resolveTextStroke([{ color: 'banana', width: 2 }]).layers).toEqual([
      { color: 'rgba(0, 0, 0, 1)', width: 2 } // DEFAULT_TEXT_STROKE hex = black
    ])
  })

  it('honors custom defaults for a color-less layer', () => {
    expect(
      resolveTextStroke([{ width: 3 }], { hex: '#ff0000', opacity: 0.25 }).layers
    ).toEqual([{ color: 'rgba(255, 0, 0, 0.25)', width: 3 }])
  })

  it('STACKING (P6.11 design): sorts multiple layers WIDEST-first (outside-in)', () => {
    const out = resolveTextStroke([
      { color: '#ff0000', width: 2 },
      { color: '#00ff00', width: 8 },
      { color: '#0000ff', width: 5 }
    ])
    expect(out.layers.map((l) => l.width)).toEqual([8, 5, 2])
    expect(out.layers[0].color).toBe('rgba(0, 255, 0, 1)')
  })

  it('STACKING: drops 0-width layers while keeping + sorting the rest', () => {
    const out = resolveTextStroke([
      { color: '#ff0000', width: 0 },
      { color: '#00ff00', width: 6 },
      { color: '#0000ff', width: 3 }
    ])
    expect(out.layers.map((l) => l.width)).toEqual([6, 3])
  })

  it('REQUIREMENT (P6.11): a 2-layer stack resolves sorted widest-first', () => {
    const out = resolveTextStroke([
      { color: '#000000', width: 4 },
      { color: '#ffffff', width: 8 }
    ])
    expect(out.layers).toEqual([
      { color: 'rgba(255, 255, 255, 1)', width: 8 },
      { color: 'rgba(0, 0, 0, 1)', width: 4 }
    ])
  })

  it('REQUIREMENT (P6.11): a 3-layer stack resolves sorted widest-first', () => {
    const out = resolveTextStroke([
      { color: '#ff0000', width: 4 },
      { color: '#00ff00', width: 12 },
      { color: '#0000ff', width: 8 }
    ])
    expect(out.layers).toEqual([
      { color: 'rgba(0, 255, 0, 1)', width: 12 },
      { color: 'rgba(0, 0, 255, 1)', width: 8 },
      { color: 'rgba(255, 0, 0, 1)', width: 4 }
    ])
  })

  it('REQUIREMENT (P6.11): a THINNER layer LISTED FIRST is still painted AFTER a wider one (sort by width)', () => {
    // Author lists the thin (3px) layer first, then the wide (10px) one. Resolve
    // must reorder so the WIDE layer is painted first (index 0) and the thin one
    // lands on top (index 1) — author order does NOT override the width sort.
    const out = resolveTextStroke([
      { color: '#aabbcc', width: 3 },
      { color: '#112233', width: 10 }
    ])
    expect(out.layers.map((l) => l.width)).toEqual([10, 3])
    expect(out.layers[0].color).toBe('rgba(17, 34, 51, 1)') // wide layer first
    expect(out.layers[1].color).toBe('rgba(170, 187, 204, 1)') // thin layer on top
  })

  it('REQUIREMENT (P6.11): per-layer color / width / opacity are preserved across a stack', () => {
    const out = resolveTextStroke([
      { color: '#ff0000', width: 4, opacity: 0.25 },
      { color: '#00ff00', width: 9, opacity: 1 },
      { color: '#0000ff', width: 6 } // legacy: no opacity → default (1)
    ])
    expect(out.layers).toEqual([
      { color: 'rgba(0, 255, 0, 1)', width: 9 },
      { color: 'rgba(0, 0, 255, 1)', width: 6 },
      { color: 'rgba(255, 0, 0, 0.25)', width: 4 }
    ])
  })

  it('REQUIREMENT (P6.11): ADDING a layer to a single stroke yields a sorted 2-element stack', () => {
    // Model the UI "add layer" edit: append, then resolve sorts widest-first.
    const single = [{ color: '#000000', width: 4 }]
    const added = [...single, { color: '#ffffff', width: 8 }]
    expect(resolveTextStroke(added).layers.map((l) => l.width)).toEqual([8, 4])
  })

  it('REQUIREMENT (P6.11): REMOVING a layer from a stack drops it; the rest still resolve', () => {
    // Model the UI "remove layer" edit: filter one out, resolve the remainder.
    const stack = [
      { color: '#000000', width: 4 },
      { color: '#ffffff', width: 8 },
      { color: '#ff0000', width: 2 }
    ]
    const removed = stack.filter((_, i) => i !== 1) // drop the 8px layer
    expect(resolveTextStroke(removed).layers.map((l) => l.width)).toEqual([4, 2])
  })

  it('REQUIREMENT (P6.11): the SINGLE-layer (P6.10) case is unaffected by the stacking sort', () => {
    const out = resolveTextStroke([{ color: '#123456', width: 5, opacity: 0.8 }])
    expect(out.layers).toEqual([{ color: 'rgba(18, 52, 86, 0.8)', width: 5 }])
    expect(out.hollow).toBe(false)
  })

  it('REQUIREMENT (P6.11): width<=0 layers are dropped from WITHIN a multi-layer stack', () => {
    const out = resolveTextStroke([
      { color: '#000000', width: 8 },
      { color: '#111111', width: 0 }, // dropped
      { color: '#222222', width: -4 }, // dropped
      { color: '#333333', width: 4 }
    ])
    expect(out.layers.map((l) => l.width)).toEqual([8, 4])
  })
})

describe('resolveStrokeHollow — hollow / outline-only flag (P6.12 design point)', () => {
  it('is false for a solid single stroke (P6.10)', () => {
    expect(resolveStrokeHollow([{ color: '#000', width: 4 }])).toBe(false)
    expect(resolveStrokeHollow(undefined)).toBe(false)
  })

  it('is true when any layer marks hollow', () => {
    expect(resolveStrokeHollow([{ color: '#000', width: 4, hollow: true }])).toBe(true)
    expect(resolveStrokeHollow([{ color: '#000', width: 4 }, { hollow: true }])).toBe(true)
  })

  it('threads hollow through resolveTextStroke', () => {
    const out = resolveTextStroke([{ color: '#000000', width: 4, hollow: true }])
    expect(out.hollow).toBe(true)
    expect(out.layers).toEqual([{ color: 'rgba(0, 0, 0, 1)', width: 4 }])
  })
})

describe('applyStrokeLayer — thin canvas setup (PURE side-effect)', () => {
  it('sets strokeStyle + lineWidth from the layer, with clean join defaults', () => {
    const calls: Record<string, unknown> = {}
    const ctx = {
      set strokeStyle(v: string) {
        calls.strokeStyle = v
      },
      set lineWidth(v: number) {
        calls.lineWidth = v
      },
      set lineJoin(v: string) {
        calls.lineJoin = v
      },
      set miterLimit(v: number) {
        calls.miterLimit = v
      }
    } as unknown as CanvasRenderingContext2D
    const layer: ResolvedStrokeLayer = { color: 'rgba(0, 0, 0, 1)', width: 4 }
    applyStrokeLayer(ctx, layer)
    expect(calls.strokeStyle).toBe('rgba(0, 0, 0, 1)')
    expect(calls.lineWidth).toBe(4)
    expect(calls.lineJoin).toBe('round')
    expect(calls.miterLimit).toBe(2)
  })

  it('REQUIREMENT: thickness scales the lineWidth (a thicker layer → larger lineWidth)', () => {
    const widths: number[] = []
    const ctx = {
      set strokeStyle(_v: string) {},
      set lineWidth(v: number) {
        widths.push(v)
      },
      set lineJoin(_v: string) {},
      set miterLimit(_v: number) {}
    } as unknown as CanvasRenderingContext2D
    applyStrokeLayer(ctx, { color: 'rgba(0,0,0,1)', width: 2 })
    applyStrokeLayer(ctx, { color: 'rgba(0,0,0,1)', width: 10 })
    expect(widths).toEqual([2, 10])
  })
})

describe('stroke draw ORDER — stroke renders UNDER the fill (P6.10)', () => {
  // The shared draw model (PreviewCanvas/captionTextRender) paints stroke FIRST,
  // then the fill on top. We assert that contract here with an op-recording ctx:
  // for a single token, the strokeText call(s) MUST precede the fillText call.
  function drawTokenWithStroke(
    ctx: CanvasRenderingContext2D,
    stroke: ReturnType<typeof resolveTextStroke>,
    token: string,
    x: number,
    y: number
  ): void {
    // Mirrors the shared draw path: stroke layers (widest-first) under, fill on top
    // (fill skipped when hollow).
    for (const layer of stroke.layers) {
      applyStrokeLayer(ctx, layer)
      ctx.strokeText(token, x, y)
    }
    if (!stroke.hollow) ctx.fillText(token, x, y)
  }

  function opRecorder(): { ctx: CanvasRenderingContext2D; ops: string[] } {
    const ops: string[] = []
    const ctx = {
      set strokeStyle(_v: string) {},
      set lineWidth(_v: number) {},
      set lineJoin(_v: string) {},
      set miterLimit(_v: number) {},
      strokeText(t: string) {
        ops.push(`stroke:${t}`)
      },
      fillText(t: string) {
        ops.push(`fill:${t}`)
      }
    } as unknown as CanvasRenderingContext2D
    return { ctx, ops }
  }

  it('strokes BEFORE filling (outline under the glyph fill)', () => {
    const { ctx, ops } = opRecorder()
    drawTokenWithStroke(ctx, resolveTextStroke([{ color: '#000', width: 4 }]), 'Hi', 0, 0)
    expect(ops).toEqual(['stroke:Hi', 'fill:Hi'])
  })

  it('no stroke layer → only the fill paints (no strokeText)', () => {
    const { ctx, ops } = opRecorder()
    drawTokenWithStroke(ctx, resolveTextStroke([{ color: '#000', width: 0 }]), 'Hi', 0, 0)
    expect(ops).toEqual(['fill:Hi'])
  })

  it('stacked layers stroke widest→thinnest, all UNDER the single fill', () => {
    const { ctx, ops } = opRecorder()
    drawTokenWithStroke(
      ctx,
      resolveTextStroke([
        { color: '#f00', width: 3 },
        { color: '#0f0', width: 8 }
      ]),
      'Hi',
      0,
      0
    )
    // widest (8) then thinner (3), then the fill on top.
    expect(ops).toEqual(['stroke:Hi', 'stroke:Hi', 'fill:Hi'])
  })

  it('HOLLOW (P6.12): strokes only, the fill is skipped', () => {
    const { ctx, ops } = opRecorder()
    drawTokenWithStroke(ctx, resolveTextStroke([{ color: '#000', width: 4, hollow: true }]), 'Hi', 0, 0)
    expect(ops).toEqual(['stroke:Hi'])
  })

  // OUTSIDE-IN proof (P6.11): record the lineWidth APPLIED before each strokeText
  // so we assert the WIDEST layer is painted first and narrower layers on top —
  // the concentric-frame stacking the runbook calls for.
  function widthRecorder(): { ctx: CanvasRenderingContext2D; applied: number[] } {
    const applied: number[] = []
    let pending = 0
    const ctx = {
      set strokeStyle(_v: string) {},
      set lineWidth(v: number) {
        pending = v
      },
      set lineJoin(_v: string) {},
      set miterLimit(_v: number) {},
      strokeText() {
        applied.push(pending)
      },
      fillText() {}
    } as unknown as CanvasRenderingContext2D
    return { ctx, applied }
  }

  it('OUTSIDE-IN: a 2-layer stack applies the WIDEST lineWidth before the narrower one', () => {
    const { ctx, applied } = widthRecorder()
    drawTokenWithStroke(
      ctx,
      resolveTextStroke([
        { color: '#fff', width: 4 },
        { color: '#000', width: 8 }
      ]),
      'Hi',
      0,
      0
    )
    expect(applied).toEqual([8, 4])
  })

  it('OUTSIDE-IN: a 3-layer stack paints strictly decreasing lineWidth (concentric frames)', () => {
    const { ctx, applied } = widthRecorder()
    drawTokenWithStroke(
      ctx,
      resolveTextStroke([
        { color: '#f00', width: 2 },
        { color: '#0f0', width: 10 },
        { color: '#00f', width: 6 }
      ]),
      'Hi',
      0,
      0
    )
    expect(applied).toEqual([10, 6, 2])
    // strictly decreasing — each narrower layer sits on top of a wider frame.
    for (let i = 1; i < applied.length; i++) expect(applied[i]).toBeLessThan(applied[i - 1])
  })
})

describe('HOLLOW / outline-only (P6.12) — persisted flag + fill suppression', () => {
  // Model the SHARED draw path (PreviewCanvas/captionTextRender): stroke layers
  // (widest-first) first, the body fill on top ONLY when not hollow. We record ops
  // so we can assert the body fill is suppressed in the hollow case.
  function drawBody(
    ctx: CanvasRenderingContext2D,
    stroke: ReturnType<typeof resolveTextStroke>,
    token: string
  ): void {
    for (const layer of stroke.layers) {
      applyStrokeLayer(ctx, layer)
      ctx.strokeText(token, 0, 0)
    }
    if (!stroke.hollow) ctx.fillText(token, 0, 0)
  }
  function opRecorder(): { ctx: CanvasRenderingContext2D; ops: string[] } {
    const ops: string[] = []
    const ctx = {
      set strokeStyle(_v: string) {},
      set lineWidth(_v: number) {},
      set lineJoin(_v: string) {},
      set miterLimit(_v: number) {},
      strokeText(t: string) {
        ops.push(`stroke:${t}`)
      },
      fillText(t: string) {
        ops.push(`fill:${t}`)
      }
    } as unknown as CanvasRenderingContext2D
    return { ctx, ops }
  }

  // The TextPanel (P6.12) persists hollow by stamping `hollow: true` on EVERY layer
  // it writes; reading it back is `resolveStrokeHollow`. These helpers model that
  // round-trip so the test asserts the panel contract, not a private impl detail.
  function persistStroke(layers: { color: string; width: number }[], hollowFlag: boolean): unknown[] {
    return layers.map((l) => ({ color: l.color, width: l.width, ...(hollowFlag ? { hollow: true } : {}) }))
  }

  it('REQUIREMENT: hollow=true → resolveTextStroke.hollow true and the body fill is suppressed', () => {
    const stroke = resolveTextStroke([{ color: '#000000', width: 4, hollow: true }])
    expect(stroke.hollow).toBe(true)
    const { ctx, ops } = opRecorder()
    drawBody(ctx, stroke, 'Hi')
    expect(ops).toEqual(['stroke:Hi']) // outline only, NO fill:Hi
  })

  it('REQUIREMENT: hollow=false → normal fill (body painted)', () => {
    const stroke = resolveTextStroke([{ color: '#000000', width: 4 }])
    expect(stroke.hollow).toBe(false)
    const { ctx, ops } = opRecorder()
    drawBody(ctx, stroke, 'Hi')
    expect(ops).toEqual(['stroke:Hi', 'fill:Hi'])
  })

  it('REQUIREMENT: hollow with MULTIPLE stroke layers still stacks widest-first, body suppressed', () => {
    const stroke = resolveTextStroke([
      { color: '#ff0000', width: 3, hollow: true },
      { color: '#00ff00', width: 8, hollow: true }
    ])
    expect(stroke.hollow).toBe(true)
    expect(stroke.layers.map((l) => l.width)).toEqual([8, 3])
    const { ctx, ops } = opRecorder()
    drawBody(ctx, stroke, 'Hi')
    // two strokes (widest→thinner), NO fill.
    expect(ops).toEqual(['stroke:Hi', 'stroke:Hi'])
  })

  it('REQUIREMENT: hollow marked on only ONE layer of a stack still makes the WHOLE stroke hollow', () => {
    // Backward-compat with a legacy sentinel / partial mark: any marked entry → hollow.
    const stroke = resolveTextStroke([
      { color: '#ff0000', width: 3 },
      { color: '#00ff00', width: 8, hollow: true }
    ])
    expect(stroke.hollow).toBe(true)
  })

  it('REQUIREMENT (BACKWARD COMPAT): no hollow flag → not hollow (solid body)', () => {
    expect(resolveTextStroke([{ color: '#000', width: 4 }]).hollow).toBe(false)
    expect(resolveTextStroke(undefined).hollow).toBe(false)
    expect(resolveTextStroke([]).hollow).toBe(false)
  })

  it('REQUIREMENT: hollow with ZERO paintable layers does not crash — paints nothing (no stroke, no fill)', () => {
    // A bare sentinel marks hollow but carries no width → layers empty.
    const stroke = resolveTextStroke([{ hollow: true }])
    expect(stroke.hollow).toBe(true)
    expect(stroke.layers).toEqual([])
    const { ctx, ops } = opRecorder()
    drawBody(ctx, stroke, 'Hi')
    expect(ops).toEqual([]) // nothing painted — body fill suppressed AND no outline
  })

  it('REQUIREMENT (round-trip): toggling hollow ON then OFF restores the solid body', () => {
    const layers = [
      { color: '#ffffff', width: 8 },
      { color: '#000000', width: 4 }
    ]
    // Toggle ON: persist with the marker, read back hollow.
    const on = persistStroke(layers, true)
    expect(resolveTextStroke(on).hollow).toBe(true)
    expect(resolveStrokeHollow(on)).toBe(true)
    // Toggle OFF: persist without the marker, read back NOT hollow; layers intact.
    const off = persistStroke(layers, false)
    expect(resolveTextStroke(off).hollow).toBe(false)
    expect(resolveStrokeHollow(off)).toBe(false)
    expect(resolveTextStroke(off).layers.map((l) => l.width)).toEqual([8, 4])
  })

  it('REQUIREMENT (round-trip): the marker survives a layer EDIT (re-stamped on every layer)', () => {
    // Model the panel: hollow on, then widen a layer — writeStrokeLayers re-stamps
    // hollow onto every written layer, so the stroke stays hollow after the edit.
    const edited = persistStroke([{ color: '#ffffff', width: 12 }], true)
    expect(resolveTextStroke(edited).hollow).toBe(true)
    expect(resolveTextStroke(edited).layers).toEqual([{ color: 'rgba(255, 255, 255, 1)', width: 12 }])
  })
})

describe('DEFAULT_TEXT_STROKE', () => {
  it('is solid black, fully opaque', () => {
    expect(DEFAULT_TEXT_STROKE).toEqual({ hex: '#000000', opacity: 1 })
  })
})

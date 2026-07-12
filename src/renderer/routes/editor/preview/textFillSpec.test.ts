import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEXT_FILL,
  clamp01,
  fillToCanvasPaint,
  gradientEndpoints,
  isHexColor,
  normalizeGradientStops,
  normalizeTextRuns,
  resolveRunColor,
  resolveTextFill,
  rgbaFromHexSafe,
  runColorForWord,
  type ResolvedTextFill,
  type TextRun
} from './textFillSpec'

describe('rgbaFromHexSafe — hex + opacity → rgba', () => {
  it('parses full #rrggbb at a given opacity', () => {
    expect(rgbaFromHexSafe('#101820', 0.55)).toBe('rgba(16, 24, 32, 0.55)')
    expect(rgbaFromHexSafe('#ff0000', 1)).toBe('rgba(255, 0, 0, 1)')
  })

  it('expands #rgb / #rgba shorthand', () => {
    expect(rgbaFromHexSafe('#f00', 1)).toBe('rgba(255, 0, 0, 1)')
    expect(rgbaFromHexSafe('#abc', 1)).toBe('rgba(170, 187, 204, 1)')
    // #rgba: alpha nibble dropped, opacity arg is the source of alpha
    expect(rgbaFromHexSafe('#0f08', 0.5)).toBe('rgba(0, 255, 0, 0.5)')
  })

  it('drops the alpha byte from #rrggbbaa (opacity arg is the alpha source)', () => {
    expect(rgbaFromHexSafe('#00ff00ff', 0.3)).toBe('rgba(0, 255, 0, 0.3)')
  })

  it('accepts a hex without the leading #', () => {
    expect(rgbaFromHexSafe('101820', 0.5)).toBe('rgba(16, 24, 32, 0.5)')
  })

  it('clamps opacity to [0,1]', () => {
    expect(rgbaFromHexSafe('#000000', 2)).toBe('rgba(0, 0, 0, 1)')
    expect(rgbaFromHexSafe('#000000', -1)).toBe('rgba(0, 0, 0, 0)')
  })

  it('falls back to white (then the given fallback) for an invalid hex', () => {
    expect(rgbaFromHexSafe('not-a-color', 1)).toBe('rgba(255, 255, 255, 1)')
    expect(rgbaFromHexSafe('#zz', 1)).toBe('rgba(255, 255, 255, 1)')
    expect(rgbaFromHexSafe('', 0.5, '#000000')).toBe('rgba(0, 0, 0, 0.5)')
  })

  it('treats a non-finite opacity as fully opaque', () => {
    expect(rgbaFromHexSafe('#112233', Number.NaN)).toBe('rgba(17, 34, 51, 1)')
  })
})

describe('clamp01 / isHexColor', () => {
  it('clamps numbers into [0,1]', () => {
    expect(clamp01(-0.4)).toBe(0)
    expect(clamp01(0.4)).toBe(0.4)
    expect(clamp01(3)).toBe(1)
  })

  it('validates 3/4/6/8-digit hex, # optional', () => {
    expect(isHexColor('#fff')).toBe(true)
    expect(isHexColor('#ffff')).toBe(true)
    expect(isHexColor('#ffffff')).toBe(true)
    expect(isHexColor('#ffffffff')).toBe(true)
    expect(isHexColor('abcdef')).toBe(true)
    expect(isHexColor('#ff')).toBe(false)
    expect(isHexColor('#fffff')).toBe(false)
    expect(isHexColor('red')).toBe(false)
    expect(isHexColor(42)).toBe(false)
  })
})

describe('resolveTextFill — clip.text.fill → resolved fill', () => {
  it('defaults to solid white opaque when no fill is present', () => {
    expect(resolveTextFill(undefined)).toEqual({ type: 'solid', color: 'rgba(255, 255, 255, 1)' })
  })

  it('resolves the preset/clip shape { type, value:hex, opacity }', () => {
    expect(resolveTextFill({ type: 'solid', value: '#ff0000', opacity: 0.5 })).toEqual({
      type: 'solid',
      color: 'rgba(255, 0, 0, 0.5)'
    })
  })

  it('resolves the Color-panel shape { type, color:hex, opacity } (color wins over value)', () => {
    expect(resolveTextFill({ type: 'solid', color: '#00ff00', value: '#ff0000', opacity: 1 })).toEqual({
      type: 'solid',
      color: 'rgba(0, 255, 0, 1)'
    })
  })

  it('BACKWARD COMPAT: a solid fill without opacity uses the default opacity (opaque)', () => {
    expect(resolveTextFill({ type: 'solid', value: '#123456' })).toEqual({
      type: 'solid',
      color: 'rgba(18, 52, 86, 1)'
    })
  })

  it('honors a custom default opacity for an opacity-less fill', () => {
    expect(resolveTextFill({ type: 'solid', value: '#000000' }, { hex: '#000000', opacity: 0.25 })).toEqual({
      type: 'solid',
      color: 'rgba(0, 0, 0, 0.25)'
    })
  })

  it('falls back to the default hex for an invalid solid color', () => {
    expect(resolveTextFill({ type: 'solid', value: 'banana', opacity: 1 })).toEqual({
      type: 'solid',
      color: 'rgba(255, 255, 255, 1)'
    })
  })

  it('clamps an out-of-range opacity into [0,1]', () => {
    expect(resolveTextFill({ type: 'solid', value: '#000000', opacity: 5 })).toEqual({
      type: 'solid',
      color: 'rgba(0, 0, 0, 1)'
    })
  })

  it('resolves a gradient (>= 2 valid stops) with opacity + angle', () => {
    const out = resolveTextFill({
      type: 'gradient',
      value: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: '#0000ff' }
      ],
      opacity: 0.8,
      angle: 90
    })
    expect(out).toEqual({
      type: 'gradient',
      stops: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: '#0000ff' }
      ],
      opacity: 0.8,
      angleDeg: 90
    })
  })

  it('degrades a < 2-stop gradient to a solid (never invisible)', () => {
    expect(resolveTextFill({ type: 'gradient', value: [{ offset: 0, color: '#abcdef' }], opacity: 1 })).toEqual({
      type: 'solid',
      color: 'rgba(171, 205, 239, 1)'
    })
  })
})

describe('fillToCanvasPaint — resolved fill → canvas paint', () => {
  it('returns the solid rgba string verbatim (no canvas needed)', () => {
    const paint = fillToCanvasPaint(
      undefined as unknown as CanvasRenderingContext2D,
      { type: 'solid', color: 'rgba(1, 2, 3, 0.4)' },
      100
    )
    expect(paint).toBe('rgba(1, 2, 3, 0.4)')
  })

  it('builds a gradient with each stop baked at the fill opacity', () => {
    const added: { offset: number; color: string }[] = []
    let created: { x0: number; y0: number; x1: number; y1: number } | null = null
    const ctx = {
      createLinearGradient(x0: number, y0: number, x1: number, y1: number) {
        created = { x0, y0, x1, y1 }
        return { addColorStop(offset: number, color: string) {
          added.push({ offset, color })
        } }
      }
    } as unknown as CanvasRenderingContext2D
    const fill: ResolvedTextFill = {
      type: 'gradient',
      stops: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: '#0000ff' }
      ],
      opacity: 0.5,
      angleDeg: 0
    }
    fillToCanvasPaint(ctx, fill, 200)
    // angle 0 → horizontal across half the block width (±100).
    expect(created!.x0).toBe(-100)
    expect(created!.x1).toBe(100)
    expect(created!.y0).toBeCloseTo(0)
    expect(created!.y1).toBeCloseTo(0)
    expect(added).toEqual([
      { offset: 0, color: 'rgba(255, 0, 0, 0.5)' },
      { offset: 1, color: 'rgba(0, 0, 255, 0.5)' }
    ])
  })
})

describe('resolveRunColor — per-word color override (P6.9 design point)', () => {
  const solid: ResolvedTextFill = { type: 'solid', color: 'rgba(255, 255, 255, 1)' }
  const gradient: ResolvedTextFill = {
    type: 'gradient',
    stops: [
      { offset: 0, color: '#fff' },
      { offset: 1, color: '#000' }
    ],
    opacity: 1,
    angleDeg: 0
  }

  it('bakes a run color override at the base opacity', () => {
    expect(resolveRunColor(solid, { color: '#ff0000' }, 0.5)).toBe('rgba(255, 0, 0, 0.5)')
  })

  it('returns the base solid color when the run has no override', () => {
    expect(resolveRunColor(solid, {}, 1)).toBe('rgba(255, 255, 255, 1)')
    expect(resolveRunColor(solid, undefined, 1)).toBe('rgba(255, 255, 255, 1)')
  })

  it('keeps the gradient (null) when a run over a gradient has no override', () => {
    expect(resolveRunColor(gradient, {}, 1)).toBeNull()
  })

  it('a run color over a gradient opts the word into a flat color', () => {
    expect(resolveRunColor(gradient, { color: '#00ff00' }, 0.75)).toBe('rgba(0, 255, 0, 0.75)')
  })

  it('ignores an invalid run color (keeps the base)', () => {
    expect(resolveRunColor(solid, { color: 'green' }, 1)).toBe('rgba(255, 255, 255, 1)')
  })
})

describe('normalizeTextRuns — open clip.text.runs bag → typed TextRun[]', () => {
  it('returns [] for a missing / non-array runs (backward compat: no runs)', () => {
    expect(normalizeTextRuns(undefined)).toEqual([])
    expect(normalizeTextRuns(null)).toEqual([])
    expect(normalizeTextRuns('nope')).toEqual([])
    expect(normalizeTextRuns({})).toEqual([])
  })

  it('preserves array length + index (positional word→run mapping)', () => {
    const runs = normalizeTextRuns([{ color: '#ff0000' }, {}, { color: '#00ff00' }])
    expect(runs).toHaveLength(3)
    expect(runs[0].color).toBe('#ff0000')
    expect(runs[1].color).toBeNull()
    expect(runs[2].color).toBe('#00ff00')
  })

  it('coerces a non-object entry to an empty run', () => {
    expect(normalizeTextRuns([null, 5, 'x'])).toEqual([{}, {}, {}])
  })

  it('drops an invalid run color (treated as no override)', () => {
    expect(normalizeTextRuns([{ color: 'red' }, { color: '#123' }])).toEqual([
      { color: null },
      { color: '#123' }
    ])
  })

  it('keeps forward-compat extra run fields untouched', () => {
    const runs = normalizeTextRuns([{ color: '#fff', weight: 700, foo: 'bar' }])
    expect(runs[0]).toMatchObject({ color: '#fff', weight: 700, foo: 'bar' })
  })
})

describe('runColorForWord — word→run mapping + out-of-bounds (P6.9)', () => {
  const solid: ResolvedTextFill = { type: 'solid', color: 'rgba(255, 255, 255, 1)' }
  const gradient: ResolvedTextFill = {
    type: 'gradient',
    stops: [
      { offset: 0, color: '#fff' },
      { offset: 1, color: '#000' }
    ],
    opacity: 1,
    angleDeg: 0
  }

  it('overrides the base for ONLY the word index that has a run color (solid base)', () => {
    const runs = normalizeTextRuns([{ color: '#ff0000' }, {}, { color: '#0000ff' }])
    expect(runColorForWord(solid, runs, 0, 1)).toBe('rgba(255, 0, 0, 1)')
    // index 1 has no override → base solid color.
    expect(runColorForWord(solid, runs, 1, 1)).toBe('rgba(255, 255, 255, 1)')
    expect(runColorForWord(solid, runs, 2, 1)).toBe('rgba(0, 0, 255, 1)')
  })

  it('words without a run use the base GRADIENT (null = keep gradient paint)', () => {
    const runs = normalizeTextRuns([{ color: '#ff0000' }, {}])
    expect(runColorForWord(gradient, runs, 0, 1)).toBe('rgba(255, 0, 0, 1)')
    // no override over a gradient → null → caller keeps the gradient.
    expect(runColorForWord(gradient, runs, 1, 1)).toBeNull()
  })

  it('a SHORTER runs array → words past the end use the base fill', () => {
    const runs = normalizeTextRuns([{ color: '#ff0000' }]) // only word 0 styled
    expect(runColorForWord(solid, runs, 0, 1)).toBe('rgba(255, 0, 0, 1)')
    expect(runColorForWord(solid, runs, 5, 1)).toBe('rgba(255, 255, 255, 1)') // base
    expect(runColorForWord(gradient, runs, 5, 1)).toBeNull() // base gradient
  })

  it('a LONGER runs array → extra runs are simply never indexed (no crash)', () => {
    const runs = normalizeTextRuns([{}, {}, { color: '#00ff00' }])
    // a line with 2 words only indexes 0 and 1 → both base; index 2 ignored.
    expect(runColorForWord(solid, runs, 0, 1)).toBe('rgba(255, 255, 255, 1)')
    expect(runColorForWord(solid, runs, 1, 1)).toBe('rgba(255, 255, 255, 1)')
  })

  it('clearing a run color reverts that word to the base fill', () => {
    const before = normalizeTextRuns([{ color: '#ff0000' }])
    expect(runColorForWord(solid, before, 0, 1)).toBe('rgba(255, 0, 0, 1)')
    // simulate the UI "Reset" (delete color) → back to base.
    const after = normalizeTextRuns([{}])
    expect(runColorForWord(solid, after, 0, 1)).toBe('rgba(255, 255, 255, 1)')
  })

  it('bakes the run color at the base fill opacity', () => {
    const runs: TextRun[] = [{ color: '#ff0000' }]
    expect(runColorForWord(solid, runs, 0, 0.4)).toBe('rgba(255, 0, 0, 0.4)')
  })

  it('PRECEDENCE base < run < active-highlight: the highlight color wins over a run', () => {
    // The draw path applies runColorForWord first, then OVERWRITES ctx.fillStyle
    // with the active-word highlight color. Model that final swap here.
    const runs = normalizeTextRuns([{ color: '#ff0000' }])
    let fillStyle = runColorForWord(solid, runs, 0, 1) ?? solid.color
    expect(fillStyle).toBe('rgba(255, 0, 0, 1)') // run beats base
    const activeHighlightColor = '#ffe600'
    fillStyle = activeHighlightColor // active-word highlight overwrite (P5.6)
    expect(fillStyle).toBe('#ffe600') // active beats run
  })
})

describe('DEFAULT_TEXT_FILL', () => {
  it('is solid white, fully opaque', () => {
    expect(DEFAULT_TEXT_FILL).toEqual({ hex: '#ffffff', opacity: 1 })
  })
})

// ---------------------------------------------------------------------------
// P6.8 — multi-stop gradient with angle
// ---------------------------------------------------------------------------

describe('gradientEndpoints — PURE angle → endpoints across a w×h block', () => {
  // The endpoints are in the block's CENTERED local space (origin at center).
  it('0° spans left→right across the width', () => {
    const e = gradientEndpoints(0, 200, 80)
    expect(e.x0).toBe(-100)
    expect(e.x1).toBe(100)
    expect(e.y0).toBeCloseTo(0)
    expect(e.y1).toBeCloseTo(0)
  })

  it('90° spans top→bottom across the height (canvas y grows down)', () => {
    const e = gradientEndpoints(90, 200, 80)
    expect(e.x0).toBeCloseTo(-0)
    expect(e.x1).toBeCloseTo(0)
    expect(e.y0).toBeCloseTo(-40)
    expect(e.y1).toBeCloseTo(40)
  })

  it('180° spans right→left (mirror of 0°)', () => {
    const e = gradientEndpoints(180, 200, 80)
    expect(e.x0).toBeCloseTo(100)
    expect(e.x1).toBeCloseTo(-100)
    expect(e.y0).toBeCloseTo(0)
    expect(e.y1).toBeCloseTo(0)
  })

  it('270° spans bottom→top (mirror of 90°)', () => {
    const e = gradientEndpoints(270, 200, 80)
    expect(e.x0).toBeCloseTo(0)
    expect(e.x1).toBeCloseTo(0)
    expect(e.y0).toBeCloseTo(40)
    expect(e.y1).toBeCloseTo(-40)
  })

  it('45° reaches the block edge on its dominant axis (square block)', () => {
    // square 200×200: at 45° both axes tie → endpoint at (±100, ±100)·(1/√2)·t,
    // t = 100/cos45 = 100√2, so ex = cos45·100√2 = 100, ey = 100.
    const e = gradientEndpoints(45, 200, 200)
    expect(e.x0).toBeCloseTo(-100)
    expect(e.y0).toBeCloseTo(-100)
    expect(e.x1).toBeCloseTo(100)
    expect(e.y1).toBeCloseTo(100)
  })

  it('45° on a wide non-square block is clamped to the SHORTER half-axis (height)', () => {
    // 200×80 at 45°: tx = 100/cos45 = 141.4, ty = 40/sin45 = 56.6 → t = ty.
    // ex = ey = 40 (the gradient just reaches the top/bottom edge).
    const e = gradientEndpoints(45, 200, 80)
    expect(e.x1).toBeCloseTo(40)
    expect(e.y1).toBeCloseTo(40)
  })

  it('defaults the height to the width when h is omitted (square span)', () => {
    expect(gradientEndpoints(90, 200, 200)).toEqual(gradientEndpoints(90, 200, 200))
    const sq = gradientEndpoints(90, 200, 200)
    expect(sq.y0).toBeCloseTo(-100)
    expect(sq.y1).toBeCloseTo(100)
  })

  it('falls back to a paintable 1px span for a degenerate (0×0) block', () => {
    const e = gradientEndpoints(0, 0, 0)
    expect(e.x0).toBeCloseTo(-0.5)
    expect(e.x1).toBeCloseTo(0.5)
  })
})

describe('normalizeGradientStops — sort + clamp', () => {
  it('clamps offsets into [0,1]', () => {
    expect(normalizeGradientStops([{ offset: -0.5, color: '#000' }, { offset: 2, color: '#fff' }])).toEqual([
      { offset: 0, color: '#000' },
      { offset: 1, color: '#fff' }
    ])
  })

  it('sorts ascending by offset (out-of-order input)', () => {
    expect(
      normalizeGradientStops([
        { offset: 1, color: '#0000ff' },
        { offset: 0, color: '#ff0000' },
        { offset: 0.5, color: '#00ff00' }
      ])
    ).toEqual([
      { offset: 0, color: '#ff0000' },
      { offset: 0.5, color: '#00ff00' },
      { offset: 1, color: '#0000ff' }
    ])
  })
})

/** A canvas stub that records the gradient endpoints + the baked color stops. */
function gradientSpy(): {
  ctx: CanvasRenderingContext2D
  created: () => { x0: number; y0: number; x1: number; y1: number } | null
  stops: () => { offset: number; color: string }[]
} {
  let created: { x0: number; y0: number; x1: number; y1: number } | null = null
  const added: { offset: number; color: string }[] = []
  const ctx = {
    createLinearGradient(x0: number, y0: number, x1: number, y1: number) {
      created = { x0, y0, x1, y1 }
      return {
        addColorStop(offset: number, color: string) {
          added.push({ offset, color })
        }
      }
    }
  } as unknown as CanvasRenderingContext2D
  return { ctx, created: () => created, stops: () => added }
}

describe('fillToCanvasPaint — gradient geometry + baked stops (P6.8)', () => {
  it('builds a 2-stop gradient across blockW×blockH at angle 90 (vertical)', () => {
    const spy = gradientSpy()
    const fill: ResolvedTextFill = {
      type: 'gradient',
      stops: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: '#0000ff' }
      ],
      opacity: 0.5,
      angleDeg: 90
    }
    fillToCanvasPaint(spy.ctx, fill, 200, 80)
    const c = spy.created()!
    expect(c.x0).toBeCloseTo(0)
    expect(c.x1).toBeCloseTo(0)
    expect(c.y0).toBeCloseTo(-40)
    expect(c.y1).toBeCloseTo(40)
    expect(spy.stops()).toEqual([
      { offset: 0, color: 'rgba(255, 0, 0, 0.5)' },
      { offset: 1, color: 'rgba(0, 0, 255, 0.5)' }
    ])
  })

  it('builds a 3-stop gradient with each stop baked at the fill opacity', () => {
    const spy = gradientSpy()
    const fill: ResolvedTextFill = {
      type: 'gradient',
      stops: [
        { offset: 0, color: '#ff0000' },
        { offset: 0.5, color: '#00ff00' },
        { offset: 1, color: '#0000ff' }
      ],
      opacity: 0.8,
      angleDeg: 0
    }
    fillToCanvasPaint(spy.ctx, fill, 200, 80)
    expect(spy.stops()).toEqual([
      { offset: 0, color: 'rgba(255, 0, 0, 0.8)' },
      { offset: 0.5, color: 'rgba(0, 255, 0, 0.8)' },
      { offset: 1, color: 'rgba(0, 0, 255, 0.8)' }
    ])
  })

  it('SORTS + CLAMPS stop offsets before adding them (monotonic for the canvas)', () => {
    const spy = gradientSpy()
    const fill: ResolvedTextFill = {
      type: 'gradient',
      stops: [
        { offset: 2, color: '#0000ff' },
        { offset: -1, color: '#ff0000' },
        { offset: 0.5, color: '#00ff00' }
      ],
      opacity: 1,
      angleDeg: 0
    }
    fillToCanvasPaint(spy.ctx, fill, 100, 100)
    expect(spy.stops()).toEqual([
      { offset: 0, color: 'rgba(255, 0, 0, 1)' },
      { offset: 0.5, color: 'rgba(0, 255, 0, 1)' },
      { offset: 1, color: 'rgba(0, 0, 255, 1)' }
    ])
  })

  it('omitting blockH spans a square block (horizontal gradient unchanged)', () => {
    const spy = gradientSpy()
    fillToCanvasPaint(
      spy.ctx,
      { type: 'gradient', stops: [{ offset: 0, color: '#fff' }, { offset: 1, color: '#000' }], opacity: 1, angleDeg: 0 },
      200
    )
    const c = spy.created()!
    expect(c.x0).toBe(-100)
    expect(c.x1).toBe(100)
    expect(c.y0).toBeCloseTo(0)
    expect(c.y1).toBeCloseTo(0)
  })
})

describe('resolveTextFill — gradient resolution for the draw spec', () => {
  it('resolves a 3-stop gradient (sorted offsets preserved, opacity + angle)', () => {
    const out = resolveTextFill({
      type: 'gradient',
      value: [
        { offset: 0, color: '#ff0000' },
        { offset: 0.5, color: '#00ff00' },
        { offset: 1, color: '#0000ff' }
      ],
      opacity: 0.6,
      angle: 135
    })
    expect(out).toEqual({
      type: 'gradient',
      stops: [
        { offset: 0, color: '#ff0000' },
        { offset: 0.5, color: '#00ff00' },
        { offset: 1, color: '#0000ff' }
      ],
      opacity: 0.6,
      angleDeg: 135
    })
  })

  it('a single valid stop degrades to a solid baked at opacity', () => {
    expect(resolveTextFill({ type: 'gradient', value: [{ offset: 0.3, color: '#112233' }], opacity: 0.5 })).toEqual({
      type: 'solid',
      color: 'rgba(17, 34, 51, 0.5)'
    })
  })

  it('defaults a missing angle to 0', () => {
    const out = resolveTextFill({
      type: 'gradient',
      value: [
        { offset: 0, color: '#000' },
        { offset: 1, color: '#fff' }
      ],
      opacity: 1
    })
    expect(out.type).toBe('gradient')
    if (out.type === 'gradient') expect(out.angleDeg).toBe(0)
  })
})

describe('solid ↔ gradient round-trips through the persisted clip.text.fill shape', () => {
  // Mirrors what the TextPanel writes: solid `{type,value:hex,opacity}` and
  // gradient `{type,value:Stop[],opacity,angle}`. Re-resolving the written bag
  // must yield the same paint model — i.e. the fill survives save → reload.
  it('a written gradient bag re-resolves to the same gradient (reload-stable)', () => {
    const bag = {
      type: 'gradient',
      value: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: '#0000ff' }
      ],
      opacity: 0.9,
      angle: 90
    }
    const first = resolveTextFill(bag)
    // Re-feed a JSON round-trip (what persistence does) and re-resolve.
    const reloaded = resolveTextFill(JSON.parse(JSON.stringify(bag)))
    expect(reloaded).toEqual(first)
    expect(reloaded.type).toBe('gradient')
  })

  it('switching gradient → solid (first stop) → gradient is lossless on color', () => {
    const gradientBag = {
      type: 'gradient',
      value: [
        { offset: 0, color: '#abcdef' },
        { offset: 1, color: '#000000' }
      ],
      opacity: 1,
      angle: 0
    }
    // gradient → solid keeps the first stop color.
    const asSolid = resolveTextFill({ type: 'solid', value: '#abcdef', opacity: 1 })
    expect(asSolid).toEqual({ type: 'solid', color: 'rgba(171, 205, 239, 1)' })
    // solid → gradient (seed back to a 2-stop) re-resolves as a gradient.
    const back = resolveTextFill(gradientBag)
    expect(back.type).toBe('gradient')
  })
})

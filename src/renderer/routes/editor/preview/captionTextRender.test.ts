import { describe, expect, it } from 'vitest'
import { defaultCaptionPreset, type CaptionPreset } from '../../../../shared/captionPreset'
import {
  getCaptionPreset,
  listCaptionPresets,
  PRESET_BOUNCE,
  PRESET_KARAOKE_HIGHLIGHT,
  PRESET_TYPEWRITER
} from '../../../../shared/captionPresetRegistry'
import {
  cssFontShorthand,
  drawPresetCaption,
  fitScale,
  fontFamilyList,
  presetToTextDrawSpec,
  rgbaFromHex,
  type TextDrawSpec
} from './captionTextRender'

describe('rgbaFromHex', () => {
  it('expands #rgb shorthand and bakes opacity', () => {
    expect(rgbaFromHex('#f00', 1)).toBe('rgba(255, 0, 0, 1)')
    expect(rgbaFromHex('#fff', 0.5)).toBe('rgba(255, 255, 255, 0.5)')
  })

  it('parses full #rrggbb', () => {
    expect(rgbaFromHex('#101820', 0.55)).toBe('rgba(16, 24, 32, 0.55)')
  })

  it('drops the alpha byte from #rrggbbaa and clamps opacity', () => {
    expect(rgbaFromHex('#00ff00ff', 2)).toBe('rgba(0, 255, 0, 1)')
    expect(rgbaFromHex('#000000', -1)).toBe('rgba(0, 0, 0, 0)')
  })
})

describe('fontFamilyList', () => {
  it('puts family first, then fallback, quoting space-containing names', () => {
    const list = fontFamilyList({
      family: 'Noto Sans Tamil',
      size: 40,
      weight: 700,
      italic: false,
      letterSpacing: 0,
      lineHeight: 1.2,
      fallback: ['Inter', 'sans-serif']
    })
    expect(list).toBe('"Noto Sans Tamil", Inter, sans-serif')
  })

  it('de-duplicates a family that also appears in the fallback chain', () => {
    const list = fontFamilyList({
      family: 'Inter',
      size: 40,
      weight: 'bold',
      italic: false,
      letterSpacing: 0,
      lineHeight: 1.2,
      fallback: ['Inter', 'sans-serif']
    })
    expect(list).toBe('Inter, sans-serif')
  })
})

describe('cssFontShorthand', () => {
  it('renders [italic] weight size family', () => {
    expect(
      cssFontShorthand({
        family: 'Inter',
        size: 48,
        weight: 800,
        italic: true,
        letterSpacing: 0,
        lineHeight: 1.2
      })
    ).toBe('italic 800 48px Inter')
  })

  it('passes string weights through', () => {
    expect(
      cssFontShorthand({
        family: 'Inter',
        size: 32,
        weight: 'bold',
        italic: false,
        letterSpacing: 0,
        lineHeight: 1.2
      })
    ).toBe('bold 32px Inter')
  })
})

describe('presetToTextDrawSpec', () => {
  it('projects the default (TikTok Classic) preset onto a faithful spec', () => {
    const spec = presetToTextDrawSpec(defaultCaptionPreset())
    expect(spec.fontSizePx).toBe(48)
    expect(spec.lineHeight).toBe(1.2)
    expect(spec.fill).toEqual({ type: 'solid', color: 'rgba(255, 255, 255, 1)' })
    // single black outline → one stroke layer (color baked to rgba by the shared
    // P6.10 resolver, matching the rgba-baked fill above — thumbnail = preview).
    expect(spec.stroke).toEqual([{ color: 'rgba(0, 0, 0, 1)', width: 4 }])
    expect(spec.shadow).not.toBeNull()
    expect(spec.font).toContain('48px')
  })

  it('orders stroke layers widest-first so thinner layers stack on top', () => {
    const preset: CaptionPreset = {
      ...defaultCaptionPreset(),
      id: 'multi-stroke',
      stroke: [
        { color: '#111111', width: 2 },
        { color: '#ffffff', width: 6 }
      ]
    }
    const spec = presetToTextDrawSpec(preset)
    expect(spec.stroke.map((s) => s.width)).toEqual([6, 2])
  })

  it('drops zero-width stroke layers', () => {
    const preset: CaptionPreset = {
      ...defaultCaptionPreset(),
      id: 'zero-stroke',
      stroke: [{ color: '#000000', width: 0 }]
    }
    expect(presetToTextDrawSpec(preset).stroke).toEqual([])
  })

  it('keeps gradient stops + opacity for a gradient fill (Bounce)', () => {
    const spec = presetToTextDrawSpec(getCaptionPreset(PRESET_BOUNCE) as CaptionPreset)
    expect(spec.fill.type).toBe('gradient')
    if (spec.fill.type === 'gradient') {
      expect(spec.fill.stops.length).toBeGreaterThanOrEqual(2)
      expect(spec.fill.opacity).toBe(1)
    }
  })

  it('resolves the decoration background box to an rgba color (Karaoke)', () => {
    const spec = presetToTextDrawSpec(getCaptionPreset(PRESET_KARAOKE_HIGHLIGHT) as CaptionPreset)
    expect(spec.background).not.toBeNull()
    expect(spec.background?.color).toBe('rgba(16, 24, 32, 0.55)')
    expect(spec.background?.radius).toBe(12)
  })

  it('omits the shadow when a preset has none (Typewriter)', () => {
    const spec = presetToTextDrawSpec(getCaptionPreset(PRESET_TYPEWRITER) as CaptionPreset)
    expect(spec.shadow).toBeNull()
    expect(spec.background).not.toBeNull()
  })

  it('derives the shadow offset from angle + distance (shared P6.13 resolver)', () => {
    const spec = presetToTextDrawSpec(defaultCaptionPreset()) // angle 45, distance 4
    // cos/sin 45° * 4 ≈ 2.828 — now the SHARED ResolvedTextShadow shape (offset.x/y).
    expect(spec.shadow?.offset.x).toBeCloseTo(2.828, 2)
    expect(spec.shadow?.offset.y).toBeCloseTo(2.828, 2)
    expect(spec.shadow?.kind).toBe('drop')
  })

  it('produces a spec for every registered preset without throwing', () => {
    for (const preset of listCaptionPresets()) {
      const spec = presetToTextDrawSpec(preset)
      expect(spec.font.length).toBeGreaterThan(0)
      expect(spec.fontSizePx).toBeGreaterThan(0)
    }
  })
})

describe('fitScale', () => {
  it('downscales a block that overflows the thumbnail', () => {
    // block 400x100 into 200x96 box, no padding, 8px margin → availW=184
    const s = fitScale(400, 100, 200, 96, 0, 8)
    expect(s).toBeCloseTo(184 / 400, 5)
    expect(s).toBeLessThan(1)
  })

  it('never upscales a block that already fits (clamped to 1)', () => {
    expect(fitScale(20, 20, 200, 96, 0, 8)).toBe(1)
  })

  it('accounts for background padding on both sides', () => {
    const withPad = fitScale(400, 100, 200, 96, 16, 8)
    const noPad = fitScale(400, 100, 200, 96, 0, 8)
    expect(withPad).toBeLessThan(noPad)
  })

  it('returns a positive floor for degenerate inputs', () => {
    expect(fitScale(0, 0, 200, 96, 0, 8)).toBe(1)
    expect(fitScale(1000, 1000, 10, 10, 8, 8)).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// P6.3 — letterSpacing flows into the canvas draw (preview = export)
// ---------------------------------------------------------------------------

/** A minimal recording canvas stub: each char is 10px wide. */
function stubCtx(): { ctx: CanvasRenderingContext2D; letterSpacingSet: string[] } {
  const letterSpacingSet: string[] = []
  let _ls = ''
  const ctx = {
    setTransform() {},
    clearRect() {},
    fillRect() {},
    save() {},
    restore() {},
    translate() {},
    scale() {},
    beginPath() {},
    moveTo() {},
    arcTo() {},
    closePath() {},
    fill() {},
    strokeText() {},
    fillText() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: (s: string) => ({ width: s.length * 10 }),
    font: '',
    textAlign: '',
    textBaseline: '',
    fillStyle: '' as string | CanvasGradient,
    strokeStyle: '',
    lineWidth: 0,
    lineJoin: '',
    miterLimit: 0,
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    get letterSpacing() {
      return _ls
    },
    set letterSpacing(v: string) {
      _ls = v
      letterSpacingSet.push(v)
    }
  } as unknown as CanvasRenderingContext2D
  return { ctx, letterSpacingSet }
}

describe('drawPresetCaption letterSpacing', () => {
  const baseSpec: TextDrawSpec = {
    font: 'normal 40px Inter',
    fontSizePx: 40,
    lineHeight: 1.2,
    letterSpacing: 6,
    fill: { type: 'solid', color: '#fff' },
    stroke: [],
    shadow: null,
    background: null
  }

  it('sets the canvas letterSpacing to the spec value', () => {
    const { ctx, letterSpacingSet } = stubCtx()
    drawPresetCaption(ctx, baseSpec, { width: 1000, height: 500, lines: ['abcde'] })
    expect(letterSpacingSet).toContain('6px')
  })

  it('letterSpacing widens the fit scale (block measured wider with spacing)', () => {
    // 'abcde' = 5 clusters → 4 gaps. base 50, +4*6 = 74. With a narrow box both
    // overflow, so the wider (spaced) block must downscale MORE than the tight one.
    const { ctx } = stubCtx()
    const spaced = drawPresetCaption(ctx, baseSpec, { width: 60, height: 500, lines: ['abcde'] })
    const { ctx: ctx2 } = stubCtx()
    const tight = drawPresetCaption(ctx2, { ...baseSpec, letterSpacing: 0 }, {
      width: 60,
      height: 500,
      lines: ['abcde']
    })
    expect(spaced).toBeLessThan(tight)
  })
})

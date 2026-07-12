import { describe, expect, it } from 'vitest'
import {
  EMOJI_PALETTE,
  clamp,
  decorationSummary,
  decorationToBag,
  defaultSectionState,
  deriveDecorationState,
  deriveFillState,
  deriveHollow,
  deriveShadowState,
  deriveStrokeLayers,
  deriveWordState,
  formatDeg,
  formatPercent,
  formatPx,
  nextStrokeWidth,
  normalizeHex,
  setWordColorRuns,
  strokeLayersToBag,
  toggleSection
} from './textPanelState'

describe('normalizeHex', () => {
  it('expands shorthand and lowercases', () => {
    expect(normalizeHex('#FFF')).toBe('#ffffff')
    expect(normalizeHex('abc')).toBe('#aabbcc')
  })
  it('drops an alpha byte/nibble', () => {
    expect(normalizeHex('#11223344')).toBe('#112233')
    expect(normalizeHex('#0f08')).toBe('#00ff00')
  })
  it('falls back to white on garbage', () => {
    expect(normalizeHex('not-a-color')).toBe('#ffffff')
    expect(normalizeHex('')).toBe('#ffffff')
  })
})

describe('clamp', () => {
  it('clamps into range and maps NaN to lo', () => {
    expect(clamp(5, 0, 1)).toBe(1)
    expect(clamp(-5, 0, 1)).toBe(0)
    expect(clamp(0.5, 0, 1)).toBe(0.5)
    expect(clamp(Number.NaN, 0, 1)).toBe(0)
  })
})

describe('section accordion state', () => {
  it('defaults to Typography open, others closed', () => {
    expect(defaultSectionState()).toEqual({
      typography: true,
      color: false,
      stroke: false,
      shadow: false,
      decorations: false,
      effects: false
    })
  })
  it('toggleSection flips one section immutably', () => {
    const a = defaultSectionState()
    const b = toggleSection(a, 'color')
    expect(b.color).toBe(true)
    expect(a.color).toBe(false) // original untouched
    expect(toggleSection(b, 'color').color).toBe(false)
  })
})

describe('deriveDecorationState / decorationToBag (P7.8 background bubble)', () => {
  it('reads an enabled background bubble', () => {
    const s = deriveDecorationState({ background: { color: '#102030', opacity: 0.5, padding: 16, radius: 12 } })
    expect(s.backgroundOn).toBe(true)
    expect(s.color).toBe('#102030')
    expect(s.opacity).toBe(0.5)
    expect(s.padding).toBe(16)
    expect(s.radius).toBe(12)
  })

  it('is off + default for no decoration (backward compat)', () => {
    const s = deriveDecorationState(undefined)
    expect(s.backgroundOn).toBe(false)
    expect(s.padding).toBe(0)
    expect(s.radius).toBe(0)
  })

  it('round-trips through decorationToBag', () => {
    const s = deriveDecorationState({ background: { color: '#abcdef', opacity: 0.7, padding: 10, radius: 4 } })
    const bag = decorationToBag(undefined, s)
    expect(bag.background).toEqual({ color: '#abcdef', opacity: 0.7, padding: 10, radius: 4 })
  })

  it('removes the background key when disabled (and preserves rule fields)', () => {
    const prev = { background: { color: '#000', opacity: 1 }, underline: true }
    const bag = decorationToBag(prev, { ...deriveDecorationState(prev), backgroundOn: false })
    expect(bag.background).toBeUndefined()
    // underline:true round-trips to the canonical {enabled:true} rule shape.
    expect(bag.underline).toEqual({ enabled: true })
  })

  // P7.9 — underline / strike rules.
  it('reads underline/strike rule state (true, object, color, off)', () => {
    expect(deriveDecorationState({ underline: true })).toMatchObject({ underlineOn: true, underlineColor: '' })
    expect(deriveDecorationState({ underline: { color: '#ff0000' } })).toMatchObject({
      underlineOn: true,
      underlineColor: '#ff0000'
    })
    expect(deriveDecorationState({ underline: { enabled: false } })).toMatchObject({ underlineOn: false })
    expect(deriveDecorationState({ strike: true })).toMatchObject({ strikeOn: true, strikeColor: '' })
    expect(deriveDecorationState(undefined)).toMatchObject({
      underlineOn: false,
      strikeOn: false,
      underlineColor: '',
      strikeColor: ''
    })
  })

  it('serializes underline/strike: on → {enabled,color?}; off → key removed', () => {
    const base = deriveDecorationState(undefined)
    // On, no color → glyph fill (color omitted).
    expect(decorationToBag(undefined, { ...base, underlineOn: true }).underline).toEqual({ enabled: true })
    // On, with color override.
    expect(
      decorationToBag(undefined, { ...base, strikeOn: true, strikeColor: '#00ff00' }).strike
    ).toEqual({ enabled: true, color: '#00ff00' })
    // Off → key removed even if it existed before.
    expect(decorationToBag({ underline: true }, { ...base, underlineOn: false }).underline).toBeUndefined()
  })

  it('rule state round-trips through derive → toBag → derive', () => {
    const bag = decorationToBag(undefined, {
      ...deriveDecorationState(undefined),
      underlineOn: true,
      underlineColor: '#abcdef',
      strikeOn: true
    })
    const s2 = deriveDecorationState(bag as Record<string, unknown>)
    expect(s2.underlineOn).toBe(true)
    expect(s2.underlineColor).toBe('#abcdef')
    expect(s2.strikeOn).toBe(true)
    expect(s2.strikeColor).toBe('')
  })

  // P7.10 — highlight BARS (marker; distinct from the caption PresetHighlight).
  it('is off + default highlight bar for no decoration (backward compat)', () => {
    expect(deriveDecorationState(undefined)).toMatchObject({
      highlightOn: false,
      highlightMode: 'word',
      highlightPadding: 0,
      highlightRadius: 0
    })
  })

  it('reads highlight-bar state from `highlightBar` (mode/color/opacity/padding/radius)', () => {
    const s = deriveDecorationState({
      highlightBar: { mode: 'line', color: '#ff0000', opacity: 0.6, padding: 4, radius: 3 }
    })
    expect(s).toMatchObject({
      highlightOn: true,
      highlightMode: 'line',
      highlightColor: '#ff0000',
      highlightOpacity: 0.6,
      highlightPadding: 4,
      highlightRadius: 3
    })
  })

  it('reads a legacy `highlight` key; enabled:false / zero-opacity → off', () => {
    expect(deriveDecorationState({ highlight: { color: '#00ff00', opacity: 1 } })).toMatchObject({
      highlightOn: true,
      highlightColor: '#00ff00'
    })
    expect(deriveDecorationState({ highlightBar: { enabled: false } }).highlightOn).toBe(false)
    expect(deriveDecorationState({ highlightBar: { opacity: 0 } }).highlightOn).toBe(false)
  })

  it('serializes the highlight bar to `highlightBar` (canonical key); off → removed', () => {
    const base = deriveDecorationState(undefined)
    const bag = decorationToBag(undefined, {
      ...base,
      highlightOn: true,
      highlightMode: 'word',
      highlightColor: '#ffe600',
      highlightOpacity: 0.4,
      highlightPadding: 4,
      highlightRadius: 4
    })
    expect(bag.highlightBar).toEqual({
      enabled: true,
      mode: 'word',
      color: '#ffe600',
      opacity: 0.4,
      padding: 4,
      radius: 4
    })
    // A legacy `highlight` key is dropped on write (highlightBar is canonical).
    const migrated = decorationToBag({ highlight: { color: '#0f0' } }, { ...base, highlightOn: false })
    expect(migrated.highlight).toBeUndefined()
    expect(migrated.highlightBar).toBeUndefined()
  })

  it('highlight bar round-trips through derive → toBag → derive', () => {
    const bag = decorationToBag(undefined, {
      ...deriveDecorationState(undefined),
      highlightOn: true,
      highlightMode: 'line',
      highlightColor: '#abcdef',
      highlightOpacity: 0.5,
      highlightPadding: 6,
      highlightRadius: 2
    })
    const s2 = deriveDecorationState(bag as Record<string, unknown>)
    expect(s2).toMatchObject({
      highlightOn: true,
      highlightMode: 'line',
      highlightColor: '#abcdef',
      highlightOpacity: 0.5,
      highlightPadding: 6,
      highlightRadius: 2
    })
  })
})

describe('decorationSummary (P7.12 panel header)', () => {
  const base = deriveDecorationState(undefined)

  it('reports "none" when no decoration family is active', () => {
    expect(decorationSummary(base)).toBe('none')
  })

  it('lists active families in render order (bubble, bars, underline, strike)', () => {
    expect(decorationSummary({ ...base, backgroundOn: true })).toBe('Bubble')
    expect(decorationSummary({ ...base, highlightOn: true })).toBe('Bars')
    expect(decorationSummary({ ...base, underlineOn: true })).toBe('Underline')
    expect(decorationSummary({ ...base, strikeOn: true })).toBe('Strike')
    expect(
      decorationSummary({ ...base, backgroundOn: true, highlightOn: true, underlineOn: true, strikeOn: true })
    ).toBe('Bubble · Bars · Underline · Strike')
  })
})

describe('EMOJI_PALETTE (P7.11/P7.12 inline emoji inserts)', () => {
  it('is a non-empty list of unique entries', () => {
    expect(EMOJI_PALETTE.length).toBeGreaterThan(0)
    expect(new Set(EMOJI_PALETTE).size).toBe(EMOJI_PALETTE.length)
  })

  it('every entry is exactly one extended grapheme cluster (never split on insert)', () => {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    for (const emoji of EMOJI_PALETTE) {
      expect([...seg.segment(emoji)]).toHaveLength(1)
    }
  })
})

describe('deriveFillState', () => {
  it('reads a solid fill (color or value key)', () => {
    expect(deriveFillState({ type: 'solid', color: '#FF0000', opacity: 0.5 })).toMatchObject({
      hex: '#ff0000',
      opacity: 0.5,
      isGradient: false
    })
    expect(deriveFillState({ value: '#00ff00' }).hex).toBe('#00ff00')
  })
  it('defaults to white/opaque when absent or invalid', () => {
    expect(deriveFillState(undefined)).toMatchObject({ hex: '#ffffff', opacity: 1, isGradient: false })
    expect(deriveFillState({ color: 'nope', opacity: 9 }).hex).toBe('#ffffff')
    expect(deriveFillState({ opacity: 9 }).opacity).toBe(1)
  })
  it('reads a gradient preserving author stop order', () => {
    const s = deriveFillState({
      type: 'gradient',
      value: [
        { offset: 1, color: '#000' },
        { offset: 0, color: '#fff' }
      ],
      angle: 45
    })
    expect(s.isGradient).toBe(true)
    expect(s.angle).toBe(45)
    expect(s.stops).toEqual([
      { offset: 1, color: '#000000' },
      { offset: 0, color: '#ffffff' }
    ])
  })
})

describe('deriveWordState + setWordColorRuns', () => {
  it('prefers caption words, falls back to splitting lines', () => {
    expect(deriveWordState({ lines: ['hello world'] }, undefined).words).toEqual(['hello', 'world'])
    expect(deriveWordState({ lines: ['x'] }, [{ text: 'a' }, { text: 'b' }]).words).toEqual(['a', 'b'])
  })
  it('reads per-word override colors', () => {
    const ws = deriveWordState({ lines: ['a b'], runs: [{}, { color: '#FF0000' }] }, undefined)
    expect(ws.colorAt(0)).toBeNull()
    expect(ws.colorAt(1)).toBe('#ff0000')
    expect(ws.colorAt(5)).toBeNull()
  })
  it('pads sparse runs and clears with null', () => {
    const set = setWordColorRuns([], 2, '#00ff00')
    expect(set).toHaveLength(3)
    expect(set[2].color).toBe('#00ff00')
    expect(set[0]).toEqual({})
    const cleared = setWordColorRuns(set, 2, null)
    expect(cleared[2].color).toBeUndefined()
  })
})

describe('deriveStrokeLayers / deriveHollow / strokeLayersToBag / nextStrokeWidth', () => {
  it('reads layers in author order, skipping widthless sentinels', () => {
    const layers = deriveStrokeLayers([
      { color: '#fff', width: 8 },
      { hollow: true }, // bare hollow sentinel, no width
      { color: '#000', width: 4 }
    ])
    expect(layers).toEqual([
      { hex: '#ffffff', width: 8 },
      { hex: '#000000', width: 4 }
    ])
  })
  it('detects hollow on any layer', () => {
    expect(deriveHollow([{ color: '#fff', width: 8, hollow: true }])).toBe(true)
    expect(deriveHollow([{ color: '#fff', width: 8 }])).toBe(false)
    expect(deriveHollow(undefined)).toBe(false)
  })
  it('serializes layers and stamps hollow on every layer', () => {
    const bag = strokeLayersToBag([{ hex: '#FFF', width: 8 }], true)
    expect(bag).toEqual([{ color: '#ffffff', width: 8, hollow: true }])
    expect(strokeLayersToBag([{ hex: '#000', width: 4 }], false)).toEqual([{ color: '#000000', width: 4 }])
  })
  it('seeds the next layer wider than the widest, capped at 24', () => {
    expect(nextStrokeWidth([])).toBe(8)
    expect(nextStrokeWidth([{ hex: '#000', width: 6 }])).toBe(10)
    expect(nextStrokeWidth([{ hex: '#000', width: 22 }])).toBe(24)
  })
})

describe('deriveShadowState', () => {
  it('reads drop shadow defaults and on-state', () => {
    expect(deriveShadowState(undefined)).toMatchObject({ type: 'drop', on: false, distance: 0 })
    expect(deriveShadowState({ distance: 6 }).on).toBe(true)
  })
  it('maps inner/long flags to type with long winning', () => {
    expect(deriveShadowState({ distance: 6, inner: true }).type).toBe('inner')
    expect(deriveShadowState({ distance: 6, long: true }).type).toBe('long')
    expect(deriveShadowState({ distance: 6, inner: true, long: true }).type).toBe('long')
  })
  it('clamps angle into the slider range', () => {
    expect(deriveShadowState({ distance: 6, angle: 999 }).angle).toBe(180)
    expect(deriveShadowState({ distance: 6, angle: -999 }).angle).toBe(-180)
  })
})

describe('formatters', () => {
  it('formats percent / px / deg', () => {
    expect(formatPercent(0.756)).toBe('76%')
    expect(formatPercent(2)).toBe('100%')
    expect(formatPx(8.5, 1)).toBe('8.5px')
    expect(formatPx(8)).toBe('8px')
    expect(formatDeg(89.6)).toBe('90°')
  })
})

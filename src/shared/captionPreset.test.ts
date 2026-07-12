import { describe, expect, it } from 'vitest'
import {
  captionPresetToClipStyle,
  defaultCaptionPreset,
  isCaptionPreset,
  parseCaptionPreset,
  resolveLayoutY,
  validateCaptionPreset,
  type CaptionPreset
} from './captionPreset'

/** Deep clone the default preset so a test can mutate one field in isolation. */
function preset(): CaptionPreset {
  return structuredClone(defaultCaptionPreset())
}

describe('defaultCaptionPreset', () => {
  it('produces a well-formed preset that round-trips through validation', () => {
    const p = defaultCaptionPreset()
    const result = validateCaptionPreset(p)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual(p)
    expect(isCaptionPreset(p)).toBe(true)
    // parse-or-throw returns the same object.
    expect(parseCaptionPreset(p)).toEqual(p)
  })

  it('defaults to an Indic-capable font family (renders Tamil) with a fallback chain', () => {
    const p = defaultCaptionPreset()
    expect(p.font.family.toLowerCase()).toContain('tamil')
    expect(p.font.fallback?.length ?? 0).toBeGreaterThan(0)
  })

  it('enables active-word highlight and a word-by-word reveal by default', () => {
    const p = defaultCaptionPreset()
    expect(p.highlight.enabled).toBe(true)
    expect(p.animation.reveal?.mode).toBe('word')
  })
})

describe('validateCaptionPreset — accepts well-formed presets', () => {
  it('accepts the default preset', () => {
    expect(validateCaptionPreset(preset()).ok).toBe(true)
  })

  it('accepts a minimal preset with all optional looks omitted', () => {
    const p = preset()
    delete p.stroke
    delete p.shadow
    delete p.decoration
    delete p.font.fallback
    delete p.fill.perWord
    p.animation = {} // in/out/loop/reveal all optional
    const result = validateCaptionPreset(p)
    expect(result.ok).toBe(true)
  })

  it('accepts a gradient fill with >= 2 stops', () => {
    const p = preset()
    p.fill = {
      type: 'gradient',
      value: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: '#0000ff' }
      ],
      opacity: 1
    }
    expect(validateCaptionPreset(p).ok).toBe(true)
  })

  it('accepts a multi-layer stroke (stacking)', () => {
    const p = preset()
    p.stroke = [
      { color: '#000000', width: 6 },
      { color: '#ffffff', width: 2 }
    ]
    expect(validateCaptionPreset(p).ok).toBe(true)
  })
})

describe('validateCaptionPreset — rejects non-objects', () => {
  it.each([null, undefined, 42, 'str', []])('rejects %p', (v) => {
    const result = validateCaptionPreset(v)
    expect(result.ok).toBe(false)
  })
})

describe('validateCaptionPreset — rejects each malformed variant', () => {
  /** Apply a mutation, validate, assert failure, and assert an issue path. */
  function expectInvalid(mutate: (p: CaptionPreset) => void, path: string) {
    const p = preset()
    mutate(p as CaptionPreset)
    const result = validateCaptionPreset(p)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.some((i) => i.path === path)).toBe(true)
    }
  }

  it('missing required id', () => {
    expectInvalid((p) => delete (p as Partial<CaptionPreset>).id, 'id')
  })

  it('missing required displayName', () => {
    expectInvalid((p) => delete (p as Partial<CaptionPreset>).displayName, 'displayName')
  })

  it('bad category enum', () => {
    expectInvalid((p) => ((p as { category: string }).category = 'banner'), 'category')
  })

  it('missing required font', () => {
    expectInvalid((p) => delete (p as Partial<CaptionPreset>).font, 'font')
  })

  it('out-of-range font.size (<= 0)', () => {
    expectInvalid((p) => (p.font.size = 0), 'font.size')
  })

  it('out-of-range font.weight numeric (> 900)', () => {
    expectInvalid((p) => (p.font.weight = 999), 'font.weight')
  })

  it('non-positive font.lineHeight', () => {
    expectInvalid((p) => (p.font.lineHeight = 0), 'font.lineHeight')
  })

  it('bad fill.type enum', () => {
    expectInvalid((p) => ((p.fill as { type: string }).type = 'image'), 'fill.type')
  })

  it('out-of-range fill.opacity (> 1)', () => {
    expectInvalid((p) => (p.fill.opacity = 1.5), 'fill.opacity')
  })

  it('solid fill with a non-hex value', () => {
    expectInvalid((p) => (p.fill = { type: 'solid', value: 'red', opacity: 1 }), 'fill.value')
  })

  it('gradient fill with < 2 stops', () => {
    expectInvalid(
      (p) => (p.fill = { type: 'gradient', value: [{ offset: 0, color: '#fff' }], opacity: 1 }),
      'fill.value'
    )
  })

  it('stroke layer with a non-hex color', () => {
    expectInvalid((p) => (p.stroke = [{ color: 'black', width: 2 }]), 'stroke[0].color')
  })

  it('stroke layer with a negative width', () => {
    expectInvalid((p) => (p.stroke = [{ color: '#000000', width: -1 }]), 'stroke[0].width')
  })

  it('shadow out-of-range opacity', () => {
    expectInvalid((p) => p.shadow && (p.shadow.opacity = 2), 'shadow.opacity')
  })

  it('shadow non-boolean inner', () => {
    expectInvalid((p) => p.shadow && ((p.shadow as { inner: unknown }).inner = 'no'), 'shadow.inner')
  })

  it('decoration.background bad opacity', () => {
    expectInvalid(
      (p) => (p.decoration = { background: { color: '#000000', opacity: 5, padding: 8, radius: 8 } }),
      'decoration.background.opacity'
    )
  })

  it('animation.in bad easing enum', () => {
    expectInvalid(
      (p) => (p.animation.in = { preset: 'pop', durationSec: 0.2, easing: 'wobble' as never }),
      'animation.in.easing'
    )
  })

  it('animation.in negative duration', () => {
    expectInvalid(
      (p) => (p.animation.in = { preset: 'pop', durationSec: -1, easing: 'easeOut' }),
      'animation.in.durationSec'
    )
  })

  it('animation.reveal bad mode enum', () => {
    expectInvalid(
      (p) => (p.animation.reveal = { mode: 'line' as never, staggerSec: 0, easing: 'linear' }),
      'animation.reveal.mode'
    )
  })

  it('missing required animation', () => {
    expectInvalid((p) => delete (p as Partial<CaptionPreset>).animation, 'animation')
  })

  it('bad layout.anchor enum', () => {
    expectInvalid((p) => ((p.layout as { anchor: string }).anchor = 'middle'), 'layout.anchor')
  })

  it('layout.maxLines below 1', () => {
    expectInvalid((p) => (p.layout.maxLines = 0), 'layout.maxLines')
  })

  it('layout.y out of range', () => {
    expectInvalid((p) => (p.layout.y = 2), 'layout.y')
  })

  it('missing required highlight', () => {
    expectInvalid((p) => delete (p as Partial<CaptionPreset>).highlight, 'highlight')
  })

  it('highlight.activeScale not > 0', () => {
    expectInvalid((p) => (p.highlight.activeScale = 0), 'highlight.activeScale')
  })

  it('highlight bad style enum', () => {
    expectInvalid((p) => ((p.highlight as { style: string }).style = 'fade'), 'highlight.style')
  })

  it('collects MULTIPLE issues at once', () => {
    const p = preset()
    p.font.size = -1
    ;(p.fill as { type: string }).type = 'bogus'
    const result = validateCaptionPreset(p)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.length).toBeGreaterThanOrEqual(2)
  })
})

describe('parseCaptionPreset', () => {
  it('throws with a descriptive message on an invalid preset', () => {
    expect(() => parseCaptionPreset({ id: 'x' })).toThrow(/invalid CaptionPreset/)
  })
})

describe('resolveLayoutY', () => {
  it('maps named anchors to their default offsets', () => {
    expect(resolveLayoutY({ anchor: 'lower-third', safeMargin: true, maxLines: 2 })).toBeCloseTo(0.35)
    expect(resolveLayoutY({ anchor: 'center', safeMargin: true, maxLines: 2 })).toBe(0)
    expect(resolveLayoutY({ anchor: 'top', safeMargin: true, maxLines: 2 })).toBeCloseTo(-0.35)
  })

  it('respects an explicit y for a custom anchor', () => {
    expect(resolveLayoutY({ anchor: 'custom', y: 0.5, safeMargin: false, maxLines: 1 })).toBe(0.5)
    expect(resolveLayoutY({ anchor: 'custom', safeMargin: false, maxLines: 1 })).toBe(0)
  })
})

describe('captionPresetToClipStyle — the P5.4 mapping contract', () => {
  it('projects visual fields onto the clip text/* shape', () => {
    const p = defaultCaptionPreset()
    const style = captionPresetToClipStyle(p)

    // font maps with a bold flag derived from weight
    expect(style.text.font?.family).toBe(p.font.family)
    expect(style.text.font?.size).toBe(p.font.size)
    expect(style.text.font?.bold).toBe(true)
    expect(style.text.align).toBe('center')

    // fill / stroke / shadow copy through 1:1 (text-render parity)
    expect(style.text.fill).toEqual({ type: 'solid', value: '#ffffff', opacity: 1 })
    expect(style.text.stroke).toEqual(p.stroke)
    expect(style.text.shadow).toEqual(p.shadow)

    // animation bundle carries in + reveal
    expect(style.animation.in).toEqual(p.animation.in)
    expect(style.animation.reveal).toEqual(p.animation.reveal)

    // layout anchor resolves to a transform y patch
    expect(style.transformPatch.y).toBeCloseTo(0.35)
  })

  it('omits stroke/shadow/decoration when the preset omits them', () => {
    const p = preset()
    delete p.stroke
    delete p.shadow
    delete p.decoration
    const style = captionPresetToClipStyle(p)
    expect(style.text.stroke).toBeUndefined()
    expect(style.text.shadow).toBeUndefined()
    expect(style.text.decoration).toBeUndefined()
  })

  it('derives bold from a numeric weight >= 600', () => {
    const p = preset()
    p.font.weight = 700
    expect(captionPresetToClipStyle(p).text.font?.bold).toBe(true)
    p.font.weight = 400
    expect(captionPresetToClipStyle(p).text.font?.bold).toBe(false)
  })

  it('the produced text shape never contains line/lang content fields', () => {
    const p = defaultCaptionPreset()
    const style = captionPresetToClipStyle(p)
    expect('lines' in style.text).toBe(false)
    expect('lang' in style.text).toBe(false)
  })
})

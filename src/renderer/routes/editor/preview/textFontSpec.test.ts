import { describe, expect, it } from 'vitest'
import {
  resolveTextFont,
  resolvedFontShorthand,
  resolveFontForRun,
  fontShorthandWithList
} from './textFontSpec'

const DEFAULTS = { family: 'Noto Sans Tamil', sizePx: 64, lineHeight: 1.2 }

describe('resolveTextFont', () => {
  it('fills every field from defaults when font is undefined', () => {
    const f = resolveTextFont(undefined, DEFAULTS)
    expect(f).toEqual({
      family: 'Noto Sans Tamil',
      fallback: [],
      sizePx: 64,
      weight: 'normal',
      italic: false,
      letterSpacing: 0,
      lineHeight: 1.2,
      curve: 0
    })
  })

  it('reads + clamps curve from the bag; missing curve → 0 (straight)', () => {
    expect(resolveTextFont({ curve: 0.5 }, DEFAULTS).curve).toBe(0.5)
    expect(resolveTextFont({ curve: -0.3 }, DEFAULTS).curve).toBe(-0.3)
    expect(resolveTextFont({ curve: 2 }, DEFAULTS).curve).toBe(1)
    expect(resolveTextFont({ curve: -9 }, DEFAULTS).curve).toBe(-1)
    expect(resolveTextFont({}, DEFAULTS).curve).toBe(0)
    expect(resolveTextFont({ curve: 'nope' as unknown as number }, DEFAULTS).curve).toBe(0)
  })

  it('reads size / lineHeight / letterSpacing / italic / family from the bag', () => {
    const f = resolveTextFont(
      { family: 'Inter', size: 40, lineHeight: 1.5, letterSpacing: 3, italic: true },
      DEFAULTS
    )
    expect(f.family).toBe('Inter')
    expect(f.sizePx).toBe(40)
    expect(f.lineHeight).toBe(1.5)
    expect(f.letterSpacing).toBe(3)
    expect(f.italic).toBe(true)
  })

  it('bold boolean maps to weight bold; explicit numeric weight wins', () => {
    expect(resolveTextFont({ bold: true }, DEFAULTS).weight).toBe('bold')
    expect(resolveTextFont({ bold: false }, DEFAULTS).weight).toBe('normal')
    expect(resolveTextFont({ bold: true, weight: 500 }, DEFAULTS).weight).toBe(500)
    expect(resolveTextFont({ weight: 'bold' }, DEFAULTS).weight).toBe('bold')
  })

  it('rejects non-positive / non-finite size + lineHeight, falling back to defaults', () => {
    expect(resolveTextFont({ size: 0 }, DEFAULTS).sizePx).toBe(64)
    expect(resolveTextFont({ size: -5 }, DEFAULTS).sizePx).toBe(64)
    expect(resolveTextFont({ lineHeight: 0 }, DEFAULTS).lineHeight).toBe(1.2)
  })

  it('keeps a negative letterSpacing (tracking can be negative)', () => {
    expect(resolveTextFont({ letterSpacing: -2 }, DEFAULTS).letterSpacing).toBe(-2)
  })

  it('keeps only string fallback entries', () => {
    expect(resolveTextFont({ fallback: ['Inter', 42, 'sans-serif'] }, DEFAULTS).fallback).toEqual([
      'Inter',
      'sans-serif'
    ])
  })
})

describe('resolvedFontShorthand (bold/italic/size reflected)', () => {
  it('normal weight, no italic', () => {
    const f = resolveTextFont({ family: 'Inter', size: 32 }, DEFAULTS)
    expect(resolvedFontShorthand(f)).toBe('normal 32px Inter')
  })

  it('bold + italic reflected in the shorthand', () => {
    const f = resolveTextFont({ family: 'Inter', size: 48, bold: true, italic: true }, DEFAULTS)
    expect(resolvedFontShorthand(f)).toBe('italic bold 48px Inter')
  })

  it('numeric weight passed through; size scales', () => {
    const f = resolveTextFont({ family: 'Inter', size: 20, weight: 700 }, DEFAULTS)
    expect(resolvedFontShorthand(f)).toBe('700 20px Inter')
  })

  it('quotes space-containing families and appends the fallback chain', () => {
    const f = resolveTextFont(
      { family: 'Noto Sans Tamil', size: 24, fallback: ['Inter', 'sans-serif'] },
      DEFAULTS
    )
    expect(resolvedFontShorthand(f)).toBe('normal 24px "Noto Sans Tamil", Inter, sans-serif')
  })
})

describe('resolveFontForRun — per-script CSS family list feeds the render path', () => {
  it('Tamil run → a Tamil-capable family leads, list ends in a Latin family + generic', () => {
    const f = resolveTextFont({ family: 'Noto Sans Tamil', size: 48 }, DEFAULTS)
    const list = resolveFontForRun(f, 'வணக்கம் தமிழ்')
    expect(list.startsWith('"Noto Sans Tamil"')).toBe(true)
    expect(list).toContain('Inter')
    expect(list.endsWith('sans-serif')).toBe(true)
  })

  it('Tamil run with a LATIN-only chosen family still leads with a Tamil-capable family (no tofu)', () => {
    const f = resolveTextFont({ family: 'Inter', size: 48 }, DEFAULTS)
    const list = resolveFontForRun(f, 'வணக்கம் தமிழ்')
    // a Tamil-capable family must be first, before Inter
    expect(list.indexOf('Tamil')).toBeLessThan(list.indexOf('Inter'))
    expect(list.endsWith('sans-serif')).toBe(true)
  })

  it('Latin run keeps the chosen Latin family first', () => {
    const f = resolveTextFont({ family: 'Inter', size: 48 }, DEFAULTS)
    const list = resolveFontForRun(f, 'The quick brown fox')
    expect(list.startsWith('Inter')).toBe(true)
    expect(list.endsWith('sans-serif')).toBe(true)
  })

  it('the persisted clip fallback chain appears in the resolved list', () => {
    const f = resolveTextFont(
      { family: 'Noto Sans Tamil', size: 48, fallback: ['Catamaran', 'Inter', 'sans-serif'] },
      DEFAULTS
    )
    const list = resolveFontForRun(f, 'தமிழ்')
    expect(list).toContain('Catamaran')
  })
})

describe('fontShorthandWithList — reflects style/weight/size around a supplied list', () => {
  it('bold + italic + a pre-resolved family list', () => {
    const f = resolveTextFont({ family: 'Noto Sans Tamil', size: 48, bold: true, italic: true }, DEFAULTS)
    const list = resolveFontForRun(f, 'தமிழ்')
    const sh = fontShorthandWithList(f, list)
    expect(sh.startsWith('italic bold 48px ')).toBe(true)
    expect(sh).toContain('"Noto Sans Tamil"')
  })
})

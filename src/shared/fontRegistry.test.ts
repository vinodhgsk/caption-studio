import { describe, it, expect } from 'vitest'
import {
  fontRegistry,
  createFontRegistry,
  BUNDLED_FONTS,
  ALL_CATEGORIES,
  DEFAULT_FONT_FAMILY,
  defaultFallbackChain,
  resolveFallbackChain,
  buildPreviewSpec,
  previewTextFor,
  cssFamilyList,
  GENERIC_SANS,
  resolveFontForText,
  type FontEntry,
  type SystemFontEnumerator
} from './fontRegistry'
import { DEFAULT_CAPTION_FONT_FAMILY, DEFAULT_CAPTION_FONT_FALLBACK } from './captionPreset'

const families = () => BUNDLED_FONTS.map((f) => f.family)

describe('bundled catalog — Indic-capable defaults + Latin', () => {
  it('includes an Indic-capable default for every required script', () => {
    const has = (script: string) => BUNDLED_FONTS.some((f) => f.scripts[0] === script)
    expect(has('tamil')).toBe(true)
    expect(has('telugu')).toBe(true)
    expect(has('malayalam')).toBe(true)
    expect(has('kannada')).toBe(true)
    expect(has('devanagari')).toBe(true)
    expect(has('latin')).toBe(true)
  })

  it('ships the named Indic + Latin families', () => {
    for (const fam of [
      'Noto Sans Tamil',
      'Noto Sans Telugu',
      'Noto Sans Malayalam',
      'Noto Sans Kannada',
      'Noto Sans Devanagari',
      'Inter'
    ]) {
      expect(families(), `catalog should contain ${fam}`).toContain(fam)
    }
  })

  it('every entry has a non-empty scripts list, weights, and a category', () => {
    for (const f of BUNDLED_FONTS) {
      expect(f.scripts.length, f.family).toBeGreaterThan(0)
      expect(f.weights.length, f.family).toBeGreaterThan(0)
      expect(ALL_CATEGORIES).toContain(f.category)
    }
  })

  it('spans all categories (sans/serif/script/decorative/cinematic)', () => {
    const cats = new Set(BUNDLED_FONTS.map((f) => f.category))
    for (const c of ALL_CATEGORIES) expect(cats.has(c), `missing category ${c}`).toBe(true)
  })
})

describe('global default family is Tamil-capable + consistent with caption default', () => {
  it('DEFAULT_FONT_FAMILY renders Tamil', () => {
    const entry = fontRegistry.getFont(DEFAULT_FONT_FAMILY)
    expect(entry, 'default family must be in the catalog').toBeDefined()
    expect(entry!.scripts).toContain('tamil')
    expect(DEFAULT_FONT_FAMILY.toLowerCase()).toContain('tamil')
  })

  it('captionPreset re-exports the registry default (single source of truth)', () => {
    expect(DEFAULT_CAPTION_FONT_FAMILY).toBe(DEFAULT_FONT_FAMILY)
    expect(DEFAULT_CAPTION_FONT_FALLBACK).toEqual(defaultFallbackChain())
  })

  it('default fallback chain starts Tamil and ends in a Latin fallback + generic', () => {
    const chain = defaultFallbackChain()
    expect(chain[0]).toBe(DEFAULT_FONT_FAMILY)
    expect(chain[chain.length - 1]).toBe(GENERIC_SANS)
    // a real Latin family precedes the generic terminal
    expect(chain).toContain('Inter')
  })
})

describe('listFonts — category filter + search', () => {
  it('lists everything by default', () => {
    expect(fontRegistry.listFonts().length).toBe(BUNDLED_FONTS.length)
  })

  it('filters by category', () => {
    const cinematic = fontRegistry.listFonts({ category: 'cinematic' })
    expect(cinematic.length).toBeGreaterThan(0)
    expect(cinematic.every((f) => f.category === 'cinematic')).toBe(true)
  })

  it('searches by case-insensitive substring over family/displayName', () => {
    const noto = fontRegistry.listFonts({ query: 'noto' })
    expect(noto.length).toBeGreaterThan(0)
    expect(noto.every((f) => f.family.toLowerCase().includes('noto'))).toBe(true)

    const tamil = fontRegistry.listFonts({ query: 'TAMIL' })
    expect(tamil.some((f) => f.family === 'Noto Sans Tamil')).toBe(true)
  })

  it('filters by script coverage', () => {
    const tamilFonts = fontRegistry.listFonts({ script: 'tamil' })
    expect(tamilFonts.length).toBeGreaterThan(0)
    expect(tamilFonts.every((f) => f.scripts.includes('tamil'))).toBe(true)
  })

  it('combines category + query', () => {
    const r = fontRegistry.listFonts({ category: 'serif', query: 'noto' })
    expect(r.every((f) => f.category === 'serif' && f.family.toLowerCase().includes('noto'))).toBe(
      true
    )
  })

  it('returns copies — mutating a result does not corrupt the catalog', () => {
    const r = fontRegistry.listFonts()[0]
    r.scripts.push('latin')
    r.family = 'mutated'
    expect(fontRegistry.listFonts()[0].family).toBe(BUNDLED_FONTS[0].family)
  })
})

describe('resolveFallbackChain — per-script, ends in Latin', () => {
  const endsInLatin = (chain: string[]) => {
    expect(chain[chain.length - 1]).toBe(GENERIC_SANS)
    // the second-to-last (or earlier) is a real Latin family from the catalog
    const latinFamilies = BUNDLED_FONTS.filter((f) => f.scripts[0] === 'latin').map((f) => f.family)
    expect(chain.some((c) => latinFamilies.includes(c))).toBe(true)
  }

  it('Tamil text → Tamil primary, other Tamil fonts, then Latin', () => {
    const chain = resolveFallbackChain('Noto Sans Tamil', 'வணக்கம் தமிழ்')
    expect(chain[0]).toBe('Noto Sans Tamil')
    // another Tamil-home family appears before the Latin tail
    const tamilIdx = chain.indexOf('Catamaran')
    const interIdx = chain.indexOf('Inter')
    expect(tamilIdx).toBeGreaterThan(0)
    expect(interIdx).toBeGreaterThan(tamilIdx)
    endsInLatin(chain)
  })

  it('Telugu text resolves a Telugu primary chain', () => {
    const chain = resolveFallbackChain('Noto Sans Telugu', 'నమస్కారం తెలుగు')
    expect(chain[0]).toBe('Noto Sans Telugu')
    expect(chain).toContain('Noto Serif Telugu')
    endsInLatin(chain)
  })

  it('Devanagari text resolves a Devanagari primary chain', () => {
    const chain = resolveFallbackChain('Noto Sans Devanagari', 'नमस्ते हिन्दी')
    expect(chain[0]).toBe('Noto Sans Devanagari')
    expect(chain).toContain('Mukta')
    endsInLatin(chain)
  })

  it('Latin text resolves a Latin primary chain ending in the generic', () => {
    const chain = resolveFallbackChain('Inter', 'The quick brown fox')
    expect(chain[0]).toBe('Inter')
    expect(chain[chain.length - 1]).toBe(GENERIC_SANS)
  })

  it('accepts an explicit Script as well as text', () => {
    const byScript = resolveFallbackChain('Noto Sans Tamil', 'tamil')
    const byText = resolveFallbackChain('Noto Sans Tamil', 'தமிழ்')
    expect(byScript).toEqual(byText)
  })

  it('a primary family not in the catalog is still honored as element 0', () => {
    const chain = resolveFallbackChain('My Imported Tamil Font', 'தமிழ்')
    expect(chain[0]).toBe('My Imported Tamil Font')
    expect(chain).toContain('Noto Sans Tamil')
    endsInLatin(chain)
  })

  it('chain is de-duplicated', () => {
    const chain = resolveFallbackChain('Noto Sans Tamil', 'tamil')
    expect(new Set(chain.map((c) => c.toLowerCase())).size).toBe(chain.length)
  })
})

describe('resolveFontForText — script-correct primary (no tofu), Latin tail', () => {
  const latinFamilies = BUNDLED_FONTS.filter((f) => f.scripts[0] === 'latin').map((f) => f.family)
  const endsInLatinGeneric = (chain: string[]) => {
    expect(chain[chain.length - 1]).toBe(GENERIC_SANS)
    expect(chain.some((c) => latinFamilies.includes(c))).toBe(true)
  }

  it('Tamil text with a Tamil family keeps that family first', () => {
    const chain = resolveFontForText({ family: 'Noto Sans Tamil' }, 'வணக்கம் தமிழ்')
    expect(chain[0]).toBe('Noto Sans Tamil')
    endsInLatinGeneric(chain)
  })

  it('Tamil text with a LATIN-ONLY family demotes it below a Tamil-capable family (no tofu)', () => {
    const chain = resolveFontForText({ family: 'Inter' }, 'வணக்கம் தமிழ்')
    // a Tamil-covering family must lead so the glyphs shape — not Inter.
    const tamilEntry = BUNDLED_FONTS.find((f) => f.scripts[0] === 'tamil')!
    expect(chain[0]).toBe(tamilEntry.family)
    expect(chain).toContain('Inter')
    expect(chain.indexOf(tamilEntry.family)).toBeLessThan(chain.indexOf('Inter'))
    endsInLatinGeneric(chain)
  })

  for (const [script, sample, home] of [
    ['telugu', 'నమస్కారం తెలుగు', 'Noto Sans Telugu'],
    ['malayalam', 'നമസ്കാരം മലയാളം', 'Noto Sans Malayalam'],
    ['kannada', 'ನಮಸ್ಕಾರ ಕನ್ನಡ', 'Noto Sans Kannada'],
    ['devanagari', 'नमस्ते हिन्दी', 'Noto Sans Devanagari']
  ] as const) {
    it(`${script} text resolves a ${script}-capable primary then a Latin tail`, () => {
      // chosen family is the Tamil default (does NOT cover this script) → must be demoted.
      const chain = resolveFontForText({ family: 'Noto Sans Tamil' }, sample)
      expect(chain[0]).toBe(home)
      expect(BUNDLED_FONTS.find((f) => f.family === chain[0])!.scripts).toContain(script)
      endsInLatinGeneric(chain)
    })
  }

  it('Latin text keeps the chosen Latin family first', () => {
    const chain = resolveFontForText({ family: 'Inter' }, 'The quick brown fox')
    expect(chain[0]).toBe('Inter')
    expect(chain[chain.length - 1]).toBe(GENERIC_SANS)
  })

  it('honors a persisted clip fallback chain (text.font.fallback) after the primary', () => {
    const chain = resolveFontForText(
      { family: 'Noto Sans Tamil', fallback: ['Catamaran', 'Inter', 'sans-serif'] },
      'தமிழ்'
    )
    expect(chain[0]).toBe('Noto Sans Tamil')
    expect(chain.indexOf('Catamaran')).toBeGreaterThan(0)
    endsInLatinGeneric(chain)
  })

  it('an unknown (imported) family chosen for its script is trusted to lead', () => {
    const chain = resolveFontForText({ family: 'My Imported Tamil Font' }, 'தமிழ்')
    expect(chain[0]).toBe('My Imported Tamil Font')
    // a known Tamil family still appears as a safety fallback
    expect(chain).toContain('Noto Sans Tamil')
    endsInLatinGeneric(chain)
  })

  it('no chosen family → Indic-first default chain for the run script', () => {
    const chain = resolveFontForText(undefined, 'தமிழ்')
    expect(BUNDLED_FONTS.find((f) => f.family === chain[0])!.scripts).toContain('tamil')
    endsInLatinGeneric(chain)
  })

  it('is de-duplicated', () => {
    const chain = resolveFontForText({ family: 'Inter', fallback: ['Inter', 'inter'] }, 'tamil')
    expect(new Set(chain.map((c) => c.toLowerCase())).size).toBe(chain.length)
  })
})

describe('registerFont — imported families (P6.2 hook)', () => {
  it('appends an imported family and includes it in listing + fallback', () => {
    const reg = createFontRegistry()
    const entry: FontEntry = {
      family: 'Acme Tamil Display',
      displayName: 'Acme Tamil Display',
      category: 'decorative',
      source: 'imported',
      scripts: ['tamil', 'latin'],
      weights: [400, 700],
      styles: ['normal'],
      files: [{ path: 'media/fonts/AcmeTamil-Regular.ttf', weight: 400, italic: false }]
    }
    reg.registerFont(entry)
    expect(reg.hasFont('Acme Tamil Display')).toBe(true)
    expect(reg.listFonts({ query: 'acme' }).length).toBe(1)
    // it now participates in the Tamil fallback chain
    const chain = reg.resolveFallbackChain('Noto Sans Tamil', 'தமிழ்')
    expect(chain).toContain('Acme Tamil Display')
  })

  it('rejects empty family and scriptless entries', () => {
    const reg = createFontRegistry()
    expect(() => reg.registerFont({ ...stub(), family: '' })).toThrow()
    expect(() => reg.registerFont({ ...stub(), scripts: [] })).toThrow()
  })

  it('rejects collision with a bundled family', () => {
    const reg = createFontRegistry()
    expect(() => reg.registerFont({ ...stub(), family: 'Noto Sans Tamil' })).toThrow(/bundled/)
  })

  function stub(): FontEntry {
    return {
      family: 'Stub Font',
      displayName: 'Stub Font',
      category: 'sans',
      source: 'imported',
      scripts: ['latin'],
      weights: [400],
      styles: ['normal']
    }
  }
})

describe('system enumerator — pluggable / stubbed', () => {
  it('default registry has no system fonts (deterministic)', () => {
    expect(fontRegistry.listFonts({ source: 'system' })).toEqual([])
  })

  it('a custom enumerator contributes system entries (de-duped, bundled wins)', () => {
    const enumerator: SystemFontEnumerator = {
      list: () => [
        {
          family: 'Helvetica Neue',
          displayName: 'Helvetica Neue',
          category: 'sans',
          source: 'system',
          scripts: ['latin'],
          weights: [400, 700],
          styles: ['normal', 'italic']
        },
        // collides with a bundled family — bundled must win
        {
          family: 'Inter',
          displayName: 'Inter (system)',
          category: 'sans',
          source: 'system',
          scripts: ['latin'],
          weights: [400],
          styles: ['normal']
        }
      ]
    }
    const reg = createFontRegistry({ system: enumerator })
    expect(reg.hasFont('Helvetica Neue')).toBe(true)
    expect(reg.getFont('Inter')!.source).toBe('bundled')
    expect(reg.listFonts({ source: 'system' }).map((f) => f.family)).toEqual(['Helvetica Neue'])
  })
})

describe('categories() reflects present categories', () => {
  it('returns the categories with at least one font', () => {
    expect(fontRegistry.categories().sort()).toEqual([...ALL_CATEGORIES].sort())
  })
})

describe('preview spec — reuses the family-list logic, Tamil sample by default', () => {
  it('a Tamil family previews the Tamil sample', () => {
    const spec = buildPreviewSpec(fontRegistry.getFont('Noto Sans Tamil')!)
    expect(spec.script).toBe('tamil')
    expect(spec.sampleText).toContain('தமிழ்')
    expect(spec.fontFamilyList).toContain('"Noto Sans Tamil"')
    expect(spec.fontFamilyList).toContain('sans-serif')
  })

  it('a Latin family previews a Latin sample', () => {
    const spec = buildPreviewSpec(fontRegistry.getFont('Inter')!)
    expect(spec.script).toBe('latin')
    expect(spec.sampleText).toBe('The quick brown fox')
  })

  it('previewTextFor honors an explicit previewText', () => {
    const entry: FontEntry = {
      family: 'X',
      displayName: 'X',
      category: 'sans',
      source: 'bundled',
      scripts: ['latin'],
      weights: [400],
      styles: ['normal'],
      previewText: 'CUSTOM'
    }
    expect(previewTextFor(entry)).toBe('CUSTOM')
  })

  it('cssFamilyList quotes space-containing tokens and de-dups', () => {
    expect(cssFamilyList(['Noto Sans Tamil', 'Inter', 'inter', 'sans-serif'])).toBe(
      '"Noto Sans Tamil", Inter, sans-serif'
    )
  })
})

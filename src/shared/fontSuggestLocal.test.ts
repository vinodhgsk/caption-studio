import { describe, it, expect } from 'vitest'
import {
  createFontRegistry,
  fontRegistry,
  BUNDLED_FONTS,
  type FontEntry
} from './fontRegistry'
import {
  createLocalFontSuggestionProvider,
  localFontSuggestionProvider,
  LOCAL_FONT_PROVIDER_ID,
  KEYWORD_RULES
} from './fontSuggestLocal'

/** A provider bound to the shared default (bundled) registry. */
const local = localFontSuggestionProvider

/** Family names of a suggestion list, in rank order. */
const fams = (s: { family: string }[]) => s.map((x) => x.family)

describe('local font-suggestion provider — identity', () => {
  it('exposes the stable local id', () => {
    expect(local.id).toBe(LOCAL_FONT_PROVIDER_ID)
    expect(local.id).toBe('local')
  })
})

describe('keyword → category/script mapping → catalog families', () => {
  it('maps "cinematic title" to cinematic-category catalog families', async () => {
    const out = await local.suggest('cinematic title')
    expect(out.length).toBeGreaterThan(0)
    // Top picks should be cinematic-category bundled families.
    const cinematic = BUNDLED_FONTS.filter((f) => f.category === 'cinematic').map((f) => f.family)
    expect(cinematic).toContain(out[0].family)
    // Bebas Neue / Oswald / Rajdhani are the cinematic picks.
    expect(fams(out).some((f) => cinematic.includes(f))).toBe(true)
  })

  it('maps "handwritten" to script-category families (Dancing Script / Pacifico)', async () => {
    const out = await local.suggest('handwritten note')
    const scriptFams = BUNDLED_FONTS.filter((f) => f.category === 'script').map((f) => f.family)
    expect(scriptFams).toContain(out[0].family)
  })

  it('maps "elegant" to serif families', async () => {
    const out = await local.suggest('elegant wedding invite')
    const serif = BUNDLED_FONTS.filter((f) => f.category === 'serif').map((f) => f.family)
    expect(serif).toContain(out[0].family)
  })

  it('maps "techno" to the condensed cinematic faces', async () => {
    const out = await local.suggest('techno futuristic')
    const cinematic = BUNDLED_FONTS.filter((f) => f.category === 'cinematic').map((f) => f.family)
    expect(cinematic).toContain(out[0].family)
  })

  it('maps "tamil" to a Tamil-capable family first', async () => {
    const out = await local.suggest('tamil')
    const top = fontRegistry.getFont(out[0].family)
    expect(top?.scripts[0]).toBe('tamil')
  })

  it('maps "clean modern" to sans families', async () => {
    const out = await local.suggest('clean modern subtitle')
    const sans = BUNDLED_FONTS.filter((f) => f.category === 'sans').map((f) => f.family)
    expect(sans).toContain(out[0].family)
  })

  it('combines category + script: "bold tamil" prefers a Tamil family in a strong category', async () => {
    const out = await local.suggest('bold tamil')
    const tamilFams = BUNDLED_FONTS.filter((f) => f.scripts.includes('tamil')).map((f) => f.family)
    expect(tamilFams).toContain(out[0].family)
  })
})

describe('suggestions reference only registry families', () => {
  it('every suggested family exists in the registry, for many prompts', async () => {
    const prompts = ['', '   ', 'bold', 'elegant', 'handwritten', 'techno', 'cinematic', 'tamil', 'xyzzy qux']
    for (const p of prompts) {
      const out = await local.suggest(p)
      expect(out.length).toBeGreaterThan(0)
      for (const s of out) {
        expect(fontRegistry.hasFont(s.family)).toBe(true)
      }
    }
  })

  it('never invents a family name outside the catalog', async () => {
    const known = new Set(fontRegistry.allFonts().map((f) => f.family.toLowerCase()))
    const out = await local.suggest('luxury editorial magazine cover')
    for (const s of out) expect(known.has(s.family.toLowerCase())).toBe(true)
  })
})

describe('determinism', () => {
  it('returns identical results for the same prompt + catalog', async () => {
    const a = await local.suggest('bold cinematic tamil')
    const b = await local.suggest('bold cinematic tamil')
    expect(fams(a)).toEqual(fams(b))
    expect(a).toEqual(b)
  })

  it('is stable across repeated calls for a garbage prompt', async () => {
    const a = await local.suggest('!!!')
    const b = await local.suggest('!!!')
    expect(fams(a)).toEqual(fams(b))
  })
})

describe('graceful fallback', () => {
  it('empty prompt still returns a non-empty list', async () => {
    const out = await local.suggest('')
    expect(out.length).toBeGreaterThan(0)
  })

  it('whitespace prompt still returns suggestions', async () => {
    const out = await local.suggest('     ')
    expect(out.length).toBeGreaterThan(0)
  })

  it('garbage / unmatched prompt falls back to sensible Indic-first defaults', async () => {
    const out = await local.suggest('zzzz qqqq wwww')
    expect(out.length).toBeGreaterThan(0)
    // The fallback leads with the Tamil-capable home family (Indic-first default).
    const top = fontRegistry.getFont(out[0].family)
    expect(top?.scripts[0]).toBe('tamil')
  })

  it('respects the limit option', async () => {
    const out = await local.suggest('clean modern', { limit: 2 })
    expect(out.length).toBeLessThanOrEqual(2)
    expect(out.length).toBeGreaterThan(0)
  })

  it('returns empty only for a truly empty catalog', async () => {
    const empty = createLocalFontSuggestionProvider(createFontRegistry({ bundled: [] }))
    const out = await empty.suggest('bold')
    expect(out).toEqual([])
  })
})

describe('suggestion shape', () => {
  it('carries family, label, reason, sample, and a [0,1] score', async () => {
    const out = await local.suggest('cinematic')
    const s = out[0]
    expect(typeof s.family).toBe('string')
    expect(typeof s.label).toBe('string')
    expect(typeof s.reason).toBe('string')
    expect(typeof s.sample).toBe('string')
    expect(s.sample.length).toBeGreaterThan(0)
    expect(s.score).toBeGreaterThanOrEqual(0)
    expect(s.score).toBeLessThanOrEqual(1)
  })

  it('ranks stronger (category+script) matches above weaker ones', async () => {
    const out = await local.suggest('bold tamil')
    // Scores are non-increasing in rank order.
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].score).toBeGreaterThanOrEqual(out[i].score)
    }
  })
})

describe('registry-driven — newly imported fonts become suggestable', () => {
  it('suggests a freshly registered family by its category keyword', async () => {
    const reg = createFontRegistry()
    const custom: FontEntry = {
      family: 'My Brush Script',
      displayName: 'My Brush Script',
      category: 'script',
      source: 'imported',
      scripts: ['latin'],
      weights: [400],
      styles: ['normal']
    }
    reg.registerFont(custom)
    const provider = createLocalFontSuggestionProvider(reg)

    const out = await provider.suggest('handwritten brush')
    expect(fams(out)).toContain('My Brush Script')
  })

  it('suggests a freshly registered Tamil family by the "tamil" keyword', async () => {
    const reg = createFontRegistry()
    reg.registerFont({
      family: 'Acme Tamil Display',
      displayName: 'Acme Tamil Display',
      category: 'cinematic',
      source: 'imported',
      scripts: ['tamil', 'latin'],
      weights: [700],
      styles: ['normal']
    })
    const provider = createLocalFontSuggestionProvider(reg)

    const out = await provider.suggest('bold tamil title')
    expect(fams(out)).toContain('Acme Tamil Display')
  })

  it('a direct family-name mention surfaces that family', async () => {
    const out = await local.suggest('I want Oswald please')
    expect(fams(out)).toContain('Oswald')
    expect(out[0].family).toBe('Oswald')
  })
})

describe('keyword rule table integrity', () => {
  it('every rule declares at least one keyword and a reason', () => {
    for (const rule of KEYWORD_RULES) {
      expect(rule.keywords.length).toBeGreaterThan(0)
      expect(rule.reason.length).toBeGreaterThan(0)
      expect(rule.category !== undefined || rule.script !== undefined).toBe(true)
    }
  })
})

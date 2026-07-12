import { afterEach, describe, expect, it } from 'vitest'
import type { FontSuggestion, FontSuggestionProvider, SuggestOptions } from './fontSuggest'
import {
  DEFAULT_FONT_SUGGEST_PROVIDER_ID,
  FONT_SUGGEST_PROVIDER_ENV,
  getFontSuggestionProvider,
  registerFontSuggestionProvider,
  setActiveFontSuggestionProvider
} from './fontSuggestRegistry'

/** A fake provider that ignores the catalog (only exercises registry wiring). */
class FakeProvider implements FontSuggestionProvider {
  constructor(readonly id: string) {}
  async suggest(_prompt: string, _opts?: SuggestOptions): Promise<FontSuggestion[]> {
    return [{ family: 'Inter', label: 'Inter', reason: 'fake', sample: 'x', score: 1 }]
  }
}

describe('font-suggestion provider registry', () => {
  afterEach(() => {
    setActiveFontSuggestionProvider(null)
    delete process.env[FONT_SUGGEST_PROVIDER_ENV]
  })

  it('resolves the local provider by default', () => {
    setActiveFontSuggestionProvider(null)
    expect(getFontSuggestionProvider().id).toBe(DEFAULT_FONT_SUGGEST_PROVIDER_ID)
    expect(getFontSuggestionProvider().id).toBe('local')
  })

  it('lets a new provider be registered and selected without changing callers', () => {
    registerFontSuggestionProvider(new FakeProvider('cloud'))
    setActiveFontSuggestionProvider('cloud')
    expect(getFontSuggestionProvider().id).toBe('cloud')
  })

  it('honours the env override when no explicit id is set', () => {
    registerFontSuggestionProvider(new FakeProvider('cloud'))
    setActiveFontSuggestionProvider(null)
    process.env[FONT_SUGGEST_PROVIDER_ENV] = 'cloud'
    expect(getFontSuggestionProvider().id).toBe('cloud')
  })

  it('an explicit active id wins over the env override', () => {
    registerFontSuggestionProvider(new FakeProvider('cloud'))
    process.env[FONT_SUGGEST_PROVIDER_ENV] = 'cloud'
    setActiveFontSuggestionProvider('local')
    expect(getFontSuggestionProvider().id).toBe('local')
  })

  it('throws for an unregistered provider id', () => {
    setActiveFontSuggestionProvider('does-not-exist')
    expect(() => getFontSuggestionProvider()).toThrow(/No font-suggestion provider registered/)
  })

  it('the default provider produces only registry families', async () => {
    setActiveFontSuggestionProvider(null)
    const out = await getFontSuggestionProvider().suggest('cinematic tamil')
    expect(out.length).toBeGreaterThan(0)
  })
})

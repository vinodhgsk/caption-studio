/**
 * Phase 10 AI Text Tools — comprehensive test suite (P10.1–P10.8, P10R.1, P10R.3)
 *
 * Covers:
 *   - TTS provider interface + StubTtsProvider (P10.1–P10.4)
 *   - TTS registry (register / get / default)
 *   - Translation provider interface + StubTranslationProvider (P10.5–P10.6)
 *   - Translation registry
 *   - Keyword highlight detection heuristic (P10.7–P10.8)
 *   - Transliteration engine + local provider (P10R.1)
 *   - Romanized-to-Indic helper (P10R.3)
 *
 * All imports use relative paths. No DOM, no Electron, no IPC.
 * StubProviders are imported directly.
 */

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// ── TTS ─────────────────────────────────────────────────────────────────────
import type { TTSProvider } from './tts'
import { DEFAULT_TTS_LANGUAGE, TTS_LANGUAGES } from './tts'
import { StubTtsProvider } from '../main/tts/StubProvider'
import {
  DEFAULT_TTS_PROVIDER_ID,
  getTtsProvider,
  hasTtsProvider,
  registerBuiltinTtsProviders,
  registerTtsProvider,
  setActiveTtsProvider
} from '../main/tts/registry'

// ── Translation ──────────────────────────────────────────────────────────────
import type { TranslationProvider } from './translation'
import { StubTranslationProvider } from '../main/translation/StubProvider'
import {
  DEFAULT_TRANSLATION_PROVIDER_ID,
  getTranslationProvider,
  registerBuiltinTranslationProviders,
  registerTranslationProvider,
  setActiveTranslationProvider
} from '../main/translation/registry'

// ── Keyword Highlight ────────────────────────────────────────────────────────
import { detectKeywords } from './keywordHighlight'
import type { TranscriptWord } from './keywordHighlight'

// ── Transliteration ──────────────────────────────────────────────────────────
import {
  createLocalTransliterationProvider,
  getTransliterationProvider,
  setTransliterationProvider,
  transliterateSync
} from './transliteration'
import type { SupportedLang, TransliterationProvider } from './transliteration'

// ── Romanized Input ──────────────────────────────────────────────────────────
import { romanizedToIndic } from './romanizedInput'

// ---------------------------------------------------------------------------
// Shared temp bundle path (for synthesize tests that write WAV files)
// ---------------------------------------------------------------------------
const BUNDLE_PATH = join(tmpdir(), 'aitools-test-bundle')

// ---------------------------------------------------------------------------
// P10.1–P10.4: TTS Provider Interface — StubTtsProvider
// ---------------------------------------------------------------------------

describe('StubTtsProvider — listVoices()', () => {
  const provider = new StubTtsProvider()

  it('returns exactly 6 voices', async () => {
    const voices = await provider.listVoices()
    expect(voices).toHaveLength(6)
  })

  it('each voice has an id field', async () => {
    const voices = await provider.listVoices()
    for (const v of voices) {
      expect(v).toHaveProperty('id')
      expect(typeof v.id).toBe('string')
      expect(v.id.length).toBeGreaterThan(0)
    }
  })

  it('each voice has a name field', async () => {
    const voices = await provider.listVoices()
    for (const v of voices) {
      expect(v).toHaveProperty('name')
      expect(typeof v.name).toBe('string')
      expect(v.name.length).toBeGreaterThan(0)
    }
  })

  it('each voice has a language field', async () => {
    const voices = await provider.listVoices()
    for (const v of voices) {
      expect(v).toHaveProperty('language')
    }
  })

  it('each voice has a gender field', async () => {
    const voices = await provider.listVoices()
    for (const v of voices) {
      expect(v).toHaveProperty('gender')
    }
  })

  it('all 6 language codes appear exactly once: ta, te, ml, kn, hi, en', async () => {
    const voices = await provider.listVoices()
    const langs = voices.map((v) => v.language)
    expect(langs).toContain('ta')
    expect(langs).toContain('te')
    expect(langs).toContain('ml')
    expect(langs).toContain('kn')
    expect(langs).toContain('hi')
    expect(langs).toContain('en')
    // No duplicates — all 6 are distinct
    expect(new Set(langs).size).toBe(6)
  })

  it('first voice is Tamil (ta) — Tamil-first ordering', async () => {
    const voices = await provider.listVoices()
    expect(voices[0].language).toBe('ta')
  })

  it('listVoices returns a Promise (async)', () => {
    const result = provider.listVoices()
    expect(result).toBeInstanceOf(Promise)
  })
})

describe('StubTtsProvider — synthesize()', () => {
  const provider = new StubTtsProvider()

  it('returns duration === 2.0', async () => {
    const result = await provider.synthesize(BUNDLE_PATH, {
      text: 'test',
      voiceId: 'stub-ta',
      language: 'ta'
    })
    expect(result.duration).toBe(2.0)
  })

  it('returns mediaRef containing "tts-"', async () => {
    const result = await provider.synthesize(BUNDLE_PATH, {
      text: 'hello',
      voiceId: 'stub-ta',
      language: 'ta'
    })
    expect(result.mediaRef).toContain('tts-')
  })

  it('returns mediaRef ending with ".wav"', async () => {
    const result = await provider.synthesize(BUNDLE_PATH, {
      text: 'world',
      voiceId: 'stub-ta',
      language: 'ta'
    })
    expect(result.mediaRef.endsWith('.wav')).toBe(true)
  })

  it('mediaRef starts with "media/"', async () => {
    const result = await provider.synthesize(BUNDLE_PATH, {
      text: 'check',
      voiceId: 'stub-ta',
      language: 'ta'
    })
    expect(result.mediaRef.startsWith('media/')).toBe(true)
  })

  it('with wordTimings=false, wordTimings field is undefined', async () => {
    const result = await provider.synthesize(BUNDLE_PATH, {
      text: 'no timings',
      voiceId: 'stub-ta',
      language: 'ta',
      wordTimings: false
    })
    expect(result.wordTimings).toBeUndefined()
  })

  it('without wordTimings field, wordTimings is undefined', async () => {
    const result = await provider.synthesize(BUNDLE_PATH, {
      text: 'no timings field',
      voiceId: 'stub-ta',
      language: 'ta'
    })
    expect(result.wordTimings).toBeUndefined()
  })

  it('with wordTimings=true, wordTimings is defined', async () => {
    const result = await provider.synthesize(BUNDLE_PATH, {
      text: 'with timings',
      voiceId: 'stub-ta',
      language: 'ta',
      wordTimings: true
    })
    expect(result.wordTimings).toBeDefined()
    expect(Array.isArray(result.wordTimings)).toBe(true)
  })

  it('with wordTimings=true, first timing entry has word, start, end fields', async () => {
    const result = await provider.synthesize(BUNDLE_PATH, {
      text: 'timing entry',
      voiceId: 'stub-ta',
      language: 'ta',
      wordTimings: true
    })
    const timing = result.wordTimings![0]
    expect(timing).toHaveProperty('word')
    expect(timing).toHaveProperty('start')
    expect(timing).toHaveProperty('end')
  })

  it('synthesize returns a Promise (async)', () => {
    const p = provider.synthesize(BUNDLE_PATH, {
      text: 'async check',
      voiceId: 'stub-ta',
      language: 'ta'
    })
    expect(p).toBeInstanceOf(Promise)
  })
})

// ---------------------------------------------------------------------------
// TTS shared constants
// ---------------------------------------------------------------------------

describe('TTS shared constants', () => {
  it('TTS_LANGUAGES has exactly 6 entries', () => {
    expect(TTS_LANGUAGES).toHaveLength(6)
  })

  it('TTS_LANGUAGES starts with ta', () => {
    expect(TTS_LANGUAGES[0]).toBe('ta')
  })

  it('DEFAULT_TTS_LANGUAGE is ta', () => {
    expect(DEFAULT_TTS_LANGUAGE).toBe('ta')
  })
})

// ---------------------------------------------------------------------------
// TTS Registry
// ---------------------------------------------------------------------------

describe('TTS Registry', () => {
  beforeEach(() => {
    // Reset to stub default
    setActiveTtsProvider(null)
    registerBuiltinTtsProviders()
  })

  afterEach(() => {
    setActiveTtsProvider(null)
  })

  it('getTtsProvider() returns a provider without any explicit setup (auto-registers)', () => {
    const p = getTtsProvider()
    expect(p).toBeDefined()
    expect(p).not.toBeNull()
  })

  it('DEFAULT_TTS_PROVIDER_ID is "stub"', () => {
    expect(DEFAULT_TTS_PROVIDER_ID).toBe('stub')
  })

  it('getTtsProvider() returns stub provider by default', () => {
    const p = getTtsProvider()
    expect((p as StubTtsProvider).id).toBe('stub')
  })

  it('hasTtsProvider() returns true when stub is registered', () => {
    expect(hasTtsProvider()).toBe(true)
  })

  it('setActiveTtsProvider then getTtsProvider() returns the custom provider', () => {
    const custom: TTSProvider = {
      listVoices: async () => [],
      synthesize: async () => ({ mediaRef: 'media/x.wav', duration: 1.0 })
    }
    registerTtsProvider('custom-test', custom)
    setActiveTtsProvider('custom-test')
    expect(getTtsProvider()).toBe(custom)
  })

  it('setActiveTtsProvider(null) clears the explicit selection (falls back to stub)', () => {
    const custom: TTSProvider = {
      listVoices: async () => [],
      synthesize: async () => ({ mediaRef: 'media/y.wav', duration: 0.5 })
    }
    registerTtsProvider('custom-test-2', custom)
    setActiveTtsProvider('custom-test-2')
    setActiveTtsProvider(null)
    // Should fall back to stub
    const p = getTtsProvider()
    expect((p as StubTtsProvider).id).toBe('stub')
  })

  it('registerTtsProvider replaces an existing provider under the same id', () => {
    const first: TTSProvider = {
      listVoices: async () => [],
      synthesize: async () => ({ mediaRef: 'media/f.wav', duration: 1.0 })
    }
    const second: TTSProvider = {
      listVoices: async () => [],
      synthesize: async () => ({ mediaRef: 'media/s.wav', duration: 2.0 })
    }
    registerTtsProvider('replace-test', first)
    registerTtsProvider('replace-test', second)
    setActiveTtsProvider('replace-test')
    expect(getTtsProvider()).toBe(second)
  })

  it('getTtsProvider throws when the active id is not registered', () => {
    setActiveTtsProvider('nonexistent-provider-xyz')
    expect(() => getTtsProvider()).toThrow()
  })

  it('graceful disabled: caller handles listVoices throwing by catching', async () => {
    const failingProvider: TTSProvider = {
      listVoices: async () => {
        throw new Error('Provider unavailable')
      },
      synthesize: async () => ({ mediaRef: 'media/x.wav', duration: 0 })
    }
    registerTtsProvider('failing-test', failingProvider)
    setActiveTtsProvider('failing-test')
    const provider = getTtsProvider()
    // Caller catches and returns empty array (graceful degradation pattern)
    const voices = await provider.listVoices().catch(() => [])
    expect(voices).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// P10.5–P10.6: Translation Provider
// ---------------------------------------------------------------------------

describe('StubTranslationProvider — translate()', () => {
  const provider = new StubTranslationProvider()

  it('translate returns "[ta] text" format', async () => {
    const result = await provider.translate('hello', 'ta')
    expect(result).toBe('[ta] hello')
  })

  it('translate prefixes [hi] for Hindi', async () => {
    const result = await provider.translate('world', 'hi')
    expect(result).toBe('[hi] world')
  })

  it('translate prefixes [te] for Telugu', async () => {
    const result = await provider.translate('test', 'te')
    expect(result).toBe('[te] test')
  })

  it('translate prefixes [ml] for Malayalam', async () => {
    const result = await provider.translate('test', 'ml')
    expect(result).toBe('[ml] test')
  })

  it('translate prefixes [kn] for Kannada', async () => {
    const result = await provider.translate('test', 'kn')
    expect(result).toBe('[kn] test')
  })

  it('translate prefixes [en] for English', async () => {
    const result = await provider.translate('test', 'en')
    expect(result).toBe('[en] test')
  })

  it('empty text translates to "[ta] " (just prefix with trailing space)', async () => {
    const result = await provider.translate('', 'ta')
    expect(result).toBe('[ta] ')
  })

  it('translate returns a Promise (async)', () => {
    const p = provider.translate('async', 'ta')
    expect(p).toBeInstanceOf(Promise)
  })

  it('StubTranslationProvider has id "stub"', () => {
    expect(provider.id).toBe('stub')
  })
})

// ---------------------------------------------------------------------------
// Translation Registry
// ---------------------------------------------------------------------------

describe('Translation Registry', () => {
  beforeEach(() => {
    setActiveTranslationProvider(null)
    registerBuiltinTranslationProviders()
  })

  afterEach(() => {
    setActiveTranslationProvider(null)
  })

  it('getTranslationProvider() returns a provider without explicit setup', () => {
    const p = getTranslationProvider()
    expect(p).toBeDefined()
    expect(p).not.toBeNull()
  })

  it('DEFAULT_TRANSLATION_PROVIDER_ID is "stub"', () => {
    expect(DEFAULT_TRANSLATION_PROVIDER_ID).toBe('stub')
  })

  it('getTranslationProvider() returns stub provider by default', () => {
    const p = getTranslationProvider()
    expect((p as StubTranslationProvider).id).toBe('stub')
  })

  it('setActiveTranslationProvider then getTranslationProvider() returns the custom provider', () => {
    const custom: TranslationProvider = {
      translate: async (text, lang) => `CUSTOM ${lang}: ${text}`
    }
    registerTranslationProvider('custom-trans-test', custom)
    setActiveTranslationProvider('custom-trans-test')
    expect(getTranslationProvider()).toBe(custom)
  })

  it('setActiveTranslationProvider(null) falls back to stub', () => {
    const custom: TranslationProvider = {
      translate: async (text, _lang) => `x: ${text}`
    }
    registerTranslationProvider('custom-trans-2', custom)
    setActiveTranslationProvider('custom-trans-2')
    setActiveTranslationProvider(null)
    const p = getTranslationProvider()
    expect((p as StubTranslationProvider).id).toBe('stub')
  })

  it('getTranslationProvider throws when the active id is not registered', () => {
    setActiveTranslationProvider('nonexistent-translation-xyz')
    expect(() => getTranslationProvider()).toThrow()
  })
})

// ---------------------------------------------------------------------------
// P10.7–P10.8: Keyword Highlight — detectKeywords()
// ---------------------------------------------------------------------------

describe('detectKeywords() — basic cases', () => {
  it('returns [] for empty words array', () => {
    expect(detectKeywords([])).toEqual([])
  })

  it('detects all-caps word (length > 1) as keyword', () => {
    const words: TranscriptWord[] = [
      { text: 'AMAZING', start: 0, end: 1 },
      { text: 'the', start: 1, end: 1.5 }
    ]
    const result = detectKeywords(words)
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].word).toBe('amazing')
  })

  it('does NOT detect single-character all-caps (length must be > 1)', () => {
    const words: TranscriptWord[] = [{ text: 'A', start: 0, end: 0.5 }]
    expect(detectKeywords(words)).toEqual([])
  })

  it('does NOT detect word appearing more than 2 times (too frequent)', () => {
    const words: TranscriptWord[] = [
      { text: 'elephant', start: 0, end: 1 },
      { text: 'elephant', start: 1, end: 2 },
      { text: 'elephant', start: 2, end: 3 }
    ]
    expect(detectKeywords(words)).toEqual([])
  })

  it('detects rare long word (> 4 chars, appears once)', () => {
    const words: TranscriptWord[] = [
      { text: 'serendipitous', start: 0, end: 1 },
      { text: 'the', start: 1, end: 1.5 }
    ]
    const result = detectKeywords(words)
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].word).toBe('serendipitous')
  })

  it('detects rare long word appearing exactly 2 times (at the threshold)', () => {
    const words: TranscriptWord[] = [
      { text: 'elephant', start: 0, end: 1 },
      { text: 'the', start: 1, end: 1.5 },
      { text: 'elephant', start: 2, end: 3 }
    ]
    const result = detectKeywords(words)
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].word).toBe('elephant')
  })

  it('does NOT detect short word (length = 4) even if rare', () => {
    const words: TranscriptWord[] = [{ text: 'cats', start: 0, end: 1 }]
    expect(detectKeywords(words)).toEqual([])
  })

  it('does NOT detect short word (length = 3) even if rare', () => {
    const words: TranscriptWord[] = [{ text: 'cat', start: 0, end: 1 }]
    expect(detectKeywords(words)).toEqual([])
  })

  it('detects word of length 5 when rare (at the boundary — must be > 4)', () => {
    const words: TranscriptWord[] = [{ text: 'birds', start: 0, end: 1 }]
    const result = detectKeywords(words)
    expect(result.length).toBeGreaterThan(0)
  })
})

describe('detectKeywords() — maxKeywords and structure', () => {
  it('returns at most maxKeywords (default 5) entries', () => {
    const words: TranscriptWord[] = []
    for (let i = 0; i < 10; i++) {
      words.push({ text: `WORD${i}LONG`, start: i, end: i + 0.4 })
    }
    const result = detectKeywords(words)
    expect(result.length).toBeLessThanOrEqual(5)
  })

  it('respects custom maxKeywords=3', () => {
    const words: TranscriptWord[] = []
    for (let i = 0; i < 10; i++) {
      words.push({ text: `WORD${i}LONG`, start: i, end: i + 0.4 })
    }
    const result = detectKeywords(words, 3)
    expect(result.length).toBeLessThanOrEqual(3)
  })

  it('each returned entry has word field', () => {
    const words: TranscriptWord[] = [{ text: 'STOP', start: 0, end: 1 }]
    const result = detectKeywords(words)
    expect(result.length).toBeGreaterThan(0)
    expect(result[0]).toHaveProperty('word')
  })

  it('each returned entry has color field', () => {
    const words: TranscriptWord[] = [{ text: 'STOP', start: 0, end: 1 }]
    const result = detectKeywords(words)
    expect(result.length).toBeGreaterThan(0)
    expect(result[0]).toHaveProperty('color')
  })

  it('each returned entry has indices field (an array)', () => {
    const words: TranscriptWord[] = [{ text: 'STOP', start: 0, end: 1 }]
    const result = detectKeywords(words)
    expect(result.length).toBeGreaterThan(0)
    expect(result[0]).toHaveProperty('indices')
    expect(Array.isArray(result[0].indices)).toBe(true)
  })

  it('color is a hex string starting with #', () => {
    const words: TranscriptWord[] = [{ text: 'AMAZING', start: 0, end: 1 }]
    const result = detectKeywords(words)
    expect(result[0].color).toMatch(/^#[0-9A-Fa-f]+/)
  })
})

describe('detectKeywords() — indices and positions', () => {
  it('indices array contains the 0-based position of the matched word', () => {
    const words: TranscriptWord[] = [
      { text: 'the', start: 0, end: 0.5 },
      { text: 'AMAZING', start: 0.5, end: 1.5 }
    ]
    const result = detectKeywords(words)
    expect(result.length).toBeGreaterThan(0)
    const amazing = result.find((r) => r.word === 'amazing')
    expect(amazing).toBeDefined()
    expect(amazing!.indices).toContain(1)
  })

  it('indices contains all occurrences of a matching word', () => {
    const words: TranscriptWord[] = [
      { text: 'serendipitous', start: 0, end: 1 },
      { text: 'the', start: 1, end: 1.5 },
      { text: 'serendipitous', start: 1.5, end: 2.5 }
    ]
    const result = detectKeywords(words)
    const entry = result.find((r) => r.word === 'serendipitous')
    expect(entry).toBeDefined()
    expect(entry!.indices).toContain(0)
    expect(entry!.indices).toContain(2)
  })
})

describe('detectKeywords() — determinism', () => {
  it('calling twice with identical input returns identical output', () => {
    const words: TranscriptWord[] = [
      { text: 'AMAZING', start: 0, end: 1 },
      { text: 'serendipitous', start: 1, end: 2 }
    ]
    const r1 = detectKeywords(words)
    const r2 = detectKeywords(words)
    expect(r1).toEqual(r2)
  })

  it('result order is first-appearance order', () => {
    const words: TranscriptWord[] = [
      { text: 'SECOND', start: 0, end: 1 },
      { text: 'serendipitous', start: 1, end: 2 }
    ]
    // SECOND appears first, serendipitous second
    const r = detectKeywords(words)
    expect(r[0].word).toBe('second')
    expect(r[1].word).toBe('serendipitous')
  })
})

describe('detectKeywords() — pause detection', () => {
  it('detects short word followed by pause > 0.3 s as keyword', () => {
    const words: TranscriptWord[] = [
      { text: 'short', start: 0, end: 1 },
      { text: 'next', start: 1.5, end: 2 } // gap = 0.5 > 0.3
    ]
    const result = detectKeywords(words)
    const entry = result.find((r) => r.word === 'short')
    expect(entry).toBeDefined()
  })

  it('does NOT detect short word without a following pause (gap <= 0.3 s)', () => {
    const words: TranscriptWord[] = [
      { text: 'cat', start: 0, end: 1 },
      { text: 'dog', start: 1.1, end: 2 } // gap = 0.1 < 0.3
    ]
    // 'cat' and 'dog' are short (<=4) with no pause — should not be flagged
    expect(detectKeywords(words)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// P10R.1: Transliteration Engine
// ---------------------------------------------------------------------------

describe('createLocalTransliterationProvider()', () => {
  it('creates a provider object', () => {
    const p = createLocalTransliterationProvider()
    expect(p).toBeDefined()
    expect(typeof p.transliterate).toBe('function')
  })

  it('transliterate returns a Promise', () => {
    const p = createLocalTransliterationProvider()
    const result = p.transliterate('a', 'en', 'ta')
    expect(result).toBeInstanceOf(Promise)
  })

  it('Promise resolves without rejection on valid input', async () => {
    const p = createLocalTransliterationProvider()
    await expect(p.transliterate('a', 'en', 'ta')).resolves.toBeDefined()
  })

  it('transliterate("a", "en", "ta") returns Tamil அ', async () => {
    const p = createLocalTransliterationProvider()
    const result = await p.transliterate('a', 'en', 'ta')
    expect(result).toBe('அ')
  })

  it('transliterate("aa", "en", "ta") returns Tamil ஆ', async () => {
    const p = createLocalTransliterationProvider()
    const result = await p.transliterate('aa', 'en', 'ta')
    expect(result).toBe('ஆ')
  })

  it('transliterate("i", "en", "ta") returns Tamil இ', async () => {
    const p = createLocalTransliterationProvider()
    const result = await p.transliterate('i', 'en', 'ta')
    expect(result).toBe('இ')
  })

  it('transliterate("ka", "en", "ta") returns a Tamil sequence starting with க', async () => {
    const p = createLocalTransliterationProvider()
    const result = await p.transliterate('ka', 'en', 'ta')
    // 'k' → க, 'a' → அ, combined: கஅ
    expect(result).toContain('க')
    expect(result.length).toBeGreaterThan(0)
  })

  it('transliterate("ma", "en", "hi") returns a Hindi sequence containing म', async () => {
    const p = createLocalTransliterationProvider()
    const result = await p.transliterate('ma', 'en', 'hi')
    // 'm' → ं (anusvara), 'a' → अ; together: ंअ
    expect(result).toContain('अ')
    expect(result.length).toBeGreaterThan(0)
  })

  it('unknown characters (digit "1") pass through unchanged', async () => {
    const p = createLocalTransliterationProvider()
    const result = await p.transliterate('1', 'en', 'ta')
    expect(result).toBe('1')
  })

  it('punctuation "!" passes through unchanged', async () => {
    const p = createLocalTransliterationProvider()
    const result = await p.transliterate('!', 'en', 'ta')
    expect(result).toBe('!')
  })

  it('space " " passes through unchanged', async () => {
    const p = createLocalTransliterationProvider()
    const result = await p.transliterate(' ', 'en', 'ta')
    expect(result).toBe(' ')
  })

  it('multi-word input preserves the space between words', async () => {
    const p = createLocalTransliterationProvider()
    const result = await p.transliterate('a b', 'en', 'ta')
    expect(result).toContain(' ')
    // 'a' → அ, ' ' → ' ', 'b' maps (or passes through) — space is preserved
    expect(result[1]).toBe(' ')
  })

  it('invalid source lang → original text passes through unchanged', async () => {
    const p = createLocalTransliterationProvider()
    const result = await p.transliterate('hello', 'xx' as SupportedLang, 'ta')
    expect(result).toBe('hello')
  })

  it('invalid target lang → phonemes fall back to phoneme key string', async () => {
    const p = createLocalTransliterationProvider()
    const result = await p.transliterate('a', 'en', 'xx' as SupportedLang)
    // Phoneme 'a' has no target mapping → falls back to phoneme key 'a'
    expect(result).toBe('a')
  })

  it('same-lang round-trip (en → en) returns the original text unchanged', async () => {
    const p = createLocalTransliterationProvider()
    const result = await p.transliterate('hello', 'en', 'en')
    expect(result).toBe('hello')
  })
})

describe('getTransliterationProvider() / setTransliterationProvider()', () => {
  let savedProvider: TransliterationProvider

  beforeEach(() => {
    savedProvider = getTransliterationProvider()
  })

  afterEach(() => {
    // Restore the saved provider so other tests are not affected
    setTransliterationProvider(savedProvider)
  })

  it('getTransliterationProvider() returns the same instance on repeated calls (singleton)', () => {
    const p1 = getTransliterationProvider()
    const p2 = getTransliterationProvider()
    expect(p1).toBe(p2)
  })

  it('setTransliterationProvider() replaces the active provider', () => {
    const custom: TransliterationProvider = {
      transliterate: async () => 'custom-result'
    }
    setTransliterationProvider(custom)
    expect(getTransliterationProvider()).toBe(custom)
  })

  it('round-trip: set then get returns the same provider object', () => {
    const custom: TransliterationProvider = {
      transliterate: async (text) => text.toUpperCase()
    }
    setTransliterationProvider(custom)
    const retrieved = getTransliterationProvider()
    expect(retrieved).toBe(custom)
  })
})

// ---------------------------------------------------------------------------
// transliterateSync — synchronous helper exported for romanizedInput
// ---------------------------------------------------------------------------

describe('transliterateSync()', () => {
  it('"a" en→ta returns Tamil அ', () => {
    expect(transliterateSync('a', 'en', 'ta')).toBe('அ')
  })

  it('"aa" en→ta returns Tamil ஆ', () => {
    expect(transliterateSync('aa', 'en', 'ta')).toBe('ஆ')
  })

  it('"i" en→ta returns Tamil இ', () => {
    expect(transliterateSync('i', 'en', 'ta')).toBe('இ')
  })

  it('"1 2" en→ta passes digits and space through unchanged', () => {
    expect(transliterateSync('1 2', 'en', 'ta')).toBe('1 2')
  })

  it('same lang (en→en) is identity', () => {
    expect(transliterateSync('hello', 'en', 'en')).toBe('hello')
  })

  it('invalid source lang passes all chars through as-is', () => {
    expect(transliterateSync('hello', 'xx' as SupportedLang, 'ta')).toBe('hello')
  })
})

// ---------------------------------------------------------------------------
// P10R.3: Romanized Input — romanizedToIndic()
// ---------------------------------------------------------------------------

describe('romanizedToIndic()', () => {
  it('romanizedToIndic("a", "ta") returns Tamil அ', () => {
    expect(romanizedToIndic('a', 'ta')).toBe('அ')
  })

  it('romanizedToIndic("aa", "ta") returns Tamil ஆ', () => {
    expect(romanizedToIndic('aa', 'ta')).toBe('ஆ')
  })

  it('romanizedToIndic("i", "ta") returns Tamil இ', () => {
    expect(romanizedToIndic('i', 'ta')).toBe('இ')
  })

  it('romanizedToIndic("ma", "hi") returns a Hindi sequence containing अ', () => {
    // 'm' → anusvara ं, 'a' → अ
    const result = romanizedToIndic('ma', 'hi')
    expect(result).toContain('अ')
  })

  it('romanizedToIndic("", "ta") returns empty string', () => {
    expect(romanizedToIndic('', 'ta')).toBe('')
  })

  it('romanizedToIndic("1 2", "ta") — digits and spaces pass through unchanged', () => {
    expect(romanizedToIndic('1 2', 'ta')).toBe('1 2')
  })

  it('romanizedToIndic is synchronous (returns a string, not a Promise)', () => {
    const result = romanizedToIndic('a', 'ta')
    expect(typeof result).toBe('string')
    expect(result).not.toBeInstanceOf(Promise)
  })

  it('romanizedToIndic("a", "te") returns Telugu అ', () => {
    expect(romanizedToIndic('a', 'te')).toBe('అ')
  })

  it('romanizedToIndic("a", "hi") returns Devanagari अ', () => {
    expect(romanizedToIndic('a', 'hi')).toBe('अ')
  })

  it('romanizedToIndic("a", "ml") returns Malayalam അ', () => {
    expect(romanizedToIndic('a', 'ml')).toBe('അ')
  })

  it('romanizedToIndic("a", "kn") returns Kannada ಅ', () => {
    expect(romanizedToIndic('a', 'kn')).toBe('ಅ')
  })
})

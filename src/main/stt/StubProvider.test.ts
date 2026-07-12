import { describe, expect, it } from 'vitest'
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from '../../shared/stt'
import { StubSttProvider } from './StubProvider'

describe('StubSttProvider', () => {
  const provider = new StubSttProvider()

  it('exposes the stub id for the registry', () => {
    expect(provider.id).toBe('stub')
  })

  it('returns a Transcript with no words and the Tamil fallback when no language is pinned', async () => {
    const result = await provider.transcribe('/bundle.vproj', 'cache/voice.16k.mono.wav')
    expect(result).toEqual({ language: DEFAULT_LANGUAGE, words: [] })
    expect(result.language).toBe('ta')
  })

  it('echoes a pinned language', async () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      const result = await provider.transcribe('/b.vproj', 'cache/x.wav', { language: lang })
      expect(result.language).toBe(lang)
      expect(result.words).toEqual([])
    }
  })

  it('is deterministic — same input yields the same result', async () => {
    const a = await provider.transcribe('/b.vproj', 'cache/x.wav', { language: 'te' })
    const b = await provider.transcribe('/b.vproj', 'cache/x.wav', { language: 'te' })
    expect(a).toEqual(b)
  })
})

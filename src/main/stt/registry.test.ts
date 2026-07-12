import { afterEach, describe, expect, it } from 'vitest'
import type { SttProvider, Transcript } from '../../shared/stt'
import {
  DEFAULT_STT_PROVIDER_ID,
  getSttProvider,
  registerSttProvider,
  selectDefaultProvider,
  setActiveSttProvider
} from './registry'

/** A fake provider used to exercise registration + active-selection. */
class FakeProvider implements SttProvider {
  constructor(readonly id: string) {}
  async transcribe(): Promise<Transcript> {
    return { language: 'en', words: [{ text: 'hi', start: 0, end: 0.1 }] }
  }
}

describe('STT provider registry', () => {
  afterEach(() => {
    // Reset selection so tests don't leak the active id into one another.
    setActiveSttProvider(null)
    delete process.env.CAPTION_STUDIO_STT_PROVIDER
  })

  it('resolves the stub provider by default', () => {
    setActiveSttProvider(null)
    expect(getSttProvider().id).toBe(DEFAULT_STT_PROVIDER_ID)
    expect(getSttProvider().id).toBe('stub')
  })

  it('lets a new provider be registered and selected without changing callers', () => {
    registerSttProvider(new FakeProvider('whisper'))
    setActiveSttProvider('whisper')
    expect(getSttProvider().id).toBe('whisper')
  })

  it('honours the CAPTION_STUDIO_STT_PROVIDER env override when no explicit id is set', () => {
    registerSttProvider(new FakeProvider('cloud'))
    setActiveSttProvider(null) // no explicit selection → env var decides
    process.env.CAPTION_STUDIO_STT_PROVIDER = 'cloud'
    expect(getSttProvider().id).toBe('cloud')
  })

  it('an explicit active id wins over the env override', () => {
    registerSttProvider(new FakeProvider('cloud'))
    process.env.CAPTION_STUDIO_STT_PROVIDER = 'cloud'
    setActiveSttProvider('whisper')
    expect(getSttProvider().id).toBe('whisper')
  })

  it('throws for an unregistered provider id', () => {
    setActiveSttProvider('does-not-exist')
    expect(() => getSttProvider()).toThrow(/No STT provider registered/)
  })

  it('has whisper registered as a built-in (selectable)', () => {
    setActiveSttProvider('whisper')
    expect(getSttProvider().id).toBe('whisper')
  })

  it('selectDefaultProvider falls back to the stub when whisper is unavailable', () => {
    setActiveSttProvider(null)
    delete process.env.CAPTION_STUDIO_STT_PROVIDER
    process.env.CAPTION_STUDIO_WHISPER_BIN = '/nope/whisper-cli'
    process.env.CAPTION_STUDIO_WHISPER_MODEL = '/nope/ggml-base.bin'
    expect(selectDefaultProvider()).toBe('stub')
    expect(getSttProvider().id).toBe('stub')
    delete process.env.CAPTION_STUDIO_WHISPER_BIN
    delete process.env.CAPTION_STUDIO_WHISPER_MODEL
  })

  it('selectDefaultProvider honours the CAPTION_STUDIO_STT_PROVIDER env override', () => {
    setActiveSttProvider(null)
    process.env.CAPTION_STUDIO_STT_PROVIDER = 'stub'
    expect(selectDefaultProvider()).toBe('stub')
  })
})

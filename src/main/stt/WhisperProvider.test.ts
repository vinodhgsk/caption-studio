/**
 * Unit tests for the whisper.cpp provider (P4.5) — the PURE arg-builder and the
 * PURE JSON parser, exercised against a realistic `--output-json-full` fixture.
 * The actual binary is NEVER spawned here (parser takes a parsed object; the
 * arg-builder is pure), so these run offline in CI.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SUPPORTED_LANGUAGES } from '../../shared/stt'
import {
  WHISPER_PROVIDER_ID,
  buildWhisperArgs,
  isWhisperAvailable,
  parseWhisperJson,
  whisperBin,
  whisperJsonPath,
  whisperModel
} from './WhisperProvider'

const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'whisper.output.ta.json'), 'utf8')
) as unknown

describe('buildWhisperArgs (pure)', () => {
  it('builds word-level + json-full args with language auto-detect by default', () => {
    expect(buildWhisperArgs('/m/ggml-base.bin', '/c/voice.16k.mono.wav', '/c/whisper')).toEqual([
      '--model',
      '/m/ggml-base.bin',
      '--file',
      '/c/voice.16k.mono.wav',
      '--language',
      'auto',
      '--max-len',
      '1',
      '--output-json-full',
      '--output-file',
      '/c/whisper'
    ])
  })

  it('pins the language when provided (skips auto-detect)', () => {
    const args = buildWhisperArgs('/m/m.bin', '/c/x.wav', '/c/whisper', 'ta')
    const i = args.indexOf('--language')
    expect(args[i + 1]).toBe('ta')
  })

  it('requests one word per segment (--max-len 1) for word-level timestamps', () => {
    const args = buildWhisperArgs('/m/m.bin', '/c/x.wav', '/c/whisper')
    const i = args.indexOf('--max-len')
    expect(args[i + 1]).toBe('1')
  })
})

describe('whisperJsonPath (pure)', () => {
  it('appends .json to the output prefix', () => {
    expect(whisperJsonPath('/c/whisper')).toBe('/c/whisper.json')
  })
})

describe('parseWhisperJson (pure)', () => {
  it('parses the detected language and per-word start/end in seconds', () => {
    const t = parseWhisperJson(FIXTURE)
    expect(t.language).toBe('ta')
    expect(t.words).toEqual([
      { text: 'வணக்கம்', start: 0, end: 0.42 },
      { text: 'உலகம்', start: 0.42, end: 0.98 },
      // whitespace-only segment is dropped; this word falls back to token offsets.
      { text: 'நன்றி', start: 1.5, end: 2.1 }
    ])
  })

  it('clamps the detected language to the supported set, falling back to Tamil', () => {
    const t = parseWhisperJson({ result: { language: 'fr' }, transcription: [] })
    expect(t.language).toBe('ta')
    expect(SUPPORTED_LANGUAGES).toContain(t.language)
  })

  it('honours a pinned language over the detected one', () => {
    const t = parseWhisperJson(FIXTURE, 'hi')
    expect(t.language).toBe('hi')
  })

  it('is robust to a missing/garbage document (no throw, Tamil fallback, no words)', () => {
    expect(parseWhisperJson(null)).toEqual({ language: 'ta', words: [] })
    expect(parseWhisperJson({})).toEqual({ language: 'ta', words: [] })
    expect(parseWhisperJson({ transcription: 'nope' })).toEqual({ language: 'ta', words: [] })
  })

  it('keeps words in timeline order with start <= end', () => {
    const t = parseWhisperJson(FIXTURE)
    for (const w of t.words) expect(w.start).toBeLessThanOrEqual(w.end)
    for (let i = 1; i < t.words.length; i++) {
      expect(t.words[i].start).toBeGreaterThanOrEqual(t.words[i - 1].start)
    }
  })
})

describe('env overrides + availability', () => {
  afterEach(() => {
    delete process.env.CAPTION_STUDIO_WHISPER_BIN
    delete process.env.CAPTION_STUDIO_WHISPER_MODEL
  })

  it('exposes the whisper provider id', () => {
    expect(WHISPER_PROVIDER_ID).toBe('whisper')
  })

  it('reads the binary + model from env overrides', () => {
    process.env.CAPTION_STUDIO_WHISPER_BIN = '/opt/whisper-cli'
    process.env.CAPTION_STUDIO_WHISPER_MODEL = '/opt/ggml-small.bin'
    expect(whisperBin()).toBe('/opt/whisper-cli')
    expect(whisperModel()).toBe('/opt/ggml-small.bin')
  })

  it('defaults the binary + model when no env override is set', () => {
    expect(whisperBin()).toBe('whisper-cli')
    expect(whisperModel()).toBe('models/ggml-base.bin')
  })

  it('reports unavailable when the model file does not exist (graceful fallback)', () => {
    process.env.CAPTION_STUDIO_WHISPER_BIN = '/nope/whisper-cli'
    process.env.CAPTION_STUDIO_WHISPER_MODEL = '/nope/ggml-base.bin'
    expect(isWhisperAvailable()).toBe(false)
  })
})

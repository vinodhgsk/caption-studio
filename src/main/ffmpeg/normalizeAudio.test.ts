import { describe, expect, it } from 'vitest'
import {
  STT_CHANNELS,
  STT_SAMPLE_RATE,
  buildNormalizeArgs,
  isWavFresh,
  normalizedWavName
} from './normalizeAudio'

describe('normalizedWavName', () => {
  it('derives a 16k mono WAV name from the source file name', () => {
    expect(normalizedWavName('voice.mp3')).toBe('voice.16k.mono.wav')
    expect(normalizedWavName('My Clip.WAV')).toBe('My Clip.16k.mono.wav')
  })

  it('strips any leading directory in the ref', () => {
    expect(normalizedWavName('media/take 2.mp3')).toBe('take 2.16k.mono.wav')
  })

  it('handles a name without an extension', () => {
    expect(normalizedWavName('noext')).toBe('noext.16k.mono.wav')
  })
})

describe('buildNormalizeArgs', () => {
  it('produces the 16 kHz mono WAV ffmpeg argument vector', () => {
    expect(buildNormalizeArgs('/in/voice.mp3', '/out/voice.16k.mono.wav')).toEqual([
      '-y',
      '-i',
      '/in/voice.mp3',
      '-ac',
      String(STT_CHANNELS),
      '-ar',
      String(STT_SAMPLE_RATE),
      '/out/voice.16k.mono.wav'
    ])
  })

  it('targets 16000 Hz mono (STT input shape — Doc 02)', () => {
    expect(STT_SAMPLE_RATE).toBe(16000)
    expect(STT_CHANNELS).toBe(1)
  })
})

describe('isWavFresh (idempotency)', () => {
  it('re-encodes when the cached WAV is absent', () => {
    expect(isWavFresh(100, null)).toBe(false)
  })

  it('reuses the cache when the WAV is newer than the source', () => {
    expect(isWavFresh(100, 200)).toBe(true)
  })

  it('reuses the cache when the WAV is exactly as new as the source', () => {
    expect(isWavFresh(100, 100)).toBe(true)
  })

  it('re-encodes when the source is newer than the cached WAV', () => {
    expect(isWavFresh(200, 100)).toBe(false)
  })

  it('re-encodes when the source mtime cannot be read', () => {
    expect(isWavFresh(null, 200)).toBe(false)
  })
})

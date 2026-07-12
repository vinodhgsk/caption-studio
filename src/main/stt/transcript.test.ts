/**
 * Unit tests for the PURE transcript-persistence helpers (P4.5): the canonical
 * cache ref, the transcript.json write shape, and the `captions.*` update applied
 * to the project model (Doc 00 §4). No fs — these assert the shapes the
 * `stt:transcribe` handler writes.
 */
import { describe, expect, it } from 'vitest'
import type { Project } from '../../shared/storage'
import type { Transcript } from '../../shared/stt'
import {
  TRANSCRIPT_CACHE_REF,
  serializeTranscript,
  toTranscriptDocument,
  withCaptions
} from './transcript'

const TRANSCRIPT: Transcript = {
  language: 'ta',
  words: [
    { text: 'வணக்கம்', start: 0, end: 0.42 },
    { text: 'உலகம்', start: 0.42, end: 0.98 }
  ]
}

function baseProject(): Project {
  return {
    version: 1,
    id: 'p1',
    name: 'p1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    settings: {
      fps: 30,
      resolution: [1920, 1080],
      aspect: '16:9',
      background: '#000000',
      language: 'ta',
      languages: ['ta', 'te', 'ml', 'kn', 'hi', 'en']
    },
    storage: { location: 'local', root: '' },
    tracks: []
  }
}

describe('TRANSCRIPT_CACHE_REF', () => {
  it('is the bundle-relative cache/transcript.json path (Doc 00 §4)', () => {
    expect(TRANSCRIPT_CACHE_REF).toBe('cache/transcript.json')
  })
})

describe('toTranscriptDocument / serializeTranscript', () => {
  it('persists language + words verbatim', () => {
    expect(toTranscriptDocument(TRANSCRIPT)).toEqual({
      language: 'ta',
      words: TRANSCRIPT.words
    })
  })

  it('serializes to pretty JSON with a trailing newline', () => {
    const out = serializeTranscript(TRANSCRIPT)
    expect(out.endsWith('\n')).toBe(true)
    expect(JSON.parse(out)).toEqual({ language: 'ta', words: TRANSCRIPT.words })
  })
})

describe('withCaptions', () => {
  it('sets captions.transcript + captions.language without mutating the input', () => {
    const project = baseProject()
    const updated = withCaptions(project, TRANSCRIPT)
    expect(updated.captions).toEqual({
      transcript: 'cache/transcript.json',
      language: 'ta'
    })
    // original untouched
    expect(project.captions).toBeUndefined()
    expect(updated).not.toBe(project)
  })

  it('records the source media ref when provided', () => {
    const updated = withCaptions(baseProject(), TRANSCRIPT, 'media/audio.mp3')
    expect(updated.captions).toMatchObject({
      source: 'media/audio.mp3',
      transcript: 'cache/transcript.json',
      language: 'ta'
    })
  })

  it('preserves existing captions fields (translation/styleId/...)', () => {
    const project = {
      ...baseProject(),
      captions: { styleId: 'preset-1', translation: { target: 'en', mode: 'inline' } }
    } as Project
    const updated = withCaptions(project, { language: 'hi', words: [] })
    expect(updated.captions).toEqual({
      styleId: 'preset-1',
      translation: { target: 'en', mode: 'inline' },
      transcript: 'cache/transcript.json',
      language: 'hi'
    })
  })
})

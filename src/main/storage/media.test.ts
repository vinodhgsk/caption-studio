import { describe, expect, it } from 'vitest'
import { dedupeFileName, mediaKindFromExtension } from './media'

describe('mediaKindFromExtension', () => {
  it('classifies common video extensions as video', () => {
    expect(mediaKindFromExtension('clip.mp4')).toBe('video')
    expect(mediaKindFromExtension('a.MOV')).toBe('video')
    expect(mediaKindFromExtension('b.webm')).toBe('video')
  })

  it('classifies common image extensions as image', () => {
    expect(mediaKindFromExtension('photo.png')).toBe('image')
    expect(mediaKindFromExtension('p.JPG')).toBe('image')
    expect(mediaKindFromExtension('p.jpeg')).toBe('image')
  })

  it('classifies common audio extensions as audio (P4.1)', () => {
    expect(mediaKindFromExtension('voice.mp3')).toBe('audio')
    expect(mediaKindFromExtension('v.MP3')).toBe('audio')
    expect(mediaKindFromExtension('a.wav')).toBe('audio')
    expect(mediaKindFromExtension('a.m4a')).toBe('audio')
  })

  it('falls back to video for unknown extensions', () => {
    expect(mediaKindFromExtension('mystery.xyz')).toBe('video')
    expect(mediaKindFromExtension('noext')).toBe('video')
  })
})

describe('dedupeFileName', () => {
  it('returns the desired name when free', () => {
    expect(dedupeFileName('clip.mp4', new Set())).toBe('clip.mp4')
  })

  it('appends " 2", " 3" before the extension on collision', () => {
    expect(dedupeFileName('clip.mp4', new Set(['clip.mp4']))).toBe('clip 2.mp4')
    expect(dedupeFileName('clip.mp4', new Set(['clip.mp4', 'clip 2.mp4']))).toBe('clip 3.mp4')
  })

  it('handles names without an extension', () => {
    expect(dedupeFileName('clip', new Set(['clip']))).toBe('clip 2')
  })
})

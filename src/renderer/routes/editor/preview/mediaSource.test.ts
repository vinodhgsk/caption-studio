import { describe, expect, it } from 'vitest'
import { drawKindFromMediaRef, isVideoRef, mediaRefToUrl } from './mediaSource'

describe('drawKindFromMediaRef', () => {
  it('classifies images by extension', () => {
    expect(drawKindFromMediaRef('media/photo.png')).toBe('image')
    expect(drawKindFromMediaRef('media/P.JPG')).toBe('image')
    expect(drawKindFromMediaRef('media/a.webp')).toBe('image')
  })

  it('classifies videos and unknowns as video', () => {
    expect(drawKindFromMediaRef('media/clip.mp4')).toBe('video')
    expect(drawKindFromMediaRef('media/v.MOV')).toBe('video')
    expect(drawKindFromMediaRef('media/mystery.xyz')).toBe('video')
  })
})

describe('isVideoRef', () => {
  it('is true only for recognized video containers', () => {
    expect(isVideoRef('media/clip.mp4')).toBe(true)
    expect(isVideoRef('media/photo.png')).toBe(false)
    expect(isVideoRef('media/mystery.xyz')).toBe(false)
  })
})

describe('mediaRefToUrl', () => {
  it('uses base64url bundle encoding with fixed host and keeps relative slashes', () => {
    const url = mediaRefToUrl('/Users/me/My Project.vproj', 'media/clip 1.mp4')
    // Should start with the scheme + fixed host
    expect(url).toMatch(/^app-media:\/\/bundle\//)
    // Should end with the encoded media ref
    expect(url).toMatch(/\/media\/clip%201\.mp4$/)
  })

  it('produces a valid URL parsable by the URL constructor', () => {
    const bundle = '/tmp/p.vproj'
    const url = mediaRefToUrl(bundle, 'media/x.mp4')
    const parsed = new URL(url)
    expect(parsed.protocol).toBe('app-media:')
    expect(parsed.hostname).toBe('bundle')
    // The pathname starts with /<base64url>/media/x.mp4
    expect(parsed.pathname).toMatch(/^\/[A-Za-z0-9_-]+\/media\/x\.mp4$/)
  })

  it('deterministically encodes the same bundle to the same URL', () => {
    const bundle = '/Users/me/My Project.vproj'
    const url1 = mediaRefToUrl(bundle, 'media/clip.mp4')
    const url2 = mediaRefToUrl(bundle, 'media/clip.mp4')
    expect(url1).toBe(url2)
  })
})

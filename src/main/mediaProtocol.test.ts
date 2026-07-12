import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { filePathToMediaUrl, mediaUrlToFilePath } from './mediaProtocol'

const BUNDLE = '/Users/me/My Project.vproj'

/** Encode a bundle path the same way the production code does. */
function toBase64Url(value: string): string {
  return Buffer.from(value, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

describe('filePathToMediaUrl / mediaUrlToFilePath round-trip', () => {
  it('round-trips a simple mediaRef to the expected on-disk path', () => {
    const url = filePathToMediaUrl(BUNDLE, 'media/clip1.mp4')
    expect(mediaUrlToFilePath(url)).toBe(resolve(BUNDLE, 'media/clip1.mp4'))
  })

  it('round-trips a name with spaces and unicode', () => {
    const url = filePathToMediaUrl(BUNDLE, 'media/clip 1 — copy.mov')
    expect(mediaUrlToFilePath(url)).toBe(resolve(BUNDLE, 'media/clip 1 — copy.mov'))
  })

  it('serves files under nested media subfolders', () => {
    const url = filePathToMediaUrl(BUNDLE, 'media/proxies/clip.mp4')
    expect(mediaUrlToFilePath(url)).toBe(resolve(BUNDLE, 'media/proxies/clip.mp4'))
  })

  it('produces a valid URL parsable by the URL constructor', () => {
    const url = filePathToMediaUrl(BUNDLE, 'media/clip1.mp4')
    expect(() => new URL(url)).not.toThrow()
    const parsed = new URL(url)
    expect(parsed.protocol).toBe('app-media:')
    expect(parsed.hostname).toBe('bundle')
  })
})

describe('mediaUrlToFilePath security', () => {
  it('rejects parent-traversal segments', () => {
    const url = filePathToMediaUrl(BUNDLE, 'media/../../etc/passwd')
    expect(mediaUrlToFilePath(url)).toBeNull()
  })

  it('rejects encoded traversal segments', () => {
    const encoded = toBase64Url(BUNDLE)
    expect(mediaUrlToFilePath(`app-media://bundle/${encoded}/media/%2e%2e/secret`)).toBeNull()
  })

  it('rejects paths outside the media/ folder', () => {
    const url = filePathToMediaUrl(BUNDLE, 'project.json')
    expect(mediaUrlToFilePath(url)).toBeNull()
  })

  it('rejects a sibling folder that merely starts with "media"', () => {
    const url = filePathToMediaUrl(BUNDLE, 'media-private/secret.mp4')
    expect(mediaUrlToFilePath(url)).toBeNull()
  })

  it('rejects an absolute path smuggled into the relative segment', () => {
    const encoded = toBase64Url(BUNDLE)
    expect(mediaUrlToFilePath(`app-media://bundle/${encoded}//etc/passwd`)).toBeNull()
  })

  it('rejects a non app-media scheme', () => {
    expect(mediaUrlToFilePath('file:///etc/passwd')).toBeNull()
  })

  it('rejects a wrong hostname', () => {
    expect(mediaUrlToFilePath('app-media://other/abc/media/x.mp4')).toBeNull()
  })

  it('rejects a non-absolute bundle path in base64', () => {
    const encoded = toBase64Url('relative/path')
    expect(mediaUrlToFilePath(`app-media://bundle/${encoded}/media/x.mp4`)).toBeNull()
  })

  it('rejects an empty media path', () => {
    const encoded = toBase64Url(BUNDLE)
    expect(mediaUrlToFilePath(`app-media://bundle/${encoded}/`)).toBeNull()
  })

  it('rejects a malformed URL', () => {
    expect(mediaUrlToFilePath('not a url')).toBeNull()
  })
})

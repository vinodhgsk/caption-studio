/**
 * The `app-media://` privileged scheme (P3.9): the ONLY sanctioned way for the
 * sandboxed renderer Canvas to load bundle media bytes (sandbox:true means
 * `file://` / direct fs is unavailable).
 *
 * A URL has the shape:
 *
 *   app-media://bundle/<base64url(bundleAbsPath)>/<mediaRelPath>
 *
 * where `base64url(bundleAbsPath)` is the bundle directory's absolute path
 * encoded as URL-safe base64 (in the first pathname segment) and `mediaRelPath`
 * is the bundle-relative `mediaRef` (e.g. `media/clip1.mp4`).
 *
 * SECURITY: the served file MUST resolve to a path that (a) stays inside the
 * decoded bundle root and (b) lives under that bundle's `media/` folder. Path
 * traversal (`..`), absolute escapes, and non-media paths are rejected.
 *
 * The pure URL<->path mapping is isolated from the electron `protocol.handle`
 * registration so it unit-tests with NO electron import (vitest `node` env).
 */
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path'

/** The custom scheme name. Privileged + standard so URLs parse with a host. */
export const APP_MEDIA_SCHEME = 'app-media'

/** Bundle subfolder media is served from; nothing outside it is reachable. */
export const MEDIA_DIR = 'media'

/** Fixed hostname for the media protocol (Chromium requires a valid host). */
const MEDIA_HOST = 'bundle'

/** Encode a string to URL-safe base64 (no padding). */
function toBase64Url(value: string): string {
  return Buffer.from(value, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** Decode a URL-safe base64 string back to UTF-8. */
function fromBase64Url(encoded: string): string | null {
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    return Buffer.from(base64, 'base64').toString('utf-8')
  } catch {
    return null
  }
}

/**
 * Build the `app-media://` URL for a clip's `mediaRef` within a bundle.
 *
 * `bundleAbs` is the bundle directory's absolute path (the renderer obtains it
 * via `storage:resolvePath`). The URL is runtime-only and never persisted.
 */
export function filePathToMediaUrl(bundleAbs: string, mediaRef: string): string {
  const encodedBundle = toBase64Url(bundleAbs)
  // Encode each path segment but keep the `/` separators readable.
  const rel = mediaRef.split('/').map(encodeURIComponent).join('/')
  return `${APP_MEDIA_SCHEME}://${MEDIA_HOST}/${encodedBundle}/${rel}`
}

/**
 * Resolve an `app-media://` URL to a safe absolute file path, or `null` if the
 * URL is malformed or the target escapes the bundle's `media/` folder.
 *
 * The mapping is total and side-effect free (no fs access) so it is fully
 * unit-testable; the `protocol.handle` registration layers fs streaming on top.
 */
export function mediaUrlToFilePath(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  if (parsed.protocol !== `${APP_MEDIA_SCHEME}:`) return null
  if (parsed.hostname !== MEDIA_HOST) return null

  // The pathname is: /<base64url(bundleAbs)>/<mediaRelPath...>
  const rawPath = parsed.pathname.replace(/^\/+/, '')
  const slashIndex = rawPath.indexOf('/')
  if (slashIndex === -1) return null

  const encodedBundle = rawPath.substring(0, slashIndex)
  const bundleAbs = fromBase64Url(encodedBundle)
  if (bundleAbs === null || bundleAbs === '' || !isAbsolute(bundleAbs)) return null

  const rawRel = rawPath.substring(slashIndex + 1)
  const relPath = safeDecode(rawRel)
  if (relPath === null || relPath === '') return null

  // A decoded segment must never be absolute or contain a traversal hop.
  if (isAbsolute(relPath)) return null
  const segments = relPath.split('/')
  if (segments.some((s) => s === '..' || s === '')) return null

  const bundleRoot = resolve(bundleAbs)
  const mediaRoot = resolve(bundleRoot, MEDIA_DIR)
  const target = resolve(bundleRoot, relPath)

  // The resolved target must stay strictly within the bundle's media/ folder.
  if (!isWithin(mediaRoot, target)) return null

  return normalize(target)
}

/** Decode a URI component, returning null on malformed input. */
function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/**
 * True when `child` is `parent` itself or nested under it. Compares resolved
 * paths via `relative` so it is robust to `.`/`..`/trailing-separator quirks.
 */
function isWithin(parent: string, child: string): boolean {
  if (child === parent) return true
  const rel = relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) && !rel.startsWith(`..${sep}`)
}

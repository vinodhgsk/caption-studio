/**
 * Renderer-side pure helpers for loading bundle media into the Canvas (P3.9).
 *
 * NO DOM / electron / node import — pure string + classification math so it is
 * unit-testable in the vitest `node` env. The `app-media://` URL is the only
 * sanctioned media source for the sandboxed renderer (see main/mediaProtocol).
 */

/** Lower-case video extensions (mirrors main `VIDEO_EXTENSIONS`). */
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'] as const

/** Lower-case image extensions (mirrors main `IMAGE_EXTENSIONS`). */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic'] as const

/** Visual media kind a clip's mediaRef draws as. */
export type DrawKind = 'video' | 'image'

/**
 * Classify a `mediaRef` (e.g. `media/clip1.mp4`) by file extension. Images map
 * to `image`; everything else (including unknown extensions) maps to `video`,
 * matching main's `mediaKindFromExtension` so import + draw agree.
 */
export function drawKindFromMediaRef(mediaRef: string): DrawKind {
  const ext = mediaRef.toLowerCase().split('.').pop() ?? ''
  return (IMAGE_EXTENSIONS as readonly string[]).includes(ext) ? 'image' : 'video'
}

/** True when the extension is a recognized video container. */
export function isVideoRef(mediaRef: string): boolean {
  const ext = mediaRef.toLowerCase().split('.').pop() ?? ''
  return (VIDEO_EXTENSIONS as readonly string[]).includes(ext)
}

/** Encode a string to URL-safe base64 (no padding). Works in browser via btoa. */
function toBase64Url(value: string): string {
  // TextEncoder → btoa for browser compatibility (no Buffer in renderer)
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Build the runtime `app-media://` URL for a clip's `mediaRef` within the
 * bundle at `bundleAbs` (the absolute bundle directory path resolved via
 * `storage:resolvePath`). Uses base64url encoding for the bundle path so the
 * URL is valid in Chromium's URL parser. NEVER persisted to project.json.
 */
export function mediaRefToUrl(bundleAbs: string, mediaRef: string): string {
  const encodedBundle = toBase64Url(bundleAbs)
  const rel = mediaRef.split('/').map(encodeURIComponent).join('/')
  return `app-media://bundle/${encodedBundle}/${rel}`
}

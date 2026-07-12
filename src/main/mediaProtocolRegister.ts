/**
 * Electron-side registration for the `app-media://` scheme (P3.9).
 *
 * Split from `mediaProtocol.ts` so the pure URL<->path mapping stays free of any
 * electron import and unit-tests in the vitest `node` env. This module is the
 * ONLY place that touches `protocol` + the filesystem stream.
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { APP_MEDIA_SCHEME, mediaUrlToFilePath } from './mediaProtocol'

/** Minimal extension → MIME map for the media we serve (video + image). */
const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.heic': 'image/heic',
  // Imported fonts served from media/fonts/ for renderer FontFace loading (P6.2).
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.ttc': 'font/collection',
  '.otc': 'font/collection'
}

function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Declare the scheme as privileged BEFORE `app.whenReady` so it behaves like a
 * standard, secure, fetch/stream-capable origin (needed for `<video>` seeking).
 * Must be called at module top-level timing, before the app is ready.
 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
        bypassCSP: false
      }
    }
  ])
}

/**
 * Install the `app-media://` request handler. Call AFTER the app is ready.
 *
 * Maps the URL to a safe absolute path via the pure `mediaUrlToFilePath`
 * (returns 403 on traversal/escape), 404s missing files, and otherwise streams
 * the file with a correct Content-Type. Honors a `Range` header so `<video>`
 * can seek without buffering the whole file.
 */
export function registerMediaProtocolHandler(): void {
  protocol.handle(APP_MEDIA_SCHEME, async (request) => {
    const filePath = mediaUrlToFilePath(request.url)
    if (filePath === null) {
      return new Response('Forbidden', { status: 403 })
    }

    let size: number
    try {
      const info = await stat(filePath)
      if (!info.isFile()) return new Response('Not Found', { status: 404 })
      size = info.size
    } catch {
      return new Response('Not Found', { status: 404 })
    }

    const contentType = contentTypeFor(filePath)
    const rangeHeader = request.headers.get('Range')
    const range = rangeHeader === null ? null : parseRange(rangeHeader, size)

    if (range !== null) {
      const stream = createReadStream(filePath, { start: range.start, end: range.end })
      return new Response(toWebStream(stream), {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(range.end - range.start + 1),
          'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*'
        }
      })
    }

    const stream = createReadStream(filePath)
    return new Response(toWebStream(stream), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*'
      }
    })
  })
}

/** Parse a single `bytes=start-end` range against a known size, else null. */
function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return null

  const hasStart = match[1] !== ''
  const hasEnd = match[2] !== ''
  if (!hasStart && !hasEnd) return null

  let start = hasStart ? Number(match[1]) : 0
  let end = hasEnd ? Number(match[2]) : size - 1

  if (!hasStart) {
    // Suffix range: last N bytes.
    start = Math.max(0, size - Number(match[2]))
    end = size - 1
  }

  if (Number.isNaN(start) || Number.isNaN(end)) return null
  if (start > end || start < 0 || end >= size) return null
  return { start, end }
}

/** Adapt a Node Readable into a Web ReadableStream for the Response body. */
function toWebStream(stream: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return Readable.toWeb(stream as Readable) as ReadableStream<Uint8Array>
}

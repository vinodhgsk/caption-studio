/**
 * Project bundle layout + defaults. NO electron import — kept pure so providers
 * and tests can use it against any root directory.
 *
 * A `.vproj` bundle is a directory (master plan §4):
 *   <name>.vproj/
 *     project.json
 *     media/  media/fonts/
 *     cache/
 *     exports/
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Project, StorageLocation } from '../../shared/storage'

/** Resolved absolute paths for every part of a bundle. */
export interface BundleLayout {
  root: string
  projectJson: string
  media: string
  fonts: string
  cache: string
  exports: string
}

/** Compute the bundle's subdirectory + file paths from its root dir. */
export function bundleLayout(bundlePath: string): BundleLayout {
  const media = join(bundlePath, 'media')
  return {
    root: bundlePath,
    projectJson: join(bundlePath, 'project.json'),
    media,
    fonts: join(media, 'fonts'),
    cache: join(bundlePath, 'cache'),
    exports: join(bundlePath, 'exports')
  }
}

/** Create every bundle subdirectory (recursive, idempotent). */
export async function scaffoldBundleDirs(bundlePath: string): Promise<void> {
  const layout = bundleLayout(bundlePath)
  // fonts is nested under media, so creating it recursively also creates media.
  await mkdir(layout.fonts, { recursive: true })
  await mkdir(layout.cache, { recursive: true })
  await mkdir(layout.exports, { recursive: true })
}

/**
 * Strip path separators and illegal filename characters, drop ASCII control
 * characters, collapse whitespace, and fall back to a stable base when nothing
 * usable remains.
 */
export function sanitizeProjectName(name: string): string {
  const cleaned = Array.from(name)
    // Drop ASCII control characters (code points below the space character).
    .filter((ch) => (ch.codePointAt(0) ?? 0) >= 0x20)
    .join('')
    // Windows-reserved characters + path separators → space.
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '') // no trailing dots/spaces (Windows)
    .trim()
  return cleaned.length > 0 ? cleaned : 'Untitled Project'
}

/** Default project content for a freshly created bundle. */
export function defaultProject(name: string, id: string, now: string): Project {
  return {
    version: 1,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    settings: {
      fps: 30,
      resolution: [1920, 1080],
      aspect: '16:9',
      background: 'transparent',
      language: 'ta',
      languages: ['ta', 'te', 'ml', 'kn', 'hi', 'en']
    },
    storage: { location: 'local', root: '' },
    tracks: []
  }
}

/** The bundle directory base name (`<safe>.vproj`) for a project name. */
export function bundleDirName(name: string): string {
  return `${sanitizeProjectName(name)}.vproj`
}

/** Re-export for callers that want the location type alongside bundle helpers. */
export type { StorageLocation }

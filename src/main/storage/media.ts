/**
 * Pure media helpers for import (P3.3). NO electron import — kept node-pure so
 * LocalProvider stays testable against a tmp root.
 *
 * Extension → MediaKind classification and the filename de-duplication rule
 * ("clip.mp4" → "clip 2.mp4" on collision) live here so they can be unit-tested
 * without touching the filesystem.
 */
import type { MediaKind } from '../../shared/storage'

/** Common video extensions we accept on import (lower-case, no dot). */
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'] as const

/** Common image extensions we accept on import (lower-case, no dot). */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic'] as const

/** Common audio extensions we accept on import (lower-case, no dot). MP3 is the headline (Doc 02). */
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] as const

/**
 * Classify a file by extension into a `MediaKind`. Audio extensions → `audio`,
 * image extensions → `image`; everything else (including unknown extensions) is
 * treated as `video` (the most permissive visual track placement). Callers that
 * need a hard reject can pre-filter via the dialog extension list.
 */
export function mediaKindFromExtension(fileName: string): MediaKind {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  if ((AUDIO_EXTENSIONS as readonly string[]).includes(ext)) return 'audio'
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return 'image'
  return 'video'
}

/**
 * Given a desired file name and the set of names already present in a
 * directory, return a free name by appending " 2", " 3", … before the
 * extension on collision (mirrors LocalProvider's bundle-name de-duplication).
 */
export function dedupeFileName(desired: string, taken: ReadonlySet<string>): string {
  if (!taken.has(desired)) return desired

  const dot = desired.lastIndexOf('.')
  const stem = dot > 0 ? desired.slice(0, dot) : desired
  const ext = dot > 0 ? desired.slice(dot) : ''
  for (let i = 2; ; i++) {
    const candidate = `${stem} ${i}${ext}`
    if (!taken.has(candidate)) return candidate
  }
}

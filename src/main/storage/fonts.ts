/**
 * Thin fs shell for importing a font file into a bundle's `media/fonts/` folder
 * (P6.2). NO electron import — kept node-pure so LocalProvider stays testable
 * against a tmp root. All the parsing/manifest LOGIC lives in the pure
 * `src/shared/fontParse.ts`; this module just reads bytes, parses, and atomically
 * copies into the bundle, returning a bundle-relative {@link ImportFontResult}.
 */
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ImportFontResult } from '../../shared/storage'
import {
  FONT_MEDIA_DIR,
  parseFontMetadata,
  weightFromStyle,
  isItalicStyle
} from '../../shared/fontParse'
import { dedupeFileName } from './media'
import { writeFileAtomic } from './atomic'
import type { BundleLayout } from './bundle'

/**
 * Copy `sourceAbsPath` (a TTF/OTF) into the bundle's `media/fonts/` folder,
 * de-duplicating the filename on collision, parse its family + weight/style from
 * the bytes (filename fallback inside {@link parseFontMetadata}), and return the
 * bundle-relative `media/fonts/<file>` fileRef + parsed metadata.
 *
 * Atomic write (temp + rename) so a half-copied font is never observed. The
 * fileRef's weight/style mirror the parsed metadata so the registry + FontFace
 * descriptors agree.
 */
export async function importFontFile(
  layout: BundleLayout,
  sourceAbsPath: string
): Promise<ImportFontResult> {
  await mkdir(layout.fonts, { recursive: true })

  // Parse from the source bytes BEFORE the copy (so a parse can inform the name,
  // though we keep the on-disk filename for stable, predictable bundle contents).
  const bytes = await readFile(sourceAbsPath)
  const sourceName = basename(sourceAbsPath)
  const metadata = parseFontMetadata(bytes, sourceName)

  // De-duplicate against names already in media/fonts/.
  const existing = new Set(await readdir(layout.fonts).catch(() => [] as string[]))
  const fileName = dedupeFileName(sourceName, existing)

  await writeFileAtomic(join(layout.fonts, fileName), bytes)

  return {
    fileRef: {
      path: `${FONT_MEDIA_DIR}/${fileName}`,
      // Prefer the parsed weight/italic; both already fall back through the
      // filename inside parseFontMetadata, so re-derive defensively here too.
      weight: metadata.weight || weightFromStyle(metadata.subfamily),
      italic: metadata.italic || isItalicStyle(metadata.subfamily)
    },
    fileName,
    metadata
  }
}

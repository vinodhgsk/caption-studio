/**
 * Resolve the app-bundled fonts directory for FFmpeg/libass fontsdir.
 *
 * The Noto Indic/Latin TTF files are downloaded to resources/fonts/ via
 * `npm run download-fonts` and electron-builder copies them to
 * process.resourcesPath/fonts/ in a packaged app. In dev (electron-vite),
 * they live at resources/fonts/ relative to the project root.
 *
 * This is SEPARATE from the per-project bundle's media/fonts/ (user-imported
 * fonts). The app fonts directory provides the global Indic defaults; the
 * project directory provides clip-specific imported fonts. FFmpeg's subtitles
 * filter only accepts one fontsdir, so we prefer the app dir (which has the
 * Tamil/Indic defaults). User-imported fonts are looked up by fontconfig as
 * well when their path is embedded in the clip's fontFamily name, but the
 * primary fix for Tamil lyrics is that libass can find Noto Sans Tamil here.
 */
import { join } from 'node:path'
import { existsSync } from 'node:fs'

export function appFontsDir(): string {
  // Packaged Electron: process.resourcesPath points to the app's Resources dir.
  if (process.resourcesPath !== undefined) {
    const packed = join(process.resourcesPath, 'fonts')
    if (existsSync(packed)) return packed
  }

  // Dev (electron-vite): __dirname is dist-main/ after build or src/main/ in
  // source-run mode. Walk up until we find resources/fonts/.
  const candidates = [
    join(__dirname, '..', '..', 'resources', 'fonts'),  // dist-main/ → project root
    join(__dirname, '..', '..', '..', 'resources', 'fonts'), // extra level
    join(process.cwd(), 'resources', 'fonts')            // cwd fallback
  ]
  for (const dir of candidates) {
    if (existsSync(dir)) return dir
  }

  // Return first candidate even if it doesn't exist; FFmpeg/libass will simply
  // find no fonts there and fall through to its own system fontconfig scan.
  return candidates[0]
}

/**
 * Renderer runtime FontFace registration for imported families (P6.2 — Doc 08).
 *
 * Bridges a {@link FontEntry}/manifest record to the browser: it builds a
 * `FontFace` per embedded file from its `app-media://` URL (the ONLY sanctioned
 * source for sandbox:true bundle bytes — see main/mediaProtocol) and adds it to
 * `document.fonts`, so the imported family becomes immediately usable for canvas
 * + DOM rendering and selectable by family name.
 *
 * Split from the pure modules so the fs/DOM-touching bits stay thin: the family
 * resolution + URL mapping (`mediaRefToUrl`) and the manifest/registry logic
 * (fontParse, fontRegistry) are pure + tested; this loader only performs the
 * `document.fonts.add(...)` side effect and the registry registration.
 */
import type { FontEntry, FontRegistry } from '../../../shared/fontRegistry'
import { fontRegistry as defaultRegistry } from '../../../shared/fontRegistry'
import { mediaRefToUrl } from '../../routes/editor/preview/mediaSource'

/** Tracks which `family@path` FontFaces we have already added (idempotency). */
const loaded = new Set<string>()

/**
 * Load every embedded file of `entry` as a `FontFace` keyed by `entry.family`,
 * sourced from `app-media://<bundle>/<media/fonts/...>`, and add it to
 * `document.fonts`. Idempotent per `family@path`; safe to call repeatedly (e.g.
 * on re-open). Resolves once all faces have loaded (or immediately when there is
 * nothing to load). Failures to load a single face are swallowed so one bad file
 * does not block the family.
 */
export async function loadImportedFontFaces(
  entry: FontEntry,
  bundleAbs: string
): Promise<void> {
  if (typeof document === 'undefined' || entry.files === undefined) return
  const fontSet = document.fonts
  if (fontSet === undefined) return

  const pending: Promise<unknown>[] = []
  for (const file of entry.files) {
    const dedupeKey = `${entry.family.toLowerCase()}@${file.path}`
    if (loaded.has(dedupeKey)) continue
    loaded.add(dedupeKey)

    const url = mediaRefToUrl(bundleAbs, file.path)
    try {
      const face = new FontFace(entry.family, `url("${url}")`, {
        weight: String(file.weight),
        style: file.italic ? 'italic' : 'normal'
      })
      fontSet.add(face)
      pending.push(
        face.load().catch(() => {
          // A failed face must not reject the whole load; drop the dedupe mark so
          // a later retry can re-attempt it.
          loaded.delete(dedupeKey)
        })
      )
    } catch {
      loaded.delete(dedupeKey)
    }
  }
  await Promise.all(pending)
}

/**
 * Register `entry` into `registry` (so it appears in the Fonts panel + fallback
 * resolution) AND load its FontFaces for the open bundle. The registry register
 * is idempotent-ish (re-register replaces the prior imported entry); a bundled
 * collision throws and is surfaced to the caller. Returns the loaded family name.
 */
export async function registerAndLoadImportedFont(
  entry: FontEntry,
  bundleAbs: string,
  registry: FontRegistry = defaultRegistry
): Promise<string> {
  registry.registerFont(entry)
  await loadImportedFontFaces(entry, bundleAbs)
  return entry.family
}

/** Test seam: clear the loaded-faces cache. */
export function __resetLoadedFontFaces(): void {
  loaded.clear()
}

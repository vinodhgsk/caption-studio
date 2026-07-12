/**
 * Renderer orchestration for custom font import + project-open re-hydration
 * (P6.2 — Doc 08). Pure-ish glue: it sequences the IPC copy, the pure manifest
 * update (fontParse), the registry registration, and the runtime FontFace load
 * (fontFaceLoader). The heavy lifting is delegated to the pure/tested modules so
 * this file stays a thin coordinator.
 *
 * IMPORT FLOW (per picked file):
 *   1. `fonts:import` copies the TTF/OTF into `media/fonts/` (MAIN) → fileRef + meta.
 *   2. `buildImportedFontEntry` (pure) makes an imported FontEntry from meta+ref.
 *   3. `registerAndLoadImportedFont` registers it + adds the FontFace.
 *   4. `addEntryToManifest` (pure) folds it into the project's font manifest.
 * The caller persists the returned manifest onto `project.fonts` so it travels.
 *
 * RE-HYDRATION (on project open):
 *   `rehydrateProjectFonts` reads `project.fonts`, replays it into the registry
 *   (`rehydrateImportedFonts`, pure), and loads each family's FontFaces from the
 *   bundle's `media/fonts/` files — so an imported family renders identically
 *   after reload and on another machine/OneDrive.
 */
import type { FontManifest } from '../../../shared/fontParse'
import {
  addEntryToManifest,
  buildImportedFontEntry,
  emptyFontManifest,
  manifestEntryToFontEntry,
  rehydrateImportedFonts
} from '../../../shared/fontParse'
import type { FontEntry, FontRegistry } from '../../../shared/fontRegistry'
import { fontRegistry as defaultRegistry } from '../../../shared/fontRegistry'
import type { ImportFontResult, Project, ProjectRef } from '../../../shared/storage'
import { loadImportedFontFaces, registerAndLoadImportedFont } from './fontFaceLoader'

/** Outcome of importing one or more font files. */
export type ImportFontOutcome =
  | { ok: true; manifest: FontManifest; families: string[] }
  | { ok: false; error: string }

/** Injectable IPC surface so the flow is testable without `window.api`. */
export interface FontImportApi {
  pickFont(): Promise<{ ok: true; data: { paths: string[] } } | { ok: false; error: string }>
  importFont(
    ref: ProjectRef,
    sourcePath: string
  ): Promise<{ ok: true; data: ImportFontResult } | { ok: false; error: string }>
  resolveBundlePath(ref: ProjectRef): Promise<string | null>
}

/** The default IPC surface backed by `window.api` + `storage:resolvePath`. */
export const windowFontImportApi: FontImportApi = {
  pickFont: () => window.api.invoke('fonts:pickFont', undefined),
  importFont: (ref, sourcePath) => window.api.invoke('fonts:import', { ref, sourcePath }),
  resolveBundlePath: async (ref) => {
    const r = await window.api.invoke('storage:resolvePath', { ref })
    return r.ok ? r.data.path : null
  }
}

/**
 * Import one already-copied font (`ImportFontResult`) into the registry + the
 * running document + the manifest. PURE coordination over its inputs (no IPC):
 * builds the entry, registers + loads the FontFace, and returns the new manifest.
 * Used by {@link importFontsFromPicker} and directly unit-testable.
 */
export async function applyImportedFont(
  result: ImportFontResult,
  manifest: FontManifest,
  bundleAbs: string,
  registry: FontRegistry = defaultRegistry
): Promise<{ entry: FontEntry; manifest: FontManifest }> {
  const entry = buildImportedFontEntry(result.metadata, result.fileRef)
  await registerAndLoadImportedFont(entry, bundleAbs, registry)
  return { entry, manifest: addEntryToManifest(manifest, entry) }
}

/**
 * Full picker-driven import: open the OS picker, copy each chosen TTF/OTF into
 * `media/fonts/`, register + load each, and fold them into a manifest seeded from
 * `project.fonts`. Returns the updated manifest (the caller writes it back onto
 * the project so it persists + travels). Empty selection → ok with the unchanged
 * manifest and no families.
 */
export async function importFontsFromPicker(
  ref: ProjectRef,
  project: Pick<Project, 'fonts'>,
  registry: FontRegistry = defaultRegistry,
  api: FontImportApi = windowFontImportApi
): Promise<ImportFontOutcome> {
  try {
    const picked = await api.pickFont()
    if (!picked.ok) return { ok: false, error: picked.error }
    if (picked.data.paths.length === 0) {
      return { ok: true, manifest: project.fonts ?? emptyFontManifest(), families: [] }
    }

    const bundleAbs = await api.resolveBundlePath(ref)
    if (bundleAbs === null) return { ok: false, error: 'Could not resolve the project bundle path.' }

    let manifest = project.fonts ?? emptyFontManifest()
    const families: string[] = []
    for (const sourcePath of picked.data.paths) {
      const imported = await api.importFont(ref, sourcePath)
      if (!imported.ok) return { ok: false, error: imported.error }
      const applied = await applyImportedFont(imported.data, manifest, bundleAbs, registry)
      manifest = applied.manifest
      if (!families.includes(applied.entry.family)) families.push(applied.entry.family)
    }
    return { ok: true, manifest, families }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to import font.' }
  }
}

/**
 * Re-hydrate a project's imported fonts on open: re-register every manifest
 * family into the registry and load its FontFaces from the bundle's
 * `media/fonts/` files. Returns the re-registered family names. Safe to call when
 * `project.fonts` is undefined (no-op). This is what makes imported families
 * render identically after reload / on another machine.
 */
export async function rehydrateProjectFonts(
  project: Pick<Project, 'fonts'>,
  bundleAbs: string,
  registry: FontRegistry = defaultRegistry
): Promise<string[]> {
  const manifest = project.fonts
  if (manifest === undefined) return []

  // 1. Pure registry replay (registers, skips bundled collisions / invalid).
  const registered = rehydrateImportedFonts(registry, manifest)

  // 2. Load each registered family's FontFaces from the bundle.
  await Promise.all(
    manifest.imported
      .filter((rec) => registered.includes(rec.family))
      .map((rec) => loadImportedFontFaces(manifestEntryToFontEntry(rec), bundleAbs))
  )
  return registered
}

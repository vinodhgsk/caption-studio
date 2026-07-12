import { describe, it, expect, beforeEach } from 'vitest'
import {
  applyImportedFont,
  importFontsFromPicker,
  rehydrateProjectFonts,
  type FontImportApi
} from './importFont'
import { __resetLoadedFontFaces } from './fontFaceLoader'
import { createFontRegistry } from '../../../shared/fontRegistry'
import { addEntryToManifest, buildImportedFontEntry, emptyFontManifest, FONT_MEDIA_DIR } from '../../../shared/fontParse'
import type { ImportFontResult, Project, ProjectRef } from '../../../shared/storage'

const ref: ProjectRef = { id: 'p1', name: 'P', location: 'local', path: '/bundles/P.vproj' }

beforeEach(() => {
  __resetLoadedFontFaces()
})

// In the vitest `node` env, `document` is undefined, so loadImportedFontFaces is
// a guarded no-op — the orchestration (registry + manifest) is what we assert.

function importResult(family: string, file: string): ImportFontResult {
  return {
    fileRef: { path: `${FONT_MEDIA_DIR}/${file}`, weight: 400, italic: false },
    fileName: file,
    metadata: { family, subfamily: '', weight: 400, italic: false, fromNameTable: true }
  }
}

describe('applyImportedFont — register + fold into manifest', () => {
  it('registers the family and appends a manifest record', async () => {
    const reg = createFontRegistry()
    const { entry, manifest } = await applyImportedFont(
      importResult('Acme Sans', 'Acme-Regular.ttf'),
      emptyFontManifest(),
      '/bundles/P.vproj',
      reg
    )
    expect(entry.family).toBe('Acme Sans')
    expect(reg.hasFont('Acme Sans')).toBe(true)
    expect(manifest.imported).toHaveLength(1)
    expect(manifest.imported[0].files[0].path).toBe(`${FONT_MEDIA_DIR}/Acme-Regular.ttf`)
  })
})

describe('importFontsFromPicker — full flow with a mocked api', () => {
  function api(overrides: Partial<FontImportApi> = {}): FontImportApi {
    return {
      pickFont: async () => ({ ok: true, data: { paths: ['/src/Acme-Regular.ttf'] } }),
      importFont: async () => ({ ok: true, data: importResult('Acme Sans', 'Acme-Regular.ttf') }),
      resolveBundlePath: async () => '/bundles/P.vproj',
      ...overrides
    }
  }

  it('imports a picked font, registers it, and returns an updated manifest', async () => {
    const reg = createFontRegistry()
    const out = await importFontsFromPicker(ref, { fonts: undefined }, reg, api())
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.families).toEqual(['Acme Sans'])
    expect(out.manifest.imported).toHaveLength(1)
    expect(reg.hasFont('Acme Sans')).toBe(true)
  })

  it('seeds the manifest from project.fonts so prior imports are kept', async () => {
    const reg = createFontRegistry()
    const prior = addEntryToManifest(
      emptyFontManifest(),
      buildImportedFontEntry(
        { family: 'Old Font', subfamily: '', weight: 400, italic: false, fromNameTable: true },
        { path: `${FONT_MEDIA_DIR}/Old.ttf`, weight: 400, italic: false },
        { scripts: ['latin'] }
      )
    )
    const out = await importFontsFromPicker(ref, { fonts: prior }, reg, api())
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.manifest.imported.map((e) => e.family)).toEqual(['Old Font', 'Acme Sans'])
  })

  it('empty selection returns ok with the unchanged manifest', async () => {
    const reg = createFontRegistry()
    const out = await importFontsFromPicker(
      ref,
      { fonts: undefined },
      reg,
      api({ pickFont: async () => ({ ok: true, data: { paths: [] } }) })
    )
    expect(out).toEqual({ ok: true, manifest: emptyFontManifest(), families: [] })
  })

  it('surfaces an import IPC error', async () => {
    const reg = createFontRegistry()
    const out = await importFontsFromPicker(
      ref,
      { fonts: undefined },
      reg,
      api({ importFont: async () => ({ ok: false, error: 'copy failed' }) })
    )
    expect(out).toEqual({ ok: false, error: 'copy failed' })
  })
})

describe('rehydrateProjectFonts — project open re-registers imported families', () => {
  it('re-registers families from the persisted manifest', async () => {
    const reg = createFontRegistry()
    const manifest = addEntryToManifest(
      emptyFontManifest(),
      buildImportedFontEntry(
        { family: 'Travel Font', subfamily: '', weight: 400, italic: false, fromNameTable: true },
        { path: `${FONT_MEDIA_DIR}/Travel.ttf`, weight: 400, italic: false },
        { scripts: ['latin'] }
      )
    )
    const project = { fonts: manifest } as Pick<Project, 'fonts'>

    expect(reg.hasFont('Travel Font')).toBe(false)
    const registered = await rehydrateProjectFonts(project, '/bundles/P.vproj', reg)
    expect(registered).toEqual(['Travel Font'])
    expect(reg.hasFont('Travel Font')).toBe(true)
  })

  it('no-op when the project has no font manifest', async () => {
    const reg = createFontRegistry()
    expect(await rehydrateProjectFonts({ fonts: undefined }, '/bundles/P.vproj', reg)).toEqual([])
  })
})

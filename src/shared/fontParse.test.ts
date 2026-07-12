import { describe, it, expect } from 'vitest'
import {
  parseFontMetadata,
  readNameTable,
  weightFromStyle,
  isItalicStyle,
  familyAndStyleFromStem,
  inferScripts,
  isFontFile,
  fontExtension,
  isBundleRelativeFontPath,
  buildImportedFontEntry,
  addEntryToManifest,
  manifestEntryToFontEntry,
  rehydrateImportedFonts,
  emptyFontManifest,
  FONT_MEDIA_DIR,
  type FontManifest
} from './fontParse'
import { createFontRegistry, type FontEntry } from './fontRegistry'

// ---------------------------------------------------------------------------
// Build a minimal but VALID sfnt buffer carrying a `name` table so the parser
// can be tested without a real font binary. We emit a TrueType (0x00010000)
// header, a one-entry table directory pointing at a `name` table, and a name
// table with Windows-Unicode (platform 3) family (id 1) + subfamily (id 2)
// records (UTF-16BE), as virtually every real TTF/OTF does.
// ---------------------------------------------------------------------------

interface NameRecordSpec {
  nameId: number
  text: string
  platformId?: number
}

function buildNameTable(records: NameRecordSpec[]): Uint8Array {
  const count = records.length
  const headerLen = 6 + count * 12
  const encoded = records.map((r) => {
    const platformId = r.platformId ?? 3
    if (platformId === 1) {
      const bytes = new Uint8Array(r.text.length)
      for (let i = 0; i < r.text.length; i++) bytes[i] = r.text.charCodeAt(i) & 0xff
      return { platformId, nameId: r.nameId, bytes }
    }
    const bytes = new Uint8Array(r.text.length * 2)
    for (let i = 0; i < r.text.length; i++) {
      const c = r.text.charCodeAt(i)
      bytes[i * 2] = (c >> 8) & 0xff
      bytes[i * 2 + 1] = c & 0xff
    }
    return { platformId, nameId: r.nameId, bytes }
  })

  const storageLen = encoded.reduce((n, e) => n + e.bytes.length, 0)
  const table = new Uint8Array(headerLen + storageLen)
  const view = new DataView(table.buffer)
  view.setUint16(0, 0) // format 0
  view.setUint16(2, count)
  view.setUint16(4, headerLen) // storage offset (relative to table start)

  let strCursor = 0
  encoded.forEach((e, i) => {
    const rec = 6 + i * 12
    view.setUint16(rec, e.platformId) // platformID
    view.setUint16(rec + 2, e.platformId === 3 ? 1 : 0) // encodingID
    view.setUint16(rec + 4, e.platformId === 3 ? 0x0409 : 0) // languageID
    view.setUint16(rec + 6, e.nameId)
    view.setUint16(rec + 8, e.bytes.length)
    view.setUint16(rec + 10, strCursor) // string offset from storage start
    table.set(e.bytes, headerLen + strCursor)
    strCursor += e.bytes.length
  })
  return table
}

function buildSfnt(records: NameRecordSpec[]): Uint8Array {
  const nameTable = buildNameTable(records)
  const numTables = 1
  const dirLen = 12 + numTables * 16
  const total = dirLen + nameTable.length
  const buf = new Uint8Array(total)
  const view = new DataView(buf.buffer)

  view.setUint32(0, 0x00010000) // sfnt version (TrueType)
  view.setUint16(4, numTables)
  view.setUint16(6, 16) // searchRange (cosmetic)
  view.setUint16(8, 0)
  view.setUint16(10, 0)

  const tableOffset = dirLen
  // table record: tag 'name', checksum, offset, length
  view.setUint32(12, 0x6e616d65) // 'name'
  view.setUint32(16, 0)
  view.setUint32(20, tableOffset)
  view.setUint32(24, nameTable.length)

  buf.set(nameTable, tableOffset)
  return buf
}

describe('readNameTable — sfnt name-table fixture', () => {
  it('reads family + subfamily from a Windows-Unicode name table', () => {
    const buf = buildSfnt([
      { nameId: 1, text: 'Acme Display' },
      { nameId: 2, text: 'Bold Italic' }
    ])
    const table = readNameTable(buf)
    expect(table).not.toBeNull()
    expect(table!.family).toBe('Acme Display')
    expect(table!.subfamily).toBe('Bold Italic')
  })

  it('prefers typographic family (id 16/17) when present', () => {
    const buf = buildSfnt([
      { nameId: 1, text: 'Acme Display Bold' },
      { nameId: 16, text: 'Acme Display' },
      { nameId: 17, text: 'Bold' }
    ])
    const table = readNameTable(buf)
    expect(table!.typoFamily).toBe('Acme Display')
    expect(table!.typoSubfamily).toBe('Bold')
  })

  it('reads Mac-Roman (platform 1) ASCII name records', () => {
    const buf = buildSfnt([{ nameId: 1, text: 'MacFont', platformId: 1 }])
    expect(readNameTable(buf)!.family).toBe('MacFont')
  })

  it('returns null for a non-sfnt buffer', () => {
    expect(readNameTable(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBeNull()
  })

  it('returns null for a truncated buffer (never throws)', () => {
    expect(readNameTable(new Uint8Array(4))).toBeNull()
  })
})

describe('parseFontMetadata — name table vs. filename fallback', () => {
  it('extracts family + weight + italic from the name table', () => {
    const buf = buildSfnt([
      { nameId: 16, text: 'Acme Display' },
      { nameId: 17, text: 'SemiBold Italic' }
    ])
    const meta = parseFontMetadata(buf, 'Acme-SemiBoldItalic.ttf')
    expect(meta.family).toBe('Acme Display')
    expect(meta.fromNameTable).toBe(true)
    expect(meta.weight).toBe(600)
    expect(meta.italic).toBe(true)
  })

  it('falls back to the filename stem when the buffer is not a font', () => {
    const meta = parseFontMetadata(new Uint8Array([0, 1, 2, 3]), 'MyCustomFont-Bold.ttf')
    expect(meta.fromNameTable).toBe(false)
    expect(meta.family).toBe('MyCustomFont')
    expect(meta.weight).toBe(700)
    expect(meta.italic).toBe(false)
  })

  it('filename fallback keeps a plain stem as the family (no style split)', () => {
    const meta = parseFontMetadata(new Uint8Array([0, 0, 0, 0]), 'Brand New Sans.otf')
    expect(meta.family).toBe('Brand New Sans')
    expect(meta.subfamily).toBe('')
  })
})

describe('weight / italic / stem helpers', () => {
  it('maps weight keywords (most-specific wins)', () => {
    expect(weightFromStyle('Thin')).toBe(100)
    expect(weightFromStyle('Light')).toBe(300)
    expect(weightFromStyle('Regular')).toBe(400)
    expect(weightFromStyle('Medium')).toBe(500)
    expect(weightFromStyle('SemiBold')).toBe(600)
    expect(weightFromStyle('Bold')).toBe(700)
    expect(weightFromStyle('ExtraBold')).toBe(800)
    expect(weightFromStyle('Black')).toBe(900)
    expect(weightFromStyle('whatever')).toBe(400)
  })

  it('detects italic / oblique', () => {
    expect(isItalicStyle('Bold Italic')).toBe(true)
    expect(isItalicStyle('Oblique')).toBe(true)
    expect(isItalicStyle('Regular')).toBe(false)
  })

  it('splits a filename stem into family + style hint', () => {
    expect(familyAndStyleFromStem('MyFont-BoldItalic')).toEqual({
      family: 'MyFont',
      style: 'BoldItalic'
    })
    expect(familyAndStyleFromStem('Plain Family')).toEqual({ family: 'Plain Family', style: '' })
  })
})

describe('extension + script inference', () => {
  it('recognizes font extensions', () => {
    expect(isFontFile('foo.ttf')).toBe(true)
    expect(isFontFile('foo.OTF')).toBe(true)
    expect(isFontFile('foo.mp4')).toBe(false)
    expect(fontExtension('/a/b/c.OTF')).toBe('otf')
  })

  it('infers Indic script + Latin from a named family', () => {
    expect(inferScripts('Mukta Tamil')).toEqual(['tamil', 'latin'])
    expect(inferScripts('Some Telugu Sans')).toEqual(['telugu', 'latin'])
    expect(inferScripts('Plain Sans')).toEqual(['latin'])
  })
})

describe('isBundleRelativeFontPath — portability guard', () => {
  it('accepts media/fonts/ relative paths', () => {
    expect(isBundleRelativeFontPath('media/fonts/Acme-Regular.ttf')).toBe(true)
  })

  it('rejects absolute / drive / traversal / backslash paths', () => {
    expect(isBundleRelativeFontPath('/Users/x/Acme.ttf')).toBe(false)
    expect(isBundleRelativeFontPath('C:\\fonts\\Acme.ttf')).toBe(false)
    expect(isBundleRelativeFontPath('media/fonts/../../escape.ttf')).toBe(false)
    expect(isBundleRelativeFontPath('media\\fonts\\Acme.ttf')).toBe(false)
    expect(isBundleRelativeFontPath('media/Acme.ttf')).toBe(false)
  })
})

describe('buildImportedFontEntry — registrable imported entry', () => {
  it('builds an imported FontEntry from metadata + a bundle-relative fileRef', () => {
    const entry = buildImportedFontEntry(
      { family: 'Acme Tamil', subfamily: 'Bold', weight: 700, italic: false, fromNameTable: true },
      { path: `${FONT_MEDIA_DIR}/Acme-Bold.ttf`, weight: 700, italic: false }
    )
    expect(entry.source).toBe('imported')
    expect(entry.family).toBe('Acme Tamil')
    expect(entry.scripts).toEqual(['tamil', 'latin'])
    expect(entry.weights).toEqual([700])
    expect(entry.styles).toEqual(['normal'])
    expect(entry.files![0].path).toBe(`${FONT_MEDIA_DIR}/Acme-Bold.ttf`)
  })

  it('rejects a non-bundle-relative file path (portability)', () => {
    expect(() =>
      buildImportedFontEntry(
        { family: 'X', subfamily: '', weight: 400, italic: false, fromNameTable: false },
        { path: '/abs/path/X.ttf', weight: 400, italic: false }
      )
    ).toThrow(/bundle-relative/)
  })
})

describe('manifest round-trip — persist → re-hydrate re-registers the family', () => {
  const fileRef = { path: `${FONT_MEDIA_DIR}/Acme-Regular.ttf`, weight: 400, italic: false }
  const entry = buildImportedFontEntry(
    { family: 'Acme Sans', subfamily: '', weight: 400, italic: false, fromNameTable: true },
    fileRef,
    { scripts: ['latin'] }
  )

  it('adds an entry to the manifest with only bundle-relative paths', () => {
    const manifest = addEntryToManifest(emptyFontManifest(), entry)
    expect(manifest.imported).toHaveLength(1)
    const rec = manifest.imported[0]
    expect(rec.family).toBe('Acme Sans')
    expect(rec.files[0].path).toBe(`${FONT_MEDIA_DIR}/Acme-Regular.ttf`)
    expect(isBundleRelativeFontPath(rec.files[0].path)).toBe(true)
  })

  it('unions weights/styles/files on re-import of the same family', () => {
    let manifest = addEntryToManifest(emptyFontManifest(), entry)
    const italicEntry = buildImportedFontEntry(
      { family: 'Acme Sans', subfamily: 'Italic', weight: 700, italic: true, fromNameTable: true },
      { path: `${FONT_MEDIA_DIR}/Acme-BoldItalic.ttf`, weight: 700, italic: true },
      { scripts: ['latin'] }
    )
    manifest = addEntryToManifest(manifest, italicEntry)
    expect(manifest.imported).toHaveLength(1)
    expect(manifest.imported[0].weights).toEqual([400, 700])
    expect(manifest.imported[0].styles).toEqual(['normal', 'italic'])
    expect(manifest.imported[0].files).toHaveLength(2)
  })

  it('round-trips: a serialized manifest re-hydrates the registered family', () => {
    const manifest = addEntryToManifest(emptyFontManifest(), entry)
    // simulate persist → JSON → reopen
    const serialized: FontManifest = JSON.parse(JSON.stringify(manifest))

    const reg = createFontRegistry()
    expect(reg.hasFont('Acme Sans')).toBe(false)

    const registered = rehydrateImportedFonts(reg, serialized)
    expect(registered).toEqual(['Acme Sans'])
    expect(reg.hasFont('Acme Sans')).toBe(true)
    const got = reg.getFont('Acme Sans')!
    expect(got.source).toBe('imported')
    expect(got.files![0].path).toBe(`${FONT_MEDIA_DIR}/Acme-Regular.ttf`)
    // participates in the Latin fallback chain
    expect(reg.resolveFallbackChain('Acme Sans', 'latin')[0]).toBe('Acme Sans')
  })

  it('manifestEntryToFontEntry drops non-bundle-relative file paths defensively', () => {
    const entryOut = manifestEntryToFontEntry({
      family: 'Tampered',
      displayName: 'Tampered',
      category: 'sans',
      scripts: ['latin'],
      weights: [400],
      styles: ['normal'],
      files: [
        { path: '/abs/evil.ttf', weight: 400, italic: false },
        { path: `${FONT_MEDIA_DIR}/ok.ttf`, weight: 400, italic: false }
      ]
    })
    expect(entryOut.files).toHaveLength(1)
    expect(entryOut.files![0].path).toBe(`${FONT_MEDIA_DIR}/ok.ttf`)
  })
})

describe('rehydrateImportedFonts — robustness', () => {
  it('no-op on undefined manifest', () => {
    expect(rehydrateImportedFonts(createFontRegistry(), undefined)).toEqual([])
  })

  it('skips a record colliding with a bundled family (does not abort the open)', () => {
    const reg = createFontRegistry()
    const manifest: FontManifest = {
      imported: [
        // collides with a bundled family — must be skipped
        {
          family: 'Noto Sans Tamil',
          displayName: 'Noto Sans Tamil',
          category: 'sans',
          scripts: ['tamil', 'latin'],
          weights: [400],
          styles: ['normal'],
          files: [{ path: `${FONT_MEDIA_DIR}/NotoTamil.ttf`, weight: 400, italic: false }]
        },
        // a good record after it still registers
        {
          family: 'Good Imported',
          displayName: 'Good Imported',
          category: 'sans',
          scripts: ['latin'],
          weights: [400],
          styles: ['normal'],
          files: [{ path: `${FONT_MEDIA_DIR}/Good.ttf`, weight: 400, italic: false }]
        }
      ]
    }
    const registered = rehydrateImportedFonts(reg, manifest)
    expect(registered).toEqual(['Good Imported'])
    expect(reg.getFont('Noto Sans Tamil')!.source).toBe('bundled')
    expect(reg.hasFont('Good Imported')).toBe(true)
  })

  it('skips empty-family / scriptless / invalid-script records', () => {
    const reg = createFontRegistry()
    const manifest: FontManifest = {
      imported: [
        { family: '', displayName: '', category: 'sans', scripts: ['latin'], weights: [400], styles: ['normal'], files: [] },
        { family: 'No Scripts', displayName: 'No Scripts', category: 'sans', scripts: [], weights: [400], styles: ['normal'], files: [] },
        {
          family: 'Bogus Script',
          displayName: 'Bogus Script',
          category: 'sans',
          // @ts-expect-error testing an invalid script token
          scripts: ['klingon'],
          weights: [400],
          styles: ['normal'],
          files: []
        }
      ]
    }
    expect(rehydrateImportedFonts(reg, manifest)).toEqual([])
  })
})

describe('registry rejects duplicate / bundled-collision (imported)', () => {
  it('rejects a bundled-name imported entry directly', () => {
    const reg = createFontRegistry()
    const collide: FontEntry = buildImportedFontEntry(
      { family: 'Inter', subfamily: '', weight: 400, italic: false, fromNameTable: true },
      { path: `${FONT_MEDIA_DIR}/Inter.ttf`, weight: 400, italic: false },
      { scripts: ['latin'] }
    )
    expect(() => reg.registerFont(collide)).toThrow(/bundled/)
  })

  it('re-registering the same imported family replaces (no duplicate listing)', () => {
    const reg = createFontRegistry()
    const e = buildImportedFontEntry(
      { family: 'Dup Font', subfamily: '', weight: 400, italic: false, fromNameTable: true },
      { path: `${FONT_MEDIA_DIR}/Dup.ttf`, weight: 400, italic: false },
      { scripts: ['latin'] }
    )
    reg.registerFont(e)
    reg.registerFont({ ...e, weights: [700] })
    expect(reg.listFonts({ query: 'dup font' })).toHaveLength(1)
    expect(reg.getFont('Dup Font')!.weights).toEqual([700])
  })
})

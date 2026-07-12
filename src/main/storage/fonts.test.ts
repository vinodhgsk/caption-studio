import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readdir, writeFile, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importFontFile } from './fonts'
import { bundleLayout } from './bundle'
import { FONT_MEDIA_DIR, isBundleRelativeFontPath } from '../../shared/fontParse'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cs-fonts-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** A minimal sfnt with an id-1 family name, so the parse reads it back. */
function sfntWithFamily(family: string): Uint8Array {
  const text = new Uint8Array(family.length * 2)
  for (let i = 0; i < family.length; i++) {
    const c = family.charCodeAt(i)
    text[i * 2] = (c >> 8) & 0xff
    text[i * 2 + 1] = c & 0xff
  }
  const nameHeaderLen = 6 + 12 // one record
  const nameTable = new Uint8Array(nameHeaderLen + text.length)
  const nv = new DataView(nameTable.buffer)
  nv.setUint16(0, 0)
  nv.setUint16(2, 1)
  nv.setUint16(4, nameHeaderLen)
  nv.setUint16(6, 3) // platform Windows
  nv.setUint16(8, 1)
  nv.setUint16(10, 0x0409)
  nv.setUint16(12, 1) // nameId family
  nv.setUint16(14, text.length)
  nv.setUint16(16, 0)
  nameTable.set(text, nameHeaderLen)

  const dirLen = 12 + 16
  const buf = new Uint8Array(dirLen + nameTable.length)
  const v = new DataView(buf.buffer)
  v.setUint32(0, 0x00010000)
  v.setUint16(4, 1)
  v.setUint32(12, 0x6e616d65) // 'name'
  v.setUint32(20, dirLen)
  v.setUint32(24, nameTable.length)
  buf.set(nameTable, dirLen)
  return buf
}

describe('importFontFile — copies into media/fonts/ with a bundle-relative ref', () => {
  it('copies the bytes and returns a media/fonts/ ref + parsed family', async () => {
    const layout = bundleLayout(root)
    const src = join(root, 'Acme-Regular.ttf')
    await writeFile(src, sfntWithFamily('Acme Sans'))

    const result = await importFontFile(layout, src)

    expect(result.fileName).toBe('Acme-Regular.ttf')
    expect(result.fileRef.path).toBe(`${FONT_MEDIA_DIR}/Acme-Regular.ttf`)
    expect(isBundleRelativeFontPath(result.fileRef.path)).toBe(true)
    expect(result.metadata.family).toBe('Acme Sans')
    expect(result.metadata.fromNameTable).toBe(true)

    // the file physically landed in the bundle's media/fonts/
    const onDisk = await readdir(layout.fonts)
    expect(onDisk).toContain('Acme-Regular.ttf')
    // and the bytes match the source
    const copied = await readFile(join(layout.fonts, 'Acme-Regular.ttf'))
    expect(copied.length).toBe(sfntWithFamily('Acme Sans').length)
  })

  it('de-duplicates the filename on collision (Acme.ttf → "Acme 2.ttf")', async () => {
    const layout = bundleLayout(root)
    await mkdir(layout.fonts, { recursive: true })
    await writeFile(join(layout.fonts, 'Acme.ttf'), sfntWithFamily('Existing'))

    const src = join(root, 'Acme.ttf')
    await writeFile(src, sfntWithFamily('Acme Sans'))

    const result = await importFontFile(layout, src)
    expect(result.fileName).toBe('Acme 2.ttf')
    expect(result.fileRef.path).toBe(`${FONT_MEDIA_DIR}/Acme 2.ttf`)
  })

  it('falls back to the filename when the bytes are not a font', async () => {
    const layout = bundleLayout(root)
    const src = join(root, 'Weird-Bold.otf')
    await writeFile(src, new Uint8Array([1, 2, 3, 4]))

    const result = await importFontFile(layout, src)
    expect(result.metadata.fromNameTable).toBe(false)
    expect(result.metadata.family).toBe('Weird')
    expect(result.fileRef.weight).toBe(700)
  })
})

import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, cp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Project } from '../../shared/storage'
import { LocalProvider } from './LocalProvider'
import { bundleLayout } from './bundle'
import { GraphOneDriveProvider, createSyncedOneDriveProvider } from './OneDriveProvider'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'capstudio-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('LocalProvider bundle round-trip', () => {
  it('createProject → readProject → writeProject → readProject preserves mutations', async () => {
    const provider = new LocalProvider(root)
    const ref = await provider.createProject('My Demo')
    const created = await provider.readProject(ref)

    expect(created.name).toBe('My Demo')
    expect(created.createdAt).toBe(created.updatedAt)

    // Mutate name + a settings field.
    const mutated: Project = {
      ...created,
      name: 'Renamed',
      settings: { ...created.settings, fps: 60, aspect: '9:16' }
    }
    await provider.writeProject(ref, mutated)
    const reread = await provider.readProject(ref)

    expect(reread.name).toBe('Renamed')
    expect(reread.settings.fps).toBe(60)
    expect(reread.settings.aspect).toBe('9:16')
    expect(reread.createdAt).toBe(created.createdAt) // createdAt preserved
    expect(reread.updatedAt >= created.updatedAt).toBe(true) // updatedAt advanced (>=)
  })

  it('scaffolds media/, media/fonts/, cache/, exports/ and project.json', async () => {
    const provider = new LocalProvider(root)
    const ref = await provider.createProject('Layout Test')
    const layout = bundleLayout(ref.path)

    for (const dir of [layout.media, layout.fonts, layout.cache, layout.exports]) {
      const entries = await readdir(dir)
      expect(Array.isArray(entries)).toBe(true)
    }
    const json = await readFile(layout.projectJson, 'utf8')
    expect(() => JSON.parse(json)).not.toThrow()
  })

  it('listProjects returns meta and skips corrupt bundles', async () => {
    const provider = new LocalProvider(root)
    await provider.createProject('Alpha')
    await provider.createProject('Beta')

    // Plant a corrupt bundle.
    const { mkdir, writeFile } = await import('node:fs/promises')
    const corruptDir = join(root, 'Broken.vproj')
    await mkdir(corruptDir, { recursive: true })
    await writeFile(join(corruptDir, 'project.json'), '{ not json', 'utf8')

    const metas = await provider.listProjects()
    const names = metas.map((m) => m.name).sort()
    expect(names).toEqual(['Alpha', 'Beta'])
    expect(metas.every((m) => m.location === 'local')).toBe(true)
  })
})

describe('atomic writes', () => {
  it('leaves no .tmp files and keeps project.json valid across rewrites', async () => {
    const provider = new LocalProvider(root)
    const ref = await provider.createProject('Atomic')
    const layout = bundleLayout(ref.path)

    for (let i = 0; i < 3; i++) {
      const current = await provider.readProject(ref)
      await provider.writeProject(ref, { ...current, name: `Atomic ${i}` })
    }

    const entries = await readdir(ref.path)
    expect(entries.some((e) => e.includes('.tmp'))).toBe(false)

    const json = await readFile(layout.projectJson, 'utf8')
    expect(() => JSON.parse(json)).not.toThrow()
    expect(JSON.parse(json).name).toBe('Atomic 2')
  })
})

describe('local ↔ onedrive move without loss', () => {
  it('reads a copied bundle via the synced OneDrive provider equal to the original', async () => {
    const local = new LocalProvider(root)
    const ref = await local.createProject('Portable')
    const original = await local.readProject(ref)

    const oneDriveRoot = await mkdtemp(join(tmpdir(), 'capstudio-od-'))
    try {
      // Copy the whole bundle directory into the second root.
      const destBundle = join(oneDriveRoot, 'Portable.vproj')
      await cp(ref.path, destBundle, { recursive: true })

      const od = createSyncedOneDriveProvider(oneDriveRoot)
      const metas = await od.listProjects()
      expect(metas).toHaveLength(1)
      expect(metas[0].location).toBe('onedrive')

      const odRef = {
        id: metas[0].id,
        name: metas[0].name,
        location: metas[0].location,
        path: metas[0].path
      }
      const moved = await od.readProject(odRef)

      // Equal modulo storage.location/root (which reflect the new home).
      expect(moved.id).toBe(original.id)
      expect(moved.name).toBe(original.name)
      expect(moved.createdAt).toBe(original.createdAt)
      expect(moved.updatedAt).toBe(original.updatedAt)
      expect(moved.settings).toEqual(original.settings)
      expect(moved.tracks).toEqual(original.tracks)
    } finally {
      await rm(oneDriveRoot, { recursive: true, force: true })
    }
  })
})

describe('conflict detection (P1.11)', () => {
  it('flags conflict on stale expectedUpdatedAt and still writes (last-write-wins)', async () => {
    const provider = new LocalProvider(root)
    const ref = await provider.createProject('Conflicted')
    const current = await provider.readProject(ref)

    const stale = '1999-01-01T00:00:00.000Z'
    const result = await provider.writeProject(
      ref,
      { ...current, name: 'Overwritten' },
      stale
    )
    expect(result.conflict).toBe(true)
    expect(result.warning).toContain('modified elsewhere')

    const after = await provider.readProject(ref)
    expect(after.name).toBe('Overwritten') // data still written
  })

  it('reports no conflict when expectedUpdatedAt matches disk', async () => {
    const provider = new LocalProvider(root)
    const ref = await provider.createProject('Clean')
    const current = await provider.readProject(ref)

    const result = await provider.writeProject(
      ref,
      { ...current, name: 'Clean Edit' },
      current.updatedAt
    )
    expect(result.conflict).toBe(false)
  })
})

describe('duplicate / rename / delete (P2.4)', () => {
  it('duplicateProject creates a uniquely-named copy with a new id, leaving the original intact', async () => {
    const provider = new LocalProvider(root)
    const ref = await provider.createProject('Source')
    const original = await provider.readProject(ref)

    const copyRef = await provider.duplicateProject(ref)
    const copy = await provider.readProject(copyRef)

    // New bundle exists on disk with a copy name and a fresh id.
    expect(copyRef.name).toBe('Source copy')
    expect(copyRef.path).not.toBe(ref.path)
    expect(copy.id).not.toBe(original.id)
    expect(copy.name).toBe('Source copy')
    expect(copy.createdAt).toBe(copy.updatedAt)

    // Original untouched.
    const afterOriginal = await provider.readProject(ref)
    expect(afterOriginal.id).toBe(original.id)
    expect(afterOriginal.name).toBe('Source')

    // A second duplicate gets a unique name.
    const copy2Ref = await provider.duplicateProject(ref)
    expect(copy2Ref.name).toBe('Source copy 2')
    expect(copy2Ref.path).not.toBe(copyRef.path)

    // Listing now has all three with distinct ids.
    const metas = await provider.listProjects()
    const ids = metas.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(metas.map((m) => m.name).sort()).toEqual(['Source', 'Source copy', 'Source copy 2'])
  })

  it('renameProject renames the bundle dir + project.json and returns a working ref', async () => {
    const provider = new LocalProvider(root)
    const ref = await provider.createProject('Before')
    const oldPath = ref.path

    const renamedRef = await provider.renameProject(ref, 'After')

    // Returned ref points at the new directory; the old one is gone.
    expect(renamedRef.path).not.toBe(oldPath)
    expect(renamedRef.path.endsWith('After.vproj')).toBe(true)
    expect(renamedRef.name).toBe('After')
    expect(existsSync(oldPath)).toBe(false)
    expect(existsSync(renamedRef.path)).toBe(true)

    // project.json name updated; reading via the new ref works.
    const reread = await provider.readProject(renamedRef)
    expect(reread.name).toBe('After')
    expect(reread.id).toBe(renamedRef.id)
    expect(reread.updatedAt >= reread.createdAt).toBe(true)
  })

  it('deleteProject removes the bundle directory', async () => {
    const provider = new LocalProvider(root)
    const ref = await provider.createProject('Doomed')
    expect(existsSync(ref.path)).toBe(true)

    await provider.deleteProject(ref)

    expect(existsSync(ref.path)).toBe(false)
    const metas = await provider.listProjects()
    expect(metas.some((m) => m.id === ref.id)).toBe(false)
  })
})

describe('copyMedia / import (P3.3)', () => {
  it('copies a source file into media/ and returns mediaRef + kind', async () => {
    const provider = new LocalProvider(root)
    const ref = await provider.createProject('Import Test')

    // Create a fake source file outside the bundle.
    const srcDir = await mkdtemp(join(tmpdir(), 'capstudio-src-'))
    const src = join(srcDir, 'clip.mp4')
    await writeFile(src, 'fake-bytes', 'utf8')

    const result = await provider.copyMedia(ref, src)
    expect(result.mediaRef).toBe('media/clip.mp4')
    expect(result.fileName).toBe('clip.mp4')
    expect(result.kind).toBe('video')

    const layout = bundleLayout(ref.path)
    expect(existsSync(join(layout.media, 'clip.mp4'))).toBe(true)
    expect(await readFile(join(layout.media, 'clip.mp4'), 'utf8')).toBe('fake-bytes')

    await rm(srcDir, { recursive: true, force: true })
  })

  it('de-duplicates the filename on collision (clip.mp4 → clip 2.mp4)', async () => {
    const provider = new LocalProvider(root)
    const ref = await provider.createProject('Dedupe Test')

    const srcDir = await mkdtemp(join(tmpdir(), 'capstudio-src-'))
    const src = join(srcDir, 'clip.mp4')
    await writeFile(src, 'a', 'utf8')

    const first = await provider.copyMedia(ref, src)
    const second = await provider.copyMedia(ref, src)
    const third = await provider.copyMedia(ref, src)

    expect(first.fileName).toBe('clip.mp4')
    expect(second.fileName).toBe('clip 2.mp4')
    expect(third.fileName).toBe('clip 3.mp4')
    expect(second.mediaRef).toBe('media/clip 2.mp4')

    await rm(srcDir, { recursive: true, force: true })
  })

  it('derives image kind from extension', async () => {
    const provider = new LocalProvider(root)
    const ref = await provider.createProject('Image Test')

    const srcDir = await mkdtemp(join(tmpdir(), 'capstudio-src-'))
    const src = join(srcDir, 'photo.PNG')
    await writeFile(src, 'img', 'utf8')

    const result = await provider.copyMedia(ref, src)
    expect(result.kind).toBe('image')
    expect(result.fileName).toBe('photo.PNG')

    await rm(srcDir, { recursive: true, force: true })
  })
})

describe('GraphOneDriveProvider stub (P1.8–P1.10)', () => {
  it('rejects/throws not-implemented from every method', async () => {
    const g = new GraphOneDriveProvider()
    const ref = { id: 'x', name: 'x', location: 'onedrive' as const, path: '/x' }
    const project = {} as Project

    await expect(g.authenticate()).rejects.toThrow(/not implemented/)
    await expect(g.listProjects()).rejects.toThrow(/not implemented/)
    await expect(g.createProject('x')).rejects.toThrow(/not implemented/)
    await expect(g.readProject(ref)).rejects.toThrow(/not implemented/)
    await expect(g.writeProject(ref, project)).rejects.toThrow(/not implemented/)
    await expect(g.readMedia(ref, 'a.mp4')).rejects.toThrow(/not implemented/)
    await expect(g.writeOutput(ref, 'out.mp4', Buffer.alloc(0))).rejects.toThrow(
      /not implemented/
    )
    expect(() => g.resolvePath(ref)).toThrow(/not implemented/)
    await expect(g.duplicateProject(ref)).rejects.toThrow(/not implemented/)
    await expect(g.renameProject(ref, 'y')).rejects.toThrow(/not implemented/)
    await expect(g.deleteProject(ref)).rejects.toThrow(/not implemented/)
    await expect(g.copyMedia(ref, '/src/a.mp4')).rejects.toThrow(/not implemented/)
  })
})

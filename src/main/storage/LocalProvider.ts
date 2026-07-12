/**
 * Filesystem-backed StorageProvider. NO electron import so it can be unit-tested
 * against an arbitrary tmp root (and reused by OneDrive synced-folder mode).
 */
import { randomUUID } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { copyFile, cp, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Readable } from 'node:stream'
import type {
  ImportFontResult,
  ImportMediaResult,
  Project,
  ProjectMeta,
  ProjectRef,
  StorageLocation,
  StorageProvider,
  WriteResult
} from '../../shared/storage'
import { dedupeFileName, mediaKindFromExtension } from './media'
import { importFontFile } from './fonts'
import { writeFileAtomic, writeJsonAtomic } from './atomic'
import {
  bundleDirName,
  bundleLayout,
  defaultProject,
  sanitizeProjectName,
  scaffoldBundleDirs
} from './bundle'

const VPROJ_SUFFIX = '.vproj'

export class LocalProvider implements StorageProvider {
  constructor(
    private readonly root: string,
    private readonly location: StorageLocation = 'local'
  ) {}

  async listProjects(): Promise<ProjectMeta[]> {
    await mkdir(this.root, { recursive: true })
    const entries = await readdir(this.root, { withFileTypes: true })
    const metas: ProjectMeta[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.endsWith(VPROJ_SUFFIX)) continue
      const bundlePath = join(this.root, entry.name)
      try {
        const project = await this.readBundle(bundlePath)
        metas.push(this.toMeta(project, bundlePath))
      } catch {
        // Corrupt/incomplete bundle — skip it rather than failing the whole list.
        continue
      }
    }
    metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return metas
  }

  async createProject(name: string): Promise<ProjectRef> {
    await mkdir(this.root, { recursive: true })
    const safeName = sanitizeProjectName(name)
    const bundlePath = join(this.root, bundleDirName(name))
    await scaffoldBundleDirs(bundlePath)

    const id = randomUUID()
    const now = new Date().toISOString()
    const project = defaultProject(safeName, id, now)
    project.storage = { location: this.location, root: this.root }

    const layout = bundleLayout(bundlePath)
    await writeJsonAtomic(layout.projectJson, project)

    return { id, name: safeName, location: this.location, path: bundlePath }
  }

  async readProject(ref: ProjectRef): Promise<Project> {
    return this.readBundle(ref.path)
  }

  async writeProject(
    ref: ProjectRef,
    project: Project,
    expectedUpdatedAt?: string
  ): Promise<WriteResult> {
    const layout = bundleLayout(ref.path)

    // P1.11 conflict detection: compare the caller's baseline against disk.
    let conflict = false
    if (expectedUpdatedAt !== undefined) {
      try {
        const onDisk = await this.readBundle(ref.path)
        if (onDisk.updatedAt !== expectedUpdatedAt) conflict = true
      } catch {
        // No readable existing project — treat as a fresh write, no conflict.
      }
    }

    const next: Project = {
      ...project,
      updatedAt: new Date().toISOString(),
      storage: { location: this.location, root: this.root }
    }
    await writeJsonAtomic(layout.projectJson, next)

    return conflict
      ? {
          conflict: true,
          warning:
            'Project was modified elsewhere; your changes overwrote the newer version.'
        }
      : { conflict: false }
  }

  async readMedia(ref: ProjectRef, mediaRelPath: string): Promise<Readable> {
    const layout = bundleLayout(ref.path)
    return createReadStream(join(layout.media, mediaRelPath))
  }

  async writeOutput(ref: ProjectRef, relPath: string, data: Buffer): Promise<void> {
    const layout = bundleLayout(ref.path)
    const target = join(layout.exports, relPath)
    // Ensure any nested export subdirectory exists before writing.
    await mkdir(join(target, '..'), { recursive: true })
    await writeFileAtomic(target, data)
  }

  resolvePath(ref: ProjectRef): string {
    return ref.path
  }

  async copyMedia(ref: ProjectRef, sourceAbsPath: string): Promise<ImportMediaResult> {
    const layout = bundleLayout(ref.path)
    await mkdir(layout.media, { recursive: true })

    // De-duplicate against names already in media/ (e.g. "clip.mp4" → "clip 2.mp4").
    const existing = new Set(await readdir(layout.media))
    const fileName = dedupeFileName(basename(sourceAbsPath), existing)

    await copyFile(sourceAbsPath, join(layout.media, fileName))

    return {
      mediaRef: `media/${fileName}`,
      fileName,
      kind: mediaKindFromExtension(fileName)
    }
  }

  async copyFont(ref: ProjectRef, sourceAbsPath: string): Promise<ImportFontResult> {
    return importFontFile(bundleLayout(ref.path), sourceAbsPath)
  }

  async duplicateProject(ref: ProjectRef, copyName?: string): Promise<ProjectRef> {
    await mkdir(this.root, { recursive: true })
    const source = await this.readBundle(ref.path)

    // Derive a unique, sanitized copy name + bundle directory.
    const baseName = sanitizeProjectName(copyName ?? `${source.name} copy`)
    const name = this.uniqueName(baseName)
    const destPath = join(this.root, `${name}${VPROJ_SUFFIX}`)

    // Copy the whole bundle (media, cache, exports, project.json), then rewrite
    // the header to give the copy its own identity.
    await cp(ref.path, destPath, { recursive: true })

    const id = randomUUID()
    const now = new Date().toISOString()
    const copy: Project = {
      ...source,
      id,
      name,
      createdAt: now,
      updatedAt: now,
      storage: { location: this.location, root: this.root }
    }
    const layout = bundleLayout(destPath)
    await writeJsonAtomic(layout.projectJson, copy)

    return { id, name, location: this.location, path: destPath }
  }

  async renameProject(ref: ProjectRef, name: string): Promise<ProjectRef> {
    await mkdir(this.root, { recursive: true })
    const safeName = this.uniqueName(sanitizeProjectName(name), ref.path)
    const destPath = join(this.root, `${safeName}${VPROJ_SUFFIX}`)

    if (destPath !== ref.path) {
      await rename(ref.path, destPath)
    }

    const project = await this.readBundle(destPath)
    const next: Project = {
      ...project,
      name: safeName,
      updatedAt: new Date().toISOString(),
      storage: { location: this.location, root: this.root }
    }
    const layout = bundleLayout(destPath)
    await writeJsonAtomic(layout.projectJson, next)

    return { id: next.id, name: safeName, location: this.location, path: destPath }
  }

  async deleteProject(ref: ProjectRef): Promise<void> {
    await rm(ref.path, { recursive: true, force: true })
  }

  async archiveProject(ref: ProjectRef, archived: boolean): Promise<void> {
    const project = await this.readBundle(ref.path)
    const next: Project = {
      ...project,
      archived,
      updatedAt: new Date().toISOString(),
      storage: { location: this.location, root: this.root }
    }
    const layout = bundleLayout(ref.path)
    await writeJsonAtomic(layout.projectJson, next)
  }

  /**
   * Find a free `<name>.vproj` directory name in the root, appending " 2",
   * " 3", … on collision. `ignorePath` lets a rename keep its own directory.
   */
  private uniqueName(base: string, ignorePath?: string): string {
    const candidatePath = (n: string): string => join(this.root, `${n}${VPROJ_SUFFIX}`)
    const taken = (n: string): boolean => {
      const path = candidatePath(n)
      if (ignorePath !== undefined && path === ignorePath) return false
      return existsSync(path)
    }
    if (!taken(base)) return base
    for (let i = 2; ; i++) {
      const candidate = `${base} ${i}`
      if (!taken(candidate)) return candidate
    }
  }

  /** Read + parse a bundle's project.json. Throws on missing/invalid JSON. */
  private async readBundle(bundlePath: string): Promise<Project> {
    const layout = bundleLayout(bundlePath)
    const raw = await readFile(layout.projectJson, 'utf8')
    return JSON.parse(raw) as Project
  }

  private toMeta(project: Project, bundlePath: string): ProjectMeta {
    return {
      id: project.id,
      name: project.name,
      location: this.location,
      path: bundlePath,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      aspect: project.settings?.aspect,
      archived: project.archived
    }
  }
}

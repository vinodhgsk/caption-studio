/**
 * OneDrive storage. NO electron import.
 *
 * Two modes (master plan §5, doc 09):
 *   1. Synced-folder mode (P1.7) — fully implemented: the OneDrive client syncs
 *      a local folder, so we just point a LocalProvider at it. We delegate to
 *      LocalProvider rather than duplicating its logic.
 *   2. Graph API mode (P1.8–P1.10) — STUB: MSAL auth + Graph drive items, local
 *      cache, reconcile on reconnect. Deferred; no MSAL/Graph SDK deps yet. The
 *      stub throws `notImplemented` from every method; the IPC handle() wrapper
 *      converts that throw into { ok:false, error } for the renderer.
 */
import { homedir } from 'node:os'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ImportFontResult,
  ImportMediaResult,
  Project,
  ProjectMeta,
  ProjectRef,
  StorageProvider,
  WriteResult
} from '../../shared/storage'
import { LocalProvider } from './LocalProvider'

/** Subfolder created inside the OneDrive root for Caption Studio projects. */
const ONEDRIVE_SUBDIR = 'CaptionStudio'

/**
 * Locate the user's locally-synced OneDrive folder, or null if none is present.
 * - Windows: the OneDrive client exports env vars.
 * - macOS: OneDrive syncs under ~/Library/CloudStorage/OneDrive-* (newer) or
 *   ~/OneDrive (legacy).
 */
export function detectOneDrivePath(): string | null {
  // Windows env vars set by the OneDrive client.
  for (const key of ['OneDrive', 'OneDriveCommercial', 'OneDriveConsumer']) {
    const value = process.env[key]
    if (value && existsSync(value)) return value
  }

  // macOS CloudStorage location: pick the first OneDrive-* mount.
  const cloudStorage = join(homedir(), 'Library', 'CloudStorage')
  if (existsSync(cloudStorage)) {
    try {
      const match = readdirSync(cloudStorage).find((name) => name.startsWith('OneDrive'))
      if (match) return join(cloudStorage, match)
    } catch {
      // Unreadable directory — fall through to the legacy check.
    }
  }

  // macOS legacy location.
  const legacy = join(homedir(), 'OneDrive')
  if (existsSync(legacy)) return legacy

  return null
}

/**
 * Build a synced-folder OneDrive provider. Reuses LocalProvider (delegation)
 * rooted at `<override ?? detected>/CaptionStudio`, tagged location:'onedrive'.
 */
export function createSyncedOneDriveProvider(rootOverride?: string): LocalProvider {
  const base = rootOverride ?? detectOneDrivePath()
  if (base === null) {
    throw new Error('No synced OneDrive folder detected')
  }
  const root = rootOverride ? base : join(base, ONEDRIVE_SUBDIR)
  return new LocalProvider(root, 'onedrive')
}

/** Throw a uniform not-implemented error for deferred Graph features. */
function notImplemented(feature: string): never {
  throw new Error(`${feature} is not implemented yet`)
}

/**
 * Graph API mode (P1.8–P1.10) STUB. MSAL auth + Graph drive item I/O, local
 * cache, and reconcile-on-reconnect are deferred. Every method throws so the
 * renderer receives a not-implemented IpcResult via the handle() wrapper.
 */
export class GraphOneDriveProvider implements StorageProvider {
  /** STUB: would run the MSAL interactive auth flow in main. */
  async authenticate(): Promise<void> {
    return notImplemented('OneDrive Graph mode')
  }

  async listProjects(): Promise<ProjectMeta[]> {
    return notImplemented('OneDrive Graph mode')
  }

  async createProject(_name: string): Promise<ProjectRef> {
    return notImplemented('OneDrive Graph mode')
  }

  async readProject(_ref: ProjectRef): Promise<Project> {
    return notImplemented('OneDrive Graph mode')
  }

  async writeProject(
    _ref: ProjectRef,
    _project: Project,
    _expectedUpdatedAt?: string
  ): Promise<WriteResult> {
    return notImplemented('OneDrive Graph mode')
  }

  async readMedia(
    _ref: ProjectRef,
    _mediaRelPath: string
  ): Promise<import('node:stream').Readable> {
    return notImplemented('OneDrive Graph mode')
  }

  async writeOutput(_ref: ProjectRef, _relPath: string, _data: Buffer): Promise<void> {
    return notImplemented('OneDrive Graph mode')
  }

  async copyMedia(_ref: ProjectRef, _sourceAbsPath: string): Promise<ImportMediaResult> {
    return notImplemented('OneDrive Graph mode')
  }

  async copyFont(_ref: ProjectRef, _sourceAbsPath: string): Promise<ImportFontResult> {
    return notImplemented('OneDrive Graph mode')
  }

  // Synchronous in the interface — throws directly (the handle() wrapper still
  // converts the throw into { ok:false, error }).
  resolvePath(_ref: ProjectRef): string {
    return notImplemented('OneDrive Graph mode')
  }

  async duplicateProject(_ref: ProjectRef, _copyName?: string): Promise<ProjectRef> {
    return notImplemented('OneDrive Graph mode')
  }

  async renameProject(_ref: ProjectRef, _name: string): Promise<ProjectRef> {
    return notImplemented('OneDrive Graph mode')
  }

  async deleteProject(_ref: ProjectRef): Promise<void> {
    return notImplemented('OneDrive Graph mode')
  }
}

export { notImplemented }

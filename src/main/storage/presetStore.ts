/**
 * User-preset file store (P11.1, Doc 14).
 *
 * Persists user-managed `UserPreset`s as a JSON array in
 * `<app-data>/presets.json`. On macOS the path resolves to
 * `~/Library/Application Support/caption-studio/presets.json`.
 *
 * Reads are lazy (cold on first call per process). Writes are atomic (via the
 * shared `writeJsonAtomic` helper) so the file is never partially-written.
 *
 * IPC handlers registered here:
 *   preset:list    — returns all saved presets
 *   preset:save    — upsert a preset (insert or replace by id)
 *   preset:delete  — remove by id
 *   preset:import  — validate + bulk-insert from a JSON string
 *   preset:export  — return a single preset as a JSON string for download
 */
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { writeJsonAtomic } from './atomic'
import { parseUserPreset, validateUserPreset, type UserPreset } from '../../shared/userPreset'
import { handle } from '../ipc'

// ---------------------------------------------------------------------------
// File path
// ---------------------------------------------------------------------------

function presetsFilePath(): string {
  return join(app.getPath('userData'), 'presets.json')
}

// ---------------------------------------------------------------------------
// In-memory cache (loaded once per process, flushed after each write)
// ---------------------------------------------------------------------------

let cache: UserPreset[] | null = null

async function ensureDataDir(): Promise<void> {
  await mkdir(join(app.getPath('userData')), { recursive: true })
}

async function readAll(): Promise<UserPreset[]> {
  if (cache !== null) return cache
  try {
    const raw = await readFile(presetsFilePath(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      cache = []
    } else {
      cache = parsed
        .map((item: unknown) => {
          const r = parseUserPreset(item)
          return r.ok ? r.preset : null
        })
        .filter((p): p is UserPreset => p !== null)
    }
  } catch {
    // File does not exist yet or parse error → start fresh.
    cache = []
  }
  return cache
}

async function writeAll(presets: UserPreset[]): Promise<void> {
  await ensureDataDir()
  await writeJsonAtomic(presetsFilePath(), presets)
  cache = presets
}

// ---------------------------------------------------------------------------
// Public CRUD
// ---------------------------------------------------------------------------

/** Return all saved user presets (ordered by `createdAt` descending). */
export async function listPresets(): Promise<UserPreset[]> {
  const all = await readAll()
  return [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Upsert a preset: replace by id when id already exists, otherwise append. */
export async function savePreset(preset: UserPreset): Promise<void> {
  const all = await readAll()
  const idx = all.findIndex((p) => p.id === preset.id)
  if (idx >= 0) {
    all[idx] = preset
  } else {
    all.push(preset)
  }
  await writeAll(all)
}

/** Delete a preset by id. No-op when not found. */
export async function deletePreset(id: string): Promise<void> {
  const all = await readAll()
  const next = all.filter((p) => p.id !== id)
  await writeAll(next)
}

/**
 * Import a JSON pack (string). Validates each preset; rejects malformed ones.
 * Returns `{ imported, skipped, errors }`.
 */
export async function importPresets(
  jsonText: string
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return { imported: 0, skipped: 0, errors: ['Invalid JSON'] }
  }

  const items = Array.isArray(parsed) ? parsed : [parsed]
  const all = await readAll()

  let imported = 0
  let skipped = 0
  const errors: string[] = []

  for (const item of items) {
    const errs = validateUserPreset(item)
    if (errs.length > 0) {
      errors.push(errs.map((e) => `${e.field}: ${e.message}`).join('; '))
      skipped++
      continue
    }
    const preset = item as UserPreset
    const idx = all.findIndex((p) => p.id === preset.id)
    if (idx >= 0) {
      all[idx] = preset
    } else {
      all.push(preset)
    }
    imported++
  }

  if (imported > 0) await writeAll(all)
  return { imported, skipped, errors }
}

/** Serialize a single preset to a JSON string for download. */
export async function exportPreset(id: string): Promise<string | null> {
  const all = await readAll()
  const preset = all.find((p) => p.id === id)
  if (preset === undefined) return null
  return JSON.stringify(preset, null, 2)
}

// ---------------------------------------------------------------------------
// IPC registration
// ---------------------------------------------------------------------------

/** Register the `preset:` IPC domain (called from main/index.ts). */
export function registerPresetIpc(): void {
  handle('preset:list', async () => {
    return listPresets()
  })

  handle('preset:save', async (request) => {
    await savePreset(request.preset)
    return { saved: true as const }
  })

  handle('preset:delete', async (request) => {
    await deletePreset(request.id)
    return { deleted: true as const }
  })

  handle('preset:import', async (request) => {
    return importPresets(request.json)
  })

  handle('preset:export', async (request) => {
    const json = await exportPreset(request.id)
    return { json }
  })
}

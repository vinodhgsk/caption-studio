import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { LocalProvider } from './LocalProvider'

/**
 * Locate the user's Synology Drive synced folder.
 * - Checks environment overrides first.
 * - Falls back to ~/SynologyDrive.
 */
export function detectSynologyDrivePath(): string | null {
  if (process.env.CAPTION_STUDIO_E2E === '1') {
    return null
  }

  for (const key of ['SynologyDrive', 'SYNOLOGY_DRIVE']) {
    const value = process.env[key]
    if (value && existsSync(value)) return value
  }

  const defaultPath = join(homedir(), 'SynologyDrive')
  if (existsSync(defaultPath)) return defaultPath

  return null
}

/**
 * Build a synced-folder Synology Drive provider. Reuses LocalProvider (delegation)
 * rooted at `<override ?? detected>/CaptionStudio`, tagged location:'synology'.
 */
export function createSyncedSynologyDriveProvider(rootOverride?: string): LocalProvider {
  const base = rootOverride ?? detectSynologyDrivePath()
  if (base === null) {
    throw new Error(
      'Synology Drive Client is not running, or default folder "SynologyDrive" was not found in your user home.'
    )
  }
  const root = join(base, 'CaptionStudio')
  return new LocalProvider(root, 'synology')
}

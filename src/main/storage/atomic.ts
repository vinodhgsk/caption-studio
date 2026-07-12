/**
 * Atomic JSON writes. NO electron import.
 *
 * Write to a sibling temp file then `rename` onto the target — `rename` is
 * atomic on the same volume, so readers never observe a partial file and an
 * interrupted write leaves the previous target intact.
 */
import { randomBytes } from 'node:crypto'
import { rename, unlink, writeFile } from 'node:fs/promises'

/**
 * Serialize `obj` to JSON and atomically replace `filePath`.
 * On any failure the temp file is cleaned up and the original target survives.
 */
export async function writeJsonAtomic(filePath: string, obj: unknown): Promise<void> {
  const tmpPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`
  const json = `${JSON.stringify(obj, null, 2)}\n`
  try {
    await writeFile(tmpPath, json, 'utf8')
    await rename(tmpPath, filePath)
  } catch (err) {
    // Best-effort cleanup; ignore if the temp file is already gone.
    await unlink(tmpPath).catch(() => undefined)
    throw err
  }
}

/**
 * Atomic write for arbitrary binary output (exports). Same temp + rename dance.
 */
export async function writeFileAtomic(filePath: string, data: Buffer): Promise<void> {
  const tmpPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(tmpPath, data)
    await rename(tmpPath, filePath)
  } catch (err) {
    await unlink(tmpPath).catch(() => undefined)
    throw err
  }
}

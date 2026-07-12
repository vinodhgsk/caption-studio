/**
 * Dependency-free WAV duration reader (P4 lyrics-first robustness).
 *
 * The lyrics-first alignment needs the total audio length to spread SYNTHETIC
 * word timings across the whole song when the STT provider yields no timing
 * evidence (e.g. whisper.cpp is not installed and the stub returns zero words).
 * Rather than shell out to ffprobe (which may also be absent), we parse the
 * canonical PCM WAV header of the normalized 16 kHz mono file we produced.
 *
 * PURE parser (`wavDurationFromHeader`) + a thin file reader (`readWavDurationSec`)
 * that only reads the first bytes of the file — never the whole PCM payload.
 */
import { open } from 'node:fs/promises'

/**
 * Compute the duration (seconds) of a PCM WAV from its header bytes. Scans the
 * RIFF chunks for `fmt ` (sample rate, channels, bits) and `data` (byte length),
 * then `duration = dataBytes / (sampleRate * channels * bytesPerSample)`.
 * Returns null when the header is malformed or fields are missing/zero.
 */
export function wavDurationFromHeader(buf: Buffer): number | null {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    return null
  }
  let sampleRate = 0
  let channels = 0
  let bitsPerSample = 0
  let dataBytes = 0

  let p = 12
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4)
    const size = buf.readUInt32LE(p + 4)
    if (id === 'fmt ' && p + 24 <= buf.length) {
      channels = buf.readUInt16LE(p + 10)
      sampleRate = buf.readUInt32LE(p + 12)
      bitsPerSample = buf.readUInt16LE(p + 22)
    } else if (id === 'data') {
      dataBytes = size
      break
    }
    // Chunks are word-aligned (a pad byte follows an odd size).
    p += 8 + size + (size % 2)
  }

  const bytesPerSample = Math.floor(bitsPerSample / 8)
  const frameBytes = sampleRate * channels * bytesPerSample
  if (frameBytes <= 0 || dataBytes <= 0) return null
  const duration = dataBytes / frameBytes
  return Number.isFinite(duration) && duration > 0 ? duration : null
}

/**
 * Read just the header region of a WAV file and return its duration in seconds,
 * or null on any failure. Reads at most `maxHeaderBytes` (default 64 KiB) so the
 * `data` chunk descriptor is captured without loading the PCM payload.
 */
export async function readWavDurationSec(absPath: string, maxHeaderBytes = 65536): Promise<number | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(absPath, 'r')
    const buf = Buffer.alloc(maxHeaderBytes)
    const { bytesRead } = await handle.read(buf, 0, maxHeaderBytes, 0)
    return wavDurationFromHeader(buf.subarray(0, bytesRead))
  } catch {
    return null
  } finally {
    if (handle !== null) await handle.close()
  }
}

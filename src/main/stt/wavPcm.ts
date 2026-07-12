/**
 * Dependency-free PCM sample reader for the normalized WAV (lyrics-first VAD).
 *
 * Sibling of {@link ./wavDuration} (which reads only the header). Vocal-activity
 * detection (`src/shared/vocalActivity.ts`) and energy-onset detection
 * (`src/shared/beatDetect.ts`) need the actual mono PCM samples, so this module
 * scans the RIFF chunks, finds the `data` chunk, and decodes 16-bit little-endian
 * samples into a normalized Float32Array in [-1, 1].
 *
 * The file is ALWAYS the WAV produced by `normalizeAudio` (`-ac 1 -ar 16000`), so
 * it is guaranteed mono 16 kHz 16-bit PCM. Anything else returns null and the
 * caller falls back to the non-acoustic alignment strategy. No audio bytes cross
 * IPC — this runs in MAIN and reads the bundle's cache WAV directly.
 */
import { readFile } from 'node:fs/promises'

/** Decoded mono PCM signal: normalized samples in [-1, 1] plus the sample rate. */
export interface WavPcmMono {
  samples: Float32Array
  sampleRate: number
}

/**
 * Parse a canonical 16-bit PCM WAV buffer into mono Float32 samples. Scans the
 * RIFF chunks for `fmt ` (rate/channels/bits) and `data` (payload), decoding the
 * payload as int16 LE. Multi-channel input is downmixed to mono by averaging
 * channels (the normalized file is mono, but this keeps the parser robust).
 * Returns null for a malformed header or a non-16-bit format.
 */
export function wavPcmMonoFromBuffer(buf: Buffer): WavPcmMono | null {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    return null
  }

  let sampleRate = 0
  let channels = 0
  let bitsPerSample = 0
  let dataOffset = -1
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
      dataOffset = p + 8
      // Clamp to what is actually present in the buffer.
      dataBytes = Math.min(size, buf.length - dataOffset)
      break
    }
    // Chunks are word-aligned (a pad byte follows an odd size).
    p += 8 + size + (size % 2)
  }

  if (bitsPerSample !== 16 || channels <= 0 || sampleRate <= 0 || dataOffset < 0 || dataBytes <= 0) {
    return null
  }

  const bytesPerSample = 2
  const frameBytes = bytesPerSample * channels
  const frames = Math.floor(dataBytes / frameBytes)
  if (frames <= 0) return null

  const samples = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let sum = 0
    const base = dataOffset + f * frameBytes
    for (let c = 0; c < channels; c++) {
      sum += buf.readInt16LE(base + c * bytesPerSample)
    }
    // Average channels, then normalize int16 → [-1, 1].
    samples[f] = sum / channels / 32768
  }

  return { samples, sampleRate }
}

/**
 * Read a WAV file's PCM payload and return mono Float32 samples + sample rate, or
 * null on any failure (missing file, malformed/unsupported format). Reads the
 * whole file — the normalized 16 kHz mono WAV is small (~1.9 MB/min).
 */
export async function readWavPcmMono(absPath: string): Promise<WavPcmMono | null> {
  try {
    const buf = await readFile(absPath)
    return wavPcmMonoFromBuffer(buf)
  } catch {
    return null
  }
}

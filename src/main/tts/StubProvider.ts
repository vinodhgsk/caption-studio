/**
 * Stub TTS provider (P10.1–P10.3). A deterministic placeholder that satisfies
 * the {@link TTSProvider} contract so the IPC channel + registry can be wired
 * and tested BEFORE a real TTS engine (cloud/local) lands.
 *
 * `listVoices()` returns 6 stub voices — one per supported language, Tamil first.
 * `synthesize()` writes a minimal silent WAV (44-byte RIFF/PCM header) into the
 * bundle's `media/` directory and returns `{ mediaRef, duration: 2.0 }`. It does
 * NOT call any speech engine — it is a shape-correct no-op.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TTSProvider, TTSSynthesizeRequest, TTSSynthesizeResult, TTSVoice } from '../../shared/tts'

/** The stub 6-voice list — one per supported language, Tamil first. */
const STUB_VOICES: TTSVoice[] = [
  { id: 'stub-ta', name: 'Tamil Voice', language: 'ta', gender: 'female' },
  { id: 'stub-te', name: 'Telugu Voice', language: 'te', gender: 'female' },
  { id: 'stub-ml', name: 'Malayalam Voice', language: 'ml', gender: 'female' },
  { id: 'stub-kn', name: 'Kannada Voice', language: 'kn', gender: 'female' },
  { id: 'stub-hi', name: 'Hindi Voice', language: 'hi', gender: 'female' },
  { id: 'stub-en', name: 'English Voice', language: 'en', gender: 'female' }
]

/**
 * Build a minimal valid WAV file containing 2 seconds of silence at 22 050 Hz,
 * mono, 16-bit PCM. This is the smallest structurally-valid WAV that a media
 * element will accept without error (useful for preview without a real provider).
 */
function buildSilentWav(durationSec: number): Buffer {
  const sampleRate = 22050
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
  const numSamples = Math.round(sampleRate * durationSec)
  const dataSize = numSamples * numChannels * (bitsPerSample / 8)
  const headerSize = 44
  const buf = Buffer.alloc(headerSize + dataSize, 0)

  // RIFF chunk descriptor
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8, 'ascii')
  // fmt sub-chunk
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)          // sub-chunk size
  buf.writeUInt16LE(1, 20)           // PCM = 1
  buf.writeUInt16LE(numChannels, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(byteRate, 28)
  buf.writeUInt16LE(numChannels * (bitsPerSample / 8), 32) // block align
  buf.writeUInt16LE(bitsPerSample, 34)
  // data sub-chunk
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(dataSize, 40)
  // samples are already zeroed (silence)

  return buf
}

export class StubTtsProvider implements TTSProvider {
  readonly id = 'stub'

  async listVoices(): Promise<TTSVoice[]> {
    return STUB_VOICES
  }

  async synthesize(bundlePath: string, req: TTSSynthesizeRequest): Promise<TTSSynthesizeResult> {
    const duration = 2.0
    const timestamp = Date.now()
    const filename = `tts-${timestamp}.wav`
    const mediaDir = join(bundlePath, 'media')
    await mkdir(mediaDir, { recursive: true })
    const absPath = join(mediaDir, filename)
    const wavData = buildSilentWav(duration)
    await writeFile(absPath, wavData)

    const mediaRef = `media/${filename}`
    const result: TTSSynthesizeResult = { mediaRef, duration }
    if (req.wordTimings === true) {
      // Return a single dummy timing spanning the whole duration.
      result.wordTimings = [{ word: req.text, start: 0, end: duration }]
    }
    return result
  }
}

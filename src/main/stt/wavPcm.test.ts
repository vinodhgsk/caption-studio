/**
 * Tests for the PCM sample reader used by lyrics-first VAD phrase-sync.
 * Builds canonical 16-bit PCM WAV buffers in memory and asserts decoding.
 */
import { describe, expect, it } from 'vitest'
import { wavPcmMonoFromBuffer } from './wavPcm'

/** Build a minimal canonical PCM WAV buffer from int16 samples. */
function makeWav(int16: number[], sampleRate: number, channels = 1): Buffer {
  const bytesPerSample = 2
  const dataBytes = int16.length * bytesPerSample
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16) // fmt chunk size
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(channels, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * channels * bytesPerSample, 28) // byte rate
  buf.writeUInt16LE(channels * bytesPerSample, 32) // block align
  buf.writeUInt16LE(16, 34) // bits per sample
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < int16.length; i++) buf.writeInt16LE(int16[i], 44 + i * bytesPerSample)
  return buf
}

describe('wavPcmMonoFromBuffer', () => {
  it('decodes 16-bit mono PCM to normalized Float32 samples', () => {
    const out = wavPcmMonoFromBuffer(makeWav([0, 16384, -16384, 32767], 16000))
    expect(out).not.toBeNull()
    expect(out!.sampleRate).toBe(16000)
    expect(out!.samples).toHaveLength(4)
    expect(out!.samples[0]).toBeCloseTo(0, 5)
    expect(out!.samples[1]).toBeCloseTo(0.5, 3)
    expect(out!.samples[2]).toBeCloseTo(-0.5, 3)
    expect(out!.samples[3]).toBeCloseTo(1.0, 3)
  })

  it('downmixes stereo to mono by averaging channels', () => {
    // Interleaved L/R: (10000, 0), (0, 10000) → averages 5000, 5000
    const out = wavPcmMonoFromBuffer(makeWav([10000, 0, 0, 10000], 16000, 2))
    expect(out).not.toBeNull()
    expect(out!.samples).toHaveLength(2)
    expect(out!.samples[0]).toBeCloseTo(5000 / 32768, 4)
    expect(out!.samples[1]).toBeCloseTo(5000 / 32768, 4)
  })

  it('returns null for a non-WAV buffer', () => {
    expect(wavPcmMonoFromBuffer(Buffer.from('not a wav file at all'))).toBeNull()
  })

  it('returns null for a non-16-bit format', () => {
    const buf = makeWav([1, 2, 3], 16000)
    buf.writeUInt16LE(8, 34) // claim 8-bit
    expect(wavPcmMonoFromBuffer(buf)).toBeNull()
  })

  it('clamps a data size that overruns the buffer', () => {
    const buf = makeWav([100, 200], 16000)
    buf.writeUInt32LE(999999, 40) // lie about data size
    const out = wavPcmMonoFromBuffer(buf)
    expect(out).not.toBeNull()
    expect(out!.samples).toHaveLength(2) // only what's actually present
  })
})

import { describe, expect, it } from 'vitest'
import { wavDurationFromHeader } from './wavDuration'

/** Build a minimal canonical PCM WAV header + `dataBytes` of silence. */
function makeWavHeader(opts: {
  sampleRate: number
  channels: number
  bitsPerSample: number
  dataBytes: number
}): Buffer {
  const { sampleRate, channels, bitsPerSample, dataBytes } = opts
  const blockAlign = channels * (bitsPerSample / 8)
  const byteRate = sampleRate * blockAlign
  const buf = Buffer.alloc(44)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(channels, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(byteRate, 28)
  buf.writeUInt16LE(blockAlign, 32)
  buf.writeUInt16LE(bitsPerSample, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(dataBytes, 40)
  return buf
}

describe('wavDurationFromHeader', () => {
  it('computes duration for a 16 kHz mono 16-bit WAV', () => {
    // 3 seconds → 16000 * 1 * 2 bytes/sample * 3 = 96000 data bytes.
    const header = makeWavHeader({ sampleRate: 16000, channels: 1, bitsPerSample: 16, dataBytes: 96000 })
    expect(wavDurationFromHeader(header)).toBeCloseTo(3, 6)
  })

  it('computes duration for a 44.1 kHz stereo WAV', () => {
    // 2 seconds → 44100 * 2 * 2 * 2 = 352800 data bytes.
    const header = makeWavHeader({ sampleRate: 44100, channels: 2, bitsPerSample: 16, dataBytes: 352800 })
    expect(wavDurationFromHeader(header)).toBeCloseTo(2, 6)
  })

  it('returns null for a non-RIFF buffer', () => {
    expect(wavDurationFromHeader(Buffer.from('not a wav file at all'))).toBeNull()
  })

  it('returns null when the data chunk is empty', () => {
    const header = makeWavHeader({ sampleRate: 16000, channels: 1, bitsPerSample: 16, dataBytes: 0 })
    expect(wavDurationFromHeader(header)).toBeNull()
  })

  it('returns null for a too-short buffer', () => {
    expect(wavDurationFromHeader(Buffer.alloc(4))).toBeNull()
  })
})

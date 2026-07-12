import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it } from 'vitest'
import { wavPcmMonoFromBuffer } from '../main/stt/wavPcm'
import { detectVocalRegions } from './vocalActivity'

describe('temp vad test', () => {
  it('prints regions', () => {
    const wavBuf = readFileSync(join(process.cwd(), 'media', '1.wav'))
    const pcm = wavPcmMonoFromBuffer(wavBuf)
    if (!pcm) {
      console.log("Failed to parse WAV")
    } else {
      console.log(`Parsed WAV: ${pcm.samples.length} samples at ${pcm.sampleRate} Hz`)
      const regions = detectVocalRegions(pcm.samples, pcm.sampleRate)
      console.log(`Detected ${regions.length} vocal regions:`)
      for (let i = 0; i < Math.min(10, regions.length); i++) {
        const r = regions[i]
        console.log(`  [${i}] ${r.start.toFixed(2)}s - ${r.end.toFixed(2)}s`)
      }
    }
  })
})

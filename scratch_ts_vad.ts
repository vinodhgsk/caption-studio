import { readFileSync } from 'fs'
import { join } from 'path'
import { wavPcmMonoFromBuffer } from './src/main/stt/wavPcm'
import { detectVocalRegions } from './src/shared/vocalActivity'

const wavBuf = readFileSync(join(__dirname, 'media', '1.wav'))
// The wav is stereo 48kHz. The readWavPcmMono function expects 16kHz mono.
// wait, wavPcmMonoFromBuffer can read any canonical WAV, but let's see.
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

/**
 * Pure waveform peak extraction for the audio timeline strip (P4.1 — Doc 02
 * "show waveform").
 *
 * NO DOM / electron / node import — pure number-array math so it is unit-testable
 * in the vitest `node` env. The actual decode of MP3 bytes → PCM samples happens
 * in the renderer via `decodeWaveform` (which DOES touch the Web Audio API and is
 * therefore kept separate from this pure reducer).
 *
 * A "peak" is one bucket's {min,max} amplitude pair in `[-1, 1]`. The timeline
 * renders each bucket as a vertical bar from `min` to `max`, giving the familiar
 * symmetric waveform. Downsampling to a fixed bucket count keeps render cost
 * independent of clip length.
 */

/** One downsampled waveform bucket: the min/max sample amplitude in `[-1, 1]`. */
export interface WaveformPeak {
  min: number
  max: number
}

/** A decoded, downsampled waveform ready to render on the timeline. */
export interface Waveform {
  /** Source duration in seconds (from the decoded buffer). */
  durationSec: number
  /** Downsampled peaks, one per bucket, in source order. */
  peaks: WaveformPeak[]
}

/**
 * Downsample raw mono PCM `samples` (each in `[-1, 1]`) into exactly
 * `bucketCount` min/max peaks. Buckets are even-width over the sample range; a
 * bucket with no samples (when `samples.length < bucketCount`) is flat (`{0,0}`).
 * Pure + deterministic.
 */
export function extractPeaks(
  samples: ArrayLike<number>,
  bucketCount: number
): WaveformPeak[] {
  if (bucketCount <= 0) return []
  const peaks: WaveformPeak[] = new Array(bucketCount)
  const total = samples.length
  if (total === 0) {
    for (let b = 0; b < bucketCount; b++) peaks[b] = { min: 0, max: 0 }
    return peaks
  }
  const per = total / bucketCount
  for (let b = 0; b < bucketCount; b++) {
    const begin = Math.floor(b * per)
    const end = Math.min(total, Math.floor((b + 1) * per))
    if (end <= begin) {
      peaks[b] = { min: 0, max: 0 }
      continue
    }
    let min = Infinity
    let max = -Infinity
    for (let i = begin; i < end; i++) {
      const v = samples[i]
      if (v < min) min = v
      if (v > max) max = v
    }
    peaks[b] = { min, max }
  }
  return peaks
}

/**
 * Mix multi-channel interleaved-by-channel PCM (an array of per-channel
 * `Float32Array`s, all the same length) down to a single mono channel by
 * averaging. Returns the input unchanged when there is exactly one channel.
 * Pure (allocates a new array).
 */
export function mixToMono(channels: ArrayLike<number>[]): ArrayLike<number> {
  if (channels.length === 0) return []
  if (channels.length === 1) return channels[0]
  const length = channels[0].length
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    let sum = 0
    for (const ch of channels) sum += ch[i] ?? 0
    out[i] = sum / channels.length
  }
  return out
}

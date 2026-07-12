/**
 * Renderer-side waveform DECODE (P4.1 — Doc 02 "show waveform").
 *
 * IMPURE: this DOES touch the Web Audio API + `fetch`, so it lives apart from the
 * pure `waveform.ts` peak math (which it delegates to). It fetches an audio file
 * by its `app-media://` URL (the sanctioned in-sandbox media source — see
 * main/mediaProtocol), decodes it to PCM via an `AudioContext`, mixes to mono and
 * downsamples to a fixed number of peaks for the timeline strip.
 */
import { extractPeaks, mixToMono, type Waveform } from './waveform'
import { detectBeats, type BeatDetectOptions } from '../../../../shared/beatDetect'

/** Default bucket count for a decoded clip waveform (matches the timeline strip). */
export const DEFAULT_WAVEFORM_BUCKETS = 256

/**
 * Decode the audio at `mediaUrl` (an `app-media://` URL) into a downsampled
 * {@link Waveform}. Uses an offline-friendly `AudioContext`; the context is
 * closed after decode to free the audio thread. Throws if fetch/decode fails
 * (callers surface the message to the panel).
 */
export async function decodeWaveform(
  mediaUrl: string,
  buckets: number = DEFAULT_WAVEFORM_BUCKETS
): Promise<Waveform> {
  const response = await fetch(mediaUrl)
  const bytes = await response.arrayBuffer()

  // `AudioContext` is the standard decoder; `webkitAudioContext` is a legacy alias.
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (Ctor === undefined) throw new Error('Web Audio API is unavailable.')
  const ctx = new Ctor()
  try {
    const buffer = await ctx.decodeAudioData(bytes)
    const channels: Float32Array[] = []
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      channels.push(buffer.getChannelData(c))
    }
    const mono = mixToMono(channels)
    return { durationSec: buffer.duration, peaks: extractPeaks(mono, buckets) }
  } finally {
    void ctx.close()
  }
}

/**
 * Decode the audio at `mediaUrl` and detect its BEAT times (P8.11 — Doc 11; skill
 * `beat-sync`), returning SOURCE-second onset times (the reference `clip.audio.beats`
 * is stored in). IMPURE like {@link decodeWaveform} (Web Audio + `fetch`); the pure
 * onset math is delegated to the headless {@link detectBeats}. Throws if fetch/decode
 * fails (callers surface the message to the panel).
 */
export async function decodeAudioBeats(
  mediaUrl: string,
  opts?: BeatDetectOptions
): Promise<number[]> {
  const response = await fetch(mediaUrl)
  const bytes = await response.arrayBuffer()

  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (Ctor === undefined) throw new Error('Web Audio API is unavailable.')
  const ctx = new Ctor()
  try {
    const buffer = await ctx.decodeAudioData(bytes)
    const channels: Float32Array[] = []
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      channels.push(buffer.getChannelData(c))
    }
    const mono = mixToMono(channels)
    return detectBeats(mono, buffer.sampleRate, opts)
  } finally {
    void ctx.close()
  }
}

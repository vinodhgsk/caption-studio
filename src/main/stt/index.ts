/**
 * STT entry point (P4.4 / P4.5, Doc 02) — registers the `stt:` IPC domain.
 *
 * The ONLY stt module allowed to import electron (via the shared `handle()`
 * wrapper) + fs. The handler resolves the bundle path for the request's project
 * ref (no audio bytes cross IPC — only the bundle-relative `wavRef`), delegates to
 * the ACTIVE provider from the registry (whisper.cpp or the stub fallback), then
 * PERSISTS the result: writes `cache/transcript.json` and sets
 * `captions.transcript` / `captions.language` on project.json (Doc 00 §4) so the
 * renderer reflects it on reload. Providers stay pure transcribers behind the
 * registry; whisper.cpp drops in (P4.5) with no caller change.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { handle } from '../ipc'
import { getProvider } from '../storage'
import { bundleLayout } from '../storage/bundle'
import { alignLyricsToTranscript, alignedFromForcedWords, lyricWordSequence } from '../../shared/lyricsFirst'
import { DEFAULT_LANGUAGE } from '../../shared/stt'
import { detectVocalRegions } from '../../shared/vocalActivity'
import { detectBeats } from '../../shared/beatDetect'
import { getSttProvider } from './registry'
import { runForcedAlign } from './forcedAlign'
import { readWavDurationSec } from './wavDuration'
import { readWavPcmMono } from './wavPcm'
import { TRANSCRIPT_CACHE_REF, serializeTranscript, withCaptions } from './transcript'

const LYRICS_CACHE_REF = 'cache/lyrics.txt'
const ALIGNMENT_CACHE_REF = 'cache/alignment.json'

/** Register the `stt:transcribe` handler (mirrors registerStorageIpc). */
export function registerSttIpc(): void {
  handle('stt:transcribe', async (request) => {
    // Resolve the bundle root via the storage provider, then hand the provider
    // the absolute bundle path + bundle-relative wavRef so it can read the WAV
    // in MAIN. The renderer only ever sent the wavRef string.
    const provider = getProvider(request.ref.location)
    const bundlePath = provider.resolvePath(request.ref)

    const transcript = await getSttProvider().transcribe(bundlePath, request.wavRef, {
      language: request.language
    })

    // Persist transcript.json into the bundle's cache/ (ensure it exists).
    const layout = bundleLayout(bundlePath)
    await mkdir(layout.cache, { recursive: true })
    await writeFile(join(bundlePath, TRANSCRIPT_CACHE_REF), serializeTranscript(transcript), 'utf8')

    // Update captions.transcript / captions.language on project.json, preserving
    // any other captions fields. Best-effort: a project.json read failure must not
    // discard a successful transcription (the renderer still gets the Transcript).
    try {
      const project = await provider.readProject(request.ref)
      const updated = withCaptions(project, transcript)
      await provider.writeProject(request.ref, updated)
    } catch {
      // Swallow — transcript.json is written and the Transcript is returned below.
    }

    return transcript
  })

  handle('stt:alignLyrics', async (request) => {
    const provider = getProvider(request.ref.location)
    const bundlePath = provider.resolvePath(request.ref)

    // Use the active STT provider for timing evidence, then remap to user lyrics.
    // Lyrics-first is TEXT-first: the user already owns the words, so a missing
    // or failing STT provider (e.g. whisper.cpp not installed) must NOT abort the
    // whole operation. Fall back to an empty transcript and spread timings across
    // the real audio duration so captions still cover the whole song.
    let transcript
    try {
      transcript = await getSttProvider().transcribe(bundlePath, request.wavRef, {
        language: request.language
      })
    } catch {
      transcript = { language: request.language ?? DEFAULT_LANGUAGE, words: [] }
    }

    const wavAbsPath = join(bundlePath, request.wavRef)
    const audioDurationSec = await readWavDurationSec(wavAbsPath)

    // VAD phrase-sync inputs: read the normalized PCM and detect the actual sung
    // phrases + energy onsets. Grounds timing in the audio without relying on a
    // possibly-stub STT provider. Used as the fallback when CTC is unavailable.
    const pcm = await readWavPcmMono(wavAbsPath)
    const vocalRegions = pcm !== null ? detectVocalRegions(pcm.samples, pcm.sampleRate) : []
    const onsets = pcm !== null ? detectBeats(pcm.samples, pcm.sampleRate) : []
    const useVad = vocalRegions.length > 0

    // Engine ladder (best → fallback):
    //   1. CTC forced alignment (Python sidecar) — real acoustic word timing.
    //   2. VAD phrase-sync — lines snapped onto detected vocal phrases + onsets.
    //   3. transcript-driven 'auto' (proportional/monotonic).
    let aligned: ReturnType<typeof alignLyricsToTranscript> | null = null
    let engine: 'mms-ctc' | 'lyrics-first-vad' | 'lyrics-first-stub' = useVad
      ? 'lyrics-first-vad'
      : 'lyrics-first-stub'

    const wordSeq = lyricWordSequence(request.lyrics)
    const forced = await runForcedAlign({
      wavAbsPath,
      words: wordSeq,
      language: request.language,
      appRoot: process.cwd()
    })
    if (forced !== null && forced.words.some((w) => w != null)) {
      const ctc = alignedFromForcedWords({
        lyrics: request.lyrics,
        language: request.language,
        timings: forced.words
      })
      if (ctc.lines.length > 0) {
        aligned = ctc
        engine = 'mms-ctc'
      }
    }

    if (aligned === null) {
      aligned = alignLyricsToTranscript({
        lyrics: request.lyrics,
        transcript,
        language: request.language,
        ...(audioDurationSec !== null ? { audioDurationSec } : {}),
        ...(useVad ? { vocalRegions, onsets } : {}),
        // 'segmented' snaps lines onto detected vocal phrases and words onto onsets.
        // 'auto' (no VAD) → proportional/monotonic depending on transcript density.
        strategy: useVad ? 'segmented' : 'auto'
      })
    }

    const alignedTranscript = {
      language: aligned.language,
      words: aligned.lines.flatMap((line) => line.words)
    }

    // Input is assumed vocal-only (no separation), so vocalStem = false.

    const layout = bundleLayout(bundlePath)
    await mkdir(layout.cache, { recursive: true })
    await writeFile(join(bundlePath, TRANSCRIPT_CACHE_REF), serializeTranscript(alignedTranscript), 'utf8')
    await writeFile(join(bundlePath, LYRICS_CACHE_REF), request.lyrics, 'utf8')
    await writeFile(
      join(bundlePath, ALIGNMENT_CACHE_REF),
      `${JSON.stringify(
        {
          language: aligned.language,
          engine,
          vocalStem: false,
          vocalRegions,
          lines: aligned.lines
        },
        null,
        2
      )}\n`,
      'utf8'
    )

    try {
      const project = await provider.readProject(request.ref)
      const updated = {
        ...withCaptions(project, alignedTranscript),
        captions: {
          ...project.captions,
          ...withCaptions(project, alignedTranscript).captions,
          mode: 'lyricsFirst' as const,
          lyricsRef: LYRICS_CACHE_REF,
          alignmentRef: ALIGNMENT_CACHE_REF,
          engine,
          vocalStem: false
        }
      }
      await provider.writeProject(request.ref, updated)
    } catch {
      // Best effort only — alignment still returns to renderer.
    }

    return aligned
  })
}

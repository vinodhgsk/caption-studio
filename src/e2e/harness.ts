/**
 * End-to-end test HARNESS — wires the renderer stores to the REAL (electron-free)
 * main-process logic so a vitest run exercises the genuine production pipeline:
 *
 *     renderer store action
 *        → window.api.invoke(channel, request)            (this fake bridge)
 *          → REAL LocalProvider (fs against a tmp root)    (storage:*)
 *          → REAL normalizeAudio helpers / a valid WAV     (ffmpeg:normalizeAudio)
 *          → a realistic word-level Transcript fixture     (stt:transcribe)
 *
 * Only the two genuinely-native seams are faked, and faithfully:
 *   - The OS file pickers (`storage:pickMedia` / `storage:pickAudio`) return paths
 *     to REAL fixture files staged on disk (a queue the test fills), exactly like a
 *     user choosing files — no Buffers cross the bridge, mirroring production.
 *   - Speech-to-text returns a deterministic word-timed {@link Transcript} standing
 *     in for whisper.cpp (the StubProvider returns zero words, useless for asserting
 *     "captions land on the right words"). This mirrors `mockSttPipeline.test.ts`.
 *
 * Everything else is the SAME code that runs in the packaged app: the `.vproj`
 * bundle is scaffolded on real disk by {@link LocalProvider}, media files are
 * copied byte-for-byte into `media/`, a real 16 kHz mono WAV lands in `cache/`,
 * and the project round-trips through `project.json`. Assertions can therefore
 * read the bundle off disk and validate "production result".
 *
 * NO electron import — only `LocalProvider`, the ffmpeg path helpers, and
 * `bundleLayout` (all electron-free) are pulled in, so this runs under the node
 * vitest environment unchanged.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { spawn } from 'node:child_process'
import { vi } from 'vitest'
import type {
  IpcChannel,
  IpcRequest,
  IpcResponse,
  IpcResult
} from '../shared/ipc'
import type { Transcript } from '../shared/stt'
import { alignLyricsToTranscript } from '../shared/lyricsFirst'
import { LocalProvider } from '../main/storage/LocalProvider'
import { bundleLayout } from '../main/storage/bundle'
import { normalizeAudio, normalizedWavName } from '../main/ffmpeg/normalizeAudio'
import { probeMediaDuration } from '../main/ffmpeg/probeMediaDuration'
import { useProjectStore } from '../renderer/store/projectStore'
import { useTimelineStore } from '../renderer/store/timelineStore'

/** Typed shape of the renderer's `window.api.invoke` the stores call. */
export type IpcInvoke = <C extends IpcChannel>(
  channel: C,
  request: IpcRequest<C>
) => Promise<IpcResult<IpcResponse<C>>>

// ---------------------------------------------------------------------------
// Realistic fixtures: a known English script (clear assertions) + a Tamil one
// (Indic flow). Two sentences with a >0.7s pause so default grouping splits into
// two caption blocks — exercising the FULL transcript→lines→clips chain, not a
// trivial single line. Times are deliberately NOT all frame-aligned so the
// ±1-frame assertions are meaningful.
// ---------------------------------------------------------------------------

/** Known English narration standing in for a transcribed MP3. */
export const ENGLISH_TRANSCRIPT: Transcript = {
  language: 'en',
  words: [
    { text: 'Welcome', start: 0.5, end: 0.96 },
    { text: 'to', start: 1.0, end: 1.18 },
    { text: 'Caption', start: 1.2, end: 1.7 },
    { text: 'Studio.', start: 1.74, end: 2.3 },
    // 0.9s silent gap (> default 0.7 pauseGap) → a new caption block starts here.
    { text: 'Edit', start: 3.2, end: 3.5 },
    { text: 'videos', start: 3.55, end: 4.05 },
    { text: 'fast.', start: 4.1, end: 4.6 }
  ]
}

/** The exact lines a viewer should read from {@link ENGLISH_TRANSCRIPT}. */
export const ENGLISH_LINES = ['Welcome to Caption Studio.', 'Edit videos fast.'] as const

/** Known Tamil narration (Indic shaping path). One short line. */
export const TAMIL_TRANSCRIPT: Transcript = {
  language: 'ta',
  words: [
    { text: 'வணக்கம்', start: 0.0, end: 0.5 },
    { text: 'உலகம்', start: 0.55, end: 1.1 }
  ]
}

// ---------------------------------------------------------------------------
// Mariamman song — canonical fixture for full-workflow e2e and regression tests
// ---------------------------------------------------------------------------

/**
 * Full Tamil lyrics of the Mariamman devotional song (media/1.wav).
 * This is the canonical source used by all export e2e and regression tests.
 * Preserves the user's exact line-break formatting so each phrase becomes its
 * own caption line after Align Lyrics alignment.
 */
export const MARIAMMAN_LYRICS = `[lang: ta]
ஓம் சக்தி…
அம்மா தாயே…
கருமாரி தாயே…

அருள்மிகு கார்மேக மாரியம்மா…
அன்னையே நீயே
என் ஆதிமூலம்மா…

அம்பிகை சிங்கவாய்
சௌந்தரியம்மா…
ஆயிரம் கரங்களில்
அருள்தரும் அம்மா…

பொற்கனி மேனியம்மா
பேரொளியே…
பூமகள் நெஞ்சத்தில்
பிறந்த அருளே…

சண்டிகை காளியம்மா
சக்தியே…
சர்வம் நிறைவேற்றும்
தெய்வானையம்மா…

அருள்மிகு கார்மேக
மாரியம்மா…
அன்னையே நீயே
என் ஆதிமூலம்மா…

நெற்றியில் குங்குமமே
நிறைய வேண்டும்…
நெஞ்சத்தில்
உன் திருநாமம்
வழிய வேண்டும்…

சொல்லும் பிரார்த்தனை
மேன்மேலும்
உயர வேண்டும்…
சொற்களின் கவிதையில்
உன் நாமமே
உருக வேண்டும்…

எண்ணங்கள் எல்லாம்
உன் ஒளியில்
மலர வேண்டும்…
என்றும் என் வீடு
உன் பாதத்தில்
நிற்க வேண்டும்…

அருள்மிகு கார்மேக
மாரியம்மா…
அன்னையே நீயே
என் ஆதிமூலம்மா…

காற்றாகி
கனலாகி காவலாகினாய்…
கருவாகி
உயிராகி உருவாகினாய்…

நேற்றாகி
இன்றாகி நாளாகினாய்…
நிலமாகி
பயிராகி உணவாகினாய்…

வீழ்ந்தாலும் எழுப்பும்
சக்தியாகினாய்…
வெற்றியும் தோல்வியும்
வாழ்வாகினாய்…

போற்றாத நொடியும் இல்லை
தாயே…
பொன்னான என் உள்ளத்தில்
பொலிவாய் நீயே…

அருள்மிகு கார்மேக
மாரியம்மா…
அன்னையே நீயே
என் ஆதிமூலம்மா…

அன்பின் வடிவான
அமுதம்மா…
ஆசையின் நிழலான
அடிமூலம்மா…

ஆழ்ந்த என்இருளில்
அழகு தந்தவளே…
ஆயுள் முழுவதும்
அருள் தரும் தாயே…

எங்கும் என் பயணத்தில்
காவலாய் நீ…
எந்தன் பிறவியில்
வெளிச்சமாய் நீ…

ஓம் சக்தி…
கருமாரி அம்மா…
உன் அருளே
என் உயிர் ஒளியே…`

/**
 * Transcript fixture for harness-based Mariamman song tests.
 * Three anchor words span a 5-second vocal range; the proportional alignment
 * engine distributes all lyric lines across that span.
 */
export const MARIAMMAN_TRANSCRIPT: Transcript = {
  language: 'ta',
  words: [
    { text: 'ஓம்', start: 0.3, end: 0.8 },
    { text: 'சக்தி', start: 0.9, end: 1.4 },
    { text: 'அம்மா', start: 4.2, end: 4.7 }
  ]
}

// ---------------------------------------------------------------------------
// WAV helpers — write a VALID PCM16 WAV (so a real ffmpeg can decode the source)
// and parse a WAV header by walking chunks (robust to ffmpeg's extra chunks).
// ---------------------------------------------------------------------------

/** Parsed, asserted-against WAV header fields. */
export interface WavInfo {
  riff: string
  wave: string
  audioFormat: number
  channels: number
  sampleRate: number
  bitsPerSample: number
  dataBytes: number
}

/** Build a valid PCM16 little-endian WAV buffer of a sine tone. */
export function makeWavBuffer(opts: {
  sampleRate: number
  channels: number
  durationSec: number
  freq?: number
}): Buffer {
  const { sampleRate, channels, durationSec, freq = 440 } = opts
  const numSamples = Math.floor(sampleRate * durationSec)
  const blockAlign = channels * 2
  const dataSize = numSamples * blockAlign
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(channels, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * blockAlign, 28)
  buf.writeUInt16LE(blockAlign, 32)
  buf.writeUInt16LE(16, 34) // bits per sample
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(dataSize, 40)
  let offset = 44
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.3 * 32767)
    for (let c = 0; c < channels; c++) {
      buf.writeInt16LE(sample, offset)
      offset += 2
    }
  }
  return buf
}

/** Parse a WAV header by walking RIFF chunks (handles canonical + ffmpeg output). */
export function parseWav(buf: Buffer): WavInfo {
  const info: WavInfo = {
    riff: buf.toString('ascii', 0, 4),
    wave: buf.toString('ascii', 8, 12),
    audioFormat: 0,
    channels: 0,
    sampleRate: 0,
    bitsPerSample: 0,
    dataBytes: 0
  }
  let p = 12
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4)
    const size = buf.readUInt32LE(p + 4)
    if (id === 'fmt ' && p + 24 <= buf.length) {
      info.audioFormat = buf.readUInt16LE(p + 8)
      info.channels = buf.readUInt16LE(p + 10)
      info.sampleRate = buf.readUInt32LE(p + 12)
      info.bitsPerSample = buf.readUInt16LE(p + 22)
    } else if (id === 'data') {
      info.dataBytes = size
    }
    // Chunks are word-aligned (a pad byte follows an odd size).
    p += 8 + size + (size % 2)
  }
  return info
}

/** A valid 1×1 transparent PNG (so an imported "image" is a real decodable file). */
function tinyPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
  )
}

/** A minimal `ftyp`-boxed buffer standing in for a video file (copied verbatim). */
function tinyMp4(): Buffer {
  return Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from('ftypisom', 'ascii'),
    Buffer.from([0, 0, 0, 0x01]),
    Buffer.from('isomavc1', 'ascii')
  ])
}

/** Detect a usable `ffmpeg` binary once (so the real normalize runs when present). */
function detectFfmpeg(): Promise<boolean> {
  const bin = process.env.CAPTION_STUDIO_FFMPEG ?? 'ffmpeg'
  return new Promise((resolve) => {
    try {
      const child = spawn(bin, ['-version'], { stdio: 'ignore' })
      child.on('error', () => resolve(false))
      child.on('close', (code) => resolve(code === 0))
    } catch {
      resolve(false)
    }
  })
}

/** Absolute paths to the staged source fixtures a "user" can pick. */
export interface Fixtures {
  /** A real video file (`clip.mp4`). */
  video: string
  /** A real 1×1 PNG (`logo.png`). */
  image: string
  /** A real, decodable WAV (`narration.wav`) — any audio format follows this path. */
  audio: string
}

/** The live E2E harness handed to a test. */
export interface E2EHarness {
  /** The local projects root the {@link LocalProvider} is rooted at. */
  projectsRoot: string
  /** The real filesystem provider the storage IPC channels delegate to. */
  provider: LocalProvider
  /** Staged source fixture file paths. */
  fixtures: Fixtures
  /** True when a real ffmpeg binary drives `ffmpeg:normalizeAudio`. */
  ffmpegAvailable: boolean
  /** The fake bridge the stores call (also installed onto `window.api`). */
  invoke: IpcInvoke
  /** Stage the file paths the NEXT `storage:pickMedia` returns. */
  queueMediaPick: (paths: string[]) => void
  /** Stage the file paths the NEXT `storage:pickAudio` returns. */
  queueAudioPick: (paths: string[]) => void
  /** Stage the transcript the NEXT `stt:transcribe` returns (else the default). */
  queueTranscript: (transcript: Transcript) => void
  /** Set the fallback transcript used when the queue is empty. */
  setDefaultTranscript: (transcript: Transcript) => void
  /** Read a bundle-relative file (e.g. `media/clip.mp4`) off disk for assertions. */
  readBundleFile: (bundlePath: string, relPath: string) => Promise<Buffer>
  /** Install the fake bridge onto `window.api` + reset the stores. */
  install: () => void
  /** Tear down: unstub globals, reset stores, remove the temp workspace. */
  cleanup: () => Promise<void>
}

/**
 * Create a fresh, isolated E2E harness: a temp projects root, staged real
 * fixtures, and a fake IPC bridge wired to the real providers. `await` it, then
 * call {@link E2EHarness.install} in `beforeEach` and {@link E2EHarness.cleanup}
 * in `afterEach`.
 */
export async function createE2EHarness(): Promise<E2EHarness> {
  const workspace = await mkdtemp(join(tmpdir(), 'capstudio-e2e-'))
  const projectsRoot = join(workspace, 'projects')
  const fixturesDir = join(workspace, 'sources')
  await mkdir(projectsRoot, { recursive: true })
  await mkdir(fixturesDir, { recursive: true })

  // Stage real fixture files a "user" can pick from the OS dialog.
  const video = join(fixturesDir, 'clip.mp4')
  const image = join(fixturesDir, 'logo.png')
  const audio = join(fixturesDir, 'narration.wav')
  await writeFile(video, tinyMp4())
  await writeFile(image, tinyPng())
  // 44.1 kHz stereo source so a real ffmpeg performs a genuine 16 kHz mono down-mix.
  await writeFile(audio, makeWavBuffer({ sampleRate: 44100, channels: 2, durationSec: 5 }))

  const provider = new LocalProvider(projectsRoot, 'local')
  const ffmpegAvailable = await detectFfmpeg()

  const mediaPickQueue: string[][] = []
  const audioPickQueue: string[][] = []
  const transcriptQueue: Transcript[] = []
  let defaultTranscript: Transcript = ENGLISH_TRANSCRIPT

  // The route table: maps a channel to the REAL provider/helper. Mirrors
  // src/main/storage/index.ts + src/main/ipc.ts exactly (minus electron).
  async function route<C extends IpcChannel>(
    channel: C,
    request: IpcRequest<C>
  ): Promise<IpcResponse<C>> {
    switch (channel) {
      case 'storage:createProject': {
        const req = request as IpcRequest<'storage:createProject'>
        return provider.createProject(req.name) as Promise<IpcResponse<C>>
      }
      case 'storage:listProjects':
        return provider.listProjects() as Promise<IpcResponse<C>>
      case 'storage:readProject': {
        const req = request as IpcRequest<'storage:readProject'>
        return provider.readProject(req.ref) as Promise<IpcResponse<C>>
      }
      case 'storage:writeProject': {
        const req = request as IpcRequest<'storage:writeProject'>
        return provider.writeProject(
          req.ref,
          req.project,
          req.expectedUpdatedAt
        ) as Promise<IpcResponse<C>>
      }
      case 'storage:resolvePath': {
        const req = request as IpcRequest<'storage:resolvePath'>
        return { path: provider.resolvePath(req.ref) } as IpcResponse<C>
      }
      case 'storage:probeMediaDuration': {
        const req = request as IpcRequest<'storage:probeMediaDuration'>
        const bundlePath = provider.resolvePath(req.ref)
        const durationSec = await probeMediaDuration(bundlePath, req.mediaRef)
        return { durationSec } as IpcResponse<C>
      }
      case 'storage:duplicateProject': {
        const req = request as IpcRequest<'storage:duplicateProject'>
        return provider.duplicateProject(req.ref) as Promise<IpcResponse<C>>
      }
      case 'storage:renameProject': {
        const req = request as IpcRequest<'storage:renameProject'>
        return provider.renameProject(req.ref, req.name) as Promise<IpcResponse<C>>
      }
      case 'storage:deleteProject': {
        const req = request as IpcRequest<'storage:deleteProject'>
        await provider.deleteProject(req.ref)
        return { deleted: true } as IpcResponse<C>
      }
      case 'storage:pickMedia':
        return { paths: mediaPickQueue.shift() ?? [] } as IpcResponse<C>
      case 'storage:pickAudio':
        return { paths: audioPickQueue.shift() ?? [] } as IpcResponse<C>
      case 'storage:importMedia': {
        const req = request as IpcRequest<'storage:importMedia'>
        return provider.copyMedia(req.ref, req.sourcePath) as Promise<IpcResponse<C>>
      }
      case 'ffmpeg:normalizeAudio': {
        const req = request as IpcRequest<'ffmpeg:normalizeAudio'>
        const bundlePath = provider.resolvePath(req.ref)
        if (ffmpegAvailable) {
          // The genuine production encode (16 kHz mono WAV in cache/).
          const wavRef = await normalizeAudio(bundlePath, req.mediaRef)
          return { wavRef } as IpcResponse<C>
        }
        // No ffmpeg on this host: write a VALID 16 kHz mono WAV named exactly as
        // production names it, so the downstream STT step still has a real artifact.
        const layout = bundleLayout(bundlePath)
        await mkdir(layout.cache, { recursive: true })
        const wavName = normalizedWavName(basename(req.mediaRef))
        await writeFile(
          join(layout.cache, wavName),
          makeWavBuffer({ sampleRate: 16000, channels: 1, durationSec: 2 })
        )
        return { wavRef: `cache/${wavName}` } as IpcResponse<C>
      }
      case 'stt:transcribe': {
        const req = request as IpcRequest<'stt:transcribe'>
        const base = transcriptQueue.shift() ?? defaultTranscript
        // Honor a pinned language like a real provider; else echo the fixture's.
        const language = req.language ?? base.language
        return { language, words: base.words } as IpcResponse<C>
      }
      case 'stt:alignLyrics': {
        const req = request as IpcRequest<'stt:alignLyrics'>
        const base = transcriptQueue.shift() ?? defaultTranscript
        return alignLyricsToTranscript({
          lyrics: req.lyrics,
          transcript: { language: req.language ?? base.language, words: base.words },
          language: req.language
        }) as IpcResponse<C>
      }
      default:
        throw new Error(`E2E harness: unhandled IPC channel "${String(channel)}"`)
    }
  }

  const invoke: IpcInvoke = async (channel, request) => {
    try {
      return { ok: true, data: await route(channel, request) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  const resetStores = (): void => {
    useProjectStore.getState().closeProject()
    useProjectStore.setState({ projects: [], listStatus: 'idle', listError: null })
    useTimelineStore.getState().clearSelection()
    useTimelineStore.setState({ playhead: 0, isPlaying: false, inPoint: null, outPoint: null })
  }

  return {
    projectsRoot,
    provider,
    fixtures: { video, image, audio },
    ffmpegAvailable,
    invoke,
    queueMediaPick: (paths) => mediaPickQueue.push(paths),
    queueAudioPick: (paths) => audioPickQueue.push(paths),
    queueTranscript: (transcript) => transcriptQueue.push(transcript),
    setDefaultTranscript: (transcript) => {
      defaultTranscript = transcript
    },
    readBundleFile: (bundlePath, relPath) => readFile(join(bundlePath, relPath)),
    install: () => {
      vi.stubGlobal('window', { api: { invoke } })
      resetStores()
    },
    cleanup: async () => {
      resetStores()
      vi.unstubAllGlobals()
      await rm(workspace, { recursive: true, force: true })
    }
  }
}

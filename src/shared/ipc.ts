/**
 * Typed IPC contract shared by main, preload, and renderer.
 *
 * Every channel is one arm of a discriminated union of
 * `{ channel, request, response }`. Results always cross the boundary as
 * `IpcResult<T>` ({ ok:true, data } | { ok:false, error }) — main never throws
 * raw across IPC (see electron-scaffold conventions).
 */
import type {
  ImportFontResult,
  ImportMediaResult,
  Project,
  ProjectMeta,
  ProjectRef,
  StorageLocation,
  WriteResult
} from './storage'
import type { ExportJob, ExportResult } from './export'
import type { LanguageCode, Transcript } from './stt'
import type { TargetBox, TrackPath } from './tracking'
import type { LyricsAlignmentResult } from './lyricsFirst'
import type { TTSVoice, TTSSynthesizeRequest, TTSSynthesizeResult } from './tts'
import type { UserPreset } from './userPreset'

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** App state requested by the renderer at boot. */
export interface AppState {
  version: string
  platform: NodeJS.Platform
  ready: boolean
}

/** Discriminated union of all IPC channels. Add new domains here. */
export type IpcContract =
  | { channel: 'app:getState'; request: void; response: AppState }
  | { channel: 'app:ping'; request: { at: number }; response: { pong: number } }
  | {
    channel: 'storage:listProjects'
    request: { location: StorageLocation }
    response: ProjectMeta[]
  }
  | {
    channel: 'storage:createProject'
    request: { location: StorageLocation; name: string }
    response: ProjectRef
  }
  | { channel: 'storage:readProject'; request: { ref: ProjectRef }; response: Project }
  | {
    channel: 'storage:writeProject'
    request: { ref: ProjectRef; project: Project; expectedUpdatedAt?: string }
    response: WriteResult
  }
  | {
    channel: 'storage:resolvePath'
    request: { ref: ProjectRef }
    response: { path: string }
  }
  | {
    /**
     * Probe an imported media file's duration (seconds) from MAIN, returning
     * null when duration cannot be determined (missing ffprobe / invalid file).
     */
    channel: 'storage:probeMediaDuration'
    request: { ref: ProjectRef; mediaRef: string }
    response: { durationSec: number | null }
  }
  | {
    channel: 'storage:duplicateProject'
    request: { ref: ProjectRef }
    response: ProjectRef
  }
  | {
    channel: 'storage:renameProject'
    request: { ref: ProjectRef; name: string }
    response: ProjectRef
  }
  | {
    channel: 'storage:deleteProject'
    request: { ref: ProjectRef }
    response: { deleted: true }
  }
  | {
    channel: 'storage:revealProject'
    request: { ref: ProjectRef }
    response: { revealed: boolean }
  }
  | {
    /**
     * Open the OS file picker (video + image filter) and return the chosen
     * absolute paths. Empty array on cancel. Paths are plain strings, not
     * Buffers — no media bytes cross IPC (P3.3).
     */
    channel: 'storage:pickMedia'
    request: void
    response: { paths: string[] }
  }
  | {
    /**
     * Copy a picked file into the project bundle's `media/` folder (path-based
     * copy in MAIN) and return the bundle-relative mediaRef + kind (P3.3).
     */
    channel: 'storage:importMedia'
    request: { ref: ProjectRef; sourcePath: string }
    response: ImportMediaResult
  }
  | {
    /**
     * Open the OS file picker (audio filter — MP3 + common audio) and return
     * the chosen absolute paths (P4.1, Doc 02). Empty array on cancel. Paths
     * are plain strings — no media bytes cross IPC.
     */
    channel: 'storage:pickAudio'
    request: void
    response: { paths: string[] }
  }
  | {
    /**
     * Open the OS file picker (TTF/OTF filter) and return the chosen absolute
     * paths (P6.2 — Doc 08). Empty array on cancel. Paths are plain strings —
     * no font bytes cross IPC.
     */
    channel: 'fonts:pickFont'
    request: void
    response: { paths: string[] }
  }
  | {
    /**
     * Copy a picked TTF/OTF into the bundle's `media/fonts/` folder (path-based
     * atomic copy in MAIN) and return the bundle-relative `fileRef` + parsed
     * family/weight/style metadata (P6.2). The renderer turns this into an
     * imported {@link import('./fontParse').FontManifestEntry} it persists to
     * `project.fonts` and a {@link import('./fontRegistry').FontEntry} it
     * registers + loads as a FontFace. NO font bytes cross IPC beyond the path.
     */
    channel: 'fonts:import'
    request: { ref: ProjectRef; sourcePath: string }
    response: ImportFontResult
  }
  | {
    /**
     * Normalize an imported audio file (referenced by its bundle-relative
     * `mediaRef`) to 16 kHz MONO WAV in the bundle's `cache/` folder via FFmpeg
     * (`-ac 1 -ar 16000`), for downstream STT (Doc 02, ffmpeg-export skill).
     * Returns the bundle-relative path of the produced WAV. The conversion runs
     * entirely in MAIN — no audio bytes cross IPC.
     */
    channel: 'ffmpeg:normalizeAudio'
    request: { ref: ProjectRef; mediaRef: string }
    response: { wavRef: string }
  }
  | {
    /**
     * Transcribe a normalized WAV (P4.4, Doc 02) via the active pluggable STT
     * provider. The request carries the bundle-relative `wavRef` (from
     * `ffmpeg:normalizeAudio`) — NEVER audio bytes — and an optional language
     * pin; main resolves the bundle path and delegates to the provider. The
     * response is the word-level {@link Transcript} that downstream writes to
     * `cache/transcript.json` and into `captions.transcript`/`language`. The
     * stub provider is wired now; whisper.cpp drops in behind it (P4.5).
     */
    channel: 'stt:transcribe'
    request: { ref: ProjectRef; wavRef: string; language?: LanguageCode }
    response: Transcript
  }
  | {
    /**
     * Lyrics-first alignment: user-supplied lyrics text is treated as ground
     * truth and aligned to the audio timing for line/word spans.
     */
    channel: 'stt:alignLyrics'
    request: { ref: ProjectRef; wavRef: string; lyrics: string; language?: LanguageCode }
    response: LyricsAlignmentResult
  }
  | {
    /**
     * Run motion tracking (P8.9, Doc 11) via the active pluggable tracking
     * provider. The request carries the bundle-relative `videoRef` (NEVER frame
     * bytes), the picked `target` box (project-resolution px) + kind, and the
     * clip-local `durationSec` / `fps` range; main resolves the bundle path and
     * delegates to the provider. The response is the per-frame {@link TrackPath}
     * the renderer persists to `clip.tracking` (`setClipTrackingCommand`) so the
     * P8.10 compositor can sample it at a time. The stub provider is wired now; a
     * real face/object CV tracker drops in behind it.
     */
    channel: 'tracking:run'
    request: {
      ref: ProjectRef
      videoRef: string
      target: TargetBox
      durationSec: number
      fps: number
    }
    response: TrackPath
  }
  | {
    /**
     * Enumerate available TTS voices from the active provider (P10.2, Doc 12).
     * Returns the list of voices; if no provider is registered, returns an empty
     * list (the renderer degrades to a disabled state).
     */
    channel: 'tts:listVoices'
    request: Record<string, never>
    response: TTSVoice[]
  }
  | {
    /**
     * Synthesize text to audio via the active TTS provider (P10.3, Doc 12).
     * The request carries the project ref (for bundle path resolution) and the
     * synthesis parameters. The provider writes the audio into the bundle's
     * `media/` folder; main returns the bundle-relative `mediaRef` + duration.
     * NO audio bytes cross IPC. On error the wrapper returns `{ok:false,error}`.
     */
    channel: 'tts:synthesize'
    request: TTSSynthesizeRequest & { ref: ProjectRef }
    response: TTSSynthesizeResult
  }
  | {
    /**
     * Translate caption lines via the active translation provider (P10.6, Doc 12).
     * `lines` is the array of source text strings (one per caption clip);
     * `targetLang` is one of the six supported language codes. Returns the
     * translated strings in the same order. On error returns `{ok:false,error}`.
     */
    channel: 'translation:translate'
    request: { lines: string[]; targetLang: string; ref: ProjectRef }
    response: { translated: string[] }
  }
  | {
    /**
     * Transliterate text from one supported language script to another
     * (P10R.1, Doc 16). Returns the transliterated string; on invalid
     * language codes or provider failure, returns the original text unchanged
     * (graceful degradation — never throws across IPC).
     */
    channel: 'transliteration:transliterate'
    request: { text: string; sourceLang: string; targetLang: string }
    response: { result: string }
  }
  | { channel: 'preset:list'; request: Record<string, never>; response: UserPreset[] }
  | {
    channel: 'preset:save'
    request: { preset: UserPreset }
    response: { saved: true }
  }
  | { channel: 'preset:delete'; request: { id: string }; response: { deleted: true } }
  | {
    channel: 'preset:import'
    request: { json: string }
    response: { imported: number; skipped: number; errors: string[] }
  }
  | { channel: 'preset:export'; request: { id: string }; response: { json: string | null } }
  | {
    /**
     * Open the OS save dialog so the user can choose where to write the
     * exported video file. Returns the chosen absolute path, or null when the
     * user cancels. `defaultName` is the pre-filled filename (without path).
     */
    channel: 'storage:pickSavePath'
    request: { format: import('./export').ExportFormat; defaultName: string }
    response: { path: string | null }
  }
  | {
    /**
     * Start an export job (P12.1, Doc 13). Spawns FFmpeg in main, pushes
     * progress over the `export:progress` push channel. Returns the jobId.
     */
    channel: 'export:start'
    request: ExportJob
    response: { jobId: string }
  }
  | {
    /**
     * Cancel a running export job (P12.1, Doc 13). Kills the FFmpeg process.
     */
    channel: 'export:cancel'
    request: { jobId: string }
    response: { cancelled: boolean }
  }
  | {
    /**
     * Retrieve the result of a completed export job (P12.1, Doc 13). Returns
     * bundle-relative refs for the exported video and subtitle sidecars.
     */
    channel: 'export:getResult'
    request: { jobId: string }
    response: ExportResult
  }
  | {
    /**
     * Prepare a scratch directory for a caption-overlay PNG sequence (P13.x).
     * The renderer calls this before rendering overlay frames; main creates
     * `cache/<overlayId>-cap/` inside the bundle and returns its absolute path +
     * the FFmpeg image2 pattern. The dir is later deleted by the export runner.
     */
    channel: 'export:captionFramesInit'
    request: { ref: ProjectRef; overlayId: string }
    response: { dir: string; framesPattern: string }
  }
  | {
    /**
     * Write a batch of caption-overlay PNG frames to disk (P13.x). `frames` are
     * raw PNG bytes; `startIndex` is the frame number of `frames[0]` (files are
     * named `frame_%06d.png`). Main resolves the dir from `ref` + `overlayId`
     * (never trusts a renderer-supplied absolute path). Returns the count written.
     */
    channel: 'export:captionFramesWrite'
    request: { ref: ProjectRef; overlayId: string; startIndex: number; frames: Uint8Array[] }
    response: { written: number }
  }
  | {
    /**
     * Read the app-bundled font faces (resources/fonts) so the renderer can
     * register them as `FontFace`s and shape Indic text on the canvas exactly as
     * it exports (P6.x). Returns the raw TTF bytes + CSS descriptors; missing
     * files are omitted.
     */
    channel: 'fonts:loadBundled'
    request: void
    response: { faces: Array<{ family: string; weight: string; style: string; data: Uint8Array }> }
  }

export type IpcChannel = IpcContract['channel']

export type IpcRequest<C extends IpcChannel> = Extract<IpcContract, { channel: C }>['request']
export type IpcResponse<C extends IpcChannel> = Extract<IpcContract, { channel: C }>['response']

/** Runtime list of known channels (handy for tests / validation). */
export const IPC_CHANNELS = [
  'app:getState',
  'app:ping',
  'storage:listProjects',
  'storage:createProject',
  'storage:readProject',
  'storage:writeProject',
  'storage:resolvePath',
  'storage:probeMediaDuration',
  'storage:duplicateProject',
  'storage:renameProject',
  'storage:deleteProject',
  'storage:revealProject',
  'storage:pickMedia',
  'storage:importMedia',
  'storage:pickAudio',
  'storage:pickSavePath',
  'fonts:pickFont',
  'fonts:import',
  'fonts:loadBundled',
  'ffmpeg:normalizeAudio',
  'stt:transcribe',
  'stt:alignLyrics',
  'tracking:run',
  'tts:listVoices',
  'tts:synthesize',
  'translation:translate',
  'transliteration:transliterate',
  'preset:list',
  'preset:save',
  'preset:delete',
  'preset:import',
  'preset:export',
  'export:start',
  'export:cancel',
  'export:getResult',
  'export:captionFramesInit',
  'export:captionFramesWrite'
] as const

/** The narrow, typed surface exposed on `window.api` by the preload bridge. */
export interface Api {
  invoke<C extends IpcChannel>(
    channel: C,
    request: IpcRequest<C>
  ): Promise<IpcResult<IpcResponse<C>>>
  on(channel: string, listener: (payload: unknown) => void): () => void
}

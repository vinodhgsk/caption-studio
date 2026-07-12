/**
 * whisper.cpp STT provider (P4.5, Doc 02 — auto-caption).
 *
 * Spawns the whisper.cpp CLI (`whisper-cli` / legacy `main`) on the normalized
 * 16 kHz mono WAV produced by `ffmpeg:normalizeAudio`, with WORD-LEVEL timestamps
 * (`--max-len 1` so each segment is a single word + `--output-json-full` so the
 * per-token `offsets` land in the JSON) and LANGUAGE AUTO-DETECT restricted to
 * the six supported codes (unless `opts.language` pins one). It parses the JSON
 * sidecar into a {@link Transcript} with per-word start/end in seconds.
 *
 * Mirrors the FFmpeg module's boundaries (normalizeAudio.ts):
 *   - binary + model path via env overrides (CAPTION_STUDIO_WHISPER_BIN /
 *     CAPTION_STUDIO_WHISPER_MODEL),
 *   - a thin `runWhisper`-style spawn boundary that touches the OS,
 *   - PURE arg-builder (`buildWhisperArgs`) and PURE parser
 *     (`parseWhisperJson`) so both are unit-testable WITHOUT the binary.
 *
 * Imports node `child_process`/`fs` but NOT electron, so the pure helpers stay
 * testable. If the binary or model is absent, `transcribe` throws a clear error;
 * the IPC wrapper turns the throw into `{ ok:false, error }` and the registry
 * keeps the stub as the graceful fallback (registry.ts → `selectDefaultProvider`).
 */
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { bundleLayout } from '../storage/bundle'
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  asLanguageCode,
  type LanguageCode,
  type SttProvider,
  type Transcript,
  type Word
} from '../../shared/stt'

/** Provider id used by the registry. */
export const WHISPER_PROVIDER_ID = 'whisper'

/** whisper.cpp binary to invoke. Overridable for tests/CI. Default: `whisper-cli`. */
export function whisperBin(): string {
  return process.env.CAPTION_STUDIO_WHISPER_BIN ?? 'whisper-cli'
}

/** whisper.cpp ggml model path. Overridable; default points at a base ggml model. */
export function whisperModel(): string {
  return process.env.CAPTION_STUDIO_WHISPER_MODEL ?? 'models/ggml-base.bin'
}

/**
 * True when both the whisper binary (absolute path) and the model file exist on
 * disk, so the registry can pick whisper as the default only when usable and
 * otherwise fall back to the stub. A bare command name (no separator) is treated
 * as "on PATH" → assume present (we cannot cheaply stat a PATH lookup here).
 */
export function isWhisperAvailable(): boolean {
  const bin = whisperBin()
  const binOk = bin.includes('/') || bin.includes('\\') ? existsSync(bin) : true
  return binOk && existsSync(whisperModel())
}

/**
 * The JSON sidecar base path whisper.cpp writes when `--output-json` is set:
 * for `-of <prefix>` the file is `<prefix>.json`. Pure.
 */
export function whisperJsonPath(outputPrefixAbs: string): string {
  return `${outputPrefixAbs}.json`
}

/**
 * Build the whisper.cpp argument vector. Pure (no spawn).
 *
 * - `--max-len 1` forces ONE WORD per segment → word-level granularity.
 * - `--output-json-full` writes the JSON sidecar (with token offsets) next to
 *   `--output-file <prefix>` so we never parse stdout.
 * - When `language` is pinned we pass `--language <code>`; otherwise
 *   `--language auto` so whisper detects (we clamp the result to the supported
 *   set with a Tamil fallback in the parser).
 */
export function buildWhisperArgs(
  modelAbs: string,
  wavAbs: string,
  outputPrefixAbs: string,
  language?: LanguageCode
): string[] {
  return [
    '--model',
    modelAbs,
    '--file',
    wavAbs,
    '--language',
    language ?? 'auto',
    '--max-len',
    '1',
    '--output-json-full',
    '--output-file',
    outputPrefixAbs
  ]
}

/** Convert a whisper.cpp offset in MILLISECONDS to SECONDS (rounded to 3dp). */
function msToSeconds(ms: number): number {
  return Math.round(ms) / 1000
}

/**
 * Parse the whisper.cpp `--output-json-full` document into a {@link Transcript}.
 * PURE — takes the already-`JSON.parse`d object so it is trivially testable
 * against a fixture (no fs, no binary).
 *
 * Shape consumed (whisper.cpp output-json-full):
 *   {
 *     "result": { "language": "ta" },
 *     "transcription": [
 *       { "offsets": { "from": 0, "to": 420 },   // ms
 *         "text": " வணக்கம்",
 *         "tokens": [ { "text": "...", "offsets": { "from": 0, "to": 420 } } ] }
 *     ]
 *   }
 *
 * With `--max-len 1` each `transcription[]` entry is a single word, so we use the
 * SEGMENT text + its `offsets` for the word, falling back to token offsets. The
 * detected language is clamped to {@link SUPPORTED_LANGUAGES} (Tamil fallback).
 * Empty / punctuation-only segments are dropped. `pinned` (the requested
 * language) wins over the detected value when provided.
 */
export function parseWhisperJson(doc: unknown, pinned?: LanguageCode): Transcript {
  const root = isRecord(doc) ? doc : {}
  const result = isRecord(root.result) ? root.result : {}
  const detected = typeof result.language === 'string' ? asLanguageCode(result.language) : null
  const language: LanguageCode = pinned ?? detected ?? DEFAULT_LANGUAGE

  const segments = Array.isArray(root.transcription) ? root.transcription : []
  const words: Word[] = []
  for (const seg of segments) {
    if (!isRecord(seg)) continue
    const text = typeof seg.text === 'string' ? seg.text.trim() : ''
    if (text.length === 0) continue
    const span = readOffsets(seg) ?? readFirstTokenOffsets(seg)
    if (span === null) continue
    const start = msToSeconds(span.from)
    const end = msToSeconds(span.to)
    words.push({ text, start, end: end >= start ? end : start })
  }
  return { language, words }
}

/** Read `{ from, to }` (ms) from an entry's `offsets`, or null if absent. */
function readOffsets(entry: Record<string, unknown>): { from: number; to: number } | null {
  const offsets = isRecord(entry.offsets) ? entry.offsets : null
  if (offsets === null) return null
  const from = offsets.from
  const to = offsets.to
  if (typeof from !== 'number' || typeof to !== 'number') return null
  return { from, to }
}

/** Fall back to the first token's offsets when the segment has none. */
function readFirstTokenOffsets(
  entry: Record<string, unknown>
): { from: number; to: number } | null {
  const tokens = Array.isArray(entry.tokens) ? entry.tokens : []
  for (const tok of tokens) {
    if (!isRecord(tok)) continue
    const off = readOffsets(tok)
    if (off !== null) return off
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Spawn whisper.cpp with `args`; resolve on exit 0, reject with a clear error
 * otherwise (mirrors `runFfmpeg`). The OS boundary — not exercised by unit tests.
 */
function runWhisper(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(whisperBin(), args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) =>
      reject(
        new Error(
          `Failed to launch whisper.cpp ("${whisperBin()}"): ${err.message}. ` +
            'Is whisper.cpp installed and CAPTION_STUDIO_WHISPER_BIN set?'
        )
      )
    )
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`whisper.cpp exited with code ${code}: ${stderr.trim().slice(-500)}`))
    })
  })
}

/**
 * The real whisper.cpp provider. Reads the WAV at `wavRef` within `bundlePath`,
 * runs whisper.cpp into a JSON sidecar in `cache/`, parses it, and returns the
 * {@link Transcript}. Persisting the transcript to `cache/transcript.json` and
 * setting `captions.*` is done by the `stt:transcribe` handler (index.ts) so this
 * provider stays a pure transcriber behind the {@link SttProvider} contract.
 */
export class WhisperSttProvider implements SttProvider {
  readonly id = WHISPER_PROVIDER_ID

  async transcribe(
    bundlePath: string,
    wavRef: string,
    opts?: { language?: LanguageCode }
  ): Promise<Transcript> {
    const model = whisperModel()
    if (!existsSync(model)) {
      throw new Error(
        `whisper.cpp model not found at "${model}". Set CAPTION_STUDIO_WHISPER_MODEL ` +
          'to a ggml model file (e.g. ggml-base.bin).'
      )
    }
    const layout = bundleLayout(bundlePath)
    // wavRef is bundle-relative (e.g. cache/voice.16k.mono.wav); resolve in-bundle.
    const wavAbs = join(layout.root, wavRef)
    // JSON sidecar lives next to the WAV in cache/ under a fixed prefix.
    const outputPrefixAbs = join(layout.cache, 'whisper')

    await runWhisper(buildWhisperArgs(model, wavAbs, outputPrefixAbs, opts?.language))

    const jsonAbs = whisperJsonPath(outputPrefixAbs)
    let raw: string
    try {
      raw = await readFile(jsonAbs, 'utf8')
    } catch (err: unknown) {
      const why = err instanceof Error ? err.message : String(err)
      throw new Error(`whisper.cpp produced no JSON output at "${jsonAbs}": ${why}`)
    }
    let doc: unknown
    try {
      doc = JSON.parse(raw)
    } catch (err: unknown) {
      const why = err instanceof Error ? err.message : String(err)
      throw new Error(`Failed to parse whisper.cpp JSON output: ${why}`)
    }
    return parseWhisperJson(doc, opts?.language)
  }
}

/** Exposed for callers/tests that want the supported-language list inline. */
export { SUPPORTED_LANGUAGES }

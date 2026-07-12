/**
 * P4.12 — MILESTONE 4 GATE: "MP3 → captions land on the right words."
 *
 * This is the end-to-end MOCK-STT test that closes Milestone 4. It is the ONE
 * place that wires the registry seam to the grouping + caption-clip builders and
 * asserts the milestone's acceptance criteria as a single chain:
 *
 *   register a mock SttProvider (via setActiveSttProvider)
 *     → getSttProvider().transcribe(...)            (the registry resolves OUR mock)
 *       → groupWordsIntoLines  (P4.6)
 *         → buildCaptionClipsFromTranscript (P4.7)
 *
 * The mock stands in for a KNOWN-SCRIPT MP3: a fixed `words[]` array with known
 * spoken `{start,end}` times. We assert (a) the reassembled caption TEXT equals
 * the known script and (b) every caption clip's `start`/`out` lands within ±1
 * frame of the spoken word times, at an integer (30) AND a fractional (23.976)
 * fps — the frame tolerance is computed FROM frame.ts (`secondsToFrame`).
 *
 * DELIBERATELY NOT DUPLICATED HERE:
 *   - Pure grouping boundary rules → captionSync.test.ts.
 *   - Per-clip ±1-frame boundary + active-word mapping → captionTiming.test.ts.
 *   - Registry precedence mechanics (env vs explicit) → registry.test.ts.
 * What is unique here is the REGISTRY-RESOLVED mock provider feeding the FULL
 * transcript→clips chain and proving the words land on the right captions.
 *
 * Pure + deterministic: no real audio, no whisper binary, no IPC. The previous
 * active provider id is restored after each test so nothing leaks across files.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  SttProvider,
  Transcript,
  TranscribeOptions,
  Word
} from '../../shared/stt'
import { groupWordsIntoLines } from '../../shared/captionSync'
import { buildCaptionClipsFromTranscript } from '../../renderer/store/timeline/captionTrack'
import { secondsToFrame } from '../../renderer/store/timeline/frame'
import {
  getSttProvider,
  registerSttProvider,
  setActiveSttProvider
} from './registry'

/**
 * The KNOWN SCRIPT standing in for a fixture MP3. Two sentences with a
 * deliberate >0.7s pause between them so grouping splits into multiple blocks,
 * exercising the FULL chain rather than a single trivial line. Times are
 * frame-friendly-ish but NOT all frame-aligned, so the ±1-frame assertion is
 * meaningful (a regression that nudges a clip time would be caught).
 */
const KNOWN_WORDS: Word[] = [
  word('Welcome', 0.5, 0.96),
  word('to', 1.0, 1.18),
  word('the', 1.2, 1.42),
  word('show.', 1.45, 2.0),
  // 1.0s silent gap (> default 0.7 pauseGap) → new caption block starts here.
  word('Let', 3.0, 3.22),
  word('us', 3.25, 3.5),
  word('begin.', 3.55, 4.2)
]

/** The exact script a viewer should read, line by line (with the pause split). */
const EXPECTED_SCRIPT_LINES = ['Welcome to the show.', 'Let us begin.']

/** The whole spoken script as one string, for a text-equality sanity check. */
const EXPECTED_SCRIPT = 'Welcome to the show. Let us begin.'

/** Integer + fractional (NTSC-film) fps the milestone calls out. */
const FPS_VALUES = [30, 23.976] as const

const MOCK_PROVIDER_ID = 'mock-known-script'

/**
 * A deterministic mock STT provider that returns the KNOWN-SCRIPT transcript
 * regardless of the WAV it is handed — it stands in for "transcribing a known
 * MP3". It honours a pinned language like a real provider but otherwise ignores
 * its inputs, so the test result depends ONLY on the fixture (fully reproducible).
 */
class MockKnownScriptProvider implements SttProvider {
  readonly id = MOCK_PROVIDER_ID

  async transcribe(
    _bundlePath: string,
    _wavRef: string,
    opts?: TranscribeOptions
  ): Promise<Transcript> {
    return { language: opts?.language ?? 'en', words: KNOWN_WORDS.map((w) => ({ ...w })) }
  }
}

function word(text: string, start: number, end: number): Word {
  return { text, start, end }
}

/** Deterministic id minter (no crypto.randomUUID dependency in the harness). */
function seqIds(prefix = 'cap'): () => string {
  let n = 0
  return () => `${prefix}-${n++}`
}

describe('P4.12 — Milestone 4 gate: known-script MP3 → captions on the right words (mock STT)', () => {
  // Snapshot whatever provider was active so we restore it (no cross-file leak).
  let savedEnv: string | undefined

  beforeEach(() => {
    savedEnv = process.env.CAPTION_STUDIO_STT_PROVIDER
    delete process.env.CAPTION_STUDIO_STT_PROVIDER
    registerSttProvider(new MockKnownScriptProvider())
    setActiveSttProvider(MOCK_PROVIDER_ID)
  })

  afterEach(() => {
    // Clear the explicit selection and restore the env so the registry falls back
    // to its real default for every other test/file.
    setActiveSttProvider(null)
    if (savedEnv === undefined) delete process.env.CAPTION_STUDIO_STT_PROVIDER
    else process.env.CAPTION_STUDIO_STT_PROVIDER = savedEnv
  })

  it('resolves OUR mock provider through the registry seam (callers never construct it)', () => {
    expect(getSttProvider().id).toBe(MOCK_PROVIDER_ID)
  })

  it('the mock transcript reassembles to the exact known script (no words lost/reordered)', async () => {
    const transcript = await getSttProvider().transcribe('/bundle.vproj', 'cache/voice.16k.mono.wav')
    expect(transcript.words.map((w) => w.text).join(' ')).toBe(EXPECTED_SCRIPT)
    // Every spoken word appears in exactly one grouped line, in order.
    const lines = groupWordsIntoLines(transcript.words, { maxCharsPerLine: 100 })
    expect(lines.flatMap((l) => l.words)).toEqual(transcript.words)
  })

  it('grouping the mock transcript yields the expected per-line script (pause splits blocks)', async () => {
    const transcript = await getSttProvider().transcribe('/b.vproj', 'cache/x.wav', { language: 'en' })
    // Wide line width so ONLY the pause gap (not wrapping) decides the split.
    const lines = groupWordsIntoLines(transcript.words, { maxCharsPerLine: 100 })
    expect(lines.map((l) => l.text)).toEqual(EXPECTED_SCRIPT_LINES)
  })

  for (const fps of FPS_VALUES) {
    it(`caption clips carry the right text AND start/out within ±1 frame @ ${fps}fps`, async () => {
      // The full milestone chain, driven by the registry-resolved mock provider.
      const transcript = await getSttProvider().transcribe('/b.vproj', 'cache/x.wav', {
        language: 'en'
      })
      const clips = buildCaptionClipsFromTranscript(transcript, seqIds(), { maxCharsPerLine: 100 })

      // The clips ARE the known script, one clip per spoken caption line.
      expect(clips.map((c) => c.text?.lines?.[0])).toEqual(EXPECTED_SCRIPT_LINES)
      expect(clips.length).toBeGreaterThan(1) // the pause really did split

      // Re-derive the lines to know each clip's first/last spoken word.
      const lines = groupWordsIntoLines(transcript.words, { maxCharsPerLine: 100 })
      expect(clips).toHaveLength(lines.length)

      for (let i = 0; i < clips.length; i++) {
        const clip = clips[i]
        const ln = lines[i]
        const firstWord = ln.words[0]
        const lastWord = ln.words[ln.words.length - 1]

        // ±1 frame at THIS fps, measured in frame-index distance (frame.ts).
        // `out` is the clip DURATION (in === 0); the on-screen END is start + out.
        const clipEnd = clip.start + (clip.out - clip.in)
        const startDrift = Math.abs(
          secondsToFrame(clip.start, fps) - secondsToFrame(firstWord.start, fps)
        )
        const outDrift = Math.abs(
          secondsToFrame(clipEnd, fps) - secondsToFrame(lastWord.end, fps)
        )
        expect(startDrift).toBeLessThanOrEqual(1)
        expect(outDrift).toBeLessThanOrEqual(1)

        // Each caption clip also preserves the per-word timing of the spoken
        // words it covers (so Phase 5 active-word highlight can colour them).
        expect(clip.caption?.words).toEqual(
          ln.words.map((w) => ({ text: w.text, start: w.start, end: w.end }))
        )
      }
    })
  }

  it('the FIRST caption appears at the first spoken word and the LAST ends at the last word', async () => {
    const transcript = await getSttProvider().transcribe('/b.vproj', 'cache/x.wav')
    const clips = buildCaptionClipsFromTranscript(transcript, seqIds(), { maxCharsPerLine: 100 })
    expect(clips[0].start).toBe(KNOWN_WORDS[0].start) // 0.5 — caption onset == speech onset
    // clip END (start + duration) == last spoken word end (4.2).
    const lastClip = clips[clips.length - 1]
    expect(lastClip.start + (lastClip.out - lastClip.in)).toBeCloseTo(
      KNOWN_WORDS[KNOWN_WORDS.length - 1].end,
      6
    )
  })

  it('language detected by the mock flows onto every caption clip (Indic shaping tag)', async () => {
    const transcript = await getSttProvider().transcribe('/b.vproj', 'cache/x.wav', { language: 'ta' })
    expect(transcript.language).toBe('ta')
    const clips = buildCaptionClipsFromTranscript(transcript, seqIds())
    expect(clips.every((c) => c.text?.lang === 'ta')).toBe(true)
  })
})

/**
 * END-TO-END pipeline test for the FIVE implemented data-flow phases, driven
 * through the REAL renderer stores and the REAL (electron-free) main-process
 * providers via {@link createE2EHarness}. This is the production-shaped path a
 * user takes — create a project, upload a video/image, add text, import audio,
 * auto-caption it, style the captions — with every artifact validated on disk
 * and every evaluator (caption timing, active-word highlight, animation sample)
 * exercised exactly as the preview/export do.
 *
 *   Phase 1 — Storage:        create / open / save a `.vproj` bundle on disk.
 *   Phase 2 — Projects+Editor: open into the editor, undo/redo, save lifecycle.
 *   Phase 3 — Timeline+Media:  upload video + image + a text layer; edit clips.
 *   Phase 4 — Audio+Caption:   upload audio → normalize → transcribe → captions
 *                              land on the right words (±1 frame).
 *   Phase 5 — Caption Styles:  apply a premium preset; active-word highlight and
 *                              the composed animation sample evaluate correctly.
 *
 * A final FULL-PIPELINE test runs all five back-to-back, saves, reopens from
 * disk, and re-validates — the ultimate "production result" check.
 */
import { readFile, readdir } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Project, ProjectRef, ProjectTrack } from '../shared/storage'
import type { Aspect } from '../renderer/routes/home/aspect'
import { CAPTION_TRACK_ID, snapToFrame } from '../renderer/store/timeline'
import { IDENTITY_SAMPLE, evaluateClipAnimation } from '../renderer/store/timeline/clipAnimation'
import { composeClipSample } from '../renderer/store/timeline/keyframeSampler'
import { activeWordIndex } from '../renderer/store/timeline/captionHighlight'
import { groupWordsIntoLines } from '../shared/captionSync'
import { getCaptionPreset } from '../shared/captionPresetRegistry'
import { captionPresetToClipStyle } from '../shared/captionPreset'
import { mediaKindFromExtension } from '../main/storage/media'
import { useProjectStore } from '../renderer/store/projectStore'
import { useTimelineStore } from '../renderer/store/timelineStore'
import {
  ENGLISH_LINES,
  ENGLISH_TRANSCRIPT,
  TAMIL_TRANSCRIPT,
  createE2EHarness,
  parseWav,
  type E2EHarness
} from './harness'

// ---------------------------------------------------------------------------
// Shared helpers — thin wrappers over the real store actions.
// ---------------------------------------------------------------------------

const FPS = 30
/** ±1 frame tolerance in seconds at the project fps (the caption-sync acceptance). */
const FRAME_TOLERANCE = 1 / FPS

/** The currently-open project (throws if none — keeps assertions terse + safe). */
function project(): Project {
  const p = useProjectStore.getState().currentProject
  if (p === null) throw new Error('expected a project to be open')
  return p
}

/** Find a track by type (throws if absent). */
function trackOfType(type: ProjectTrack['type']): ProjectTrack {
  const t = project().tracks.find((tr) => tr.type === type)
  if (t === undefined) throw new Error(`expected a ${type} track`)
  return t
}

/** The dedicated Caption track (throws if absent). */
function captionTrack(): ProjectTrack {
  const t = project().tracks.find((tr) => tr.id === CAPTION_TRACK_ID)
  if (t === undefined) throw new Error('expected the caption track')
  return t
}

/** Create AND open a fresh project into the editor; return its bundle ref. */
async function openNewProject(
  opts: { name: string; aspect: Aspect; fps: number; language: string }
): Promise<ProjectRef> {
  const created = await useProjectStore.getState().createProject({ location: 'local', ...opts })
  if (!created.ok) throw new Error(created.error)
  await useProjectStore.getState().openProject(created.ref)
  return created.ref
}

/** Run the full auto-caption flow (import audio → normalize → transcribe → group). */
async function autoCaption(
  h: E2EHarness,
  transcript = ENGLISH_TRANSCRIPT
): Promise<{ wavRef: string; mediaRef: string }> {
  h.queueAudioPick([h.fixtures.audio])
  const imported = await useTimelineStore.getState().importAudio()
  if (!imported.ok || imported.mediaRef === null) throw new Error('audio import failed')

  const normalized = await useTimelineStore.getState().normalizeAudio(imported.mediaRef)
  if (!normalized.ok) throw new Error(normalized.error)

  h.queueTranscript(transcript)
  const result = await useTimelineStore.getState().transcribe(normalized.wavRef)
  if (!result.ok) throw new Error(result.error)

  useTimelineStore.getState().generateCaptions(result.transcript)
  return { wavRef: normalized.wavRef, mediaRef: imported.mediaRef }
}

/** Run the lyrics-first flow (import audio -> normalize -> align user lyrics -> emit captions). */
async function lyricsFirstCaption(
  h: E2EHarness,
  lyrics: string,
  transcript = ENGLISH_TRANSCRIPT
): Promise<{ wavRef: string; mediaRef: string }> {
  h.queueAudioPick([h.fixtures.audio])
  const imported = await useTimelineStore.getState().importAudio()
  if (!imported.ok || imported.mediaRef === null) throw new Error('audio import failed')

  const normalized = await useTimelineStore.getState().normalizeAudio(imported.mediaRef)
  if (!normalized.ok) throw new Error(normalized.error)

  h.queueTranscript(transcript)
  const aligned = await useTimelineStore.getState().alignLyrics(normalized.wavRef, lyrics)
  if (!aligned.ok) throw new Error(aligned.error)

  const ids = useTimelineStore
    .getState()
    .generateCaptionsFromLines(
      aligned.alignment.lines.map((line) => ({
        text: line.text,
        start: line.start,
        out: line.end,
        words: line.words.map((w) => ({
          text: w.text,
          start: w.start,
          end: w.end,
          confidence: w.confidence
        }))
      })),
      aligned.alignment.language
    )
  if (ids === null) throw new Error('caption generation failed')

  return { wavRef: normalized.wavRef, mediaRef: imported.mediaRef }
}

// ---------------------------------------------------------------------------

let harness: E2EHarness

beforeEach(async () => {
  harness = await createE2EHarness()
  harness.install()
})

afterEach(async () => {
  await harness.cleanup()
})

// ===========================================================================
// PHASE 1 — STORAGE
// ===========================================================================
describe('Phase 1 — Storage: create / open / save a project bundle on disk', () => {
  it('scaffolds a .vproj bundle with project.json + media/cache/exports dirs', async () => {
    const ref = await openNewProject({ name: 'Phase One', aspect: '9:16', fps: 30, language: 'ta' })

    const entries = await readdir(ref.path)
    expect(entries).toEqual(
      expect.arrayContaining(['project.json', 'media', 'cache', 'exports'])
    )

    const onDisk = JSON.parse(
      (await harness.readBundleFile(ref.path, 'project.json')).toString()
    ) as Project
    expect(onDisk.id).toBe(ref.id)
    expect(onDisk.settings.aspect).toBe('9:16')
    expect(onDisk.settings.resolution).toEqual([1080, 1920])
    expect(onDisk.settings.fps).toBe(30)
    expect(onDisk.settings.language).toBe('ta')
    // The six Indic-first languages ship on every project (master plan §4).
    expect(onDisk.settings.languages).toEqual(['ta', 'te', 'ml', 'kn', 'hi', 'en'])
  })

  it('lists the created project from the storage root', async () => {
    await openNewProject({ name: 'Listed Project', aspect: '16:9', fps: 30, language: 'en' })
    await useProjectStore.getState().loadProjects('local')

    const names = useProjectStore.getState().projects.map((p) => p.name)
    expect(names).toContain('Listed Project')
  })

  it('round-trips a save: an edit persists to project.json and updatedAt advances', async () => {
    const ref = await openNewProject({ name: 'Round Trip', aspect: '16:9', fps: 30, language: 'en' })
    const before = project().updatedAt

    useTimelineStore.getState().addTextClip()
    expect(useProjectStore.getState().isDirty).toBe(true)

    await useProjectStore.getState().saveProject()
    expect(useProjectStore.getState().saveStatus).toBe('saved')
    expect(useProjectStore.getState().isDirty).toBe(false)

    const onDisk = JSON.parse(
      (await harness.readBundleFile(ref.path, 'project.json')).toString()
    ) as Project
    expect(onDisk.updatedAt >= before).toBe(true)
    const everyClip = onDisk.tracks.flatMap((t) => t.clips)
    expect(everyClip.some((c) => c.text?.lines !== undefined && c.text.lines.length > 0)).toBe(true)
  })
})

// ===========================================================================
// PHASE 2 — PROJECTS HOME & EDITOR SHELL
// ===========================================================================
describe('Phase 2 — Projects & Editor: open, undo/redo, save lifecycle', () => {
  it('opens a project into the editor with ready status', async () => {
    await openNewProject({ name: 'Editor Open', aspect: '16:9', fps: 30, language: 'en' })
    expect(useProjectStore.getState().openStatus).toBe('ready')
    expect(useProjectStore.getState().currentProject).not.toBeNull()
    expect(useProjectStore.getState().isDirty).toBe(false)
  })

  it('undoes and redoes an edit through the command stack', async () => {
    await openNewProject({ name: 'Undo Redo', aspect: '16:9', fps: 30, language: 'en' })

    const clipId = useTimelineStore.getState().addTextClip()
    expect(clipId).not.toBeNull()
    expect(useProjectStore.getState().canUndo()).toBe(true)

    const countAfterAdd = project().tracks.flatMap((t) => t.clips).length
    expect(countAfterAdd).toBeGreaterThan(0)

    useProjectStore.getState().undo()
    expect(project().tracks.flatMap((t) => t.clips).length).toBe(countAfterAdd - 1)
    expect(useProjectStore.getState().canRedo()).toBe(true)

    useProjectStore.getState().redo()
    expect(project().tracks.flatMap((t) => t.clips).length).toBe(countAfterAdd)
  })

  it('drives the save lifecycle: dirty → saving → saved with a timestamp', async () => {
    await openNewProject({ name: 'Save Lifecycle', aspect: '16:9', fps: 30, language: 'en' })
    useTimelineStore.getState().addTextClip()

    expect(useProjectStore.getState().isDirty).toBe(true)
    await useProjectStore.getState().saveProject()

    expect(useProjectStore.getState().saveStatus).toBe('saved')
    expect(useProjectStore.getState().isDirty).toBe(false)
    expect(useProjectStore.getState().lastSavedAt).not.toBeNull()
  })
})

// ===========================================================================
// PHASE 3 — TIMELINE & MEDIA (video / image / text)
// ===========================================================================
describe('Phase 3 — Timeline & Media: upload video / image / text and edit', () => {
  it('uploads a video file into the bundle and lands a clip on the video track', async () => {
    const ref = await openNewProject({ name: 'Video Up', aspect: '16:9', fps: 30, language: 'en' })

    harness.queueMediaPick([harness.fixtures.video])
    const result = await useTimelineStore.getState().importMedia()
    expect(result).toEqual({ ok: true, imported: 1 })

    // The real file was copied byte-for-byte into the bundle's media/ folder.
    const src = await readFile(harness.fixtures.video)
    const dst = await harness.readBundleFile(ref.path, 'media/clip.mp4')
    expect(dst.equals(src)).toBe(true)

    const video = trackOfType('video')
    expect(video.clips).toHaveLength(1)
    expect(video.clips[0].mediaRef).toBe('media/clip.mp4')
    expect(video.clips[0].in).toBe(0)
    expect(video.clips[0].out).toBe(5)
    expect(video.clips[0].start).toBe(0)
  })

  it('uploads an image and appends it after the video on the same visual track', async () => {
    await openNewProject({ name: 'Image Up', aspect: '16:9', fps: 30, language: 'en' })

    harness.queueMediaPick([harness.fixtures.video])
    await useTimelineStore.getState().importMedia()
    harness.queueMediaPick([harness.fixtures.image])
    const result = await useTimelineStore.getState().importMedia()
    expect(result).toEqual({ ok: true, imported: 1 })

    const video = trackOfType('video')
    expect(video.clips).toHaveLength(2)
    // The image appends right after the 5s video clip (no overlap).
    expect(video.clips[1].mediaRef).toBe('media/logo.png')
    expect(video.clips[1].start).toBe(5)
    expect(video.clips[1].out).toBe(5)
  })

  it('applies an undoable transform to an imported clip', async () => {
    await openNewProject({ name: 'Transform', aspect: '16:9', fps: 30, language: 'en' })
    harness.queueMediaPick([harness.fixtures.video])
    await useTimelineStore.getState().importMedia()

    const clipId = trackOfType('video').clips[0].id
    useTimelineStore.getState().setClipTransform(clipId, { x: 120, rotation: 30, opacity: 0.4 })

    const moved = trackOfType('video').clips.find((c) => c.id === clipId)
    expect(moved?.transform.x).toBe(120)
    expect(moved?.transform.rotation).toBe(30)
    expect(moved?.transform.opacity).toBe(0.4)

    useProjectStore.getState().undo()
    const restored = trackOfType('video').clips.find((c) => c.id === clipId)
    expect(restored?.transform.x).toBe(0)
    expect(restored?.transform.rotation).toBe(0)
    expect(restored?.transform.opacity).toBe(1)
  })

  it('splits a clip at a timeline time into two clips', async () => {
    await openNewProject({ name: 'Split', aspect: '16:9', fps: 30, language: 'en' })
    harness.queueMediaPick([harness.fixtures.video])
    await useTimelineStore.getState().importMedia()

    const clipId = trackOfType('video').clips[0].id
    const rightId = crypto.randomUUID()
    useTimelineStore.getState().splitClip(clipId, 2.5, rightId)

    const clips = trackOfType('video').clips
    expect(clips).toHaveLength(2)
    // The two halves tile the original [0,5] span with no gap/overlap.
    const ends = clips.map((c) => c.start + (c.out - c.in)).sort((a, b) => a - b)
    expect(ends[ends.length - 1]).toBeCloseTo(5, 6)
  })

  it('creates and edits a multi-line text layer (manual breaks)', async () => {
    await openNewProject({ name: 'Text Layer', aspect: '16:9', fps: 30, language: 'en' })

    const clipId = useTimelineStore.getState().addTextClip()
    expect(clipId).not.toBeNull()
    if (clipId === null) return

    useTimelineStore.getState().beginTextEdit(clipId)
    useTimelineStore.getState().commitTextEdit(clipId, 'Line A\nLine B')

    const textClip = trackOfType('text').clips.find((c) => c.id === clipId)
    expect(textClip?.text?.lines).toEqual(['Line A', 'Line B'])
  })

  it('seeks the playhead to a frame-accurate position', async () => {
    await openNewProject({ name: 'Seek', aspect: '16:9', fps: 30, language: 'en' })
    harness.queueMediaPick([harness.fixtures.video])
    await useTimelineStore.getState().importMedia()

    useTimelineStore.getState().seek(2.51)
    const playhead = useTimelineStore.getState().playhead
    // The seek snaps to the nearest whole frame at 30 fps.
    expect(playhead).toBeCloseTo(snapToFrame(2.51, FPS), 9)
    expect(Number.isInteger(Math.round(playhead * FPS))).toBe(true)
  })
})

// ===========================================================================
// PHASE 4 — AUDIO & AUTO-CAPTION (MP3 word sync)
// ===========================================================================
describe('Phase 4 — Audio & Auto-Caption: upload audio → captions on the right words', () => {
  it('classifies common audio extensions (incl. MP3) as audio media', () => {
    // The headline MP3 import path classifies by extension, identical to the WAV
    // fixture this suite uploads — so the pipeline is codec-agnostic.
    expect(mediaKindFromExtension('podcast.mp3')).toBe('audio')
    expect(mediaKindFromExtension('narration.wav')).toBe('audio')
    expect(mediaKindFromExtension('voice.m4a')).toBe('audio')
  })

  it('uploads audio and normalizes it to a valid 16 kHz mono WAV in cache/', async () => {
    const ref = await openNewProject({ name: 'Audio Norm', aspect: '16:9', fps: 30, language: 'en' })

    harness.queueAudioPick([harness.fixtures.audio])
    const imported = await useTimelineStore.getState().importAudio()
    expect(imported.ok).toBe(true)
    if (!imported.ok || imported.mediaRef === null) return
    expect(imported.mediaRef).toBe('media/narration.wav')

    // The audio clip lands on a dedicated audio track using the REAL source
    // duration (the fixture is 5s), not a placeholder default span.
    const audio = trackOfType('audio')
    expect(audio.clips).toHaveLength(1)
    expect(audio.clips[0].out).toBeCloseTo(5, 6)

    const normalized = await useTimelineStore.getState().normalizeAudio(imported.mediaRef)
    expect(normalized.ok).toBe(true)
    if (!normalized.ok) return

    const wav = parseWav(await harness.readBundleFile(ref.path, normalized.wavRef))
    expect(wav.riff).toBe('RIFF')
    expect(wav.wave).toBe('WAVE')
    expect(wav.audioFormat).toBe(1) // PCM
    expect(wav.channels).toBe(1) // mono
    expect(wav.sampleRate).toBe(16000) // 16 kHz
    expect(wav.bitsPerSample).toBe(16)
    expect(wav.dataBytes).toBeGreaterThan(0)
  })

  it('transcribes and groups captions so each clip lands within ±1 frame of the words', async () => {
    await openNewProject({ name: 'Caption Sync', aspect: '16:9', fps: 30, language: 'en' })
    await autoCaption(harness, ENGLISH_TRANSCRIPT)

    const clips = captionTrack().clips
    const expectedLines = groupWordsIntoLines(ENGLISH_TRANSCRIPT.words)
    expect(clips).toHaveLength(expectedLines.length)

    // The reassembled script reads exactly as spoken, split into the two blocks.
    expect(clips.map((c) => c.text?.lines?.[0])).toEqual([...ENGLISH_LINES])

    // Every caption clip's start + END lands within ±1 frame of the spoken line.
    // `out` is the clip DURATION (in === 0), so the on-screen END is start + out.
    clips.forEach((clip, i) => {
      expect(Math.abs(clip.start - expectedLines[i].start)).toBeLessThanOrEqual(FRAME_TOLERANCE)
      const clipEnd = clip.start + (clip.out - clip.in)
      expect(Math.abs(clipEnd - expectedLines[i].out)).toBeLessThanOrEqual(FRAME_TOLERANCE)
    })

    // And exactly on the spoken word boundaries (grouping copies the times).
    expect(clips[0].start).toBeCloseTo(0.5, 6)
    expect(clips[0].start + clips[0].out).toBeCloseTo(2.3, 6)
    expect(clips[1].start).toBeCloseTo(3.2, 6)
    expect(clips[1].start + clips[1].out).toBeCloseTo(4.6, 6)

    // Per-word timing travels on each clip for active-word highlight.
    expect(clips[0].caption?.words.map((w) => w.text)).toEqual([
      'Welcome',
      'to',
      'Caption',
      'Studio.'
    ])
  })

  it('re-syncs captions from the stored transcript without re-running STT', async () => {
    await openNewProject({ name: 'Resync', aspect: '16:9', fps: 30, language: 'en' })
    await autoCaption(harness, ENGLISH_TRANSCRIPT)

    expect(useTimelineStore.getState().hasCaptionTranscript()).toBe(true)
    const before = captionTrack().clips.map((c) => ({ start: c.start, out: c.out, text: c.text?.lines?.[0] }))

    // No transcript is queued: a re-sync that touched STT would fail/return empty.
    const ids = useTimelineStore.getState().resyncCaptions()
    expect(ids).not.toBeNull()

    const after = captionTrack().clips.map((c) => ({ start: c.start, out: c.out, text: c.text?.lines?.[0] }))
    expect(after).toEqual(before)
  })

  it('drives the Tamil (Indic) auto-caption path', async () => {
    await openNewProject({ name: 'Tamil Caption', aspect: '9:16', fps: 30, language: 'ta' })
    await autoCaption(harness, TAMIL_TRANSCRIPT)

    const clips = captionTrack().clips
    expect(clips).toHaveLength(1)
    expect(clips[0].text?.lines?.[0]).toBe('வணக்கம் உலகம்')
    expect(clips[0].text?.lang).toBe('ta')
    expect(clips[0].start).toBeCloseTo(0.0, 6)
    expect(clips[0].out).toBeCloseTo(1.1, 6)
  })

  it('aligns user-provided lyrics and preserves line breaks in lyrics-first mode', async () => {
    await openNewProject({ name: 'Lyrics First', aspect: '9:16', fps: 30, language: 'ta' })
    await lyricsFirstCaption(
      harness,
      '[lang: ta]\nவணக்கம்\nஉலகம்',
      {
        language: 'ta',
        words: [
          { text: 'வணக்கம்', start: 0.0, end: 0.5 },
          { text: 'உலகம்', start: 0.55, end: 1.1 }
        ]
      }
    )

    const clips = captionTrack().clips
    expect(clips).toHaveLength(2)
    expect(clips[0].text?.lines?.[0]).toBe('வணக்கம்')
    expect(clips[1].text?.lines?.[0]).toBe('உலகம்')

    // Line timings come from alignment while text stays exactly user-provided.
    expect(clips[0].start).toBeCloseTo(0.0, 6)
    expect(clips[0].start + clips[0].out).toBeCloseTo(0.5, 6)
    expect(clips[1].start).toBeCloseTo(0.55, 6)
    expect(clips[1].start + clips[1].out).toBeCloseTo(1.1, 6)
    expect(clips[0].caption?.words[0].text).toBe('வணக்கம்')
    expect(clips[0].caption?.words[0].confidence).toBeTypeOf('number')
  })
})

// ===========================================================================
// PHASE 5 — CAPTION STYLES (premium presets + evaluators)
// ===========================================================================
describe('Phase 5 — Caption Styles: presets, active-word highlight, evaluators', () => {
  it('applies a preset: stamps style + animation, records styleId, preserves content', async () => {
    await openNewProject({ name: 'Apply Preset', aspect: '16:9', fps: 30, language: 'en' })
    await autoCaption(harness, ENGLISH_TRANSCRIPT)

    const applied = useTimelineStore.getState().applyCaptionPreset('pop-by-word')
    expect(applied).toBe(true)
    expect(project().captions?.styleId).toBe('pop-by-word')

    const preset = getCaptionPreset('pop-by-word')
    expect(preset).toBeDefined()
    if (preset === undefined) return
    const expectedStyle = captionPresetToClipStyle(preset)

    captionTrack().clips.forEach((clip) => {
      // Style fields replaced wholesale by the preset.
      expect(clip.text?.font?.family).toBe(expectedStyle.text.font?.family)
      expect(clip.text?.fill).toEqual(expectedStyle.text.fill)
      expect(clip.animation).toEqual(expectedStyle.animation)
      // Spoken content + per-word timing preserved.
      expect(clip.caption?.words.length).toBeGreaterThan(0)
      expect(clip.text?.lines?.length).toBeGreaterThan(0)
    })
  })

  it('evaluates the active-word highlight to the right word (±1 frame crisp)', async () => {
    await openNewProject({ name: 'Highlight', aspect: '16:9', fps: 30, language: 'en' })
    await autoCaption(harness, ENGLISH_TRANSCRIPT)
    useTimelineStore.getState().applyCaptionPreset('karaoke-highlight')

    const words = captionTrack().clips[0].caption?.words ?? []
    expect(words).toHaveLength(4)

    // At each word's midpoint, that word — and only that word — is active.
    words.forEach((w, idx) => {
      const mid = (w.start + w.end) / 2
      expect(activeWordIndex(words, mid)).toBe(idx)
    })

    // Before the first word and inside a gap there is NO active word.
    expect(activeWordIndex(words, 0.1)).toBe(-1)
    expect(activeWordIndex(words, 0.98)).toBe(-1) // gap between 'Welcome' and 'to'

    // Half-open interval: active exactly at start, off one frame earlier.
    const caption = words[2] // 'Caption' [1.2, 1.7)
    expect(activeWordIndex(words, caption.start)).toBe(2)
    expect(activeWordIndex(words, caption.start - FRAME_TOLERANCE)).not.toBe(2)
  })

  it('evaluates the composed animation sample across a styled caption clip', async () => {
    await openNewProject({ name: 'Evaluate', aspect: '16:9', fps: 30, language: 'en' })
    await autoCaption(harness, ENGLISH_TRANSCRIPT)
    useTimelineStore.getState().applyCaptionPreset('pop-by-word')

    const clip = captionTrack().clips[0]
    const duration = clip.out - clip.start

    // Sample the preview/export evaluator at the five canonical progress points.
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      const t = clip.start + progress * duration
      const anim = evaluateClipAnimation({
        animation: clip.animation,
        start: clip.start,
        end: clip.out,
        t
      }).clip
      const sample = composeClipSample({
        keyframeT: t - clip.start,
        pathProgress: progress,
        animation: anim
      })
      // Production-grade bounds: finite, opacity in [0,1], positive scale.
      expect(Number.isFinite(sample.opacity)).toBe(true)
      expect(sample.opacity).toBeGreaterThanOrEqual(0)
      expect(sample.opacity).toBeLessThanOrEqual(1)
      expect(Number.isFinite(sample.scale)).toBe(true)
      expect(sample.scale).toBeGreaterThan(0)
      expect(Number.isFinite(sample.tx)).toBe(true)
      expect(Number.isFinite(sample.ty)).toBe(true)
    }
  })

  it('returns the identity sample for a plain clip with no animation', async () => {
    await openNewProject({ name: 'Identity', aspect: '16:9', fps: 30, language: 'en' })
    harness.queueMediaPick([harness.fixtures.video])
    await useTimelineStore.getState().importMedia()

    const clip = trackOfType('video').clips[0]
    const out = evaluateClipAnimation({
      animation: clip.animation,
      start: clip.start,
      end: clip.out,
      t: clip.start
    })
    expect(out.clip).toEqual(IDENTITY_SAMPLE)
  })
})

// ===========================================================================
// FULL PIPELINE — all five phases, saved, reopened, re-validated from disk.
// ===========================================================================
describe('Full pipeline — create → media → audio → captions → style → save → reopen', () => {
  it('persists the whole production project and re-validates it from disk', async () => {
    const ref = await openNewProject({ name: 'Production Flow', aspect: '9:16', fps: 30, language: 'en' })

    // 1) Upload a video.
    harness.queueMediaPick([harness.fixtures.video])
    expect(await useTimelineStore.getState().importMedia()).toEqual({ ok: true, imported: 1 })

    // 2) Add a manual text layer.
    const textId = useTimelineStore.getState().addTextClip()
    expect(textId).not.toBeNull()

    // 3) Upload audio and auto-caption it.
    const { wavRef } = await autoCaption(harness, ENGLISH_TRANSCRIPT)

    // 4) Apply a premium caption preset.
    expect(useTimelineStore.getState().applyCaptionPreset('pop-by-word')).toBe(true)

    // 5) Save the whole project to the bundle.
    await useProjectStore.getState().saveProject()
    expect(useProjectStore.getState().saveStatus).toBe('saved')

    // Close and reopen FRESH from disk — proving everything persisted.
    useProjectStore.getState().closeProject()
    expect(useProjectStore.getState().currentProject).toBeNull()
    await useProjectStore.getState().openProject(ref)
    expect(useProjectStore.getState().openStatus).toBe('ready')

    const reopened = project()

    // Video clip survived the round-trip.
    const video = reopened.tracks.find((t) => t.type === 'video')
    expect(video?.clips).toHaveLength(1)
    expect(video?.clips[0].mediaRef).toBe('media/clip.mp4')

    // Text layer survived.
    const text = reopened.tracks.find((t) => t.type === 'text' && t.id !== CAPTION_TRACK_ID)
    expect(text?.clips.length).toBeGreaterThan(0)

    // Caption track survived with the preset applied + per-word timing intact.
    const captions = reopened.tracks.find((t) => t.id === CAPTION_TRACK_ID)
    expect(captions?.clips).toHaveLength(ENGLISH_LINES.length)
    expect(reopened.captions?.styleId).toBe('pop-by-word')

    // Real artifacts on disk: copied media + the normalized WAV.
    const mediaEntries = await readdir(`${ref.path}/media`)
    expect(mediaEntries).toContain('clip.mp4')
    expect(mediaEntries).toContain('narration.wav')
    const wav = parseWav(await harness.readBundleFile(ref.path, wavRef))
    expect(wav.sampleRate).toBe(16000)
    expect(wav.channels).toBe(1)

    // Evaluate the reopened (disk-loaded) data exactly as the preview would.
    const firstCaption = captions?.clips[0]
    expect(firstCaption).toBeDefined()
    if (firstCaption?.caption === undefined) return
    expect(activeWordIndex(firstCaption.caption.words, 1.5)).toBe(2) // 'Caption'
  })
})

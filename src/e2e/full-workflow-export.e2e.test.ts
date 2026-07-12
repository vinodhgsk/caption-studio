/**
 * Full-workflow e2e test: media-1.mp4 + 1.wav + Tamil Align Lyrics → MP4 export.
 *
 * Mirrors the user workflow that triggered exit 234:
 *   1. Create project
 *   2. Import media/media-1.mp4 as the video clip
 *   3. Import media/1.wav as the audio clip (default gain=1, no fades)
 *   4. Normalize audio → 16 kHz mono WAV in cache/
 *   5. Align the full Mariamman Tamil lyrics (MARIAMMAN_LYRICS) against the transcript
 *   6. Generate caption clips
 *   7. Export → must produce a valid MP4 (FFmpeg exit 0)
 *
 * Uses the canonical MARIAMMAN_LYRICS fixture (the complete song) for both the
 * plain-mux and ASS burn-in paths.
 *
 * The export is driven through runExportJob directly (bypassing Electron IPC)
 * so this runs cleanly under vitest / Node.
 */

import { mkdir, stat } from 'node:fs/promises'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  MARIAMMAN_LYRICS,
  MARIAMMAN_TRANSCRIPT,
  createE2EHarness,
  makeWavBuffer,
  type E2EHarness
} from './harness'
import { useProjectStore } from '../renderer/store/projectStore'
import { useTimelineStore } from '../renderer/store/timelineStore'
import { runExportJob } from '../main/export/runner'
import type { ExportJob } from '../shared/export'
import type { Project } from '../shared/storage'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ffmpegBin(): string {
  return process.env.CAPTION_STUDIO_FFMPEG ?? 'ffmpeg'
}

function runFfmpeg(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegBin(), args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr?.on('data', (c: Buffer) => { stderr += c.toString() })
    proc.on('error', () => resolve({ code: -1, stderr }))
    proc.on('close', (code) => resolve({ code: code ?? -1, stderr }))
  })
}

async function detectFfmpeg(): Promise<boolean> {
  const { code } = await runFfmpeg(['-version'])
  return code === 0
}

/** Generate a decodable H.264 MP4 (black frames, no audio) via FFmpeg lavfi. */
async function generateTestVideo(outPath: string, durationSec: number): Promise<boolean> {
  const { code } = await runFfmpeg([
    '-y',
    '-f', 'lavfi', '-i', `color=black:s=320x240:r=24:d=${durationSec}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-t', String(durationSec),
    '-an',
    outPath
  ])
  return code === 0
}

/** Wait for a runExportJob to complete. Resolves with ok/error. */
function waitForExport(
  job: ExportJob,
  bundlePath: string,
  project: Project
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    runExportJob(job, bundlePath, project, (progress) => {
      if (progress.phase === 'done') resolve({ ok: true })
      else if (progress.phase === 'error') resolve({ ok: false, error: progress.error ?? progress.message })
    })
  })
}

/**
 * Full project setup: create → import video → import audio → normalize →
 * align Mariamman lyrics → generate captions → save.
 * Returns { bundlePath, exportJob } ready for runExportJob.
 */
async function buildMariammanProject(
  harness: E2EHarness,
  videoSrcPath: string,
  audioSrcPath: string,
  burnCaptions: boolean
): Promise<{ bundlePath: string; exportJob: ExportJob } | null> {
  const created = await useProjectStore.getState().createProject({
    location: 'local',
    name: 'Audio Test',
    aspect: '16:9',
    fps: 30,
    language: 'ta'
  })
  if (!created.ok) return null
  await useProjectStore.getState().openProject(created.ref)
  const bundlePath = harness.provider.resolvePath(created.ref)

  // Import video → media/media-1.mp4
  harness.queueMediaPick([videoSrcPath])
  const videoImport = await useTimelineStore.getState().importMedia()
  if (!videoImport.ok) return null

  // Import audio → media/1.wav
  harness.queueAudioPick([audioSrcPath])
  const audioImport = await useTimelineStore.getState().importAudio()
  if (!audioImport.ok || audioImport.mediaRef === null) return null

  // Normalize audio → cache/<name>.16k.mono.wav
  const normalized = await useTimelineStore.getState().normalizeAudio(audioImport.mediaRef)
  if (!normalized.ok) return null

  // Align the full Mariamman lyrics using the canonical MARIAMMAN_TRANSCRIPT
  // (three anchor words spanning a 5-second vocal range; proportional alignment
  // distributes all song lines across that span).
  harness.queueTranscript(MARIAMMAN_TRANSCRIPT)
  const aligned = await useTimelineStore.getState().alignLyrics(
    normalized.wavRef,
    MARIAMMAN_LYRICS
  )
  if (!aligned.ok) return null

  // Generate caption clips from the alignment.
  const ids = useTimelineStore.getState().generateCaptionsFromLines(
    aligned.alignment.lines.map((line) => ({
      text: line.text,
      start: line.start,
      out: line.end,
      words: line.words.map((w) => ({ text: w.text, start: w.start, end: w.end, confidence: w.confidence }))
    })),
    aligned.alignment.language
  )
  if (ids === null) return null

  await useProjectStore.getState().saveProject()
  await mkdir(join(bundlePath, 'exports'), { recursive: true })

  const exportJob: ExportJob = {
    ref: created.ref,
    format: 'mp4',
    resolution: '480p',
    fps: 30,
    burnCaptions,
    subtitles: { srt: false, vtt: false, ass: burnCaptions },
    outputLocation: 'local'
  }

  return { bundlePath, exportJob }
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

let harness: E2EHarness

beforeEach(async () => {
  harness = await createE2EHarness()
  harness.install()
})

afterEach(async () => {
  await harness.cleanup()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Full workflow: media-1.mp4 + 1.wav + Mariamman Tamil lyrics → MP4', () => {
  it('creates Tamil caption clips from the full Mariamman lyrics via Align Lyrics', async () => {
    // Caption-generation assertions run without real FFmpeg (pure store logic).
    const created = await useProjectStore.getState().createProject({
      location: 'local',
      name: 'Caption Only',
      aspect: '16:9',
      fps: 30,
      language: 'ta'
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await useProjectStore.getState().openProject(created.ref)
    const bundlePath = harness.provider.resolvePath(created.ref)

    await mkdir(join(bundlePath, 'media'), { recursive: true })
    await mkdir(join(bundlePath, 'cache'), { recursive: true })

    // Write a stub normalized WAV so alignLyrics has a wavRef to reference.
    const wavStub = join(bundlePath, 'cache', '1.16k.mono.wav')
    await writeFile(wavStub, makeWavBuffer({ sampleRate: 16000, channels: 1, durationSec: 5 }))

    harness.queueTranscript(MARIAMMAN_TRANSCRIPT)
    const aligned = await useTimelineStore.getState().alignLyrics('cache/1.16k.mono.wav', MARIAMMAN_LYRICS)
    expect(aligned.ok).toBe(true)
    if (!aligned.ok) return

    // Every lyric line should produce one AlignedLyricsLine.
    const expectedLineCount = MARIAMMAN_LYRICS
      .split('\n')
      .filter((l) => l.trim().length > 0 && !l.trim().startsWith('['))
      .length
    expect(aligned.alignment.lines.length).toBe(expectedLineCount)
    expect(aligned.alignment.language).toBe('ta')

    const ids = useTimelineStore.getState().generateCaptionsFromLines(
      aligned.alignment.lines.map((line) => ({
        text: line.text,
        start: line.start,
        out: line.end,
        words: line.words.map((w) => ({ text: w.text, start: w.start, end: w.end, confidence: w.confidence }))
      })),
      aligned.alignment.language
    )
    expect(ids).not.toBeNull()

    const project = useProjectStore.getState().currentProject!
    const textTrack = project.tracks.find((t) => t.type === 'text')
    expect(textTrack?.clips.length).toBe(expectedLineCount)

    // Every caption clip must have Tamil text, a start ≥ 0, and positive duration.
    textTrack!.clips.forEach((clip) => {
      const text = clip.text?.lines?.[0] ?? ''
      expect(text.length).toBeGreaterThan(0)
      expect(clip.start).toBeGreaterThanOrEqual(0)
      expect(clip.out - clip.in).toBeGreaterThan(0)
    })

    // Lines must be strictly monotonic (later lines start ≥ earlier lines).
    const starts = textTrack!.clips.map((c) => c.start)
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]).toBeGreaterThanOrEqual(starts[i - 1] - 1e-9)
    }
  })

  it('exports media-1.mp4 + 1.wav + Mariamman captions to MP4 (exit 0)', async () => {
    const ffmpegAvailable = await detectFfmpeg()
    if (!ffmpegAvailable) {
      console.log('[full-workflow] FFmpeg not found — skipping export test')
      return
    }

    const sourceDir = join(harness.projectsRoot, '..', 'sources')
    await mkdir(sourceDir, { recursive: true })

    const videoSrcPath = join(sourceDir, 'media-1.mp4')
    const ok = await generateTestVideo(videoSrcPath, 5)
    if (!ok) { console.log('[full-workflow] Could not generate test video'); return }

    const audioSrcPath = join(sourceDir, '1.wav')
    // 48 kHz stereo PCM — matches the suno WAV format that triggered exit 234.
    await writeFile(audioSrcPath, makeWavBuffer({ sampleRate: 48000, channels: 2, durationSec: 5 }))

    const setup = await buildMariammanProject(harness, videoSrcPath, audioSrcPath, false)
    if (setup === null) { throw new Error('project setup failed') }

    // Validate the imported media refs.
    const project = useProjectStore.getState().currentProject!
    expect(project.tracks.find((t) => t.type === 'video')?.clips[0].mediaRef).toBe('media/media-1.mp4')
    expect(project.tracks.find((t) => t.type === 'audio')?.clips[0].mediaRef).toBe('media/1.wav')
    const textTrack = project.tracks.find((t) => t.type === 'text')
    expect(textTrack?.clips.length).toBeGreaterThan(0)

    const result = await waitForExport(setup.exportJob, setup.bundlePath, project)
    if (!result.ok) console.error('[full-workflow] Export failed:', result.error)
    expect(result.ok).toBe(true)

    // Confirm a non-empty .mp4 was written to exports/.
    const files = readdirSync(join(setup.bundlePath, 'exports')).filter((f) => f.endsWith('.mp4'))
    expect(files.length).toBeGreaterThan(0)
    const info = await stat(join(setup.bundlePath, 'exports', files[0]))
    expect(info.size).toBeGreaterThan(0)
  }, 60_000)

  it('exports with ASS burn-in captions (burnCaptions:true), exit 0', async () => {
    const ffmpegAvailable = await detectFfmpeg()
    if (!ffmpegAvailable) {
      console.log('[full-workflow-burn] FFmpeg not found — skipping')
      return
    }

    const sourceDir = join(harness.projectsRoot, '..', 'sources')
    await mkdir(sourceDir, { recursive: true })

    const videoSrcPath = join(sourceDir, 'media-1.mp4')
    const ok = await generateTestVideo(videoSrcPath, 5)
    if (!ok) return

    const audioSrcPath = join(sourceDir, '1.wav')
    await writeFile(audioSrcPath, makeWavBuffer({ sampleRate: 48000, channels: 2, durationSec: 5 }))

    const setup = await buildMariammanProject(harness, videoSrcPath, audioSrcPath, true)
    if (setup === null) { throw new Error('project setup failed') }

    const project = useProjectStore.getState().currentProject!
    const result = await waitForExport(setup.exportJob, setup.bundlePath, project)
    if (!result.ok) console.error('[full-workflow-burn] Export failed:', result.error)
    expect(result.ok).toBe(true)

    const files = readdirSync(join(setup.bundlePath, 'exports')).filter((f) => f.endsWith('.mp4'))
    expect(files.length).toBeGreaterThan(0)
    const info = await stat(join(setup.bundlePath, 'exports', files[0]))
    expect(info.size).toBeGreaterThan(0)
  }, 60_000)
})

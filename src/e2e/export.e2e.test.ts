/**
 * END-TO-END export tests — exercises the full FFmpeg export pipeline for the
 * video + audio case that caused exit code 234 when audio had default gain.
 *
 * Two tiers:
 *   1. Arg-level (always runs): buildFfmpegArgs must not emit a bracketed stream
 *      ref like `[1:a]` as a -map argument — that is the precise bug that caused
 *      "Output with label '1:a' does not exist in any defined filter graph".
 *   2. Spawn-level (requires FFmpeg on PATH): actually runs FFmpeg with the
 *      generated args against synthetic A/V inputs and asserts exit 0.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildFfmpegArgs } from '../main/export/ffmpegBuilder'
import type { FfmpegBuilderOpts } from '../main/export/ffmpegBuilder'
import { makeWavBuffer } from './harness'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ffmpegBin(): string {
  return process.env.CAPTION_STUDIO_FFMPEG ?? 'ffmpeg'
}

/** Spawn FFmpeg and resolve when it exits. Returns { code, stderr }. */
function runFfmpeg(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegBin(), args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    proc.on('error', () => resolve({ code: -1, stderr }))
    proc.on('close', (code) => resolve({ code: code ?? -1, stderr }))
  })
}

/** Check if the FFmpeg binary is available (≥ 1 s timeout). */
async function detectFfmpeg(): Promise<boolean> {
  const { code } = await runFfmpeg(['-version'])
  return code === 0
}

/**
 * Generate a minimal 1-second black video MP4 via FFmpeg lavfi so we have a
 * genuinely decodable video input for the export pipeline test.
 * Returns the output path, or null if FFmpeg is unavailable.
 */
async function generateBlackVideo(dir: string): Promise<string | null> {
  const out = join(dir, 'black.mp4')
  const { code } = await runFfmpeg([
    '-y',
    '-f', 'lavfi', '-i', 'color=black:s=320x240:r=24:d=1',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-t', '1',
    '-an',
    out
  ])
  return code === 0 ? out : null
}

// ---------------------------------------------------------------------------
// Minimal project fixture builder
// ---------------------------------------------------------------------------

function makeProject(opts: {
  bundlePath: string
  videoMediaRef: string
  audioMediaRef: string
}) {
  return {
    version: 1,
    id: 'export-e2e-001',
    name: 'Export E2E Test',
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:00.000Z',
    settings: {
      fps: 24,
      resolution: [640, 480] as [number, number],
      aspect: '16:9' as const,
      background: '#000000',
      language: 'en',
      languages: ['en']
    },
    storage: { location: 'local' as const, root: opts.bundlePath },
    tracks: [
      {
        id: 'track-video',
        type: 'video' as const,
        clips: [
          {
            id: 'clip-v1',
            mediaRef: opts.videoMediaRef,
            in: 0,
            out: 1,
            start: 0,
            transform: {
              x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false, opacity: 1, z: 0
            }
          }
        ]
      },
      {
        id: 'track-audio',
        type: 'audio' as const,
        clips: [
          {
            id: 'clip-a1',
            mediaRef: opts.audioMediaRef,
            in: 0,
            out: 1,
            start: 0,
            transform: {
              x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false, opacity: 1, z: 0
            },
            // Default gain=1, no fades — this is the exact scenario that caused exit 234.
            audio: { gain: 1, fadeInSec: 0, fadeOutSec: 0, muted: false }
          }
        ]
      }
    ]
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const EXPORT_OPTS: FfmpegBuilderOpts = {
  resolution: '480p',
  fps: 24,
  format: 'mp4',
  burnCaptions: false
}

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'capstudio-export-e2e-'))
  await mkdir(join(tmpDir, 'media'), { recursive: true })
  await mkdir(join(tmpDir, 'exports'), { recursive: true })
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

// ===========================================================================
// Tier 1 — arg-level (always runs, no real FFmpeg spawn)
// ===========================================================================

describe('Export arg-level — video + audio with default gain', () => {
  it('does not put a bracketed stream ref [1:a] as a -map value', () => {
    const project = makeProject({
      bundlePath: tmpDir,
      videoMediaRef: 'media/black.mp4',
      audioMediaRef: 'media/audio.wav'
    })
    const args = buildFfmpegArgs(project, tmpDir, join(tmpDir, 'exports', 'out.mp4'), EXPORT_OPTS)
    // The bug emitted `-map [1:a]` — FFmpeg treated it as a filtergraph label lookup
    // (not a stream specifier) and exited 234 with "Output with label '1:a' does not exist".
    expect(args).not.toContain('[1:a]')
  })

  it('maps the audio stream as a bare specifier `1:a` (no brackets)', () => {
    const project = makeProject({
      bundlePath: tmpDir,
      videoMediaRef: 'media/black.mp4',
      audioMediaRef: 'media/audio.wav'
    })
    const args = buildFfmpegArgs(project, tmpDir, join(tmpDir, 'exports', 'out.mp4'), EXPORT_OPTS)
    // Find all -map values (each arg immediately following -map).
    const mapValues: string[] = []
    for (let i = 0; i < args.length - 1; i++) {
      if (args[i] === '-map') mapValues.push(args[i + 1])
    }
    expect(mapValues).toContain('1:a')
  })

  it('maps the video stream as a filtergraph label [vout0] (from scale filter)', () => {
    const project = makeProject({
      bundlePath: tmpDir,
      videoMediaRef: 'media/black.mp4',
      audioMediaRef: 'media/audio.wav'
    })
    const args = buildFfmpegArgs(project, tmpDir, join(tmpDir, 'exports', 'out.mp4'), EXPORT_OPTS)
    const mapValues: string[] = []
    for (let i = 0; i < args.length - 1; i++) {
      if (args[i] === '-map') mapValues.push(args[i + 1])
    }
    expect(mapValues).toContain('[vout0]')
  })
})

describe('Export arg-level — caption overlay (preview-faithful burn-in)', () => {
  const OVERLAY_OPTS: FfmpegBuilderOpts = {
    resolution: '480p',
    fps: 24,
    format: 'mp4',
    burnCaptions: true,
    assSubtitlePath: '/tmp/captions.ass',
    captionOverlay: {
      framesPattern: '/tmp/cap/frame_%06d.png',
      fps: 24,
      startSec: 1.5
    }
  }

  it('adds the PNG-sequence input with -framerate + -itsoffset and overlays it', () => {
    const project = makeProject({
      bundlePath: tmpDir,
      videoMediaRef: 'media/black.mp4',
      audioMediaRef: 'media/audio.wav'
    })
    const args = buildFfmpegArgs(project, tmpDir, join(tmpDir, 'exports', 'out.mp4'), OVERLAY_OPTS)
    const joined = args.join(' ')
    // The overlay input is declared with the image2 framerate + timeline offset.
    expect(args).toContain('-framerate')
    expect(args).toContain('-itsoffset')
    expect(args).toContain('1.500000')
    expect(args).toContain('/tmp/cap/frame_%06d.png')
    // The overlay is scaled+padded (transparent) into the output frame like the
    // video is fit, then composited over it → [vfinal], which is mapped.
    expect(joined).toContain('force_original_aspect_ratio=decrease')
    expect(joined).toContain('color=black@0[capov]')
    expect(joined).toContain('[capov]overlay=0:0:eof_action=pass:format=auto[vfinal]')
    const mapValues: string[] = []
    for (let i = 0; i < args.length - 1; i++) {
      if (args[i] === '-map') mapValues.push(args[i + 1])
    }
    expect(mapValues).toContain('[vfinal]')
  })

  it('SKIPS the flat libass subtitles burn-in when an overlay is present', () => {
    const project = makeProject({
      bundlePath: tmpDir,
      videoMediaRef: 'media/black.mp4',
      audioMediaRef: 'media/audio.wav'
    })
    const args = buildFfmpegArgs(project, tmpDir, join(tmpDir, 'exports', 'out.mp4'), OVERLAY_OPTS)
    // The overlay replaces the ASS burn-in — no `subtitles=` filter in the graph.
    expect(args.join(' ')).not.toContain('subtitles=')
  })

  it('overlay input index sits after video + audio inputs', () => {
    const project = makeProject({
      bundlePath: tmpDir,
      videoMediaRef: 'media/black.mp4',
      audioMediaRef: 'media/audio.wav'
    })
    const args = buildFfmpegArgs(project, tmpDir, join(tmpDir, 'exports', 'out.mp4'), OVERLAY_OPTS)
    // 1 video + 1 audio → overlay is input index 2, referenced as [2:v] in the graph.
    expect(args.join(' ')).toContain('[2:v]format=rgba')
  })
})

// ===========================================================================
// Tier 2 — spawn-level (requires real FFmpeg; skipped when absent)
// ===========================================================================

describe('Export spawn-level — real FFmpeg run', () => {
  it('exits 0 (not 234) for a project with video + audio at default gain', async () => {
    const ffmpegAvailable = await detectFfmpeg()
    if (!ffmpegAvailable) {
      console.log('[export.e2e] FFmpeg not found — skipping spawn-level test')
      return
    }

    // Generate a real 1-second black MP4 (lavfi source — no codec/container tricks).
    const videoPath = await generateBlackVideo(join(tmpDir, 'media'))
    if (videoPath === null) {
      console.log('[export.e2e] Could not generate test video — skipping')
      return
    }

    // Write a valid PCM16 WAV (1s, 44.1 kHz stereo).
    const wavPath = join(tmpDir, 'media', 'audio.wav')
    await writeFile(wavPath, makeWavBuffer({ sampleRate: 44100, channels: 2, durationSec: 1 }))

    const outputPath = join(tmpDir, 'exports', 'result.mp4')

    const project = makeProject({
      bundlePath: tmpDir,
      videoMediaRef: 'media/black.mp4',
      audioMediaRef: 'media/audio.wav'
    })

    const args = buildFfmpegArgs(project, tmpDir, outputPath, EXPORT_OPTS)
    const { code, stderr } = await runFfmpeg(args)

    if (code !== 0) {
      // Surface the full stderr to make debugging easy.
      console.error('[export.e2e] FFmpeg failed:\n', stderr)
    }
    expect(code).toBe(0)
  }, 30_000) // allow up to 30s for encoding

  it('exits 0 when compositing a transparent caption PNG-sequence overlay', async () => {
    const ffmpegAvailable = await detectFfmpeg()
    if (!ffmpegAvailable) {
      console.log('[export.e2e] FFmpeg not found — skipping overlay spawn-level test')
      return
    }

    const videoPath = await generateBlackVideo(join(tmpDir, 'media'))
    if (videoPath === null) {
      console.log('[export.e2e] Could not generate test video — skipping')
      return
    }
    const wavPath = join(tmpDir, 'media', 'audio.wav')
    await writeFile(wavPath, makeWavBuffer({ sampleRate: 44100, channels: 2, durationSec: 1 }))

    // Generate a small transparent RGBA PNG sequence to stand in for the caption
    // frames the renderer would produce (rgba source → real alpha channel). Use a
    // PORTRAIT size (270×480) ≠ the 854×480 output so the builder's scale+pad path
    // (transparent pad) is exercised end-to-end, not just the identity case.
    const capDir = join(tmpDir, 'cache', 'cap')
    await mkdir(capDir, { recursive: true })
    const genPng = await runFfmpeg([
      '-y',
      '-f', 'lavfi', '-i', 'color=c=red@0.5:s=270x480:r=24:d=0.5',
      '-frames:v', '12',
      join(capDir, 'frame_%06d.png')
    ])
    if (genPng.code !== 0) {
      console.log('[export.e2e] Could not generate overlay PNGs — skipping')
      return
    }

    const outputPath = join(tmpDir, 'exports', 'result-overlay.mp4')
    const project = makeProject({
      bundlePath: tmpDir,
      videoMediaRef: 'media/black.mp4',
      audioMediaRef: 'media/audio.wav'
    })
    const args = buildFfmpegArgs(project, tmpDir, outputPath, {
      ...EXPORT_OPTS,
      burnCaptions: true,
      captionOverlay: {
        framesPattern: join(capDir, 'frame_%06d.png'),
        fps: 24,
        startSec: 0
      }
    })
    const { code, stderr } = await runFfmpeg(args)
    if (code !== 0) {
      console.error('[export.e2e] FFmpeg overlay export failed:\n', stderr)
    }
    expect(code).toBe(0)
  }, 30_000)
})

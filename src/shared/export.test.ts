/**
 * Phase 12 Export & Output — comprehensive test suite (P12.1, P12.3, Doc 13).
 *
 * Covers:
 *   - subtitleExport: SRT generation (captionsToSrt)
 *   - subtitleExport: VTT generation (captionsToVtt)
 *   - subtitleExport: ASS generation (captionsToAss)
 *   - ffmpegBuilder: buildFfmpegArgs (pure function — no exec, no file I/O)
 *   - ExportJob / ExportProgress / ExportResult type constructability
 *
 * All tests are deterministic, pure, and headless.
 * No file I/O, no process spawning, no Electron, no DOM.
 */

import { describe, expect, it } from 'vitest'

// ── Subtitle export ──────────────────────────────────────────────────────────
import {
  captionsToAss,
  captionsToSrt,
  captionsToVtt
} from './subtitleExport'
import type { CaptionClipLike } from './subtitleExport'

// ── FFmpeg builder ───────────────────────────────────────────────────────────
import { buildFfmpegArgs } from '../main/export/ffmpegBuilder'
import type { FfmpegBuilderOpts } from '../main/export/ffmpegBuilder'

// ── Export types ─────────────────────────────────────────────────────────────
import type { ExportJob, ExportProgress, ExportResult } from './export'
import type { ProjectRef } from './storage'

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** Minimal Project fixture with no tracks — satisfies the Project shape. */
const EMPTY_PROJECT = {
  version: 1,
  id: 'test-project-001',
  name: 'Test Project',
  createdAt: '2026-07-04T00:00:00.000Z',
  updatedAt: '2026-07-04T00:00:00.000Z',
  settings: {
    fps: 30,
    resolution: [1920, 1080] as [number, number],
    aspect: '16:9' as const,
    background: '#000000',
    language: 'ta',
    languages: ['ta', 'en']
  },
  storage: { location: 'local' as const, root: '/tmp/test' },
  tracks: []
}

/**
 * Minimal video clip satisfying the Clip shape.
 * mediaRef uses a .mp4 extension so the builder treats it as a video (not image).
 */
const MINIMAL_VIDEO_CLIP = {
  id: 'clip-001',
  mediaRef: 'media/clip1.mp4',
  in: 0,
  out: 5,
  start: 0,
  transform: {
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    flipH: false,
    flipV: false,
    opacity: 1,
    z: 0
  }
}

/** A minimal Project fixture with one video track containing one clip. */
const PROJECT_WITH_VIDEO = {
  ...EMPTY_PROJECT,
  id: 'test-project-002',
  tracks: [
    {
      id: 'track-001',
      type: 'video' as const,
      clips: [MINIMAL_VIDEO_CLIP]
    }
  ]
}

const BUNDLE_PATH = '/tmp/test-bundle'
const OUTPUT_PATH = '/tmp/output.mp4'

/** A minimal clip spanning 1s–4s. */
const CLIP_A: CaptionClipLike = {
  startSec: 1,
  endSec: 4,
  text: 'Hello world'
}

/** A minimal clip spanning 5s–8.5s. */
const CLIP_B: CaptionClipLike = {
  startSec: 5,
  endSec: 8.5,
  text: 'Second caption'
}

// ---------------------------------------------------------------------------
// SRT generation — captionsToSrt()
// ---------------------------------------------------------------------------

describe('captionsToSrt() — empty input', () => {
  it('returns empty string for an empty clips array', () => {
    expect(captionsToSrt([])).toBe('')
  })
})

describe('captionsToSrt() — single clip', () => {
  const srt = captionsToSrt([CLIP_A])

  it('contains exactly one entry index "1"', () => {
    expect(srt).toContain('1\n')
  })

  it('entry index starts at 1 (not 0)', () => {
    expect(srt.startsWith('1\n')).toBe(true)
  })

  it('contains the --> separator for the time range', () => {
    expect(srt).toContain(' --> ')
  })

  it('contains the clip text verbatim', () => {
    expect(srt).toContain('Hello world')
  })

  it('timecode uses comma as the millisecond separator (SRT spec)', () => {
    // SRT uses HH:MM:SS,mmm — comma, not dot
    expect(srt).toMatch(/\d{2}:\d{2}:\d{2},\d{3}/)
  })

  it('start timecode for 1.0s is 00:00:01,000', () => {
    expect(srt).toContain('00:00:01,000')
  })

  it('end timecode for 4.0s is 00:00:04,000', () => {
    expect(srt).toContain('00:00:04,000')
  })
})

describe('captionsToSrt() — two clips', () => {
  const srt = captionsToSrt([CLIP_A, CLIP_B])

  it('contains index 1', () => {
    expect(srt).toContain('1\n')
  })

  it('contains index 2', () => {
    expect(srt).toContain('2\n')
  })

  it('both clip texts appear in order', () => {
    const idx1 = srt.indexOf('Hello world')
    const idx2 = srt.indexOf('Second caption')
    expect(idx1).toBeGreaterThanOrEqual(0)
    expect(idx2).toBeGreaterThan(idx1)
  })

  it('contains two --> separators', () => {
    const matches = srt.match(/ --> /g)
    expect(matches).toHaveLength(2)
  })
})

describe('captionsToSrt() — timecode boundary cases', () => {
  it('0.0s → 00:00:00,000', () => {
    const srt = captionsToSrt([{ startSec: 0, endSec: 1, text: 'x' }])
    expect(srt).toContain('00:00:00,000')
  })

  it('61.5s → 00:01:01,500', () => {
    const srt = captionsToSrt([{ startSec: 61.5, endSec: 62, text: 'y' }])
    expect(srt).toContain('00:01:01,500')
  })

  it('3661.123s → 01:01:01,123', () => {
    const srt = captionsToSrt([{ startSec: 3661.123, endSec: 3662, text: 'z' }])
    expect(srt).toContain('01:01:01,123')
  })

  it('text is preserved exactly (no trimming)', () => {
    const text = '  leading and trailing  '
    const srt = captionsToSrt([{ startSec: 0, endSec: 1, text }])
    expect(srt).toContain(text)
  })
})

// ---------------------------------------------------------------------------
// VTT generation — captionsToVtt()
// ---------------------------------------------------------------------------

describe('captionsToVtt() — empty input', () => {
  it('starts with WEBVTT header even for empty array', () => {
    const vtt = captionsToVtt([])
    expect(vtt.startsWith('WEBVTT\n')).toBe(true)
  })

  it('contains only the header (no cues) for empty array', () => {
    const vtt = captionsToVtt([])
    expect(vtt).not.toContain(' --> ')
  })
})

describe('captionsToVtt() — single clip', () => {
  const vtt = captionsToVtt([CLIP_A])

  it('starts with WEBVTT header', () => {
    expect(vtt.startsWith('WEBVTT\n')).toBe(true)
  })

  it('contains exactly one --> separator', () => {
    const matches = vtt.match(/ --> /g)
    expect(matches).toHaveLength(1)
  })

  it('timecode uses dot as the millisecond separator (VTT spec)', () => {
    expect(vtt).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/)
  })

  it('VTT timecode does NOT use comma (SRT separator must not appear)', () => {
    expect(vtt).not.toMatch(/\d{2}:\d{2}:\d{2},\d{3}/)
  })

  it('start timecode for 1.5s is 00:00:01.500', () => {
    const vtt = captionsToVtt([{ startSec: 1.5, endSec: 3, text: 'x' }])
    expect(vtt).toContain('00:00:01.500')
  })

  it('contains the clip text', () => {
    expect(vtt).toContain('Hello world')
  })
})

describe('captionsToVtt() — two clips', () => {
  const vtt = captionsToVtt([CLIP_A, CLIP_B])

  it('contains two --> separators', () => {
    const matches = vtt.match(/ --> /g)
    expect(matches).toHaveLength(2)
  })

  it('both clip texts appear', () => {
    expect(vtt).toContain('Hello world')
    expect(vtt).toContain('Second caption')
  })

  it('index 1 appears before index 2', () => {
    const idx1 = vtt.indexOf('\n1\n')
    const idx2 = vtt.indexOf('\n2\n')
    expect(idx1).toBeGreaterThanOrEqual(0)
    expect(idx2).toBeGreaterThan(idx1)
  })
})

// ---------------------------------------------------------------------------
// ASS generation — captionsToAss()
// ---------------------------------------------------------------------------

describe('captionsToAss() — section headers', () => {
  const ass = captionsToAss([])

  it('contains [Script Info] section', () => {
    expect(ass).toContain('[Script Info]')
  })

  it('contains [V4+ Styles] section', () => {
    expect(ass).toContain('[V4+ Styles]')
  })

  it('contains [Events] section', () => {
    expect(ass).toContain('[Events]')
  })

  it('contains ScriptType: v4.00+', () => {
    expect(ass).toContain('ScriptType: v4.00+')
  })

  it('contains PlayResX: 1920', () => {
    expect(ass).toContain('PlayResX: 1920')
  })

  it('contains PlayResY: 1080', () => {
    expect(ass).toContain('PlayResY: 1080')
  })
})

describe('captionsToAss() — default font fallback', () => {
  it('uses "Noto Sans Tamil" as the default font when no fontName is given', () => {
    const ass = captionsToAss([])
    expect(ass).toContain('Noto Sans Tamil')
  })

  it('fontName parameter overrides the default font in the Style line', () => {
    const ass = captionsToAss([], 'Arial')
    // The Style row should reference Arial
    expect(ass).toContain('Arial')
    // The default "Noto Sans Tamil" should NOT appear when overridden
    expect(ass).not.toContain('Noto Sans Tamil')
  })

  it('fontName overrides also appear in Style: row (not just Script Info)', () => {
    const ass = captionsToAss([], 'Roboto')
    // Style: row format: Style: <Name>,<Fontname>,...
    expect(ass).toMatch(/Style: Default,Roboto,/)
  })
})

describe('captionsToAss() — single clip produces Dialogue line', () => {
  const ass = captionsToAss([CLIP_A])

  it('contains a Dialogue: line', () => {
    expect(ass).toContain('Dialogue:')
  })

  it('Dialogue line is in [Events] section (after [Events] header)', () => {
    const eventsIdx = ass.indexOf('[Events]')
    const dialogueIdx = ass.indexOf('Dialogue:')
    expect(eventsIdx).toBeGreaterThanOrEqual(0)
    expect(dialogueIdx).toBeGreaterThan(eventsIdx)
  })

  it('Dialogue line contains the clip text', () => {
    expect(ass).toContain('Hello world')
  })
})

describe('captionsToAss() — ASS timecode format', () => {
  it('ASS timecodes use H:MM:SS.cc format (single-digit hour, centiseconds)', () => {
    // 1.0s → 0:00:01.00
    const ass = captionsToAss([{ startSec: 1.0, endSec: 2.0, text: 'x' }])
    expect(ass).toContain('0:00:01.00')
  })

  it('61.5s → 0:01:01.50 in ASS timecode (centiseconds)', () => {
    const ass = captionsToAss([{ startSec: 61.5, endSec: 62, text: 'x' }])
    expect(ass).toContain('0:01:01.50')
  })

  it('0.0s → 0:00:00.00 in ASS timecode', () => {
    const ass = captionsToAss([{ startSec: 0, endSec: 1, text: 'x' }])
    expect(ass).toContain('0:00:00.00')
  })

  it('3661.5s → 1:01:01.50 in ASS timecode (multi-digit hour works)', () => {
    const ass = captionsToAss([{ startSec: 3661.5, endSec: 3662, text: 'x' }])
    expect(ass).toContain('1:01:01.50')
  })
})

describe('captionsToAss() — two clips produce two Dialogue lines', () => {
  const ass = captionsToAss([CLIP_A, CLIP_B])

  it('contains two Dialogue: lines', () => {
    const matches = ass.match(/^Dialogue:/gm)
    expect(matches).toHaveLength(2)
  })

  it('both texts appear in the Events section', () => {
    expect(ass).toContain('Hello world')
    expect(ass).toContain('Second caption')
  })
})

describe('captionsToAss() — clip fontFamily overrides style font', () => {
  it('clip-level fontFamily appears in the Style row when it is the first clip', () => {
    const clip: CaptionClipLike = {
      startSec: 0,
      endSec: 1,
      text: 'Tamil text',
      fontFamily: 'Noto Sans Tamil'
    }
    const ass = captionsToAss([clip])
    // The style should use the clip's fontFamily for the first clip
    expect(ass).toContain('Noto Sans Tamil')
  })

  it('fontName parameter takes priority over clip fontFamily', () => {
    const clip: CaptionClipLike = {
      startSec: 0,
      endSec: 1,
      text: 'text',
      fontFamily: 'SomeOtherFont'
    }
    const ass = captionsToAss([clip], 'OverrideFont')
    // OverrideFont should appear in the Style row
    expect(ass).toContain('OverrideFont')
    // SomeOtherFont should NOT appear (fontName wins at style level)
    expect(ass).not.toContain('SomeOtherFont')
  })
})

// ---------------------------------------------------------------------------
// ffmpegBuilder — buildFfmpegArgs() (pure function, no exec)
// ---------------------------------------------------------------------------

describe('buildFfmpegArgs() — return type and structure', () => {
  const defaultOpts: FfmpegBuilderOpts = {
    resolution: '1080p',
    fps: 30,
    format: 'mp4',
    burnCaptions: false
  }

  it('returns an array', () => {
    const args = buildFfmpegArgs(EMPTY_PROJECT, BUNDLE_PATH, OUTPUT_PATH, defaultOpts)
    expect(Array.isArray(args)).toBe(true)
  })

  it('every element of the returned array is a string', () => {
    const args = buildFfmpegArgs(EMPTY_PROJECT, BUNDLE_PATH, OUTPUT_PATH, defaultOpts)
    for (const arg of args) {
      expect(typeof arg).toBe('string')
    }
  })

  it('output path appears as the last argument', () => {
    const args = buildFfmpegArgs(EMPTY_PROJECT, BUNDLE_PATH, OUTPUT_PATH, defaultOpts)
    expect(args[args.length - 1]).toBe(OUTPUT_PATH)
  })

  it('does not throw on a project with no tracks (empty project)', () => {
    expect(() =>
      buildFfmpegArgs(EMPTY_PROJECT, BUNDLE_PATH, OUTPUT_PATH, defaultOpts)
    ).not.toThrow()
  })
})

describe('buildFfmpegArgs() — fps flag (non-empty project)', () => {
  // The empty-project early-return path embeds r= inside a lavfi color filter string.
  // The full encoding path (project with video tracks) emits -r as a discrete flag.

  it('contains -r flag when project has video tracks', () => {
    const args = buildFfmpegArgs(PROJECT_WITH_VIDEO, BUNDLE_PATH, OUTPUT_PATH, {
      resolution: '1080p',
      fps: 25,
      format: 'mp4',
      burnCaptions: false
    })
    expect(args).toContain('-r')
  })

  it('-r is followed by the fps value as a string', () => {
    const args = buildFfmpegArgs(PROJECT_WITH_VIDEO, BUNDLE_PATH, OUTPUT_PATH, {
      resolution: '1080p',
      fps: 25,
      format: 'mp4',
      burnCaptions: false
    })
    const rIdx = args.indexOf('-r')
    expect(rIdx).toBeGreaterThanOrEqual(0)
    expect(args[rIdx + 1]).toBe('25')
  })

  it('fps=60 appears as "60" after -r', () => {
    const args = buildFfmpegArgs(PROJECT_WITH_VIDEO, BUNDLE_PATH, OUTPUT_PATH, {
      resolution: '1080p',
      fps: 60,
      format: 'mp4',
      burnCaptions: false
    })
    const rIdx = args.indexOf('-r')
    expect(args[rIdx + 1]).toBe('60')
  })

  it('empty project: fps value appears somewhere in the args (embedded in lavfi color filter)', () => {
    // For empty projects the builder takes an early-return path that embeds
    // the fps inside the lavfi color input string (r=<fps>) rather than a
    // discrete -r flag — verify the value is still present.
    const args = buildFfmpegArgs(EMPTY_PROJECT, BUNDLE_PATH, OUTPUT_PATH, {
      resolution: '1080p',
      fps: 24,
      format: 'mp4',
      burnCaptions: false
    })
    const joined = args.join(' ')
    expect(joined).toContain('24')
  })
})

describe('buildFfmpegArgs() — codec selection by format', () => {
  it('mp4 format uses libx264 video codec', () => {
    const args = buildFfmpegArgs(EMPTY_PROJECT, BUNDLE_PATH, OUTPUT_PATH, {
      resolution: '1080p',
      fps: 30,
      format: 'mp4',
      burnCaptions: false
    })
    expect(args).toContain('libx264')
  })

  it('webm format uses libvpx-vp9 video codec', () => {
    const args = buildFfmpegArgs(EMPTY_PROJECT, BUNDLE_PATH, '/tmp/output.webm', {
      resolution: '1080p',
      fps: 30,
      format: 'webm',
      burnCaptions: false
    })
    expect(args).toContain('libvpx-vp9')
  })

  it('mov format uses libx264 video codec', () => {
    const args = buildFfmpegArgs(EMPTY_PROJECT, BUNDLE_PATH, '/tmp/output.mov', {
      resolution: '1080p',
      fps: 30,
      format: 'mov',
      burnCaptions: false
    })
    expect(args).toContain('libx264')
  })

  it('webm format does NOT contain libx264', () => {
    const args = buildFfmpegArgs(EMPTY_PROJECT, BUNDLE_PATH, '/tmp/output.webm', {
      resolution: '1080p',
      fps: 30,
      format: 'webm',
      burnCaptions: false
    })
    expect(args).not.toContain('libx264')
  })
})

describe('buildFfmpegArgs() — resolution output size', () => {
  it('1080p: args joined as string contains 1920', () => {
    const args = buildFfmpegArgs(EMPTY_PROJECT, BUNDLE_PATH, OUTPUT_PATH, {
      resolution: '1080p',
      fps: 30,
      format: 'mp4',
      burnCaptions: false
    })
    const joined = args.join(' ')
    expect(joined).toContain('1920')
  })

  it('1080p: args joined as string contains 1080', () => {
    const args = buildFfmpegArgs(EMPTY_PROJECT, BUNDLE_PATH, OUTPUT_PATH, {
      resolution: '1080p',
      fps: 30,
      format: 'mp4',
      burnCaptions: false
    })
    const joined = args.join(' ')
    expect(joined).toContain('1080')
  })

  it('720p: args joined as string contains 1280', () => {
    const args = buildFfmpegArgs(EMPTY_PROJECT, BUNDLE_PATH, OUTPUT_PATH, {
      resolution: '720p',
      fps: 30,
      format: 'mp4',
      burnCaptions: false
    })
    const joined = args.join(' ')
    expect(joined).toContain('1280')
  })

  it('720p: args joined as string contains 720', () => {
    const args = buildFfmpegArgs(EMPTY_PROJECT, BUNDLE_PATH, OUTPUT_PATH, {
      resolution: '720p',
      fps: 30,
      format: 'mp4',
      burnCaptions: false
    })
    const joined = args.join(' ')
    expect(joined).toContain('720')
  })

  it('4k: args joined as string contains 3840', () => {
    const args = buildFfmpegArgs(EMPTY_PROJECT, BUNDLE_PATH, OUTPUT_PATH, {
      resolution: '4k',
      fps: 30,
      format: 'mp4',
      burnCaptions: false
    })
    const joined = args.join(' ')
    expect(joined).toContain('3840')
  })

  it('480p: args joined as string contains 854', () => {
    const args = buildFfmpegArgs(EMPTY_PROJECT, BUNDLE_PATH, OUTPUT_PATH, {
      resolution: '480p',
      fps: 30,
      format: 'mp4',
      burnCaptions: false
    })
    const joined = args.join(' ')
    expect(joined).toContain('854')
  })
})

describe('buildFfmpegArgs() — burnCaptions subtitle overlay', () => {
  const ASS_PATH = '/tmp/captions.ass'

  // The subtitle overlay filter only fires for projects that have video tracks
  // (the empty-project early-return path bypasses the filter_complex graph).

  it('burnCaptions:true with assSubtitlePath → args contain "subtitles=" (video project)', () => {
    const args = buildFfmpegArgs(PROJECT_WITH_VIDEO, BUNDLE_PATH, OUTPUT_PATH, {
      resolution: '1080p',
      fps: 30,
      format: 'mp4',
      burnCaptions: true,
      assSubtitlePath: ASS_PATH
    })
    const joined = args.join(' ')
    expect(joined).toContain('subtitles=')
  })

  it('burnCaptions:false → args do NOT contain "subtitles="', () => {
    const args = buildFfmpegArgs(PROJECT_WITH_VIDEO, BUNDLE_PATH, OUTPUT_PATH, {
      resolution: '1080p',
      fps: 30,
      format: 'mp4',
      burnCaptions: false,
      assSubtitlePath: ASS_PATH
    })
    const joined = args.join(' ')
    expect(joined).not.toContain('subtitles=')
  })

  it('burnCaptions:true but no assSubtitlePath → args do NOT contain "subtitles="', () => {
    const args = buildFfmpegArgs(PROJECT_WITH_VIDEO, BUNDLE_PATH, OUTPUT_PATH, {
      resolution: '1080p',
      fps: 30,
      format: 'mp4',
      burnCaptions: true
      // assSubtitlePath omitted
    })
    const joined = args.join(' ')
    expect(joined).not.toContain('subtitles=')
  })

  it('empty project burnCaptions:false → args do NOT contain "subtitles="', () => {
    const args = buildFfmpegArgs(EMPTY_PROJECT, BUNDLE_PATH, OUTPUT_PATH, {
      resolution: '1080p',
      fps: 30,
      format: 'mp4',
      burnCaptions: false,
      assSubtitlePath: ASS_PATH
    })
    const joined = args.join(' ')
    expect(joined).not.toContain('subtitles=')
  })
})

describe('buildFfmpegArgs() — empty project edge case', () => {
  const defaultOpts: FfmpegBuilderOpts = {
    resolution: '1080p',
    fps: 30,
    format: 'mp4',
    burnCaptions: false
  }

  it('empty project still contains output path as last arg', () => {
    const args = buildFfmpegArgs(EMPTY_PROJECT, BUNDLE_PATH, OUTPUT_PATH, defaultOpts)
    expect(args[args.length - 1]).toBe(OUTPUT_PATH)
  })

  it('empty project still contains -c:v flag', () => {
    const args = buildFfmpegArgs(EMPTY_PROJECT, BUNDLE_PATH, OUTPUT_PATH, defaultOpts)
    expect(args).toContain('-c:v')
  })

  it('empty project: array has at least 3 elements (not trivially empty)', () => {
    const args = buildFfmpegArgs(EMPTY_PROJECT, BUNDLE_PATH, OUTPUT_PATH, defaultOpts)
    expect(args.length).toBeGreaterThanOrEqual(3)
  })
})

// ---------------------------------------------------------------------------
// buildFfmpegArgs() — audio map label regression
// ---------------------------------------------------------------------------

describe('buildFfmpegArgs() — audio-only (no gain/fade) map label', () => {
  // Regression: when an audio clip has default gain=1 and no fades, the builder
  // used to emit `-map [1:a]` (bracketed). FFmpeg treats bracketed refs as
  // filtergraph output labels — not direct stream specifiers — causing exit 234:
  //   "Output with label '1:a' does not exist in any defined filter graph"
  // The fix strips brackets so the bare stream specifier `1:a` is passed.

  const MINIMAL_AUDIO_CLIP = {
    id: 'aclip-001',
    mediaRef: 'media/1.wav',
    in: 0,
    out: 10,
    start: 0,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false, opacity: 1, z: 0 },
    audio: { gain: 1, fadeInSec: 0, fadeOutSec: 0, muted: false }
  }

  const PROJECT_VIDEO_AUDIO = {
    ...EMPTY_PROJECT,
    id: 'test-project-va',
    tracks: [
      { id: 'track-v', type: 'video' as const, clips: [MINIMAL_VIDEO_CLIP] },
      { id: 'track-a', type: 'audio' as const, clips: [MINIMAL_AUDIO_CLIP] }
    ]
  }

  const opts: FfmpegBuilderOpts = { resolution: '1080p', fps: 30, format: 'mp4', burnCaptions: false }

  it('does not emit a bracketed stream ref like [1:a] as a -map argument', () => {
    const args = buildFfmpegArgs(PROJECT_VIDEO_AUDIO, BUNDLE_PATH, OUTPUT_PATH, opts)
    expect(args).not.toContain('[1:a]')
  })

  it('emits the bare stream specifier 1:a after -map', () => {
    const args = buildFfmpegArgs(PROJECT_VIDEO_AUDIO, BUNDLE_PATH, OUTPUT_PATH, opts)
    const mapIdx = args.lastIndexOf('-map')
    // The last -map should be the audio stream specifier
    expect(args[mapIdx + 1]).toBe('1:a')
  })
})

// ---------------------------------------------------------------------------
// ExportJob / ExportProgress / ExportResult — type constructability
// ---------------------------------------------------------------------------

describe('ExportJob type constructability', () => {
  it('can construct a valid ExportJob with all required fields', () => {
    const ref: ProjectRef = {
      id: 'proj-001',
      name: 'My Project',
      location: 'local',
      path: '/tmp/my-project.vproj'
    }

    const job: ExportJob = {
      ref,
      format: 'mp4',
      resolution: '1080p',
      fps: 30,
      burnCaptions: true,
      subtitles: { srt: true, vtt: true, ass: true },
      outputLocation: 'local'
    }

    expect(job.format).toBe('mp4')
    expect(job.resolution).toBe('1080p')
    expect(job.fps).toBe(30)
    expect(job.burnCaptions).toBe(true)
    expect(job.subtitles.srt).toBe(true)
    expect(job.subtitles.vtt).toBe(true)
    expect(job.subtitles.ass).toBe(true)
    expect(job.outputLocation).toBe('local')
  })

  it('ExportJob with format "webm" is constructable', () => {
    const ref: ProjectRef = {
      id: 'proj-002',
      name: 'Webm Project',
      location: 'local',
      path: '/tmp/webm.vproj'
    }
    const job: ExportJob = {
      ref,
      format: 'webm',
      resolution: '720p',
      fps: 25,
      burnCaptions: false,
      subtitles: { srt: false, vtt: false, ass: false },
      outputLocation: 'onedrive'
    }
    expect(job.format).toBe('webm')
    expect(job.outputLocation).toBe('onedrive')
  })

  it('ExportJob with format "mov" is constructable', () => {
    const ref: ProjectRef = {
      id: 'proj-003',
      name: 'Mov Project',
      location: 'local',
      path: '/tmp/mov.vproj'
    }
    const job: ExportJob = {
      ref,
      format: 'mov',
      resolution: '4k',
      fps: 60,
      burnCaptions: false,
      subtitles: { srt: true, vtt: false, ass: false },
      outputLocation: 'local'
    }
    expect(job.format).toBe('mov')
    expect(job.resolution).toBe('4k')
  })
})

describe('ExportProgress type constructability', () => {
  it('can construct ExportProgress with phase "done" and percent 100', () => {
    const progress: ExportProgress = {
      jobId: 'job-abc-123',
      phase: 'done',
      percent: 100,
      message: 'Export complete'
    }
    expect(progress.jobId).toBe('job-abc-123')
    expect(progress.phase).toBe('done')
    expect(progress.percent).toBe(100)
  })

  it('can construct ExportProgress with phase "encoding" and optional error absent', () => {
    const progress: ExportProgress = {
      jobId: 'job-xyz',
      phase: 'encoding',
      percent: 42,
      message: 'Encoding video...'
    }
    expect(progress.error).toBeUndefined()
  })

  it('can construct ExportProgress with phase "error" and error field set', () => {
    const progress: ExportProgress = {
      jobId: 'job-err',
      phase: 'error',
      percent: 0,
      message: 'Export failed',
      error: 'FFmpeg process exited with code 1'
    }
    expect(progress.phase).toBe('error')
    expect(progress.error).toBe('FFmpeg process exited with code 1')
  })

  it('all valid phase values are constructable', () => {
    const phases: ExportProgress['phase'][] = [
      'preparing', 'encoding', 'subtitles', 'writing', 'done', 'error'
    ]
    for (const phase of phases) {
      const p: ExportProgress = {
        jobId: 'j',
        phase,
        percent: 50,
        message: phase
      }
      expect(p.phase).toBe(phase)
    }
  })
})

describe('ExportResult type constructability', () => {
  it('can construct ExportResult with only jobId (all ref fields optional)', () => {
    const result: ExportResult = {
      jobId: 'job-result-001'
    }
    expect(result.jobId).toBe('job-result-001')
    expect(result.videoRef).toBeUndefined()
    expect(result.srtRef).toBeUndefined()
    expect(result.vttRef).toBeUndefined()
    expect(result.assRef).toBeUndefined()
  })

  it('can construct ExportResult with all optional fields set', () => {
    const result: ExportResult = {
      jobId: 'job-result-002',
      videoRef: 'exports/output.mp4',
      srtRef: 'exports/output.srt',
      vttRef: 'exports/output.vtt',
      assRef: 'exports/output.ass'
    }
    expect(result.videoRef).toBe('exports/output.mp4')
    expect(result.srtRef).toBe('exports/output.srt')
    expect(result.vttRef).toBe('exports/output.vtt')
    expect(result.assRef).toBe('exports/output.ass')
  })

  it('can construct ExportResult with only video ref (no subtitle refs)', () => {
    const result: ExportResult = {
      jobId: 'job-result-003',
      videoRef: 'exports/clip.mp4'
    }
    expect(result.videoRef).toBe('exports/clip.mp4')
    expect(result.srtRef).toBeUndefined()
  })
})

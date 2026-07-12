/**
 * FFmpeg filtergraph builder (P12.1, Doc 13 ffmpeg-export skill).
 *
 * Pure function — no side effects, no file I/O, no electron / node imports.
 * Testable in isolation (vitest). Produces the full FFmpeg argv array for a
 * given project timeline, so the export runner can spawn it directly.
 *
 * Parity: reuses transitionToXfade / buildXfadeFilterString from the existing
 * transition engine (clipTransition.ts / transitionExport.ts) so the exported
 * video matches the preview compositor's blend logic exactly.
 */

import type { Project } from '../../shared/storage'
import type { ExportFormat, ExportResolution } from '../../shared/export'
import { RESOLUTION_DIMENSIONS } from '../../shared/export'
import { resolveTransition } from '../../renderer/store/timeline/clipTransition'
import { buildXfadeFilterString } from '../../renderer/store/timeline/transitionExport'

// ---------------------------------------------------------------------------
// Resolution + codec maps
// ---------------------------------------------------------------------------

/**
 * Output width × height for each ExportResolution. Re-exported from the SHARED
 * {@link RESOLUTION_DIMENSIONS} so the renderer's caption-overlay pre-pass and
 * this builder scale to identical dimensions (single source of truth).
 */
export const RESOLUTION_MAP = RESOLUTION_DIMENSIONS

/** Video and audio codec for each ExportFormat. */
const CODEC_MAP: Record<ExportFormat, { vcodec: string; acodec: string }> = {
  mp4: { vcodec: 'libx264', acodec: 'aac' },
  mov: { vcodec: 'libx264', acodec: 'aac' },
  webm: { vcodec: 'libvpx-vp9', acodec: 'libopus' }
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface FfmpegBuilderOpts {
  resolution: ExportResolution
  fps: number
  format: ExportFormat
  burnCaptions: boolean
  /**
   * If burnCaptions is true and an ASS file has been generated, pass its
   * absolute path here so libass can overlay it via the subtitles filter.
   */
  assSubtitlePath?: string
  /**
   * Absolute path to the app's bundled fonts directory (resources/fonts/ in dev,
   * process.resourcesPath/fonts/ in packaged). When set, libass will find the
   * Noto Indic TTFs here instead of relying on system fontconfig — which on macOS
   * does NOT scan CoreText system fonts. Without this, Tamil/Indic captions fall
   * back to a Latin font and render as garbled glyphs.
   *
   * Omit to fall back to the project bundle's media/fonts/ (user-imported only).
   */
  appFontsDir?: string
  /**
   * Pre-rendered transparent caption overlay (P13.x). When set, a PNG-sequence
   * input is added and composited over the video with an `overlay` filter — and
   * the flat libass ASS burn-in is SKIPPED (this overlay replaces it, matching
   * the preview's gradient/3D/karaoke look). `assSubtitlePath` is ignored for
   * burn-in when this is present (the ASS is still written as a sidecar).
   */
  captionOverlay?: {
    /** Absolute image2 pattern, e.g. `/…/frame_%06d.png`. */
    framesPattern: string
    /** FPS the sequence was rendered at (matches `opts.fps`). */
    fps: number
    /** Timeline seconds of frame 0 (the input is `-itsoffset` by this). */
    startSec: number
  }
}

/**
 * Build an FFmpeg command for a project.
 * Returns the full argv array (without 'ffmpeg' at index 0).
 * Pure function — no side effects, no file I/O.
 *
 * Strategy:
 *  1. One `-i` input per video/image clip, in timeline order.
 *  2. A filtergraph that:
 *     a. Scales each input to the target resolution + applies clip transform
 *        (scale, rotation, opacity) via scale2ref/overlay or scale+rotate filters.
 *     b. Concatenates clips sequentially (or xfade for transitions).
 *     c. Mixes all audio streams via amix.
 *     d. Optionally overlays ASS captions via the `subtitles` filter.
 *  3. Video/audio codec flags for the chosen format.
 *
 * ─── Preview↔Export Parity Notes (P13.2) ────────────────────────────────────
 *
 * PREVIEW-EXACT (bit-for-bit equivalent between preview and export):
 *  - Transitions: all four built-in presets (dissolve, slide, zoom, glitch) map
 *    to FFmpeg xfade filters via `transitionToXfade` in `transitionExport.ts`.
 *    The same `TransitionRef.duration` and timeline-derived `offset` are used in
 *    both paths. Glitch is approximated by `pixelize` (closest xfade available).
 *  - Clip trim (in/out points): FFmpeg `-ss`/`-t` inputs match `clip.in`/`clip.out`.
 *  - Clip scale, flip, rotation, and opacity: applied via FFmpeg scale/hflip/vflip/
 *    rotate/colorchannelmixer filters using the same `transform.*` field values the
 *    preview compositor reads.
 *  - Audio gain and fade-in/fade-out: reproduced via the `volume` and `afade` filters.
 *
 * APPROXIMATED (export output differs from preview in appearance):
 *  - Text effects (blur, echo, glow, neon, glitch, 3d, retro): the preview renders
 *    these via Canvas 2D operations in `textEffectsBuiltin.ts` (shadow bloom, RGB
 *    channel split, translucent copies, extruded layers, film grain, etc.). In the
 *    ASS subtitle export path (`subtitleExport.ts` / `captionsToAss`), only font
 *    family (`\fn`), font size (`\fs`), and primary color (`\1c`) are expressed as
 *    ASS override tags. All other effect types (blur, glow, neon, glitch channel
 *    split, 3d extrude, retro grain/chroma) have no ASS equivalent and are silently
 *    omitted from the exported subtitle file. This is a known, intentional gap:
 *    ASS does not expose the primitives needed for most of these effects.
 *  - Clip keyframe animation (in/out/loop presets from `clipAnimation.ts`): the
 *    preview evaluates per-frame samples via `evaluateClipAnimation` to animate
 *    opacity, translation, scale, and rotation continuously. The export applies only
 *    the clip's STATIC `transform` field; per-frame animation curves are not baked
 *    into FFmpeg filters. Export frames will not show entrance/exit animations or
 *    loop effects.
 *  - Per-frame motion paths and tracking offsets: not replicated in FFmpeg; the
 *    static base transform is used.
 *
 * FONT PARITY NOTE (structural difference — not a bug, but a known approximation):
 *  - The preview compositor measures and lays out text using Canvas 2D font metrics
 *    (`ctx.measureText`, `actualBoundingBoxAscent`, etc.) with the system font
 *    stack and any loaded web fonts. The export uses libass to render ASS subtitle
 *    events; libass performs its own font lookup, shaping (HarfBuzz), and layout
 *    using whatever fonts are available in the `fontsdir` supplied to the `subtitles`
 *    filter. Line breaks, word wrap, glyph advances, and baseline positions will
 *    differ between the Canvas 2D preview and the libass export, especially for
 *    complex scripts (Indic, Arabic, CJK). This is an inherent structural difference
 *    between browser-based Canvas rendering and libass layout — not a bug in the
 *    xfade mapping or the transition engine.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Limitations / simplifications:
 *  - Image clips are looped for their duration via `-loop 1 -t <dur>`.
 *  - Keyframe animation is baked (not interpolated per-frame in FFmpeg; the
 *    static transform values from the clip's `transform` field are used).
 *  - Per-frame motion paths are not replicated in FFmpeg (parity note: preview
 *    renders the path; export uses the static transform).
 *  - Tracking offsets are not applied (export uses base transform).
 *  - Audio clips are mixed (amix) without per-clip fade via afade for brevity;
 *    gain (volume filter) is applied per audio clip.
 */
export function buildFfmpegArgs(
  project: Project,
  bundlePath: string,
  outputPath: string,
  opts: FfmpegBuilderOpts
): string[] {
  const [outW, outH] = RESOLUTION_MAP[opts.resolution]
  const { vcodec, acodec } = CODEC_MAP[opts.format]
  const fps = opts.fps

  // Collect all tracks' clips in timeline order (video/image tracks only for
  // the video compositing; audio tracks separately for the audio mix).
  const videoClips: Array<{
    mediaRef: string
    inSec: number
    outSec: number
    startSec: number
    durationSec: number
    isImage: boolean
    transform: {
      scale: number
      rotation: number
      opacity: number
      flipH: boolean
      flipV: boolean
    }
    transitionOut?: Record<string, unknown>
  }> = []

  const audioClips: Array<{
    mediaRef: string
    inSec: number
    durationSec: number
    gain: number
    fadeInSec: number
    fadeOutSec: number
    muted: boolean
    timelineStart: number
  }> = []

  const imageExtensions = new Set([
    'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff', 'tif', 'svg'
  ])

  for (const track of project.tracks) {
    if (track.type === 'video') {
      for (const clip of track.clips) {
        const ext = clip.mediaRef.split('.').pop()?.toLowerCase() ?? ''
        const isImage = imageExtensions.has(ext)
        const durationSec = Math.max(0.001, clip.out - clip.in)
        videoClips.push({
          mediaRef: clip.mediaRef,
          inSec: clip.in,
          outSec: clip.out,
          startSec: clip.start,
          durationSec,
          isImage,
          transform: {
            scale: clip.transform.scale,
            rotation: clip.transform.rotation,
            opacity: clip.transform.opacity,
            flipH: clip.transform.flipH,
            flipV: clip.transform.flipV
          },
          transitionOut: clip.transitions?.out
        })
      }
    } else if (track.type === 'audio') {
      for (const clip of track.clips) {
        const audio = clip.audio
        audioClips.push({
          mediaRef: clip.mediaRef,
          inSec: clip.in,
          durationSec: Math.max(0.001, clip.out - clip.in),
          gain: audio?.gain ?? 1,
          fadeInSec: audio?.fadeInSec ?? 0,
          fadeOutSec: audio?.fadeOutSec ?? 0,
          muted: audio?.muted === true,
          timelineStart: clip.start
        })
      }
    }
  }

  // Sort video clips by timeline start.
  videoClips.sort((a, b) => a.startSec - b.startSec)

  const args: string[] = ['-y'] // overwrite output

  // ---------------------------------------------------------------------------
  // Input declarations
  // ---------------------------------------------------------------------------

  // Video/image inputs
  for (const clip of videoClips) {
    if (clip.isImage) {
      args.push('-loop', '1', '-t', clip.durationSec.toFixed(6))
    } else {
      // Loop the input so a clip extended beyond its source duration repeats
      // rather than going blank. -t caps the total read at the needed duration,
      // so non-extended clips are unaffected (the loop never fires).
      args.push('-stream_loop', '-1')
      args.push('-ss', clip.inSec.toFixed(6), '-t', clip.durationSec.toFixed(6))
    }
    args.push('-i', `${bundlePath}/${clip.mediaRef}`)
  }

  // Audio inputs (after video)
  const audioInputOffset = videoClips.length
  for (const clip of audioClips) {
    args.push('-ss', clip.inSec.toFixed(6), '-t', clip.durationSec.toFixed(6))
    args.push('-i', `${bundlePath}/${clip.mediaRef}`)
  }

  // Caption overlay input (after audio, so `audioInputOffset` is unaffected). A
  // transparent PNG sequence at the export fps; `-itsoffset` aligns frame 0 to
  // the caption span's start so the overlay appears in sync with the timeline.
  const overlayInputIndex = videoClips.length + audioClips.length
  if (opts.captionOverlay !== undefined) {
    const ov = opts.captionOverlay
    args.push('-framerate', ov.fps.toFixed(6))
    if (ov.startSec > 0) args.push('-itsoffset', ov.startSec.toFixed(6))
    args.push('-i', ov.framesPattern)
  }

  // ---------------------------------------------------------------------------
  // Filtergraph
  // ---------------------------------------------------------------------------

  if (videoClips.length === 0 && audioClips.length === 0) {
    // Edge case: empty project — produce a 1-second black video.
    args.push(
      '-f', 'lavfi',
      '-i', `color=black:s=${outW}x${outH}:r=${fps}:d=1`,
      '-t', '1'
    )
    args.push('-c:v', vcodec, '-an', outputPath)
    return args
  }

  const filterParts: string[] = []
  let videoOutputLabel = ''

  if (videoClips.length === 0) {
    // Audio-only — still produce video (black background).
    args.push('-f', 'lavfi', '-i', `color=black:s=${outW}x${outH}:r=${fps}`)
    videoOutputLabel = '[black]'
    filterParts.push(`[${audioInputOffset}:v]scale=${outW}:${outH}[black]`)
  } else if (videoClips.length === 1) {
    // Single clip — scale + apply transform + optional subtitle overlay.
    const clip = videoClips[0]
    const scaleStr = buildScaleFilter(0, clip.transform, outW, outH, fps, '[vout0]')
    filterParts.push(scaleStr)
    videoOutputLabel = '[vout0]'
  } else {
    // Multiple clips — scale each, then concatenate (with xfade transitions).
    for (let i = 0; i < videoClips.length; i++) {
      const clip = videoClips[i]
      const scaleStr = buildScaleFilter(i, clip.transform, outW, outH, fps)
      filterParts.push(scaleStr)
    }

    // Build concat or xfade chain.
    let currentLabel = '[vscaled0]'
    for (let i = 1; i < videoClips.length; i++) {
      const prevClip = videoClips[i - 1]
      const nextLabel = i === videoClips.length - 1 ? '[vout0]' : `[vchain${i}]`
      const transRef = resolveTransition(prevClip.transitionOut)

      if (transRef !== undefined) {
        // Use xfade for the transition between prev and current clip.
        const clipAEnd = prevClip.startSec + prevClip.durationSec
        const xfadeStr = buildXfadeFilterString(transRef, clipAEnd)
        filterParts.push(`${currentLabel}[vscaled${i}]${xfadeStr}${nextLabel}`)
      } else {
        // Plain concat of these two clips.
        filterParts.push(`${currentLabel}[vscaled${i}]concat=n=2:v=1:a=0${nextLabel}`)
      }
      currentLabel = nextLabel
    }
    videoOutputLabel = '[vout0]'
  }

  // Caption burn-in via libass subtitles filter.
  // fontsdir priority: app bundled fonts (Noto Indic TTFs) > project bundle fonts.
  // The app fonts dir is critical for Tamil/Indic: macOS uses CoreText (not
  // fontconfig), so libass never finds system Tamil fonts without an explicit dir.
  let finalVideoLabel = videoOutputLabel
  if (opts.captionOverlay !== undefined) {
    // Preview-faithful burn-in: composite the pre-rendered transparent caption
    // PNG sequence over the video. The frames are rendered at the PROJECT canvas
    // size, so first scale+pad them into the output frame the SAME way the video
    // is fit (force_original_aspect_ratio=decrease) — with a fully TRANSPARENT
    // pad (`color=black@0` on an rgba layer) so only the caption pixels composite
    // and the padded border never blacks out the video. When project and export
    // aspect match, the scale is exact and the pad is a no-op.
    filterParts.push(
      `[${overlayInputIndex}:v]format=rgba,scale=${outW}:${outH}:force_original_aspect_ratio=decrease,` +
        `pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:color=black@0[capov]`
    )
    // `eof_action=pass` keeps the base video after the caption span ends;
    // `format=auto` preserves the overlay's alpha during compositing.
    filterParts.push(
      `${videoOutputLabel}[capov]overlay=0:0:eof_action=pass:format=auto[vfinal]`
    )
    finalVideoLabel = '[vfinal]'
  } else if (opts.burnCaptions && opts.assSubtitlePath !== undefined) {
    const assPath = opts.assSubtitlePath.replace(/\\/g, '/').replace(/:/g, '\\:')
    const rawFontsDir = opts.appFontsDir ?? `${bundlePath}/media/fonts`
    const fontsDir = rawFontsDir.replace(/\\/g, '/').replace(/:/g, '\\:')
    const subtitlesFilter = `subtitles='${assPath}':fontsdir='${fontsDir}'`
    filterParts.push(`${videoOutputLabel}${subtitlesFilter}[vfinal]`)
    finalVideoLabel = '[vfinal]'
  }

  // Audio mix.
  let audioFilterOut = ''
  if (audioClips.length > 0) {
    const audioParts: string[] = []
    for (let i = 0; i < audioClips.length; i++) {
      const clip = audioClips[i]
      const inputIdx = audioInputOffset + i
      const muted = clip.muted
      const gain = muted ? 0 : clip.gain

      // Apply volume.
      let audioChain = `[${inputIdx}:a]`
      if (gain !== 1) {
        audioParts.push(`[${inputIdx}:a]volume=${gain.toFixed(4)}[a${i}vol]`)
        audioChain = `[a${i}vol]`
      }

      // Apply fade-in.
      if (!muted && clip.fadeInSec > 0) {
        const nextLabel = `[a${i}fadein]`
        filterParts.push(
          `${audioChain}afade=t=in:st=0:d=${clip.fadeInSec.toFixed(6)}${nextLabel}`
        )
        audioChain = nextLabel
      }

      // Apply fade-out.
      if (!muted && clip.fadeOutSec > 0) {
        const fadeStart = Math.max(0, clip.durationSec - clip.fadeOutSec)
        const nextLabel = `[a${i}fadeout]`
        filterParts.push(
          `${audioChain}afade=t=out:st=${fadeStart.toFixed(6)}:d=${clip.fadeOutSec.toFixed(6)}${nextLabel}`
        )
        audioChain = nextLabel
      }

      // Push volume filter if we built it separately.
      if (gain !== 1 && !audioParts.some((p) => p.includes(`[a${i}vol]`))) {
        filterParts.push(`[${inputIdx}:a]volume=${gain.toFixed(4)}[a${i}vol]`)
      }

      audioFilterOut = audioChain
    }

    // Flush any volume filters that were queued separately.
    for (const part of audioParts) {
      if (!filterParts.includes(part)) filterParts.push(part)
    }

    if (audioClips.length > 1) {
      // Mix all audio streams. Rebuild per-clip labels:
      const perClipLabels: string[] = []
      for (let i = 0; i < audioClips.length; i++) {
        const clip = audioClips[i]
        const inputIdx = audioInputOffset + i
        const muted = clip.muted
        const gain = muted ? 0 : clip.gain
        let lastLabel = `[${inputIdx}:a]`
        if (gain !== 1) lastLabel = `[a${i}vol]`
        if (!muted && clip.fadeInSec > 0) lastLabel = `[a${i}fadein]`
        if (!muted && clip.fadeOutSec > 0) lastLabel = `[a${i}fadeout]`
        perClipLabels.push(lastLabel)
      }
      filterParts.push(`${perClipLabels.join('')}amix=inputs=${audioClips.length}:duration=longest[aout]`)
      audioFilterOut = '[aout]'
    }
  }

  // Assemble the filtergraph string.
  const filtergraph = filterParts.join(';')

  if (filtergraph.length > 0) {
    args.push('-filter_complex', filtergraph)
    args.push('-map', finalVideoLabel)
    if (audioFilterOut.length > 0) {
      // Raw input refs like [1:a] must be mapped without brackets; filtergraph
      // output labels like [aout] keep them. FFmpeg treats [N:a] as a label lookup
      // inside -filter_complex, which fails when the stream bypassed the graph.
      const rawStreamRef = audioFilterOut.match(/^\[(\d+:[av])\]$/)
      args.push('-map', rawStreamRef ? rawStreamRef[1] : audioFilterOut)
    }
  } else if (videoClips.length > 0) {
    // No complex filter needed for a single un-transformed clip.
    args.push('-map', '0:v')
    if (audioClips.length > 0) {
      args.push('-map', `${audioInputOffset}:a`)
    }
  }

  // ---------------------------------------------------------------------------
  // Codec + output flags
  // ---------------------------------------------------------------------------

  args.push('-c:v', vcodec)
  if (vcodec === 'libx264') {
    args.push('-preset', 'medium', '-crf', '23')
  } else if (vcodec === 'libvpx-vp9') {
    args.push('-crf', '33', '-b:v', '0')
  }

  args.push('-r', String(fps))
  args.push('-s', `${outW}x${outH}`)

  args.push('-c:a', acodec)
  if (acodec === 'aac') {
    args.push('-b:a', '192k')
  } else if (acodec === 'libopus') {
    args.push('-b:a', '192k')
  }

  // Container-specific flags.
  if (opts.format === 'mp4' || opts.format === 'mov') {
    args.push('-movflags', '+faststart')
  }

  args.push(outputPath)

  return args
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a scale + transform filter for a single video/image input.
 * @param targetFps - output frame rate; used to normalise the time base and pixel
 *   format so that all clips fed into `concat` have identical stream properties.
 *   Without this normalisation, clips with different source fps / pixel-formats
 *   cause concat to fail with "Error reinitializing filters" (exit 234).
 * @param outputLabel - the filtergraph label to assign to the output stream.
 *   Defaults to `[vscaled<inputIdx>]` for multi-clip projects; the single-clip
 *   caller passes `[vout0]` directly so the label matches what `-map` expects.
 */
function buildScaleFilter(
  inputIdx: number,
  transform: {
    scale: number
    rotation: number
    opacity: number
    flipH: boolean
    flipV: boolean
  },
  outW: number,
  outH: number,
  targetFps: number,
  outputLabel: string = `[vscaled${inputIdx}]`
): string {

  const parts: string[] = []

  // Scale to fit output resolution.
  const chain = `[${inputIdx}:v]`
  parts.push(`scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2`)

  // Apply scale transform.
  if (transform.scale !== 1) {
    const scaledW = Math.round(outW * transform.scale)
    const scaledH = Math.round(outH * transform.scale)
    parts.push(`scale=${scaledW}:${scaledH}`)
  }

  // Apply flips.
  if (transform.flipH && transform.flipV) {
    parts.push('hflip,vflip')
  } else if (transform.flipH) {
    parts.push('hflip')
  } else if (transform.flipV) {
    parts.push('vflip')
  }

  // Apply rotation (rounded to nearest 90 for FFmpeg transpose, else use rotate).
  if (transform.rotation !== 0) {
    const rotRad = (transform.rotation * Math.PI) / 180
    const cosA = Math.abs(Math.cos(rotRad))
    const sinA = Math.abs(Math.sin(rotRad))
    const newW = Math.round(outW * cosA + outH * sinA)
    const newH = Math.round(outW * sinA + outH * cosA)
    parts.push(
      `rotate=${rotRad.toFixed(6)}:ow=${newW}:oh=${newH}:fillcolor=black@0`
    )
  }

  // Apply opacity via alphamerge or format conversion + overlay.
  if (transform.opacity !== 1) {
    const opacityVal = Math.max(0, Math.min(1, transform.opacity))
    parts.push(`format=rgba,colorchannelmixer=aa=${opacityVal.toFixed(4)}`)
  }

  // Normalise frame rate and pixel format so that all clips entering concat have
  // identical stream properties. Without this, concat triggers "Error reinitializing
  // filters" (exit 234) when two source clips have different fps or pixel formats
  // (e.g. yuv420p vs yuvj420p, or 24fps vs 30fps).
  parts.push(`fps=${targetFps}`)
  parts.push('format=yuv420p')
  // Force SAR=1:1 (square pixels). JPEG/PNG sources can carry non-square or
  // undefined SAR tags (e.g. SAR 72:72, SAR 0:1) which survive scale and cause
  // concat to fail with "SAR mismatch" even when all streams are 1920×1080.
  parts.push('setsar=1')

  return `${chain}${parts.join(',')}${outputLabel}`
}

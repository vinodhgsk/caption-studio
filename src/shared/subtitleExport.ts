/**
 * Pure subtitle sidecar generators (P12.3, Doc 13 subtitle-export skill).
 *
 * All functions are pure — no file I/O, no electron / node imports. Returns
 * UTF-8 strings ready to write as .srt / .vtt / .ass. Indic scripts (Tamil,
 * Telugu, Malayalam, Kannada, Hindi) are represented as-is in UTF-8 and the
 * ASS section references an Indic-capable font (Noto Sans Tamil fallback) so
 * HarfBuzz shaping renders them correctly in libass and players.
 */

export interface CaptionClipLike {
  startSec: number
  endSec: number
  text: string
  fontFamily?: string
  fontSize?: number
  color?: string // hex, e.g. '#FFFFFF'
  outlineColor?: string
  outlineWidth?: number
  captionAnchor?: 'lower-third' | 'center' | 'top' | 'custom'
  posY?: number // transform.y: normalized fraction (|y|<=1.5) or canvas pixels
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format seconds as `HH:MM:SS,mmm` (SRT) or `HH:MM:SS.mmm` (VTT).
 * `separator` is `,` for SRT, `.` for VTT.
 */
function formatTimecode(sec: number, separator: ',' | '.'): string {
  const totalMs = Math.round(sec * 1000)
  const ms = totalMs % 1000
  const totalSec = Math.floor(totalMs / 1000)
  const s = totalSec % 60
  const totalMin = Math.floor(totalSec / 60)
  const m = totalMin % 60
  const h = Math.floor(totalMin / 60)

  const pad2 = (n: number): string => String(n).padStart(2, '0')
  const pad3 = (n: number): string => String(n).padStart(3, '0')

  return `${pad2(h)}:${pad2(m)}:${pad2(s)}${separator}${pad3(ms)}`
}

/**
 * Format seconds as `H:MM:SS.mmm` for ASS dialogue (ASS uses H:MM:SS.cc where
 * cc = centiseconds; we output centiseconds for parity).
 */
function formatAssTime(sec: number): string {
  const totalCs = Math.round(sec * 100)
  const cs = totalCs % 100
  const totalSec = Math.floor(totalCs / 100)
  const s = totalSec % 60
  const totalMin = Math.floor(totalSec / 60)
  const m = totalMin % 60
  const h = Math.floor(totalMin / 60)

  const pad2 = (n: number): string => String(n).padStart(2, '0')

  return `${h}:${pad2(m)}:${pad2(s)}.${pad2(cs)}`
}

/**
 * Convert a hex color string ('#RRGGBB' or '#RGB') to an ASS BGR hex string
 * (ASS uses AABBGGRR; we use 00BBGGRR with zero alpha = fully opaque).
 * Falls back to white (00FFFFFF in ASS = &H00FFFFFF&) on invalid input.
 */
function hexToAssBgr(hex: string | undefined): string {
  if (hex === undefined) return '00FFFFFF'
  const clean = hex.replace('#', '')
  let r: string, g: string, b: string
  if (clean.length === 3) {
    r = clean[0] + clean[0]
    g = clean[1] + clean[1]
    b = clean[2] + clean[2]
  } else if (clean.length === 6) {
    r = clean.slice(0, 2)
    g = clean.slice(2, 4)
    b = clean.slice(4, 6)
  } else {
    return '00FFFFFF'
  }
  return `00${b}${g}${r}`.toUpperCase()
}

// ---------------------------------------------------------------------------
// SRT
// ---------------------------------------------------------------------------

/**
 * Generate SRT from caption clips. Each clip becomes one numbered subtitle
 * entry. Timecodes use `HH:MM:SS,mmm` as per the SRT spec.
 */
export function captionsToSrt(clips: CaptionClipLike[]): string {
  if (clips.length === 0) return ''
  const entries = clips.map((clip, i) => {
    const start = formatTimecode(clip.startSec, ',')
    const end = formatTimecode(clip.endSec, ',')
    return `${i + 1}\n${start} --> ${end}\n${clip.text}`
  })
  return entries.join('\n\n') + '\n'
}

// ---------------------------------------------------------------------------
// WebVTT
// ---------------------------------------------------------------------------

/**
 * Generate WebVTT from caption clips. Begins with `WEBVTT\n\n`. Timecodes use
 * `HH:MM:SS.mmm` as per the WebVTT spec.
 */
export function captionsToVtt(clips: CaptionClipLike[]): string {
  const header = 'WEBVTT\n\n'
  if (clips.length === 0) return header
  const entries = clips.map((clip, i) => {
    const start = formatTimecode(clip.startSec, '.')
    const end = formatTimecode(clip.endSec, '.')
    return `${i + 1}\n${start} --> ${end}\n${clip.text}`
  })
  return header + entries.join('\n\n') + '\n'
}

// ---------------------------------------------------------------------------
// ASS (Advanced SubStation Alpha)
// ---------------------------------------------------------------------------

/**
 * Generate an ASS (Advanced SubStation Alpha v4+) subtitle file from caption
 * clips. Includes:
 *   - [Script Info] with resolution and PlayResX/Y
 *   - [V4+ Styles] with Indic-capable font (the clip's fontFamily or "Noto Sans Tamil")
 *   - [Events] with one Dialogue line per clip
 *
 * The font name is chosen so HarfBuzz shaping (via libass) renders Tamil,
 * Telugu, Malayalam, Kannada, and Hindi correctly when the font is installed
 * or embedded. `fontName` overrides the per-clip family (useful when a single
 * font covers all captions).
 */
const PLAY_RES_X = 1920
const PLAY_RES_Y = 1080

/**
 * Compute the ASS \an5 vertical center pixel for a clip based on its
 * captionAnchor and posY (transform.y).
 *
 * transform.y is stored as either:
 *  - normalized fraction (|y| ≤ 1.5): e.g. 0.35 for lower-third from a preset
 *  - canvas pixels (|y| > 1.5): e.g. 378 after resolveCaptionY at 1080p
 *
 * playResY must match the actual ASS PlayResY so coordinates scale correctly.
 */
function assY(
  captionAnchor: CaptionClipLike['captionAnchor'],
  posY: number | undefined,
  playResY: number
): number {
  const center = playResY / 2
  if (captionAnchor === 'center') return center
  if (captionAnchor === 'top') return Math.round(playResY * 0.15)
  if (captionAnchor === 'custom' && posY !== undefined) {
    const yPx = Math.abs(posY) <= 1.5 ? posY * playResY : posY
    return Math.round(center + yPx)
  }
  // lower-third (default): use posY if it looks like pixels, else 85% down
  if (posY !== undefined && Math.abs(posY) > 1.5) {
    return Math.round(center + posY)
  }
  return Math.round(playResY * 0.85)
}

export function captionsToAss(
  clips: CaptionClipLike[],
  fontName?: string,
  opts?: { playResX?: number; playResY?: number }
): string {
  const playResX = opts?.playResX ?? PLAY_RES_X
  const playResY = opts?.playResY ?? PLAY_RES_Y

  // Defaults
  const defaultFont = fontName ?? 'Noto Sans Tamil'
  const defaultSize = 48
  const defaultColor = '00FFFFFF' // white, ASS AABBGGRR with 00 alpha

  const styleName = 'Default'
  const firstClip = clips[0]
  const styleFont = fontName ?? firstClip?.fontFamily ?? defaultFont
  const styleSize = firstClip?.fontSize ?? defaultSize
  const stylePrimary = `&H${firstClip?.color !== undefined ? hexToAssBgr(firstClip.color) : defaultColor}&`
  // Read outline width and color from the first clip's stroke (default: 4px black)
  const styleOutlineW = firstClip?.outlineWidth ?? 4
  const styleOutlineColor = `&H${hexToAssBgr(firstClip?.outlineColor ?? '#000000')}&`

  const scriptInfo = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.601',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    ''
  ].join('\n')

  // V4+ style fields (in order):
  // Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour,
  // BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing,
  // Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
  const styleHeader = '[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding'
  const styleRow = `Style: ${styleName},${styleFont},${styleSize},${stylePrimary},&H00FFFFFF&,${styleOutlineColor},&H80000000&,0,0,0,0,100,100,0,0,1,${styleOutlineW},2,5,10,10,0,1`

  const stylesSection = [styleHeader, styleRow, ''].join('\n')

  // Events
  const eventHeader = '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'

  const dialogueLines = clips.map((clip) => {
    const start = formatAssTime(clip.startSec)
    const end = formatAssTime(clip.endSec)

    const parts: string[] = []

    // Position: \an5 (center-anchor) + \pos(x,y) so the clip's captionAnchor is respected.
    const cy = assY(clip.captionAnchor, clip.posY, playResY)
    parts.push(`{\\an5\\pos(${playResX / 2},${cy})}`)

    const clipFont = fontName ?? clip.fontFamily
    if (clipFont !== undefined && clipFont !== styleFont) {
      parts.push(`{\\fn${clipFont}}`)
    }
    if (clip.fontSize !== undefined && clip.fontSize !== styleSize) {
      parts.push(`{\\fs${clip.fontSize}}`)
    }
    if (clip.color !== undefined) {
      parts.push(`{\\1c&H${hexToAssBgr(clip.color)}&}`)
    }
    if (clip.outlineColor !== undefined) {
      parts.push(`{\\3c&H${hexToAssBgr(clip.outlineColor)}&}`)
    }
    if (clip.outlineWidth !== undefined && clip.outlineWidth !== styleOutlineW) {
      parts.push(`{\\bord${clip.outlineWidth}}`)
    }

    const text = parts.join('') + clip.text.replace(/\n/g, '\\N')
    return `Dialogue: 0,${start},${end},${styleName},,0,0,0,,${text}`
  })

  const eventsSection = [eventHeader, ...dialogueLines, ''].join('\n')

  return [scriptInfo, stylesSection, eventsSection].join('\n')
}

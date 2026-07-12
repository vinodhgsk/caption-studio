import { useMemo } from 'react'
import type { Clip } from '../../../../shared/project-schema'
import { barCountForWidth, peaksForClip } from './clipWaveform'
import { useClipWaveform } from './waveformCache'
import { waveformBars } from './virtualize'
import type { WaveformPeak } from './waveform'

interface WaveformStripProps {
  clip: Clip
  /** Rendered clip width in px — drives the bar count (downsample target). */
  widthPx: number
  /** Resolved bundle absolute path, or null until known / no project. */
  bundleAbs: string | null
}

/** Target pixels per waveform bar — denser than the placeholder for real audio. */
const PX_PER_BAR = 2
/** Hard cap on bars per clip so a very wide block never explodes the SVG. */
const MAX_BARS = 1024

/**
 * Render the DECODED audio waveform inside a timeline clip block (P4.2).
 *
 * The decoded waveform is resolved from the shared per-(bundle, mediaRef) cache
 * (`useClipWaveform`) so a source file is decoded ONCE regardless of how many
 * clips reference it or how often the timeline scrolls/zooms. The cached peaks
 * are then sliced to the clip's source window `[in, out]` and downsampled to the
 * clip's rendered pixel width (`peaksForClip` + `barCountForWidth`) so draw cost
 * tracks on-screen size, not clip length.
 *
 * Until the decode resolves (or if it fails), a deterministic placeholder shape
 * (`waveformBars`, the P3 strip) is drawn so the lane never shows a blank block.
 * Pure draw math lives in `clipWaveform.ts`; this component only maps peaks → SVG.
 */
export function WaveformStrip({ clip, widthPx, bundleAbs }: WaveformStripProps): JSX.Element {
  const waveform = useClipWaveform(bundleAbs, clip.mediaRef)
  const bars = barCountForWidth(widthPx, PX_PER_BAR, MAX_BARS)

  // Real peaks (sliced to the clip's source window) once decoded; else a stable
  // placeholder shape so the block is never blank.
  const peaks = useMemo<WaveformPeak[]>(() => {
    if (waveform === null) {
      return waveformBars(clip.id, bars).map((amp) => ({ min: -amp, max: amp }))
    }
    return peaksForClip(waveform.peaks, waveform.durationSec, clip.in, clip.out, bars)
  }, [waveform, clip.id, clip.in, clip.out, bars])

  return (
    <svg
      className="pointer-events-none h-full w-full text-accent"
      viewBox={`0 0 ${peaks.length} 100`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {peaks.map((peak, i) => {
        // Map [-1, 1] amplitude to the [0, 100] viewBox (0 = top, 50 = center).
        const top = (1 - peak.max) * 50
        const height = Math.max(0.5, (peak.max - peak.min) * 50)
        return (
          <rect
            key={i}
            x={i + 0.15}
            y={top}
            width={0.7}
            height={height}
            fill="currentColor"
            opacity={0.55}
          />
        )
      })}
    </svg>
  )
}

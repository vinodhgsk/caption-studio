/**
 * Pure timeline-clip virtualization + placeholder-pattern helpers (P3.4).
 *
 * Constraint B (virtualize): `visibleClips` returns ONLY the clips whose time
 * range intersects the visible window (plus overscan); off-screen clips never
 * reach the DOM. Constraint C (headless / determinism): NO DOM / React / electron
 * imports, and NO Math.random / Date.now / performance.now — placeholder patterns
 * are derived deterministically from clip identity, so the same clip renders the
 * same strip every time. All of this is node-importable and unit-tested in
 * `virtualize.test.ts`.
 */

import type { Clip } from '../../../../shared/project-schema'
import { clipEndSec } from './scale'

/**
 * The clips whose on-timeline range `[start, start + (out - in))` intersects the
 * visible window `[viewStartSec - overscanSec, viewEndSec + overscanSec]`.
 *
 * Intersection is HALF-OPEN (`[start, end)` with `[lo, hi)`), matching preview
 * playhead visibility semantics. Clips touching only the window boundary are
 * excluded. This is a single linear filter — it scales to many clips without a
 * perf cliff. Off-screen clips are EXCLUDED from the result (and thus from the
 * DOM).
 */
export function visibleClips(
  clips: readonly Clip[],
  viewStartSec: number,
  viewEndSec: number,
  overscanSec: number
): Clip[] {
  const lo = viewStartSec - overscanSec
  const hi = viewEndSec + overscanSec
  const out: Clip[] = []
  for (const clip of clips) {
    const start = clip.start
    const end = clipEndSec(clip)
    if (end <= start) continue
    // Intersect half-open intervals [start, end) and [lo, hi).
    if (end > lo && start < hi) out.push(clip)
  }
  return out
}

/**
 * Human-readable label for a clip, derived from its `mediaRef` basename (the
 * trailing path segment, e.g. "media/intro.mp4" -> "intro.mp4"). Text clips
 * (P3.14) carry no media (`mediaRef === ''`); they label by their first
 * non-empty `text.lines` entry instead. Falls back to the clip id when neither
 * is available. Pure + deterministic.
 */
export function clipLabel(clip: Clip): string {
  const ref = clip.mediaRef
  const lastSlash = Math.max(ref.lastIndexOf('/'), ref.lastIndexOf('\\'))
  const base = lastSlash >= 0 ? ref.slice(lastSlash + 1) : ref
  if (base.length > 0) return base
  const firstLine = clip.text?.lines?.find((l) => l.trim().length > 0)
  if (firstLine !== undefined) return firstLine
  return clip.id
}

/**
 * Deterministic bar heights (each in `(0, 1]`) for an audio waveform placeholder
 * strip. Derived from a simple string hash of the clip id so a clip always draws
 * the same shape across renders — NO Math.random. The shape is purely cosmetic
 * (real waveform sampling is P4); `count` controls bar resolution.
 */
export function waveformBars(clipId: string, count: number): number[] {
  if (count <= 0) return []
  const bars: number[] = []
  for (let i = 0; i < count; i++) {
    // FNV-1a-ish mix over the clip id + bar index — stable and cheap.
    let h = 2166136261 ^ i
    for (let c = 0; c < clipId.length; c++) {
      h = Math.imul(h ^ clipId.charCodeAt(c), 16777619)
    }
    // Map to (0, 1] with a floor so bars are always visible.
    const frac = ((h >>> 0) % 1000) / 1000
    bars.push(0.2 + frac * 0.8)
  }
  return bars
}

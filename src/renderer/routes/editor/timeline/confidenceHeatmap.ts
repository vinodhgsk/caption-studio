/**
 * Confidence heatmap helpers for the timeline caption clip display.
 *
 * A "lyrics-first" caption clip carries per-word `confidence` values (0–1)
 * produced by the alignment engine. These helpers classify each value into a
 * visual tier so the clip body can show a bottom strip where:
 *  - high  (≥ 0.8) → green  — well-timed
 *  - medium (0.6–0.8) → amber  — acceptable
 *  - low   (< 0.6) → red    — needs review / manual correction
 *
 * The tier names are intentionally abstract (no CSS classes) so the helpers
 * are testable in isolation without a DOM.
 */

export type ConfidenceTier = 'high' | 'medium' | 'low'

/**
 * Map a raw confidence value in [0, 1] to a display tier.
 * Values outside [0, 1] are clamped before classification.
 */
export function confidenceTier(value: number): ConfidenceTier {
  const c = Math.max(0, Math.min(1, value))
  if (c >= 0.8) return 'high'
  if (c >= 0.6) return 'medium'
  return 'low'
}

/**
 * Tailwind colour class for each tier, intended for use with `bg-*` modifiers.
 * Returns a transparent background when there is no confidence data.
 */
export function tierColour(tier: ConfidenceTier): string {
  switch (tier) {
    case 'high': return 'bg-emerald-400/70'
    case 'medium': return 'bg-amber-400/70'
    case 'low': return 'bg-red-500/70'
  }
}

/** Fraction of words that fall into the `'low'` tier (0–1). */
export function lowConfidenceFraction(confidences: (number | undefined)[]): number {
  const defined = confidences.filter((c): c is number => c !== undefined)
  if (defined.length === 0) return 0
  const low = defined.filter((c) => confidenceTier(c) === 'low').length
  return low / defined.length
}

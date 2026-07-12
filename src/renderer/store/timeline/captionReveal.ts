/**
 * Word-by-word (and character) caption REVEAL evaluator (P5.5 — Doc 03 caption
 * styles; skills `caption-sync` + `text-render`).
 *
 * Given a caption clip's per-word timing (`clip.caption.words`, absolute seconds
 * in the SAME reference as `clip.start`/`clip.out`) and its reveal config
 * (`clip.animation.reveal`, a {@link PresetReveal}), this computes — PURELY, with
 * NO canvas / DOM / Date — the per-word visibility/opacity at a playhead time
 * `t`. Words appear one-by-one as the playhead reaches each word's start
 * (DRIVEN BY TRANSCRIPT WORD TIMES, not a fixed stagger), optionally eased over a
 * short reveal window so a word fades/pops in rather than snapping.
 *
 * SPLIT (parity): this evaluator is the SINGLE source of truth the live preview
 * (`drawTextClips`) and the future export both read, so reveal looks identical in
 * both. The canvas side only multiplies each word's drawn alpha by the opacity
 * this returns — no reveal logic lives in the draw code.
 *
 * REVEAL MODES (`PresetReveal.mode`):
 *   - `none`       → every word fully visible for the whole clip (opacity 1).
 *   - `word`       → word-by-word. The Nth word's reveal STARTS at:
 *                      • `word.start` (transcript-driven) when `staggerSec === 0`
 *                         — the pop-by-word / TikTok-classic default; or
 *                      • `clip.start + index * staggerSec` (fixed cadence) when
 *                         `staggerSec > 0` — the bounce preset's even stagger.
 *                    Before its start a word is hidden (opacity 0); it eases up to
 *                    1 over {@link REVEAL_WINDOW_SEC} and stays 1 thereafter.
 *   - `character`  → typewriter. Reveal advances by GRAPHEME CLUSTER (indic-text)
 *                    so Tamil/Telugu/Malayalam/Kannada/Hindi reveal one visible
 *                    cluster at a time. A word is partially revealed: its opacity
 *                    is the fraction of its clusters whose reveal time has passed.
 *
 * The result is intentionally a flat per-word array (index-aligned to
 * `caption.words`) of `{ opacity, revealedGraphemes }` so the same shape serves a
 * whole-word fade AND a character cursor.
 */
import type { CaptionWord } from '../../../shared/project-schema'
import type { Easing, PresetReveal } from '../../../shared/captionPreset'
import { splitGraphemes } from '../../../shared/captionSync'
import { clamp01, ease } from '../../../shared/easing'
import { isCueWord } from './captionCue'

/**
 * Default eased reveal window, in seconds: how long a word takes to ramp from
 * opacity 0 → 1 once its reveal starts. Short enough to feel snappy (a pop), long
 * enough that mid-reveal sampling returns a fractional opacity (tested). Used when
 * the reveal would otherwise be an instant 0→1 step.
 */
export const REVEAL_WINDOW_SEC = 0.12

/** Per-word reveal state at a given playhead time (index-aligned to the words). */
export interface WordReveal {
  /** 0..1 — how visible the word is now (0 hidden, 1 fully shown). */
  opacity: number
  /**
   * For `character` mode: how many leading GRAPHEME CLUSTERS of this word have
   * been revealed (typewriter cursor). For `word`/`none` mode this is the word's
   * full cluster count once `opacity > 0`, else 0 — so a caller can drive either
   * a whole-word fade or a character slice from one field.
   */
  revealedGraphemes: number
}

/** The full reveal evaluation for one clip at time `t`: one entry per word. */
export interface ClipReveal {
  /** Per-word state, index-aligned to the clip's `caption.words`. */
  words: WordReveal[]
}

/**
 * Apply a named easing curve to a normalized progress `p` in [0,1]. PURE. Thin
 * wrapper over the shared {@link ease} registry (P8.1 `shared/easing`) — the
 * SINGLE source of truth for every curve in the app — so reveal, highlight, and
 * the in/out/loop animation evaluator cannot drift. The reveal mask stays
 * MONOTONIC 0→1 because the preset `Easing` enum only exposes non-overshoot
 * curves (`spring` here resolves to a smoothstep, not the overshooting elastic);
 * the bounce/elastic OVERSHOOT is reserved for entrance/exit animation presets.
 */
export function applyEasing(p: number, easing: Easing): number {
  return clamp01(ease(easing, p))
}

/**
 * The time (seconds, absolute) at which word `index` begins to reveal:
 *   - `staggerSec === 0` → the word's own `start` (transcript-driven; default).
 *   - `staggerSec  >  0` → `clipStart + index * staggerSec` (fixed cadence).
 * Pure.
 */
export function wordRevealStart(
  words: readonly CaptionWord[],
  index: number,
  clipStart: number,
  staggerSec: number
): number {
  if (staggerSec > 0) return clipStart + index * staggerSec
  return words[index]?.start ?? clipStart
}

/**
 * Per-word opacity for `word` (and `none`) reveal at time `t`. A word is hidden
 * (0) before its reveal start, eases 0→1 over {@link REVEAL_WINDOW_SEC} (using the
 * reveal's easing), and is fully visible (1) after. `windowSec` is exposed for
 * tests; defaults to {@link REVEAL_WINDOW_SEC}. Pure.
 */
function wordModeOpacity(
  revealStart: number,
  t: number,
  easing: Easing,
  windowSec: number
): number {
  if (t < revealStart) return 0
  if (windowSec <= 0) return 1
  const p = (t - revealStart) / windowSec
  return clamp01(applyEasing(p, easing))
}

/** Inputs to {@link evaluateClipReveal} that the caller resolves off the clip. */
export interface EvaluateRevealOptions {
  /** The clip's per-word timing (`clip.caption.words`), in absolute seconds. */
  words: readonly CaptionWord[]
  /** The clip's reveal config (`clip.animation.reveal`); absent → `none`. */
  reveal?: PresetReveal
  /** The clip's timeline start (`clip.start`) — anchors fixed-stagger + character. */
  clipStart: number
  /** Current playhead time, in seconds (absolute timeline reference). */
  t: number
  /** Eased reveal window length; defaults to {@link REVEAL_WINDOW_SEC}. */
  windowSec?: number
}

/**
 * PURE reveal evaluator: returns the per-word visibility/opacity (and per-word
 * grapheme-reveal count) for a caption clip at playhead time `t`. Index-aligned
 * to `words`. No canvas / DOM — unit-testable and reused by export.
 *
 *   - mode `none`/absent → every word opacity 1 (nothing to reveal).
 *   - mode `word`        → each word hidden until its reveal start, then eased to 1.
 *   - mode `character`   → typewriter: per word, leading grapheme clusters reveal
 *                          one at a time at `staggerSec` cadence starting from the
 *                          word's reveal start; opacity = revealed/total clusters.
 *
 * For `character` with `staggerSec === 0` we fall back to a small default cadence
 * (the reveal window per cluster) so word-time-only character mode still advances.
 */
export function evaluateClipReveal(opts: EvaluateRevealOptions): ClipReveal {
  const { words, reveal, clipStart, t } = opts
  const windowSec = opts.windowSec ?? REVEAL_WINDOW_SEC
  const mode = reveal?.mode ?? 'none'
  const easing: Easing = reveal?.easing ?? 'linear'
  const staggerSec = reveal?.staggerSec ?? 0

  if (mode === 'none') {
    return {
      words: words.map((w) => ({ opacity: 1, revealedGraphemes: splitGraphemes(w.text).length }))
    }
  }

  if (mode === 'word') {
    return {
      words: words.map((w, i) => {
        const total = splitGraphemes(w.text).length
        // CUE EXCLUSION (P5.7): a bracketed cue (`[applause]`) is not "spoken",
        // so it is not revealed word-by-word — it is shown in full for the whole
        // clip and does not consume a reveal slot.
        if (isCueWord(w)) return { opacity: 1, revealedGraphemes: total }
        const start = wordRevealStart(words, i, clipStart, staggerSec)
        const opacity = wordModeOpacity(start, t, easing, windowSec)
        return { opacity, revealedGraphemes: opacity > 0 ? total : 0 }
      })
    }
  }

  // mode === 'character' (typewriter). Advance one GRAPHEME CLUSTER per step so
  // Indic conjuncts reveal as a single unit. The per-cluster cadence is the
  // reveal stagger; with stagger 0 we use the reveal window as a sensible step.
  const perCluster = staggerSec > 0 ? staggerSec : windowSec
  return {
    words: words.map((w, i) => {
      const clusters = splitGraphemes(w.text)
      const total = clusters.length
      // CUE EXCLUSION (P5.7): a cue is not typed out cluster-by-cluster — it is
      // shown in full immediately (never a typewriter target).
      if (isCueWord(w)) return { opacity: 1, revealedGraphemes: total }
      const start = wordRevealStart(words, i, clipStart, staggerSec)
      if (t < start || total === 0) return { opacity: 0, revealedGraphemes: 0 }
      const elapsed = t - start
      const revealed = Math.min(total, Math.floor(elapsed / perCluster) + 1)
      return { opacity: clamp01(revealed / total), revealedGraphemes: revealed }
    })
  }
}

/**
 * Convenience: the visible PREFIX of a word's text for `character` mode (the
 * first `revealedGraphemes` grapheme clusters joined back). For `word`/`none`
 * modes a caller typically uses `opacity` against the full word instead, but this
 * lets a typewriter draw the partial string directly. Pure; cluster-safe.
 */
export function revealedWordText(text: string, revealedGraphemes: number): string {
  if (revealedGraphemes <= 0) return ''
  const clusters = splitGraphemes(text)
  if (revealedGraphemes >= clusters.length) return text
  return clusters.slice(0, revealedGraphemes).join('')
}

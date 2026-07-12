/**
 * Active-word HIGHLIGHT evaluator (P5.6 — Doc 03 caption styles; skills
 * `caption-sync` + `text-render`).
 *
 * Sibling of {@link ./captionReveal} (P5.5, the per-word REVEAL evaluator). Where
 * reveal decides *whether* a word is drawn yet, THIS decides which word is the
 * "active" one — the word the playhead is currently inside — and how it animates
 * (color + scale, or a left-to-right wipe). It is PURE: given a clip's per-word
 * timing (`clip.caption.words`, absolute seconds in the SAME reference as
 * `clip.start`/`clip.out`), a {@link PresetHighlight} config, and a playhead time
 * `t`, it returns an index-aligned per-word state. NO canvas / DOM / Date — so the
 * live preview (`drawTextClips`) and the future export both read ONE source of
 * truth and look identical (master-plan §6 parity). The canvas only APPLIES the
 * returned color/scale; no highlight logic lives in the draw code.
 *
 * CONFIG SOURCE (P5.1 contract): the highlight config is NOT denormalized onto
 * the clip. It is read LIVE from the active preset (looked up by
 * `captions.styleId`) at render time, so changing the preset re-colors the active
 * word with no clip rewrite. The preview resolves the preset and passes its
 * `highlight` here; this module never imports the registry (stays headless-pure).
 *
 * ACTIVE WORD: the word whose half-open interval `[start, end)` contains `t`. At
 * most one word is active. Before the first word's start, after the last word's
 * end, and inside a GAP between two words (`prev.end <= t < next.start`) there is
 * NO active word — every word is inactive. Using a half-open interval makes the
 * transition crisp and frame-stable: exactly at `word.start` the word turns on;
 * exactly at `word.end` it turns off (the next word — if it starts there — turns
 * on in the same instant). This is what the ±1-frame sweep test pins down.
 *
 * HIGHLIGHT STYLES (`PresetHighlight.style`):
 *   - `wholeWord` — the active word swaps its fill to `activeColor` and scales to
 *                   `activeScale` (pop-by-word / TikTok flip). Optionally EASED
 *                   near the word boundaries so the pop ramps in/out over a short
 *                   window rather than snapping (see `easeWindowSec`).
 *   - `wipe`      — the active word fills LEFT-TO-RIGHT across its `[start,end]`
 *                   (karaoke). `wipeProgress` runs 0 at the word's start → 1 at
 *                   its end. The fraction is quantized to GRAPHEME CLUSTERS
 *                   (indic-text) so Tamil/Telugu/Malayalam/Kannada/Hindi wipe one
 *                   visible cluster at a time and never split a conjunct.
 */
import type { CaptionWord } from '../../../shared/project-schema'
import type { PresetHighlight } from '../../../shared/captionPreset'
import { splitGraphemes } from '../../../shared/captionSync'
import { applyEasing } from './captionReveal'
import { isCueWord } from './captionCue'

/**
 * Default ease window (seconds) for `wholeWord` scale/color ramp near a word's
 * boundaries. Small enough to feel like a snap-pop, large enough that sampling
 * mid-window returns an intermediate scale (tested). Set to 0 to snap exactly.
 */
export const HIGHLIGHT_EASE_WINDOW_SEC = 0.08

/** Per-word highlight state at a playhead time (index-aligned to the words). */
export interface WordHighlight {
  /** True for the single word whose `[start,end)` contains `t` (else false). */
  active: boolean
  /**
   * The fill color the word should draw with NOW. `activeColor` for the active
   * word, `undefined` for inactive words (the caller keeps the base fill). For
   * `wipe` this is the color of the already-wiped (left) portion.
   */
  color?: string
  /**
   * Scale multiplier to apply to the word (1 = no scale). For `wholeWord` this
   * ramps base→`activeScale`→base across the word (eased near the boundaries);
   * for `wipe` it stays 1 (the wipe carries the motion, not a scale pop).
   */
  scale: number
  /**
   * For `wipe`: 0..1 fill progress across the word, quantized to grapheme
   * clusters (so it advances one Indic cluster at a time). 0 for an inactive
   * word, and for `wholeWord` style (which does not wipe). The number of FILLED
   * leading clusters is `round(wipeProgress * graphemeCount)`.
   */
  wipeProgress: number
}

/** The full highlight evaluation for one clip at time `t`: one entry per word. */
export interface ClipHighlight {
  /** The active word's index, or -1 when no word is active. */
  activeIndex: number
  /** Per-word state, index-aligned to the clip's `caption.words`. */
  words: WordHighlight[]
}

/** A fully-inactive word entry (no color, unit scale, no wipe). */
function inactiveWord(): WordHighlight {
  return { active: false, color: undefined, scale: 1, wipeProgress: 0 }
}

/** Clamp a number into [0,1]. */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * The index of the SPOKEN word whose half-open `[start, end)` contains `t`, or -1
 * if none (before all words, after all words, or in a gap between words). PURE.
 * Half-open so a word turns on exactly at its `start` and off exactly at its
 * `end` — the boundary instant belongs to the NEXT word, giving a crisp,
 * frame-stable transition. Words are assumed ordered; the first match wins (a
 * tiny overlap from rounding resolves to the earlier word, which is harmless).
 *
 * CUE EXCLUSION (P5.7): bracketed sound-effect cues (`kind: 'cue'`, e.g.
 * `[applause]`) are NOT speech, so the playhead must never select them. A cue's
 * interval is SKIPPED: sweeping the playhead across a cue yields no active word
 * (the cue is never highlighted, and a neighbouring spoken word is not wrongly
 * chosen). Only spoken words are eligible to be active.
 */
export function activeWordIndex(words: readonly CaptionWord[], t: number): number {
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (isCueWord(w)) continue
    if (t >= w.start && t < w.end) return i
  }
  return -1
}

/**
 * Eased `wholeWord` scale at time `t` for a word spanning `[start,end)`. Ramps
 * base(1) → `activeScale` over `easeWindowSec` after `start`, holds `activeScale`
 * through the middle, then ramps back to 1 over `easeWindowSec` before `end`. With
 * `easeWindowSec <= 0` (or a word shorter than two windows) it snaps to
 * `activeScale` for the whole word. PURE.
 */
function wholeWordScale(
  start: number,
  end: number,
  t: number,
  activeScale: number,
  easeWindowSec: number
): number {
  if (easeWindowSec <= 0) return activeScale
  const dur = end - start
  // Too short to fit an in+out ramp → just hold the active scale.
  if (dur <= easeWindowSec * 2) return activeScale
  const sinceStart = t - start
  const untilEnd = end - t
  let p = 1
  if (sinceStart < easeWindowSec) p = applyEasing(sinceStart / easeWindowSec, 'easeOut')
  else if (untilEnd < easeWindowSec) p = applyEasing(untilEnd / easeWindowSec, 'easeOut')
  // p in [0,1]: 0 at the boundary, 1 at full pop → interpolate 1 → activeScale.
  return 1 + (activeScale - 1) * clamp01(p)
}

/**
 * Grapheme-quantized wipe progress for the active word at time `t`. The raw
 * linear fraction `(t-start)/(end-start)` is snapped to a whole number of leading
 * grapheme CLUSTERS over the word's cluster count, then re-expressed as a 0..1
 * fraction — so the wipe advances one Indic cluster at a time (never mid-conjunct)
 * and reads 0 at `start`, 1 at `end`. PURE; cluster-safe.
 */
export function wipeProgressAt(word: CaptionWord, t: number): number {
  const total = splitGraphemes(word.text).length
  if (total === 0) return 0
  const dur = word.end - word.start
  if (dur <= 0) return 1
  const raw = clamp01((t - word.start) / dur)
  // round to a whole cluster boundary so the fill steps cluster-by-cluster.
  const filled = Math.round(raw * total)
  return filled / total
}

/** Inputs to {@link evaluateClipHighlight} that the caller resolves off the clip + preset. */
export interface EvaluateHighlightOptions {
  /** The clip's per-word timing (`clip.caption.words`), in absolute seconds. */
  words: readonly CaptionWord[]
  /**
   * The highlight config from the ACTIVE preset (looked up by `captions.styleId`).
   * Absent or `enabled === false` → no active word (every entry inactive).
   */
  highlight?: PresetHighlight
  /** Current playhead time, in seconds (absolute timeline reference). */
  t: number
  /**
   * `wholeWord` ease window length; defaults to {@link HIGHLIGHT_EASE_WINDOW_SEC}.
   * Pass 0 to snap the scale/color exactly at the word boundary (no ramp).
   */
  easeWindowSec?: number
}

/**
 * PURE active-word highlight evaluator: returns, for a caption clip at playhead
 * time `t`, which word is active and each word's animated color + scale (+ wipe
 * progress). Index-aligned to `words`. No canvas / DOM — unit-testable and reused
 * by export.
 *
 *   - highlight absent / `enabled:false` → `activeIndex: -1`, every word inactive.
 *   - otherwise → the word whose `[start,end)` contains `t` is active and adopts
 *     `activeColor`; for `wholeWord` it also scales to `activeScale` (eased near
 *     boundaries), for `wipe` it fills left-to-right (`wipeProgress` 0→1, cluster
 *     quantized). A gap between words (or before/after all words) yields no active
 *     word.
 */
export function evaluateClipHighlight(opts: EvaluateHighlightOptions): ClipHighlight {
  const { words, highlight, t } = opts
  const easeWindowSec = opts.easeWindowSec ?? HIGHLIGHT_EASE_WINDOW_SEC

  if (highlight === undefined || !highlight.enabled) {
    return { activeIndex: -1, words: words.map(() => inactiveWord()) }
  }

  const idx = activeWordIndex(words, t)
  if (idx < 0) {
    return { activeIndex: -1, words: words.map(() => inactiveWord()) }
  }

  return {
    activeIndex: idx,
    words: words.map((w, i) => {
      if (i !== idx) return inactiveWord()
      if (highlight.style === 'wipe') {
        return {
          active: true,
          color: highlight.activeColor,
          scale: 1,
          wipeProgress: wipeProgressAt(w, t)
        }
      }
      // wholeWord
      return {
        active: true,
        color: highlight.activeColor,
        scale: wholeWordScale(w.start, w.end, t, highlight.activeScale, easeWindowSec),
        wipeProgress: 0
      }
    })
  }
}

/**
 * Convenience for the `wipe` draw path: how many leading GRAPHEME CLUSTERS of a
 * word are filled given a `wipeProgress` 0..1. The canvas draws the first
 * `filledGraphemeCount` clusters in `activeColor` and the rest in the base fill,
 * so the wipe boundary always lands on a cluster edge (Indic-safe). Pure.
 */
export function filledGraphemeCount(text: string, wipeProgress: number): number {
  const total = splitGraphemes(text).length
  return Math.round(clamp01(wipeProgress) * total)
}

/**
 * Convenience: split a word into its already-wiped (left) and not-yet-wiped
 * (right) substrings at the grapheme-cluster boundary implied by `wipeProgress`.
 * The canvas paints `filled` in `activeColor` and `rest` in the base fill. Pure;
 * cluster-safe (never splits an Indic conjunct).
 */
export function splitWipe(text: string, wipeProgress: number): { filled: string; rest: string } {
  const clusters = splitGraphemes(text)
  const n = Math.round(clamp01(wipeProgress) * clusters.length)
  return { filled: clusters.slice(0, n).join(''), rest: clusters.slice(n).join('') }
}

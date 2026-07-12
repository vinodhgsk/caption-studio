/**
 * MILESTONE 5 roll-up (P5.10 — Doc 03 caption styles; skill `caption-sync`).
 *
 * This is the milestone GATE test for "one-click premium captions with animated
 * highlight." It does NOT re-run the focused unit suites (captionPreset /
 * captionPresetRegistry / captionHighlight already cover schema, registry rules,
 * and the ±1-frame highlight sweep). Instead it asserts three things ACROSS THE
 * WHOLE preset registry at once, the way a milestone sign-off would:
 *
 *   1. SNAPSHOT each preset — for every preset the gallery can show (the five
 *      built-ins from {@link listCaptionPresets} PLUS the eight lower-third /
 *      title-card category templates from {@link listCaptionCategoryTemplates}),
 *      assert a deterministic, serializable snapshot of its RESOLVED style:
 *      `presetToTextDrawSpec(preset)` (the canvas-agnostic draw spec — resolved
 *      font shorthand, fill, stroke order, shadow offsets, background box) and
 *      `captionPresetToClipStyle(preset)` (the clip-side stamp P5.4 applies).
 *      This catches accidental drift in ANY preset's resolved look without
 *      touching canvas pixels.
 *
 *   2. ACTIVE-WORD index vs transcript at sampled times — build a known
 *      transcript and, for the highlight-bearing presets (tiktok-classic /
 *      karaoke-highlight / pop-by-word, plus the bounce built-in), assert that
 *      `evaluateClipHighlight` reports the EXPECTED transcript word at several
 *      sampled times (incl. the `[start,end)` boundaries and the before/after/gap
 *      cases). Presets with `highlight.enabled === false` (typewriter + every
 *      lower-third / title-card template) must NEVER produce an active word.
 *
 *   3. VALIDATION roll-up — every preset in the whole registry passes
 *      {@link validateCaptionPreset}.
 *
 * Deterministic + pure: a fixed transcript, no real audio, no canvas pixels. The
 * snapshot is structural data (toMatchSnapshot), written on first run.
 */
import { afterEach, describe, expect, it } from 'vitest'

import {
  validateCaptionPreset,
  captionPresetToClipStyle,
  type CaptionPreset
} from '../../../shared/captionPreset'
import type { CaptionWord } from '../../../shared/project-schema'
import {
  listCaptionPresets,
  isBuiltInPreset,
  unregisterCaptionPreset,
  PRESET_SARVAM_BHAKTI_GOLD,
  PRESET_SARVAM_BHAKTI_GOLD_3D,
  PRESET_TIKTOK_CLASSIC,
  PRESET_KARAOKE_HIGHLIGHT,
  PRESET_POP_BY_WORD,
  PRESET_BOUNCE,
  PRESET_TYPEWRITER,
  PRESET_BHAKTHI_GOLD,
  PRESET_GRAND_TEMPLE_GOLD
} from '../../../shared/captionPresetRegistry'
import {
  listCaptionCategoryTemplates,
  CATEGORY_TEMPLATE_IDS
} from '../../../shared/captionCategoryTemplates'
import { presetToTextDrawSpec } from '../../routes/editor/preview/captionTextRender'
import { evaluateClipHighlight, activeWordIndex } from './captionHighlight'

// CaptionWord is re-exported from the schema via the preset module's import path;
// reference the schema type directly to avoid coupling.
type Word = CaptionWord

// ---------------------------------------------------------------------------
// The complete set of presets a Milestone-5 build ships: the five immutable
// built-ins (gallery order) + the eight category templates (P5.9). Read from the
// canonical sources rather than the mutable registry so the snapshot is stable
// regardless of whether templates happen to be registered in this process.
// ---------------------------------------------------------------------------

const BUILT_INS = listCaptionPresets() // nine built-ins (no templates registered here)
const TEMPLATES = listCaptionCategoryTemplates() // eight P5.9 templates
const ALL_PRESETS: CaptionPreset[] = [...BUILT_INS, ...TEMPLATES]

// Keep the global registry clean if anything in this file ever registers a preset.
afterEach(() => {
  for (const p of listCaptionPresets()) {
    if (!isBuiltInPreset(p.id)) unregisterCaptionPreset(p.id)
  }
})

describe('P5.10 — registry inventory is the expected Milestone-5 set', () => {
  it('built-ins are the shipped caption styles, in gallery order (Sarvam Bhakti Gold 3D leads)', () => {
    expect(BUILT_INS.map((p) => p.id)).toEqual([
      PRESET_SARVAM_BHAKTI_GOLD_3D,
      PRESET_SARVAM_BHAKTI_GOLD,
      PRESET_TIKTOK_CLASSIC,
      PRESET_KARAOKE_HIGHLIGHT,
      PRESET_POP_BY_WORD,
      PRESET_BOUNCE,
      PRESET_TYPEWRITER,
      PRESET_BHAKTHI_GOLD,
      PRESET_GRAND_TEMPLE_GOLD
    ])
  })

  it('category templates are the eight P5.9 lower-third / title-card presets', () => {
    expect(TEMPLATES.map((p) => p.id)).toEqual([...CATEGORY_TEMPLATE_IDS])
  })

  it('the roll-up covers 17 presets total (9 built-ins + 8 templates)', () => {
    expect(ALL_PRESETS).toHaveLength(17)
    // No duplicate ids across the whole inventory.
    expect(new Set(ALL_PRESETS.map((p) => p.id)).size).toBe(17)
  })
})

// ---------------------------------------------------------------------------
// REQUIREMENT 3 — every preset validates (whole-registry roll-up).
// ---------------------------------------------------------------------------

describe('P5.10 — every preset passes validateCaptionPreset (roll-up)', () => {
  it.each(ALL_PRESETS.map((p) => [p.id, p] as const))(
    'preset %s validates',
    (_id, preset) => {
      const res = validateCaptionPreset(preset)
      // Surface the issues in the failure message if it ever regresses.
      expect(res.ok ? [] : res.issues).toEqual([])
      expect(res.ok).toBe(true)
    }
  )
})

// ---------------------------------------------------------------------------
// REQUIREMENT 1 — snapshot each preset's RESOLVED style (deterministic, no pixels).
// ---------------------------------------------------------------------------

describe('P5.10 — resolved draw-spec snapshot per preset (drift guard)', () => {
  it.each(ALL_PRESETS.map((p) => [p.id, p] as const))(
    'presetToTextDrawSpec(%s) is stable',
    (id, preset) => {
      // The flat, canvas-agnostic spec: resolved font shorthand + fallback chain,
      // fill descriptor (solid rgba / gradient stops), stroke layers (widest
      // first), shadow offsets derived from angle+distance, background box rgba.
      const spec = presetToTextDrawSpec(preset)
      expect(spec).toMatchSnapshot(`draw-spec:${id}`)
    }
  )
})

describe('P5.10 — resolved clip-style snapshot per preset (P5.4 stamp drift guard)', () => {
  it.each(ALL_PRESETS.map((p) => [p.id, p] as const))(
    'captionPresetToClipStyle(%s) is stable',
    (id, preset) => {
      // What "apply preset to track" stamps onto each caption clip: text.*,
      // animation (in/out/loop/reveal), and the transform y patch from the anchor.
      const clipStyle = captionPresetToClipStyle(preset)
      expect(clipStyle).toMatchSnapshot(`clip-style:${id}`)
    }
  )
})

// ---------------------------------------------------------------------------
// REQUIREMENT 2 — active-word index vs a KNOWN transcript at sampled times.
// ---------------------------------------------------------------------------

/**
 * A deterministic, contiguous transcript (no gaps) — five spoken words spanning
 * [0.50, 3.00). Word boundaries are chosen so the sampled times below land
 * unambiguously inside a single word and exactly on `[start,end)` edges.
 */
const TRANSCRIPT: Word[] = [
  { text: 'one', start: 0.5, end: 1.0 },
  { text: 'two', start: 1.0, end: 1.5 },
  { text: 'three', start: 1.5, end: 2.0 },
  { text: 'four', start: 2.0, end: 2.5 },
  { text: 'five', start: 2.5, end: 3.0 }
]

/** A transcript with a GAP between word 1 and word 2 ([1.0,1.4) is silence). */
const GAPPED: Word[] = [
  { text: 'gap-a', start: 0.5, end: 1.0 },
  { text: 'gap-b', start: 1.4, end: 2.0 }
]

/** Each (time → expected active word index) sample we assert for the contiguous transcript. */
const SAMPLES: Array<{ t: number; idx: number; why: string }> = [
  { t: 0.0, idx: -1, why: 'before the first word' },
  { t: 0.49, idx: -1, why: 'just before word 0 starts' },
  { t: 0.5, idx: 0, why: 'exactly word 0 start (inclusive)' },
  { t: 0.75, idx: 0, why: 'mid word 0' },
  { t: 1.0, idx: 1, why: 'word 0 end == word 1 start → next word (half-open)' },
  { t: 1.25, idx: 1, why: 'mid word 1' },
  { t: 1.5, idx: 2, why: 'word 1 end == word 2 start → word 2' },
  { t: 1.99, idx: 2, why: 'just before word 2 end' },
  { t: 2.0, idx: 3, why: 'word 2 end == word 3 start → word 3' },
  { t: 2.5, idx: 4, why: 'word 3 end == word 4 start → word 4' },
  { t: 2.99, idx: 4, why: 'just before the last word ends' },
  { t: 3.0, idx: -1, why: 'exactly the last word end (exclusive) → none' },
  { t: 5.0, idx: -1, why: 'after the line' }
]

/** The highlight-bearing presets, looked up by id from the built-ins. */
function builtIn(id: string): CaptionPreset {
  const p = BUILT_INS.find((x) => x.id === id)
  if (p === undefined) throw new Error(`built-in ${id} missing from inventory`)
  return p
}

const HIGHLIGHT_ENABLED_IDS = [
  PRESET_TIKTOK_CLASSIC,
  PRESET_KARAOKE_HIGHLIGHT,
  PRESET_POP_BY_WORD,
  PRESET_BOUNCE
]

describe('P5.10 — active-word index vs transcript at sampled times (highlight presets)', () => {
  // Sanity: the raw selector and the evaluator agree for an enabled preset.
  it('evaluateClipHighlight.activeIndex == activeWordIndex for an enabled preset', () => {
    const hl = builtIn(PRESET_TIKTOK_CLASSIC).highlight
    for (const { t } of SAMPLES) {
      expect(evaluateClipHighlight({ words: TRANSCRIPT, highlight: hl, t }).activeIndex).toBe(
        activeWordIndex(TRANSCRIPT, t)
      )
    }
  })

  for (const id of HIGHLIGHT_ENABLED_IDS) {
    describe(`preset ${id}`, () => {
      const hl = builtIn(id).highlight

      it('highlight is enabled for this preset', () => {
        expect(hl.enabled).toBe(true)
      })

      it.each(SAMPLES.map((s) => [s.t, s.idx, s.why] as const))(
        't=%s → active word index %s (%s)',
        (t, expectedIdx) => {
          const res = evaluateClipHighlight({ words: TRANSCRIPT, highlight: hl, t })
          expect(res.activeIndex).toBe(expectedIdx)
          // The expected transcript word is the active one (or none when -1), and
          // at most ONE word is ever marked active.
          const activeCount = res.words.filter((w) => w.active).length
          expect(activeCount).toBe(expectedIdx === -1 ? 0 : 1)
          if (expectedIdx >= 0) {
            expect(res.words[expectedIdx].active).toBe(true)
            // The active word adopts the preset's highlight color (per-word fill).
            expect(res.words[expectedIdx].color).toBe(hl.activeColor)
          }
        }
      )

      it('a gap between words yields no active word; both endpoints behave half-open', () => {
        // mid-gap, exact end of word a, and exact start of word b
        expect(evaluateClipHighlight({ words: GAPPED, highlight: hl, t: 1.2 }).activeIndex).toBe(-1)
        expect(evaluateClipHighlight({ words: GAPPED, highlight: hl, t: 1.0 }).activeIndex).toBe(-1)
        expect(evaluateClipHighlight({ words: GAPPED, highlight: hl, t: 1.4 }).activeIndex).toBe(1)
      })
    })
  }
})

// ---------------------------------------------------------------------------
// REQUIREMENT 2 (negative) — highlight.enabled === false → never an active word.
// ---------------------------------------------------------------------------

const HIGHLIGHT_DISABLED = ALL_PRESETS.filter((p) => p.highlight.enabled === false)

describe('P5.10 — highlight-disabled presets never produce an active word', () => {
  it('typewriter + all 8 category templates have highlight disabled', () => {
    expect(HIGHLIGHT_DISABLED.map((p) => p.id).sort()).toEqual(
      [PRESET_TYPEWRITER, ...CATEGORY_TEMPLATE_IDS].sort()
    )
  })

  it.each(HIGHLIGHT_DISABLED.map((p) => [p.id, p] as const))(
    'preset %s yields activeIndex -1 at every sampled time, even inside a word',
    (_id, preset) => {
      for (const { t } of SAMPLES) {
        const res = evaluateClipHighlight({ words: TRANSCRIPT, highlight: preset.highlight, t })
        expect(res.activeIndex).toBe(-1)
        expect(res.words.every((w) => !w.active)).toBe(true)
      }
    }
  )
})

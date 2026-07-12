/**
 * Lower-third + title-card category templates (P5.9 — Doc 03 §"Lower-thirds and
 * title-card category presets (Game/Tech/Sports/Trending)"; skills `text-render`
 * + `preview-compositor`).
 *
 * Doc 03 calls for non-spoken OVERLAY presets — lower thirds (a name/title strip
 * anchored LOW) and title cards (a big centered/upper headline) — themed into the
 * four buckets Game / Tech / Sports / Trending, each with its own layout anchor
 * and ENTRANCE animation. These are NOT a new render model: they are ordinary
 * {@link CaptionPreset}s (category `lower-third` / `title-card`, with the optional
 * `group` set to the theme) so they:
 *   - validate via {@link validateCaptionPreset},
 *   - show up in the P5.3 gallery via {@link listCaptionPresets} once registered,
 *   - apply to the track with the SAME P5.4 machinery (stamp styleId + style +
 *     anchor via {@link captionPresetToClipStyle}) as any caption preset.
 *
 * Distinct visual identity per theme (color / font / background) keeps the
 * thumbnails recognizable; lower thirds SLIDE in (slide-up / slide-left) and
 * title cards ZOOM / SCALE in, matching the look Doc 03 describes.
 *
 * Registration is via the existing extension hook ({@link registerCaptionPreset})
 * — these templates are NOT built-ins (the five Doc 03 caption built-ins stay
 * exactly five), so their ids must not collide with the built-ins. Call
 * {@link registerCaptionCategoryTemplates} once at startup (it is IDEMPOTENT).
 *
 * Headless-safe: pure data + pure helpers; NO electron/node/DOM.
 */
import {
  DEFAULT_CAPTION_FONT_FALLBACK,
  parseCaptionPreset,
  type CaptionPreset,
  type CaptionPresetCategory,
  type CaptionPresetGroup
} from './captionPreset'
import {
  getCaptionPreset,
  isBuiltInPreset,
  registerCaptionPreset
} from './captionPresetRegistry'

/** Shared Indic-first fallback chain (Tamil default) — every template uses it. */
const FALLBACK = (): string[] => [...DEFAULT_CAPTION_FONT_FALLBACK]

/** Indic-capable display family used by the heavier title-card headlines. */
const DISPLAY_FAMILY = 'Noto Sans Tamil'

// ---------------------------------------------------------------------------
// Template ids — stable, recorded on the project as `captions.styleId`. Prefixed
// by category so they NEVER collide with the five caption built-ins.
// ---------------------------------------------------------------------------

export const LOWER_THIRD_GAME = 'lower-third-game'
export const LOWER_THIRD_TECH = 'lower-third-tech'
export const LOWER_THIRD_SPORTS = 'lower-third-sports'
export const LOWER_THIRD_TRENDING = 'lower-third-trending'

export const TITLE_CARD_GAME = 'title-card-game'
export const TITLE_CARD_TECH = 'title-card-tech'
export const TITLE_CARD_SPORTS = 'title-card-sports'
export const TITLE_CARD_TRENDING = 'title-card-trending'

/** All P5.9 template ids, in gallery display order (lower thirds, then cards). */
export const CATEGORY_TEMPLATE_IDS = [
  LOWER_THIRD_GAME,
  LOWER_THIRD_TECH,
  LOWER_THIRD_SPORTS,
  LOWER_THIRD_TRENDING,
  TITLE_CARD_GAME,
  TITLE_CARD_TECH,
  TITLE_CARD_SPORTS,
  TITLE_CARD_TRENDING
] as const

// ---------------------------------------------------------------------------
// Lower thirds — anchor LOW; SLIDE-in entrance; reveal:none + no active-word
// highlight (these are overlays, not spoken subtitles, so word timing/highlight
// is disabled). A background strip gives the classic lower-third bar.
// ---------------------------------------------------------------------------

/** Game lower third — neon green on near-black, magenta keyline, slide up. */
function lowerThirdGame(): CaptionPreset {
  return {
    id: LOWER_THIRD_GAME,
    displayName: 'Game · Lower Third',
    category: 'lower-third',
    group: 'game',
    font: {
      family: DISPLAY_FAMILY,
      size: 40,
      weight: 800,
      italic: false,
      letterSpacing: 0.5,
      lineHeight: 1.2,
      fallback: FALLBACK()
    },
    fill: { type: 'solid', value: '#39ff14', opacity: 1, perWord: false },
    stroke: [{ color: '#0a0a0a', width: 2 }],
    shadow: { color: '#ff00d4', opacity: 0.55, blur: 10, angle: 90, distance: 0, inner: false, long: false },
    decoration: { background: { color: '#0a0e14', opacity: 0.8, padding: 16, radius: 8 } },
    animation: {
      in: { preset: 'slide-up', durationSec: 0.35, easing: 'easeOut' },
      out: { preset: 'slide-down', durationSec: 0.25, easing: 'easeIn' },
      reveal: { mode: 'none', staggerSec: 0, easing: 'linear' }
    },
    layout: { anchor: 'lower-third', safeMargin: true, maxLines: 2 },
    highlight: { enabled: false, activeColor: '#39ff14', activeScale: 1, style: 'wholeWord' }
  }
}

/** Tech lower third — clean cyan on slate, subtle, slides in from the left. */
function lowerThirdTech(): CaptionPreset {
  return {
    id: LOWER_THIRD_TECH,
    displayName: 'Tech · Lower Third',
    category: 'lower-third',
    group: 'tech',
    font: {
      family: DISPLAY_FAMILY,
      size: 38,
      weight: 600,
      italic: false,
      letterSpacing: 1.5,
      lineHeight: 1.25,
      fallback: FALLBACK()
    },
    fill: { type: 'solid', value: '#e6f7ff', opacity: 1, perWord: false },
    shadow: { color: '#00b3ff', opacity: 0.4, blur: 8, angle: 90, distance: 0, inner: false, long: false },
    decoration: { background: { color: '#101826', opacity: 0.85, padding: 18, radius: 4 } },
    animation: {
      in: { preset: 'slide-left', durationSec: 0.3, easing: 'easeOut' },
      out: { preset: 'fade', durationSec: 0.2, easing: 'easeIn' },
      reveal: { mode: 'none', staggerSec: 0, easing: 'linear' }
    },
    layout: { anchor: 'lower-third', safeMargin: true, maxLines: 2 },
    highlight: { enabled: false, activeColor: '#00b3ff', activeScale: 1, style: 'wholeWord' }
  }
}

/** Sports lower third — bold white on a red bar, fast slide up. */
function lowerThirdSports(): CaptionPreset {
  return {
    id: LOWER_THIRD_SPORTS,
    displayName: 'Sports · Lower Third',
    category: 'lower-third',
    group: 'sports',
    font: {
      family: DISPLAY_FAMILY,
      size: 42,
      weight: 900,
      italic: true,
      letterSpacing: 0,
      lineHeight: 1.15,
      fallback: FALLBACK()
    },
    fill: { type: 'solid', value: '#ffffff', opacity: 1, perWord: false },
    stroke: [{ color: '#000000', width: 2 }],
    shadow: { color: '#000000', opacity: 0.5, blur: 6, angle: 90, distance: 3, inner: false, long: false },
    decoration: { background: { color: '#d50000', opacity: 0.92, padding: 16, radius: 6 } },
    animation: {
      in: { preset: 'slide-up', durationSec: 0.25, easing: 'easeOut' },
      out: { preset: 'slide-down', durationSec: 0.2, easing: 'easeIn' },
      reveal: { mode: 'none', staggerSec: 0, easing: 'linear' }
    },
    layout: { anchor: 'lower-third', safeMargin: true, maxLines: 2 },
    highlight: { enabled: false, activeColor: '#ffea00', activeScale: 1, style: 'wholeWord' }
  }
}

/** Trending lower third — gradient pink→orange on dark, slides in from left. */
function lowerThirdTrending(): CaptionPreset {
  return {
    id: LOWER_THIRD_TRENDING,
    displayName: 'Trending · Lower Third',
    category: 'lower-third',
    group: 'trending',
    font: {
      family: DISPLAY_FAMILY,
      size: 40,
      weight: 800,
      italic: false,
      letterSpacing: 0.5,
      lineHeight: 1.2,
      fallback: FALLBACK()
    },
    fill: {
      type: 'gradient',
      value: [
        { offset: 0, color: '#ff2d8b' },
        { offset: 1, color: '#ff8a00' }
      ],
      opacity: 1,
      perWord: false
    },
    shadow: { color: '#000000', opacity: 0.5, blur: 10, angle: 90, distance: 2, inner: false, long: false },
    decoration: { background: { color: '#15080f', opacity: 0.78, padding: 16, radius: 14 } },
    animation: {
      in: { preset: 'slide-left', durationSec: 0.32, easing: 'easeOut' },
      out: { preset: 'fade', durationSec: 0.2, easing: 'easeIn' },
      reveal: { mode: 'none', staggerSec: 0, easing: 'linear' }
    },
    layout: { anchor: 'lower-third', safeMargin: true, maxLines: 2 },
    highlight: { enabled: false, activeColor: '#ff2d8b', activeScale: 1, style: 'wholeWord' }
  }
}

// ---------------------------------------------------------------------------
// Title cards — anchor CENTER/TOP; ZOOM/SCALE-in entrance; big headline.
// reveal:none + highlight disabled (a title card is a single beat, not spoken).
// ---------------------------------------------------------------------------

/** Game title card — neon green headline, magenta glow, zoom in (center). */
function titleCardGame(): CaptionPreset {
  return {
    id: TITLE_CARD_GAME,
    displayName: 'Game · Title Card',
    category: 'title-card',
    group: 'game',
    font: {
      family: DISPLAY_FAMILY,
      size: 88,
      weight: 900,
      italic: false,
      letterSpacing: 1,
      lineHeight: 1.1,
      fallback: FALLBACK()
    },
    fill: { type: 'solid', value: '#39ff14', opacity: 1, perWord: false },
    stroke: [{ color: '#0a0a0a', width: 5 }],
    shadow: { color: '#ff00d4', opacity: 0.7, blur: 24, angle: 90, distance: 0, inner: false, long: false },
    animation: {
      in: { preset: 'zoom-in', durationSec: 0.45, easing: 'spring' },
      out: { preset: 'fade', durationSec: 0.25, easing: 'easeIn' },
      reveal: { mode: 'none', staggerSec: 0, easing: 'linear' }
    },
    layout: { anchor: 'center', safeMargin: true, maxLines: 3 },
    highlight: { enabled: false, activeColor: '#39ff14', activeScale: 1, style: 'wholeWord' }
  }
}

/** Tech title card — minimal cyan headline, wide tracking, scale up (center). */
function titleCardTech(): CaptionPreset {
  return {
    id: TITLE_CARD_TECH,
    displayName: 'Tech · Title Card',
    category: 'title-card',
    group: 'tech',
    font: {
      family: DISPLAY_FAMILY,
      size: 80,
      weight: 700,
      italic: false,
      letterSpacing: 4,
      lineHeight: 1.15,
      fallback: FALLBACK()
    },
    fill: { type: 'solid', value: '#e6f7ff', opacity: 1, perWord: false },
    shadow: { color: '#00b3ff', opacity: 0.55, blur: 18, angle: 90, distance: 0, inner: false, long: false },
    animation: {
      in: { preset: 'scale-up', durationSec: 0.4, easing: 'easeOut' },
      out: { preset: 'fade', durationSec: 0.25, easing: 'easeIn' },
      reveal: { mode: 'none', staggerSec: 0, easing: 'linear' }
    },
    layout: { anchor: 'center', safeMargin: true, maxLines: 3 },
    highlight: { enabled: false, activeColor: '#00b3ff', activeScale: 1, style: 'wholeWord' }
  }
}

/** Sports title card — bold italic white on red, punchy zoom in (center). */
function titleCardSports(): CaptionPreset {
  return {
    id: TITLE_CARD_SPORTS,
    displayName: 'Sports · Title Card',
    category: 'title-card',
    group: 'sports',
    font: {
      family: DISPLAY_FAMILY,
      size: 92,
      weight: 900,
      italic: true,
      letterSpacing: 0,
      lineHeight: 1.1,
      fallback: FALLBACK()
    },
    fill: { type: 'solid', value: '#ffffff', opacity: 1, perWord: false },
    stroke: [{ color: '#d50000', width: 6 }],
    shadow: { color: '#000000', opacity: 0.6, blur: 14, angle: 90, distance: 4, inner: false, long: false },
    animation: {
      in: { preset: 'zoom-in', durationSec: 0.3, easing: 'easeOut' },
      out: { preset: 'fade', durationSec: 0.2, easing: 'easeIn' },
      reveal: { mode: 'none', staggerSec: 0, easing: 'linear' }
    },
    layout: { anchor: 'center', safeMargin: true, maxLines: 3 },
    highlight: { enabled: false, activeColor: '#ffea00', activeScale: 1, style: 'wholeWord' }
  }
}

/** Trending title card — gradient pink→orange headline, scale up, anchored upper. */
function titleCardTrending(): CaptionPreset {
  return {
    id: TITLE_CARD_TRENDING,
    displayName: 'Trending · Title Card',
    category: 'title-card',
    group: 'trending',
    font: {
      family: DISPLAY_FAMILY,
      size: 84,
      weight: 900,
      italic: false,
      letterSpacing: 1,
      lineHeight: 1.1,
      fallback: FALLBACK()
    },
    fill: {
      type: 'gradient',
      value: [
        { offset: 0, color: '#ff2d8b' },
        { offset: 1, color: '#ff8a00' }
      ],
      opacity: 1,
      perWord: false
    },
    stroke: [{ color: '#1a0610', width: 3 }],
    shadow: { color: '#000000', opacity: 0.5, blur: 20, angle: 90, distance: 2, inner: false, long: false },
    animation: {
      in: { preset: 'scale-up', durationSec: 0.42, easing: 'spring' },
      out: { preset: 'fade', durationSec: 0.25, easing: 'easeIn' },
      reveal: { mode: 'none', staggerSec: 0, easing: 'linear' }
    },
    layout: { anchor: 'top', safeMargin: true, maxLines: 3 },
    highlight: { enabled: false, activeColor: '#ff2d8b', activeScale: 1, style: 'wholeWord' }
  }
}

// ---------------------------------------------------------------------------
// Factory table + eager self-validation
// ---------------------------------------------------------------------------

/**
 * Canonical template factories — each read returns a FRESH object so a caller can
 * never mutate a shared definition. Order is gallery display order.
 */
const TEMPLATE_FACTORIES: Record<string, () => CaptionPreset> = {
  [LOWER_THIRD_GAME]: lowerThirdGame,
  [LOWER_THIRD_TECH]: lowerThirdTech,
  [LOWER_THIRD_SPORTS]: lowerThirdSports,
  [LOWER_THIRD_TRENDING]: lowerThirdTrending,
  [TITLE_CARD_GAME]: titleCardGame,
  [TITLE_CARD_TECH]: titleCardTech,
  [TITLE_CARD_SPORTS]: titleCardSports,
  [TITLE_CARD_TRENDING]: titleCardTrending
}

/** Validate every template ONCE at module load — a bad template fails loudly. */
for (const id of CATEGORY_TEMPLATE_IDS) {
  parseCaptionPreset(TEMPLATE_FACTORIES[id]())
}

/**
 * The eight P5.9 templates as fresh CaptionPresets (lower thirds then title
 * cards), independent of registry state. Useful for the panel/tests to read the
 * canonical set without depending on registration order.
 */
export function listCaptionCategoryTemplates(): CaptionPreset[] {
  return CATEGORY_TEMPLATE_IDS.map((id) => TEMPLATE_FACTORIES[id]())
}

// ---------------------------------------------------------------------------
// Registration into the shared registry (so the P5.3 gallery shows them)
// ---------------------------------------------------------------------------

/**
 * Register all P5.9 lower-third + title-card templates into the shared registry
 * via {@link registerCaptionPreset}. IDEMPOTENT — a template already present
 * (duplicate-id) is skipped, so calling this more than once (e.g. multiple
 * renderer entry points) is safe. Returns the ids that were newly registered.
 * After this runs, the templates are visible to {@link listCaptionPresets} and
 * applyable via the standard P5.4 path (they resolve through `getCaptionPreset`).
 *
 * Built-in id collisions are impossible (template ids are category-prefixed), but
 * we assert it so a future rename can't silently shadow a built-in.
 */
export function registerCaptionCategoryTemplates(): string[] {
  const added: string[] = []
  for (const id of CATEGORY_TEMPLATE_IDS) {
    if (isBuiltInPreset(id)) {
      throw new Error(`category template id "${id}" collides with a built-in preset id`)
    }
    if (getCaptionPreset(id) !== undefined) continue // already registered
    const res = registerCaptionPreset(TEMPLATE_FACTORIES[id]())
    if (!res.ok && res.reason !== 'duplicate-id') {
      throw new Error(`failed to register category template "${id}": ${res.message}`)
    }
    if (res.ok) added.push(id)
  }
  return added
}

// ---------------------------------------------------------------------------
// Category / group grouping (for the panel's headings)
// ---------------------------------------------------------------------------

/** A category section with its themed sub-groups, for panel rendering. */
export interface PresetCategorySection {
  category: CaptionPresetCategory
  /** Presets in this category, bucketed by their `group` (themed) heading. */
  groups: Array<{ group: CaptionPresetGroup | 'ungrouped'; presets: CaptionPreset[] }>
}

/** Stable display order of the overlay categories and themed groups. */
const CATEGORY_ORDER: CaptionPresetCategory[] = ['caption', 'lower-third', 'title-card']
const GROUP_ORDER: Array<CaptionPresetGroup | 'ungrouped'> = [
  'game',
  'tech',
  'sports',
  'trending',
  'ungrouped'
]

/**
 * Group an arbitrary preset list (e.g. {@link listCaptionPresets}) into ordered
 * category sections, each split into themed sub-groups (Game/Tech/Sports/
 * Trending) plus an `ungrouped` bucket for presets without a `group`. Empty
 * sections/groups are omitted so the panel only renders headings that have cards.
 * PURE — does not read the registry itself; the caller passes the list in.
 */
export function groupPresetsByCategory(presets: CaptionPreset[]): PresetCategorySection[] {
  const sections: PresetCategorySection[] = []
  for (const category of CATEGORY_ORDER) {
    const inCat = presets.filter((p) => p.category === category)
    if (inCat.length === 0) continue
    const groups: PresetCategorySection['groups'] = []
    for (const group of GROUP_ORDER) {
      const inGroup = inCat.filter((p) => (p.group ?? 'ungrouped') === group)
      if (inGroup.length === 0) continue
      groups.push({ group, presets: inGroup })
    }
    sections.push({ category, groups })
  }
  return sections
}

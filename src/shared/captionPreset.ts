/**
 * CaptionPreset schema (P5.1 — Doc 03 caption styles; skill `text-render`).
 *
 * A `CaptionPreset` is a NAMED, REUSABLE caption style. A preset is what the
 * caption preset gallery (P5.3) shows a thumbnail for, what "apply to track"
 * (P5.4) stamps onto every caption clip, and what drives word-by-word reveal
 * (P5.5) and active-word highlight (P5.6). One preset id is recorded on the
 * project as `captions.styleId` (Doc 00 §4) so a re-open knows which preset the
 * caption track currently wears.
 *
 * PARITY WITH text-render + project-schema
 * ----------------------------------------
 * A preset is NOT a new render model. Its visual fields are the SAME shapes the
 * text-render skill consumes and the SAME shapes a caption clip carries on its
 * `clip.text.*` surface (Doc 00 §4, project-schema `ClipText`):
 *   - fill    `{ type, value, opacity }`           (solid | gradient)
 *   - stroke  `[{ color, width }]`                 (stackable layers)
 *   - shadow  `{ color, opacity, blur, angle, distance, inner, long }`
 *   - decoration `{ background, underline, strike, highlight }`
 *   - animation `{ in, out, loop, reveal }`        (preset id + duration/easing)
 * So preview AND export read ONE shape (master plan §6 parity), and P5.4's
 * preset->clip mapping is a near-direct copy (see {@link captionPresetToClipStyle}).
 *
 * The preset ADDS, on top of the clip-style fields, the things a *style preset*
 * needs that a single clip does not store: `id`/`displayName`/`category` (gallery
 * identity), `layout` (where the caption sits + safe-margin behavior), and
 * `highlight` (how the active word and word reveal behave). These are applied by
 * P5.4 to `clip.transform`/`clip.animation` and consumed live by P5.5/P5.6.
 *
 * Headless-safe: pure types + pure helpers ONLY. NO electron / node / DOM /
 * crypto / Date here, so the renderer (gallery, preview), a node/vitest engine,
 * and the export path all import this identically.
 */
import type { ClipText, ClipAnimation, ClipTransform } from './project-schema'
import { DEFAULT_FONT_FAMILY, defaultFallbackChain } from './fontRegistry'
import type { TextEffect } from './textEffect'

// ---------------------------------------------------------------------------
// Visual sub-shapes — mirror text-render / project-schema verbatim so a preset
// field drops straight onto `clip.text.*` with no remapping.
// ---------------------------------------------------------------------------

/** Fill: a flat color, or a gradient of stops. Mirrors text-render `fill`. */
export interface PresetFill {
  /** `solid` → `value` is a hex color; `gradient` → `value` is the stop list. */
  type: 'solid' | 'gradient'
  /** `#rrggbb`/`#rgb` for solid; ordered stops for gradient. */
  value: string | GradientStop[]
  /** 0..1 master opacity of the fill. */
  opacity: number
  /**
   * Gradient direction in degrees (text-render `fill.angle`, P6.8): 0 = left→right,
   * 90 = top→bottom, etc. Only meaningful for a `gradient` fill; omitted defaults
   * to 0 in the renderer. A metallic top-lit look wants 90 (bright rim at the top
   * of each glyph rolling down to the deep base). OPTIONAL + additive.
   */
  angle?: number
  /**
   * When true, the active word may take its OWN fill (the highlight color).
   * Per-word fill is realized at render time from `highlight.activeColor`; this
   * flag tells the renderer the preset opts into per-word fill overrides
   * (text-render "fill … per-word"). Optional; defaults to false.
   */
  perWord?: boolean
}

/** A single gradient color stop (offset 0..1 → hex color). */
export interface GradientStop {
  offset: number
  color: string
}

/** One stroke layer. Mirrors text-render `stroke[]`; presets allow >1 (stacking). */
export interface PresetStrokeLayer {
  color: string
  /** Outline width in px (>= 0). */
  width: number
}

/** Drop / inner / long shadow. Mirrors text-render `shadow` verbatim. */
export interface PresetShadow {
  color: string
  /** 0..1. */
  opacity: number
  /** Blur radius px (>= 0). */
  blur: number
  /** Direction in degrees. */
  angle: number
  /** Offset distance px (>= 0). */
  distance: number
  /** Inner shadow instead of drop. */
  inner: boolean
  /** Long/extruded shadow. */
  long: boolean
}

/** Caption-box background (the rounded fill behind the text). */
export interface PresetBackgroundDecoration {
  color: string
  /** 0..1. */
  opacity: number
  /** Padding px around the text box (>= 0). */
  padding: number
  /** Corner radius px (>= 0). */
  radius: number
}

/**
 * Decoration: bubble/background box, underline, strike, and a highlight box
 * (a colored box drawn behind the *active* word — the "marker" look). Mirrors
 * text-render `decoration`. All members optional so a plain preset omits them.
 */
export interface PresetDecoration {
  background?: PresetBackgroundDecoration
  underline?: boolean
  strike?: boolean
  /** Box behind the active word (color + 0..1 opacity + corner radius px). */
  highlight?: { color: string; opacity: number; radius: number }
}

// ---------------------------------------------------------------------------
// Font
// ---------------------------------------------------------------------------

/**
 * Preset font. Mirrors `clip.text.font` (Doc 00 §4). `family` defaults to an
 * Indic-capable family so Tamil/Telugu/Malayalam/Kannada/Hindi shape correctly
 * (Doc 03 / Doc 16); `fallback` is the per-script fallback chain text-render
 * resolves against.
 */
export interface PresetFont {
  family: string
  /** Point/px size (> 0). */
  size: number
  /** Numeric weight 100..900, OR `bold`/`normal` (kept loose for parity). */
  weight: number | 'normal' | 'bold'
  italic: boolean
  /** Extra tracking px (may be negative). */
  letterSpacing: number
  /** Line-height multiple (> 0). */
  lineHeight: number
  /** Per-script fallback chain (text-render resolves the right glyph source). */
  fallback?: string[]
  /**
   * Signed curve / arc amount (P6.5 — curved/arc text): 0 = straight, positive =
   * arc bends UP (apex at the line center), negative = arc bends DOWN. Magnitude
   * (clamped to [-1, 1]) maps to arc radius/angle. OPTIONAL + additive — a preset
   * omitting it renders straight (backward compatible).
   */
  curve?: number
}

// ---------------------------------------------------------------------------
// Animation reference (in / out / loop / reveal)
// ---------------------------------------------------------------------------

/** Named easing curves shared with keyframe/animation phases. */
export type Easing =
  | 'linear'
  | 'ease'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'spring'

/**
 * A reference to an animation preset (NOT the animation implementation): a named
 * preset id + a duration + easing. Maps onto `clip.animation.{in,out,loop}`
 * (Doc 00 §4: "preset id + duration/speed"). `preset: 'none'` = no animation.
 */
export interface PresetAnimationRef {
  /** Animation-preset id (e.g. `pop`, `fadeUp`, `bounce`), or `none`. */
  preset: string
  /** Duration in seconds (>= 0). */
  durationSec: number
  easing: Easing
}

/**
 * How text is REVEALED over the clip's life (P5.5). `mode` selects the unit of
 * reveal; per Doc 03 + indic-text, per-character reveal advances by GRAPHEME
 * CLUSTER (not codepoint) so Tamil/Indic reveal correctly.
 *   - `none`       — all text visible immediately.
 *   - `word`       — word-by-word (pop-by-word / karaoke wipe).
 *   - `character`  — typewriter; advances one grapheme cluster at a time.
 * Maps onto `clip.animation.reveal` (Doc 00 §4 "reveal = kinetic mask effect").
 */
export interface PresetReveal {
  mode: 'none' | 'word' | 'character'
  /** Per-unit stagger in seconds (>= 0); 0 with `word`/`character` = use word times. */
  staggerSec: number
  easing: Easing
}

/** The in/out/loop/reveal bundle a preset carries. Maps onto `ClipAnimation`. */
export interface PresetAnimation {
  in?: PresetAnimationRef
  out?: PresetAnimationRef
  loop?: PresetAnimationRef
  reveal?: PresetReveal
}

// ---------------------------------------------------------------------------
// Layout (position anchor + safe-margin behavior)
// ---------------------------------------------------------------------------

/**
 * Where the caption block sits. `lower-third`/`center`/`top` are aspect-aware
 * anchors P5.4 resolves to a `clip.transform` offset (correct per 9:16/16:9/1:1);
 * `custom` keeps whatever transform the clip already has (manual placement).
 */
export type LayoutAnchor = 'lower-third' | 'center' | 'top' | 'custom'

/** Layout: anchor + safe-margin + line cap. */
export interface PresetLayout {
  anchor: LayoutAnchor
  /**
   * Normalized vertical offset (0..1, fraction of frame height from center) the
   * compositor applies for a `custom`/fine-tuned anchor. Optional — resolved
   * from `anchor` when omitted.
   */
  y?: number
  /** Keep text inside the title-safe area (Doc 03 "safe-margin"). */
  safeMargin: boolean
  /** Maximum caption lines (>= 1); excess wraps/clamps. */
  maxLines: number
}

// ---------------------------------------------------------------------------
// Highlight behavior (active word + reveal coupling)
// ---------------------------------------------------------------------------

/**
 * Active-word highlight (P5.6) — driven by transcript word times (`clip.caption.words`).
 * As the playhead crosses a word's `[start,end]`, that word adopts these.
 */
export interface PresetHighlight {
  /** Highlight is active for this preset (karaoke/pop). When false, no active word. */
  enabled: boolean
  /** Color the active word's fill takes (used when `fill.perWord`). */
  activeColor: string
  /** Scale multiplier of the active word (1 = no scale; > 0). */
  activeScale: number
  /**
   * How the highlight progresses across the line:
   *   - `wholeWord`  — the current word flips entirely (pop-by-word).
   *   - `wipe`       — left-to-right fill wipe within the word (karaoke).
   * Wipe advances by GRAPHEME CLUSTER for Indic correctness (indic-text).
   */
  style: 'wholeWord' | 'wipe'
}

// ---------------------------------------------------------------------------
// CaptionPreset
// ---------------------------------------------------------------------------

/**
 * Gallery category (P5.3 grouping; P5.5 lower-thirds/title cards). `caption` is
 * the spoken-subtitle group (karaoke/pop/bounce/typewriter/tiktok); the others
 * are non-spoken overlay categories with their own layout anchors.
 */
export type CaptionPresetCategory =
  | 'caption'
  | 'lower-third'
  | 'title-card'

/**
 * Optional SUB-GROUP within a category (P5.9). The lower-third / title-card
 * templates are organized into the Doc 03 themed buckets Game / Tech / Sports /
 * Trending so the Captions panel can group cards under a labeled heading inside
 * a category. `caption` presets (the spoken-subtitle styles) leave this unset.
 * Kept as a closed enum so the panel can render a stable, ordered set of group
 * headings; ADDITIVE + OPTIONAL → every pre-P5.9 preset is still valid.
 */
export type CaptionPresetGroup = 'game' | 'tech' | 'sports' | 'trending'

/**
 * A named caption style preset. REQUIRED fields are everything a render needs to
 * be unambiguous: identity (`id`, `displayName`, `category`), `font`, `fill`,
 * `layout`, `animation`, `highlight`. OPTIONAL fields are purely additive looks
 * that a minimal preset can omit: `stroke`, `shadow`, `decoration`.
 */
export interface CaptionPreset {
  /** Stable id recorded on the project as `captions.styleId` (Doc 00 §4). */
  id: string
  /** Human-readable name shown in the gallery. */
  displayName: string
  category: CaptionPresetCategory
  /**
   * Optional themed sub-group within the category (P5.9): one of
   * {@link CaptionPresetGroup} (`game`/`tech`/`sports`/`trending`). Used by the
   * panel to group lower-third / title-card cards under a heading. OPTIONAL +
   * additive — spoken-subtitle (`caption`) presets omit it and stay valid.
   */
  group?: CaptionPresetGroup
  font: PresetFont
  fill: PresetFill
  /** Stackable outline layers; omit for no stroke. */
  stroke?: PresetStrokeLayer[]
  shadow?: PresetShadow
  decoration?: PresetDecoration
  /**
   * Ordered text-effect stack stamped onto every caption clip (Doc 04 P7.1–P7.6).
   * Same shape as `clip.text.effects`. Omit for no effects. OPTIONAL + additive —
   * every pre-effects preset is still valid.
   */
  effects?: TextEffect[]
  animation: PresetAnimation
  layout: PresetLayout
  highlight: PresetHighlight
}

// ---------------------------------------------------------------------------
// Default factory
// ---------------------------------------------------------------------------

/**
 * Indic-capable default font family (renders Tamil; Doc 03 / Doc 16). Re-exported
 * from the font registry ({@link ./fontRegistry}) — the registry is the single
 * source of truth for the global default (P6.1), so the caption default cannot
 * drift from the font library's default.
 */
export const DEFAULT_CAPTION_FONT_FAMILY = DEFAULT_FONT_FAMILY

/**
 * The default per-script fallback chain for the Indic-first default family —
 * resolved from the font registry catalog so it stays consistent with the
 * library (ends in a Latin family then `sans-serif`).
 */
export const DEFAULT_CAPTION_FONT_FALLBACK = defaultFallbackChain()

/** Id of the baseline preset the default factory produces. */
export const DEFAULT_CAPTION_PRESET_ID = 'tiktok-classic'

/**
 * A well-formed baseline preset — a TikTok-classic caption (bold white body,
 * black outline, soft drop shadow, lower-third anchor, word-by-word reveal +
 * active-word highlight). Always passes {@link validateCaptionPreset}; the
 * starting point P5.2's registry clones for the other built-ins.
 */
export function defaultCaptionPreset(): CaptionPreset {
  return {
    id: DEFAULT_CAPTION_PRESET_ID,
    displayName: 'TikTok Classic',
    category: 'caption',
    font: {
      family: DEFAULT_CAPTION_FONT_FAMILY,
      size: 48,
      weight: 'bold',
      italic: false,
      letterSpacing: 0,
      lineHeight: 1.2,
      fallback: [...DEFAULT_CAPTION_FONT_FALLBACK]
    },
    fill: { type: 'solid', value: '#ffffff', opacity: 1, perWord: true },
    stroke: [{ color: '#000000', width: 4 }],
    shadow: {
      color: '#000000',
      opacity: 0.6,
      blur: 8,
      angle: 45,
      distance: 4,
      inner: false,
      long: false
    },
    animation: {
      in: { preset: 'pop', durationSec: 0.18, easing: 'easeOut' },
      reveal: { mode: 'word', staggerSec: 0, easing: 'easeOut' }
    },
    layout: { anchor: 'lower-third', safeMargin: true, maxLines: 2 },
    highlight: { enabled: true, activeColor: '#ffe600', activeScale: 1.08, style: 'wholeWord' }
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** A single validation failure: the dotted field path + a human reason. */
export interface CaptionPresetIssue {
  path: string
  message: string
}

/** Result of {@link validateCaptionPreset}. */
export type CaptionPresetValidation =
  | { ok: true; value: CaptionPreset }
  | { ok: false; issues: CaptionPresetIssue[] }

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const CATEGORIES: CaptionPresetCategory[] = ['caption', 'lower-third', 'title-card']
const GROUPS: CaptionPresetGroup[] = ['game', 'tech', 'sports', 'trending']
const EASINGS: Easing[] = ['linear', 'ease', 'easeIn', 'easeOut', 'easeInOut', 'spring']
const ANCHORS: LayoutAnchor[] = ['lower-third', 'center', 'top', 'custom']
const FILL_TYPES = ['solid', 'gradient']
const REVEAL_MODES = ['none', 'word', 'character']
const HIGHLIGHT_STYLES = ['wholeWord', 'wipe']

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}
function isStr(v: unknown): v is string {
  return typeof v === 'string'
}
function isBool(v: unknown): v is boolean {
  return typeof v === 'boolean'
}
function isHex(v: unknown): boolean {
  return isStr(v) && HEX_COLOR_RE.test(v)
}
function inRange(v: number, lo: number, hi: number): boolean {
  return v >= lo && v <= hi
}

/**
 * Validate an arbitrary value as a {@link CaptionPreset}. Returns a discriminated
 * result: `{ ok:true, value }` on success (value is the input narrowed), or
 * `{ ok:false, issues }` listing every problem (bad enum, missing required field,
 * out-of-range number, malformed color). Pure; never throws.
 *
 * REQUIRED: id, displayName, category, font, fill, animation, layout, highlight.
 * OPTIONAL: stroke, shadow, decoration, font.fallback, fill.perWord, layout.y,
 * and each of animation.{in,out,loop,reveal}.
 */
export function validateCaptionPreset(input: unknown): CaptionPresetValidation {
  const issues: CaptionPresetIssue[] = []
  const bad = (path: string, message: string) => issues.push({ path, message })

  if (!isObj(input)) {
    return { ok: false, issues: [{ path: '', message: 'preset must be an object' }] }
  }

  // identity
  if (!isStr(input.id) || input.id.length === 0) bad('id', 'required non-empty string')
  if (!isStr(input.displayName) || input.displayName.length === 0)
    bad('displayName', 'required non-empty string')
  if (!isStr(input.category) || !CATEGORIES.includes(input.category as CaptionPresetCategory))
    bad('category', `must be one of ${CATEGORIES.join('|')}`)
  if (input.group !== undefined && (!isStr(input.group) || !GROUPS.includes(input.group as CaptionPresetGroup)))
    bad('group', `must be one of ${GROUPS.join('|')} when present`)

  // font
  const font = input.font
  if (!isObj(font)) {
    bad('font', 'required object')
  } else {
    if (!isStr(font.family) || font.family.length === 0) bad('font.family', 'required non-empty string')
    if (!isNum(font.size) || font.size <= 0) bad('font.size', 'must be a number > 0')
    if (
      !(font.weight === 'normal' || font.weight === 'bold') &&
      !(isNum(font.weight) && inRange(font.weight as number, 100, 900))
    )
      bad('font.weight', "must be 'normal'|'bold' or a number 100..900")
    if (!isBool(font.italic)) bad('font.italic', 'required boolean')
    if (!isNum(font.letterSpacing)) bad('font.letterSpacing', 'required number')
    if (!isNum(font.lineHeight) || font.lineHeight <= 0) bad('font.lineHeight', 'must be a number > 0')
    if (font.fallback !== undefined && !(Array.isArray(font.fallback) && font.fallback.every(isStr)))
      bad('font.fallback', 'must be a string[] when present')
    if (font.curve !== undefined && (!isNum(font.curve) || !inRange(font.curve as number, -1, 1)))
      bad('font.curve', 'must be a number in -1..1 when present')
  }

  // fill
  const fill = input.fill
  if (!isObj(fill)) {
    bad('fill', 'required object')
  } else {
    if (!isStr(fill.type) || !FILL_TYPES.includes(fill.type as string))
      bad('fill.type', `must be one of ${FILL_TYPES.join('|')}`)
    if (fill.type === 'solid' && !isHex(fill.value)) bad('fill.value', 'solid fill value must be a hex color')
    if (fill.type === 'gradient') {
      if (!Array.isArray(fill.value) || fill.value.length < 2) {
        bad('fill.value', 'gradient fill value must be >= 2 stops')
      } else {
        fill.value.forEach((stop, i) => {
          if (!isObj(stop) || !isNum(stop.offset) || !inRange(stop.offset as number, 0, 1) || !isHex(stop.color))
            bad(`fill.value[${i}]`, 'stop must be { offset:0..1, color:hex }')
        })
      }
    }
    if (!isNum(fill.opacity) || !inRange(fill.opacity, 0, 1)) bad('fill.opacity', 'must be 0..1')
    if (fill.angle !== undefined && !isNum(fill.angle)) bad('fill.angle', 'must be a number when present')
    if (fill.perWord !== undefined && !isBool(fill.perWord)) bad('fill.perWord', 'must be boolean when present')
  }

  // stroke (optional)
  if (input.stroke !== undefined) {
    if (!Array.isArray(input.stroke)) {
      bad('stroke', 'must be an array when present')
    } else {
      input.stroke.forEach((layer, i) => {
        if (!isObj(layer) || !isHex(layer.color)) bad(`stroke[${i}].color`, 'must be a hex color')
        if (!isObj(layer) || !isNum(layer.width) || (layer.width as number) < 0)
          bad(`stroke[${i}].width`, 'must be a number >= 0')
      })
    }
  }

  // shadow (optional)
  if (input.shadow !== undefined) {
    const s = input.shadow
    if (!isObj(s)) {
      bad('shadow', 'must be an object when present')
    } else {
      if (!isHex(s.color)) bad('shadow.color', 'must be a hex color')
      if (!isNum(s.opacity) || !inRange(s.opacity, 0, 1)) bad('shadow.opacity', 'must be 0..1')
      if (!isNum(s.blur) || (s.blur as number) < 0) bad('shadow.blur', 'must be a number >= 0')
      if (!isNum(s.angle)) bad('shadow.angle', 'must be a number')
      if (!isNum(s.distance) || (s.distance as number) < 0) bad('shadow.distance', 'must be a number >= 0')
      if (!isBool(s.inner)) bad('shadow.inner', 'must be boolean')
      if (!isBool(s.long)) bad('shadow.long', 'must be boolean')
    }
  }

  // effects (optional)
  if (input.effects !== undefined) {
    if (!Array.isArray(input.effects)) {
      bad('effects', 'must be an array when present')
    } else {
      input.effects.forEach((e, i) => {
        if (!isObj(e) || !isStr(e.type) || e.type.length === 0)
          bad(`effects[${i}].type`, 'must be a non-empty string')
      })
    }
  }

  // decoration (optional)
  if (input.decoration !== undefined) {
    const d = input.decoration
    if (!isObj(d)) {
      bad('decoration', 'must be an object when present')
    } else {
      if (d.background !== undefined) {
        const b = d.background
        if (!isObj(b)) bad('decoration.background', 'must be an object')
        else {
          if (!isHex(b.color)) bad('decoration.background.color', 'must be a hex color')
          if (!isNum(b.opacity) || !inRange(b.opacity, 0, 1)) bad('decoration.background.opacity', 'must be 0..1')
          if (!isNum(b.padding) || (b.padding as number) < 0) bad('decoration.background.padding', 'must be >= 0')
          if (!isNum(b.radius) || (b.radius as number) < 0) bad('decoration.background.radius', 'must be >= 0')
        }
      }
      if (d.underline !== undefined && !isBool(d.underline)) bad('decoration.underline', 'must be boolean')
      if (d.strike !== undefined && !isBool(d.strike)) bad('decoration.strike', 'must be boolean')
      if (d.highlight !== undefined) {
        const h = d.highlight
        if (!isObj(h)) bad('decoration.highlight', 'must be an object')
        else {
          if (!isHex(h.color)) bad('decoration.highlight.color', 'must be a hex color')
          if (!isNum(h.opacity) || !inRange(h.opacity, 0, 1)) bad('decoration.highlight.opacity', 'must be 0..1')
          if (!isNum(h.radius) || (h.radius as number) < 0) bad('decoration.highlight.radius', 'must be >= 0')
        }
      }
    }
  }

  // animation (required object; each member optional)
  const anim = input.animation
  if (!isObj(anim)) {
    bad('animation', 'required object')
  } else {
    for (const key of ['in', 'out', 'loop'] as const) {
      const ref = anim[key]
      if (ref === undefined) continue
      if (!isObj(ref)) {
        bad(`animation.${key}`, 'must be an object when present')
        continue
      }
      if (!isStr(ref.preset) || ref.preset.length === 0) bad(`animation.${key}.preset`, 'required non-empty string')
      if (!isNum(ref.durationSec) || (ref.durationSec as number) < 0)
        bad(`animation.${key}.durationSec`, 'must be a number >= 0')
      if (!isStr(ref.easing) || !EASINGS.includes(ref.easing as Easing))
        bad(`animation.${key}.easing`, `must be one of ${EASINGS.join('|')}`)
    }
    if (anim.reveal !== undefined) {
      const r = anim.reveal
      if (!isObj(r)) {
        bad('animation.reveal', 'must be an object when present')
      } else {
        if (!isStr(r.mode) || !REVEAL_MODES.includes(r.mode as string))
          bad('animation.reveal.mode', `must be one of ${REVEAL_MODES.join('|')}`)
        if (!isNum(r.staggerSec) || (r.staggerSec as number) < 0)
          bad('animation.reveal.staggerSec', 'must be a number >= 0')
        if (!isStr(r.easing) || !EASINGS.includes(r.easing as Easing))
          bad('animation.reveal.easing', `must be one of ${EASINGS.join('|')}`)
      }
    }
  }

  // layout (required)
  const layout = input.layout
  if (!isObj(layout)) {
    bad('layout', 'required object')
  } else {
    if (!isStr(layout.anchor) || !ANCHORS.includes(layout.anchor as LayoutAnchor))
      bad('layout.anchor', `must be one of ${ANCHORS.join('|')}`)
    if (layout.y !== undefined && (!isNum(layout.y) || !inRange(layout.y as number, 0, 1)))
      bad('layout.y', 'must be 0..1 when present')
    if (!isBool(layout.safeMargin)) bad('layout.safeMargin', 'required boolean')
    if (!isNum(layout.maxLines) || (layout.maxLines as number) < 1 || !Number.isInteger(layout.maxLines))
      bad('layout.maxLines', 'must be an integer >= 1')
  }

  // highlight (required)
  const hl = input.highlight
  if (!isObj(hl)) {
    bad('highlight', 'required object')
  } else {
    if (!isBool(hl.enabled)) bad('highlight.enabled', 'required boolean')
    if (!isHex(hl.activeColor)) bad('highlight.activeColor', 'must be a hex color')
    if (!isNum(hl.activeScale) || (hl.activeScale as number) <= 0)
      bad('highlight.activeScale', 'must be a number > 0')
    if (!isStr(hl.style) || !HIGHLIGHT_STYLES.includes(hl.style as string))
      bad('highlight.style', `must be one of ${HIGHLIGHT_STYLES.join('|')}`)
  }

  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, value: input as unknown as CaptionPreset }
}

/** Convenience boolean guard built on {@link validateCaptionPreset}. */
export function isCaptionPreset(input: unknown): input is CaptionPreset {
  return validateCaptionPreset(input).ok
}

/**
 * Parse-or-throw variant for call sites that want an exception (e.g. loading a
 * built-in registry that must be correct). Throws an `Error` whose message lists
 * the issues; returns the narrowed preset on success.
 */
export function parseCaptionPreset(input: unknown): CaptionPreset {
  const result = validateCaptionPreset(input)
  if (!result.ok) {
    throw new Error(
      'invalid CaptionPreset: ' + result.issues.map((i) => `${i.path || '<root>'}: ${i.message}`).join('; ')
    )
  }
  return result.value
}

// ---------------------------------------------------------------------------
// Preset -> caption-clip mapping (the contract P5.4 implements)
// ---------------------------------------------------------------------------

/**
 * The clip-side shape a preset stamps onto a caption clip. This is the CONTRACT
 * P5.4 ("apply preset to track") fulfills: for each caption clip it sets
 *   - `clip.text.*`      = {@link CaptionClipStyle.text}      (font/fill/stroke/shadow/decoration/align)
 *   - `clip.animation.*` = {@link CaptionClipStyle.animation} (in/out/loop/reveal)
 *   - `clip.transform`   merged with {@link CaptionClipStyle.transformPatch} (layout anchor → y offset)
 * while LEAVING `clip.text.lines`, `clip.text.lang`, and `clip.caption.words`
 * untouched (the spoken content + per-word timing survive a style change).
 *
 * Note: layout/highlight do not all have a 1:1 clip field today. `layout.anchor`
 * resolves to a transform `y`; `highlight` is consumed LIVE by P5.6 from the
 * preset (looked up by `captions.styleId`) rather than denormalized onto the
 * clip — so the active-word color/scale always tracks the current preset.
 */
export interface CaptionClipStyle {
  /** The `clip.text.*` style fields (content fields `lines`/`lang` excluded). */
  text: Omit<ClipText, 'lines' | 'lang' | 'runs'>
  /** The `clip.animation` bundle. */
  animation: ClipAnimation
  /** A partial transform to merge onto the clip's existing transform. */
  transformPatch: Partial<ClipTransform>
}

/** Normalized vertical transform offset (0..1) for each non-custom anchor. */
const ANCHOR_Y: Record<Exclude<LayoutAnchor, 'custom'>, number> = {
  'lower-third': 0.35,
  center: 0,
  top: -0.35
}

/**
 * Resolve a layout anchor to the transform `y` offset P5.4 applies. `custom`
 * uses the preset's explicit `layout.y` (or 0 if absent) so manual placement is
 * respected; the named anchors return their aspect-neutral default offset.
 */
export function resolveLayoutY(layout: PresetLayout): number {
  if (layout.anchor === 'custom') return layout.y ?? 0
  return layout.y ?? ANCHOR_Y[layout.anchor]
}

/**
 * Project a {@link CaptionPreset} into the {@link CaptionClipStyle} shape P5.4
 * stamps onto each caption clip. PURE — no clip is mutated here; P5.4 owns the
 * merge (preserving `lines`/`lang`/`caption.words`). The visual fields map
 * 1:1 onto `clip.text.*` because the preset reuses the text-render shapes.
 */
export function captionPresetToClipStyle(preset: CaptionPreset): CaptionClipStyle {
  const text: CaptionClipStyle['text'] = {
    align: 'center',
    font: {
      family: preset.font.family,
      size: preset.font.size,
      // map weight → bold flag for the existing `clip.text.font` shape, and keep
      // numeric weight too so a future weighted renderer can read it.
      bold: preset.font.weight === 'bold' || (typeof preset.font.weight === 'number' && preset.font.weight >= 600),
      weight: preset.font.weight,
      italic: preset.font.italic,
      letterSpacing: preset.font.letterSpacing,
      lineHeight: preset.font.lineHeight,
      ...(preset.font.fallback ? { fallback: preset.font.fallback } : {}),
      ...(preset.font.curve !== undefined ? { curve: preset.font.curve } : {})
    },
    // The preset's visual shapes ARE the text-render shapes (parity), so these
    // copy through 1:1. `clip.text.*` types these as open `Record`/`unknown[]`
    // bags (project-schema), so we widen via `as` — structurally identical.
    fill: {
      type: preset.fill.type,
      value: preset.fill.value,
      opacity: preset.fill.opacity,
      // Carry the gradient angle through so the renderer's `fill.angle` (P6.8)
      // matches the preset (e.g. 90° top→bottom metallic gold); omitted → 0.
      ...(preset.fill.angle !== undefined ? { angle: preset.fill.angle } : {})
    } as Record<string, unknown>,
    ...(preset.stroke ? { stroke: preset.stroke as unknown[] } : {}),
    ...(preset.shadow ? { shadow: { ...preset.shadow } as unknown as Record<string, unknown> } : {}),
    ...(preset.decoration
      ? { decoration: { ...preset.decoration } as unknown as Record<string, unknown> }
      : {}),
    ...(preset.effects && preset.effects.length > 0 ? { effects: preset.effects as unknown[] } : {})
  }

  const animation: ClipAnimation = {
    ...(preset.animation.in ? { in: { ...preset.animation.in } } : {}),
    ...(preset.animation.out ? { out: { ...preset.animation.out } } : {}),
    ...(preset.animation.loop ? { loop: { ...preset.animation.loop } } : {}),
    ...(preset.animation.reveal ? { reveal: { ...preset.animation.reveal } } : {})
  }

  return {
    text,
    animation,
    transformPatch: { y: resolveLayoutY(preset.layout) }
  }
}

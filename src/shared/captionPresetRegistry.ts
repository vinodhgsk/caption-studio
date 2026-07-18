/**
 * Built-in caption preset registry (P5.2 — Doc 03 caption styles; skill `text-render`).
 *
 * P5.1 ({@link ./captionPreset}) defined the {@link CaptionPreset} schema, its
 * validator, and the baseline `defaultCaptionPreset()` ("TikTok Classic"). THIS
 * module is the SINGLE SOURCE OF TRUTH for the named built-in presets the gallery
 * (P5.3) renders thumbnails for and "apply to track" (P5.4) stamps onto the
 * caption track. It ships the five built-ins Doc 03 names:
 *
 *   - `tiktok-classic`    — bold white body, black outline, whole-word active flip.
 *   - `karaoke-highlight` — left-to-right wipe fill across the active word (karaoke).
 *   - `pop-by-word`       — word-by-word reveal with a scale pop on the active word.
 *   - `bounce`            — words bounce in (spring/bounce easing) one at a time.
 *   - `typewriter`        — monospace, character-by-character (grapheme-cluster) reveal.
 *
 * EXTENSION HOOK ("room to add"): {@link registerCaptionPreset} appends a *user/
 * plugin* preset to the registry after validating it and rejecting duplicate ids.
 * Built-ins are IMMUTABLE — every read returns a deep clone, so a caller can never
 * mutate the shared definitions, and built-in ids can never be overwritten.
 *
 * Headless-safe: pure data + pure helpers built on P5.1; NO electron/node/DOM.
 */
import {
  DEFAULT_CAPTION_FONT_FAMILY,
  DEFAULT_CAPTION_FONT_FALLBACK,
  defaultCaptionPreset,
  parseCaptionPreset,
  validateCaptionPreset,
  type CaptionPreset
} from './captionPreset'
import type { TextEffect } from './textEffect'

// ---------------------------------------------------------------------------
// Built-in preset ids — stable, recorded on the project as `captions.styleId`.
// ---------------------------------------------------------------------------

export const PRESET_SARVAM_BHAKTI_GOLD = 'sarvam-bhakti-gold'
export const PRESET_TIKTOK_CLASSIC = 'tiktok-classic'
export const PRESET_KARAOKE_HIGHLIGHT = 'karaoke-highlight'
export const PRESET_POP_BY_WORD = 'pop-by-word'
export const PRESET_BOUNCE = 'bounce'
export const PRESET_TYPEWRITER = 'typewriter'
export const PRESET_BHAKTHI_GOLD = 'bhakthi-gold'
export const PRESET_GRAND_TEMPLE_GOLD = 'grand-temple-gold'
/**
 * The reference-based "3D glossy golden devotional" style
 * (`media/expected_default_caption.png`) — a SEPARATE new preset on the heavy
 * rounded Baloo Thambi 2 face. This is the auto-caption default.
 */
export const PRESET_SARVAM_BHAKTI_GOLD_3D = 'sarvam-bhakti-gold-3d'
/**
 * Cinematic devotional title-card gold — a dramatic, radiant golden 3D style
 * with a warm amber glow halo, heavy extrusion, and center-anchored cinematic
 * positioning. Designed for Tamil devotional music video titles/captions where
 * the text appears as a grand static title (no per-word highlight).
 */
export const PRESET_DIVINE_REVELATION_GOLD = 'divine-revelation-gold'

/** The ids of the shipped built-ins, in gallery display order. */
export const BUILT_IN_PRESET_IDS = [
  // The reference-based 3D gold leads — the channel's signature/default caption
  // style, applied automatically by auto-caption (see
  // {@link DEFAULT_APPLIED_CAPTION_PRESET_ID}).
  PRESET_SARVAM_BHAKTI_GOLD_3D,
  PRESET_SARVAM_BHAKTI_GOLD,
  PRESET_TIKTOK_CLASSIC,
  PRESET_KARAOKE_HIGHLIGHT,
  PRESET_POP_BY_WORD,
  PRESET_BOUNCE,
  PRESET_TYPEWRITER,
  PRESET_BHAKTHI_GOLD,
  PRESET_GRAND_TEMPLE_GOLD,
  PRESET_DIVINE_REVELATION_GOLD
] as const

/**
 * The caption preset auto-caption APPLIES BY DEFAULT to a freshly generated
 * Caption track (both lyrics-first and STT modes) when the project has not yet
 * recorded a `captions.styleId`. This is the Sarvam Bhakti Studio signature gold
 * treatment — the channel's brand default per
 * `docs/SARVAM-BHAKTI-CAPTION-STYLE-GUIDE.md` §1. Distinct from
 * `DEFAULT_CAPTION_PRESET_ID` ('tiktok-classic'), which remains the neutral
 * schema baseline `defaultCaptionPreset()` produces.
 */
export const DEFAULT_APPLIED_CAPTION_PRESET_ID = PRESET_SARVAM_BHAKTI_GOLD_3D

/** Shared Indic-first fallback chain for the built-ins. */
const FALLBACK = (): string[] => [...DEFAULT_CAPTION_FONT_FALLBACK]

// ---------------------------------------------------------------------------
// Built-in definitions
// ---------------------------------------------------------------------------

/**
 * TikTok Classic — bold high-contrast white body, thick black outline, soft drop
 * shadow; whole-word active-word highlight in a punchy yellow. The P5.1 baseline.
 */
function tiktokClassic(): CaptionPreset {
  // Reuse the P5.1 baseline verbatim — it already IS TikTok Classic.
  return defaultCaptionPreset()
}

/**
 * Karaoke Highlight — the active word fills LEFT-TO-RIGHT (a wipe) in a bright
 * green as the playhead crosses its word time; no pop, no per-word reveal (the
 * whole line is visible and the wipe rides the audio). A box sits behind the line.
 */
function karaokeHighlight(): CaptionPreset {
  return {
    id: PRESET_KARAOKE_HIGHLIGHT,
    displayName: 'Karaoke Highlight',
    category: 'caption',
    font: {
      family: DEFAULT_CAPTION_FONT_FAMILY,
      size: 46,
      weight: 700,
      italic: false,
      letterSpacing: 0,
      lineHeight: 1.25,
      fallback: FALLBACK()
    },
    fill: { type: 'solid', value: '#ffffff', opacity: 1, perWord: true },
    stroke: [{ color: '#0a0a0a', width: 3 }],
    shadow: {
      color: '#000000',
      opacity: 0.5,
      blur: 6,
      angle: 90,
      distance: 2,
      inner: false,
      long: false
    },
    decoration: {
      background: { color: '#101820', opacity: 0.55, padding: 14, radius: 12 }
    },
    animation: {
      in: { preset: 'fade', durationSec: 0.2, easing: 'easeOut' },
      // Whole line visible; the wipe is the active-word effect, not a reveal.
      reveal: { mode: 'none', staggerSec: 0, easing: 'linear' }
    },
    layout: { anchor: 'lower-third', safeMargin: true, maxLines: 2 },
    // wipe = left-to-right fill within the active word (grapheme-cluster advance).
    highlight: { enabled: true, activeColor: '#39ff88', activeScale: 1, style: 'wipe' }
  }
}

/**
 * Pop by Word — words appear ONE AT A TIME (word reveal) and the active word
 * pops up in scale + a hot-pink fill. Rounded background box; medium drop shadow.
 */
function popByWord(): CaptionPreset {
  return {
    id: PRESET_POP_BY_WORD,
    displayName: 'Pop by Word',
    category: 'caption',
    font: {
      family: DEFAULT_CAPTION_FONT_FAMILY,
      size: 52,
      weight: 800,
      italic: false,
      letterSpacing: 0.5,
      lineHeight: 1.2,
      fallback: FALLBACK()
    },
    fill: { type: 'solid', value: '#ffffff', opacity: 1, perWord: true },
    stroke: [{ color: '#000000', width: 5 }],
    shadow: {
      color: '#000000',
      opacity: 0.55,
      blur: 10,
      angle: 45,
      distance: 5,
      inner: false,
      long: false
    },
    animation: {
      in: { preset: 'pop', durationSec: 0.16, easing: 'easeOut' },
      // word-by-word reveal driven by word times (staggerSec 0 = use word times).
      reveal: { mode: 'word', staggerSec: 0, easing: 'easeOut' }
    },
    layout: { anchor: 'center', safeMargin: true, maxLines: 2 },
    // wholeWord = the current word flips entirely + scales up (the "pop").
    highlight: { enabled: true, activeColor: '#ff2d8b', activeScale: 1.22, style: 'wholeWord' }
  }
}

/**
 * Bounce — each word BOUNCES in (spring easing on a longer in-animation) one at a
 * time; gradient fill (cyan → blue), no stroke, soft shadow; gentle active scale.
 */
function bounce(): CaptionPreset {
  return {
    id: PRESET_BOUNCE,
    displayName: 'Bounce',
    category: 'caption',
    font: {
      family: DEFAULT_CAPTION_FONT_FAMILY,
      size: 50,
      weight: 800,
      italic: false,
      letterSpacing: 0,
      lineHeight: 1.22,
      fallback: FALLBACK()
    },
    fill: {
      type: 'gradient',
      value: [
        { offset: 0, color: '#00e5ff' },
        { offset: 1, color: '#2962ff' }
      ],
      opacity: 1,
      perWord: false
    },
    shadow: {
      color: '#001b3d',
      opacity: 0.45,
      blur: 12,
      angle: 90,
      distance: 4,
      inner: false,
      long: false
    },
    animation: {
      // bounce entrance: longer, spring easing → the bouncy overshoot.
      in: { preset: 'bounce', durationSec: 0.45, easing: 'spring' },
      reveal: { mode: 'word', staggerSec: 0.06, easing: 'spring' }
    },
    layout: { anchor: 'center', safeMargin: true, maxLines: 2 },
    highlight: { enabled: true, activeColor: '#ffffff', activeScale: 1.1, style: 'wholeWord' }
  }
}

/**
 * Typewriter — monospace family, character-by-character reveal that advances by
 * GRAPHEME CLUSTER (indic-text) so Tamil/Telugu/Malayalam/Kannada/Hindi reveal
 * correctly. Amber-on-dark "terminal" look; no active-word highlight (the cursor
 * IS the focus), top anchor.
 */
function typewriter(): CaptionPreset {
  return {
    id: PRESET_TYPEWRITER,
    displayName: 'Typewriter',
    category: 'caption',
    font: {
      // Indic-capable family first so non-Latin still shapes; monospace fallback.
      family: DEFAULT_CAPTION_FONT_FAMILY,
      size: 40,
      weight: 'normal',
      italic: false,
      letterSpacing: 1,
      lineHeight: 1.4,
      fallback: ['Noto Sans Tamil', 'Noto Sans Mono', 'JetBrains Mono', 'monospace']
    },
    fill: { type: 'solid', value: '#ffd166', opacity: 1, perWord: false },
    decoration: {
      background: { color: '#000000', opacity: 0.65, padding: 16, radius: 6 }
    },
    animation: {
      in: { preset: 'none', durationSec: 0, easing: 'linear' },
      // character reveal: one grapheme cluster per stagger step (typewriter cadence).
      reveal: { mode: 'character', staggerSec: 0.045, easing: 'linear' }
    },
    layout: { anchor: 'top', safeMargin: true, maxLines: 3 },
    // No active-word color flip — the reveal cursor carries the motion.
    highlight: { enabled: false, activeColor: '#ffd166', activeScale: 1, style: 'wholeWord' }
  }
}

/**
 * Bhakthi Gold — temple/devotional Tamil style.
 * Metallic gold gradient fill (bright highlight top → warm gold → dark amber),
 * thick reddish-brown outer stroke, and a long (extruded 3D) shadow that creates
 * the raised-letter depth seen in South Indian devotional title cards.
 * Noto Serif Tamil bold for the temple-inscription serif look.
 */
function bhakthiGold(): CaptionPreset {
  return {
    id: PRESET_BHAKTHI_GOLD,
    displayName: 'Bhakthi Gold',
    category: 'caption',
    font: {
      family: 'Noto Serif Tamil',
      size: 70,
      weight: 900,
      italic: false,
      letterSpacing: 1,
      lineHeight: 1.15,
      fallback: ['Noto Sans Tamil', DEFAULT_CAPTION_FONT_FAMILY, 'serif']
    },
    fill: {
      type: 'gradient',
      value: [
        { offset: 0,    color: '#FFF9CC' },
        { offset: 0.3,  color: '#FFD600' },
        { offset: 0.65, color: '#C88800' },
        { offset: 1,    color: '#7A4400' }
      ],
      opacity: 1,
      perWord: false
    },
    stroke: [
      { color: '#1E0500', width: 10 }
    ],
    shadow: {
      color: '#3D1200',
      opacity: 1,
      blur: 0,
      angle: 135,
      distance: 10,
      inner: false,
      long: true
    },
    animation: {
      in: { preset: 'pop', durationSec: 0.2, easing: 'easeOut' },
      reveal: { mode: 'word', staggerSec: 0, easing: 'easeOut' }
    },
    layout: { anchor: 'lower-third', safeMargin: true, maxLines: 2 },
    highlight: { enabled: true, activeColor: '#ffffff', activeScale: 1.05, style: 'wholeWord' }
  }
}

/**
 * Grand Temple Gold — opulent South Indian film-poster / festival-title aesthetic.
 *
 * Fill: vertical champagne-to-burnt-orange gold gradient (bright specular highlight
 * across the upper third, deepening through warm amber into deep burnt-orange at
 * the base — the "polished metal" look). Two stroke layers: thick near-black outer
 * border + mid-amber inner edge that suggests a beveled rim. Effects stack:
 *   1. `3d` — extruded crimson side-wall behind the glyph (shades from front crimson
 *      `#8B0000` to near-black at the back), giving the raised, carved-letter depth.
 *   2. `glow` — soft warm-amber halo (radius 28, low intensity) for the radial
 *      warm-light emanating from behind the text on the dark bokeh background.
 * Font: Noto Serif Tamil 900 — heavy serif letterforms matching the temple-inscription
 * weight. Word-by-word reveal with a pop entrance; champagne-white active-word flip.
 */
function grandTempleGold(): CaptionPreset {
  const effects: TextEffect[] = [
    {
      type: '3d',
      enabled: true,
      opacity: 1,
      intensity: 0.85,
      params: {
        depth: 22,
        angle: 135,
        color: '#8B0000'
      }
    },
    {
      type: 'glow',
      enabled: true,
      opacity: 0.9,
      intensity: 0.42,
      params: {
        radius: 28,
        color: '#FF8C00'
      }
    }
  ]
  return {
    id: PRESET_GRAND_TEMPLE_GOLD,
    displayName: 'Grand Temple Gold',
    category: 'caption',
    font: {
      family: 'Noto Serif Tamil',
      size: 72,
      weight: 900,
      italic: false,
      letterSpacing: 2,
      lineHeight: 1.2,
      fallback: ['Noto Sans Tamil', DEFAULT_CAPTION_FONT_FAMILY, 'serif']
    },
    fill: {
      type: 'gradient',
      value: [
        { offset: 0,    color: '#FFF8B0' },
        { offset: 0.18, color: '#FFE433' },
        { offset: 0.45, color: '#E89600' },
        { offset: 0.75, color: '#CC4A00' },
        { offset: 1,    color: '#7A2000' }
      ],
      opacity: 1,
      perWord: false
    },
    stroke: [
      { color: '#0F0200', width: 12 },
      { color: '#7A3800', width: 5 }
    ],
    animation: {
      in: { preset: 'pop', durationSec: 0.2, easing: 'easeOut' },
      reveal: { mode: 'word', staggerSec: 0, easing: 'easeOut' }
    },
    effects,
    layout: { anchor: 'lower-third', safeMargin: true, maxLines: 2 },
    highlight: { enabled: true, activeColor: '#FFF8B0', activeScale: 1.06, style: 'wholeWord' }
  }
}

/**
 * Sarvam Bhakti Gold — the Noto-Serif-Tamil devotional gold (a selectable
 * option). The reference-matching heavy-rounded default lives in the SEPARATE
 * {@link sarvamBhaktiGold3d} preset ("Sarvam Bhakti Gold 3D") on Baloo Thambi 2;
 * this one keeps the temple-inscription serif letterform with the same rich gold.
 *
 * Locked treatment (guide §1): a top-lit metallic gold gradient, a crisp dark
 * contour, a solid extruded 3D wall, and a tight warm drop shadow — every
 * language shares this exact gold; only the FONT (§7) and the SUNG word's fill
 * (§2.7) ever change. Mapped onto our preset shapes:
 *   - fill    — the six-stop 90° top→bottom gold gradient (§2.1). `perWord` so
 *               the active (sung) word can flip to the highlight fill.
 *   - stroke  — dark contour `#3B2200` (§2.2) with a warm `#7F3B10` inner edge.
 *   - effects — a `3d` extrusion "wall" in wall-mid bronze `#8E4705` (§2.3), the
 *               solid side-depth the reference letters carry. No `glow` on the
 *               base gold — the guide FORBIDS glow on the un-sung state (§2.7/§9).
 *   - shadow  — warm near-black `#1A0E00` drop shadow, angle 90, ~50% (§2.5), the
 *               mandatory anchor over unpredictable footage (§8.3).
 *   - highlight — White-Gold `#FFF6D0` (§2.7 A, the recommended default), a
 *               left-to-right karaoke `wipe` (the §3 "sweep fill" for lyric
 *               videos); the whole line stays visible (`reveal: none`).
 *
 * Font: Noto Serif Tamil 900 (heavy temple-inscription serif). The guide's first
 * choice is Baloo Thambi 2, but that family is not bundled; Noto Serif Tamil is
 * the guide's listed premium/alternate (§7) and IS bundled, so preview↔export
 * font metrics stay in parity for all six scripts via the Indic fallback chain.
 */
function sarvamBhaktiGold(): CaptionPreset {
  const effects: TextEffect[] = [
    {
      // §2.3 3D extrusion "wall": a solid bronze side-wall gives real depth.
      // Extrude mostly DOWN + slightly right (100°, matching the reference), with
      // a brighter bronze (#A85D08 ≈ WALL_TOP) so the shaded steps still read over
      // any footage (the far end darkens toward the back — a lit wall).
      type: '3d',
      enabled: true,
      opacity: 1,
      intensity: 1,
      params: { depth: 30, angle: 100, color: '#A85D08' }
    },
    {
      // §2.4 Bevel & gloss: a bright near-white specular rim on the lit (top) edge
      // and a warm shaded rim on the bottom edge, carved into the glyph — the
      // rounded polished-metal look + the gloss hotspot the reference shows.
      type: 'bevel',
      enabled: true,
      // Keep the rim THIN + semi-transparent so it reads as a sheen on the edges,
      // not a solid white repaint of the stroke.
      opacity: 0.7,
      intensity: 1,
      params: { size: 2, highlight: '#FFFEF2', shadow: '#6B3A00', angle: 90 }
    }
  ]
  return {
    id: PRESET_SARVAM_BHAKTI_GOLD,
    displayName: 'Sarvam Bhakti Gold',
    category: 'caption',
    font: {
      family: 'Noto Serif Tamil',
      // Big, monumental caption (§8: cap-height ≥ ~9% of frame height). 144px on a
      // 1080-tall frame ≈ 12% — the chunky devotional-title scale. The user can
      // resize via the Auto-Caption size control.
      size: 144,
      weight: 900,
      italic: false,
      // §8: default letter spacing (do not track out); tight 1.0–1.1 line height.
      letterSpacing: 0,
      lineHeight: 1.1,
      fallback: ['Noto Sans Tamil', DEFAULT_CAPTION_FONT_FAMILY, 'serif']
    },
    // §2.1 six-stop gold gradient, 90° top→bottom (bright creamy rim at the top of
    // each glyph rolling down to the deep amber base — the metallic look; the top
    // stop doubles as the gloss highlight). `perWord` lets the sung word take the
    // §2.7 highlight fill while the rest stay gold.
    fill: {
      type: 'gradient',
      angle: 90,
      value: [
        // Polished-metal ramp (90° top→bottom): a white specular rim, a bright
        // gold band, a dark amber "reflection line" across the middle, a SECOND
        // bright reflection band lower down, then the deep bronze base. The
        // double bright/dark banding is what reads as shiny metal (vs flat gold).
        { offset: 0.0, color: '#FFFDF0' },
        { offset: 0.1, color: '#FFE98A' },
        { offset: 0.28, color: '#F8C63C' },
        { offset: 0.46, color: '#E59310' },
        { offset: 0.54, color: '#B06A08' },
        { offset: 0.66, color: '#F2B01C' },
        { offset: 0.84, color: '#D07E0A' },
        { offset: 1.0, color: '#7A4A06' }
      ],
      opacity: 1,
      perWord: true
    },
    // §2.2 WARM dark-brown contour (outer) + a warm amber inner edge — the deep
    // brown border seen in the reference (never a cold black). Mandatory over live
    // footage (§8.3).
    stroke: [
      { color: '#2A1400', width: 12 },
      { color: '#7F3B10', width: 4 }
    ],
    // §2.5 warm near-black drop shadow, angle 90, soft — anchors the text over
    // footage below the 3D wall.
    shadow: {
      color: '#1A0E00',
      opacity: 0.55,
      blur: 16,
      angle: 90,
      distance: 8,
      inner: false,
      long: false
    },
    effects,
    animation: {
      in: { preset: 'fade', durationSec: 0.2, easing: 'easeOut' },
      // Lyric line stays fully visible; the current sung WORD lights up (§3
      // "current-word pop") — no per-word reveal.
      reveal: { mode: 'none', staggerSec: 0, easing: 'linear' }
    },
    layout: { anchor: 'lower-third', safeMargin: true, maxLines: 2 },
    // §2.7 A White-Gold sung-word fill, WORD-BY-WORD (the whole current word flips
    // to the highlight fill — not a grapheme sweep). Tiny scale pop draws the eye.
    highlight: { enabled: true, activeColor: '#FFF6D0', activeScale: 1.06, style: 'wholeWord' }
  }
}

/**
 * Sarvam Bhakti Gold 3D — the SEPARATE new signature/DEFAULT caption style, built
 * to match `media/expected_default_caption.png`: the heavy, rounded, polished
 * "3D glossy golden devotional" title.
 *
 * The key difference from the serif {@link sarvamBhaktiGold} is the FONT:
 * **Baloo Thambi 2** (Doc 03 §7 primary pick) — a heavy ROUNDED Tamil display
 * face whose thick uniform strokes are the letterform in the reference (the serif
 * Noto face never read as the chunky poster gold). On top of that letterform: a
 * polished-metal vertical gradient (white specular top → gold → a dark reflection
 * line → a second bright band → deep bronze), a warm dark-brown contour, a bronze
 * 3D extrusion wall, a soft warm shadow, and a bevel/gloss rim. White-gold
 * word-by-word sung-word highlight.
 */
function sarvamBhaktiGold3d(): CaptionPreset {
  const effects: TextEffect[] = [
    {
      // §2.3 3D extrusion wall — bronze, mostly-down (100°), bright enough that the
      // shaded far end still reads over footage.
      type: '3d',
      enabled: true,
      opacity: 1,
      intensity: 1,
      params: { depth: 34, angle: 100, color: '#A85D08' }
    },
    {
      // §2.4 Bevel & gloss — a thin bright specular rim on the top edge + a warm
      // shaded rim below, for the rounded polished-metal surface + gloss hotspot.
      // Baloo's thicker strokes take a slightly larger rim than the serif face.
      type: 'bevel',
      enabled: true,
      opacity: 0.72,
      intensity: 1,
      params: { size: 3, highlight: '#FFFEF2', shadow: '#6B3A00', angle: 90 }
    }
  ]
  return {
    id: PRESET_SARVAM_BHAKTI_GOLD_3D,
    displayName: 'Sarvam Bhakti Gold 3D',
    category: 'caption',
    font: {
      // Baloo Thambi 2 — heavy ROUNDED Tamil display face (the reference letterform).
      // Variable weight; 800 = ExtraBold. Fallback keeps Indic/Latin covered.
      family: 'Baloo Thambi 2',
      size: 150,
      weight: 800,
      italic: false,
      letterSpacing: 0,
      lineHeight: 1.05,
      fallback: ['Noto Sans Tamil', DEFAULT_CAPTION_FONT_FAMILY, 'sans-serif']
    },
    // Polished-metal vertical gradient (§2.1): white specular top → bright gold →
    // dark reflection line → second bright band → deep bronze base. `perWord` so
    // the sung word flips to the highlight fill.
    fill: {
      type: 'gradient',
      angle: 90,
      value: [
        { offset: 0.0, color: '#FFFDF0' },
        { offset: 0.1, color: '#FFE98A' },
        { offset: 0.28, color: '#F8C63C' },
        { offset: 0.46, color: '#E59310' },
        { offset: 0.54, color: '#B06A08' },
        { offset: 0.66, color: '#F2B01C' },
        { offset: 0.84, color: '#D07E0A' },
        { offset: 1.0, color: '#7A4A06' }
      ],
      opacity: 1,
      perWord: true
    },
    // §2.2 WARM dark-brown contour + amber inner edge (never cold black).
    stroke: [
      { color: '#2A1400', width: 12 },
      { color: '#7F3B10', width: 4 }
    ],
    // §2.5 warm near-black drop shadow, soft, below the 3D wall.
    shadow: {
      color: '#1A0E00',
      opacity: 0.55,
      blur: 16,
      angle: 90,
      distance: 8,
      inner: false,
      long: false
    },
    effects,
    animation: {
      in: { preset: 'fade', durationSec: 0.2, easing: 'easeOut' },
      reveal: { mode: 'none', staggerSec: 0, easing: 'linear' }
    },
    layout: { anchor: 'lower-third', safeMargin: true, maxLines: 2 },
    // §2.7 A White-Gold sung-word fill, word-by-word, with a tiny scale pop.
    highlight: { enabled: true, activeColor: '#FFF6D0', activeScale: 1.06, style: 'wholeWord' }
  }
}

/**
 * Divine Revelation Gold — cinematic devotional title-card style.
 *
 * A dramatic, radiant golden 3D treatment with a warm amber glow halo behind the
 * text (the "divine light" emanation), heavy bronze extrusion for cinematic depth,
 * a pronounced polished-metal bevel, and center-anchored title-card positioning.
 * Designed for Tamil devotional music video titles where the text appears as a
 * grand static headline (no per-word highlight, max 3 lines).
 *
 * Visual differences from the existing gold presets:
 *   - **Glow effect** (warm amber radiance) — no other gold preset has a glow.
 *   - **Deeper 3D extrusion** (40px vs 30–34px) — heavier cinematic depth.
 *   - **More saturated gradient** — warm cinematic gold, less polished-metal.
 *   - **Center anchor + 3 max lines** — title-card positioning, not lower-third.
 *   - **Highlight disabled** — this is a static title, not a sung lyric.
 *   - **Larger scale** (160px) and wider letter spacing (1.5px).
 */
function divineRevelationGold(): CaptionPreset {
  const effects: TextEffect[] = [
    {
      // Heavy cinematic 3D extrusion wall — bronze side-depth, mostly down + slight
      // right (100°), deeper than the other gold presets for a dramatic poster feel.
      type: '3d',
      enabled: true,
      opacity: 1,
      intensity: 1,
      params: { depth: 40, angle: 100, color: '#A05608' }
    },
    {
      // Pronounced bevel / gloss — bright specular rim on top, warm shaded rim on
      // bottom. Higher opacity (0.85) than the other golds for a more dramatic sheen.
      type: 'bevel',
      enabled: true,
      opacity: 0.85,
      intensity: 1,
      params: { size: 3, highlight: '#FFFEF0', shadow: '#5C2D08', angle: 90 }
    },
    {
      // THE distinguishing effect: a warm amber glow halo behind the text — the
      // "divine radiance" emanating from behind the golden letters. No other gold
      // preset carries a glow; this is what gives the cinematic poster feel.
      type: 'glow',
      enabled: true,
      opacity: 0.85,
      intensity: 0.5,
      params: { radius: 32, color: '#FF9800' }
    }
  ]
  return {
    id: PRESET_DIVINE_REVELATION_GOLD,
    displayName: 'Divine Revelation Gold',
    category: 'caption',
    font: {
      // Baloo Thambi 2 — heavy ROUNDED Tamil display face (matches the reference
      // poster letterform). Larger than any other preset for cinematic impact.
      family: 'Baloo Thambi 2',
      size: 160,
      weight: 800,
      italic: false,
      letterSpacing: 1.5,
      lineHeight: 1.1,
      fallback: ['Noto Sans Tamil', DEFAULT_CAPTION_FONT_FAMILY, 'sans-serif']
    },
    // Cinematic gold gradient (90° top→bottom): warm and saturated — a brighter,
    // more film-poster gold than the polished-metal multi-band ramp the other
    // presets use. Six stops from creamy highlight to deep burnt-sienna base.
    fill: {
      type: 'gradient',
      angle: 90,
      value: [
        { offset: 0.0,  color: '#FFF5B8' },
        { offset: 0.2,  color: '#FFD54F' },
        { offset: 0.45, color: '#E8A317' },
        { offset: 0.6,  color: '#C87A0A' },
        { offset: 0.8,  color: '#A05608' },
        { offset: 1.0,  color: '#6B3506' }
      ],
      opacity: 1,
      perWord: false
    },
    // Thick dark-brown contour + warm saddlebrown inner edge — heavier than other
    // presets (width 14 outer) for cinematic weight over bright backgrounds.
    stroke: [
      { color: '#2A1200', width: 14 },
      { color: '#8B4513', width: 5 }
    ],
    // Heavy warm drop shadow — deeper blur + distance than other golds for the
    // cinematic floating-above-the-scene depth.
    shadow: {
      color: '#1A0A00',
      opacity: 0.65,
      blur: 20,
      angle: 90,
      distance: 10,
      inner: false,
      long: false
    },
    effects,
    animation: {
      in: { preset: 'fade', durationSec: 0.3, easing: 'easeOut' },
      // No per-word reveal — the entire title appears as a cinematic headline.
      reveal: { mode: 'none', staggerSec: 0, easing: 'linear' }
    },
    // Center anchor for title-card positioning; 3 max lines for longer devotional
    // titles (e.g. "வெற்றிவேல் முருகனுக்கு அரோகரா..." across multiple lines).
    layout: { anchor: 'center', safeMargin: true, maxLines: 3 },
    // Highlight DISABLED — this is a static title, not a sung lyric with per-word
    // vocal sync. The activeColor is set to a neutral gold so if highlight is ever
    // toggled on manually it still reads as gold.
    highlight: { enabled: false, activeColor: '#FFD54F', activeScale: 1, style: 'wholeWord' }
  }
}

// ---------------------------------------------------------------------------
// Registry storage
// ---------------------------------------------------------------------------

/**
 * The canonical built-in definitions. Stored as factory functions so each read
 * returns a FRESH object (no shared mutable reference can leak out of the
 * registry). Order here is gallery display order.
 */
const BUILT_IN_FACTORIES: Record<string, () => CaptionPreset> = {
  [PRESET_SARVAM_BHAKTI_GOLD_3D]: sarvamBhaktiGold3d,
  [PRESET_SARVAM_BHAKTI_GOLD]: sarvamBhaktiGold,
  [PRESET_TIKTOK_CLASSIC]: tiktokClassic,
  [PRESET_KARAOKE_HIGHLIGHT]: karaokeHighlight,
  [PRESET_POP_BY_WORD]: popByWord,
  [PRESET_BOUNCE]: bounce,
  [PRESET_TYPEWRITER]: typewriter,
  [PRESET_BHAKTHI_GOLD]: bhakthiGold,
  [PRESET_GRAND_TEMPLE_GOLD]: grandTempleGold,
  [PRESET_DIVINE_REVELATION_GOLD]: divineRevelationGold
}

/** Validate the built-ins ONCE at module load — a bad built-in must fail loudly. */
for (const id of BUILT_IN_PRESET_IDS) {
  parseCaptionPreset(BUILT_IN_FACTORIES[id]())
}

/** Set of built-in ids — used to forbid overriding a built-in via the hook. */
const BUILT_IN_ID_SET = new Set<string>(BUILT_IN_PRESET_IDS)

/** Registered (non-built-in) presets added at runtime via the extension hook. */
const REGISTERED: Map<string, CaptionPreset> = new Map()

/** A defensive deep copy so callers never hold a reference to stored state. */
function clone(preset: CaptionPreset): CaptionPreset {
  return structuredClone(preset)
}

// ---------------------------------------------------------------------------
// Registry API
// ---------------------------------------------------------------------------

/**
 * Every preset known to the registry — the five immutable built-ins (in display
 * order) followed by any presets added via {@link registerCaptionPreset} (in
 * registration order). Each entry is a fresh clone; mutating the result cannot
 * affect the registry. This is the single source P5.3 (gallery) and P5.4 (apply)
 * read from.
 */
export function listCaptionPresets(): CaptionPreset[] {
  const builtIns = BUILT_IN_PRESET_IDS.map((id) => BUILT_IN_FACTORIES[id]())
  const registered = [...REGISTERED.values()].map(clone)
  return [...builtIns, ...registered]
}

/**
 * Look up a preset by id, returning a fresh clone, or `undefined` if no preset
 * with that id exists. Built-ins resolve from their factory; registered presets
 * from the runtime map.
 */
export function getCaptionPreset(id: string): CaptionPreset | undefined {
  const factory = BUILT_IN_FACTORIES[id]
  if (factory) return factory()
  const registered = REGISTERED.get(id)
  return registered ? clone(registered) : undefined
}

/** True when `id` names one of the five immutable built-ins. */
export function isBuiltInPreset(id: string): boolean {
  return BUILT_IN_ID_SET.has(id)
}

/** Outcome of {@link registerCaptionPreset}. */
export type RegisterPresetResult =
  | { ok: true; preset: CaptionPreset }
  | { ok: false; reason: 'invalid' | 'duplicate-id' | 'built-in-id'; message: string }

/**
 * Extension hook ("room to add"): register an additional {@link CaptionPreset} at
 * runtime (user-saved preset, plugin pack, etc.). The preset is VALIDATED first;
 * a malformed preset is rejected (`invalid`), an id that collides with a built-in
 * is rejected (`built-in-id`), and an id already registered is rejected
 * (`duplicate-id`). On success the registry stores a clone and the preset becomes
 * visible to {@link listCaptionPresets} / {@link getCaptionPreset}.
 */
export function registerCaptionPreset(input: unknown): RegisterPresetResult {
  const result = validateCaptionPreset(input)
  if (!result.ok) {
    return {
      ok: false,
      reason: 'invalid',
      message:
        'invalid CaptionPreset: ' +
        result.issues.map((i) => `${i.path || '<root>'}: ${i.message}`).join('; ')
    }
  }
  const preset = result.value
  if (BUILT_IN_ID_SET.has(preset.id)) {
    return { ok: false, reason: 'built-in-id', message: `id "${preset.id}" is a built-in and cannot be overridden` }
  }
  if (REGISTERED.has(preset.id)) {
    return { ok: false, reason: 'duplicate-id', message: `a preset with id "${preset.id}" is already registered` }
  }
  REGISTERED.set(preset.id, clone(preset))
  return { ok: true, preset: clone(preset) }
}

/**
 * Remove a previously {@link registerCaptionPreset}-ed preset by id. Built-ins
 * cannot be removed. Returns true if a registered preset was removed. Primarily a
 * test/teardown convenience so the global registry state stays isolated.
 */
export function unregisterCaptionPreset(id: string): boolean {
  return REGISTERED.delete(id)
}

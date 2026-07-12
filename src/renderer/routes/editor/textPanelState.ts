/**
 * Pure UI-logic for the Text panel (P6.16 / Doc 10 — Fonts + Color + Stroke +
 * Shadow). This module owns the SINGLE, HEADLESS-SAFE projections from a clip's
 * open `clip.text.*` bags onto the strongly-typed, EDITABLE values the panel
 * sections render, plus the accordion section-state and a few value formatters.
 *
 * Keeping these out of the React component means they can be unit-tested
 * directly (no DOM) and the component stays a thin wiring layer. NONE of the
 * functions here touch the DOM, canvas, or the store — they take a clip's text
 * bags and return plain data.
 *
 * The resolvers here are the EDIT-time mirror of the PAINT-time resolvers in
 * `preview/text*Spec.ts`: the paint resolvers bake rgba + sort/clamp for drawing,
 * whereas these preserve the AUTHOR's raw values + order so editing a row never
 * reorders the rows under the cursor. The two read the same bags, so what the
 * panel shows == what the preview/export draw (master plan §6).
 */
import {
  DEFAULT_TEXT_FILL,
  isHexColor,
  normalizeTextRuns,
  type TextRun
} from './preview/textFillSpec'
import { DEFAULT_TEXT_STROKE } from './preview/textStrokeSpec'
import { DEFAULT_TEXT_SHADOW } from './preview/textShadowSpec'
import { DEFAULT_DECORATION_BACKGROUND } from './preview/textDecorationSpec'
import type { GradientStop } from '../../../shared/captionPreset'
import type { ClipText } from '../../../shared/project-schema'

/**
 * Normalize a hex color for storage / the native `<input type=color>` (which only
 * accepts `#rrggbb`). Expands `#rgb`, drops an alpha nibble/byte, lowercases, and
 * always prefixes `#`. Falls back to white for an unparseable value. PURE.
 */
export function normalizeHex(hex: string): string {
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3 || h.length === 4) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  if (h.length === 8) h = h.slice(0, 6)
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return '#ffffff'
  return `#${h.toLowerCase()}`
}

/** Clamp a number into [lo,hi] (NaN → lo). */
export function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo
  return v < lo ? lo : v > hi ? hi : v
}

// ---------------------------------------------------------------------------
// Accordion sections
// ---------------------------------------------------------------------------

/** The collapsible sections of the Text panel, in display order. */
export type TextSectionId = 'typography' | 'color' | 'stroke' | 'shadow' | 'decorations' | 'effects'

export const TEXT_SECTIONS: readonly { id: TextSectionId; label: string }[] = [
  { id: 'typography', label: 'Typography' },
  { id: 'color', label: 'Color' },
  { id: 'stroke', label: 'Stroke' },
  { id: 'shadow', label: 'Shadow' },
  { id: 'decorations', label: 'Decorations' },
  { id: 'effects', label: 'Effects' }
] as const

/** Open/closed state of each section (an accordion that allows many open). */
export type SectionOpenState = Record<TextSectionId, boolean>

/** Default: Typography open, the rest collapsed (reduces initial clutter). */
export function defaultSectionState(): SectionOpenState {
  return { typography: true, color: false, stroke: false, shadow: false, decorations: false, effects: false }
}

/** Toggle one section's open flag (pure — returns a new object). */
export function toggleSection(state: SectionOpenState, id: TextSectionId): SectionOpenState {
  return { ...state, [id]: !state[id] }
}

// ---------------------------------------------------------------------------
// Color / fill
// ---------------------------------------------------------------------------

export interface FillState {
  hex: string
  opacity: number
  isGradient: boolean
  stops: GradientStop[]
  angle: number
}

/**
 * Project a clip's open `text.fill` bag onto the EDITABLE fill state (P6.7 solid +
 * P6.8 gradient). Reads the RAW hex/opacity/stops in AUTHOR order (so editing a
 * stop never reorders the rows). PURE.
 */
export function deriveFillState(fill: Record<string, unknown> | undefined): FillState {
  const bag = fill ?? {}
  const hexRaw =
    typeof bag.color === 'string' ? bag.color : typeof bag.value === 'string' ? bag.value : undefined
  const hex = hexRaw !== undefined && isHexColor(hexRaw) ? normalizeHex(hexRaw) : DEFAULT_TEXT_FILL.hex
  const opacity =
    typeof bag.opacity === 'number' && Number.isFinite(bag.opacity)
      ? clamp(bag.opacity, 0, 1)
      : DEFAULT_TEXT_FILL.opacity
  const isGradient = bag.type === 'gradient'
  const rawStops = Array.isArray(bag.value) ? (bag.value as unknown[]) : []
  const stops: GradientStop[] = rawStops
    .filter(
      (s): s is GradientStop =>
        typeof s === 'object' &&
        s !== null &&
        typeof (s as GradientStop).offset === 'number' &&
        isHexColor((s as GradientStop).color)
    )
    .map((s) => ({ offset: clamp(s.offset, 0, 1), color: normalizeHex(s.color) }))
  const angle = typeof bag.angle === 'number' && Number.isFinite(bag.angle) ? bag.angle : 0
  return { hex, opacity, isGradient, stops, angle }
}

// ---------------------------------------------------------------------------
// Per-word color (P6.9)
// ---------------------------------------------------------------------------

export interface WordState {
  words: string[]
  runs: TextRun[]
  /** Effective per-word override hex for word `i`, or `null` (uses base fill). */
  colorAt: (i: number) => string | null
}

/**
 * Project a clip's words + `text.runs` onto the per-word color edit state. The
 * WORDS come from `caption.words` (authored tokens) when present, else from
 * splitting the text lines on whitespace (matching the draw path). PURE.
 */
export function deriveWordState(text: ClipText | undefined, captionWords: { text: string }[] | undefined): WordState {
  const words: string[] = (() => {
    if (Array.isArray(captionWords) && captionWords.length > 0) return captionWords.map((w) => w.text)
    const lines = text?.lines ?? []
    return lines
      .join(' ')
      .split(' ')
      .filter((w) => w.length > 0)
  })()
  const runs = normalizeTextRuns(text?.runs)
  const colorAt = (i: number): string | null => {
    const c = runs[i]?.color
    return typeof c === 'string' && isHexColor(c) ? normalizeHex(c) : null
  }
  return { words, runs, colorAt }
}

// ---------------------------------------------------------------------------
// Text alignment (left / center / right) — Doc 01 §positioning
// ---------------------------------------------------------------------------

/** The three horizontal alignment options for a text clip. */
export type TextAlign = 'left' | 'center' | 'right'

/** Ordered list of alignment values for the segmented control. */
export const TEXT_ALIGN_OPTIONS: readonly TextAlign[] = ['left', 'center', 'right'] as const

/**
 * Read the current horizontal alignment from an open `clip.text` bag. Defaults
 * to `'center'` (matching the caption preset default) when absent or invalid.
 * PURE.
 */
export function deriveAlignState(text: ClipText | undefined): TextAlign {
  const raw = text?.align
  if (raw === 'left' || raw === 'right') return raw
  return 'center'
}

/**
 * Build the `clip.text` patch to write when the user picks an alignment.
 * Returns `{ align: value }` — a minimal patch for `setClipText`. PURE.
 */
export function setAlignPatch(value: TextAlign): Partial<ClipText> {
  return { align: value }
}

/**
 * Compute the next `runs` array setting/clearing WORD `i`'s color override.
 * PADS with empty runs up to `i` so a sparse override lands on the right word;
 * `null` CLEARS the override. Keeps other run fields (merge). PURE.
 */
export function setWordColorRuns(prevRuns: unknown, i: number, hex: string | null): TextRun[] {
  const prev = normalizeTextRuns(prevRuns)
  const len = Math.max(prev.length, i + 1)
  return Array.from({ length: len }, (_, idx) => {
    const run = prev[idx] ?? {}
    if (idx !== i) return { ...run }
    const merged = { ...run }
    if (hex === null) delete merged.color
    else merged.color = normalizeHex(hex)
    return merged
  })
}

// ---------------------------------------------------------------------------
// Stroke (P6.10 single / P6.11 stacked / P6.12 hollow)
// ---------------------------------------------------------------------------

export interface StrokeLayer {
  hex: string
  width: number
}

/** Project a clip's `text.stroke` list onto editable layers (author order). PURE. */
export function deriveStrokeLayers(stroke: unknown[] | undefined): StrokeLayer[] {
  const list = Array.isArray(stroke) ? stroke : []
  return list
    .filter((l): l is Record<string, unknown> => typeof l === 'object' && l !== null)
    .filter((bag) => typeof bag.width === 'number') // skip a bare hollow sentinel
    .map((bag) => {
      const hexRaw = typeof bag.color === 'string' ? bag.color : undefined
      const hex = hexRaw !== undefined && isHexColor(hexRaw) ? normalizeHex(hexRaw) : DEFAULT_TEXT_STROKE.hex
      const width =
        typeof bag.width === 'number' && Number.isFinite(bag.width) && bag.width > 0 ? bag.width : 0
      return { hex, width }
    })
}

/** True when ANY persisted stroke layer carries the `hollow: true` marker. PURE. */
export function deriveHollow(stroke: unknown[] | undefined): boolean {
  const list = Array.isArray(stroke) ? stroke : []
  return list.some((l) => typeof l === 'object' && l !== null && (l as { hollow?: unknown }).hollow === true)
}

/** Serialize editable layers (+ hollow marker) back into the persisted shape. PURE. */
export function strokeLayersToBag(
  layers: StrokeLayer[],
  hollow: boolean
): Record<string, unknown>[] {
  return layers.map((l) => ({
    color: normalizeHex(l.hex),
    width: Math.max(0, l.width),
    ...(hollow ? { hollow: true } : {})
  }))
}

/** Seed width for a NEW stroke layer: one step wider than the widest, else 8. PURE. */
export function nextStrokeWidth(layers: StrokeLayer[]): number {
  const widest = layers.reduce((m, l) => Math.max(m, l.width), 0)
  return widest > 0 ? Math.min(24, widest + 4) : 8
}

// ---------------------------------------------------------------------------
// Shadow (P6.13 drop / P6.14 inner+long)
// ---------------------------------------------------------------------------

export interface ShadowState {
  color: string
  opacity: number
  blur: number
  angle: number
  distance: number
  inner: boolean
  long: boolean
  type: 'drop' | 'inner' | 'long'
  on: boolean
}

/** Project a clip's `text.shadow` bag onto editable shadow state. PURE. */
export function deriveShadowState(shadow: Record<string, unknown> | undefined): ShadowState {
  const bag = typeof shadow === 'object' && shadow !== null ? shadow : {}
  const hexRaw = typeof bag.color === 'string' ? bag.color : undefined
  const color = hexRaw !== undefined && isHexColor(hexRaw) ? normalizeHex(hexRaw) : DEFAULT_TEXT_SHADOW.hex
  const opacity =
    typeof bag.opacity === 'number' && Number.isFinite(bag.opacity)
      ? clamp(bag.opacity, 0, 1)
      : DEFAULT_TEXT_SHADOW.opacity
  const blur = typeof bag.blur === 'number' && Number.isFinite(bag.blur) && bag.blur > 0 ? bag.blur : 0
  const rawAngle = typeof bag.angle === 'number' && Number.isFinite(bag.angle) ? bag.angle : 0
  const angle = clamp(rawAngle, -180, 180)
  const distance =
    typeof bag.distance === 'number' && Number.isFinite(bag.distance) && bag.distance > 0 ? bag.distance : 0
  const inner = bag.inner === true
  const long = bag.long === true
  const type: 'drop' | 'inner' | 'long' = long ? 'long' : inner ? 'inner' : 'drop'
  const on = distance > 0
  return { color, opacity, blur, angle, distance, inner, long, type, on }
}

// ---------------------------------------------------------------------------
// Decorations — background bubble (P7.8 — Doc 05)
// ---------------------------------------------------------------------------

/** Editable state of the decorations (background bubble + underline/strike rules). */
export interface DecorationState {
  /** Bubble enabled (a positive-opacity background is present). */
  backgroundOn: boolean
  color: string
  opacity: number
  /** Symmetric padding px around the text block. */
  padding: number
  /** Corner radius px (0 = sharp). */
  radius: number
  /** Underline rule enabled (P7.9). */
  underlineOn: boolean
  /** Underline color hex, or `''` to use the glyph fill (the default). */
  underlineColor: string
  /** Strikethrough rule enabled (P7.9). */
  strikeOn: boolean
  /** Strikethrough color hex, or `''` to use the glyph fill (the default). */
  strikeColor: string
  /** Highlight BAR enabled (P7.10 — the marker look; distinct from PresetHighlight). */
  highlightOn: boolean
  /** Highlight bar mode: one bar per word, or one per line. */
  highlightMode: 'word' | 'line'
  /** Highlight bar color hex. */
  highlightColor: string
  /** Highlight bar opacity 0..1. */
  highlightOpacity: number
  /** Highlight bar symmetric padding px around each framed box. */
  highlightPadding: number
  /** Highlight bar corner radius px (0 = sharp). */
  highlightRadius: number
}

/** Highlighter-pen yellow the bar UI seeds when first enabled (mirrors the resolver). */
export const DEFAULT_HIGHLIGHT_BAR_HEX = '#ffe600'
/** Default highlight-bar opacity the UI seeds (mirrors the resolver). */
export const DEFAULT_HIGHLIGHT_BAR_OPACITY = 0.4

/**
 * Project a clip's open `text.decoration` bag onto the EDITABLE background-bubble
 * state (P7.8). Reads the RAW author values (hex/opacity/padding/radius); `on` is
 * true when a background object with positive opacity is present. Backward
 * compatible — no decoration → off, default color/opacity, zero padding/radius. PURE.
 */
export function deriveDecorationState(decoration: Record<string, unknown> | undefined): DecorationState {
  const bag = typeof decoration === 'object' && decoration !== null ? decoration : {}
  const bg = typeof bag.background === 'object' && bag.background !== null
    ? (bag.background as Record<string, unknown>)
    : undefined
  const hexRaw = bg !== undefined && typeof bg.color === 'string' ? bg.color : undefined
  const color = hexRaw !== undefined && isHexColor(hexRaw) ? normalizeHex(hexRaw) : DEFAULT_DECORATION_BACKGROUND.hex
  const opacity =
    bg !== undefined && typeof bg.opacity === 'number' && Number.isFinite(bg.opacity)
      ? clamp(bg.opacity, 0, 1)
      : DEFAULT_DECORATION_BACKGROUND.opacity
  const padding =
    bg !== undefined && typeof bg.padding === 'number' && Number.isFinite(bg.padding) && bg.padding > 0 ? bg.padding : 0
  const radius =
    bg !== undefined && typeof bg.radius === 'number' && Number.isFinite(bg.radius) && bg.radius > 0 ? bg.radius : 0
  // A bubble is "on" when a background object exists with positive opacity.
  const backgroundOn = bg !== undefined && opacity > 0
  const underline = deriveRuleState(bag.underline)
  const strike = deriveRuleState(bag.strike)
  const highlight = deriveHighlightBarState(bag.highlightBar ?? bag.highlight)
  return {
    backgroundOn,
    color,
    opacity,
    padding,
    radius,
    underlineOn: underline.on,
    underlineColor: underline.color,
    strikeOn: strike.on,
    strikeColor: strike.color,
    highlightOn: highlight.on,
    highlightMode: highlight.mode,
    highlightColor: highlight.color,
    highlightOpacity: highlight.opacity,
    highlightPadding: highlight.padding,
    highlightRadius: highlight.radius
  }
}

/**
 * Project a `highlightBar` (or legacy `highlight`) sub-bag onto its editable state
 * (P7.10), mirroring the PAINT-time `resolveHighlightBar`. An object is ON unless
 * `enabled:false`; opacity <= 0 is OFF; mode defaults to `'word'`; color/opacity fall
 * back to the highlighter defaults. Anything non-object → off. PURE. This is the
 * marker BAR — NOT the caption active-word `PresetHighlight` (P5.6).
 */
function deriveHighlightBarState(highlight: unknown): {
  on: boolean
  mode: 'word' | 'line'
  color: string
  opacity: number
  padding: number
  radius: number
} {
  const off = {
    on: false,
    mode: 'word' as const,
    color: DEFAULT_HIGHLIGHT_BAR_HEX,
    opacity: DEFAULT_HIGHLIGHT_BAR_OPACITY,
    padding: 0,
    radius: 0
  }
  if (typeof highlight !== 'object' || highlight === null) return off
  const obj = highlight as Record<string, unknown>
  if (obj.enabled === false) return off
  const opacity =
    typeof obj.opacity === 'number' && Number.isFinite(obj.opacity)
      ? clamp(obj.opacity, 0, 1)
      : DEFAULT_HIGHLIGHT_BAR_OPACITY
  if (!(opacity > 0)) return off
  const color = typeof obj.color === 'string' && isHexColor(obj.color) ? normalizeHex(obj.color) : DEFAULT_HIGHLIGHT_BAR_HEX
  const mode: 'word' | 'line' = obj.mode === 'line' ? 'line' : 'word'
  const padding = typeof obj.padding === 'number' && Number.isFinite(obj.padding) && obj.padding > 0 ? obj.padding : 0
  const radius = typeof obj.radius === 'number' && Number.isFinite(obj.radius) && obj.radius > 0 ? obj.radius : 0
  return { on: true, mode, color, opacity, padding, radius }
}

/**
 * Project an `underline` / `strike` sub-bag onto its editable `{on,color}` state,
 * mirroring the PAINT-time {@link resolveRule}. `true` → on, no explicit color.
 * An object is on unless `enabled:false`; a valid hex color is preserved, else `''`
 * (empty = "use the glyph fill"). Anything else → off. PURE.
 */
function deriveRuleState(rule: unknown): { on: boolean; color: string } {
  if (rule === true) return { on: true, color: '' }
  if (typeof rule !== 'object' || rule === null) return { on: false, color: '' }
  const obj = rule as Record<string, unknown>
  if (obj.enabled === false) return { on: false, color: '' }
  const color = typeof obj.color === 'string' && isHexColor(obj.color) ? normalizeHex(obj.color) : ''
  return { on: true, color }
}

/**
 * Serialize the editable background-bubble state back into the persisted
 * `text.decoration` shape, MERGING onto any existing decoration bag (so future
 * underline/strike/highlight/emoji fields survive). When `backgroundOn` is false
 * the `background` key is removed (no bubble). PURE.
 */
export function decorationToBag(
  prev: Record<string, unknown> | undefined,
  state: DecorationState
): Record<string, unknown> {
  const base = typeof prev === 'object' && prev !== null ? { ...prev } : {}
  if (!state.backgroundOn) {
    delete base.background
  } else {
    base.background = {
      color: normalizeHex(state.color),
      opacity: clamp(state.opacity, 0, 1),
      padding: Math.max(0, state.padding),
      radius: Math.max(0, state.radius)
    }
  }
  // Underline / strike rules (P7.9): a rule key is REMOVED when off (so an existing
  // clip never gains one); on → `{enabled:true, color?}` (color omitted = glyph fill).
  serializeRule(base, 'underline', state.underlineOn, state.underlineColor)
  serializeRule(base, 'strike', state.strikeOn, state.strikeColor)
  // Highlight BAR (P7.10): persisted under `highlightBar` — DISTINCT from the caption
  // active-word `PresetHighlight` (P5.6). REMOVED when off (existing clips never gain
  // one). A legacy `highlight` key is dropped on write so the new key is canonical.
  delete base.highlight
  if (!state.highlightOn) {
    delete base.highlightBar
  } else {
    base.highlightBar = {
      enabled: true,
      mode: state.highlightMode === 'line' ? 'line' : 'word',
      color: normalizeHex(state.highlightColor),
      opacity: clamp(state.highlightOpacity, 0, 1),
      padding: Math.max(0, state.highlightPadding),
      radius: Math.max(0, state.highlightRadius)
    }
  }
  return base
}

/**
 * A short header summary of which decoration families are active, for the
 * Decorations section's `aside` (e.g. "Bubble · Bars · Underline", or "none"). Lists
 * each enabled family in render order (bubble, bars, underline, strike). PURE.
 */
export function decorationSummary(state: DecorationState): string {
  const parts: string[] = []
  if (state.backgroundOn) parts.push('Bubble')
  if (state.highlightOn) parts.push('Bars')
  if (state.underlineOn) parts.push('Underline')
  if (state.strikeOn) parts.push('Strike')
  return parts.length === 0 ? 'none' : parts.join(' · ')
}

/** Write/remove a `{enabled,color?}` rule key on a decoration bag in place. PURE-ish. */
function serializeRule(
  base: Record<string, unknown>,
  key: 'underline' | 'strike',
  on: boolean,
  color: string
): void {
  if (!on) {
    delete base[key]
    return
  }
  const rule: Record<string, unknown> = { enabled: true }
  if (color !== '' && isHexColor(color)) rule.color = normalizeHex(color)
  base[key] = rule
}

// ---------------------------------------------------------------------------
// Decorations — inline emoji palette (P7.11/P7.12 — Doc 05)
// ---------------------------------------------------------------------------

/**
 * A small curated palette of single-cluster emoji the Decorations panel offers as
 * one-tap inserts into the run flow (P7.11). Each entry is exactly ONE extended
 * grapheme cluster (incl. ZWJ sequences / skin-tone modifiers), so inserting it via
 * `insertEmojiAtCluster` / `appendEmoji` never splits a cluster and the glyph flows /
 * wraps / animates as one more cluster. Kept here (pure data) so it is one shared
 * list and unit-testable. PURE.
 */
export const EMOJI_PALETTE: readonly string[] = [
  '🎉', '🔥', '✨', '⭐', '❤️', '😂', '😍', '👍', '👏', '🙌',
  '💯', '🚀', '🎶', '💡', '✅', '⚡', '🌟', '😎', '🥳', '👀'
] as const

/** Format a 0..1 opacity as an integer percent string ("75%"). PURE. */
export function formatPercent(v: number): string {
  return `${Math.round(clamp(v, 0, 1) * 100)}%`
}

/** Format a pixel length to a fixed-precision "Npx" label. PURE. */
export function formatPx(v: number, digits = 0): string {
  return `${(Number.isFinite(v) ? v : 0).toFixed(digits)}px`
}

/** Format a degree value to a rounded "N°" label. PURE. */
export function formatDeg(v: number): string {
  return `${Math.round(Number.isFinite(v) ? v : 0)}°`
}

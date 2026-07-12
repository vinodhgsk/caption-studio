/**
 * Pure UI-logic for the EFFECTS panel (P7.7 — Doc 04; skill `text-render`). This
 * module owns the SINGLE, HEADLESS-SAFE operations the Effects section runs on a
 * clip's ORDERED effect stack (`clip.text.effects[]`), plus the per-type slider
 * METADATA the panel renders. NONE of it touches the DOM, canvas, or the store —
 * it takes a `TextEffect[]` (and the user's intent) and returns a NEW array, so the
 * component stays a thin wiring layer and these can be unit-tested directly.
 *
 * The DATA model (the `TextEffect` union, `defaultTextEffect`, validation,
 * `normalizeTextEffects`) lives in `shared/textEffect` — this module composes it.
 * Every mutator is IMMUTABLE (returns a fresh array; never mutates the input) and
 * preserves ORDER, because the array order IS the composite order the renderer/
 * export run (so the edited array round-trips through `normalizeTextEffects` and
 * paints identically in preview + export — master plan §6 parity).
 *
 * The panel reads the persisted (open) `clip.text.effects` through
 * {@link deriveEffects} → a typed `TextEffect[]`, edits it with the mutators here,
 * and writes the result back through the existing undoable `setClipText` path.
 */
import {
  TEXT_EFFECT_TYPES,
  defaultTextEffect,
  normalizeTextEffects,
  type TextEffect,
  type TextEffectType
} from '../../../shared/textEffect'

// ---------------------------------------------------------------------------
// Read side: open bag -> typed, ordered stack
// ---------------------------------------------------------------------------

/**
 * Project a clip's open `text.effects` bag onto the typed, VALID, ORDERED stack the
 * panel renders. Tolerant (drops malformed entries, preserves order) — delegates to
 * the shared `normalizeTextEffects` so the panel sees EXACTLY what the renderer/
 * export see. PURE.
 */
export function deriveEffects(effects: unknown): TextEffect[] {
  return normalizeTextEffects(effects)
}

// ---------------------------------------------------------------------------
// Mutators — all immutable, all order-preserving.
// ---------------------------------------------------------------------------

/**
 * APPEND a fresh {@link defaultTextEffect} of `type` to the END of the stack (so a
 * newly-added effect composes LAST / on top). Returns a new array. PURE.
 */
export function addEffect(effects: readonly TextEffect[], type: TextEffectType): TextEffect[] {
  // `defaultTextEffect(type)` is well-formed for `type`; the cast just collapses the
  // widened `params` union (from the generic `type`) back onto the `TextEffect` union.
  return [...effects, defaultTextEffect(type) as TextEffect]
}

/** REMOVE the effect at `index` (out-of-range → array unchanged, fresh copy). PURE. */
export function removeEffect(effects: readonly TextEffect[], index: number): TextEffect[] {
  if (index < 0 || index >= effects.length) return [...effects]
  return effects.filter((_, i) => i !== index)
}

/**
 * MOVE the effect at `from` to position `to`, shifting the others to fill the gap
 * and PRESERVING their relative order. Out-of-range `from` (or `from === to`) →
 * unchanged fresh copy; `to` is clamped into range. This is the reorder primitive
 * the up/down buttons and drag-to-reorder both call. PURE.
 */
export function moveEffect(effects: readonly TextEffect[], from: number, to: number): TextEffect[] {
  const n = effects.length
  if (from < 0 || from >= n) return [...effects]
  const target = to < 0 ? 0 : to >= n ? n - 1 : to
  if (target === from) return [...effects]
  const next = [...effects]
  const [moved] = next.splice(from, 1)
  next.splice(target, 0, moved)
  return next
}

/** Convenience over {@link moveEffect}: shift `index` one step toward the front. PURE. */
export function moveEffectUp(effects: readonly TextEffect[], index: number): TextEffect[] {
  return moveEffect(effects, index, index - 1)
}

/** Convenience over {@link moveEffect}: shift `index` one step toward the back. PURE. */
export function moveEffectDown(effects: readonly TextEffect[], index: number): TextEffect[] {
  return moveEffect(effects, index, index + 1)
}

/**
 * TOGGLE the `enabled` flag of the effect at `index` (or set it explicitly when
 * `value` is given). Out-of-range → unchanged fresh copy. PURE.
 */
export function setEffectEnabled(
  effects: readonly TextEffect[],
  index: number,
  value?: boolean
): TextEffect[] {
  return replaceAt(effects, index, (e) => ({ ...e, enabled: value ?? !e.enabled }))
}

/** Set the `intensity` (clamped 0..1) of the effect at `index`. PURE. */
export function setEffectIntensity(
  effects: readonly TextEffect[],
  index: number,
  intensity: number
): TextEffect[] {
  return replaceAt(effects, index, (e) => ({ ...e, intensity: clamp01(intensity) }))
}

/** Set the `opacity` (clamped 0..1) of the effect at `index`. PURE. */
export function setEffectOpacity(
  effects: readonly TextEffect[],
  index: number,
  opacity: number
): TextEffect[] {
  return replaceAt(effects, index, (e) => ({ ...e, opacity: clamp01(opacity) }))
}

/**
 * Update ONE per-type param `key` of the effect at `index`, merging into the
 * effect's existing `params` (so other params are preserved). Out-of-range index, or
 * a `key` that isn't a param of that effect's type, → unchanged fresh copy. PURE.
 */
export function setEffectParam(
  effects: readonly TextEffect[],
  index: number,
  key: string,
  value: number | string
): TextEffect[] {
  return replaceAt(effects, index, (e) => {
    const params = e.params as unknown as Record<string, unknown>
    if (!(key in params)) return e
    return { ...e, params: { ...params, [key]: value } }
  })
}

/**
 * Replace the effect at `index` with the result of `next(effect)`, preserving every
 * other entry + the order. Out-of-range index → unchanged fresh copy. Centralizes
 * the one `as TextEffect` cast the per-field mutators need (spreading a member of a
 * discriminated union widens it under `Array.map`). PURE.
 */
function replaceAt(
  effects: readonly TextEffect[],
  index: number,
  next: (e: TextEffect) => object
): TextEffect[] {
  return effects.map((e, i) => (i === index ? (next(e) as unknown as TextEffect) : e))
}

// ---------------------------------------------------------------------------
// Per-type param metadata — drives slider/color rendering for each effect.
// ---------------------------------------------------------------------------

/** The kind of control a param renders as (slider for numbers, swatch for hex). */
export type EffectParamKind = 'slider' | 'color'

/**
 * Metadata for ONE editable param of an effect type: how to label it, what control
 * to render, and (for sliders) the min/max/step + unit. The Effects panel maps over
 * `EFFECT_PARAM_META[type]` to render the per-type controls generically (no per-type
 * JSX branch). `key` is the param key on that type's `params`.
 */
export interface EffectParamMeta {
  /** The param key on the effect's `params` (e.g. `radius`, `color`, `splitDistance`). */
  key: string
  /** Human label for the control. */
  label: string
  /** Control kind. */
  kind: EffectParamKind
  /** Slider min (sliders only). */
  min?: number
  /** Slider max (sliders only). */
  max?: number
  /** Slider step (sliders only). */
  step?: number
  /** Value-readout unit: 'px' | 'deg' | 'ratio' (0..1 percent) | 'count' (sliders only). */
  unit?: 'px' | 'deg' | 'ratio' | 'count'
}

/**
 * Per-type param METADATA — one entry per editable param, in display order, for ALL
 * seven effect types (glow/neon/glitch/3d/retro/blur/echo). Mirrors the params
 * shapes + validators in `shared/textEffect`, so the panel's sliders match what the
 * schema accepts. The common `enabled`/`intensity`/`opacity` are rendered uniformly
 * by the panel and are NOT listed here (these are the per-TYPE params only).
 */
export const EFFECT_PARAM_META: { [T in TextEffectType]: readonly EffectParamMeta[] } = {
  glow: [
    { key: 'radius', label: 'Radius', kind: 'slider', min: 0, max: 60, step: 1, unit: 'px' },
    { key: 'color', label: 'Color', kind: 'color' }
  ],
  neon: [
    { key: 'radius', label: 'Radius', kind: 'slider', min: 0, max: 60, step: 1, unit: 'px' },
    { key: 'core', label: 'Core', kind: 'slider', min: 0, max: 12, step: 0.5, unit: 'px' },
    { key: 'color', label: 'Color', kind: 'color' }
  ],
  glitch: [
    { key: 'splitDistance', label: 'Split distance', kind: 'slider', min: 0, max: 40, step: 1, unit: 'px' },
    { key: 'frequency', label: 'Frequency', kind: 'slider', min: 0, max: 40, step: 1, unit: 'count' },
    { key: 'angle', label: 'Angle', kind: 'slider', min: -180, max: 180, step: 1, unit: 'deg' }
  ],
  '3d': [
    { key: 'depth', label: 'Depth', kind: 'slider', min: 0, max: 60, step: 1, unit: 'px' },
    { key: 'angle', label: 'Angle', kind: 'slider', min: -180, max: 180, step: 1, unit: 'deg' },
    { key: 'color', label: 'Color', kind: 'color' }
  ],
  retro: [
    { key: 'grain', label: 'Grain', kind: 'slider', min: 0, max: 1, step: 0.01, unit: 'ratio' },
    { key: 'chroma', label: 'Chroma', kind: 'slider', min: 0, max: 12, step: 0.5, unit: 'px' },
    { key: 'color', label: 'Color', kind: 'color' }
  ],
  blur: [{ key: 'radius', label: 'Radius', kind: 'slider', min: 0, max: 40, step: 1, unit: 'px' }],
  echo: [
    { key: 'count', label: 'Count', kind: 'slider', min: 1, max: 12, step: 1, unit: 'count' },
    { key: 'distance', label: 'Distance', kind: 'slider', min: 0, max: 40, step: 1, unit: 'px' },
    { key: 'angle', label: 'Angle', kind: 'slider', min: -180, max: 180, step: 1, unit: 'deg' },
    { key: 'falloff', label: 'Falloff', kind: 'slider', min: 0, max: 1, step: 0.01, unit: 'ratio' }
  ],
  bevel: [
    { key: 'size', label: 'Size', kind: 'slider', min: 0, max: 24, step: 0.5, unit: 'px' },
    { key: 'angle', label: 'Light angle', kind: 'slider', min: -180, max: 180, step: 1, unit: 'deg' },
    { key: 'highlight', label: 'Highlight', kind: 'color' },
    { key: 'shadow', label: 'Shadow', kind: 'color' }
  ]
} as const

/** Human label for an effect type (gallery + stack header). PURE. */
export function effectTypeLabel(type: TextEffectType): string {
  return EFFECT_TYPE_LABELS[type]
}

const EFFECT_TYPE_LABELS: Record<TextEffectType, string> = {
  glow: 'Glow',
  neon: 'Neon',
  glitch: 'Glitch',
  '3d': '3D',
  retro: 'Retro',
  blur: 'Blur',
  echo: 'Echo',
  bevel: 'Bevel'
}

/** The gallery's ordered list of addable types + their labels. PURE. */
export function galleryItems(): readonly { type: TextEffectType; label: string }[] {
  return TEXT_EFFECT_TYPES.map((type) => ({ type, label: EFFECT_TYPE_LABELS[type] }))
}

// ---------------------------------------------------------------------------
// Small shared util
// ---------------------------------------------------------------------------

/** Clamp into [0,1] (non-finite → 0). PURE. */
export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return v < 0 ? 0 : v > 1 ? 1 : v
}

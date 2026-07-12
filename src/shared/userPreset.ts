/**
 * User-managed preset schema (P11.1, Doc 14 — preset-store skill).
 *
 * A `UserPreset` is a REUSABLE clip-style snapshot the user saves manually.
 * It differs from the built-in `CaptionPreset` gallery (P5) in that it is
 * user-created, mutable, importable, exportable, and carries per-aspect-ratio
 * layout VARIANTS so the same preset applies correctly to 9:16, 16:9, and 1:1
 * projects without cropping.
 *
 * Schema: { id, name, thumb, style, animation, variants }
 *   - style     — font + fill + stroke + shadow + effects + decoration
 *   - animation — in + out + loop + reveal refs
 *   - variants  — per-aspect layout overrides { '9:16', '16:9', '1:1' }
 *
 * Headless-safe: pure types + pure helpers. NO electron / node / DOM imports.
 */

import type { ClipText, ClipAnimation } from './project-schema'
import type { LayoutAnchor, PresetLayout } from './captionPreset'

export type { LayoutAnchor, PresetLayout }

// ---------------------------------------------------------------------------
// Aspect ratio key (canonical string for variant lookup)
// ---------------------------------------------------------------------------

export type AspectKey = '9:16' | '16:9' | '1:1'

/**
 * Per-aspect layout override. Lets the same preset position text correctly on
 * different project formats (lower-third y differs for 9:16 vs 16:9, for example).
 */
export interface PresetVariantLayout {
  anchor?: LayoutAnchor
  /** Normalized vertical offset override for the anchor (0..1 fraction of frame height from center). */
  y?: number
  safeMargin?: boolean
  maxLines?: number
  /** Block height override (px at design resolution, e.g. 1080p). */
  blockHeight?: number
}

/** All three format variants. All are optional — fall back to nearest available. */
export type PresetVariants = Partial<Record<AspectKey, PresetVariantLayout>>

// ---------------------------------------------------------------------------
// UserPreset
// ---------------------------------------------------------------------------

/**
 * A user-managed style preset (P11.1). Contains the full visual + animation
 * surface from the clip it was saved from, plus per-aspect layout variants.
 *
 * `thumb` is a data-URL (base64 PNG) generated at save time; omitted when the
 * renderer could not render a thumbnail (e.g. headless tests).
 */
export interface UserPreset {
  /** Stable id (UUID v4 assigned at save time). */
  id: string
  /** Human-readable name shown in the presets gallery. User-editable. */
  name: string
  /** ISO 8601 creation timestamp. */
  createdAt: string
  /** Optional data-URL thumbnail (base64 PNG, 220×96). */
  thumb?: string
  /** Captured visual style from the clip (`clip.text` subset). */
  style: UserPresetStyle
  /** Captured animation refs from the clip (`clip.animation`). */
  animation: ClipAnimation
  /** Per-aspect layout overrides (empty object → use project defaults). */
  variants: PresetVariants
}

/**
 * The visual style fields captured from a clip. Mirrors the fields a
 * `CaptionPreset` carries, but with a looser shape that survives forward/backward
 * compat more easily (all optional except for font, which must have at least family).
 */
export interface UserPresetStyle {
  font?: ClipText['font']
  fill?: ClipText['fill']
  stroke?: ClipText['stroke']
  shadow?: ClipText['shadow']
  effects?: ClipText['effects']
  decoration?: ClipText['decoration']
  align?: ClipText['align']
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/** Allowed top-level keys for import validation (OWASP: reject unknown fields). */
const USER_PRESET_KEYS = new Set<string>([
  'id', 'name', 'createdAt', 'thumb', 'style', 'animation', 'variants'
])

const ASPECT_KEYS = new Set<string>(['9:16', '16:9', '1:1'])
const VARIANT_KEYS = new Set<string>(['anchor', 'y', 'safeMargin', 'maxLines', 'blockHeight'])
const ANIMATION_KEYS = new Set<string>(['in', 'out', 'loop', 'reveal'])
const STYLE_KEYS = new Set<string>(['font', 'fill', 'stroke', 'shadow', 'effects', 'decoration', 'align'])

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** Validation error — human-readable message. */
export interface PresetValidationError {
  field: string
  message: string
}

/**
 * Validate a raw JSON object as a `UserPreset`.
 * - Rejects unknown top-level keys (injection guard).
 * - Rejects extra keys in `variants` and `animation` (unknown fields → reject).
 * - Returns an array of errors; empty = valid.
 */
export function validateUserPreset(raw: unknown): PresetValidationError[] {
  const errors: PresetValidationError[] = []

  if (!isPlainObject(raw)) {
    errors.push({ field: '(root)', message: 'Must be a plain object' })
    return errors
  }

  // Unknown top-level keys
  for (const key of Object.keys(raw)) {
    if (!USER_PRESET_KEYS.has(key)) {
      errors.push({ field: key, message: `Unknown preset field "${key}" — rejected` })
    }
  }

  if (typeof raw['id'] !== 'string' || raw['id'].trim() === '') {
    errors.push({ field: 'id', message: 'id must be a non-empty string' })
  } else if (!/^[A-Za-z0-9_-]+$/.test(raw['id'])) {
    errors.push({ field: 'id', message: 'id may only contain alphanumeric characters, dashes, and underscores' })
  }
  if (typeof raw['name'] !== 'string' || raw['name'].trim() === '') {
    errors.push({ field: 'name', message: 'name must be a non-empty string' })
  } else if (raw['name'].length > 80) {
    errors.push({ field: 'name', message: 'name must be 80 characters or fewer' })
  }
  if (typeof raw['createdAt'] !== 'string') {
    errors.push({ field: 'createdAt', message: 'createdAt must be a string' })
  }

  if (raw['thumb'] !== undefined && typeof raw['thumb'] !== 'string') {
    errors.push({ field: 'thumb', message: 'thumb must be a string or omitted' })
  }

  if (raw['style'] !== undefined) {
    if (!isPlainObject(raw['style'])) {
      errors.push({ field: 'style', message: 'style must be a plain object' })
    } else {
      for (const key of Object.keys(raw['style'])) {
        if (!STYLE_KEYS.has(key)) {
          errors.push({ field: `style.${key}`, message: `Unknown style field "${key}"` })
        }
      }
    }
  }

  if (raw['animation'] !== undefined) {
    if (!isPlainObject(raw['animation'])) {
      errors.push({ field: 'animation', message: 'animation must be a plain object' })
    } else {
      for (const key of Object.keys(raw['animation'])) {
        if (!ANIMATION_KEYS.has(key)) {
          errors.push({ field: `animation.${key}`, message: `Unknown animation key "${key}"` })
        }
      }
    }
  }

  if (raw['variants'] !== undefined) {
    if (!isPlainObject(raw['variants'])) {
      errors.push({ field: 'variants', message: 'variants must be a plain object' })
    } else {
      for (const [aspectKey, variantRaw] of Object.entries(raw['variants'])) {
        if (!ASPECT_KEYS.has(aspectKey)) {
          errors.push({ field: `variants.${aspectKey}`, message: `Unknown aspect key "${aspectKey}"` })
          continue
        }
        if (!isPlainObject(variantRaw)) {
          errors.push({ field: `variants.${aspectKey}`, message: 'Variant must be a plain object' })
          continue
        }
        for (const vKey of Object.keys(variantRaw)) {
          if (!VARIANT_KEYS.has(vKey)) {
            errors.push({ field: `variants.${aspectKey}.${vKey}`, message: `Unknown variant field "${vKey}"` })
          }
        }
      }
    }
  }

  return errors
}

// ---------------------------------------------------------------------------
// Pack validator (import/export bundle: { schema: 1, presets: UserPreset[] })
// ---------------------------------------------------------------------------

export interface UserPresetPack {
  schema: 1
  presets: UserPreset[]
}

/**
 * Validate a raw JSON value as a `UserPresetPack` (P11.1 export format).
 * Returns an array of errors; empty array = valid.
 */
export function validateUserPresetPack(raw: unknown): PresetValidationError[] {
  if (!isPlainObject(raw)) {
    return [{ field: '(root)', message: 'Pack must be a plain object' }]
  }

  const errors: PresetValidationError[] = []

  if ((raw as Record<string, unknown>)['schema'] !== 1) {
    errors.push({ field: 'schema', message: 'schema must be 1' })
  }

  const presets = (raw as Record<string, unknown>)['presets']
  if (!Array.isArray(presets)) {
    errors.push({ field: 'presets', message: 'presets must be an array' })
    return errors
  }

  for (let i = 0; i < presets.length; i++) {
    const presetErrors = validateUserPreset(presets[i])
    for (const e of presetErrors) {
      errors.push({ field: `presets[${i}].${e.field}`, message: e.message })
    }
  }

  return errors
}

/**
 * Parse + validate a raw JSON value as a `UserPreset`.
 * Returns `{ ok: true; preset }` or `{ ok: false; errors }`.
 */
export function parseUserPreset(
  raw: unknown
): { ok: true; preset: UserPreset } | { ok: false; errors: PresetValidationError[] } {
  const errors = validateUserPreset(raw)
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, preset: raw as UserPreset }
}

// ---------------------------------------------------------------------------
// Variant resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the best layout variant for the given aspect key. Falls back:
 *   exact match → '9:16' (most common for this app) → any present variant → null.
 */
export function resolveVariant(
  variants: PresetVariants,
  aspect: AspectKey
): PresetVariantLayout | null {
  if (variants[aspect] !== undefined) return variants[aspect] as PresetVariantLayout
  if (variants['9:16'] !== undefined) return variants['9:16'] as PresetVariantLayout
  const fallback = Object.values(variants)[0]
  return fallback ?? null
}

// ---------------------------------------------------------------------------
// Snapshot helper (clip → UserPresetStyle)
// ---------------------------------------------------------------------------

/**
 * Extract a `UserPresetStyle` from a clip's `text` surface. Safe to call with
 * `undefined` — returns an empty style object.
 */
export function clipTextToPresetStyle(text: ClipText | undefined): UserPresetStyle {
  if (text === undefined) return {}
  const style: UserPresetStyle = {}
  if (text.font !== undefined) style.font = text.font
  if (text.fill !== undefined) style.fill = text.fill
  if (text.stroke !== undefined) style.stroke = text.stroke
  if (text.shadow !== undefined) style.shadow = text.shadow
  if (text.effects !== undefined) style.effects = text.effects
  if (text.decoration !== undefined) style.decoration = text.decoration
  if (text.align !== undefined) style.align = text.align
  return style
}

/**
 * Apply a `UserPresetStyle` onto a clip's `text` surface, merging (not replacing)
 * so that fields absent in the preset are preserved on the clip.
 */
export function applyPresetStyleToClipText(
  existing: ClipText | undefined,
  style: UserPresetStyle
): ClipText {
  return {
    ...(existing ?? {}),
    ...(style.font !== undefined ? { font: style.font } : {}),
    ...(style.fill !== undefined ? { fill: style.fill } : {}),
    ...(style.stroke !== undefined ? { stroke: style.stroke } : {}),
    ...(style.shadow !== undefined ? { shadow: style.shadow } : {}),
    ...(style.effects !== undefined ? { effects: style.effects } : {}),
    ...(style.decoration !== undefined ? { decoration: style.decoration } : {}),
    ...(style.align !== undefined ? { align: style.align } : {})
  }
}

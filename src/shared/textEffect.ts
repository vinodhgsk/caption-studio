/**
 * TextEffect schema (P7.1 — Doc 04 text effects; skill `text-render`).
 *
 * A `TextEffect` is ONE entry in a clip's ORDERED effect stack
 * (`clip.text.effects[]`, Doc 00 §4 / project-schema `ClipText.effects`). The
 * stack composes OVER the base glyph layer (shadow+stroke+fill+inner already
 * painted) at the canonical EFFECTS pass (P6.15 — pass 5 of
 * `textPaintPipeline`), in array order: `effects[0]` first, `effects[n-1]` last,
 * so a later effect decorates the result of the earlier ones (e.g. glow UNDER
 * glitch vs glitch UNDER glow is just the array order).
 *
 * This module is the SINGLE source of truth for the effect DATA model:
 *   - the discriminated union {@link TextEffect} (by `type`), one params shape per
 *     effect kind (glow/neon/glitch/3d/retro/blur/echo — Doc 04);
 *   - the common fields EVERY effect carries (`enabled`, `intensity`, `opacity`);
 *   - PURE validate ({@link validateTextEffect} / {@link validateTextEffects}) +
 *     default factories ({@link defaultTextEffect}) the Effects panel (P7.5) and
 *     the preset/clip mapping reuse.
 *
 * It is DATA ONLY — no canvas, no DOM. The RENDER side (how each type paints) is
 * the `EffectRenderer` registry in
 * `renderer/routes/editor/preview/textEffectsPipeline.ts`; P7.2–P7.6 register a
 * renderer per `type` there. Keeping the schema in `shared` (like
 * `captionPreset`) means the renderer (preview + Effects panel), a node/vitest
 * engine, AND the export path all import the SAME shape — so an effect stack
 * round-trips through save/reload and renders identically in preview + export
 * (master plan §6 parity).
 *
 * BACKWARD COMPATIBLE: `clip.text.effects` is OPTIONAL. No `effects` (or an empty
 * array) → the pipeline runs the existing no-op and the glyph is unchanged.
 */

// ---------------------------------------------------------------------------
// The closed set of effect TYPES (Doc 04 §"Data model touchpoints").
// ---------------------------------------------------------------------------

/**
 * The seven composable text-effect kinds (Doc 04). Each is the `type`
 * discriminant of a {@link TextEffect} variant:
 *   - `glow`   — soft luminous halo around the glyph (P7.2).
 *   - `neon`   — tighter bright core + saturated bloom (P7.2).
 *   - `glitch` — RGB channel split + scanline/jitter distortion (P7.3).
 *   - `3d`     — extruded depth (offset layers) (P7.4).
 *   - `retro`  — vintage palette + grain + slight chroma (P7.4).
 *   - `blur`   — gaussian blur of the layer (P7.4).
 *   - `echo`   — offset translucent copies / double-exposure (P7.4).
 */
export type TextEffectType = 'glow' | 'neon' | 'glitch' | '3d' | 'retro' | 'blur' | 'echo' | 'bevel'

/** The closed, ordered list of effect types (used by validation + the panel gallery). */
export const TEXT_EFFECT_TYPES: readonly TextEffectType[] = [
  'glow',
  'neon',
  'glitch',
  '3d',
  'retro',
  'blur',
  'echo',
  'bevel'
] as const

// ---------------------------------------------------------------------------
// Common fields every effect carries (the base of the discriminated union).
// ---------------------------------------------------------------------------

/**
 * Fields COMMON to every effect, regardless of `type`. Kept as a base so the
 * Effects panel (P7.5) can render a uniform on/off toggle + intensity/opacity
 * sliders for ANY effect, and so the pipeline can cheaply skip a disabled or
 * fully-transparent effect without knowing its `type`.
 */
export interface TextEffectBase {
  /** Per-effect on/off (the gallery toggle). `false` → the pipeline skips it. */
  enabled: boolean
  /**
   * Master strength 0..1 the renderer scales the effect's look by (a generic
   * "amount" slider). Each renderer maps it onto its own primary parameter
   * (glow brightness, glitch severity, …). 0 = effect contributes nothing.
   */
  intensity: number
  /**
   * Master opacity 0..1 applied to the effect's contribution (the composited
   * layer alpha). Distinct from `intensity` (which shapes the look); `opacity`
   * just fades the whole effect in/out. Defaults to 1.
   */
  opacity: number
}

// ---------------------------------------------------------------------------
// Per-type params. Each variant = TextEffectBase + { type, params }.
// ---------------------------------------------------------------------------

/** GLOW (P7.2): a soft luminous halo. `radius` px blur, `color` hex tint. */
export interface GlowEffectParams {
  /** Halo blur radius in px (>= 0). */
  radius: number
  /** Halo color (hex). */
  color: string
}

/** NEON (P7.2): tighter bright core + saturated outer bloom. */
export interface NeonEffectParams {
  /** Bloom blur radius in px (>= 0). */
  radius: number
  /** Neon color (hex) — both the core tint and the bloom. */
  color: string
  /** Inner core thickness in px (>= 0) — the bright crisp edge under the bloom. */
  core: number
}

/** GLITCH (P7.3): RGB channel split + scanline/jitter distortion. */
export interface GlitchEffectParams {
  /** RGB channel split distance in px (>= 0) — red/blue offset from green. */
  splitDistance: number
  /** Jitter/scanline frequency (>= 0) — how busy the distortion is. */
  frequency: number
  /**
   * Distortion ANGLE in degrees — the direction the channels split along.
   * 0 = horizontal split (the classic look). Any finite value (periodic).
   */
  angle: number
}

/** 3D depth (P7.4): extruded offset layers behind the glyph. */
export interface ThreeDEffectParams {
  /** Extrusion depth in px (>= 0) — how far the stack extrudes. */
  depth: number
  /** Extrusion direction in degrees (same convention as shadow angle). */
  angle: number
  /** Color (hex) of the extruded side layers. */
  color: string
}

/** RETRO/vintage (P7.4): palette + film grain + slight chroma shift. */
export interface RetroEffectParams {
  /** Grain amount 0..1 — film-grain noise strength. */
  grain: number
  /** Chroma/aberration shift in px (>= 0) — subtle color fringing. */
  chroma: number
  /** Palette tint color (hex) the layer is graded toward. */
  color: string
}

/** BLUR (P7.4): a gaussian blur of the glyph layer. */
export interface BlurEffectParams {
  /** Blur radius in px (>= 0). */
  radius: number
}

/** ECHO/double-exposure (P7.4): offset translucent copies trailing the glyph. */
export interface EchoEffectParams {
  /** Number of echo copies (integer >= 1). */
  count: number
  /** Per-copy offset distance in px (>= 0). */
  distance: number
  /** Offset direction in degrees (same convention as shadow angle). */
  angle: number
  /** Per-copy alpha falloff 0..1 — each successive copy fades by this factor. */
  falloff: number
}

/**
 * BEVEL / EMBOSS (gloss): a lit rim carved into the glyph — a bright `highlight`
 * inner edge on the light side and a `shadow` inner edge on the dark side, so the
 * letter reads as a rounded, polished-metal surface with a specular top. Fakes the
 * Photoshop Bevel & Emboss + gloss the devotional gold style wants (§2.4).
 */
export interface BevelEffectParams {
  /** Bevel edge width in px (>= 0) — how far the lit/shaded rims are inset. */
  size: number
  /** Highlight color (hex) — the lit rim (near-white for a metal gloss). */
  highlight: string
  /** Shadow color (hex) — the shaded rim on the opposite side. */
  shadow: string
  /** Light direction in degrees (shadow-angle convention: 90 = lit from top). */
  angle: number
}

/**
 * The TextEffect DISCRIMINATED UNION. Every variant is the common
 * {@link TextEffectBase} fields PLUS a `type` discriminant and that type's
 * `params`. A render dispatches on `type` (the registry maps `type` →
 * `EffectRenderer`); a UI dispatches on `type` to pick its slider set.
 */
export type TextEffect =
  | (TextEffectBase & { type: 'glow'; params: GlowEffectParams })
  | (TextEffectBase & { type: 'neon'; params: NeonEffectParams })
  | (TextEffectBase & { type: 'glitch'; params: GlitchEffectParams })
  | (TextEffectBase & { type: '3d'; params: ThreeDEffectParams })
  | (TextEffectBase & { type: 'retro'; params: RetroEffectParams })
  | (TextEffectBase & { type: 'blur'; params: BlurEffectParams })
  | (TextEffectBase & { type: 'echo'; params: EchoEffectParams })
  | (TextEffectBase & { type: 'bevel'; params: BevelEffectParams })

/** Narrowing helper: the params type for a given effect `type`. */
export type ParamsForType<T extends TextEffectType> = Extract<TextEffect, { type: T }>['params']

// ---------------------------------------------------------------------------
// Default factory
// ---------------------------------------------------------------------------

/** The per-type default params each factory variant produces. */
const DEFAULT_PARAMS: { [T in TextEffectType]: ParamsForType<T> } = {
  glow: { radius: 12, color: '#ffffff' },
  neon: { radius: 16, color: '#00eaff', core: 2 },
  glitch: { splitDistance: 4, frequency: 8, angle: 0 },
  '3d': { depth: 8, angle: 45, color: '#000000' },
  retro: { grain: 0.3, chroma: 1.5, color: '#f4e7c5' },
  blur: { radius: 4 },
  echo: { count: 3, distance: 6, angle: 0, falloff: 0.5 },
  bevel: { size: 4, highlight: '#fffef2', shadow: '#5c3a00', angle: 90 }
}

/**
 * A well-formed default {@link TextEffect} for `type` — enabled, full
 * intensity/opacity, with the per-type default params. The Effects panel (P7.5)
 * calls this when the user adds an effect from the gallery; it always passes
 * {@link validateTextEffect}.
 */
export function defaultTextEffect<T extends TextEffectType>(
  type: T
): TextEffectBase & { type: T; params: ParamsForType<T> } {
  return {
    type,
    enabled: true,
    intensity: 1,
    opacity: 1,
    params: { ...DEFAULT_PARAMS[type] } as ParamsForType<T>
  } as TextEffectBase & { type: T; params: ParamsForType<T> }
}

// ---------------------------------------------------------------------------
// Validation (pure, never throws)
// ---------------------------------------------------------------------------

/** A single validation failure: the dotted field path + a human reason. */
export interface TextEffectIssue {
  path: string
  message: string
}

/** Result of {@link validateTextEffect}. */
export type TextEffectValidation =
  | { ok: true; value: TextEffect }
  | { ok: false; issues: TextEffectIssue[] }

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

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

/** Per-type params validators. Each pushes issues under `params.*`. */
const PARAM_VALIDATORS: {
  [T in TextEffectType]: (
    p: Record<string, unknown>,
    bad: (path: string, msg: string) => void
  ) => void
} = {
  glow: (p, bad) => {
    if (!isNum(p.radius) || (p.radius as number) < 0) bad('params.radius', 'must be a number >= 0')
    if (!isHex(p.color)) bad('params.color', 'must be a hex color')
  },
  neon: (p, bad) => {
    if (!isNum(p.radius) || (p.radius as number) < 0) bad('params.radius', 'must be a number >= 0')
    if (!isHex(p.color)) bad('params.color', 'must be a hex color')
    if (!isNum(p.core) || (p.core as number) < 0) bad('params.core', 'must be a number >= 0')
  },
  glitch: (p, bad) => {
    if (!isNum(p.splitDistance) || (p.splitDistance as number) < 0)
      bad('params.splitDistance', 'must be a number >= 0')
    if (!isNum(p.frequency) || (p.frequency as number) < 0)
      bad('params.frequency', 'must be a number >= 0')
    if (!isNum(p.angle)) bad('params.angle', 'must be a number')
  },
  '3d': (p, bad) => {
    if (!isNum(p.depth) || (p.depth as number) < 0) bad('params.depth', 'must be a number >= 0')
    if (!isNum(p.angle)) bad('params.angle', 'must be a number')
    if (!isHex(p.color)) bad('params.color', 'must be a hex color')
  },
  retro: (p, bad) => {
    if (!isNum(p.grain) || !inRange(p.grain as number, 0, 1)) bad('params.grain', 'must be 0..1')
    if (!isNum(p.chroma) || (p.chroma as number) < 0) bad('params.chroma', 'must be a number >= 0')
    if (!isHex(p.color)) bad('params.color', 'must be a hex color')
  },
  blur: (p, bad) => {
    if (!isNum(p.radius) || (p.radius as number) < 0) bad('params.radius', 'must be a number >= 0')
  },
  echo: (p, bad) => {
    if (!isNum(p.count) || !Number.isInteger(p.count) || (p.count as number) < 1)
      bad('params.count', 'must be an integer >= 1')
    if (!isNum(p.distance) || (p.distance as number) < 0)
      bad('params.distance', 'must be a number >= 0')
    if (!isNum(p.angle)) bad('params.angle', 'must be a number')
    if (!isNum(p.falloff) || !inRange(p.falloff as number, 0, 1))
      bad('params.falloff', 'must be 0..1')
  },
  bevel: (p, bad) => {
    if (!isNum(p.size) || (p.size as number) < 0) bad('params.size', 'must be a number >= 0')
    if (!isHex(p.highlight)) bad('params.highlight', 'must be a hex color')
    if (!isHex(p.shadow)) bad('params.shadow', 'must be a hex color')
    if (!isNum(p.angle)) bad('params.angle', 'must be a number')
  }
}

/**
 * Validate an arbitrary value as a {@link TextEffect}. Returns a discriminated
 * result: `{ ok:true, value }` (narrowed) or `{ ok:false, issues }` listing every
 * problem (bad `type`, missing/out-of-range common field, malformed params for
 * the discriminated type). PURE; never throws.
 *
 * REQUIRED: `type` (one of {@link TEXT_EFFECT_TYPES}), `enabled` (boolean),
 * `intensity` (0..1), `opacity` (0..1), and a `params` object valid for `type`.
 */
export function validateTextEffect(input: unknown): TextEffectValidation {
  const issues: TextEffectIssue[] = []
  const bad = (path: string, message: string): void => {
    issues.push({ path, message })
  }

  if (!isObj(input)) {
    return { ok: false, issues: [{ path: '', message: 'effect must be an object' }] }
  }

  // type discriminant
  const type = input.type
  const knownType = isStr(type) && (TEXT_EFFECT_TYPES as readonly string[]).includes(type)
  if (!knownType) bad('type', `must be one of ${TEXT_EFFECT_TYPES.join('|')}`)

  // common fields
  if (!isBool(input.enabled)) bad('enabled', 'required boolean')
  if (!isNum(input.intensity) || !inRange(input.intensity as number, 0, 1))
    bad('intensity', 'must be 0..1')
  if (!isNum(input.opacity) || !inRange(input.opacity as number, 0, 1)) bad('opacity', 'must be 0..1')

  // params (only when the type is known — otherwise we cannot pick a validator)
  if (!isObj(input.params)) {
    bad('params', 'required object')
  } else if (knownType) {
    PARAM_VALIDATORS[type as TextEffectType](input.params, bad)
  }

  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, value: input as unknown as TextEffect }
}

/** Convenience boolean guard built on {@link validateTextEffect}. */
export function isTextEffect(input: unknown): input is TextEffect {
  return validateTextEffect(input).ok
}

/**
 * Validate an ORDERED effect STACK (`clip.text.effects[]`). PURE + tolerant:
 *   - `undefined` / not an array → `{ ok:true, value: [] }` (backward compatible —
 *     a clip with no effects has an empty, valid stack).
 *   - an array → each entry validated by {@link validateTextEffect}; issues are
 *     prefixed with the array index (`[i].path`) so the panel can pinpoint a bad
 *     effect. ORDER is preserved verbatim (the stack is positional).
 */
export function validateTextEffects(
  input: unknown
):
  | { ok: true; value: TextEffect[] }
  | { ok: false; issues: TextEffectIssue[] } {
  if (input === undefined || input === null) return { ok: true, value: [] }
  if (!Array.isArray(input)) {
    return { ok: false, issues: [{ path: '', message: 'effects must be an array' }] }
  }
  const issues: TextEffectIssue[] = []
  const value: TextEffect[] = []
  input.forEach((raw, i) => {
    const res = validateTextEffect(raw)
    if (res.ok) value.push(res.value)
    else for (const issue of res.issues) issues.push({ path: `[${i}]${issue.path ? '.' + issue.path : ''}`, message: issue.message })
  })
  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, value }
}

/**
 * Normalize a clip's open `clip.text.effects` bag into a typed, VALID `TextEffect[]`.
 * PURE + tolerant — drops any malformed entry (so a partially-corrupt project never
 * crashes the renderer) while PRESERVING the order of the surviving effects. This is
 * the renderer/export entry point ({@link validateTextEffects} is the strict variant
 * the panel uses to surface issues).
 */
export function normalizeTextEffects(input: unknown): TextEffect[] {
  if (!Array.isArray(input)) return []
  const out: TextEffect[] = []
  for (const raw of input) {
    const res = validateTextEffect(raw)
    if (res.ok) out.push(res.value)
  }
  return out
}

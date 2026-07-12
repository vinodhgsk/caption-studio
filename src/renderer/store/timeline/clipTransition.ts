/**
 * Transition engine (P9.1) — pure blend evaluator over the overlap window.
 *
 * PURE: no DOM, no Date, no Math.random (glitch uses mulberry32 in presets).
 * This module is the single source of truth for both the preview compositor
 * and the export pipeline. Any new transition preset registers here; the
 * compositor + xfade mapper both read through the same registry.
 *
 * Headless-safe: no DOM / electron / node imports.
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/**
 * Normalized transition phase at a single playhead position within the
 * overlap window.  `progress` runs 0 (start of overlap) → 1 (end of overlap).
 */
export interface TransitionPhase {
  /** Normalized time through the overlap window: 0 = start, 1 = end. */
  progress: number
  /** Slide / zoom directional hint (absent for non-directional presets). */
  direction?: 'l' | 'r' | 't' | 'b'
  /** Arbitrary per-preset parameters (e.g. width/height for slide). */
  params: Record<string, unknown>
}

/**
 * Compositing recipe for one frame of the transition: how to draw the outgoing
 * clip (A) and the incoming clip (B) on top of each other.
 *
 * The preview compositor applies these values via CSS transforms (or canvas
 * ctx save/restore / globalAlpha) so a pure evaluator drives both DOM and
 * canvas rendering paths with no duplication.
 *
 * Convention:
 *  - A = outgoing (the clip whose timeline position ends first)
 *  - B = incoming (the clip whose timeline position starts last / overlaps A)
 *  - Translate values are in project-resolution pixels (typically 1920×1080)
 *  - Scale is a uniform multiplier (1 = no change)
 */
export interface TransitionSample {
  /** Outgoing clip opacity, 1→0 over the transition. */
  aOpacity: number
  /** Outgoing clip x-translate offset (pixels). */
  aTx: number
  /** Outgoing clip y-translate offset (pixels). */
  aTy: number
  /** Outgoing clip scale multiplier. */
  aScale: number

  /** Incoming clip opacity, 0→1 over the transition. */
  bOpacity: number
  /** Incoming clip x-translate offset (pixels). */
  bTx: number
  /** Incoming clip y-translate offset (pixels). */
  bTy: number
  /** Incoming clip scale multiplier. */
  bScale: number
}

/**
 * Identity sample: A fully visible, B invisible, no transform.
 * Used as a fallback when no transition is configured.
 */
export const IDENTITY_TRANSITION: TransitionSample = {
  aOpacity: 1,
  aTx: 0,
  aTy: 0,
  aScale: 1,
  bOpacity: 0,
  bTx: 0,
  bTy: 0,
  bScale: 1
} as const

/** A transition preset function: maps a phase to a compositing sample. */
export type TransitionPreset = (phase: TransitionPhase) => TransitionSample

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const _registry = new Map<string, TransitionPreset>()

/** Register a named transition preset. Overrides any prior registration. */
export function registerTransition(id: string, fn: TransitionPreset): void {
  _registry.set(id, fn)
}

/** Look up a named transition preset by id. Returns undefined when absent. */
export function getTransition(id: string): TransitionPreset | undefined {
  return _registry.get(id)
}

// ---------------------------------------------------------------------------
// TransitionRef — the persisted descriptor in clips[].transitions.{in|out}
// ---------------------------------------------------------------------------

/**
 * A persisted transition descriptor stored in `clips[].transitions.out` (the
 * outgoing side) or `clips[].transitions.in` (the incoming side).
 *
 * Stored as `Record<string, unknown>` on the schema (open, forward-compatible).
 * Use `resolveTransition` to parse the raw bag into this typed shape.
 */
export interface TransitionRef {
  /** The registered preset id (e.g. 'dissolve', 'slide', 'zoom', 'glitch'). */
  presetId: string
  /** Overlap window duration in seconds. */
  duration: number
  /** Directional hint for slide/zoom presets. */
  direction?: 'l' | 'r' | 't' | 'b'
  /** Arbitrary preset-specific parameters. */
  params: Record<string, unknown>
}

/** Validate a direction string is a valid value. */
function isDirection(v: unknown): v is 'l' | 'r' | 't' | 'b' {
  return v === 'l' || v === 'r' || v === 't' || v === 'b'
}

/**
 * Parse a raw `clips[].transitions.{in|out}` bag into a typed `TransitionRef`.
 * Returns undefined when the bag is absent or lacks a required `presetId`.
 */
export function resolveTransition(
  ref: Record<string, unknown> | undefined
): TransitionRef | undefined {
  if (ref === undefined) return undefined
  const presetId = ref['presetId']
  if (typeof presetId !== 'string' || presetId.length === 0) return undefined

  const rawDuration = ref['duration']
  const duration =
    typeof rawDuration === 'number' && rawDuration > 0 ? rawDuration : 1

  const rawDir = ref['direction']
  const direction = isDirection(rawDir) ? rawDir : undefined

  const rawParams = ref['params']
  const params: Record<string, unknown> =
    rawParams !== null && typeof rawParams === 'object' && !Array.isArray(rawParams)
      ? (rawParams as Record<string, unknown>)
      : {}

  return { presetId, duration, direction, params }
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate the transition at the current playhead time `t`, given the outgoing
 * clip's timeline end and the `TransitionRef` describing the preset + overlap.
 *
 * The overlap window is `[clipAEnd - ref.duration, clipAEnd]` — the period
 * during which both the outgoing and incoming clips are simultaneously visible.
 * `progress` is clamped to [0,1] so callers may pass times slightly outside the
 * window without getting NaN/Infinity.
 *
 * Returns `IDENTITY_TRANSITION` when the preset is not registered.
 */
export function evaluateTransition(opts: {
  ref: TransitionRef
  /** Timeline seconds: absolute end of the outgoing clip (clip A). */
  clipAEnd: number
  /** Current playhead time in seconds. */
  t: number
}): TransitionSample {
  const { ref, clipAEnd, t } = opts
  const preset = getTransition(ref.presetId)
  if (preset === undefined) return { ...IDENTITY_TRANSITION }

  const windowStart = clipAEnd - ref.duration
  const rawProgress = ref.duration > 0 ? (t - windowStart) / ref.duration : 1
  const progress = Math.max(0, Math.min(1, rawProgress))

  const phase: TransitionPhase = {
    progress,
    direction: ref.direction,
    params: ref.params
  }

  return preset(phase)
}

/**
 * Pure UI-logic for the Animation panel (P8.5 — Doc 06 text animation; skills
 * `keyframe-engine` + `indic-text`). This module owns the SINGLE, HEADLESS-SAFE
 * projections between a clip's open `clip.animation.{in|out|loop}` bags and the
 * strongly-typed, EDITABLE values the panel's In / Out / Loop tabs render, plus
 * the tab-state, the gallery preset lists (from the P8.2–P8.4 catalogs), the
 * easing-name list for the dropdown, and the serializers that turn an edited lane
 * back into the persisted bag.
 *
 * Keeping these out of the React component means they can be unit-tested directly
 * (no DOM) and the component stays a thin wiring layer. NONE of the functions
 * here touch the DOM, canvas, or the store — they take a clip's animation bags and
 * return plain data, and the writers return a `Partial<ClipAnimation>` patch the
 * component hands to the undoable `setClipAnimation` command.
 *
 * The resolvers here are the EDIT-time mirror of the PAINT-time resolvers in
 * `clipAnimation.ts` (`resolveLane` / `resolveLoopLane`): the paint resolvers DROP
 * a `none`/zero-duration lane to identity, whereas these preserve the AUTHOR's raw
 * preset + duration/speed/easing/stagger so editing one control never disturbs the
 * others. Both read the same bags, so what the panel shows == what the preview /
 * export draw (master plan §6).
 */
import type { ClipAnimation } from '../../../shared/project-schema'
import { EASING_NAMES, type EasingName } from '../../../shared/easing'
import {
  IN_PRESET_CATALOG,
  type InPresetEntry
} from '../../store/timeline/clipAnimationPresetsIn'
import {
  OUT_PRESET_CATALOG,
  type OutPresetEntry
} from '../../store/timeline/clipAnimationPresetsOut'
import {
  LOOP_PRESET_CATALOG,
  type LoopPresetEntry
} from '../../store/timeline/clipAnimationPresetsLoop'

// ---------------------------------------------------------------------------
// Tabs (In / Out / Loop lanes)
// ---------------------------------------------------------------------------

/** The three animation lanes, each a tab in the panel. Maps 1:1 to `clip.animation` keys. */
export type AnimTab = 'in' | 'out' | 'loop'

/** The tabs in display order, with their human labels. PURE data. */
export const ANIM_TABS: readonly { id: AnimTab; label: string }[] = [
  { id: 'in', label: 'In' },
  { id: 'out', label: 'Out' },
  { id: 'loop', label: 'Loop' }
] as const

/** The default active tab when the panel first mounts. */
export const DEFAULT_ANIM_TAB: AnimTab = 'in'

/** Switch the active tab (pure — returns the next tab id; identity for an unknown id). */
export function selectTab(_current: AnimTab, next: AnimTab): AnimTab {
  return next === 'in' || next === 'out' || next === 'loop' ? next : _current
}

// ---------------------------------------------------------------------------
// Galleries — the catalog preset lists surfaced as thumbnails per tab
// ---------------------------------------------------------------------------

/** A gallery item the panel renders as a selectable preset thumbnail. PURE. */
export interface GalleryItem {
  /** Stable preset id (persisted to `clip.animation[tab].preset`). */
  id: string
  /** Human-readable label. */
  label: string
}

/** The In gallery (P8.2 catalog order). */
export function inGallery(): GalleryItem[] {
  return IN_PRESET_CATALOG.map((e: InPresetEntry) => ({ id: e.id, label: e.label }))
}
/** The Out gallery (P8.3 catalog order). */
export function outGallery(): GalleryItem[] {
  return OUT_PRESET_CATALOG.map((e: OutPresetEntry) => ({ id: e.id, label: e.label }))
}
/** The Loop gallery (P8.4 catalog order). */
export function loopGallery(): GalleryItem[] {
  return LOOP_PRESET_CATALOG.map((e: LoopPresetEntry) => ({ id: e.id, label: e.label }))
}

/** The gallery for a given tab. PURE. */
export function galleryFor(tab: AnimTab): GalleryItem[] {
  return tab === 'in' ? inGallery() : tab === 'out' ? outGallery() : loopGallery()
}

/** Look up a tab's catalog default easing for a preset id (In/Out only). */
function defaultEasingFor(tab: 'in' | 'out', presetId: string): EasingName {
  const catalog = tab === 'in' ? IN_PRESET_CATALOG : OUT_PRESET_CATALOG
  const entry = catalog.find((e) => e.id === presetId)
  return (entry?.defaultEasing as EasingName) ?? 'linear'
}

/** Look up the Loop catalog default period (seconds at speed 1) for a preset id. */
function defaultDurationForLoop(presetId: string): number {
  const entry = LOOP_PRESET_CATALOG.find((e) => e.id === presetId)
  return entry?.defaultDurationSec ?? 1
}

// ---------------------------------------------------------------------------
// Easing dropdown — the shared named-curve list
// ---------------------------------------------------------------------------

/** The easing names the dropdown offers (the shared keyframe-engine registry). */
export const EASING_OPTIONS: readonly EasingName[] = EASING_NAMES

/** True when `name` is a known easing name (else the panel falls back to `linear`). */
export function isEasingName(name: string): name is EasingName {
  return (EASING_NAMES as readonly string[]).includes(name)
}

// ---------------------------------------------------------------------------
// Stagger — per-character (grapheme cluster, Indic-aware) / per-word
// ---------------------------------------------------------------------------

/** The stagger unit: per grapheme-cluster (`character`) or per `word`. */
export type StaggerUnit = 'character' | 'word'

/** The editable per-unit stagger state (off → `enabled:false`). */
export interface StaggerState {
  /** Whether a per-unit stagger is applied (delay > 0 with a unit). */
  enabled: boolean
  /** The stagger unit (character = grapheme cluster, Indic-aware). */
  unit: StaggerUnit
  /** Per-index delay, seconds (>= 0). */
  delaySec: number
}

/** The default per-unit delay seeded when a stagger is first enabled. */
export const DEFAULT_STAGGER_DELAY_SEC = 0.05

// ---------------------------------------------------------------------------
// Editable lane state — In / Out (duration) and Loop (speed)
// ---------------------------------------------------------------------------

/** Editable state of an In or Out lane (entrance/exit). */
export interface InOutLaneState {
  /** Selected preset id, or `'none'` when the lane is off. */
  preset: string
  /** Animation duration, seconds. */
  durationSec: number
  /** The easing curve name. */
  easing: EasingName
  /** Per-unit stagger. */
  stagger: StaggerState
}

/** Editable state of the Loop lane (continuous). */
export interface LoopLaneState {
  /** Selected preset id, or `'none'` when the lane is off. */
  preset: string
  /** Loop period, seconds at speed 1. */
  durationSec: number
  /** Speed multiplier (>0; higher = faster cycles). */
  speed: number
  /** The easing curve name. */
  easing: EasingName
  /** Per-unit stagger. */
  stagger: StaggerState
}

/** The default In/Out duration (seconds) seeded when a preset is first picked. */
export const DEFAULT_IN_OUT_DURATION_SEC = 0.6
/** The default Loop speed multiplier. */
export const DEFAULT_LOOP_SPEED = 1

function clampNum(v: unknown, fallback: number, lo: number, hi: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return v < lo ? lo : v > hi ? hi : v
}

function easingOf(v: unknown, fallback: EasingName): EasingName {
  return typeof v === 'string' && isEasingName(v) ? v : fallback
}

/**
 * Project a raw `stagger` sub-bag onto its editable state. A stagger is ON only
 * when a valid `unit` is present AND `delaySec > 0` (mirrors the paint-time
 * {@link import('../../store/timeline/clipAnimation').AnimStagger} resolver). PURE.
 */
function deriveStagger(ref: Record<string, unknown> | undefined): StaggerState {
  const s = ref?.stagger
  if (typeof s !== 'object' || s === null) {
    return { enabled: false, unit: 'character', delaySec: DEFAULT_STAGGER_DELAY_SEC }
  }
  const obj = s as Record<string, unknown>
  const unit: StaggerUnit = obj.unit === 'word' ? 'word' : 'character'
  const delaySec = clampNum(obj.delaySec, 0, 0, 60)
  return { enabled: delaySec > 0, unit, delaySec: delaySec > 0 ? delaySec : DEFAULT_STAGGER_DELAY_SEC }
}

/** Project a raw In/Out lane bag onto its editable state (author values preserved). PURE. */
export function deriveInOutLane(ref: Record<string, unknown> | undefined): InOutLaneState {
  const bag = ref ?? {}
  const preset = typeof bag.preset === 'string' && bag.preset.length > 0 ? bag.preset : 'none'
  return {
    preset,
    durationSec: clampNum(bag.durationSec, DEFAULT_IN_OUT_DURATION_SEC, 0, 60),
    easing: easingOf(bag.easing, 'linear'),
    stagger: deriveStagger(bag)
  }
}

/** Project a raw Loop lane bag onto its editable state (author values preserved). PURE. */
export function deriveLoopLane(ref: Record<string, unknown> | undefined): LoopLaneState {
  const bag = ref ?? {}
  const preset = typeof bag.preset === 'string' && bag.preset.length > 0 ? bag.preset : 'none'
  return {
    preset,
    durationSec: clampNum(bag.durationSec, defaultDurationForLoop(preset), 0.01, 600),
    speed: clampNum(bag.speed, DEFAULT_LOOP_SPEED, 0.01, 100),
    easing: easingOf(bag.easing, 'linear'),
    stagger: deriveStagger(bag)
  }
}

// ---------------------------------------------------------------------------
// Serializers — editable lane state → persisted `clip.animation[tab]` bag
// ---------------------------------------------------------------------------

/**
 * Serialize a stagger state into the persisted `{stagger}` fragment, or `{}` when
 * off (so an off stagger leaves no `stagger` key — the paint resolver treats a
 * missing or zero-delay stagger as none). PURE.
 */
function staggerToBag(s: StaggerState): Record<string, unknown> {
  if (!s.enabled || !(s.delaySec > 0)) return {}
  return { stagger: { unit: s.unit, delaySec: Math.max(0, s.delaySec) } }
}

/**
 * Serialize an In/Out lane state into its persisted bag (`{preset, durationSec,
 * easing, stagger?}`). A `'none'` preset serializes to `{ preset: 'none' }` so the
 * paint resolver drops the lane to identity. PURE.
 */
export function inOutLaneToBag(state: InOutLaneState): Record<string, unknown> {
  if (state.preset === 'none') return { preset: 'none' }
  return {
    preset: state.preset,
    durationSec: Math.max(0, state.durationSec),
    easing: state.easing,
    ...staggerToBag(state.stagger)
  }
}

/**
 * Serialize a Loop lane state into its persisted bag (`{preset, durationSec, speed,
 * easing, stagger?}`). A `'none'` preset serializes to `{ preset: 'none' }`. PURE.
 */
export function loopLaneToBag(state: LoopLaneState): Record<string, unknown> {
  if (state.preset === 'none') return { preset: 'none' }
  return {
    preset: state.preset,
    durationSec: Math.max(0.01, state.durationSec),
    speed: Math.max(0.01, state.speed),
    easing: state.easing,
    ...staggerToBag(state.stagger)
  }
}

// ---------------------------------------------------------------------------
// Lane EDITS — pure transitions that yield a `Partial<ClipAnimation>` patch
// ---------------------------------------------------------------------------

/**
 * Pick a PRESET on an In/Out lane: seeds the catalog default easing for the new
 * preset (and the default duration if the lane had none / was off), preserving the
 * existing duration + stagger when re-picking. Returns the next lane state. PURE.
 */
export function selectInOutPreset(
  tab: 'in' | 'out',
  prev: InOutLaneState,
  presetId: string
): InOutLaneState {
  if (presetId === 'none') return { ...prev, preset: 'none' }
  const wasOff = prev.preset === 'none'
  return {
    ...prev,
    preset: presetId,
    durationSec: wasOff || !(prev.durationSec > 0) ? DEFAULT_IN_OUT_DURATION_SEC : prev.durationSec,
    easing: defaultEasingFor(tab, presetId)
  }
}

/** Pick a PRESET on the Loop lane: seeds the catalog default period. PURE. */
export function selectLoopPreset(prev: LoopLaneState, presetId: string): LoopLaneState {
  if (presetId === 'none') return { ...prev, preset: 'none' }
  const wasOff = prev.preset === 'none'
  return {
    ...prev,
    preset: presetId,
    durationSec: wasOff ? defaultDurationForLoop(presetId) : prev.durationSec
  }
}

/** Set the In/Out duration (seconds, clamped >= 0). PURE. */
export function setInOutDuration(prev: InOutLaneState, durationSec: number): InOutLaneState {
  return { ...prev, durationSec: clampNum(durationSec, prev.durationSec, 0, 60) }
}

/** Set the Loop speed multiplier (clamped > 0). PURE. */
export function setLoopSpeed(prev: LoopLaneState, speed: number): LoopLaneState {
  return { ...prev, speed: clampNum(speed, prev.speed, 0.01, 100) }
}

/** Set the Loop period (seconds at speed 1, clamped > 0). PURE. */
export function setLoopDuration(prev: LoopLaneState, durationSec: number): LoopLaneState {
  return { ...prev, durationSec: clampNum(durationSec, prev.durationSec, 0.01, 600) }
}

/** Set a lane's easing name (any lane state with an `easing` field). PURE. */
export function setLaneEasing<T extends { easing: EasingName }>(prev: T, easing: string): T {
  return { ...prev, easing: easingOf(easing, prev.easing) }
}

/** Toggle a lane's per-unit stagger on/off (seeds the default delay on enable). PURE. */
export function toggleStagger<T extends { stagger: StaggerState }>(prev: T, enabled: boolean): T {
  const delaySec = prev.stagger.delaySec > 0 ? prev.stagger.delaySec : DEFAULT_STAGGER_DELAY_SEC
  return { ...prev, stagger: { ...prev.stagger, enabled, delaySec } }
}

/** Set a lane's stagger unit (character = grapheme cluster, Indic-aware / word). PURE. */
export function setStaggerUnit<T extends { stagger: StaggerState }>(prev: T, unit: StaggerUnit): T {
  return { ...prev, stagger: { ...prev.stagger, unit: unit === 'word' ? 'word' : 'character' } }
}

/** Set a lane's per-unit stagger delay (seconds, clamped >= 0). PURE. */
export function setStaggerDelay<T extends { stagger: StaggerState }>(prev: T, delaySec: number): T {
  return { ...prev, stagger: { ...prev.stagger, delaySec: clampNum(delaySec, prev.stagger.delaySec, 0, 60) } }
}

// ---------------------------------------------------------------------------
// Patch builders — wrap a serialized lane bag as a one-lane ClipAnimation patch
// ---------------------------------------------------------------------------

/**
 * Build the `Partial<ClipAnimation>` patch for ONE In/Out lane — `{in: bag}` or
 * `{out: bag}`. The component hands this to the undoable `setClipAnimation`, which
 * merges it over the existing animation, leaving the OTHER lanes untouched (so each
 * tab's edits preserve the other lanes' configs). PURE.
 */
export function inOutPatch(tab: 'in' | 'out', state: InOutLaneState): Partial<ClipAnimation> {
  return { [tab]: inOutLaneToBag(state) } as Partial<ClipAnimation>
}

/** Build the `{loop: bag}` patch for the Loop lane. PURE. */
export function loopPatch(state: LoopLaneState): Partial<ClipAnimation> {
  return { loop: loopLaneToBag(state) }
}

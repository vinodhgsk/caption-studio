/**
 * Reveal Effects panel (P8R.11 — Doc 15; skill `reveal-effects`).
 *
 * A gallery of all nine kinetic reveal effects from {@link REVEAL_EFFECT_CATALOG}
 * (Frame / Swipe / Type / Slide / Glossy / Appear By / Stomp / Stripe / Curtain),
 * shared controls (unit / direction / duration / easing / loop / speed), per-effect
 * parameter sliders, and one-click named variant buttons. All writes go through the
 * undoable `setClipAnimation` command and target `clips[].animation.reveal`.
 *
 * The component is a THIN wiring layer — all derivation of editable state from the
 * raw `animation.reveal` bag lives in-line via `useMemo`, which keeps the component
 * focused on React wiring only.
 */
import { useMemo, type ReactNode } from 'react'
import { useProjectStore } from '@/store/projectStore'
import { useTimelineStore } from '@/store/timelineStore'
import type { Clip } from '../../../shared/storage'
import { EASING_NAMES } from '../../../shared/easing'
import { REVEAL_EFFECT_CATALOG } from '@/store/timeline/clipRevealEffects'
import type { RevealDirection, RevealUnitKind } from '@/store/timeline/clipRevealEffect'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The typed shape of `clip.animation.reveal` after normalization. */
interface RevealConfig {
  effectId: string
  unit: RevealUnitKind
  direction: RevealDirection
  duration: number
  ease: string
  loop: boolean
  speed: number
  params: Record<string, unknown>
}

/** A named quick-apply variant (Doc 15 one-click presets). */
interface Variant {
  label: string
  config: RevealConfig
}

// ---------------------------------------------------------------------------
// Named variants (Doc 15 quick-apply presets)
// ---------------------------------------------------------------------------

function makeVariant(
  label: string,
  effectId: string,
  extra: Partial<Omit<RevealConfig, 'effectId'>>
): Variant {
  const entry = REVEAL_EFFECT_CATALOG.find((e) => e.id === effectId)
  const base: RevealConfig = {
    effectId,
    unit: 'line',
    direction: 'b',
    duration: 1,
    ease: entry?.defaultEasing ?? 'easeInOut',
    loop: entry?.loop ?? false,
    speed: 1,
    params: {}
  }
  return {
    label,
    config: {
      ...base,
      ...extra,
      params: { ...base.params, ...(extra.params ?? {}) }
    }
  }
}

const VARIANTS: readonly Variant[] = [
  makeVariant('Swipe Bottom', 'swipe', { direction: 'b' }),
  makeVariant('Swipe Top', 'swipe', { direction: 't' }),
  makeVariant('Swipe Left', 'swipe', { direction: 'l' }),
  makeVariant('Swipe Right', 'swipe', { direction: 'r' }),
  makeVariant('Swipe Word', 'swipe', { unit: 'word', direction: 'b' }),
  makeVariant('Slide Down', 'slide', { direction: 'b' }),
  makeVariant('Slide Border', 'slide', { direction: 'b' }),
  makeVariant('Glossy Entrance', 'glossy', { loop: false }),
  makeVariant('Glossy Slide', 'glossy', { loop: false, direction: 'l' }),
  makeVariant('Appear Symbol', 'appearBy', { unit: 'char' }),
  makeVariant('Appear Word', 'appearBy', { unit: 'word' }),
  makeVariant('Stomp', 'stomp', { unit: 'word' }),
  makeVariant('Stripe Top', 'stripe', { params: { stripeCount: 1 } }),
  makeVariant('Stripe Slide', 'stripe', { params: { stripeCount: 2 } }),
  makeVariant('Curtain', 'curtain', { direction: 'center' })
]

// ---------------------------------------------------------------------------
// Panel root
// ---------------------------------------------------------------------------

/** Reveal Effects panel (P8R.11). */
export function RevealPanel(): JSX.Element {
  const project = useProjectStore((s) => s.currentProject)
  const selection = useTimelineStore((s) => s.selection)
  const setClipAnimation = useTimelineStore((s) => s.setClipAnimation)

  // Resolve the single selected text / caption clip — same logic as AnimationPanel.
  const selectedClip: Clip | null = useMemo(() => {
    if (project === null || selection.length !== 1) return null
    for (const track of project.tracks) {
      const c = track.clips.find((x) => x.id === selection[0])
      if (c !== undefined) return c.text !== undefined || c.caption !== undefined ? c : null
    }
    return null
  }, [project, selection])

  // Current reveal config bag, cast to open record for safe property access.
  const rawReveal = useMemo(
    () => (selectedClip?.animation?.reveal ?? {}) as Record<string, unknown>,
    [selectedClip]
  )

  // Normalized current config (safe defaults everywhere).
  const current: RevealConfig = useMemo(() => ({
    effectId: typeof rawReveal.effectId === 'string' ? rawReveal.effectId : '',
    unit: (rawReveal.unit === 'char' || rawReveal.unit === 'word' || rawReveal.unit === 'line')
      ? rawReveal.unit
      : 'line',
    direction: (
      rawReveal.direction === 'l' || rawReveal.direction === 'r' ||
      rawReveal.direction === 't' || rawReveal.direction === 'b' ||
      rawReveal.direction === 'center'
    ) ? rawReveal.direction : 'b',
    duration: typeof rawReveal.duration === 'number' && Number.isFinite(rawReveal.duration)
      ? rawReveal.duration
      : 1,
    ease: typeof rawReveal.ease === 'string' && rawReveal.ease.length > 0
      ? rawReveal.ease
      : 'easeInOut',
    loop: rawReveal.loop === true,
    speed: typeof rawReveal.speed === 'number' && Number.isFinite(rawReveal.speed) && rawReveal.speed > 0
      ? rawReveal.speed
      : 1,
    params: typeof rawReveal.params === 'object' && rawReveal.params !== null
      ? (rawReveal.params as Record<string, unknown>)
      : {}
  }), [rawReveal])

  const disabled = selectedClip === null

  // Helper: write a partial reveal patch, merging over current.
  const writeReveal = (patch: Partial<RevealConfig>): void => {
    if (selectedClip === null) return
    const next: RevealConfig = { ...current, ...patch, params: { ...current.params, ...(patch.params ?? {}) } }
    setClipAnimation(selectedClip.id, { reveal: next as unknown as Record<string, unknown> })
  }

  // Helper: write only params sub-keys.
  const writeParam = (key: string, value: unknown): void => {
    if (selectedClip === null) return
    const next: RevealConfig = { ...current, params: { ...current.params, [key]: value } }
    setClipAnimation(selectedClip.id, { reveal: next as unknown as Record<string, unknown> })
  }

  // The catalog entry for the active effect (for loop detection in shared controls).
  const activeEntry = useMemo(
    () => REVEAL_EFFECT_CATALOG.find((e) => e.id === current.effectId) ?? null,
    [current.effectId]
  )

  return (
    <section className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <h2 className="text-sm font-semibold text-text-primary">Reveal Effects</h2>

      {disabled ? (
        <p className="text-xs text-text-muted">
          Select a text or caption clip to apply a reveal effect.
        </p>
      ) : (
        <div className="flex flex-col gap-4">

          {/* ---- Effect gallery ------------------------------------------- */}
          <EffectGallery
            activeId={current.effectId}
            onSelect={(id) => {
              const entry = REVEAL_EFFECT_CATALOG.find((e) => e.id === id)
              if (entry === undefined) return
              writeReveal({
                effectId: entry.id,
                duration: 1,
                ease: entry.defaultEasing,
                loop: entry.loop,
                params: {}
              })
            }}
          />

          {/* ---- Named variants ------------------------------------------- */}
          <CollapsibleSection title="Quick presets">
            <div className="flex flex-wrap gap-1">
              {VARIANTS.map((v) => (
                <button
                  key={v.label}
                  type="button"
                  onClick={() => {
                    if (selectedClip === null) return
                    setClipAnimation(selectedClip.id, { reveal: v.config as unknown as Record<string, unknown> })
                  }}
                  className="rounded-sm border border-line px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-2"
                >
                  {v.label}
                </button>
              ))}
            </div>
          </CollapsibleSection>

          {/* ---- Shared controls (visible when an effect is chosen) --------- */}
          {current.effectId !== '' && (
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                Shared
              </span>

              {/* Unit */}
              <RowSelect
                label="Unit"
                ariaLabel="reveal unit"
                value={current.unit}
                options={[
                  { value: 'char', label: 'Char' },
                  { value: 'word', label: 'Word' },
                  { value: 'line', label: 'Line' }
                ]}
                onChange={(v) => writeReveal({ unit: v as RevealUnitKind })}
              />

              {/* Direction */}
              <RowSelect
                label="Direction"
                ariaLabel="reveal direction"
                value={current.direction}
                options={[
                  { value: 'l', label: 'Left' },
                  { value: 'r', label: 'Right' },
                  { value: 't', label: 'Top' },
                  { value: 'b', label: 'Bottom' },
                  { value: 'center', label: 'Center' }
                ]}
                onChange={(v) => writeReveal({ direction: v as RevealDirection })}
              />

              {/* Duration */}
              <SliderField
                label="Duration"
                ariaLabel="reveal duration"
                value={current.duration}
                valueText={`${current.duration.toFixed(2)}s`}
                min={0.1}
                max={5}
                step={0.05}
                onChange={(v) => writeReveal({ duration: v })}
              />

              {/* Easing */}
              <RowSelect
                label="Easing"
                ariaLabel="reveal easing"
                value={current.ease}
                options={EASING_NAMES.map((n) => ({ value: n, label: n }))}
                onChange={(v) => writeReveal({ ease: v })}
              />

              {/* Loop toggle — shown for glossy or any loop-capable effect */}
              {(activeEntry?.loop === true || current.loop) && (
                <CheckboxField
                  label="Loop"
                  ariaLabel="reveal loop"
                  checked={current.loop}
                  onChange={(v) => writeReveal({ loop: v })}
                />
              )}

              {/* Speed (only when looping) */}
              {current.loop && (
                <SliderField
                  label="Speed"
                  ariaLabel="reveal speed"
                  value={current.speed}
                  valueText={`${current.speed.toFixed(2)}×`}
                  min={0.1}
                  max={5}
                  step={0.05}
                  onChange={(v) => writeReveal({ speed: v })}
                  hint="Loop speed multiplier."
                />
              )}
            </div>
          )}

          {/* ---- Per-effect params ---------------------------------------- */}
          {current.effectId !== '' && (
            <PerEffectControls
              effectId={current.effectId}
              params={current.params}
              onParam={writeParam}
            />
          )}
        </div>
      )}

      <p className="text-xs text-text-muted">
        Reveal effects animate text in on entry. The char unit = grapheme cluster
        (Indic/Tamil text reveals as single units).
      </p>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Effect gallery
// ---------------------------------------------------------------------------

function EffectGallery({
  activeId,
  onSelect
}: {
  activeId: string
  onSelect: (id: string) => void
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        Effects
      </span>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Reveal effect">
        {REVEAL_EFFECT_CATALOG.map((entry) => {
          const active = entry.id === activeId
          return (
            <button
              key={entry.id}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(entry.id)}
              className={`rounded-sm border px-2 py-1.5 text-[11px] ${
                active
                  ? 'border-accent bg-accent/20 text-text-primary'
                  : 'border-line text-text-secondary hover:bg-surface-2'
              }`}
            >
              {entry.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Per-effect parameter controls
// ---------------------------------------------------------------------------

function PerEffectControls({
  effectId,
  params,
  onParam
}: {
  effectId: string
  params: Record<string, unknown>
  onParam: (key: string, value: unknown) => void
}): JSX.Element | null {
  function num(key: string, fallback: number): number {
    const v = params[key]
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback
  }
  function bool(key: string, fallback: boolean): boolean {
    const v = params[key]
    return typeof v === 'boolean' ? v : fallback
  }
  function str(key: string, fallback: string): string {
    const v = params[key]
    return typeof v === 'string' ? v : fallback
  }

  switch (effectId) {
    case 'frame':
      return (
        <ParamSection title="Frame">
          <SliderField
            label="Thickness"
            ariaLabel="frame thickness"
            value={num('thickness', 3)}
            valueText={`${num('thickness', 3)}px`}
            min={1}
            max={20}
            step={1}
            onChange={(v) => onParam('thickness', v)}
          />
          <SliderField
            label="Radius"
            ariaLabel="frame radius"
            value={num('radius', 0)}
            valueText={`${num('radius', 0)}px`}
            min={0}
            max={40}
            step={1}
            onChange={(v) => onParam('radius', v)}
          />
          <SliderField
            label="Padding"
            ariaLabel="frame padding"
            value={num('padding', 8)}
            valueText={`${num('padding', 8)}px`}
            min={2}
            max={40}
            step={1}
            onChange={(v) => onParam('padding', v)}
          />
          <RowSelect
            label="Draw direction"
            ariaLabel="frame draw direction"
            value={str('drawDir', 'cw')}
            options={[
              { value: 'cw', label: 'Clockwise' },
              { value: 'ccw', label: 'Counter-CW' }
            ]}
            onChange={(v) => onParam('drawDir', v)}
          />
          <CheckboxField
            label="Gate (hide until drawn)"
            ariaLabel="frame gate"
            checked={bool('gate', false)}
            onChange={(v) => onParam('gate', v)}
          />
        </ParamSection>
      )

    case 'swipe':
      return (
        <ParamSection title="Swipe">
          <SliderField
            label="Bar width"
            ariaLabel="swipe bar width"
            value={num('barWidth', 24)}
            valueText={`${num('barWidth', 24)}px`}
            min={4}
            max={120}
            step={1}
            onChange={(v) => onParam('barWidth', v)}
          />
          <SliderField
            label="Softness"
            ariaLabel="swipe softness"
            value={num('softness', 0)}
            valueText={`${num('softness', 0)}px`}
            min={0}
            max={40}
            step={1}
            onChange={(v) => onParam('softness', v)}
          />
        </ParamSection>
      )

    case 'type':
      return (
        <ParamSection title="Type">
          <CheckboxField
            label="Caret"
            ariaLabel="type caret"
            checked={bool('caret', true)}
            onChange={(v) => onParam('caret', v)}
          />
          <SliderField
            label="Caret width"
            ariaLabel="type caret width"
            value={num('caretWidth', 2)}
            valueText={`${num('caretWidth', 2)}px`}
            min={1}
            max={6}
            step={1}
            onChange={(v) => onParam('caretWidth', v)}
          />
          <SliderField
            label="Blink period"
            ariaLabel="type blink period"
            value={num('blinkPeriodSec', 1.06)}
            valueText={`${num('blinkPeriodSec', 1.06).toFixed(2)}s`}
            min={0.3}
            max={3}
            step={0.05}
            onChange={(v) => onParam('blinkPeriodSec', v)}
          />
          <CheckboxField
            label="Tick cue"
            ariaLabel="type tick cue"
            checked={bool('tickCue', false)}
            onChange={(v) => onParam('tickCue', v)}
          />
        </ParamSection>
      )

    case 'slide':
      return (
        <ParamSection title="Slide">
          <SliderField
            label="Overshoot"
            ariaLabel="slide overshoot"
            value={num('overshoot', 0.12)}
            valueText={num('overshoot', 0.12).toFixed(2)}
            min={0}
            max={0.5}
            step={0.01}
            onChange={(v) => onParam('overshoot', v)}
          />
          <SliderField
            label="Stagger"
            ariaLabel="slide stagger"
            value={num('stagger', 0.3)}
            valueText={num('stagger', 0.3).toFixed(2)}
            min={0}
            max={0.8}
            step={0.01}
            onChange={(v) => onParam('stagger', v)}
          />
        </ParamSection>
      )

    case 'glossy':
      return (
        <ParamSection title="Glossy">
          <SliderField
            label="Angle"
            ariaLabel="glossy angle"
            value={num('angle', 45)}
            valueText={`${num('angle', 45)}°`}
            min={0}
            max={360}
            step={1}
            onChange={(v) => onParam('angle', v)}
          />
          <SliderField
            label="Band width"
            ariaLabel="glossy band width"
            value={num('bandWidth', 40)}
            valueText={`${num('bandWidth', 40)}px`}
            min={10}
            max={200}
            step={1}
            onChange={(v) => onParam('bandWidth', v)}
          />
          <SliderField
            label="Intensity"
            ariaLabel="glossy intensity"
            value={num('intensity', 0.8)}
            valueText={num('intensity', 0.8).toFixed(2)}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => onParam('intensity', v)}
          />
        </ParamSection>
      )

    case 'appearBy':
      return (
        <ParamSection title="Appear By">
          <SliderField
            label="Stagger"
            ariaLabel="appear by stagger"
            value={num('stagger', 0.4)}
            valueText={num('stagger', 0.4).toFixed(2)}
            min={0}
            max={0.8}
            step={0.01}
            onChange={(v) => onParam('stagger', v)}
          />
          <SliderField
            label="Scale from"
            ariaLabel="appear by scale from"
            value={num('scaleFrom', 0.8)}
            valueText={num('scaleFrom', 0.8).toFixed(2)}
            min={0.5}
            max={1}
            step={0.01}
            onChange={(v) => onParam('scaleFrom', v)}
          />
        </ParamSection>
      )

    case 'stomp':
      return (
        <ParamSection title="Stomp">
          <SliderField
            label="Scale from"
            ariaLabel="stomp scale from"
            value={num('scaleFrom', 2.5)}
            valueText={`${num('scaleFrom', 2.5).toFixed(1)}×`}
            min={1.2}
            max={5}
            step={0.1}
            onChange={(v) => onParam('scaleFrom', v)}
          />
          <SliderField
            label="Overshoot"
            ariaLabel="stomp overshoot"
            value={num('overshoot', 0.15)}
            valueText={num('overshoot', 0.15).toFixed(2)}
            min={0}
            max={0.4}
            step={0.01}
            onChange={(v) => onParam('overshoot', v)}
          />
          <CheckboxField
            label="Blur in"
            ariaLabel="stomp blur in"
            checked={bool('blurIn', true)}
            onChange={(v) => onParam('blurIn', v)}
          />
          <SliderField
            label="Stagger"
            ariaLabel="stomp stagger"
            value={num('stagger', 0.2)}
            valueText={num('stagger', 0.2).toFixed(2)}
            min={0}
            max={0.5}
            step={0.01}
            onChange={(v) => onParam('stagger', v)}
          />
        </ParamSection>
      )

    case 'stripe':
      return (
        <ParamSection title="Stripe">
          <SliderField
            label="Count"
            ariaLabel="stripe count"
            value={num('stripeCount', 3)}
            valueText={String(num('stripeCount', 3))}
            min={1}
            max={10}
            step={1}
            onChange={(v) => onParam('stripeCount', v)}
          />
          <SliderField
            label="Angle"
            ariaLabel="stripe angle"
            value={num('angle', 45)}
            valueText={`${num('angle', 45)}°`}
            min={0}
            max={90}
            step={1}
            onChange={(v) => onParam('angle', v)}
          />
          <SliderField
            label="Gap"
            ariaLabel="stripe gap"
            value={num('gap', 0.3)}
            valueText={num('gap', 0.3).toFixed(2)}
            min={0}
            max={0.8}
            step={0.01}
            onChange={(v) => onParam('gap', v)}
          />
        </ParamSection>
      )

    case 'curtain':
      return (
        <ParamSection title="Curtain">
          <SliderField
            label="Softness"
            ariaLabel="curtain softness"
            value={num('softness', 8)}
            valueText={`${num('softness', 8)}px`}
            min={0}
            max={40}
            step={1}
            onChange={(v) => onParam('softness', v)}
          />
        </ParamSection>
      )

    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------

/** A collapsible accordion section with a toggle header. */
function CollapsibleSection({
  title,
  children
}: {
  title: string
  children: ReactNode
}): JSX.Element {
  return (
    <details className="flex flex-col gap-1">
      <summary className="cursor-pointer select-none text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        {title}
      </summary>
      <div className="mt-1">{children}</div>
    </details>
  )
}

/** A labeled subsection for per-effect params. */
function ParamSection({
  title,
  children
}: {
  title: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-line bg-surface-2/40 p-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        {title}
      </span>
      {children}
    </div>
  )
}

/** A labeled range slider with a right-aligned value readout and optional hint. */
function SliderField({
  label,
  ariaLabel,
  value,
  valueText,
  min,
  max,
  step,
  onChange,
  hint
}: {
  label: string
  ariaLabel?: string
  value: number
  valueText: string
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  hint?: string
}): ReactNode {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-text-secondary">
      <span className="flex items-center justify-between">
        <span>{label}</span>
        <span className="tabular-nums text-text-muted">{valueText}</span>
      </span>
      <input
        type="range"
        aria-label={ariaLabel ?? label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(v)
        }}
        className="w-full accent-accent"
      />
      {hint !== undefined && <span className="text-[10px] text-text-muted">{hint}</span>}
    </label>
  )
}

/** A labeled select dropdown. */
function RowSelect({
  label,
  ariaLabel,
  value,
  options,
  onChange
}: {
  label: string
  ariaLabel: string
  value: string
  options: readonly { value: string; label: string }[]
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px] text-text-secondary">
      <span>{label}</span>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 rounded-sm border border-line bg-surface-2 px-2 py-1 text-xs text-text-primary"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** A labeled checkbox. */
function CheckboxField({
  label,
  ariaLabel,
  checked,
  onChange
}: {
  label: string
  ariaLabel: string
  checked: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px] text-text-secondary">
      <span>{label}</span>
      <input
        type="checkbox"
        aria-label={ariaLabel}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-accent"
      />
    </label>
  )
}

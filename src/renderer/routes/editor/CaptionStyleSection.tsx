import { useMemo, useState } from 'react'
import { useProjectStore } from '@/store/projectStore'
import { useTimelineStore } from '@/store/timelineStore'
import { CAPTION_TRACK_ID } from '@/store/timeline'
import { fontRegistry } from '../../../shared/fontRegistry'
import { resolveTextFont } from './preview/textFontSpec'
import {
  TEXT_ALIGN_OPTIONS,
  clamp,
  decorationToBag,
  deriveAlignState,
  deriveDecorationState,
  deriveFillState,
  deriveShadowState,
  deriveStrokeLayers,
    nextStrokeWidth,
  normalizeHex,
  formatPercent,
  formatPx,
  formatDeg
} from './textPanelState'
import {
  EFFECT_PARAM_META,
  addEffect,
  deriveEffects,
  effectTypeLabel,
  galleryItems,
  moveEffectDown,
  moveEffectUp,
  removeEffect,
  setEffectEnabled,
  setEffectIntensity,
  setEffectOpacity,
  setEffectParam,
  type EffectParamMeta
} from './effectsPanelState'
import type { TextEffect, TextEffectType } from '../../../shared/textEffect'
import { Section, SubGroup, SliderField, NumberField, ToggleButton, ColorRow } from './PanelUI'

function formatEffectParam(value: number, meta: EffectParamMeta): string {
  switch (meta.unit) {
    case 'px':
      return formatPx(value, meta.step !== undefined && meta.step < 1 ? 1 : 0)
    case 'deg':
      return formatDeg(value)
    case 'ratio':
      return formatPercent(value)
    case 'count':
      return `${Math.round(value)}`
    default:
      return `${value}`
  }
}

function EffectRow({
  effect,
  index,
  count,
  onToggle,
  onRemove,
  onMoveUp,
  onMoveDown,
  onIntensity,
  onOpacity,
  onParam
}: {
  effect: TextEffect
  index: number
  count: number
  onToggle: (i: number, on: boolean) => void
  onRemove: (i: number) => void
  onMoveUp: (i: number) => void
  onMoveDown: (i: number) => void
  onIntensity: (i: number, v: number) => void
  onOpacity: (i: number, v: number) => void
  onParam: (i: number, key: string, value: number | string) => void
}): JSX.Element {
  const meta = EFFECT_PARAM_META[effect.type]
  const params = effect.params as unknown as Record<string, number | string>
  return (
    <li className="flex flex-col gap-1.5 rounded-sm border border-line bg-surface-2/50 p-2">
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex min-w-0 items-center gap-1">
          <div className="flex flex-col">
            <button
              type="button"
              aria-label={`Move ${effectTypeLabel(effect.type)} up`}
              disabled={index === 0}
              onClick={() => onMoveUp(index)}
              className="h-3.5 rounded-sm px-1 text-[10px] leading-none text-text-muted hover:text-text-primary disabled:opacity-30"
            >
              ▲
            </button>
            <button
              type="button"
              aria-label={`Move ${effectTypeLabel(effect.type)} down`}
              disabled={index === count - 1}
              onClick={() => onMoveDown(index)}
              className="h-3.5 rounded-sm px-1 text-[10px] leading-none text-text-muted hover:text-text-primary disabled:opacity-30"
            >
              ▼
            </button>
          </div>
          <span className="truncate text-[11px] font-medium text-text-primary">
            {index + 1}. {effectTypeLabel(effect.type)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label className="flex items-center gap-1 text-[10px] text-text-secondary">
            <input
              type="checkbox"
              aria-label={`Enable ${effectTypeLabel(effect.type)}`}
              checked={effect.enabled}
              onChange={(e) => onToggle(index, e.target.checked)}
              className="h-3.5 w-3.5 accent-accent"
            />
            <span>{effect.enabled ? 'On' : 'Off'}</span>
          </label>
          <button
            type="button"
            aria-label={`Remove ${effectTypeLabel(effect.type)}`}
            onClick={() => onRemove(index)}
            className="rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-text-secondary hover:bg-surface-2"
          >
            ✕
          </button>
        </div>
      </div>

      <SliderField
        label="Intensity"
        ariaLabel={`${effectTypeLabel(effect.type)} intensity`}
        value={effect.intensity}
        valueText={formatPercent(effect.intensity)}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => onIntensity(index, v)}
      />
      <SliderField
        label="Opacity"
        ariaLabel={`${effectTypeLabel(effect.type)} opacity`}
        value={effect.opacity}
        valueText={formatPercent(effect.opacity)}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => onOpacity(index, v)}
      />

      {meta.map((m) =>
        m.kind === 'color' ? (
          <ColorRow
            key={m.key}
            label={m.label}
            value={typeof params[m.key] === 'string' ? (params[m.key] as string) : '#ffffff'}
            onChange={(v) => onParam(index, m.key, v)}
          />
        ) : (
          <SliderField
            key={m.key}
            label={m.label}
            ariaLabel={`${effectTypeLabel(effect.type)} ${m.label}`}
            value={typeof params[m.key] === 'number' ? (params[m.key] as number) : (m.min ?? 0)}
            valueText={formatEffectParam(typeof params[m.key] === 'number' ? (params[m.key] as number) : 0, m)}
            min={m.min ?? 0}
            max={m.max ?? 1}
            step={m.step ?? 1}
            onChange={(v) => onParam(index, m.key, v)}
          />
        )
      )}
    </li>
  )
}

export function CaptionStyleSection({ disabled }: { disabled: boolean }): JSX.Element | null {
  const project = useProjectStore((s) => s.currentProject)
  
  const setCaptionFontFamilyAction = useTimelineStore((s) => s.setCaptionFontFamily)
  const setCaptionFontSizeAction = useTimelineStore((s) => s.setCaptionFontSize)
  const setCaptionBoldAction = useTimelineStore((s) => s.setCaptionBold)
  const setCaptionItalicAction = useTimelineStore((s) => s.setCaptionItalic)
  const setCaptionLetterSpacingAction = useTimelineStore((s) => s.setCaptionLetterSpacing)
  const setCaptionLineHeightAction = useTimelineStore((s) => s.setCaptionLineHeight)
  const setCaptionAlignAction = useTimelineStore((s) => s.setCaptionAlign)
  const setCaptionCurveAction = useTimelineStore((s) => s.setCaptionCurve)
  const setCaptionFillAction = useTimelineStore((s) => s.setCaptionFill)
  const setCaptionStrokeAction = useTimelineStore((s) => s.setCaptionStroke)
  const setCaptionShadowAction = useTimelineStore((s) => s.setCaptionShadow)
  const setCaptionDecorationAction = useTimelineStore((s) => s.setCaptionDecoration)
  const setCaptionEffectsAction = useTimelineStore((s) => s.setCaptionEffects)
  const wrapCaptionTextAction = useTimelineStore((s) => s.wrapCaptionText)

  const captionClips = useMemo(
    () => project?.tracks.find((t) => t.id === CAPTION_TRACK_ID)?.clips ?? [],
    [project]
  )
  const hasCaptionTrack = captionClips.length > 0
  const firstClip = captionClips[0]

  const font = useMemo(
    () => resolveTextFont(firstClip?.text?.font, { family: 'Baloo Thambi 2', sizePx: 144, lineHeight: 1.4 }),
    [firstClip]
  )
  const fillState = useMemo(() => deriveFillState(firstClip?.text?.fill), [firstClip])
  const alignState = useMemo(() => deriveAlignState(firstClip?.text), [firstClip])
  const strokeLayers = useMemo(() => deriveStrokeLayers(firstClip?.text?.stroke), [firstClip])
  const shadowState = useMemo(() => deriveShadowState(firstClip?.text?.shadow), [firstClip])
  const decorationState = useMemo(() => deriveDecorationState(firstClip?.text?.decoration), [firstClip])
  const effects = useMemo(() => deriveEffects(firstClip?.text?.effects), [firstClip])

  const [maxWordsPerLine, setMaxWordsPerLine] = useState(4)
  const [wordWrap, setWordWrap] = useState(false)

  const fontOptions = useMemo(() => {
    const all = fontRegistry.listFonts().map((f) => f.family)
    const tamilFirst = fontRegistry.listFonts().filter((f) => f.scripts.includes('tamil')).map((f) => f.family)
    const rest = all.filter((f) => !tamilFirst.includes(f))
    return { tamil: tamilFirst, rest }
  }, [])

  if (!hasCaptionTrack) {
    return (
      <div className="px-4 py-8 text-center text-xs text-text-muted">
        Generate captions first to style them.
      </div>
    )
  }

  const patchFill = (patch: Partial<typeof fillState>): void => {
    const s = { ...fillState, ...patch }
    if (!s.isGradient) {
      setCaptionFillAction({ type: 'solid', value: normalizeHex(s.hex), opacity: clamp(s.opacity, 0, 1) })
    } else {
      setCaptionFillAction({
        type: 'gradient',
        value: s.stops.map((st) => ({ offset: clamp(st.offset, 0, 1), color: normalizeHex(st.color) })),
        opacity: clamp(s.opacity, 0, 1),
        angle: s.angle
      })
    }
  }

  return (
    <div className="flex flex-col gap-2 relative">
      {disabled && <div className="absolute inset-0 z-10 bg-surface-1/50" />}
      
      <Section title="Typography">
        <label className="flex flex-col gap-1 text-[11px] text-text-secondary">
          Font
          <select
            value={font.family}
            onChange={(e) => setCaptionFontFamilyAction(e.target.value)}
            className="w-full rounded-sm border border-line bg-surface-2 px-2 py-1 text-xs text-text-primary"
          >
            <optgroup label="Tamil / devotional">
              {fontOptions.tamil.map((fam) => (
                <option key={fam} value={fam}>{fam}</option>
              ))}
            </optgroup>
            <optgroup label="Other">
              {fontOptions.rest.map((fam) => (
                <option key={fam} value={fam}>{fam}</option>
              ))}
            </optgroup>
          </select>
        </label>
        <NumberField label="Font size (px)" value={font.sizePx} min={8} max={400} onChange={(v) => setCaptionFontSizeAction(v)} />
        
        <div className="flex items-center gap-2">
          <span className="w-16 text-[11px] text-text-secondary">Style</span>
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <button
              type="button"
              aria-pressed={(Number(font.weight) >= 600)}
              onClick={() => setCaptionBoldAction(!(Number(font.weight) >= 600))}
              className={`flex h-6 flex-1 items-center justify-center rounded-sm border text-[11px] font-bold ${
                (Number(font.weight) >= 600) ? 'border-accent bg-accent/20 text-text-primary' : 'border-line text-text-secondary hover:bg-surface-2'
              }`}
            >
              B
            </button>
            <button
              type="button"
              aria-pressed={font.italic}
              onClick={() => setCaptionItalicAction(!font.italic)}
              className={`flex h-6 flex-1 items-center justify-center rounded-sm border text-[11px] italic ${
                font.italic ? 'border-accent bg-accent/20 text-text-primary' : 'border-line text-text-secondary hover:bg-surface-2'
              }`}
            >
              I
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="w-16 text-[11px] text-text-secondary">Align</span>
          <div className="flex min-w-0 flex-1 items-center gap-1">
            {TEXT_ALIGN_OPTIONS.map((a) => (
              <button
                key={a}
                type="button"
                aria-label={`Align ${a}`}
                aria-pressed={alignState === a}
                onClick={() => setCaptionAlignAction(a as 'left' | 'center' | 'right')}
                className={`flex h-6 flex-1 items-center justify-center rounded-sm border uppercase ${
                  alignState === a
                    ? 'border-accent bg-accent/20 text-text-primary'
                    : 'border-line text-text-secondary hover:bg-surface-2'
                }`}
              >
                {a.substring(0, 1)}
              </button>
            ))}
          </div>
        </div>
        
        <SliderField label="Line spacing" value={font.lineHeight} valueText={font.lineHeight.toFixed(1)} min={0.5} max={3.0} step={0.1} onChange={(v) => setCaptionLineHeightAction(v)} />
        <SliderField label="Word spacing" value={font.letterSpacing ?? 0} valueText={`${font.letterSpacing ?? 0}px`} min={-20} max={100} step={1} onChange={(v) => setCaptionLetterSpacingAction(v)} />
        <SliderField label="Curve" value={font.curve ?? 0} valueText={`${Math.round((font.curve ?? 0) * 100)}%`} min={-1} max={1} step={0.01} onChange={(v) => setCaptionCurveAction(v)} />

        <div className="mt-2 border-t border-line pt-2">
          <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
            <span>Word wrap</span>
            <input
              type="checkbox"
              checked={wordWrap}
              onChange={(e) => {
                const on = e.target.checked
                setWordWrap(on)
                wrapCaptionTextAction(on && maxWordsPerLine > 0 ? maxWordsPerLine : 1_000_000)
              }}
              className="h-4 w-4 accent-accent"
            />
          </label>
          {wordWrap && (
            <NumberField label="Words per line" value={maxWordsPerLine} min={1} onChange={(v) => {
              setMaxWordsPerLine(v)
              wrapCaptionTextAction(v)
            }} />
          )}
        </div>
      </Section>

      <Section title="Color" defaultOpen={false}>
        <div className="flex w-full items-center gap-1 rounded bg-surface-1 p-0.5">
          <ToggleButton active={!fillState.isGradient} onClick={() => patchFill({ isGradient: false })}>
            Solid
          </ToggleButton>
          <ToggleButton active={fillState.isGradient} onClick={() => {
            if (!fillState.isGradient) {
               patchFill({
                 isGradient: true,
                 stops: fillState.stops.length >= 2 ? fillState.stops : [{ offset: 0, color: fillState.hex }, { offset: 1, color: '#000000' }]
               })
            }
          }}>
            Gradient
          </ToggleButton>
        </div>

        {!fillState.isGradient ? (
          <ColorRow label="Color" value={fillState.hex} onChange={(v) => patchFill({ hex: v })} />
        ) : (
          <div className="flex flex-col gap-2 rounded-sm border border-line bg-surface-2/50 p-2">
            <h4 className="text-[10px] font-semibold uppercase text-text-muted">Gradient Stops</h4>
            <ul className="flex flex-col gap-1.5">
              {fillState.stops.map((s, i) => (
                <li key={i} className="flex items-center gap-2">
                  <div className="flex-1">
                    <ColorRow
                      label={`Stop ${i + 1}`}
                      value={s.color}
                      onChange={(v) => {
                        const newStops = [...fillState.stops]
                        newStops[i] = { ...newStops[i], color: v }
                        patchFill({ stops: newStops })
                      }}
                    />
                  </div>
                  <div className="flex w-24 items-center gap-1 text-[10px] text-text-secondary">
                    <span>Pos</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={Math.round(s.offset * 100)}
                      onChange={(e) => {
                        const newStops = [...fillState.stops]
                        newStops[i] = { ...newStops[i], offset: clamp(Number(e.target.value) / 100, 0, 1) }
                        patchFill({ stops: newStops })
                      }}
                      className="w-full min-w-0 rounded-sm border border-line bg-surface-1 px-1 py-0.5"
                    />
                    <span>%</span>
                  </div>
                </li>
              ))}
            </ul>
            <SliderField label="Angle" value={fillState.angle} valueText={formatDeg(fillState.angle)} min={0} max={360} step={1} onChange={(v) => patchFill({ angle: v })} />
          </div>
        )}
        <SliderField label="Opacity" value={fillState.opacity} valueText={formatPercent(fillState.opacity)} min={0} max={1} step={0.01} onChange={(v) => patchFill({ opacity: v })} />
      </Section>

      <Section title="Stroke" defaultOpen={false}>
        {strokeLayers.map((layer, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-sm border border-line bg-surface-2/50 p-2">
            <div className="flex items-center justify-between">
              <h4 className="text-[10px] font-semibold uppercase text-text-muted">Layer {i + 1}</h4>
              <button type="button" onClick={() => setCaptionStrokeAction(strokeLayers.filter((_, idx) => idx !== i).map(l => ({ color: l.hex, width: l.width })))} className="text-[11px] text-text-secondary hover:text-text-primary">✕</button>
            </div>
            <ColorRow label="Color" value={layer.hex} onChange={(c) => {
              const next = [...strokeLayers]
              next[i] = { ...next[i], hex: c }
              setCaptionStrokeAction(next.map(l => ({ color: l.hex, width: l.width })))
            }} />
            <SliderField label="Width" value={layer.width} valueText={formatPx(layer.width, 0)} min={0} max={100} step={1} onChange={(w) => {
              const next = [...strokeLayers]
              next[i] = { ...next[i], width: w }
              setCaptionStrokeAction(next.map(l => ({ color: l.hex, width: l.width })))
            }} />
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            const width = nextStrokeWidth(strokeLayers)
            setCaptionStrokeAction([...strokeLayers, { hex: '#000000', width }].map(l => ({ color: l.hex, width: l.width })))
          }}
          className="flex w-full items-center justify-center rounded-sm border border-dashed border-line py-1.5 text-xs text-text-secondary hover:bg-surface-2 hover:text-text-primary"
        >
          + Add Stroke
        </button>
      </Section>

      <Section title="Shadow" defaultOpen={false}>
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-text-primary">Shadow</label>
          <select
            value={shadowState.on ? shadowState.type : ('none' as any)}
            disabled={disabled}
            onChange={(e) => {
              const on = e.target.value !== 'none'
              const type = e.target.value as 'drop' | 'inner' | 'long'
              if (!on) {
                setCaptionShadowAction(null)
              } else {
                setCaptionShadowAction({
                  color: shadowState.color,
                  opacity: shadowState.opacity,
                  blur: shadowState.blur,
                  angle: shadowState.angle,
                  distance: shadowState.distance,
                  inner: type === 'inner',
                  long: type === 'long'
                })
              }
            }}
            className="w-32 rounded-sm border border-line bg-surface-2 px-2 py-1 text-xs text-text-primary"
          >
            <option value="none">None</option>
            <option value="drop">Drop shadow</option>
            <option value="inner">Inner shadow</option>
            <option value="long">Long shadow</option>
          </select>
        </div>
        {shadowState.on && (
          <div className="flex flex-col gap-2">
            <ColorRow label="Color" value={shadowState.color} onChange={(c) => setCaptionShadowAction({ color: c, opacity: shadowState.opacity, blur: shadowState.blur, angle: shadowState.angle, distance: shadowState.distance, inner: shadowState.type === 'inner', long: shadowState.type === 'long' })} />
            <SliderField label="Opacity" value={shadowState.opacity} valueText={formatPercent(shadowState.opacity)} min={0} max={1} step={0.01} onChange={(v) => setCaptionShadowAction({ color: shadowState.color, opacity: v, blur: shadowState.blur, angle: shadowState.angle, distance: shadowState.distance, inner: shadowState.type === 'inner', long: shadowState.type === 'long' })} />
            <SliderField label="Blur" value={shadowState.blur} valueText={formatPx(shadowState.blur, 0)} min={0} max={100} step={1} onChange={(v) => setCaptionShadowAction({ color: shadowState.color, opacity: shadowState.opacity, blur: v, angle: shadowState.angle, distance: shadowState.distance, inner: shadowState.type === 'inner', long: shadowState.type === 'long' })} />
            <SliderField label="Distance" value={shadowState.distance} valueText={formatPx(shadowState.distance, 0)} min={0} max={200} step={1} onChange={(v) => setCaptionShadowAction({ color: shadowState.color, opacity: shadowState.opacity, blur: shadowState.blur, angle: shadowState.angle, distance: v, inner: shadowState.type === 'inner', long: shadowState.type === 'long' })} />
            <SliderField label="Angle" value={shadowState.angle} valueText={formatDeg(shadowState.angle)} min={0} max={360} step={1} onChange={(v) => setCaptionShadowAction({ color: shadowState.color, opacity: shadowState.opacity, blur: shadowState.blur, angle: v, distance: shadowState.distance, inner: shadowState.type === 'inner', long: shadowState.type === 'long' })} />
          </div>
        )}
      </Section>

      <Section title="Decorations" defaultOpen={false}>
        <SubGroup
          title="Background Bubble"
          toggle={{
            ariaLabel: 'Toggle background bubble',
            on: decorationState.backgroundOn,
            onChange: (on) => setCaptionDecorationAction(decorationToBag(firstClip?.text?.decoration, { ...decorationState, backgroundOn: on }))
          }}
        >
          {decorationState.backgroundOn && (
            <div className="flex flex-col gap-2 pt-1">
              <ColorRow label="Color" value={decorationState.color} onChange={(c) => setCaptionDecorationAction(decorationToBag(firstClip?.text?.decoration, { ...decorationState, color: c }))} />
              <SliderField label="Opacity" value={decorationState.opacity} valueText={formatPercent(decorationState.opacity)} min={0} max={1} step={0.01} onChange={(v) => setCaptionDecorationAction(decorationToBag(firstClip?.text?.decoration, { ...decorationState, opacity: v }))} />
              <SliderField label="Padding" value={decorationState.padding} valueText={formatPx(decorationState.padding, 0)} min={0} max={100} step={1} onChange={(v) => setCaptionDecorationAction(decorationToBag(firstClip?.text?.decoration, { ...decorationState, padding: v }))} />
              <SliderField label="Corner Radius" value={decorationState.radius} valueText={formatPx(decorationState.radius, 0)} min={0} max={100} step={1} onChange={(v) => setCaptionDecorationAction(decorationToBag(firstClip?.text?.decoration, { ...decorationState, radius: v }))} />
            </div>
          )}
        </SubGroup>

        <SubGroup
          title="Highlight Bars"
          toggle={{
            ariaLabel: 'Toggle highlight bars',
            on: decorationState.highlightOn,
            onChange: (on) => setCaptionDecorationAction(decorationToBag(firstClip?.text?.decoration, { ...decorationState, highlightOn: on }))
          }}
        >
          {decorationState.highlightOn && (
            <div className="flex flex-col gap-2 pt-1">
              <div className="flex items-center justify-between gap-2 text-[11px] text-text-secondary">
                <span>Mode</span>
                <select
                  value={decorationState.highlightMode}
                  onChange={(e) => setCaptionDecorationAction(decorationToBag(firstClip?.text?.decoration, { ...decorationState, highlightMode: e.target.value as any }))}
                  className="w-32 rounded-sm border border-line bg-surface-2 px-2 py-1 text-xs text-text-primary"
                >
                  <option value="line">Per Line</option>
                  <option value="word">Per Word</option>
                </select>
              </div>
              <ColorRow label="Color" value={decorationState.highlightColor} onChange={(c) => setCaptionDecorationAction(decorationToBag(firstClip?.text?.decoration, { ...decorationState, highlightColor: c }))} />
              <SliderField label="Opacity" value={decorationState.highlightOpacity} valueText={formatPercent(decorationState.highlightOpacity)} min={0} max={1} step={0.01} onChange={(v) => setCaptionDecorationAction(decorationToBag(firstClip?.text?.decoration, { ...decorationState, highlightOpacity: v }))} />
              <SliderField label="Padding" value={decorationState.highlightPadding} valueText={formatPx(decorationState.highlightPadding, 0)} min={0} max={100} step={1} onChange={(v) => setCaptionDecorationAction(decorationToBag(firstClip?.text?.decoration, { ...decorationState, highlightPadding: v }))} />
              <SliderField label="Corner Radius" value={decorationState.highlightRadius} valueText={formatPx(decorationState.highlightRadius, 0)} min={0} max={100} step={1} onChange={(v) => setCaptionDecorationAction(decorationToBag(firstClip?.text?.decoration, { ...decorationState, highlightRadius: v }))} />
            </div>
          )}
        </SubGroup>
      </Section>

      <Section title="Effects" defaultOpen={false}>
        <div className="mb-2">
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) {
                setCaptionEffectsAction(addEffect(effects, e.target.value as TextEffectType).map((e) => ({ ...e, enabled: true, type: e.type, params: e.params, intensity: e.intensity, opacity: e.opacity })))
              }
            }}
            className="w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-xs font-semibold text-text-primary hover:bg-surface-3 cursor-pointer text-center"
            style={{ textAlignLast: 'center' }}
          >
            <option value="" disabled hidden>+ Add Effect...</option>
            {galleryItems().map((item) => (
              <option key={item.type} value={item.type}>{item.label}</option>
            ))}
          </select>
        </div>
        <ul className="flex flex-col gap-2">
          {effects.map((eff, index) => (
            <EffectRow
              key={`${eff.type}-${index}`}
              effect={eff}
              index={index}
              count={effects.length}
              onToggle={(i, on) => setCaptionEffectsAction(setEffectEnabled(effects, i, on).map((e) => ({ ...e, enabled: e.enabled, type: e.type, params: e.params, intensity: e.intensity, opacity: e.opacity })))}
              onRemove={(i) => setCaptionEffectsAction(removeEffect(effects, i).map((e) => ({ ...e, enabled: e.enabled, type: e.type, params: e.params, intensity: e.intensity, opacity: e.opacity })))}
              onMoveUp={(i) => setCaptionEffectsAction(moveEffectUp(effects, i).map((e) => ({ ...e, enabled: e.enabled, type: e.type, params: e.params, intensity: e.intensity, opacity: e.opacity })))}
              onMoveDown={(i) => setCaptionEffectsAction(moveEffectDown(effects, i).map((e) => ({ ...e, enabled: e.enabled, type: e.type, params: e.params, intensity: e.intensity, opacity: e.opacity })))}
              onIntensity={(i, v) => setCaptionEffectsAction(setEffectIntensity(effects, i, v).map((e) => ({ ...e, enabled: e.enabled, type: e.type, params: e.params, intensity: e.intensity, opacity: e.opacity })))}
              onOpacity={(i, v) => setCaptionEffectsAction(setEffectOpacity(effects, i, v).map((e) => ({ ...e, enabled: e.enabled, type: e.type, params: e.params, intensity: e.intensity, opacity: e.opacity })))}
              onParam={(i, k, v) => setCaptionEffectsAction(setEffectParam(effects, i, k, v).map((e) => ({ ...e, enabled: e.enabled, type: e.type, params: e.params, intensity: e.intensity, opacity: e.opacity })))}
            />
          ))}
        </ul>
      </Section>
    </div>
  )
}

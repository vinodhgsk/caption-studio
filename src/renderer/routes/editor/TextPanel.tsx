import { useMemo, useState, type ReactNode } from 'react'
import { useProjectStore } from '@/store/projectStore'
import { useTimelineStore } from '@/store/timelineStore'
import { fontRegistry } from '../../../shared/fontRegistry'
import { detectScript } from '../../../shared/scriptDetect'
import { getFontSuggestionProvider } from '../../../shared/fontSuggestRegistry'
import type { FontSuggestion } from '../../../shared/fontSuggest'
import { resolveTextFont } from './preview/textFontSpec'
import { isHexColor } from './preview/textFillSpec'
import type { GradientStop } from '../../../shared/captionPreset'
import { importFontsFromPicker } from '@/store/fonts/importFont'
import type { Clip } from '../../../shared/storage'
import {
  EMOJI_PALETTE,
  TEXT_SECTIONS,
  TEXT_ALIGN_OPTIONS,
  clamp,
  decorationToBag,
  decorationSummary,
  defaultSectionState,
  deriveAlignState,
  deriveDecorationState,
  deriveFillState,
  deriveHollow,
  deriveShadowState,
  deriveStrokeLayers,
  deriveWordState,
  formatDeg,
  formatPercent,
  formatPx,
  nextStrokeWidth,
  normalizeHex,
  setAlignPatch,
  setWordColorRuns,
  strokeLayersToBag,
  toggleSection,
  type DecorationState,
  type SectionOpenState,
  type StrokeLayer,
  type TextAlign,
  type TextSectionId
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
import { appendEmoji } from './inlineEmoji'
import type { TextEffect, TextEffectType } from '../../../shared/textEffect'

const WRAP_WIDTH_MODES = ['narrow', 'balanced', 'wide'] as const
type WrapWidthMode = (typeof WRAP_WIDTH_MODES)[number]

/**
 * Text panel (P6.16 — wires Fonts + Color + Stroke + Shadow; Doc 08/10). Owns
 * "Add Text" (create a text clip at the playhead) plus the full styling stack
 * for the SELECTED text clip, organized into a COLLAPSIBLE ACCORDION
 * (Typography / Color / Stroke / Shadow) so the long control list stays scannable
 * at the 320px panel width and never overflows.
 *
 * Every control writes the SAME `clip.text.*` shape the preview/export read,
 * through the single undoable `setClipText` command (one undo step per edit), so
 * preview = export and edits survive reload (master plan §6):
 *   - Typography → `clip.text.font` (family/size/weight/italic/letterSpacing/
 *     lineHeight/curve) — P6.3/P6.5/P6.6.
 *   - Color      → `clip.text.fill` (solid/gradient) + `clip.text.runs` (per-word)
 *     — P6.7/P6.8/P6.9.
 *   - Stroke     → `clip.text.stroke` (stacked layers + hollow) — P6.10–P6.12.
 *   - Shadow     → `clip.text.shadow` (drop/inner/long) — P6.13/P6.14.
 *
 * The pure projections from the open `text.*` bags onto editable values live in
 * `textPanelState.ts` (unit-tested) — this component is a thin wiring layer.
 */
export function TextPanel(): JSX.Element {
  const project = useProjectStore((s) => s.currentProject)
  const currentRef = useProjectStore((s) => s.currentRef)
  const setProjectFonts = useProjectStore((s) => s.setProjectFonts)
  const addTextClip = useTimelineStore((s) => s.addTextClip)
  const beginTextEdit = useTimelineStore((s) => s.beginTextEdit)
  const setClipText = useTimelineStore((s) => s.setClipText)
  const selection = useTimelineStore((s) => s.selection)

  const [importBusy, setImportBusy] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  // AI font generator (P6.6): a prompt → selectable suggested catalog families.
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState<FontSuggestion[]>([])

  // Per-word color (P6.9): which word index the Color section is editing.
  const [selectedWord, setSelectedWord] = useState(0)

  // Accordion open-state (Typography open by default; rest collapsed).
  const [sections, setSections] = useState<SectionOpenState>(defaultSectionState)
  const onToggleSection = (id: TextSectionId): void => setSections((s) => toggleSection(s, id))

  // Resolve the single selected TEXT clip (controls target it). A clip is a text
  // clip when it carries a `text` surface.
  const selectedClip: Clip | null = useMemo(() => {
    if (project === null || selection.length !== 1) return null
    for (const track of project.tracks) {
      const c = track.clips.find((x) => x.id === selection[0])
      if (c !== undefined) return c.text !== undefined ? c : null
    }
    return null
  }, [project, selection])

  const font = useMemo(
    () => resolveTextFont(selectedClip?.text?.font, { family: 'Noto Sans Tamil', sizePx: 64, lineHeight: 1.2 }),
    [selectedClip]
  )
  const wrapWidthMode = useMemo<WrapWidthMode>(() => {
    const raw = selectedClip?.text?.font?.wrapWidth
    return raw === 'narrow' || raw === 'wide' ? raw : 'balanced'
  }, [selectedClip])
  const fillState = useMemo(() => deriveFillState(selectedClip?.text?.fill), [selectedClip])
  const wordState = useMemo(
    () => deriveWordState(selectedClip?.text, selectedClip?.caption?.words),
    [selectedClip]
  )
  const strokeLayers = useMemo(() => deriveStrokeLayers(selectedClip?.text?.stroke), [selectedClip])
  const hollow = useMemo(() => deriveHollow(selectedClip?.text?.stroke), [selectedClip])
  const shadowState = useMemo(() => deriveShadowState(selectedClip?.text?.shadow), [selectedClip])
  const decorationState = useMemo(
    () => deriveDecorationState(selectedClip?.text?.decoration),
    [selectedClip]
  )
  const effects = useMemo(() => deriveEffects(selectedClip?.text?.effects), [selectedClip])
  const alignState = useMemo(() => deriveAlignState(selectedClip?.text), [selectedClip])

  // Library families for the family <select>.
  const families = fontRegistry.listFonts()

  const handleAdd = (): void => {
    const id = addTextClip()
    if (id !== null) beginTextEdit(id)
  }

  // --- writers: each is one undoable setClipText command -------------------

  const patchFont = (patch: Record<string, unknown>): void => {
    if (selectedClip === null) return
    const prev = selectedClip.text?.font ?? {}
    setClipText(selectedClip.id, { font: { ...prev, ...patch } })
  }

  const setWrapWidthMode = (mode: WrapWidthMode): void => {
    patchFont({ wrapWidth: mode })
  }

  const handleWrapWidthKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    mode: WrapWidthMode
  ): void => {
    const idx = WRAP_WIDTH_MODES.indexOf(mode)
    if (idx < 0) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      const next = WRAP_WIDTH_MODES[(idx + 1) % WRAP_WIDTH_MODES.length]
      setWrapWidthMode(next)
      return
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = WRAP_WIDTH_MODES[(idx - 1 + WRAP_WIDTH_MODES.length) % WRAP_WIDTH_MODES.length]
      setWrapWidthMode(next)
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      setWrapWidthMode(WRAP_WIDTH_MODES[0])
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      setWrapWidthMode(WRAP_WIDTH_MODES[WRAP_WIDTH_MODES.length - 1])
    }
  }

  const setSolidFill = (hex: string, opacity: number): void => {
    if (selectedClip === null) return
    const prev = selectedClip.text?.fill ?? {}
    setClipText(selectedClip.id, {
      fill: { ...prev, type: 'solid', value: normalizeHex(hex), opacity: clamp(opacity, 0, 1) }
    })
  }

  const setGradientFill = (stops: GradientStop[], opacity: number, angle: number): void => {
    if (selectedClip === null) return
    const prev = selectedClip.text?.fill ?? {}
    setClipText(selectedClip.id, {
      fill: {
        ...prev,
        type: 'gradient',
        value: stops.map((s) => ({ offset: clamp(s.offset, 0, 1), color: normalizeHex(s.color) })),
        opacity: clamp(opacity, 0, 1),
        angle
      }
    })
  }

  const switchFillType = (next: 'solid' | 'gradient'): void => {
    if (next === 'gradient') {
      const seed: GradientStop[] =
        fillState.stops.length >= 2
          ? fillState.stops
          : [
            { offset: 0, color: fillState.hex },
            { offset: 1, color: '#000000' }
          ]
      setGradientFill(seed, fillState.opacity, fillState.angle)
    } else {
      setSolidFill(fillState.stops[0]?.color ?? fillState.hex, fillState.opacity)
    }
  }

  const addStop = (): void => {
    const s = fillState.stops
    const last = s[s.length - 1]?.offset ?? 1
    const prevLast = s[s.length - 2]?.offset ?? 0
    const offset = clamp((last + prevLast) / 2, 0, 1)
    setGradientFill([...s, { offset, color: '#ffffff' }], fillState.opacity, fillState.angle)
  }
  const removeStop = (i: number): void => {
    if (fillState.stops.length <= 2) return
    setGradientFill(fillState.stops.filter((_, idx) => idx !== i), fillState.opacity, fillState.angle)
  }
  const setStopColor = (i: number, hex: string): void => {
    setGradientFill(fillState.stops.map((s, idx) => (idx === i ? { ...s, color: hex } : s)), fillState.opacity, fillState.angle)
  }
  const setStopOffset = (i: number, offset: number): void => {
    setGradientFill(fillState.stops.map((s, idx) => (idx === i ? { ...s, offset } : s)), fillState.opacity, fillState.angle)
  }

  const setWordColor = (i: number, hex: string | null): void => {
    if (selectedClip === null || i < 0) return
    setClipText(selectedClip.id, { runs: setWordColorRuns(selectedClip.text?.runs, i, hex) })
  }

  // Stroke writers.
  const writeStrokeLayers = (layers: StrokeLayer[], hollowFlag: boolean = hollow): void => {
    if (selectedClip === null) return
    setClipText(selectedClip.id, { stroke: strokeLayersToBag(layers, hollowFlag) })
  }
  const toggleHollow = (next: boolean): void => writeStrokeLayers(strokeLayers, next)
  const addStrokeLayer = (): void =>
    writeStrokeLayers([...strokeLayers, { hex: '#000000', width: nextStrokeWidth(strokeLayers) }])
  const removeStrokeLayer = (i: number): void => writeStrokeLayers(strokeLayers.filter((_, idx) => idx !== i))
  const setStrokeLayerColor = (i: number, hex: string): void =>
    writeStrokeLayers(strokeLayers.map((l, idx) => (idx === i ? { ...l, hex } : l)))
  const setStrokeLayerWidthAt = (i: number, width: number): void =>
    writeStrokeLayers(strokeLayers.map((l, idx) => (idx === i ? { ...l, width: Math.max(0, clamp(width, 0, 24)) } : l)))

  // Shadow writers.
  const writeShadow = (
    patch: Partial<{ color: string; opacity: number; blur: number; angle: number; distance: number; inner: boolean; long: boolean }>
  ): void => {
    if (selectedClip === null) return
    setClipText(selectedClip.id, {
      shadow: {
        color: normalizeHex(patch.color ?? shadowState.color),
        opacity: clamp(patch.opacity ?? shadowState.opacity, 0, 1),
        blur: Math.max(0, patch.blur ?? shadowState.blur),
        angle: clamp(patch.angle ?? shadowState.angle, -180, 180),
        distance: Math.max(0, patch.distance ?? shadowState.distance),
        inner: patch.inner ?? shadowState.inner,
        long: patch.long ?? shadowState.long
      }
    })
  }
  const toggleShadow = (on: boolean): void => {
    if (on) {
      writeShadow({
        distance: shadowState.distance > 0 ? shadowState.distance : 6,
        blur: shadowState.blur > 0 ? shadowState.blur : 8
      })
    } else {
      writeShadow({ distance: 0 })
    }
  }
  const setShadowType = (type: 'drop' | 'inner' | 'long'): void =>
    writeShadow({ inner: type === 'inner', long: type === 'long' })

  // Decoration writers (P7.8 — background bubble). One undoable setClipText that
  // MERGES onto the existing decoration bag (future underline/strike/highlight/emoji
  // survive). Each control patches the background-bubble state and re-serializes.
  const writeDecoration = (patch: Partial<DecorationState>): void => {
    if (selectedClip === null) return
    const next: DecorationState = { ...decorationState, ...patch }
    setClipText(selectedClip.id, { decoration: decorationToBag(selectedClip.text?.decoration, next) })
  }
  const toggleBackground = (on: boolean): void =>
    writeDecoration({
      backgroundOn: on,
      // Seed a sensible padding/radius the first time the bubble is enabled.
      padding: on && decorationState.padding === 0 ? 16 : decorationState.padding,
      radius: on && decorationState.radius === 0 ? 12 : decorationState.radius
    })

  // Inline emoji (P7.11 — Doc 05): append a single-cluster emoji to the run flow as
  // ONE undoable setClipText (it flows/wraps/animates as one more cluster — the
  // cluster pipeline needs no emoji-specific path). Appends to the LAST line so an
  // empty clip still gets a first line. Lives in the Decorations panel as the
  // authoring affordance (the emoji itself is plain run text, not a decoration field).
  const insertEmoji = (emoji: string): void => {
    if (selectedClip === null) return
    const lines = selectedClip.text?.lines ?? []
    const next = lines.length === 0 ? [emoji] : lines.map((ln, i) => (i === lines.length - 1 ? appendEmoji(ln, emoji) : ln))
    setClipText(selectedClip.id, { lines: next })
  }

  // Effects writers (P7.7). Each runs ONE undoable setClipText with the new
  // ORDERED stack — the array order IS the composite order the preview/export run.
  const writeEffects = (next: TextEffect[]): void => {
    if (selectedClip === null) return
    setClipText(selectedClip.id, { effects: next })
  }
  const handleAddEffect = (type: TextEffectType): void => writeEffects(addEffect(effects, type))
  const handleRemoveEffect = (i: number): void => writeEffects(removeEffect(effects, i))
  const handleMoveEffectUp = (i: number): void => writeEffects(moveEffectUp(effects, i))
  const handleMoveEffectDown = (i: number): void => writeEffects(moveEffectDown(effects, i))
  const handleToggleEffect = (i: number, on: boolean): void =>
    writeEffects(setEffectEnabled(effects, i, on))
  const handleEffectIntensity = (i: number, v: number): void =>
    writeEffects(setEffectIntensity(effects, i, v))
  const handleEffectOpacity = (i: number, v: number): void =>
    writeEffects(setEffectOpacity(effects, i, v))
  const handleEffectParam = (i: number, key: string, value: number | string): void =>
    writeEffects(setEffectParam(effects, i, key, value))

  // --- async actions -------------------------------------------------------

  const handleImport = async (): Promise<void> => {
    if (currentRef === null || project === null) return
    setImportBusy(true)
    setImportMsg(null)
    try {
      const outcome = await importFontsFromPicker(currentRef, project)
      if (outcome.ok) {
        setProjectFonts(outcome.manifest)
        setImportMsg(outcome.families.length > 0 ? `Imported: ${outcome.families.join(', ')}` : 'No fonts selected.')
      } else {
        setImportMsg(outcome.error)
      }
    } finally {
      setImportBusy(false)
    }
  }

  const handleSuggest = async (): Promise<void> => {
    setAiBusy(true)
    try {
      const sampleText = (selectedClip?.text?.lines ?? []).join(' ')
      const script = sampleText.trim().length > 0 ? detectScript(sampleText) : undefined
      const out = await getFontSuggestionProvider().suggest(aiPrompt, script !== undefined ? { script } : undefined)
      setAiSuggestions(out)
    } finally {
      setAiBusy(false)
    }
  }

  const labelFor = (id: TextSectionId): string => TEXT_SECTIONS.find((s) => s.id === id)?.label ?? id

  const isBold = font.weight === 'bold' || (typeof font.weight === 'number' && font.weight >= 600)
  const disabled = selectedClip === null

  return (
    <section className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <h2 className="text-sm font-semibold text-text-primary">Text</h2>

      <button
        type="button"
        onClick={handleAdd}
        disabled={project === null}
        className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-text-primary hover:bg-accent-hover disabled:opacity-50"
      >
        Add Text
      </button>

      {disabled ? (
        <p className="text-xs text-text-muted">Select a text clip to style its font, color, stroke, and shadow.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {/* ---- Typography (P6.3/P6.5/P6.6) ------------------------------ */}
          <Section
            id="typography"
            label={labelFor('typography')}
            open={sections.typography}
            onToggle={onToggleSection}
            aside={
              <button
                type="button"
                onClick={() => void handleImport()}
                disabled={project === null || currentRef === null || importBusy}
                className="rounded-sm border border-line px-2 py-0.5 text-[11px] text-text-secondary hover:bg-surface-2 disabled:opacity-50"
              >
                {importBusy ? 'Importing…' : 'Import font…'}
              </button>
            }
          >
            {importMsg !== null && <p className="text-[11px] text-text-muted">{importMsg}</p>}

            <label className="flex flex-col gap-1 text-[11px] text-text-secondary">
              Font family
              <select
                value={font.family}
                onChange={(e) => patchFont({ family: e.target.value })}
                className="w-full rounded-sm border border-line bg-surface-2 px-2 py-1 text-xs text-text-primary"
              >
                {families.map((f) => (
                  <option key={f.family} value={f.family}>
                    {f.displayName} ({f.category})
                  </option>
                ))}
              </select>
            </label>

            {/* AI font (P6.6) */}
            <div className="flex flex-col gap-1.5 rounded-sm border border-line bg-surface-2/50 p-2">
              <span className="text-[11px] font-medium text-text-secondary">AI font</span>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={aiPrompt}
                  placeholder="e.g. bold cinematic tamil"
                  onChange={(e) => setAiPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSuggest()
                  }}
                  className="min-w-0 flex-1 rounded-sm border border-line bg-surface-2 px-2 py-1 text-xs text-text-primary"
                />
                <button
                  type="button"
                  onClick={() => void handleSuggest()}
                  disabled={aiBusy}
                  className="shrink-0 rounded-sm border border-line px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-2 disabled:opacity-50"
                >
                  {aiBusy ? 'Thinking…' : 'Suggest'}
                </button>
              </div>
              {aiSuggestions.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {aiSuggestions.map((s) => (
                    <li key={s.family}>
                      <button
                        type="button"
                        onClick={() => patchFont({ family: s.family })}
                        title={s.reason}
                        aria-pressed={font.family === s.family}
                        className={`flex w-full items-baseline justify-between gap-2 rounded-sm border px-2 py-1 text-left ${font.family === s.family
                          ? 'border-accent bg-accent/10'
                          : 'border-line hover:bg-surface-2'
                          }`}
                      >
                        <span className="truncate text-xs text-text-primary" style={{ fontFamily: `"${s.family}", sans-serif` }}>
                          {s.label}
                        </span>
                        <span className="shrink-0 text-[10px] text-text-muted">{s.reason}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Size + lineHeight + letterSpacing */}
            <div className="grid grid-cols-3 gap-2">
              <NumberField
                label="Size"
                value={font.sizePx}
                min={1}
                step={1}
                onChange={(v) => {
                  if (v > 0) patchFont({ size: v })
                }}
              />
              <NumberField
                label="Line height"
                value={font.lineHeight}
                min={0.5}
                step={0.05}
                onChange={(v) => {
                  if (v > 0) patchFont({ lineHeight: v })
                }}
              />
              <NumberField label="Letter spacing" value={font.letterSpacing} step={0.5} onChange={(v) => patchFont({ letterSpacing: v })} />
            </div>

            {/* Inline editor wrap width (narrow/balanced/wide), consumed by the
                preview overlay autosize logic. Stored in `clip.text.font` so it
                persists per clip and round-trips with project data. */}
            <div className="flex flex-col gap-1 text-[11px] text-text-secondary">
              <label htmlFor="tp-wrap-width">Wrap width</label>
              <select
                id="tp-wrap-width"
                value={wrapWidthMode}
                onChange={(e) => patchFont({ wrapWidth: e.target.value })}
                className="w-full rounded-sm border border-line bg-surface-2 px-2 py-1 text-xs text-text-primary"
              >
                <option value="narrow">Narrow</option>
                <option value="balanced">Balanced</option>
                <option value="wide">Wide</option>
              </select>
              <span className="text-[10px] text-text-muted">
                Narrow wraps sooner, Balanced is default, Wide keeps longer lines.
              </span>
              <div
                role="radiogroup"
                aria-label="Wrap width mode quick select"
                className="grid grid-cols-1 gap-1.5 text-[10px] text-text-muted"
              >
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    role="radio"
                    aria-label="Set wrap width to Narrow"
                    aria-checked={wrapWidthMode === 'narrow'}
                    onKeyDown={(e) => handleWrapWidthKeyDown(e, 'narrow')}
                    onClick={() => setWrapWidthMode('narrow')}
                    className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${wrapWidthMode === 'narrow'
                        ? 'border-cyan-300 bg-cyan-500/30 text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.35)]'
                        : 'border-cyan-400/40 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/20'
                      }`}
                  >
                    Narrow
                  </button>
                  best for 9:16 subtitles and lower-thirds.
                </span>
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    role="radio"
                    aria-label="Set wrap width to Balanced"
                    aria-checked={wrapWidthMode === 'balanced'}
                    onKeyDown={(e) => handleWrapWidthKeyDown(e, 'balanced')}
                    onClick={() => setWrapWidthMode('balanced')}
                    className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${wrapWidthMode === 'balanced'
                        ? 'border-amber-300 bg-amber-500/30 text-amber-100 shadow-[0_0_0_1px_rgba(251,191,36,0.35)]'
                        : 'border-amber-400/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/20'
                      }`}
                  >
                    Balanced
                  </button>
                  general editing across formats.
                </span>
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    role="radio"
                    aria-label="Set wrap width to Wide"
                    aria-checked={wrapWidthMode === 'wide'}
                    onKeyDown={(e) => handleWrapWidthKeyDown(e, 'wide')}
                    onClick={() => setWrapWidthMode('wide')}
                    className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${wrapWidthMode === 'wide'
                        ? 'border-violet-300 bg-violet-500/30 text-violet-100 shadow-[0_0_0_1px_rgba(167,139,250,0.35)]'
                        : 'border-violet-400/40 bg-violet-500/15 text-violet-200 hover:bg-violet-500/20'
                      }`}
                  >
                    Wide
                  </button>
                  best for 16:9 titles and longer single lines.
                </span>
              </div>
            </div>

            {/* Bold + italic */}
            <div className="flex gap-2">
              <button
                type="button"
                aria-pressed={isBold}
                onClick={() => patchFont({ bold: !isBold, weight: !isBold ? 'bold' : 'normal' })}
                className={`rounded-sm border px-3 py-1 text-xs font-bold ${isBold ? 'border-accent bg-accent text-text-primary' : 'border-line text-text-secondary hover:bg-surface-2'
                  }`}
              >
                B
              </button>
              <button
                type="button"
                aria-pressed={font.italic}
                onClick={() => patchFont({ italic: !font.italic })}
                className={`rounded-sm border px-3 py-1 text-xs italic ${font.italic ? 'border-accent bg-accent text-text-primary' : 'border-line text-text-secondary hover:bg-surface-2'
                  }`}
              >
                I
              </button>
            </div>

            {/* Text alignment — left / center / right (Doc 01 positioning) */}
            <div className="flex items-center gap-2">
              <span className="w-24 text-[11px] text-text-secondary">Align</span>
              <div
                role="group"
                aria-label="Text alignment"
                className="flex gap-1"
              >
                {TEXT_ALIGN_OPTIONS.map((opt: TextAlign) => (
                  <button
                    key={opt}
                    type="button"
                    aria-pressed={alignState === opt}
                    onClick={() => {
                      if (selectedClip !== null) {
                        setClipText(selectedClip.id, setAlignPatch(opt))
                      }
                    }}
                    className={`rounded-sm border px-3 py-1 text-xs capitalize ${alignState === opt ? 'border-accent bg-accent text-text-primary' : 'border-line text-text-secondary hover:bg-surface-2'}`}
                  >
                    {opt[0].toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Curve / arc (P6.5) */}
            <SliderField
              label="Curve (arc)"
              value={font.curve}
              valueText={font.curve.toFixed(2)}
              min={-1}
              max={1}
              step={0.01}
              onChange={(v) => patchFont({ curve: clamp(v, -1, 1) })}
              hint="0 = straight, + bends up (apex at center), − bends down"
            />
          </Section>

          {/* ---- Color (P6.7/P6.8/P6.9) ----------------------------------- */}
          <Section id="color" label={labelFor('color')} open={sections.color} onToggle={onToggleSection}>
            {/* Fill-type toggle */}
            <div className="flex gap-1" role="group" aria-label="Fill type">
              <ToggleButton active={!fillState.isGradient} onClick={() => switchFillType('solid')}>
                Solid
              </ToggleButton>
              <ToggleButton active={fillState.isGradient} onClick={() => switchFillType('gradient')}>
                Gradient
              </ToggleButton>
            </div>

            {!fillState.isGradient ? (
              <>
                <ColorRow
                  ariaLabel="Fill"
                  hex={fillState.hex}
                  onColor={(v) => setSolidFill(v, fillState.opacity)}
                  onHex={(v) => setSolidFill(v, fillState.opacity)}
                />
                <SliderField
                  label="Opacity"
                  value={fillState.opacity}
                  valueText={formatPercent(fillState.opacity)}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(v) => setSolidFill(fillState.hex, v)}
                />
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  {fillState.stops.map((stop, i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px] text-text-secondary">
                      <input
                        type="color"
                        aria-label={`Stop ${i + 1} color`}
                        value={stop.color}
                        onChange={(e) => setStopColor(i, e.target.value)}
                        className="h-6 w-8 shrink-0 cursor-pointer rounded-sm border border-line bg-surface-2 p-0.5"
                      />
                      <input
                        type="range"
                        aria-label={`Stop ${i + 1} offset`}
                        min={0}
                        max={1}
                        step={0.01}
                        value={stop.offset}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          if (Number.isFinite(v)) setStopOffset(i, v)
                        }}
                        className="min-w-0 flex-1 accent-accent"
                      />
                      <span className="w-8 shrink-0 text-right tabular-nums text-text-muted">{Math.round(stop.offset * 100)}</span>
                      <button
                        type="button"
                        aria-label={`Remove stop ${i + 1}`}
                        disabled={fillState.stops.length <= 2}
                        onClick={() => removeStop(i)}
                        className="shrink-0 rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-text-secondary hover:bg-surface-2 disabled:opacity-40"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addStop}
                    className="self-start rounded-sm border border-line px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-2"
                  >
                    + Add stop
                  </button>
                </div>
                <SliderField
                  label="Angle"
                  ariaLabel="Gradient angle"
                  value={((fillState.angle % 360) + 360) % 360}
                  valueText={formatDeg(fillState.angle)}
                  min={0}
                  max={360}
                  step={1}
                  onChange={(v) => setGradientFill(fillState.stops, fillState.opacity, v)}
                />
                <SliderField
                  label="Opacity"
                  ariaLabel="Gradient opacity"
                  value={fillState.opacity}
                  valueText={formatPercent(fillState.opacity)}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(v) => setGradientFill(fillState.stops, v, fillState.angle)}
                />
              </>
            )}

            {/* Per-word color (P6.9) */}
            <div className="mt-1 flex flex-col gap-2 border-t border-line pt-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Per-word color</h4>
              {wordState.words.length === 0 ? (
                <p className="text-[11px] text-text-muted">Add text to color individual words.</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1" role="group" aria-label="Word to color">
                    {wordState.words.map((w, i) => {
                      const override = wordState.colorAt(i)
                      const active = i === selectedWord
                      return (
                        <button
                          key={i}
                          type="button"
                          aria-pressed={active}
                          title={override !== null ? `${w} (${override})` : w}
                          onClick={() => setSelectedWord(i)}
                          className={`max-w-[8rem] truncate rounded-sm border px-1.5 py-0.5 text-[11px] ${active ? 'border-accent bg-accent/20 text-text-primary' : 'border-line text-text-secondary hover:bg-surface-2'
                            }`}
                        >
                          <span
                            aria-hidden
                            className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                            style={{ backgroundColor: override ?? 'transparent', outline: '1px solid rgb(var(--color-border))' }}
                          />
                          {w.length > 0 ? w : '␣'}
                        </button>
                      )
                    })}
                  </div>
                  {(() => {
                    const idx = Math.min(selectedWord, wordState.words.length - 1)
                    const override = wordState.colorAt(idx)
                    return (
                      <div className="flex items-center gap-2 text-[11px] text-text-secondary">
                        <input
                          type="color"
                          aria-label={`Word ${idx + 1} color`}
                          value={override ?? fillState.hex}
                          onChange={(e) => setWordColor(idx, e.target.value)}
                          className="h-7 w-9 shrink-0 cursor-pointer rounded-sm border border-line bg-surface-2 p-0.5"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {override !== null ? <span className="font-mono">{override}</span> : <span className="text-text-muted">Using base fill</span>}
                        </span>
                        <button
                          type="button"
                          aria-label={`Reset word ${idx + 1} color`}
                          disabled={override === null}
                          onClick={() => setWordColor(idx, null)}
                          className="shrink-0 rounded-sm border border-line px-2 py-0.5 text-[11px] text-text-secondary hover:bg-surface-2 disabled:opacity-40"
                        >
                          Reset
                        </button>
                      </div>
                    )
                  })()}
                </>
              )}
            </div>
          </Section>

          {/* ---- Stroke (P6.10/P6.11/P6.12) ------------------------------- */}
          <Section
            id="stroke"
            label={labelFor('stroke')}
            open={sections.stroke}
            onToggle={onToggleSection}
            aside={
              <span className="text-[10px] text-text-muted">
                {strokeLayers.length === 0 ? 'none' : `${strokeLayers.length} layer${strokeLayers.length === 1 ? '' : 's'}`}
              </span>
            }
          >
            {strokeLayers.length === 0 ? (
              <p className="text-[11px] text-text-muted">No outline. Add a layer to frame the glyph.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {strokeLayers.map((layer, i) => (
                  <li key={i} className="flex flex-col gap-1.5 rounded-sm border border-line bg-surface-2/50 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-text-muted">Layer {i + 1}</span>
                      <button
                        type="button"
                        aria-label={`Remove stroke layer ${i + 1}`}
                        onClick={() => removeStrokeLayer(i)}
                        className="shrink-0 rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-text-secondary hover:bg-surface-2"
                      >
                        ✕
                      </button>
                    </div>
                    <ColorRow
                      ariaLabel={`Stroke layer ${i + 1}`}
                      hex={layer.hex}
                      onColor={(v) => setStrokeLayerColor(i, v)}
                      onHex={(v) => setStrokeLayerColor(i, v)}
                    />
                    <SliderField
                      label="Thickness"
                      ariaLabel={`Stroke layer ${i + 1} thickness`}
                      value={layer.width}
                      valueText={formatPx(layer.width, 1)}
                      min={0}
                      max={24}
                      step={0.5}
                      onChange={(v) => setStrokeLayerWidthAt(i, v)}
                    />
                  </li>
                ))}
              </ul>
            )}

            <button
              type="button"
              onClick={addStrokeLayer}
              className="self-start rounded-sm border border-line px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-2"
            >
              + Add layer
            </button>

            {/* Hollow / outline-only (P6.12) */}
            <label className="flex items-center gap-2 text-[11px] text-text-secondary">
              <input
                type="checkbox"
                aria-label="Hollow / outline-only"
                checked={hollow}
                onChange={(e) => toggleHollow(e.target.checked)}
                className="h-3.5 w-3.5 shrink-0 accent-accent"
              />
              <span>Hollow / outline-only (transparent body)</span>
            </label>
            {hollow && strokeLayers.length === 0 && (
              <span className="text-[10px] text-warning">Hollow needs a stroke — add a layer or nothing will show.</span>
            )}
            <span className="text-[10px] text-text-muted">Layers paint widest-first (outside-in). Set thickness to 0 to drop a layer.</span>
          </Section>

          {/* ---- Shadow (P6.13/P6.14) ------------------------------------- */}
          <Section
            id="shadow"
            label={labelFor('shadow')}
            open={sections.shadow}
            onToggle={onToggleSection}
            aside={
              <label className="flex items-center gap-1.5 text-[11px] text-text-secondary" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  aria-label="Enable shadow"
                  checked={shadowState.on}
                  onChange={(e) => toggleShadow(e.target.checked)}
                  className="h-3.5 w-3.5 shrink-0 accent-accent"
                />
                <span>{shadowState.on ? 'On' : 'Off'}</span>
              </label>
            }
          >
            {!shadowState.on ? (
              <p className="text-[11px] text-text-muted">No shadow. Enable to cast a drop shadow.</p>
            ) : (
              <>
                <label className="flex items-center justify-between gap-2 text-[11px] text-text-secondary">
                  <span>Type</span>
                  <select
                    aria-label="Shadow type"
                    value={shadowState.type}
                    onChange={(e) => setShadowType(e.target.value as 'drop' | 'inner' | 'long')}
                    className="min-w-0 flex-1 rounded-sm border border-line bg-surface-2 px-2 py-1 text-xs text-text-primary"
                  >
                    <option value="drop">Drop</option>
                    <option value="inner">Inner</option>
                    <option value="long">Long</option>
                  </select>
                </label>
                <ColorRow ariaLabel="Shadow" hex={shadowState.color} onColor={(v) => writeShadow({ color: v })} onHex={(v) => writeShadow({ color: v })} />
                <SliderField
                  label="Opacity"
                  ariaLabel="Shadow opacity"
                  value={shadowState.opacity}
                  valueText={formatPercent(shadowState.opacity)}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(v) => writeShadow({ opacity: v })}
                />
                <SliderField
                  label="Blur"
                  ariaLabel="Shadow blur"
                  value={shadowState.blur}
                  valueText={formatPx(shadowState.blur)}
                  min={0}
                  max={40}
                  step={1}
                  onChange={(v) => writeShadow({ blur: v })}
                />
                <SliderField
                  label="Angle"
                  ariaLabel="Shadow angle"
                  value={shadowState.angle}
                  valueText={formatDeg(shadowState.angle)}
                  min={-180}
                  max={180}
                  step={1}
                  onChange={(v) => writeShadow({ angle: v })}
                  hint="0° = right, 90° = down, −90° = up, ±180° = left"
                />
                <SliderField
                  label="Distance"
                  ariaLabel="Shadow distance"
                  value={shadowState.distance}
                  valueText={formatPx(shadowState.distance)}
                  min={0}
                  max={40}
                  step={1}
                  onChange={(v) => writeShadow({ distance: v })}
                  hint="0 = no shadow."
                />
              </>
            )}
          </Section>

          {/* ---- Decorations (P7.8–P7.12 — Doc 05) ------------------------ */}
          {/* Grouped into four coherent sub-blocks (Background bubble / Highlight bars
              / Underline & strike / Inline emoji), each a `SubGroup` with its own
              enable toggle, matching the Stroke/Shadow/Effects sections' tokens. The
              draw order is LOCKED in `textDecorationSpec.DECORATION_RENDER_ORDER`:
              clip-bg → bubble → bars → glyph passes (incl. effects) → underline/strike. */}
          <Section
            id="decorations"
            label={labelFor('decorations')}
            open={sections.decorations}
            onToggle={onToggleSection}
            aside={
              <span className="text-[10px] text-text-muted">
                {decorationSummary(decorationState)}
              </span>
            }
          >
            {/* Background bubble (P7.8): one rounded rect behind the WHOLE block. */}
            <SubGroup
              title="Background bubble"
              toggle={{
                ariaLabel: 'Enable background bubble',
                on: decorationState.backgroundOn,
                onChange: toggleBackground
              }}
            >
              {!decorationState.backgroundOn ? (
                <p className="text-[11px] text-text-muted">
                  Off. A rounded rect behind the whole text block.
                </p>
              ) : (
                <>
                  <ColorRow
                    ariaLabel="Background"
                    hex={decorationState.color}
                    onColor={(v) => writeDecoration({ color: v })}
                    onHex={(v) => writeDecoration({ color: v })}
                  />
                  <SliderField
                    label="Opacity"
                    ariaLabel="Background opacity"
                    value={decorationState.opacity}
                    valueText={formatPercent(decorationState.opacity)}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(v) => writeDecoration({ opacity: v })}
                  />
                  <SliderField
                    label="Padding"
                    ariaLabel="Background padding"
                    value={decorationState.padding}
                    valueText={formatPx(decorationState.padding)}
                    min={0}
                    max={80}
                    step={1}
                    onChange={(v) => writeDecoration({ padding: Math.max(0, v) })}
                  />
                  <SliderField
                    label="Corner radius"
                    ariaLabel="Background corner radius"
                    value={decorationState.radius}
                    valueText={formatPx(decorationState.radius)}
                    min={0}
                    max={80}
                    step={1}
                    onChange={(v) => writeDecoration({ radius: Math.max(0, v) })}
                    hint="0 = sharp corners"
                  />
                </>
              )}
            </SubGroup>

            {/* Highlight BARS (P7.10): the marker/highlighter look — colored rounded
                rects behind the glyphs, per word or per line (run bounds). DISTINCT
                from the caption active-word highlight (P5.6 PresetHighlight). */}
            <SubGroup
              title="Highlight bars"
              toggle={{
                ariaLabel: 'Highlight bars',
                on: decorationState.highlightOn,
                onChange: (on) =>
                  writeDecoration({
                    highlightOn: on,
                    // Seed a sensible padding/radius the first time bars are enabled.
                    highlightPadding:
                      on && decorationState.highlightPadding === 0 ? 4 : decorationState.highlightPadding,
                    highlightRadius:
                      on && decorationState.highlightRadius === 0 ? 4 : decorationState.highlightRadius
                  })
              }}
            >
              {!decorationState.highlightOn ? (
                <p className="text-[11px] text-text-muted">Off. A highlighter pen behind each word or line.</p>
              ) : (
                <>
                  <label className="flex items-center justify-between gap-2 text-[11px] text-text-secondary">
                    <span>Mode</span>
                    <select
                      aria-label="Highlight bar mode"
                      value={decorationState.highlightMode}
                      onChange={(e) => writeDecoration({ highlightMode: e.target.value === 'line' ? 'line' : 'word' })}
                      className="min-w-0 flex-1 rounded-sm border border-line bg-surface-2 px-2 py-1 text-xs text-text-primary"
                    >
                      <option value="word">Per word</option>
                      <option value="line">Full line</option>
                    </select>
                  </label>
                  <ColorRow
                    ariaLabel="Highlight bar color"
                    hex={decorationState.highlightColor}
                    onColor={(v) => writeDecoration({ highlightColor: v })}
                    onHex={(v) => writeDecoration({ highlightColor: v })}
                  />
                  <SliderField
                    label="Opacity"
                    ariaLabel="Highlight bar opacity"
                    value={decorationState.highlightOpacity}
                    valueText={formatPercent(decorationState.highlightOpacity)}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(v) => writeDecoration({ highlightOpacity: v })}
                  />
                  <SliderField
                    label="Padding"
                    ariaLabel="Highlight bar padding"
                    value={decorationState.highlightPadding}
                    valueText={formatPx(decorationState.highlightPadding)}
                    min={0}
                    max={40}
                    step={1}
                    onChange={(v) => writeDecoration({ highlightPadding: Math.max(0, v) })}
                  />
                  <SliderField
                    label="Corner radius"
                    ariaLabel="Highlight bar corner radius"
                    value={decorationState.highlightRadius}
                    valueText={formatPx(decorationState.highlightRadius)}
                    min={0}
                    max={40}
                    step={1}
                    onChange={(v) => writeDecoration({ highlightRadius: Math.max(0, v) })}
                    hint="0 = sharp corners"
                  />
                </>
              )}
            </SubGroup>

            {/* Underline / strikethrough rules (P7.9): baseline-aware + size-scaled;
                one rule per visual line, spanning the measured width. */}
            <SubGroup title="Underline & strike">
              <label className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                <input
                  type="checkbox"
                  aria-label="Underline"
                  checked={decorationState.underlineOn}
                  onChange={(e) => writeDecoration({ underlineOn: e.target.checked })}
                  className="h-3.5 w-3.5 shrink-0 accent-accent"
                />
                <span>Underline</span>
              </label>
              {decorationState.underlineOn && (
                <ColorRow
                  ariaLabel="Underline color"
                  hex={decorationState.underlineColor === '' ? decorationState.color : decorationState.underlineColor}
                  onColor={(v) => writeDecoration({ underlineColor: v })}
                  onHex={(v) => writeDecoration({ underlineColor: v })}
                />
              )}
              <label className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                <input
                  type="checkbox"
                  aria-label="Strikethrough"
                  checked={decorationState.strikeOn}
                  onChange={(e) => writeDecoration({ strikeOn: e.target.checked })}
                  className="h-3.5 w-3.5 shrink-0 accent-accent"
                />
                <span>Strikethrough</span>
              </label>
              {decorationState.strikeOn && (
                <ColorRow
                  ariaLabel="Strikethrough color"
                  hex={decorationState.strikeColor === '' ? decorationState.color : decorationState.strikeColor}
                  onColor={(v) => writeDecoration({ strikeColor: v })}
                  onHex={(v) => writeDecoration({ strikeColor: v })}
                />
              )}
              <span className="text-[10px] text-text-muted">
                Rules scale with the font size and sit at the baseline / x-height. Color defaults to the glyph fill.
              </span>
            </SubGroup>

            {/* Inline emoji (P7.11): one-tap insert of a single-cluster emoji into the
                run flow (it flows / wraps / animates as one more cluster). */}
            <SubGroup title="Inline emoji">
              <div className="flex flex-wrap gap-1" role="group" aria-label="Insert emoji">
                {EMOJI_PALETTE.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={`Insert ${emoji}`}
                    onClick={() => insertEmoji(emoji)}
                    className="flex h-7 w-7 items-center justify-center rounded-sm border border-line text-base leading-none hover:bg-surface-2"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-text-muted">Appends to the text run at the end of the last line.</span>
            </SubGroup>
          </Section>

          {/* ---- Effects (P7.7 — Doc 04) ---------------------------------- */}
          <Section
            id="effects"
            label={labelFor('effects')}
            open={sections.effects}
            onToggle={onToggleSection}
            aside={
              <span className="text-[10px] text-text-muted">
                {effects.length === 0 ? 'none' : `${effects.length} effect${effects.length === 1 ? '' : 's'}`}
              </span>
            }
          >
            {/* Gallery — ADD an effect (one default per type). */}
            <div className="flex flex-col gap-1.5">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Add effect</h4>
              <div className="flex flex-wrap gap-1" role="group" aria-label="Add effect">
                {galleryItems().map((item) => (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => handleAddEffect(item.type)}
                    className="rounded-sm border border-line px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-2"
                  >
                    + {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* The ordered effect STACK (effects[0] composes first → last on top). */}
            {effects.length === 0 ? (
              <p className="text-[11px] text-text-muted">No effects. Add one above — they stack in order (top = composed first).</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {effects.map((effect, i) => (
                  <EffectRow
                    key={i}
                    effect={effect}
                    index={i}
                    count={effects.length}
                    onToggle={handleToggleEffect}
                    onRemove={handleRemoveEffect}
                    onMoveUp={handleMoveEffectUp}
                    onMoveDown={handleMoveEffectDown}
                    onIntensity={handleEffectIntensity}
                    onOpacity={handleEffectOpacity}
                    onParam={handleEffectParam}
                  />
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}

      <p className="text-xs text-text-muted">
        Double-click a text clip on the canvas (or press Enter) to edit lines. Styling controls edit the selected clip and persist to the project.
      </p>
    </section>
  )
}

// ===========================================================================
// Presentational helpers — shared so every section matches the design tokens.
// ===========================================================================

/** A collapsible accordion section with a clickable header (chevron + label). */
function Section({
  id,
  label,
  open,
  onToggle,
  aside,
  children
}: {
  id: TextSectionId
  label: string
  open: boolean
  onToggle: (id: TextSectionId) => void
  aside?: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <div className="rounded-md border border-line bg-surface-2/30">
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => onToggle(id)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wide text-text-secondary hover:text-text-primary"
        >
          <span aria-hidden className={`inline-block text-text-muted transition-transform ${open ? 'rotate-90' : ''}`}>
            ›
          </span>
          <span className="truncate">{label}</span>
        </button>
        {aside !== undefined && <div className="shrink-0">{aside}</div>}
      </div>
      {open && <div className="flex flex-col gap-2 border-t border-line p-2">{children}</div>}
    </div>
  )
}

/**
 * A titled sub-block WITHIN a section (used to group the Decorations families:
 * Background bubble / Highlight bars / Underline & strike / Inline emoji). A bordered
 * card with an uppercase title and an OPTIONAL right-aligned On/Off toggle, matching
 * the section/control design tokens so the grouping reads consistently at panel width.
 */
function SubGroup({
  title,
  toggle,
  children
}: {
  title: string
  toggle?: { ariaLabel: string; on: boolean; onChange: (on: boolean) => void }
  children: ReactNode
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-line bg-surface-2/50 p-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{title}</h4>
        {toggle !== undefined && (
          <label className="flex items-center gap-1.5 text-[11px] text-text-secondary">
            <input
              type="checkbox"
              aria-label={toggle.ariaLabel}
              checked={toggle.on}
              onChange={(e) => toggle.onChange(e.target.checked)}
              className="h-3.5 w-3.5 shrink-0 accent-accent"
            />
            <span>{toggle.on ? 'On' : 'Off'}</span>
          </label>
        )}
      </div>
      {children}
    </div>
  )
}

/** A 1-of-2 segmented toggle button (fill-type style). */
function ToggleButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex-1 rounded-sm border px-2 py-1 text-[11px] ${active ? 'border-accent bg-accent/20 text-text-primary' : 'border-line text-text-secondary hover:bg-surface-2'
        }`}
    >
      {children}
    </button>
  )
}

/** A labeled numeric input that emits parsed finite values only. */
function NumberField({
  label,
  value,
  min,
  step,
  onChange
}: {
  label: string
  value: number
  min?: number
  step?: number
  onChange: (v: number) => void
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-text-secondary">
      {label}
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(v)
        }}
        className="w-full rounded-sm border border-line bg-surface-2 px-2 py-1 text-xs text-text-primary"
      />
    </label>
  )
}

/** A labeled range slider with a right-aligned value readout + optional hint. */
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
}): JSX.Element {
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

/**
 * ONE effect in the stack (P7.7): a header (reorder + label + enable + remove), the
 * common intensity/opacity sliders, and the per-type params driven by
 * `EFFECT_PARAM_META`. Order in the list IS the composite order.
 */
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
            ariaLabel={`${effectTypeLabel(effect.type)} ${m.label}`}
            hex={typeof params[m.key] === 'string' ? (params[m.key] as string) : '#ffffff'}
            onColor={(v) => onParam(index, m.key, v)}
            onHex={(v) => onParam(index, m.key, v)}
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

/** Format an effect param value for its slider readout per the param's `unit`. */
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

/** A color swatch + hex text input pair (commits valid hex only). */
function ColorRow({
  ariaLabel,
  hex,
  onColor,
  onHex
}: {
  ariaLabel: string
  hex: string
  onColor: (v: string) => void
  onHex: (v: string) => void
}): JSX.Element {
  return (
    <label className="flex items-center gap-2 text-[11px] text-text-secondary">
      <input
        type="color"
        aria-label={`${ariaLabel} color`}
        value={hex}
        onChange={(e) => onColor(e.target.value)}
        className="h-7 w-9 shrink-0 cursor-pointer rounded-sm border border-line bg-surface-2 p-0.5"
      />
      <input
        type="text"
        aria-label={`${ariaLabel} hex`}
        value={hex}
        spellCheck={false}
        onChange={(e) => {
          const v = e.target.value.trim()
          if (isHexColor(v)) onHex(v)
        }}
        className="min-w-0 flex-1 rounded-sm border border-line bg-surface-2 px-2 py-1 font-mono text-xs text-text-primary"
      />
    </label>
  )
}

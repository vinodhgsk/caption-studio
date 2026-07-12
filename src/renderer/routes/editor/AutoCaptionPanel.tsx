import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Clip } from '../../../shared/project-schema'
import type { LanguageCode } from '../../../shared/stt'
import type { GroupingOptions } from '../../../shared/captionSync'
import { DEFAULT_GROUPING_OPTIONS } from '../../../shared/captionSync'
import { alignedLyricsToCaptionLines } from '../../../shared/lyricsFirst'
import { useProjectStore } from '@/store/projectStore'
import { useTimelineStore } from '@/store/timelineStore'
import type { LayoutAnchor } from '../../../shared/captionPreset'
import { DEFAULT_APPLIED_CAPTION_PRESET_ID, listCaptionPresets } from '../../../shared/captionPresetRegistry'
import { fontRegistry } from '../../../shared/fontRegistry'
import { CAPTION_TRACK_ID } from '@/store/timeline'

/**
 * A collapsible titled section (native `<details>`) — the panel is a long stack
 * of controls, so grouping them into expandable sections keeps it compact and
 * scalable. Open by default so nothing is hidden on first use (and so automated
 * flows can reach the controls); the user can collapse what they don't need.
 */
function Section({
  title,
  defaultOpen = true,
  children
}: {
  title: string
  defaultOpen?: boolean
  children: ReactNode
}): JSX.Element {
  return (
    <details open={defaultOpen} className="group border-t border-line pt-2">
      <summary className="flex cursor-pointer list-none items-center justify-between py-1 text-xs font-semibold text-text-primary">
        <span>{title}</span>
        <span className="text-text-muted transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="flex flex-col gap-2 pb-1 pt-2">{children}</div>
    </details>
  )
}
import { resolutionForAspect, type Aspect } from '../home/aspect'
import { safeAreaPx, safeMarginsForAspect } from '../../../shared/captionPosition'
import {
  LANGUAGE_OPTIONS,
  canGenerate,
  isRunning,
  selectionToLanguage,
  stageLabel,
  stageProgress,
  type CaptionMode,
  type CaptionStage
} from './autoCaption'

/**
 * Auto-Caption panel (P4.8, Doc 02). One-click flow that wires the existing
 * pipeline (P4.1–P4.7) to the UI: it picks the selected (or first) audio clip,
 * NORMALIZES it to a 16 kHz mono WAV (`normalizeAudio`), TRANSCRIBES that WAV via
 * the active STT provider (`transcribe`, optionally pinning the language), then
 * GROUPS the word-level transcript into a Caption track (`generateCaptions` with
 * tunable {@link GroupingOptions}). NONE of those steps are reimplemented here —
 * this is the orchestration + progress surface only.
 *
 * The stage machine ({@link CaptionStage}) drives the status line + progress bar
 * and disables controls while a run is in flight. Any step's failing `{ok,error}`
 * IPC envelope stops the chain and surfaces the error.
 */
export function AutoCaptionPanel(): JSX.Element {
  const project = useProjectStore((s) => s.currentProject)
  const selection = useTimelineStore((s) => s.selection)
  const normalizeAudio = useTimelineStore((s) => s.normalizeAudio)
  const transcribe = useTimelineStore((s) => s.transcribe)
  const alignLyrics = useTimelineStore((s) => s.alignLyrics)
  const generateCaptions = useTimelineStore((s) => s.generateCaptions)
  const generateCaptionsFromLines = useTimelineStore((s) => s.generateCaptionsFromLines)
  const resyncCaptions = useTimelineStore((s) => s.resyncCaptions)
  const applyCaptionPreset = useTimelineStore((s) => s.applyCaptionPreset)
  const setCaptionPosition = useTimelineStore((s) => s.setCaptionPosition)
  const setCaptionFontSizeAction = useTimelineStore((s) => s.setCaptionFontSize)
  const setCaptionFontFamilyAction = useTimelineStore((s) => s.setCaptionFontFamily)
  const setCaptionLineHeightAction = useTimelineStore((s) => s.setCaptionLineHeight)
  const setCaptionLetterSpacingAction = useTimelineStore((s) => s.setCaptionLetterSpacing)
  const setCaptionFillAction = useTimelineStore((s) => s.setCaptionFill)
  const setCaptionShadowAction = useTimelineStore((s) => s.setCaptionShadow)
  const setCaptionGlowAction = useTimelineStore((s) => s.setCaptionGlow)
  const setCaptionStrokeAction = useTimelineStore((s) => s.setCaptionStroke)
  const wrapCaptionTextAction = useTimelineStore((s) => s.wrapCaptionText)
  const removeSilence = useTimelineStore((s) => s.removeSilence)
  const addLyricsAnchor = useTimelineStore((s) => s.addLyricsAnchor)
  const clearLyricsAnchors = useTimelineStore((s) => s.clearLyricsAnchors)
  const seekNextLowConfidence = useTimelineStore((s) => s.seekNextLowConfidenceCaption)
  const playhead = useTimelineStore((s) => s.playhead)
  // Re-subscribe to the project so the Re-sync button's enabled state tracks the
  // Caption track's word timing (recomputed whenever the project changes).
  const hasTranscript = useMemo<boolean>(() => {
    void project
    return useTimelineStore.getState().hasCaptionTranscript()
  }, [project])

  const [stage, setStage] = useState<CaptionStage>('idle')
  const [error, setError] = useState<string | null>(null)
  // Lyrics-first is the PRIMARY flow for the studio (you usually already know
  // the bhajan/song lyrics and only need precise timing), so it is the default.
  const [mode, setMode] = useState<CaptionMode>('lyricsFirst')
  const [language, setLanguage] = useState<'auto' | LanguageCode>('auto')
  const [lyricsInput, setLyricsInput] = useState('')
  const [vocalStem, setVocalStem] = useState(true)
  // Tap-sync: when true, each tap records a line anchor at the current playhead.
  const [tapSyncActive, setTapSyncActive] = useState(false)
  const [tapSyncLineIndex, setTapSyncLineIndex] = useState(0)
  const tapSyncLineCount = lyricsInput.trim() === ''
    ? 0
    : lyricsInput.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('#') && !/^\[/.test(l.trim())).length
  // Default matches the Sarvam Bhakti Gold preset's font size (the applied
  // default), so the size control reflects what's on screen out of the box.
  const [captionFontSize, setCaptionFontSize] = useState(144)
  // Chosen caption font family (panel-owned, like font size) so it PERSISTS across
  // (re)generate/resync — those rebuild+restyle the clips and would otherwise
  // revert to the preset's font. Default = the default preset's face.
  const [captionFont, setCaptionFont] = useState('Baloo Thambi 2')
  // Word-wrap toggle: when on, each caption wraps to `maxWordsPerLine` words.
  const [wordWrap, setWordWrap] = useState(false)
  const [maxWordsPerLine, setMaxWordsPerLine] = useState(4)
  const [lineSpacing, setLineSpacing] = useState(1.4)
  const [letterSpacing, setLetterSpacing] = useState(0)

  // Fill state
  const [fillColor, setFillColor] = useState('#ffffff')
  const [fillOpacity, setFillOpacity] = useState(100)
  const [fillGradient, setFillGradient] = useState(false)
  const [fillStop1, setFillStop1] = useState('#ffffff')
  const [fillStop2, setFillStop2] = useState('#f5c842')
  const [fillAngle, setFillAngle] = useState(90)

  // Stroke state
  const [strokeOn, setStrokeOn] = useState(false)
  const [strokeColor, setStrokeColor] = useState('#000000')
  const [strokeWidth, setStrokeWidth] = useState(4)

  // Glow state
  const [glowOn, setGlowOn] = useState(false)
  const [glowColor, setGlowColor] = useState('#ffffff')
  const [glowRadius, setGlowRadius] = useState(12)

  // Shadow state
  const [shadowOn, setShadowOn] = useState(false)
  const [shadowColor, setShadowColor] = useState('#000000')
  const [shadowOpacity, setShadowOpacity] = useState(60)
  const [shadowBlur, setShadowBlur] = useState(8)
  const [shadowAngle, setShadowAngle] = useState(135)
  const [shadowDistance, setShadowDistance] = useState(4)
  const [maxCharsPerLine, setMaxCharsPerLine] = useState(DEFAULT_GROUPING_OPTIONS.maxCharsPerLine)
  const [maxLines, setMaxLines] = useState(DEFAULT_GROUPING_OPTIONS.maxLines)
  const [pauseGapSec, setPauseGapSec] = useState(DEFAULT_GROUPING_OPTIONS.pauseGapSec)
  // Remove-silence tunables + last-run status.
  const [minSilenceSec, setMinSilenceSec] = useState(0.5)
  const [removeFiller, setRemoveFiller] = useState(true)
  const [silenceStatus, setSilenceStatus] = useState<string | null>(null)

  // All clips that carry audio: dedicated audio tracks AND video tracks
  // (video clips contain an audio stream that ffmpeg extracts for STT).
  const audioClips = useMemo<Clip[]>(() => {
    if (project === null) return []
    return project.tracks
      .filter((t) => t.type === 'audio' || t.type === 'video')
      .flatMap((t) => t.clips)
  }, [project])

  // Target the selected audio/video clip if one is selected, else the first one.
  const targetClip = useMemo<Clip | null>(() => {
    if (audioClips.length === 0) return null
    return audioClips.find((c) => selection.includes(c.id)) ?? audioClips[0]
  }, [audioClips, selection])

  // The Caption track's clips (source of truth for the active anchor + has-track).
  const captionClips = useMemo<Clip[]>(
    () => project?.tracks.find((t) => t.id === CAPTION_TRACK_ID)?.clips ?? [],
    [project]
  )
  const hasCaptionTrack = captionClips.length > 0

  useEffect(() => {
    const clip = captionClips[0]
    if (clip?.text === undefined) return
    const text = clip.text
    const fill = text.fill as { type?: string; value?: unknown; opacity?: number; angle?: number } | undefined
    if (fill !== undefined) {
      if (fill.type === 'gradient' && Array.isArray(fill.value)) {
        setFillGradient(true)
        const stops = fill.value as { offset: number; color: string }[]
        if (stops[0] !== undefined) setFillStop1(stops[0].color)
        if (stops[1] !== undefined) setFillStop2(stops[1].color)
        if (fill.angle !== undefined) setFillAngle(fill.angle)
      } else if (typeof fill.value === 'string') {
        setFillGradient(false)
        setFillColor(fill.value)
      }
      if (fill.opacity !== undefined) setFillOpacity(Math.round(fill.opacity * 100))
    }
    const stroke = text.stroke as { color: string; width: number }[] | undefined
    if (stroke !== undefined && stroke.length > 0) {
      setStrokeOn(true)
      setStrokeColor(stroke[0].color)
      setStrokeWidth(stroke[0].width)
    } else {
      setStrokeOn(false)
    }
    const effects = text.effects as { type: string; params?: { radius?: number; color?: string } }[] | undefined
    const glow = effects?.find((e) => e.type === 'glow')
    if (glow !== undefined) {
      setGlowOn(true)
      if (glow.params?.color !== undefined) setGlowColor(glow.params.color)
      if (glow.params?.radius !== undefined) setGlowRadius(glow.params.radius)
    } else {
      setGlowOn(false)
    }
    const shadow = text.shadow as { color?: string; opacity?: number; blur?: number; angle?: number; distance?: number } | undefined
    if (shadow !== undefined) {
      setShadowOn(true)
      if (shadow.color !== undefined) setShadowColor(shadow.color)
      if (shadow.opacity !== undefined) setShadowOpacity(Math.round(shadow.opacity * 100))
      if (shadow.blur !== undefined) setShadowBlur(shadow.blur)
      if (shadow.angle !== undefined) setShadowAngle(shadow.angle)
      if (shadow.distance !== undefined) setShadowDistance(shadow.distance)
    } else {
      setShadowOn(false)
    }
  }, [captionClips])
  // The anchor the track currently wears (from the first caption clip), defaulting
  // to lower-third (the generation default) when none is recorded yet.
  const currentAnchor: LayoutAnchor =
    captionClips[0]?.transform.captionAnchor ?? 'lower-third'
  // The applied caption-style preset (the dropdown that replaced the big gallery).
  const captionPresets = useMemo(() => listCaptionPresets(), [])
  const activePresetId = project?.captions?.styleId ?? DEFAULT_APPLIED_CAPTION_PRESET_ID
  // Font options grouped: Tamil-devotional faces first (best fit for the gold
  // style), then the rest of the library. Built from the font registry so newly
  // bundled families appear automatically.
  const fontOptions = useMemo(() => {
    const all = fontRegistry.listFonts().map((f) => f.family)
    const tamilFirst = fontRegistry
      .listFonts()
      .filter((f) => f.scripts.includes('tamil'))
      .map((f) => f.family)
    const rest = all.filter((f) => !tamilFirst.includes(f))
    return { tamil: tamilFirst, rest }
  }, [])

  // The aspect's safe band (canvas px) bounds the custom position sliders.
  const aspect = (project?.settings.aspect ?? '9:16') as Aspect
  const customYRange = useMemo<{ min: number; max: number }>(() => {
    const resolution = resolutionForAspect(aspect)
    const [, h] = resolution
    const safe = safeAreaPx(safeMarginsForAspect(aspect), resolution)
    // Center-relative offsets matching the band's vertical extent.
    return { min: Math.round(safe.top - h / 2), max: Math.round(safe.bottom - h / 2) }
  }, [aspect])
  // Horizontal bounds (center-relative px) so the block can slide left/right and
  // even move off-center — bounded by the aspect's title-safe horizontal band.
  const customXRange = useMemo<{ min: number; max: number }>(() => {
    const resolution = resolutionForAspect(aspect)
    const [w] = resolution
    const safe = safeAreaPx(safeMarginsForAspect(aspect), resolution)
    return { min: Math.round(safe.left - w / 2), max: Math.round(safe.right - w / 2) }
  }, [aspect])
  const [customY, setCustomY] = useState<number>(0)
  const [customX, setCustomX] = useState<number>(0)

  const onTapSyncTap = (): void => {
    if (!tapSyncActive || tapSyncLineIndex >= tapSyncLineCount) return
    addLyricsAnchor('line', tapSyncLineIndex, playhead)
    if (tapSyncLineIndex + 1 >= tapSyncLineCount) {
      setTapSyncActive(false)
      setTapSyncLineIndex(0)
    } else {
      setTapSyncLineIndex((i) => i + 1)
    }
  }

  const onAnchor = (anchor: LayoutAnchor): void => {
    if (anchor === 'custom') {
      setCaptionPosition('custom', customY, customX)
    } else {
      setCaptionPosition(anchor)
    }
  }

  const running = isRunning(stage)
  const enabled = canGenerate({
    hasProject: project !== null,
    hasAudioClip: targetClip !== null,
    stage,
    mode,
    hasLyrics: lyricsInput.trim().length > 0
  })

  // After (re)generating the Caption track, stamp a caption STYLE onto it so the
  // gold treatment + active-word highlight are on by DEFAULT — no manual gallery
  // pick required. Re-applies the project's chosen `captions.styleId` if the user
  // already picked one (so a regenerate keeps their style); otherwise applies the
  // Sarvam Bhakti Gold signature default. Reads the project fresh (the generate
  // command just ran); no-ops safely when there is no Caption track.
  const ensureCaptionStyle = (): void => {
    const styleId = useProjectStore.getState().currentProject?.captions?.styleId
    applyCaptionPreset(styleId ?? DEFAULT_APPLIED_CAPTION_PRESET_ID)
  }

  // Re-apply the panel's caption refinements (font family + size, and word wrap)
  // AFTER the style preset is stamped, so a (re)generate/resync keeps the user's
  // chosen font/size instead of reverting to the preset's, and honors the wrap
  // toggle. Panel-owned state is the source of truth for these.
  const applyCaptionRefinements = (): void => {
    setCaptionFontFamilyAction(captionFont)
    setCaptionFontSizeAction(captionFontSize)
    if (wordWrap && maxWordsPerLine > 0) wrapCaptionTextAction(maxWordsPerLine)
    if (fillGradient) {
      setCaptionFillAction({
        type: 'gradient',
        value: [{ offset: 0, color: fillStop1 }, { offset: 1, color: fillStop2 }],
        opacity: fillOpacity / 100,
        angle: fillAngle
      })
    } else {
      setCaptionFillAction({ type: 'solid', value: fillColor, opacity: fillOpacity / 100 })
    }
    setCaptionStrokeAction(strokeOn ? [{ color: strokeColor, width: strokeWidth }] : [])
    setCaptionGlowAction(glowOn ? { color: glowColor, radius: glowRadius } : null)
    setCaptionShadowAction(
      shadowOn
        ? { color: shadowColor, opacity: shadowOpacity / 100, blur: shadowBlur, angle: shadowAngle, distance: shadowDistance, inner: false, long: false }
        : null
    )
  }

  const onGenerate = async (): Promise<void> => {
    if (targetClip === null) return
    setError(null)

    // 1) Normalize the source audio → 16 kHz mono WAV.
    setStage('normalizing')
    const normalized = await normalizeAudio(targetClip.mediaRef)
    if (!normalized.ok) {
      setStage('error')
      setError(normalized.error)
      return
    }

    if (mode === 'lyricsFirst') {
      // 2a) Lyrics-first: align known lyrics text to timing, then emit one clip
      // per user line (text is user-owned, timing is computed). This path does
      // NOT gate on a standalone transcription — the align step derives its own
      // timing and gracefully spreads captions across the song when STT is
      // unavailable, so lyrics-first still works without whisper.cpp installed.
      setStage('aligning')
      const aligned = await alignLyrics(
        normalized.wavRef,
        lyricsInput,
        selectionToLanguage(language)
      )
      if (!aligned.ok) {
        setStage('error')
        setError(aligned.error)
        return
      }

      setStage('grouping')
      const lines = alignedLyricsToCaptionLines(aligned.alignment.lines)
      const ids = generateCaptionsFromLines(lines, aligned.alignment.language)
      if (ids === null) {
        setStage('error')
        setError('No project is open.')
        return
      }

      // Default caption STYLE, then the panel's font/size/wrap refinements.
      ensureCaptionStyle()
      applyCaptionRefinements()
      setStage('done')
      return
    }

    // 2b) Auto mode: transcribe the WAV (pin the language, or undefined for
    // auto-detect), then group the transcript into caption lines.
    setStage('transcribing')
    const transcribed = await transcribe(normalized.wavRef, selectionToLanguage(language))
    if (!transcribed.ok) {
      setStage('error')
      setError(transcribed.error)
      return
    }

    setStage('grouping')
    const opts: GroupingOptions = {
      maxCharsPerLine,
      maxLines,
      pauseGapSec
    }
    const ids = generateCaptions(transcribed.transcript, opts)
    if (ids === null) {
      setStage('error')
      setError('No project is open.')
      return
    }

    // Default caption STYLE, then the panel's font/size/wrap refinements.
    ensureCaptionStyle()
    applyCaptionRefinements()
    setStage('done')
  }

  // Re-sync: REGROUP the Caption track from its stored per-word transcript using
  // the current grouping params, REPLACING the clips. Discards manual text edits
  // by design (regroup from source); never re-transcribes. No-op without a
  // transcript (the button is disabled in that case).
  const onResync = (): void => {
    setError(null)
    const opts: GroupingOptions = {
      maxCharsPerLine,
      maxLines,
      pauseGapSec
    }
    resyncCaptions(opts)
    // Re-sync replaces the clips (dropping their stamped style), so re-apply the
    // current/default caption style + the panel's font/size/wrap refinements.
    ensureCaptionStyle()
    applyCaptionRefinements()
  }

  // Remove silence/filler: detect from the stored transcript and ripple the
  // ranges out of the whole timeline as ONE undoable step (captions stay aligned).
  const onRemoveSilence = (): void => {
    setError(null)
    setSilenceStatus(null)
    const result = removeSilence({ minSilenceSec, removeFiller })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSilenceStatus(
      result.removedSec === 0
        ? 'No silence or filler found.'
        : `Removed ${result.cuts} range${result.cuts === 1 ? '' : 's'} (${result.removedSec.toFixed(2)}s). Undo to restore.`
    )
  }

  return (
    <section className="flex h-full flex-col gap-3 p-4">
      <h2 className="text-sm font-semibold text-text-primary">Auto-Caption</h2>
      <p className="text-xs text-text-muted">
        Generate a synced caption track from a video or audio clip. Use Auto for full STT, or
        Lyrics-first when you already know the lyrics and only need precise timing.
      </p>

      <div role="radiogroup" aria-label="Caption generation mode" className="grid grid-cols-2 gap-1">
        {([
          ['auto', 'Auto'],
          ['lyricsFirst', 'Lyrics-first']
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            disabled={running}
            onClick={() => setMode(value)}
            className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${mode === value
              ? 'border-accent bg-surface-2 text-text-primary ring-1 ring-accent'
              : 'border-line text-text-muted hover:border-accent-hover'
              }`}
          >
            {label}
          </button>
        ))}
      </div>

      {project === null && (
        <p className="text-xs text-text-muted">Open a project to generate captions.</p>
      )}
      {project !== null && targetClip === null && (
        <p className="text-xs text-text-muted">Import a video or audio clip first.</p>
      )}

      {/* Language pin (or auto-detect within the six supported languages). */}
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        <span>Language</span>
        <select
          value={language}
          disabled={running}
          onChange={(e) => setLanguage(e.target.value as 'auto' | LanguageCode)}
          className="rounded-md border border-line bg-surface-1 px-2 py-1 text-text-primary disabled:opacity-50"
        >
          {LANGUAGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      {mode === 'lyricsFirst' && (
        <>
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            <span>Lyrics</span>
            <textarea
              value={lyricsInput}
              disabled={running}
              onChange={(e) => { setLyricsInput(e.target.value); setTapSyncLineIndex(0) }}
              placeholder="Paste lyrics (one line per caption line)…"
              className="min-h-28 resize-y rounded-md border border-line bg-surface-1 px-2 py-2 text-text-primary disabled:opacity-50"
            />
            <span>Tags: [lang: ta], [section: chorus], [gap: instrumental].</span>
          </label>
          <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
            <span>Vocal isolation</span>
            <input
              type="checkbox"
              checked={vocalStem}
              disabled={running}
              onChange={(e) => setVocalStem(e.target.checked)}
              className="h-4 w-4"
            />
          </label>
        </>
      )}

      {/* Grouping params are auto-mode only (lyrics-first preserves user lines). */}
      {mode === 'auto' && <Section title="Grouping">
        <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
          <span>Max chars / line</span>
          <input
            type="number"
            min={1}
            value={maxCharsPerLine}
            disabled={running}
            onChange={(e) => setMaxCharsPerLine(Number(e.target.value))}
            className="w-20 rounded-md border border-line bg-surface-1 px-2 py-1 text-text-primary disabled:opacity-50"
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
          <span>Max lines</span>
          <input
            type="number"
            min={1}
            value={maxLines}
            disabled={running}
            onChange={(e) => setMaxLines(Number(e.target.value))}
            className="w-20 rounded-md border border-line bg-surface-1 px-2 py-1 text-text-primary disabled:opacity-50"
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
          <span>Pause gap (s)</span>
          <input
            type="number"
            min={0}
            step={0.1}
            value={pauseGapSec}
            disabled={running}
            onChange={(e) => setPauseGapSec(Number(e.target.value))}
            className="w-20 rounded-md border border-line bg-surface-1 px-2 py-1 text-text-primary disabled:opacity-50"
          />
        </label>
      </Section>}

      {/* Caption style controls — font, size, word wrap (both modes). */}
      <Section title="Caption style">
        <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
          <span>Font</span>
          <select
            value={captionFont}
            disabled={running}
            onChange={(e) => {
              setCaptionFont(e.target.value)
              if (hasCaptionTrack) setCaptionFontFamilyAction(e.target.value)
            }}
            className="w-44 rounded-md border border-line bg-surface-1 px-2 py-1 text-text-primary disabled:opacity-50"
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
        <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
          <span>Font size (px)</span>
          <input
            type="number"
            min={8}
            max={400}
            value={captionFontSize}
            disabled={running}
            onChange={(e) => {
              const v = Math.max(8, Math.min(400, Number(e.target.value)))
              setCaptionFontSize(v)
              if (hasCaptionTrack) setCaptionFontSizeAction(v)
            }}
            className="w-20 rounded-md border border-line bg-surface-1 px-2 py-1 text-text-primary disabled:opacity-50"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          <span>Font size slider</span>
          <input
            type="range"
            min={24}
            max={400}
            step={2}
            value={captionFontSize}
            disabled={running}
            onChange={(e) => {
              const v = Number(e.target.value)
              setCaptionFontSize(v)
              if (hasCaptionTrack) setCaptionFontSizeAction(v)
            }}
            className="w-full disabled:opacity-50"
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
          <span>Word wrap</span>
          <input
            type="checkbox"
            checked={wordWrap}
            disabled={running}
            onChange={(e) => {
              const on = e.target.checked
              setWordWrap(on)
              // ON → wrap to N words/line; OFF → collapse back to one line (a huge
              // words/line rejoins every word onto a single line). No-op w/o a track.
              if (hasCaptionTrack) {
                wrapCaptionTextAction(on && maxWordsPerLine > 0 ? maxWordsPerLine : 1_000_000)
              }
            }}
            className="h-4 w-4"
          />
        </label>
        {wordWrap && (
          <>
            <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
              <span>Words / line</span>
              <input
                type="number"
                min={1}
                value={maxWordsPerLine}
                disabled={running}
                onChange={(e) => {
                  const v = Math.max(1, Number(e.target.value))
                  setMaxWordsPerLine(v)
                  if (hasCaptionTrack) wrapCaptionTextAction(v)
                }}
                className="w-20 rounded-md border border-line bg-surface-1 px-2 py-1 text-text-primary disabled:opacity-50"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
              <span>Line spacing</span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1.0}
                  max={3.0}
                  step={0.1}
                  value={lineSpacing}
                  disabled={running}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setLineSpacing(v)
                    if (hasCaptionTrack) setCaptionLineHeightAction(v)
                  }}
                  className="w-24 disabled:opacity-50"
                />
                <span className="w-8 text-right tabular-nums">{lineSpacing.toFixed(1)}</span>
              </div>
            </label>
          </>
        )}
        <p className="text-xs text-text-muted">
          Word wrap breaks each caption into lines of N words (no new clips); off keeps one line.
        </p>

        <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
          <span>Word spacing</span>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={-10}
              max={40}
              step={1}
              value={letterSpacing}
              disabled={running}
              onChange={(e) => {
                const v = Number(e.target.value)
                setLetterSpacing(v)
                if (hasCaptionTrack) setCaptionLetterSpacingAction(v)
              }}
              className="w-24 disabled:opacity-50"
            />
            <span className="w-8 text-right tabular-nums">{letterSpacing}px</span>
          </div>
        </label>

        <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
          <span>Fill color</span>
          <input
            type="color"
            value={fillGradient ? fillStop1 : fillColor}
            disabled={running || fillGradient}
            onChange={(e) => {
              setFillColor(e.target.value)
              if (hasCaptionTrack)
                setCaptionFillAction({ type: 'solid', value: e.target.value, opacity: fillOpacity / 100 })
            }}
            className="h-7 w-12 cursor-pointer rounded border border-line bg-surface-1 disabled:opacity-50"
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
          <span>Fill opacity ({fillOpacity}%)</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={fillOpacity}
            disabled={running}
            onChange={(e) => {
              const v = Number(e.target.value)
              setFillOpacity(v)
              if (hasCaptionTrack) {
                if (fillGradient) {
                  setCaptionFillAction({ type: 'gradient', value: [{ offset: 0, color: fillStop1 }, { offset: 1, color: fillStop2 }], opacity: v / 100, angle: fillAngle })
                } else {
                  setCaptionFillAction({ type: 'solid', value: fillColor, opacity: v / 100 })
                }
              }
            }}
            className="w-28 disabled:opacity-50"
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
          <span>Gradient</span>
          <input
            type="checkbox"
            checked={fillGradient}
            disabled={running}
            onChange={(e) => {
              const on = e.target.checked
              setFillGradient(on)
              if (hasCaptionTrack) {
                if (on) {
                  setCaptionFillAction({ type: 'gradient', value: [{ offset: 0, color: fillStop1 }, { offset: 1, color: fillStop2 }], opacity: fillOpacity / 100, angle: fillAngle })
                } else {
                  setCaptionFillAction({ type: 'solid', value: fillColor, opacity: fillOpacity / 100 })
                }
              }
            }}
            className="h-4 w-4"
          />
        </label>
        {fillGradient && (
          <>
            <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
              <span>Stop 1</span>
              <input
                type="color"
                value={fillStop1}
                disabled={running}
                onChange={(e) => {
                  setFillStop1(e.target.value)
                  if (hasCaptionTrack)
                    setCaptionFillAction({ type: 'gradient', value: [{ offset: 0, color: e.target.value }, { offset: 1, color: fillStop2 }], opacity: fillOpacity / 100, angle: fillAngle })
                }}
                className="h-7 w-12 cursor-pointer rounded border border-line bg-surface-1 disabled:opacity-50"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
              <span>Stop 2</span>
              <input
                type="color"
                value={fillStop2}
                disabled={running}
                onChange={(e) => {
                  setFillStop2(e.target.value)
                  if (hasCaptionTrack)
                    setCaptionFillAction({ type: 'gradient', value: [{ offset: 0, color: fillStop1 }, { offset: 1, color: e.target.value }], opacity: fillOpacity / 100, angle: fillAngle })
                }}
                className="h-7 w-12 cursor-pointer rounded border border-line bg-surface-1 disabled:opacity-50"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
              <span>Angle ({fillAngle}°)</span>
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                value={fillAngle}
                disabled={running}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setFillAngle(v)
                  if (hasCaptionTrack)
                    setCaptionFillAction({ type: 'gradient', value: [{ offset: 0, color: fillStop1 }, { offset: 1, color: fillStop2 }], opacity: fillOpacity / 100, angle: v })
                }}
                className="w-28 disabled:opacity-50"
              />
            </label>
          </>
        )}

        <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
          <span>Outline</span>
          <input
            type="checkbox"
            checked={strokeOn}
            disabled={running}
            onChange={(e) => {
              const on = e.target.checked
              setStrokeOn(on)
              if (hasCaptionTrack)
                setCaptionStrokeAction(on ? [{ color: strokeColor, width: strokeWidth }] : [])
            }}
            className="h-4 w-4"
          />
        </label>
        {strokeOn && (
          <>
            <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
              <span>Outline color</span>
              <input
                type="color"
                value={strokeColor}
                disabled={running}
                onChange={(e) => {
                  setStrokeColor(e.target.value)
                  if (hasCaptionTrack)
                    setCaptionStrokeAction([{ color: e.target.value, width: strokeWidth }])
                }}
                className="h-7 w-12 cursor-pointer rounded border border-line bg-surface-1 disabled:opacity-50"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
              <span>Outline width</span>
              <input
                type="number"
                min={1}
                max={20}
                value={strokeWidth}
                disabled={running}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(20, Number(e.target.value)))
                  setStrokeWidth(v)
                  if (hasCaptionTrack)
                    setCaptionStrokeAction([{ color: strokeColor, width: v }])
                }}
                className="w-20 rounded-md border border-line bg-surface-1 px-2 py-1 text-text-primary disabled:opacity-50"
              />
            </label>
          </>
        )}

        <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
          <span>Glow</span>
          <input
            type="checkbox"
            checked={glowOn}
            disabled={running}
            onChange={(e) => {
              const on = e.target.checked
              setGlowOn(on)
              if (hasCaptionTrack)
                setCaptionGlowAction(on ? { color: glowColor, radius: glowRadius } : null)
            }}
            className="h-4 w-4"
          />
        </label>
        {glowOn && (
          <>
            <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
              <span>Glow color</span>
              <input
                type="color"
                value={glowColor}
                disabled={running}
                onChange={(e) => {
                  setGlowColor(e.target.value)
                  if (hasCaptionTrack)
                    setCaptionGlowAction({ color: e.target.value, radius: glowRadius })
                }}
                className="h-7 w-12 cursor-pointer rounded border border-line bg-surface-1 disabled:opacity-50"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
              <span>Glow radius ({glowRadius}px)</span>
              <input
                type="range"
                min={0}
                max={40}
                step={1}
                value={glowRadius}
                disabled={running}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setGlowRadius(v)
                  if (hasCaptionTrack)
                    setCaptionGlowAction({ color: glowColor, radius: v })
                }}
                className="w-28 disabled:opacity-50"
              />
            </label>
          </>
        )}

        <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
          <span>Shadow</span>
          <input
            type="checkbox"
            checked={shadowOn}
            disabled={running}
            onChange={(e) => {
              const on = e.target.checked
              setShadowOn(on)
              if (hasCaptionTrack)
                setCaptionShadowAction(on ? { color: shadowColor, opacity: shadowOpacity / 100, blur: shadowBlur, angle: shadowAngle, distance: shadowDistance, inner: false, long: false } : null)
            }}
            className="h-4 w-4"
          />
        </label>
        {shadowOn && (
          <>
            <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
              <span>Shadow color</span>
              <input
                type="color"
                value={shadowColor}
                disabled={running}
                onChange={(e) => {
                  setShadowColor(e.target.value)
                  if (hasCaptionTrack)
                    setCaptionShadowAction({ color: e.target.value, opacity: shadowOpacity / 100, blur: shadowBlur, angle: shadowAngle, distance: shadowDistance, inner: false, long: false })
                }}
                className="h-7 w-12 cursor-pointer rounded border border-line bg-surface-1 disabled:opacity-50"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
              <span>Shadow opacity ({shadowOpacity}%)</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={shadowOpacity}
                disabled={running}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setShadowOpacity(v)
                  if (hasCaptionTrack)
                    setCaptionShadowAction({ color: shadowColor, opacity: v / 100, blur: shadowBlur, angle: shadowAngle, distance: shadowDistance, inner: false, long: false })
                }}
                className="w-28 disabled:opacity-50"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
              <span>Shadow blur ({shadowBlur}px)</span>
              <input
                type="range"
                min={0}
                max={40}
                step={1}
                value={shadowBlur}
                disabled={running}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setShadowBlur(v)
                  if (hasCaptionTrack)
                    setCaptionShadowAction({ color: shadowColor, opacity: shadowOpacity / 100, blur: v, angle: shadowAngle, distance: shadowDistance, inner: false, long: false })
                }}
                className="w-28 disabled:opacity-50"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
              <span>Shadow angle ({shadowAngle}°)</span>
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                value={shadowAngle}
                disabled={running}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setShadowAngle(v)
                  if (hasCaptionTrack)
                    setCaptionShadowAction({ color: shadowColor, opacity: shadowOpacity / 100, blur: shadowBlur, angle: v, distance: shadowDistance, inner: false, long: false })
                }}
                className="w-28 disabled:opacity-50"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
              <span>Shadow distance ({shadowDistance}px)</span>
              <input
                type="range"
                min={0}
                max={40}
                step={1}
                value={shadowDistance}
                disabled={running}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setShadowDistance(v)
                  if (hasCaptionTrack)
                    setCaptionShadowAction({ color: shadowColor, opacity: shadowOpacity / 100, blur: shadowBlur, angle: shadowAngle, distance: v, inner: false, long: false })
                }}
                className="w-28 disabled:opacity-50"
              />
            </label>
          </>
        )}
      </Section>

      <button
        type="button"
        onClick={() => void onGenerate()}
        disabled={!enabled}
        className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-text-primary disabled:opacity-50"
      >
        {running ? 'Working…' : mode === 'lyricsFirst' ? 'Align lyrics' : 'Generate captions'}
      </button>

      {/* Re-sync: regroup the Caption track from its stored transcript with the
          current grouping params (AUTO mode only). In lyrics-first the caption
          lines ARE the user's lyric lines — regrouping would merge/split them into
          auto-STT chunks, so re-run "Align lyrics" instead to re-time them. */}
      {mode === 'auto' && (
        <>
          <button
            type="button"
            onClick={onResync}
            disabled={running || !hasTranscript}
            title={
              hasTranscript
                ? 'Regroup caption lines from the transcript (discards manual text edits)'
                : 'Generate captions first to enable Re-sync'
            }
            className="rounded-md border border-line px-3 py-2 text-sm font-medium text-text-primary disabled:opacity-50"
          >
            Re-sync
          </button>
          <p className="text-xs text-text-muted">
            Re-sync regroups lines from the transcript and discards manual text edits.
          </p>
        </>
      )}

      {/* Tap-Sync: record hard line anchors live during playback. Only shown in
          lyrics-first mode once lyrics are entered. */}
      {mode === 'lyricsFirst' && tapSyncLineCount > 0 && (
        <Section title="Tap-sync">
          <p className="text-xs text-text-muted">
            Play the track, then tap <strong>Tap line</strong> at the start of each line
            to pin its timing. Anchors override alignment drift.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { setTapSyncActive((a) => !a); setTapSyncLineIndex(0) }}
              disabled={running}
              className={`flex-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${tapSyncActive ? 'border-accent bg-surface-2 text-text-primary ring-1 ring-accent' : 'border-line text-text-muted hover:border-accent-hover'}`}
            >
              {tapSyncActive ? 'Recording…' : 'Start tap-sync'}
            </button>
            <button
              type="button"
              onClick={clearLyricsAnchors}
              disabled={running}
              title="Clear all tap-sync anchors"
              className="rounded-md border border-line px-2 py-1 text-xs text-text-muted hover:border-accent-hover disabled:opacity-50"
            >
              Clear
            </button>
          </div>
          {tapSyncActive && (
            <button
              type="button"
              onClick={onTapSyncTap}
              className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-text-primary"
            >
              Tap line {tapSyncLineIndex + 1} / {tapSyncLineCount}
            </button>
          )}
        </Section>
      )}

      {/* Low-confidence review: jump to the next caption clip that needs review. */}
      {hasCaptionTrack && (
        <Section title="Alignment review" defaultOpen={false}>
          <button
            type="button"
            onClick={() => seekNextLowConfidence()}
            disabled={running}
            title="Seek to the next caption clip with low alignment confidence"
            className="rounded-md border border-line px-3 py-2 text-sm font-medium text-text-primary disabled:opacity-50 hover:border-accent-hover"
          >
            Review next low-confidence clip
          </button>
          <p className="text-xs text-text-muted">
            Clips with &gt;20% low-confidence words (red heatmap) are flagged for review.
          </p>
        </Section>
      )}

      {/* Caption style gallery (P5.3): one live thumbnail per preset, rendered
          through the SHARED caption text-render path so each looks like what
          applying it produces. Selecting a card APPLIES the preset to the whole
          Caption track (P5.4): one undoable step that sets `captions.styleId` +
          stamps text/animation/transform onto every caption clip. The gallery's
          active highlight is driven by `captions.styleId`, so it updates as soon
          as the apply lands. No-op if no Caption track exists yet. */}
      <Section title="Caption preset">
        <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
          <span>Style</span>
          <select
            aria-label="Caption style preset"
            value={activePresetId}
            disabled={running || !hasCaptionTrack}
            onChange={(e) => applyCaptionPreset(e.target.value)}
            className="w-44 rounded-md border border-line bg-surface-1 px-2 py-1 text-text-primary disabled:opacity-50"
          >
            {captionPresets.map((p) => (
              <option key={p.id} value={p.id}>{p.displayName}</option>
            ))}
          </select>
        </label>
        <p className="text-xs text-text-muted">
          Applies the style to the whole caption track. Generate captions first to enable.
        </p>
      </Section>

      {/* Caption position (P5.8): choose the block's vertical anchor
          (lower-third / center / custom). Resolving the anchor → pixel y is
          aspect-aware and clamps inside the title-safe margins for the current
          aspect. `custom` exposes a slider bounded by the safe band. Each choice
          is ONE undoable step that stamps transform.y + captionAnchor onto every
          caption clip. Disabled until a Caption track exists. */}
      <Section title="Caption position">
        <div role="radiogroup" aria-label="Caption position anchor" className="flex gap-1">
          {(['lower-third', 'center', 'custom'] as const).map((anchor) => (
            <button
              key={anchor}
              type="button"
              role="radio"
              aria-checked={currentAnchor === anchor}
              disabled={!hasCaptionTrack}
              onClick={() => onAnchor(anchor)}
              title={
                hasCaptionTrack
                  ? `Position captions: ${anchor}`
                  : 'Generate captions first to position them'
              }
              className={`flex-1 rounded-md border px-2 py-1 text-xs font-medium capitalize transition-colors disabled:opacity-50 ${currentAnchor === anchor
                ? 'border-accent bg-surface-2 text-text-primary ring-1 ring-accent'
                : 'border-line text-text-muted hover:border-accent-hover'
                }`}
            >
              {anchor === 'lower-third' ? 'Lower third' : anchor}
            </button>
          ))}
        </div>
        {currentAnchor === 'custom' && (
          <>
            <label className="flex flex-col gap-1 text-xs text-text-muted">
              <span>Vertical position (px from center)</span>
              <input
                type="range"
                min={customYRange.min}
                max={customYRange.max}
                step={1}
                value={customY}
                disabled={!hasCaptionTrack}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setCustomY(v)
                  setCaptionPosition('custom', v, customX)
                }}
                className="w-full disabled:opacity-50"
              />
              <span className="self-end tabular-nums">{customY}px</span>
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-muted">
              <span>Horizontal position (px from center)</span>
              <input
                type="range"
                min={customXRange.min}
                max={customXRange.max}
                step={1}
                value={customX}
                disabled={!hasCaptionTrack}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setCustomX(v)
                  setCaptionPosition('custom', customY, v)
                }}
                className="w-full disabled:opacity-50"
              />
              <span className="self-end tabular-nums">{customX}px</span>
            </label>
          </>
        )}
        <p className="text-xs text-text-muted">
          Pick <strong>Custom</strong> to move the caption freely — vertical and
          horizontal — within the title-safe margins for the {aspect} aspect.
        </p>
      </Section>

      {/* Remove silence/filler: detect from the transcript and ripple it out of
          the timeline as ONE undoable step. Disabled until a transcript exists. */}
      <Section title="Remove silence" defaultOpen={false}>
        <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
          <span>Min silence (s)</span>
          <input
            type="number"
            min={0}
            step={0.1}
            value={minSilenceSec}
            disabled={running}
            onChange={(e) => setMinSilenceSec(Number(e.target.value))}
            className="w-20 rounded-md border border-line bg-surface-1 px-2 py-1 text-text-primary disabled:opacity-50"
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-xs text-text-muted">
          <span>Remove filler (um/uh/…)</span>
          <input
            type="checkbox"
            checked={removeFiller}
            disabled={running}
            onChange={(e) => setRemoveFiller(e.target.checked)}
            className="h-4 w-4"
          />
        </label>
        <button
          type="button"
          onClick={onRemoveSilence}
          disabled={running || !hasTranscript}
          title={
            hasTranscript
              ? 'Trim silence/filler and ripple clips + captions (undoable)'
              : 'Generate captions first to enable Remove silence'
          }
          className="rounded-md border border-line px-3 py-2 text-sm font-medium text-text-primary disabled:opacity-50"
        >
          Remove silence
        </button>
        {silenceStatus !== null && <p className="text-xs text-text-muted">{silenceStatus}</p>}
      </Section>

      {/* Progress bar + status line reflecting the stage machine. */}
      <div className="flex flex-col gap-1">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={stageProgress(stage)}
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
        >
          <div
            className={`h-full transition-[width] ${stage === 'error' ? 'bg-red-500' : 'bg-accent'}`}
            style={{ width: `${stageProgress(stage) * 100}%` }}
          />
        </div>
        <p className="text-xs text-text-muted">{stageLabel(stage)}</p>
      </div>

      {error !== null && <p className="text-xs text-red-400">{error}</p>}
    </section>
  )
}

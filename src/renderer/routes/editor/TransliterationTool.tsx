/**
 * Transliteration Tool component (P10R.2, Doc 16).
 *
 * A self-contained React section (NOT a full panel) intended to be embedded
 * inside the AI Tools panel. Provides:
 *  - Source language dropdown (auto-detect | ta | te | ml | kn | hi | en)
 *  - Target language dropdown (ta | te | ml | kn | hi | en)
 *  - Scheme dropdown (ISO-15919 | ITRANS) — cosmetic; both use the same engine
 *  - Mode toggle (Inline | Replace)
 *  - Target radio (Caption track | Text layer)
 *  - Live preview of a transliterated sample (debounced)
 *  - Apply button: calls transliteration:transliterate over IPC and dispatches
 *    applyTransliteration to the timeline store to persist captions.transliteration
 */

import { useEffect, useMemo, useState } from 'react'
import type { SupportedLang } from '../../../shared/transliteration'
import { SUPPORTED_LANGS } from '../../../shared/transliteration'
import { useProjectStore } from '@/store/projectStore'
import { useTimelineStore } from '@/store/timelineStore'

/** Sample text for each source language — used in the live preview box. */
const SAMPLE_TEXT: Record<SupportedLang, string> = {
  ta: 'வணக்கம்',
  te: 'నమస్కారం',
  ml: 'നമസ്കാരം',
  kn: 'ನಮಸ್ಕಾರ',
  hi: 'नमस्ते',
  en: 'vanakkam'
}

/** Human-readable labels for each language code. */
const LANG_LABELS: Record<SupportedLang, string> = {
  ta: 'Tamil',
  te: 'Telugu',
  ml: 'Malayalam',
  kn: 'Kannada',
  hi: 'Hindi',
  en: 'English (Latin)'
}

type TransliterationMode = 'inline' | 'replace'
type TransliterationTarget = 'caption' | 'text'
type TransliterationScheme = 'ISO-15919' | 'ITRANS'

export interface TransliterationToolProps {
  /** Optional text layer ids; if absent, only caption-track mode is available. */
  textLayerIds?: string[]
}

export function TransliterationTool(props: TransliterationToolProps): JSX.Element {
  const { textLayerIds } = props

  const project = useProjectStore((s) => s.currentProject)
  const applyTransliteration = useTimelineStore((s) => s.applyTransliteration)

  // ─── Form state ────────────────────────────────────────────────────────────
  const [sourceLang, setSourceLang] = useState<SupportedLang | 'auto'>('auto')
  const [targetLang, setTargetLang] = useState<SupportedLang>('ta')
  const [scheme, setScheme] = useState<TransliterationScheme>('ISO-15919')
  const [mode, setMode] = useState<TransliterationMode>('inline')
  const [target, setTarget] = useState<TransliterationTarget>('caption')

  // ─── Preview state ─────────────────────────────────────────────────────────
  const [previewText, setPreviewText] = useState<string>('')
  const [previewBusy, setPreviewBusy] = useState(false)

  // ─── Apply state ───────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  /** Resolved source language (auto-detect falls back to 'ta'). */
  const resolvedSource: SupportedLang = useMemo(() => {
    if (sourceLang === 'auto') {
      // Auto-detect: use the project's default language, else 'ta'.
      const lang = project?.settings?.language
      if (lang !== undefined && (SUPPORTED_LANGS as ReadonlyArray<string>).includes(lang)) {
        return lang as SupportedLang
      }
      return 'ta'
    }
    return sourceLang
  }, [sourceLang, project])

  // ─── Live preview (debounced 400 ms) ───────────────────────────────────────
  useEffect(() => {
    if (resolvedSource === targetLang) {
      setPreviewText(SAMPLE_TEXT[resolvedSource])
      return
    }

    setPreviewBusy(true)
    const timerId = window.setTimeout(() => {
      const sampleInput = SAMPLE_TEXT[resolvedSource]
      void window.api
        .invoke('transliteration:transliterate', {
          text: sampleInput,
          sourceLang: resolvedSource,
          targetLang
        })
        .then((result) => {
          if (result.ok) setPreviewText(result.data.result)
          else setPreviewText(sampleInput)
        })
        .catch(() => setPreviewText(sampleInput))
        .finally(() => setPreviewBusy(false))
    }, 400)

    return () => window.clearTimeout(timerId)
  }, [resolvedSource, targetLang])

  // ─── Apply handler ─────────────────────────────────────────────────────────
  const onApply = async (): Promise<void> => {
    if (project === null) {
      setMessage('No project is open.')
      return
    }

    setBusy(true)
    setMessage(null)

    try {
      if (target === 'caption') {
        // Collect all caption lines from the caption track.
        const captionTrack = project.tracks.find((t) => t.id === 'captions')
        if (captionTrack === undefined || captionTrack.clips.length === 0) {
          // Fallback: translate the preview sample text.
          const result = await window.api.invoke('transliteration:transliterate', {
            text: SAMPLE_TEXT[resolvedSource],
            sourceLang: resolvedSource,
            targetLang
          })
          if (!result.ok) {
            setMessage(result.error)
            return
          }
          applyTransliteration(result.data.result, targetLang)
          setMessage('Transliteration applied.')
          return
        }

        // Transliterate each caption clip's text lines.
        const lines = captionTrack.clips.flatMap((clip) => clip.text?.lines ?? [])
        const joined = lines.join('\n')
        const result = await window.api.invoke('transliteration:transliterate', {
          text: joined,
          sourceLang: resolvedSource,
          targetLang
        })
        if (!result.ok) {
          setMessage(result.error)
          return
        }
        applyTransliteration(result.data.result, targetLang)
        setMessage(
          `Transliteration applied to caption track (${lines.length} line${lines.length !== 1 ? 's' : ''}).`
        )
      } else {
        // Text-layer mode: transliterate each selected text layer clip.
        if (textLayerIds === undefined || textLayerIds.length === 0) {
          setMessage('No text layers selected.')
          return
        }

        const allClips = project.tracks.flatMap((t) => t.clips)
        const targetClips = allClips.filter((c) => textLayerIds.includes(c.id))
        if (targetClips.length === 0) {
          setMessage('Selected text layers not found.')
          return
        }

        const lines = targetClips.flatMap((c) => c.text?.lines ?? [])
        const joined = lines.join('\n')
        const result = await window.api.invoke('transliteration:transliterate', {
          text: joined,
          sourceLang: resolvedSource,
          targetLang
        })
        if (!result.ok) {
          setMessage(result.error)
          return
        }
        applyTransliteration(result.data.result, targetLang)
        setMessage(
          `Transliteration applied to ${targetClips.length} text layer${targetClips.length !== 1 ? 's' : ''}.`
        )
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Transliteration failed.'
      setMessage(errorMessage)
    } finally {
      setBusy(false)
    }
  }

  const noProject = project === null
  const isSameLang = resolvedSource === targetLang
  const canApply = !noProject && !busy && !isSameLang

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* Header */}
      <div style={{ fontWeight: 600, fontSize: '13px', color: '#e0e0e0' }}>
        Transliteration
      </div>

      {/* Source Language */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <label htmlFor="translit-source-lang" style={{ fontSize: '11px', color: '#9e9e9e' }}>Source Language</label>
        <select
          id="translit-source-lang"
          value={sourceLang}
          onChange={(e) => setSourceLang(e.target.value as SupportedLang | 'auto')}
          style={selectStyle}
          disabled={noProject}
        >
          <option value="auto">Auto-detect</option>
          {SUPPORTED_LANGS.map((lang) => (
            <option key={lang} value={lang}>
              {LANG_LABELS[lang]}
            </option>
          ))}
        </select>
      </div>

      {/* Target Language */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <label htmlFor="translit-target-lang" style={{ fontSize: '11px', color: '#9e9e9e' }}>Target Language</label>
        <select
          id="translit-target-lang"
          value={targetLang}
          onChange={(e) => setTargetLang(e.target.value as SupportedLang)}
          style={selectStyle}
          disabled={noProject}
        >
          {SUPPORTED_LANGS.map((lang) => (
            <option key={lang} value={lang}>
              {LANG_LABELS[lang]}
            </option>
          ))}
        </select>
      </div>

      {/* Scheme */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <label htmlFor="translit-scheme" style={{ fontSize: '11px', color: '#9e9e9e' }}>Scheme</label>
        <select
          id="translit-scheme"
          value={scheme}
          onChange={(e) => setScheme(e.target.value as TransliterationScheme)}
          style={selectStyle}
          disabled={noProject}
        >
          <option value="ISO-15919">ISO-15919</option>
          <option value="ITRANS">ITRANS</option>
        </select>
      </div>

      {/* Mode toggle */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={{ fontSize: '11px', color: '#9e9e9e' }}>Mode</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['inline', 'replace'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              style={{
                ...toggleButtonStyle,
                background: mode === m ? '#3d7ae5' : '#2a2d35',
                color: mode === m ? '#fff' : '#9e9e9e'
              }}
              disabled={noProject}
            >
              {m === 'inline' ? 'Inline' : 'Replace'}
            </button>
          ))}
        </div>
      </div>

      {/* Target radio */}
      <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <legend style={{ fontSize: '11px', color: '#9e9e9e', padding: 0 }}>Apply To</legend>
        <div style={{ display: 'flex', gap: '16px' }}>
          <label style={{ fontSize: '12px', color: '#ccc', display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input
              type="radio"
              name="transliteration-target"
              value="caption"
              checked={target === 'caption'}
              onChange={() => setTarget('caption')}
              disabled={noProject}
            />
            Caption track
          </label>
          <label
            style={{
              fontSize: '12px',
              color: textLayerIds !== undefined && textLayerIds.length > 0 ? '#ccc' : '#555',
              display: 'flex',
              gap: '6px',
              alignItems: 'center'
            }}
          >
            <input
              type="radio"
              name="transliteration-target"
              value="text"
              checked={target === 'text'}
              onChange={() => setTarget('text')}
              disabled={noProject || textLayerIds === undefined || textLayerIds.length === 0}
            />
            Text layer
          </label>
        </div>
      </fieldset>

      {/* Live preview */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <label htmlFor="translit-preview" style={{ fontSize: '11px', color: '#9e9e9e' }}>
          Preview {previewBusy ? '(loading...)' : ''}
        </label>
        <textarea
          id="translit-preview"
          readOnly
          value={isSameLang ? SAMPLE_TEXT[resolvedSource] : previewText}
          rows={2}
          style={{
            background: '#1a1d24',
            border: '1px solid #3a3d48',
            borderRadius: '4px',
            color: '#e0e0e0',
            fontSize: '13px',
            padding: '6px 8px',
            resize: 'none',
            fontFamily: 'inherit',
            width: '100%',
            boxSizing: 'border-box'
          }}
        />
      </div>

      {/* Warning when source === target */}
      {isSameLang && (
        <div style={{ fontSize: '11px', color: '#f0a020' }}>
          Source and target languages are the same — no conversion needed.
        </div>
      )}

      {/* Apply button */}
      <button
        onClick={() => void onApply()}
        disabled={!canApply}
        style={{
          background: canApply ? '#3d7ae5' : '#2a2d35',
          color: canApply ? '#fff' : '#555',
          border: 'none',
          borderRadius: '4px',
          padding: '7px 12px',
          fontSize: '12px',
          cursor: canApply ? 'pointer' : 'not-allowed',
          fontWeight: 600
        }}
      >
        {busy ? 'Applying...' : 'Apply Transliteration'}
      </button>

      {/* Status message */}
      {message !== null && (
        <div
          style={{
            fontSize: '11px',
            color: message.toLowerCase().includes('fail') || message.toLowerCase().includes('error') || message.toLowerCase().includes('no ')
              ? '#e05555'
              : '#4caf50',
            marginTop: '2px'
          }}
        >
          {message}
        </div>
      )}
    </div>
  )
}

// ─── Shared micro-styles ──────────────────────────────────────────────────────

const selectStyle: React.CSSProperties = {
  background: '#1a1d24',
  border: '1px solid #3a3d48',
  borderRadius: '4px',
  color: '#e0e0e0',
  fontSize: '12px',
  padding: '5px 8px',
  width: '100%',
  outline: 'none'
}

const toggleButtonStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: '4px',
  padding: '5px 14px',
  fontSize: '12px',
  cursor: 'pointer',
  flex: 1
}

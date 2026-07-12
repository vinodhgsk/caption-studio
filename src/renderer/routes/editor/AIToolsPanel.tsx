/**
 * AI Tools panel (P10.9, Doc 12). Four sections:
 *
 *   1. TTS — pick a text/caption clip + voice, generate a VO audio clip.
 *   2. Translation — pick target language, translate all captions inline.
 *   3. Keyword Highlight — auto-detect or manually add/remove emphasis words.
 *   4. Transliteration — placeholder for P10R.1–P10R.3.
 *
 * All language dropdowns expose only the six supported codes (Tamil first).
 * Sections degrade gracefully when no project is open or a provider is unavailable.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useProjectStore } from '@/store/projectStore'
import { useTimelineStore } from '@/store/timelineStore'
import { CAPTION_TRACK_ID } from '@/store/timeline'
import type { TTSLanguageCode, TTSVoice } from '../../../shared/tts'
import { TTS_LANGUAGES, DEFAULT_TTS_LANGUAGE } from '../../../shared/tts'
import type { KeywordHighlight } from '../../../shared/keywordHighlight'

/** Human-readable labels for the six supported language codes. */
const LANGUAGE_LABELS: Record<TTSLanguageCode, string> = {
  ta: 'Tamil',
  te: 'Telugu',
  ml: 'Malayalam',
  kn: 'Kannada',
  hi: 'Hindi',
  en: 'English'
}

/** A simple labeled section container. */
function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="border-b border-line px-4 py-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</h3>
      {children}
    </div>
  )
}

/** Small inline error message. */
function ErrorMsg({ msg }: { msg: string }): JSX.Element {
  return <p className="mt-1 text-xs text-red-400">{msg}</p>
}

/** Small inline status message. */
function StatusMsg({ msg }: { msg: string }): JSX.Element {
  return <p className="mt-1 text-xs text-green-400">{msg}</p>
}

// ---------------------------------------------------------------------------
// TTS Section
// ---------------------------------------------------------------------------
function TtsSection(): JSX.Element {
  const project = useProjectStore((s) => s.currentProject)
  const selection = useTimelineStore((s) => s.selection)
  const listTtsVoices = useTimelineStore((s) => s.listTtsVoices)
  const synthesizeTts = useTimelineStore((s) => s.synthesizeTts)
  const addClip = useTimelineStore((s) => s.addClip)
  const addEmptyTrack = useTimelineStore((s) => s.addEmptyTrack)

  const [voices, setVoices] = useState<TTSVoice[]>([])
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('')
  const [selectedLang, setSelectedLang] = useState<TTSLanguageCode>(DEFAULT_TTS_LANGUAGE)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  // Enumerate voices on mount / when project opens.
  useEffect(() => {
    void listTtsVoices().then((res) => {
      if (res.ok) {
        setVoices(res.voices)
        // Default to the first Tamil voice (or first voice overall).
        const taVoice = res.voices.find((v) => v.language === DEFAULT_TTS_LANGUAGE)
        const defaultVoice = taVoice ?? res.voices[0]
        if (defaultVoice !== undefined) setSelectedVoiceId(defaultVoice.id)
      }
    })
  }, [listTtsVoices, project])

  // Collect text clips for the dropdown.
  const textClips = useMemo(() => {
    if (project === null) return []
    return project.tracks
      .filter((t) => t.type === 'text' || t.id === CAPTION_TRACK_ID)
      .flatMap((t) => t.clips)
      .filter((c) => {
        const hasLines = (c.text?.lines?.length ?? 0) > 0
        const hasCaption = (c.caption?.words?.length ?? 0) > 0
        return hasLines || hasCaption
      })
  }, [project])

  // Pre-select the currently selected clip if it has text.
  const [selectedClipId, setSelectedClipId] = useState<string>('')
  useEffect(() => {
    const firstSelected = selection[0]
    if (firstSelected !== undefined && textClips.some((c) => c.id === firstSelected)) {
      setSelectedClipId(firstSelected)
    } else if (textClips.length > 0 && textClips[0] !== undefined) {
      setSelectedClipId(textClips[0].id)
    } else {
      setSelectedClipId('')
    }
  }, [selection, textClips])

  const noProject = project === null
  const noVoices = voices.length === 0
  const noClip = selectedClipId === '' || textClips.length === 0
  const disabled = noProject || noVoices || noClip || running

  const handleGenerate = useCallback(async () => {
    if (disabled) return
    setRunning(true)
    setError(null)
    setStatus(null)

    const result = await synthesizeTts(selectedClipId, selectedVoiceId, selectedLang, false)
    setRunning(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    // Place the synthesized audio on an audio track.
    const { mediaRef, duration } = result.result
    const currentProject = useProjectStore.getState().currentProject
    if (currentProject === null) {
      setError('No project is open.')
      return
    }

    let audioTrack = currentProject.tracks.find((t) => t.type === 'audio')
    if (audioTrack === undefined) {
      const newId = addEmptyTrack('audio')
      if (newId === null) {
        setError('Failed to create audio track.')
        return
      }
      const updated = useProjectStore.getState().currentProject
      audioTrack = updated?.tracks.find((t) => t.id === newId)
    }
    if (audioTrack === undefined) {
      setError('Failed to find audio track.')
      return
    }

    // Append the audio clip at the end of the track.
    const trackEnd = audioTrack.clips.reduce((acc, c) => Math.max(acc, c.start + (c.out - c.in)), 0)
    const audioClip = {
      id: crypto.randomUUID(),
      mediaRef,
      in: 0,
      out: duration,
      start: trackEnd,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false, opacity: 1, z: 0 },
      audio: { gain: 1, fadeInSec: 0, fadeOutSec: 0, muted: false }
    }
    addClip(audioTrack.id, audioClip)
    setStatus(`Generated ${duration.toFixed(1)}s audio: ${mediaRef}`)
  }, [disabled, synthesizeTts, selectedClipId, selectedVoiceId, selectedLang, addEmptyTrack, addClip])

  return (
    <Section title="Text to Speech">
      {noProject ? (
        <p className="text-xs text-text-muted">Open a project to use TTS.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {/* Text layer selector */}
          <div>
            <label htmlFor="tts-clip-select" className="mb-0.5 block text-xs text-text-muted">Text layer</label>
            <select
              id="tts-clip-select"
              value={selectedClipId}
              onChange={(e) => setSelectedClipId(e.target.value)}
              disabled={running || textClips.length === 0}
              className="w-full rounded border border-line bg-surface-2 px-2 py-1 text-xs text-text-primary disabled:opacity-50"
            >
              {textClips.length === 0 ? (
                <option value="">No text clips</option>
              ) : (
                textClips.map((c) => {
                  const label =
                    c.text?.lines?.join(' ').slice(0, 30) ??
                    c.caption?.words.map((w) => w.text).join(' ').slice(0, 30) ??
                    c.id.slice(0, 8)
                  return (
                    <option key={c.id} value={c.id}>
                      {label}
                    </option>
                  )
                })
              )}
            </select>
          </div>

          {/* Language selector */}
          <div>
            <label htmlFor="tts-lang-select" className="mb-0.5 block text-xs text-text-muted">Language</label>
            <select
              id="tts-lang-select"
              value={selectedLang}
              onChange={(e) => setSelectedLang(e.target.value as TTSLanguageCode)}
              disabled={running}
              className="w-full rounded border border-line bg-surface-2 px-2 py-1 text-xs text-text-primary disabled:opacity-50"
            >
              {TTS_LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {LANGUAGE_LABELS[lang]}
                </option>
              ))}
            </select>
          </div>

          {/* Voice selector */}
          <div>
            <label htmlFor="tts-voice-select" className="mb-0.5 block text-xs text-text-muted">Voice</label>
            <select
              id="tts-voice-select"
              value={selectedVoiceId}
              onChange={(e) => setSelectedVoiceId(e.target.value)}
              disabled={running || voices.length === 0}
              className="w-full rounded border border-line bg-surface-2 px-2 py-1 text-xs text-text-primary disabled:opacity-50"
            >
              {voices.length === 0 ? (
                <option value="">No provider</option>
              ) : (
                voices
                  .filter((v) => v.language === selectedLang)
                  .concat(voices.filter((v) => v.language !== selectedLang))
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({LANGUAGE_LABELS[v.language]})
                    </option>
                  ))
              )}
            </select>
          </div>

          <button
            onClick={() => void handleGenerate()}
            disabled={disabled}
            className="mt-1 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? 'Generating...' : 'Generate'}
          </button>

          {error !== null && <ErrorMsg msg={error} />}
          {status !== null && <StatusMsg msg={status} />}
          {noVoices && !noProject && (
            <p className="text-xs text-text-muted">No TTS provider available.</p>
          )}
        </div>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Translation Section
// ---------------------------------------------------------------------------
function TranslationSection(): JSX.Element {
  const project = useProjectStore((s) => s.currentProject)
  const applyTranslation = useTimelineStore((s) => s.applyTranslation)

  const [targetLang, setTargetLang] = useState<TTSLanguageCode>(DEFAULT_TTS_LANGUAGE)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [showTranslated, setShowTranslated] = useState(false)

  const noProject = project === null
  const captionTrack = project?.tracks.find((t) => t.id === CAPTION_TRACK_ID)
  const hasCaptions = (captionTrack?.clips.length ?? 0) > 0
  const disabled = noProject || !hasCaptions || running

  const handleTranslate = useCallback(async () => {
    if (disabled) return
    setRunning(true)
    setError(null)
    setStatus(null)
    const result = await applyTranslation(targetLang)
    setRunning(false)
    if (!result.ok) {
      setError(result.error)
    } else {
      setStatus(`Translated ${result.count} caption(s) to ${LANGUAGE_LABELS[targetLang]}.`)
    }
  }, [disabled, applyTranslation, targetLang])

  return (
    <Section title="Translation">
      {noProject ? (
        <p className="text-xs text-text-muted">Open a project to use translation.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div>
            <label htmlFor="translation-target-lang" className="mb-0.5 block text-xs text-text-muted">Target language</label>
            <select
              id="translation-target-lang"
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value as TTSLanguageCode)}
              disabled={running}
              className="w-full rounded border border-line bg-surface-2 px-2 py-1 text-xs text-text-primary disabled:opacity-50"
            >
              {TTS_LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {LANGUAGE_LABELS[lang]}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => void handleTranslate()}
            disabled={disabled}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? 'Translating...' : 'Translate captions'}
          </button>

          {hasCaptions && (
            <label className="flex items-center gap-1.5 text-xs text-text-muted">
              <input
                type="checkbox"
                checked={showTranslated}
                onChange={(e) => setShowTranslated(e.target.checked)}
                className="accent-accent"
              />
              Show inline translation
            </label>
          )}

          {!hasCaptions && (
            <p className="text-xs text-text-muted">Generate captions first.</p>
          )}
          {error !== null && <ErrorMsg msg={error} />}
          {status !== null && <StatusMsg msg={status} />}
        </div>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Keyword Highlight Section
// ---------------------------------------------------------------------------

/** Preset colors for the Add form (matches the HIGHLIGHT_COLORS palette). */
const PRESET_COLORS = ['#FFD700', '#FF6B6B', '#4ECDC4', '#9B59B6', '#F39C12'] as const

function KeywordHighlightSection(): JSX.Element {
  const project = useProjectStore((s) => s.currentProject)
  const autoDetectKeywords = useTimelineStore((s) => s.autoDetectKeywords)
  const addKeywordHighlight = useTimelineStore((s) => s.addKeywordHighlight)
  const removeKeywordHighlight = useTimelineStore((s) => s.removeKeywordHighlight)

  const [newWord, setNewWord] = useState('')
  const [newColor, setNewColor] = useState<string>(PRESET_COLORS[0])
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const noProject = project === null
  const highlights = useMemo<KeywordHighlight[]>(() => {
    if (project === null) return []
    const raw = project.captions?.keywordHighlights ?? []
    return raw as KeywordHighlight[]
  }, [project])

  const handleAutoDetect = useCallback(() => {
    setError(null)
    setStatus(null)
    const ok = autoDetectKeywords()
    if (!ok) {
      setError('No transcript available. Generate captions first.')
    } else {
      setStatus('Keywords auto-detected.')
    }
  }, [autoDetectKeywords])

  const handleAdd = useCallback(() => {
    const word = newWord.trim()
    if (word.length === 0) return
    setError(null)
    addKeywordHighlight(word, newColor)
    setNewWord('')
  }, [newWord, newColor, addKeywordHighlight])

  const handleRemove = useCallback((word: string) => {
    removeKeywordHighlight(word)
  }, [removeKeywordHighlight])

  return (
    <Section title="Keyword Highlight">
      {noProject ? (
        <p className="text-xs text-text-muted">Open a project to use keyword highlight.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <button
            onClick={handleAutoDetect}
            className="rounded bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-3 disabled:opacity-40"
          >
            Auto-detect keywords
          </button>

          {/* Current highlight list */}
          {highlights.length > 0 && (
            <ul className="flex flex-col gap-1">
              {highlights.map((h) => (
                <li
                  key={h.word}
                  className="flex items-center justify-between rounded bg-surface-2 px-2 py-1"
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ backgroundColor: h.color }}
                    />
                    <span className="text-xs text-text-primary">{h.word}</span>
                  </span>
                  <button
                    onClick={() => handleRemove(h.word)}
                    className="text-xs text-text-muted hover:text-red-400"
                    aria-label={`Remove keyword ${h.word}`}
                  >
                    x
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Add keyword form */}
          <div className="flex gap-1">
            <label htmlFor="keyword-input" className="sr-only">Add keyword</label>
            <input
              id="keyword-input"
              type="text"
              value={newWord}
              onChange={(e) => setNewWord(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
              placeholder="Add keyword..."
              className="min-w-0 flex-1 rounded border border-line bg-surface-2 px-2 py-1 text-xs text-text-primary placeholder:text-text-muted"
            />
            {/* Color swatch selector */}
            <div className="flex gap-0.5">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => setNewColor(color)}
                  className="h-5 w-5 rounded-full border-2"
                  style={{
                    backgroundColor: color,
                    borderColor: newColor === color ? 'white' : 'transparent'
                  }}
                  aria-label={`Select color ${color}`}
                />
              ))}
            </div>
            <button
              onClick={handleAdd}
              disabled={newWord.trim().length === 0}
              className="rounded bg-accent px-2 py-1 text-xs font-medium text-white disabled:opacity-40"
            >
              Add
            </button>
          </div>

          {error !== null && <ErrorMsg msg={error} />}
          {status !== null && <StatusMsg msg={status} />}
        </div>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Transliteration Section (placeholder — P10R.1–P10R.3)
// ---------------------------------------------------------------------------
function TransliterationSection(): JSX.Element {
  return (
    <Section title="Transliteration">
      <p className="text-xs text-text-muted">Transliteration — coming soon</p>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Top-level AI Tools Panel
// ---------------------------------------------------------------------------
/**
 * AI Tools panel (P10.9, Doc 12). Hosts TTS, Translation, Keyword Highlight,
 * and a Transliteration placeholder in a single scrollable right-side panel.
 */
export function AIToolsPanel(): JSX.Element {
  return (
    <section className="flex h-full flex-col">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-text-primary">AI Tools</h2>
      </div>
      <div className="flex-1 overflow-y-auto">
        <TtsSection />
        <TranslationSection />
        <KeywordHighlightSection />
        <TransliterationSection />
      </div>
    </section>
  )
}

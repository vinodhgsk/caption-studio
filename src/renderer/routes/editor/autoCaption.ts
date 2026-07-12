/**
 * Pure UI logic for the Auto-Caption panel (P4.8, Doc 02).
 *
 * The panel orchestrates the one-click chain normalize → transcribe → group via
 * the timeline-store actions; THESE helpers are the pure, testable bits the
 * component renders with: the stage machine + its human labels, the
 * Generate-enabled predicate, and the language-dropdown option list. Keeping
 * them out of the component means they unit-test without React/IPC.
 */
import { SUPPORTED_LANGUAGES, type LanguageCode } from '../../../shared/stt'

/**
 * The pipeline stage the panel is in. `idle` before/after a run with no error,
 * the three working stages map to the store actions in order, `done` after a
 * successful generate, and `error` when any step's `{ok,error}` envelope fails.
 */
export type CaptionStage =
  | 'idle'
  | 'normalizing'
  | 'transcribing'
  | 'aligning'
  | 'grouping'
  | 'done'
  | 'error'

/** The three stages during which the chain is actively running (button busy). */
const RUNNING_STAGES: ReadonlySet<CaptionStage> = new Set<CaptionStage>([
  'normalizing',
  'transcribing',
  'aligning',
  'grouping'
])

export type CaptionMode = 'auto' | 'lyricsFirst'

/** Whether `stage` represents an in-flight run (used to disable inputs). */
export function isRunning(stage: CaptionStage): boolean {
  return RUNNING_STAGES.has(stage)
}

/** Human-readable status line for each stage (shown next to the progress bar). */
export function stageLabel(stage: CaptionStage): string {
  switch (stage) {
    case 'idle':
      return 'Ready.'
    case 'normalizing':
      return 'Normalizing audio…'
    case 'transcribing':
      return 'Transcribing…'
    case 'aligning':
      return 'Aligning lyrics…'
    case 'grouping':
      return 'Grouping captions…'
    case 'done':
      return 'Captions generated.'
    case 'error':
      return 'Failed.'
    default: {
      const exhaustive: never = stage
      return exhaustive
    }
  }
}

/**
 * Progress as a fraction in [0,1] for the bar. The working stages advance the
 * bar a third at a time so the user sees motion through the chain; `done` fills
 * it and `idle`/`error` show empty.
 */
export function stageProgress(stage: CaptionStage): number {
  switch (stage) {
    case 'idle':
    case 'error':
      return 0
    case 'normalizing':
      return 0.25
    case 'transcribing':
      return 0.55
    case 'aligning':
      return 0.8
    case 'grouping':
      return 0.9
    case 'done':
      return 1
    default: {
      const exhaustive: never = stage
      return exhaustive
    }
  }
}

/**
 * Whether the Generate button is enabled. Requires a project open, an audio clip
 * to caption, and no run in flight. Pure predicate over the panel's inputs.
 */
export function canGenerate(args: {
  hasProject: boolean
  hasAudioClip: boolean
  stage: CaptionStage
  mode: CaptionMode
  hasLyrics: boolean
}): boolean {
  if (!args.hasProject || !args.hasAudioClip || isRunning(args.stage)) return false
  if (args.mode === 'lyricsFirst') return args.hasLyrics
  return true
}

/** A selectable entry in the language dropdown. */
export interface LanguageOption {
  /** `'auto'` for auto-detect, else a supported {@link LanguageCode}. */
  value: 'auto' | LanguageCode
  /** Readable label shown in the dropdown. */
  label: string
}

/** Readable names for each supported language, keyed by code. */
const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  ta: 'Tamil',
  te: 'Telugu',
  ml: 'Malayalam',
  kn: 'Kannada',
  hi: 'Hindi',
  en: 'English'
}

/**
 * The language dropdown options: "Auto-detect" first (auto-detect within the
 * six supported languages, Tamil fallback), then each supported language in the
 * canonical order from {@link SUPPORTED_LANGUAGES} (Tamil first).
 */
export const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { value: 'auto', label: 'Auto-detect' },
  ...SUPPORTED_LANGUAGES.map((code) => ({ value: code, label: LANGUAGE_LABELS[code] }))
]

/**
 * Map a dropdown `value` to the `language` arg for `transcribe`: `'auto'` →
 * `undefined` (auto-detect), else the pinned {@link LanguageCode}.
 */
export function selectionToLanguage(value: 'auto' | LanguageCode): LanguageCode | undefined {
  return value === 'auto' ? undefined : value
}

import { describe, expect, it } from 'vitest'
import { SUPPORTED_LANGUAGES } from '../../../shared/stt'
import {
  LANGUAGE_OPTIONS,
  canGenerate,
  isRunning,
  selectionToLanguage,
  stageLabel,
  stageProgress,
  type CaptionStage
} from './autoCaption'

describe('isRunning', () => {
  it('is true only for the three working stages', () => {
    expect(isRunning('normalizing')).toBe(true)
    expect(isRunning('transcribing')).toBe(true)
    expect(isRunning('aligning')).toBe(true)
    expect(isRunning('grouping')).toBe(true)
  })

  it('is false for idle / done / error', () => {
    expect(isRunning('idle')).toBe(false)
    expect(isRunning('done')).toBe(false)
    expect(isRunning('error')).toBe(false)
  })
})

describe('stageLabel', () => {
  it('maps every stage to a non-empty label', () => {
    const stages: CaptionStage[] = [
      'idle',
      'normalizing',
      'transcribing',
      'aligning',
      'grouping',
      'done',
      'error'
    ]
    for (const stage of stages) {
      expect(stageLabel(stage).length).toBeGreaterThan(0)
    }
  })

  it('names the active step for each working stage', () => {
    expect(stageLabel('normalizing')).toMatch(/normaliz/i)
    expect(stageLabel('transcribing')).toMatch(/transcrib/i)
    expect(stageLabel('aligning')).toMatch(/align/i)
    expect(stageLabel('grouping')).toMatch(/group/i)
  })
})

describe('stageProgress', () => {
  it('advances monotonically through the chain and fills on done', () => {
    expect(stageProgress('idle')).toBe(0)
    expect(stageProgress('normalizing')).toBeLessThan(stageProgress('transcribing'))
    expect(stageProgress('transcribing')).toBeLessThan(stageProgress('aligning'))
    expect(stageProgress('transcribing')).toBeLessThan(stageProgress('grouping'))
    expect(stageProgress('grouping')).toBeLessThan(stageProgress('done'))
    expect(stageProgress('done')).toBe(1)
  })

  it('shows empty for error', () => {
    expect(stageProgress('error')).toBe(0)
  })

  it('keeps every value within [0,1]', () => {
    const stages: CaptionStage[] = [
      'idle',
      'normalizing',
      'transcribing',
      'aligning',
      'grouping',
      'done',
      'error'
    ]
    for (const stage of stages) {
      const p = stageProgress(stage)
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(1)
    }
  })
})

describe('canGenerate', () => {
  it('enables only with a project, an audio clip, and no run in flight', () => {
    expect(
      canGenerate({
        hasProject: true,
        hasAudioClip: true,
        stage: 'idle',
        mode: 'auto',
        hasLyrics: false
      })
    ).toBe(true)
    expect(
      canGenerate({
        hasProject: true,
        hasAudioClip: true,
        stage: 'done',
        mode: 'auto',
        hasLyrics: false
      })
    ).toBe(true)
    expect(
      canGenerate({
        hasProject: true,
        hasAudioClip: true,
        stage: 'error',
        mode: 'auto',
        hasLyrics: false
      })
    ).toBe(true)
  })

  it('disables without a project', () => {
    expect(
      canGenerate({
        hasProject: false,
        hasAudioClip: true,
        stage: 'idle',
        mode: 'auto',
        hasLyrics: false
      })
    ).toBe(false)
  })

  it('disables without an audio clip', () => {
    expect(
      canGenerate({
        hasProject: true,
        hasAudioClip: false,
        stage: 'idle',
        mode: 'auto',
        hasLyrics: false
      })
    ).toBe(false)
  })

  it('disables while a run is in flight', () => {
    expect(
      canGenerate({
        hasProject: true,
        hasAudioClip: true,
        stage: 'normalizing',
        mode: 'auto',
        hasLyrics: false
      })
    ).toBe(false)
    expect(
      canGenerate({
        hasProject: true,
        hasAudioClip: true,
        stage: 'transcribing',
        mode: 'auto',
        hasLyrics: false
      })
    ).toBe(false)
    expect(
      canGenerate({
        hasProject: true,
        hasAudioClip: true,
        stage: 'aligning',
        mode: 'lyricsFirst',
        hasLyrics: true
      })
    ).toBe(false)
    expect(
      canGenerate({
        hasProject: true,
        hasAudioClip: true,
        stage: 'grouping',
        mode: 'auto',
        hasLyrics: false
      })
    ).toBe(false)
  })

  it('requires non-empty lyrics in lyrics-first mode', () => {
    expect(
      canGenerate({
        hasProject: true,
        hasAudioClip: true,
        stage: 'idle',
        mode: 'lyricsFirst',
        hasLyrics: false
      })
    ).toBe(false)
    expect(
      canGenerate({
        hasProject: true,
        hasAudioClip: true,
        stage: 'idle',
        mode: 'lyricsFirst',
        hasLyrics: true
      })
    ).toBe(true)
  })
})

describe('LANGUAGE_OPTIONS', () => {
  it('leads with Auto-detect', () => {
    expect(LANGUAGE_OPTIONS[0]).toEqual({ value: 'auto', label: 'Auto-detect' })
  })

  it('lists every supported language in canonical (Tamil-first) order', () => {
    const codes = LANGUAGE_OPTIONS.slice(1).map((o) => o.value)
    expect(codes).toEqual([...SUPPORTED_LANGUAGES])
    expect(codes[0]).toBe('ta')
  })

  it('gives each language a readable, non-empty label', () => {
    for (const opt of LANGUAGE_OPTIONS.slice(1)) {
      expect(opt.label).not.toBe(opt.value)
      expect(opt.label.length).toBeGreaterThan(0)
    }
  })
})

describe('selectionToLanguage', () => {
  it('maps auto to undefined (auto-detect)', () => {
    expect(selectionToLanguage('auto')).toBeUndefined()
  })

  it('passes a pinned language through unchanged', () => {
    expect(selectionToLanguage('ta')).toBe('ta')
    expect(selectionToLanguage('en')).toBe('en')
  })
})

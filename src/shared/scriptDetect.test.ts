import { describe, it, expect } from 'vitest'
import {
  detectScript,
  scriptOfCodePoint,
  DEFAULT_SCRIPT,
  ALL_SCRIPTS,
  type Script
} from './scriptDetect'

describe('scriptOfCodePoint — Unicode block membership', () => {
  const cases: [string, Script][] = [
    ['த', 'tamil'], // U+0BA4
    ['తె', 'telugu'], // first cp U+0C24
    ['മ', 'malayalam'], // U+0D2E
    ['ಕ', 'kannada'], // U+0C95
    ['क', 'devanagari'], // U+0915
    ['A', 'latin'] // U+0041
  ]
  it.each(cases)('classifies %s as %s', (ch, script) => {
    expect(scriptOfCodePoint(ch.codePointAt(0)!)).toBe(script)
  })

  it('returns null for codepoints outside every supported block (emoji)', () => {
    expect(scriptOfCodePoint('😀'.codePointAt(0)!)).toBeNull()
  })
})

describe('detectScript — dominant script of a run', () => {
  it('detects Tamil sample text', () => {
    expect(detectScript('வணக்கம் தமிழ்')).toBe('tamil')
  })
  it('detects Telugu sample text', () => {
    expect(detectScript('నమస్కారం తెలుగు')).toBe('telugu')
  })
  it('detects Malayalam sample text', () => {
    expect(detectScript('നമസ്കാരം മലയാളം')).toBe('malayalam')
  })
  it('detects Kannada sample text', () => {
    expect(detectScript('ನಮಸ್ಕಾರ ಕನ್ನಡ')).toBe('kannada')
  })
  it('detects Devanagari (Hindi) sample text', () => {
    expect(detectScript('नमस्ते हिन्दी')).toBe('devanagari')
  })
  it('detects Latin sample text', () => {
    expect(detectScript('The quick brown fox')).toBe('latin')
  })

  it('Indic-first tie-break: an Indic letter with surrounding ASCII still resolves Indic', () => {
    expect(detectScript('hi தமிழ் 2024')).toBe('tamil')
  })

  it('empty / whitespace / emoji-only text falls back to the global default (Tamil)', () => {
    expect(detectScript('')).toBe(DEFAULT_SCRIPT)
    expect(detectScript('   ')).toBe('latin') // spaces ARE Basic-Latin
    expect(detectScript('😀🎬')).toBe(DEFAULT_SCRIPT)
  })

  it('global default is Tamil', () => {
    expect(DEFAULT_SCRIPT).toBe('tamil')
    expect(ALL_SCRIPTS[0]).toBe('tamil')
  })
})

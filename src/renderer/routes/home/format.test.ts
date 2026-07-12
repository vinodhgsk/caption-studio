import { describe, expect, it } from 'vitest'
import { formatDuration, formatLastModified } from './format'

describe('formatLastModified', () => {
  const now = Date.parse('2026-06-29T12:00:00.000Z')

  it('returns empty string for missing or unparseable input', () => {
    expect(formatLastModified(undefined, now)).toBe('')
    expect(formatLastModified('not-a-date', now)).toBe('')
  })

  it('labels recent times as "just now"', () => {
    expect(formatLastModified('2026-06-29T11:59:30.000Z', now)).toBe('just now')
  })

  it('labels minutes, hours, and days', () => {
    expect(formatLastModified('2026-06-29T11:55:00.000Z', now)).toBe('5 min ago')
    expect(formatLastModified('2026-06-29T09:00:00.000Z', now)).toBe('3 h ago')
    expect(formatLastModified('2026-06-27T12:00:00.000Z', now)).toBe('2 d ago')
  })

  it('falls back to a locale date past a week', () => {
    const out = formatLastModified('2026-06-01T12:00:00.000Z', now)
    expect(out).not.toBe('')
    expect(out).not.toMatch(/ago|just now/)
  })

  it('treats future timestamps as "just now"', () => {
    expect(formatLastModified('2026-06-29T12:05:00.000Z', now)).toBe('just now')
  })
})

describe('formatDuration', () => {
  it('returns empty string when undefined or invalid', () => {
    expect(formatDuration(undefined)).toBe('')
    expect(formatDuration(-1)).toBe('')
    expect(formatDuration(Number.NaN)).toBe('')
  })

  it('formats sub-hour durations as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(9)).toBe('0:09')
    expect(formatDuration(75)).toBe('1:15')
    expect(formatDuration(600)).toBe('10:00')
  })

  it('formats durations past an hour as h:mm:ss', () => {
    expect(formatDuration(3661)).toBe('1:01:01')
    expect(formatDuration(7325)).toBe('2:02:05')
  })
})

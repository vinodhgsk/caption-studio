import { describe, expect, it } from 'vitest'
import { formatTimecode } from './timecode'

describe('formatTimecode', () => {
  it('formats zero as 00:00:00', () => {
    expect(formatTimecode(0, 30)).toBe('00:00:00')
  })

  it('formats whole seconds with zero frames at 30 fps', () => {
    expect(formatTimecode(5, 30)).toBe('00:05:00')
    expect(formatTimecode(65, 30)).toBe('01:05:00')
  })

  it('shows the frame index within the second (30 fps)', () => {
    // 1.5s = frame 45 = 1s + 15 frames.
    expect(formatTimecode(1.5, 30)).toBe('00:01:15')
  })

  it('rolls frames over into seconds (no FF >= fps)', () => {
    // 29/30s rounds to frame 29 → 00:00:29; one more frame rolls to 00:01:00.
    expect(formatTimecode(29 / 30, 30)).toBe('00:00:29')
    expect(formatTimecode(30 / 30, 30)).toBe('00:01:00')
  })

  it('respects 24 fps frame boundaries', () => {
    // 1s = frame 24 = 1s, 0 frames; 1s + 12 frames = 1.5s.
    expect(formatTimecode(1, 24)).toBe('00:01:00')
    expect(formatTimecode(1.5, 24)).toBe('00:01:12')
    // Frame 23 stays within the second.
    expect(formatTimecode(23 / 24, 24)).toBe('00:00:23')
  })

  it('respects 60 fps frame boundaries', () => {
    expect(formatTimecode(1, 60)).toBe('00:01:00')
    expect(formatTimecode(0.5, 60)).toBe('00:00:30')
    expect(formatTimecode(59 / 60, 60)).toBe('00:00:59')
  })

  it('rounds to the nearest frame', () => {
    // 2.012s at 30 fps → frame 60 (2.0s) → 00:02:00.
    expect(formatTimecode(2.012, 30)).toBe('00:02:00')
    // 2.02s at 30 fps → frame 61 → 00:02:01.
    expect(formatTimecode(2.02, 30)).toBe('00:02:01')
  })

  it('clamps negative input to zero and falls back fps when invalid', () => {
    expect(formatTimecode(-3, 30)).toBe('00:00:00')
    expect(formatTimecode(1.5, 0)).toBe('00:01:15') // fps fallback = 30
    expect(formatTimecode(1.5, Number.NaN)).toBe('00:01:15')
  })
})

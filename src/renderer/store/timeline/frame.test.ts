import { describe, expect, it } from 'vitest'
import { frameToSeconds, secondsToFrame, snapToFrame } from './frame'

describe('frame helpers', () => {
  it('secondsToFrame rounds to the nearest frame across 24/30/60 fps', () => {
    expect(secondsToFrame(1, 24)).toBe(24)
    expect(secondsToFrame(1, 30)).toBe(30)
    expect(secondsToFrame(1, 60)).toBe(60)
    // 0.5s at 30fps = frame 15; rounding at the boundary.
    expect(secondsToFrame(0.5, 30)).toBe(15)
    // Nearest-frame rounding: 0.49 of a frame rounds down, 0.51 rounds up.
    expect(secondsToFrame(1 / 30 + 1 / 30 / 3, 30)).toBe(1)
    expect(secondsToFrame(1 / 30 + (2 * (1 / 30)) / 3, 30)).toBe(2)
  })

  it('frameToSeconds inverts whole frames at each fps', () => {
    expect(frameToSeconds(24, 24)).toBe(1)
    expect(frameToSeconds(15, 30)).toBe(0.5)
    expect(frameToSeconds(90, 60)).toBe(1.5)
  })

  it('snapToFrame lands on a frame boundary at 24/30/60 fps', () => {
    expect(snapToFrame(0.51, 24)).toBeCloseTo(frameToSeconds(secondsToFrame(0.51, 24), 24))
    expect(snapToFrame(0.4999, 30)).toBe(0.5)
    expect(snapToFrame(1.0167, 60)).toBeCloseTo(61 / 60)
  })

  it('round-trips: snapToFrame is idempotent', () => {
    for (const fps of [24, 30, 60]) {
      const t = 2.3456
      const once = snapToFrame(t, fps)
      expect(snapToFrame(once, fps)).toBeCloseTo(once)
    }
  })

  it('secondsToFrame maps t=0 to frame 0 at any fps', () => {
    expect(secondsToFrame(0, 24)).toBe(0)
    expect(secondsToFrame(0, 30)).toBe(0)
    expect(secondsToFrame(0, 60)).toBe(0)
  })

  it('secondsToFrame rounds a negative time toward the nearest frame (symmetric)', () => {
    // Math.round rounds half toward +Infinity, but well-clear values are symmetric.
    expect(secondsToFrame(-1, 30)).toBe(-30)
    expect(secondsToFrame(-1 / 30 - 1 / 90, 30)).toBe(-1) // -1.33 frames -> -1
    expect(secondsToFrame(-1 / 30 - (2 / 3) * (1 / 30), 30)).toBe(-2) // -1.66 -> -2
  })

  it('secondsToFrame rounds half UP (Math.round semantics) at the .5 frame mark', () => {
    // 0.5 of a frame at 30fps sits at t = 0.5/30; Math.round(0.5) = 1.
    expect(secondsToFrame(0.5 / 30, 30)).toBe(1)
    // The frame-1.5 mark rounds up to 2.
    expect(secondsToFrame(1.5 / 30, 30)).toBe(2)
  })

  it('supports fractional (drop-frame-style) fps like 23.976 / 29.97', () => {
    expect(secondsToFrame(1, 23.976)).toBe(24)
    expect(secondsToFrame(1, 29.97)).toBe(30)
    // snapToFrame at a fractional fps still lands on an exact frame multiple.
    const fps = 29.97
    const snapped = snapToFrame(2.3456, fps)
    expect(snapped * fps).toBeCloseTo(Math.round(snapped * fps), 6)
  })

  it('snapToFrame of an already-on-frame time is exact', () => {
    expect(snapToFrame(2 / 30, 30)).toBeCloseTo(2 / 30, 12)
    expect(snapToFrame(0, 30)).toBe(0)
  })
})

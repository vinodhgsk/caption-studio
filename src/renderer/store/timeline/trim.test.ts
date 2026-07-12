import { describe, expect, it } from 'vitest'
import { clampTrim, MIN_CLIP_SEC, type TrimBounds } from './trim'

const base: TrimBounds = { in: 2, out: 6, start: 5 }

describe('clampTrim (P3.6 drag-trim clamp)', () => {
  it("left edge: in and start move together by the requested delta when in bounds", () => {
    const r = clampTrim(base, 'start', -1)
    expect(r.in).toBe(1)
    expect(r.start).toBe(4)
    expect(r.out).toBe(6)
  })

  it("clamp to media: left edge cannot pull in below 0 (start follows applied delta)", () => {
    const r = clampTrim({ in: 1, out: 6, start: 3 }, 'start', -10)
    expect(r.in).toBe(0)
    expect(r.start).toBe(2) // applied delta is -1, not -10
    expect(r.out).toBe(6)
  })

  it("clamp to media: left edge cannot pass out - MIN_CLIP_SEC", () => {
    const r = clampTrim({ in: 0, out: 5, start: 0 }, 'start', 10)
    expect(r.in).toBeCloseTo(5 - MIN_CLIP_SEC, 9)
    expect(r.out).toBe(5)
    expect(r.out - r.in).toBeCloseTo(MIN_CLIP_SEC, 9)
  })

  it("right edge: only out moves; in/start untouched", () => {
    const r = clampTrim(base, 'end', 2)
    expect(r.out).toBe(8)
    expect(r.in).toBe(2)
    expect(r.start).toBe(5)
  })

  it("clamp to media: right edge cannot pull out below in + MIN_CLIP_SEC", () => {
    const r = clampTrim({ in: 1, out: 5, start: 2 }, 'end', -10)
    expect(r.out).toBeCloseTo(1 + MIN_CLIP_SEC, 9)
    expect(r.out - r.in).toBeCloseTo(MIN_CLIP_SEC, 9)
  })

  it("right edge extends freely when sourceDurationSec is undefined", () => {
    const r = clampTrim({ in: 0, out: 5, start: 0 }, 'end', 100)
    expect(r.out).toBe(105)
  })

  it("right edge clamps to sourceDurationSec when provided", () => {
    const r = clampTrim({ in: 0, out: 5, start: 0 }, 'end', 100, 8)
    expect(r.out).toBe(8)
  })

  it('MIN_CLIP_SEC is one frame at 30fps', () => {
    expect(MIN_CLIP_SEC).toBeCloseTo(1 / 30, 9)
  })
})

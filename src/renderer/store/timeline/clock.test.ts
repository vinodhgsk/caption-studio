import { describe, expect, it } from 'vitest'
import { advancePlayhead } from './clock'

describe('advancePlayhead (P3.8 clock math)', () => {
  it('advances by the elapsed delta when below the duration', () => {
    const { next, atEnd } = advancePlayhead(1, 0.5, 10)
    expect(next).toBeCloseTo(1.5, 10)
    expect(atEnd).toBe(false)
  })

  it('clamps to the duration and reports atEnd without overshoot', () => {
    const { next, atEnd } = advancePlayhead(9.8, 0.5, 10)
    expect(next).toBe(10)
    expect(atEnd).toBe(true)
  })

  it('reports atEnd when landing exactly on the duration', () => {
    const { next, atEnd } = advancePlayhead(9.5, 0.5, 10)
    expect(next).toBe(10)
    expect(atEnd).toBe(true)
  })

  it('treats a zero or negative delta as no movement', () => {
    expect(advancePlayhead(3, 0, 10)).toEqual({ next: 3, atEnd: false })
    expect(advancePlayhead(3, -1, 10)).toEqual({ next: 3, atEnd: false })
  })

  it('treats a non-finite delta as no movement', () => {
    expect(advancePlayhead(3, Number.NaN, 10)).toEqual({ next: 3, atEnd: false })
    expect(advancePlayhead(3, Number.POSITIVE_INFINITY, 10)).toEqual({ next: 3, atEnd: false })
  })

  it('reports atEnd and clamps when prev already sits at/past the duration', () => {
    // A no-movement tick at the very end still clamps to the duration and pauses.
    expect(advancePlayhead(10, 0, 10)).toEqual({ next: 10, atEnd: true })
    expect(advancePlayhead(12, 0, 10)).toEqual({ next: 10, atEnd: true })
  })

  it('a zero-duration timeline is immediately atEnd', () => {
    expect(advancePlayhead(0, 0.5, 0)).toEqual({ next: 0, atEnd: true })
  })

  it('a single advancing tick that overshoots is clamped exactly to the duration', () => {
    const { next, atEnd } = advancePlayhead(0, 999, 10)
    expect(next).toBe(10)
    expect(atEnd).toBe(true)
  })
})

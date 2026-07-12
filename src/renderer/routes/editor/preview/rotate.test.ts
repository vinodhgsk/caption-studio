import { describe, expect, it } from 'vitest'
import {
  angleFromCenterDeg,
  normalizeDeg,
  rotatePointInverse,
  snapRotationDeg
} from './rotate'

describe('normalizeDeg', () => {
  it('maps into [0, 360)', () => {
    expect(normalizeDeg(0)).toBe(0)
    expect(normalizeDeg(360)).toBe(0)
    expect(normalizeDeg(370)).toBe(10)
    expect(normalizeDeg(-10)).toBe(350)
    expect(normalizeDeg(-370)).toBe(350)
  })
})

describe('angleFromCenterDeg', () => {
  // Screen convention: +x right = 0, +y down = 90, -x left = 180, -y up = 270.
  it('returns 0 for a point directly to the right', () => {
    expect(angleFromCenterDeg(0, 0, 10, 0)).toBeCloseTo(0)
  })

  it('returns 90 for a point directly below (screen down)', () => {
    expect(angleFromCenterDeg(0, 0, 0, 10)).toBeCloseTo(90)
  })

  it('returns 180 for a point directly to the left', () => {
    expect(angleFromCenterDeg(0, 0, -10, 0)).toBeCloseTo(180)
  })

  it('returns 270 for a point directly above (screen up)', () => {
    expect(angleFromCenterDeg(0, 0, 0, -10)).toBeCloseTo(270)
  })

  it('is center-relative', () => {
    expect(angleFromCenterDeg(100, 100, 110, 100)).toBeCloseTo(0)
    expect(angleFromCenterDeg(100, 100, 100, 90)).toBeCloseTo(270)
  })
})

describe('snapRotationDeg', () => {
  it('snaps to the nearest step multiple', () => {
    expect(snapRotationDeg(7, 15)).toBe(0)
    expect(snapRotationDeg(8, 15)).toBe(15)
    expect(snapRotationDeg(44, 15)).toBe(45)
    expect(snapRotationDeg(38, 15)).toBe(45)
  })

  it('normalizes the snapped result into [0, 360)', () => {
    expect(snapRotationDeg(358, 15)).toBe(0) // 360 → 0
    expect(snapRotationDeg(-8, 15)).toBe(345) // -15 → 345
  })

  it('no-snap path (step <= 0) only normalizes', () => {
    expect(snapRotationDeg(370, 0)).toBe(10)
    expect(snapRotationDeg(-10, -1)).toBe(350)
  })
})

describe('rotatePointInverse', () => {
  it('is identity at 0 degrees', () => {
    const p = rotatePointInverse(5, 7, 0, 0, 0)
    expect(p.x).toBeCloseTo(5)
    expect(p.y).toBeCloseTo(7)
  })

  it('inverse-rotates a point by -deg about the center', () => {
    // A point at (10,0) relative to center, with the clip rotated 90deg
    // clockwise, maps back to (0,-10) in the clip-local frame.
    const p = rotatePointInverse(10, 0, 0, 0, 90)
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(-10)
  })
})

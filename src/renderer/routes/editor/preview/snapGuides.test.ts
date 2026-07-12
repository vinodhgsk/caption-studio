import { describe, expect, it } from 'vitest'
import { snapTransformXY } from './snapGuides'

const RES: [number, number] = [1920, 1080]
const SIZE: [number, number] = [640, 360]
const TH = 12

describe('snapTransformXY', () => {
  it('snaps to canvas center on both axes within threshold', () => {
    const r = snapTransformXY({ x: 6, y: -5 }, SIZE, RES, TH)
    expect(r.x).toBe(0)
    expect(r.y).toBe(0)
    expect(r.guides).toContain('cx')
    expect(r.guides).toContain('cy')
  })

  it('does NOT snap when outside the threshold', () => {
    const r = snapTransformXY({ x: 100, y: 100 }, SIZE, RES, TH)
    expect(r.x).toBe(100)
    expect(r.y).toBe(100)
    expect(r.guides).toHaveLength(0)
  })

  it('snaps each axis independently (x snaps to center, y free)', () => {
    const r = snapTransformXY({ x: 4, y: 200 }, SIZE, RES, TH)
    expect(r.x).toBe(0)
    expect(r.y).toBe(200)
    expect(r.guides).toEqual(['cx'])
  })

  it('snaps the center to the right edge (x = +resW/2)', () => {
    const r = snapTransformXY({ x: 1920 / 2 - 3, y: 999 }, SIZE, RES, TH)
    expect(r.x).toBe(960)
    expect(r.guides).toContain('right')
  })

  it('snaps the center to the top edge (y = -resH/2)', () => {
    const r = snapTransformXY({ x: 999, y: -1080 / 2 + 2 }, SIZE, RES, TH)
    expect(r.y).toBe(-540)
    expect(r.guides).toContain('top')
  })

  it('snaps to quarter lines', () => {
    const r = snapTransformXY({ x: -1920 / 4 + 1, y: 1080 / 4 - 1 }, SIZE, RES, TH)
    expect(r.x).toBe(-480)
    expect(r.y).toBe(270)
    expect(r.guides).toContain('qx-left')
    expect(r.guides).toContain('qy-bottom')
  })

  it('prefers the nearest target when two are within threshold', () => {
    // 5 from center (0), 955 from right edge (960): center wins.
    const r = snapTransformXY({ x: 5, y: 0 }, SIZE, RES, TH)
    expect(r.x).toBe(0)
    expect(r.guides).toContain('cx')
  })
})

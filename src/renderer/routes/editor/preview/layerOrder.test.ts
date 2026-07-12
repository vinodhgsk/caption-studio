import { describe, expect, it } from 'vitest'
import { bringForwardZ, bringToFrontZ, sendBackwardZ, sendToBackZ } from './layerOrder'

describe('bringForwardZ', () => {
  it('no-op when there are no peers', () => {
    expect(bringForwardZ(0, [])).toBe(0)
  })

  it('no-op when already on top (no peer above)', () => {
    expect(bringForwardZ(5, [1, 2, 3])).toBe(5)
  })

  it('steps just above the nearest peer above', () => {
    // peers above 2 are {4,7}; nearest is 4 → 5.
    expect(bringForwardZ(2, [0, 4, 7])).toBe(5)
  })

  it('moves a middle clip past the immediately-higher neighbour', () => {
    expect(bringForwardZ(1, [0, 1, 2])).toBe(3)
  })
})

describe('sendBackwardZ', () => {
  it('no-op when there are no peers', () => {
    expect(sendBackwardZ(0, [])).toBe(0)
  })

  it('no-op when already at back (no peer below)', () => {
    expect(sendBackwardZ(0, [1, 2, 3])).toBe(0)
  })

  it('steps just below the nearest peer below', () => {
    // peers below 7 are {0,4}; nearest is 4 → 3.
    expect(sendBackwardZ(7, [0, 4, 7])).toBe(3)
  })

  it('moves a middle clip below the immediately-lower neighbour', () => {
    expect(sendBackwardZ(1, [0, 1, 2])).toBe(-1)
  })
})

describe('bringToFrontZ', () => {
  it('returns 0 when there are no peers (single clip)', () => {
    expect(bringToFrontZ([])).toBe(0)
  })

  it('exceeds every peer', () => {
    expect(bringToFrontZ([0, 4, 7])).toBe(8)
  })
})

describe('sendToBackZ', () => {
  it('returns 0 when there are no peers (single clip)', () => {
    expect(sendToBackZ([])).toBe(0)
  })

  it('falls below every peer', () => {
    expect(sendToBackZ([0, 4, 7])).toBe(-1)
  })
})

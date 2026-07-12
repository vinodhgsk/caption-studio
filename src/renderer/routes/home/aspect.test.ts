import { describe, expect, it } from 'vitest'
import { resolutionForAspect } from './aspect'

describe('resolutionForAspect', () => {
  it('maps 16:9 to 1920x1080 (landscape)', () => {
    expect(resolutionForAspect('16:9')).toEqual([1920, 1080])
  })

  it('maps 9:16 to 1080x1920 (portrait)', () => {
    expect(resolutionForAspect('9:16')).toEqual([1080, 1920])
  })

  it('maps 1:1 to 1080x1080 (square)', () => {
    expect(resolutionForAspect('1:1')).toEqual([1080, 1080])
  })
})

import { describe, expect, it } from 'vitest'
import { aspectRatioStyle } from './stageAspect'

describe('aspectRatioStyle', () => {
  it('maps 16:9 to a landscape CSS aspect-ratio', () => {
    expect(aspectRatioStyle('16:9')).toBe('16 / 9')
  })

  it('maps 9:16 to a portrait CSS aspect-ratio', () => {
    expect(aspectRatioStyle('9:16')).toBe('9 / 16')
  })

  it('maps 1:1 to a square CSS aspect-ratio', () => {
    expect(aspectRatioStyle('1:1')).toBe('1 / 1')
  })
})

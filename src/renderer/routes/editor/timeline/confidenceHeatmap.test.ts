import { describe, it, expect } from 'vitest'
import { confidenceTier, tierColour, lowConfidenceFraction } from './confidenceHeatmap'

describe('confidenceTier', () => {
  it('returns high for values >= 0.8', () => {
    expect(confidenceTier(1.0)).toBe('high')
    expect(confidenceTier(0.8)).toBe('high')
    expect(confidenceTier(0.95)).toBe('high')
  })

  it('returns medium for values in [0.6, 0.8)', () => {
    expect(confidenceTier(0.6)).toBe('medium')
    expect(confidenceTier(0.79)).toBe('medium')
    expect(confidenceTier(0.65)).toBe('medium')
  })

  it('returns low for values below 0.6', () => {
    expect(confidenceTier(0.0)).toBe('low')
    expect(confidenceTier(0.59)).toBe('low')
    expect(confidenceTier(0.3)).toBe('low')
  })

  it('clamps values outside [0, 1]', () => {
    expect(confidenceTier(1.5)).toBe('high')
    expect(confidenceTier(-0.1)).toBe('low')
  })
})

describe('tierColour', () => {
  it('returns a non-empty class string for each tier', () => {
    expect(tierColour('high')).toMatch(/bg-/)
    expect(tierColour('medium')).toMatch(/bg-/)
    expect(tierColour('low')).toMatch(/bg-/)
  })

  it('returns different classes for different tiers', () => {
    const high = tierColour('high')
    const medium = tierColour('medium')
    const low = tierColour('low')
    expect(high).not.toBe(medium)
    expect(medium).not.toBe(low)
    expect(high).not.toBe(low)
  })
})

describe('lowConfidenceFraction', () => {
  it('returns 0 when there are no defined confidences', () => {
    expect(lowConfidenceFraction([])).toBe(0)
    expect(lowConfidenceFraction([undefined, undefined])).toBe(0)
  })

  it('returns 0 when all words are high-confidence', () => {
    expect(lowConfidenceFraction([0.9, 0.85, 1.0])).toBe(0)
  })

  it('returns 1 when all words are low-confidence', () => {
    expect(lowConfidenceFraction([0.1, 0.3, 0.59])).toBe(1)
  })

  it('returns the correct fraction with a mix', () => {
    // 1 low out of 4 = 0.25
    expect(lowConfidenceFraction([0.9, 0.3, 0.8, 0.7])).toBe(0.25)
  })

  it('ignores undefined entries in the fraction calculation', () => {
    // defined: [0.9, 0.3] → 1 low of 2 = 0.5
    expect(lowConfidenceFraction([undefined, 0.9, 0.3, undefined])).toBe(0.5)
  })
})

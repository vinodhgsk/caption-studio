import { describe, expect, it } from 'vitest'
import {
  SAFE_MARGINS,
  clampYToSafeArea,
  resolveCaptionY,
  resolveCaptionYForLayout,
  safeAreaPx,
  safeMarginsForAspect
} from './captionPosition'
import { resolutionForAspect, type Aspect } from '../renderer/routes/home/aspect'
import type { PresetLayout } from './captionPreset'

// A small caption block so the safe-area clamp rarely fires for the named
// anchors (their default offsets sit well inside every band at these sizes).
const SMALL_BLOCK = 80

const ASPECTS: Aspect[] = ['9:16', '16:9', '1:1']

describe('safe margins differ per aspect', () => {
  it('each aspect has its own spec', () => {
    expect(SAFE_MARGINS['9:16']).not.toEqual(SAFE_MARGINS['16:9'])
    expect(SAFE_MARGINS['16:9']).not.toEqual(SAFE_MARGINS['1:1'])
    expect(SAFE_MARGINS['9:16']).not.toEqual(SAFE_MARGINS['1:1'])
  })

  it('9:16 reserves more bottom room than 16:9 (platform UI rail)', () => {
    expect(safeMarginsForAspect('9:16').bottom).toBeGreaterThan(
      safeMarginsForAspect('16:9').bottom
    )
  })

  it('safeAreaPx scales top/bottom by height and left/right by width', () => {
    const spec = safeMarginsForAspect('16:9')
    const res: [number, number] = [1920, 1080]
    const px = safeAreaPx(spec, res)
    expect(px.top).toBeCloseTo(spec.top * 1080)
    expect(px.bottom).toBeCloseTo(1080 - spec.bottom * 1080)
    expect(px.left).toBeCloseTo(spec.left * 1920)
    expect(px.right).toBeCloseTo(1920 - spec.right * 1920)
  })
})

describe('resolveCaptionY — named anchors per aspect', () => {
  for (const aspect of ASPECTS) {
    const res = resolutionForAspect(aspect)
    const [, h] = res

    it(`center → 0 offset (${aspect})`, () => {
      const y = resolveCaptionY({ anchor: 'center', aspect, resolution: res, blockHeight: SMALL_BLOCK })
      expect(y).toBe(0)
    })

    it(`lower-third sits below center, top sits above (${aspect})`, () => {
      const lower = resolveCaptionY({ anchor: 'lower-third', aspect, resolution: res, blockHeight: SMALL_BLOCK })
      const top = resolveCaptionY({ anchor: 'top', aspect, resolution: res, blockHeight: SMALL_BLOCK })
      expect(lower).toBeGreaterThan(0)
      expect(top).toBeLessThan(0)
    })

    it(`lower-third equals the +0.35 fraction of height when inside the safe band (${aspect})`, () => {
      const y = resolveCaptionY({ anchor: 'lower-third', aspect, resolution: res, blockHeight: SMALL_BLOCK })
      // 0.35 * h is the raw anchor offset; verify it is not clamped away here.
      const safe = safeAreaPx(safeMarginsForAspect(aspect), res)
      const maxY = safe.bottom - SMALL_BLOCK / 2 - h / 2
      const raw = 0.35 * h
      if (raw <= maxY) expect(y).toBeCloseTo(raw)
      else expect(y).toBeCloseTo(maxY)
    })
  }
})

describe('resolveCaptionY — symmetric vs asymmetric clamp', () => {
  it('1:1 (symmetric margins) → lower-third and top are mirror offsets', () => {
    const res = resolutionForAspect('1:1')
    const lower = resolveCaptionY({ anchor: 'lower-third', aspect: '1:1', resolution: res, blockHeight: SMALL_BLOCK })
    const top = resolveCaptionY({ anchor: 'top', aspect: '1:1', resolution: res, blockHeight: SMALL_BLOCK })
    expect(lower).toBeCloseTo(-top)
  })

  it('9:16 lower-third is clamped by the larger bottom margin (asymmetric)', () => {
    const aspect: Aspect = '9:16'
    const res = resolutionForAspect(aspect)
    const [, h] = res
    const safe = safeAreaPx(safeMarginsForAspect(aspect), res)
    const maxY = safe.bottom - SMALL_BLOCK / 2 - h / 2
    const lower = resolveCaptionY({ anchor: 'lower-third', aspect, resolution: res, blockHeight: SMALL_BLOCK })
    // 0.35*1920 = 672 exceeds the bottom-clamped max → pinned to maxY.
    expect(lower).toBeCloseTo(maxY)
    expect(lower).toBeLessThan(0.35 * h)
  })
})

describe('resolveCaptionY — custom', () => {
  it('uses the explicit customY (px) when inside the safe band', () => {
    const res = resolutionForAspect('9:16')
    const y = resolveCaptionY({ anchor: 'custom', aspect: '9:16', resolution: res, blockHeight: SMALL_BLOCK, customY: 100 })
    expect(y).toBe(100)
  })

  it('clamps a custom y BELOW the bottom safe margin back into the band', () => {
    const aspect: Aspect = '9:16'
    const res = resolutionForAspect(aspect)
    const [, h] = res
    const safe = safeAreaPx(safeMarginsForAspect(aspect), res)
    const maxY = safe.bottom - SMALL_BLOCK / 2 - h / 2
    // Ask for a y far past the bottom safe edge.
    const y = resolveCaptionY({ anchor: 'custom', aspect, resolution: res, blockHeight: SMALL_BLOCK, customY: h })
    expect(y).toBeCloseTo(maxY)
    // The block's bottom edge must equal exactly the bottom safe line.
    expect(h / 2 + y + SMALL_BLOCK / 2).toBeCloseTo(safe.bottom)
  })

  it('clamps a custom y ABOVE the top safe margin back into the band', () => {
    const aspect: Aspect = '16:9'
    const res = resolutionForAspect(aspect)
    const [, h] = res
    const safe = safeAreaPx(safeMarginsForAspect(aspect), res)
    const minY = safe.top + SMALL_BLOCK / 2 - h / 2
    const y = resolveCaptionY({ anchor: 'custom', aspect, resolution: res, blockHeight: SMALL_BLOCK, customY: -h })
    expect(y).toBeCloseTo(minY)
    expect(h / 2 + y - SMALL_BLOCK / 2).toBeCloseTo(safe.top)
  })

  it('falls back to the normalized custom layout.y (×height) when no px override', () => {
    const aspect: Aspect = '1:1'
    const res = resolutionForAspect(aspect)
    const [, h] = res
    // custom with layout.y absent → resolveLayoutY('custom') = 0 → 0 px.
    const y = resolveCaptionY({ anchor: 'custom', aspect, resolution: res, blockHeight: SMALL_BLOCK })
    expect(y).toBe(0)
    void h
  })
})

describe('resolveCaptionY — safeMargin opt-out', () => {
  it('does NOT clamp when safeMargin is false', () => {
    const aspect: Aspect = '9:16'
    const res = resolutionForAspect(aspect)
    const [, h] = res
    const y = resolveCaptionY({
      anchor: 'custom',
      aspect,
      resolution: res,
      blockHeight: SMALL_BLOCK,
      customY: h, // way past the safe band
      safeMargin: false
    })
    expect(y).toBe(h)
  })
})

describe('clampYToSafeArea — degenerate', () => {
  it('returns the band center offset when the block is taller than the band', () => {
    const res: [number, number] = [1080, 1920]
    const safe = safeAreaPx(safeMarginsForAspect('9:16'), res)
    const tallBlock = 5000 // taller than any band
    const y = clampYToSafeArea(0, res, safe, tallBlock)
    expect(y).toBeCloseTo((safe.top + safe.bottom) / 2 - res[1] / 2)
  })
})

describe('resolveCaptionYForLayout', () => {
  it('honors the layout anchor + safeMargin flag', () => {
    const aspect: Aspect = '16:9'
    const res = resolutionForAspect(aspect)
    const layout: PresetLayout = { anchor: 'center', safeMargin: true, maxLines: 2 }
    const y = resolveCaptionYForLayout(layout, aspect, res, SMALL_BLOCK)
    expect(y).toBe(0)
  })

  it('a custom layout with safeMargin:false passes the override through unclamped', () => {
    const aspect: Aspect = '1:1'
    const res = resolutionForAspect(aspect)
    const [, h] = res
    const layout: PresetLayout = { anchor: 'custom', safeMargin: false, maxLines: 1 }
    const y = resolveCaptionYForLayout(layout, aspect, res, SMALL_BLOCK, h)
    expect(y).toBe(h)
  })
})

import { describe, expect, it } from 'vitest'
import type { Clip } from '../../../../shared/project-schema'
import type { ProjectTrack } from '../../../../shared/storage'
import type { DrawItem } from './compositor'
import { drawTextClips } from './PreviewCanvas'

function makeTextClip(id: string, lines: string[]): Clip {
  return {
    id,
    mediaRef: 'media/text.txt',
    in: 0,
    out: 5,
    start: 0,
    transform: {
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      flipH: false,
      flipV: false,
      opacity: 1,
      z: 0
    },
    text: {
      lines,
      align: 'center'
    }
  }
}

function makeCtx(): CanvasRenderingContext2D {
  return {
    font: '',
    fillStyle: '#fff',
    textAlign: 'center',
    textBaseline: 'middle',
    globalAlpha: 1,
    measureText: (s: string) => ({ width: s.length * 12 } as TextMetrics),
    save() { },
    restore() { },
    translate() { },
    rotate() { },
    scale() { },
    fillText() { },
    strokeText() { },
    beginPath() { },
    moveTo() { },
    arcTo() { },
    closePath() { },
    fill() { },
    createLinearGradient() {
      return { addColorStop() { } } as CanvasGradient
    }
  } as unknown as CanvasRenderingContext2D
}

function makeRecordingCtx(): {
  ctx: CanvasRenderingContext2D
  fillAlphas: number[]
} {
  const fillAlphas: number[] = []
  const state = { globalAlpha: 1 }
  const ctx = {
    font: '',
    fillStyle: '#fff',
    textAlign: 'center',
    textBaseline: 'middle',
    get globalAlpha() {
      return state.globalAlpha
    },
    set globalAlpha(value: number) {
      state.globalAlpha = value
    },
    measureText: (s: string) => ({ width: s.length * 12 } as TextMetrics),
    save() { },
    restore() { },
    translate() { },
    rotate() { },
    scale() { },
    fillText() {
      fillAlphas.push(state.globalAlpha)
    },
    strokeText() { },
    beginPath() { },
    moveTo() { },
    arcTo() { },
    closePath() { },
    fill() { },
    createLinearGradient() {
      return { addColorStop() { } } as CanvasGradient
    }
  } as unknown as CanvasRenderingContext2D
  return { ctx, fillAlphas }
}

describe('drawTextClips edit-mode skip behavior', () => {
  it('still reports intrinsic size for skipClipId while suppressing paint', () => {
    const clip = makeTextClip('text-1', ['visible in edit'])
    const track: ProjectTrack = { id: 't1', type: 'text', clips: [clip] }
    const items: DrawItem[] = [{ clip, track, trackIndex: 0 }]
    const sizes = new Map<string, { width: number; height: number }>()

    let paintCalled = 0
    const ctx = makeCtx()
    ctx.save = () => {
      paintCalled += 1
    }

    drawTextClips(
      ctx,
      1920,
      1080,
      items,
      null,
      sizes,
      0,
      undefined,
      'text-1'
    )

    const size = sizes.get('text-1')
    expect(size).toBeDefined()
    expect(size?.width).toBeGreaterThan(0)
    expect(size?.height).toBeGreaterThan(0)
    expect(paintCalled).toBe(0)
  })

  it('uses timeline end for out-animation timing when clip starts later', () => {
    const clip = makeTextClip('text-anim', ['fade check'])
    clip.start = 10
    clip.in = 0
    clip.out = 3
    clip.animation = {
      out: {
        preset: 'fade',
        durationSec: 1,
        easing: 'linear'
      }
    }

    const track: ProjectTrack = { id: 't1', type: 'text', clips: [clip] }
    const items: DrawItem[] = [{ clip, track, trackIndex: 0 }]
    const sizes = new Map<string, { width: number; height: number }>()
    const { ctx, fillAlphas } = makeRecordingCtx()

    // t=10.5 is early in the clip's life. Out fade should not have started yet
    // because timeline end is start + (out - in) = 13 (out-window 12..13).
    drawTextClips(ctx, 1920, 1080, items, null, sizes, 10.5)

    expect(fillAlphas.length).toBeGreaterThan(0)
    expect(fillAlphas.some((a) => a > 0.99)).toBe(true)
  })
})

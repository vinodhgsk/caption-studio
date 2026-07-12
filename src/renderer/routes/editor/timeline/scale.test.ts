import { describe, expect, it } from 'vitest'
import type { Clip } from '../../../../shared/project-schema'
import { defaultTransform } from '../../../../shared/project-schema'
import type { ProjectTrack } from '../../../../shared/storage'
import {
  exactProjectDurationSec,
  autoViewModeLabel,
  chooseTickIntervalSec,
  clampZoom,
  clipEndSec,
  defaultVisibleWindowSec,
  formatTickLabel,
  generateTicks,
  pointerToTime,
  projectDurationSec,
  pxToTime,
  timelineRenderDurationSec,
  timeToPx,
  visibleWindow,
  zoomToFitPxPerSec,
  ZOOM_MAX_PX_PER_SEC,
  ZOOM_MIN_PX_PER_SEC
} from './scale'

function clip(partial: Partial<Clip>): Clip {
  return {
    id: 'c',
    mediaRef: 'media/x.mp4',
    in: 0,
    out: 1,
    start: 0,
    transform: defaultTransform(),
    ...partial
  }
}

describe('timeToPx / pxToTime', () => {
  it('round-trips a time through px and back at several zooms', () => {
    for (const pxPerSec of [10, 50, 100, 400]) {
      for (const t of [0, 0.5, 1.25, 12.75, 90]) {
        expect(pxToTime(timeToPx(t, pxPerSec), pxPerSec)).toBeCloseTo(t)
      }
    }
  })

  it('maps seconds to pixels linearly at the given scale', () => {
    expect(timeToPx(2, 100)).toBe(200)
    expect(timeToPx(0.5, 80)).toBe(40)
  })

  it('pxToTime is safe at zero scale', () => {
    expect(pxToTime(123, 0)).toBe(0)
  })
})

describe('projectDurationSec', () => {
  it('returns the exact max clip end without a floor', () => {
    const tracks: ProjectTrack[] = [
      { id: 't1', type: 'video', clips: [clip({ start: 2, in: 0, out: 3 })] },
      { id: 't2', type: 'audio', clips: [clip({ start: 10, in: 1, out: 4 })] }
    ]
    expect(exactProjectDurationSec(tracks)).toBe(13)
  })

  it('floors at the minimum for an empty project', () => {
    expect(projectDurationSec([], 10)).toBe(10)
  })

  it('returns the max clip end across tracks (start + out - in)', () => {
    const tracks: ProjectTrack[] = [
      { id: 't1', type: 'video', clips: [clip({ start: 2, in: 0, out: 3 })] }, // ends 5
      { id: 't2', type: 'audio', clips: [clip({ start: 10, in: 1, out: 4 })] } // ends 13
    ]
    expect(projectDurationSec(tracks, 10)).toBe(13)
  })

  it('clipEndSec uses out - in trim length', () => {
    expect(clipEndSec(clip({ start: 4, in: 1, out: 6 }))).toBe(9)
  })

  it('uses the exact media duration for timeline rendering once clips exist', () => {
    expect(timelineRenderDurationSec([])).toBe(10)
    expect(timelineRenderDurationSec([{ id: 't1', type: 'video', clips: [clip({ out: 5 })] }])).toBe(5)
  })
})

describe('zoomToFitPxPerSec', () => {
  it('fits the whole duration into the viewport width', () => {
    // 20s into 1000px → 50 px/s (within the [10, 400] range).
    expect(zoomToFitPxPerSec(20, 1000)).toBe(50)
  })

  it('clamps to the max zoom for short durations', () => {
    // 1s into 1000px would be 1000 px/s → clamped to the max.
    expect(zoomToFitPxPerSec(1, 1000)).toBe(ZOOM_MAX_PX_PER_SEC)
  })

  it('clamps to the min zoom for long durations', () => {
    // 1000s into 100px would be 0.1 px/s → clamped to the min.
    expect(zoomToFitPxPerSec(1000, 100)).toBe(ZOOM_MIN_PX_PER_SEC)
  })

  it('guards zero/negative duration and viewport with the min zoom', () => {
    expect(zoomToFitPxPerSec(0, 1000)).toBe(ZOOM_MIN_PX_PER_SEC)
    expect(zoomToFitPxPerSec(-5, 1000)).toBe(ZOOM_MIN_PX_PER_SEC)
    expect(zoomToFitPxPerSec(20, 0)).toBe(ZOOM_MIN_PX_PER_SEC)
    expect(zoomToFitPxPerSec(20, -10)).toBe(ZOOM_MIN_PX_PER_SEC)
  })
})

describe('defaultVisibleWindowSec / autoViewModeLabel', () => {
  it('keeps the old helper behavior for callers that still want a capped default window', () => {
    expect(defaultVisibleWindowSec(500, 360)).toBe(360)
  })

  it('labels any non-empty timeline as fit media', () => {
    expect(autoViewModeLabel(500, '6m')).toBe('Fit media')
  })

  it('labels shorter media as fit media too', () => {
    expect(defaultVisibleWindowSec(120, 360)).toBe(120)
    expect(autoViewModeLabel(120, '6m')).toBe('Fit media')
  })

  it('handles non-positive defaults defensively', () => {
    expect(defaultVisibleWindowSec(120, 0)).toBe(0)
    expect(defaultVisibleWindowSec(120, -10)).toBe(0)
  })
})

describe('chooseTickIntervalSec', () => {
  it('picks a coarser interval when zoomed out and a finer one when zoomed in', () => {
    const coarse = chooseTickIntervalSec(10, 30)
    const fine = chooseTickIntervalSec(400, 30)
    expect(coarse).toBeGreaterThanOrEqual(fine)
  })

  it('never goes finer than one frame at the project fps', () => {
    const interval = chooseTickIntervalSec(ZOOM_MAX_PX_PER_SEC, 30)
    expect(interval).toBeGreaterThanOrEqual(1 / 30 - 1e-9)
  })
})

describe('generateTicks', () => {
  it('produces ticks from 0 through the duration with every 5th major', () => {
    // pxPerSec 100 => 1s minor interval, so 30s yields ticks at 0..30.
    const ticks = generateTicks(30, 100, 30)
    expect(ticks[0]).toEqual({ t: 0, px: 0, major: true })
    expect(ticks[ticks.length - 1].t).toBeLessThanOrEqual(30 + 1e-9)
    // First major-after-zero is the 5th tick.
    const majors = ticks.filter((tick) => tick.major)
    expect(majors.length).toBeGreaterThanOrEqual(2)
    expect(majors[1].t).toBeCloseTo(ticks[5].t)
  })

  it('px offsets follow timeToPx at the active zoom', () => {
    const pxPerSec = 50
    const ticks = generateTicks(20, pxPerSec, 30)
    for (const tick of ticks) {
      expect(tick.px).toBeCloseTo(timeToPx(tick.t, pxPerSec))
    }
  })

  it('degenerates to a single origin tick for zero duration', () => {
    expect(generateTicks(0, 100, 30)).toEqual([{ t: 0, px: 0, major: true }])
  })
})

describe('formatTickLabel', () => {
  it('formats minutes as m:ss', () => {
    expect(formatTickLabel(65)).toBe('1:05')
    expect(formatTickLabel(120)).toBe('2:00')
  })

  it('formats whole sub-minute seconds without a decimal', () => {
    expect(formatTickLabel(5)).toBe('5s')
  })

  it('formats fractional sub-minute seconds with one decimal', () => {
    expect(formatTickLabel(0.5)).toBe('0.5s')
  })
})

describe('visibleWindow', () => {
  it('maps a scroll viewport to an inclusive time window', () => {
    const win = visibleWindow(200, 400, 100)
    expect(win.startSec).toBeCloseTo(2)
    expect(win.endSec).toBeCloseTo(6)
  })
})

describe('pointerToTime (P3.8 scrub mapping)', () => {
  it('maps clientX relative to the container rect into seconds', () => {
    // pointer at x=350, container left at 50 → local 300px @100px/s → 3s.
    expect(pointerToTime(350, 50, 0, 100)).toBeCloseTo(3)
  })

  it('accounts for the scroll container scrollLeft', () => {
    // local content x = (350 - 50) + 200 = 500px @100px/s → 5s.
    expect(pointerToTime(350, 50, 200, 100)).toBeCloseTo(5)
  })

  it('floors at 0 when the pointer is left of the content', () => {
    expect(pointerToTime(10, 50, 0, 100)).toBe(0)
  })
})

describe('clampZoom', () => {
  it('clamps below min and above max', () => {
    expect(clampZoom(1)).toBe(ZOOM_MIN_PX_PER_SEC)
    expect(clampZoom(99999)).toBe(ZOOM_MAX_PX_PER_SEC)
    expect(clampZoom(120)).toBe(120)
  })
})

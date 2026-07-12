import { describe, expect, it } from 'vitest'
import { planCaptionOverlay } from './captionOverlayPlan'
import { CAPTION_TRACK_ID } from '../../store/timeline/captionTrack'
import type { Project } from '../../../shared/storage'

/** Minimal project with a Caption track holding the given [start, dur] clips. */
function projectWithCaptions(clips: { start: number; dur: number }[]): Project {
  return {
    version: 1,
    id: 'p1',
    name: 'P',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    settings: {
      fps: 30,
      resolution: [1080, 1920],
      aspect: '9:16',
      background: '#000000',
      language: 'ta',
      languages: ['ta']
    },
    storage: { location: 'local', root: '/tmp/p' },
    tracks: [
      {
        id: CAPTION_TRACK_ID,
        type: 'text',
        clips: clips.map((c, i) => ({
          id: `cap-${i}`,
          mediaRef: '',
          in: 0,
          out: c.dur,
          start: c.start,
          transform: {
            x: 0, y: 0.35, scale: 1, rotation: 0, flipH: false, flipV: false, opacity: 1, z: 0
          },
          text: { lines: ['வணக்கம்'], align: 'center' },
          caption: { words: [] }
        }))
      }
    ]
  } as unknown as Project
}

describe('planCaptionOverlay', () => {
  it('returns null when there is no Caption track', () => {
    const p = projectWithCaptions([])
    p.tracks = []
    expect(planCaptionOverlay(p, 30)).toBeNull()
  })

  it('returns null for an empty Caption track', () => {
    expect(planCaptionOverlay(projectWithCaptions([]), 30)).toBeNull()
  })

  it('returns null for a non-positive fps', () => {
    expect(planCaptionOverlay(projectWithCaptions([{ start: 0, dur: 2 }]), 0)).toBeNull()
  })

  it('spans all clips, aligns frame 0 to the frame grid, sizes to the PROJECT canvas', () => {
    // Clips at [1.0,2.0) and [3.5,5.0); overall span [1.0, 5.0). Project res 1080×1920.
    const plan = planCaptionOverlay(
      projectWithCaptions([
        { start: 1.0, dur: 1.0 },
        { start: 3.5, dur: 1.5 }
      ]),
      30
    )
    expect(plan).not.toBeNull()
    expect(plan!.startSec).toBeCloseTo(1.0, 6) // floor(1.0*30)/30
    expect(plan!.fps).toBe(30)
    // endFrame ceil(5.0*30)=150; startFrame floor(1.0*30)=30 → 120 frames.
    expect(plan!.frameCount).toBe(120)
    // Rendered at the PROJECT resolution (matches the preview), NOT the export size.
    expect(plan!.width).toBe(1080)
    expect(plan!.height).toBe(1920)
  })

  it('aligns a fractional start DOWN to the previous frame boundary', () => {
    // start 1.04s @ 30fps → floor(31.2)=31 → 31/30 = 1.0333…
    const plan = planCaptionOverlay(projectWithCaptions([{ start: 1.04, dur: 1.0 }]), 30)!
    expect(plan.startSec).toBeCloseTo(31 / 30, 6)
  })

  it('returns null when the project resolution is invalid', () => {
    const p = projectWithCaptions([{ start: 0, dur: 2 }])
    ;(p.settings as { resolution: unknown }).resolution = [0, 0]
    expect(planCaptionOverlay(p, 30)).toBeNull()
  })
})

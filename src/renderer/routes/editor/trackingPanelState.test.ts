import { describe, expect, it } from 'vitest'
import type { Project } from '../../../shared/storage'
import type { ClipTracking } from '../../../shared/project-schema'
import {
  ANCHOR_NUDGE_PX,
  SMOOTHING_MAX,
  TRACK_TARGET_KIND_OPTIONS,
  clampSmoothing,
  clampTargetBox,
  defaultTargetBox,
  deriveTrackingLane,
  nudgeAnchor,
  videoSourceOptions
} from './trackingPanelState'

describe('clampSmoothing', () => {
  it('clamps into [0, SMOOTHING_MAX] and maps NaN to 0', () => {
    expect(clampSmoothing(-1)).toBe(0)
    expect(clampSmoothing(0.4)).toBe(0.4)
    expect(clampSmoothing(5)).toBe(SMOOTHING_MAX)
    expect(clampSmoothing(Number.NaN)).toBe(0)
  })
})

describe('deriveTrackingLane', () => {
  it('returns neutral defaults when there is no tracking', () => {
    const lane = deriveTrackingLane(undefined)
    expect(lane).toEqual({
      hasTracking: false,
      enabled: false,
      smoothing: 0,
      anchor: { dx: 0, dy: 0 },
      kind: 'face',
      sampleCount: 0
    })
  })

  it('projects a tracked attachment and clamps its smoothing', () => {
    const tracking: ClipTracking = {
      enabled: true,
      target: 'object',
      smoothing: 2, // out of range → clamped
      anchor: { dx: 12, dy: -4 },
      fps: 30,
      path: [
        { t: 0, x: 10, y: 10 },
        { t: 0.5, x: 12, y: 14 }
      ]
    }
    const lane = deriveTrackingLane(tracking)
    expect(lane.hasTracking).toBe(true)
    expect(lane.enabled).toBe(true)
    expect(lane.smoothing).toBe(SMOOTHING_MAX)
    expect(lane.anchor).toEqual({ dx: 12, dy: -4 })
    expect(lane.kind).toBe('object')
    expect(lane.sampleCount).toBe(2)
  })

  it('falls back to the target-box kind when no top-level target kind is set', () => {
    const tracking: ClipTracking = {
      enabled: false,
      targetBox: { x: 0, y: 0, width: 10, height: 10, kind: 'object' }
    }
    expect(deriveTrackingLane(tracking).kind).toBe('object')
  })

  it('treats an empty path as untracked', () => {
    expect(deriveTrackingLane({ enabled: true, path: [] }).hasTracking).toBe(false)
  })
})

describe('defaultTargetBox', () => {
  it('centers the box on the canvas at ~30% of the resolution', () => {
    const box = defaultTargetBox([1920, 1080], 'face')
    expect(box.x).toBe(960)
    expect(box.y).toBe(540)
    expect(box.width).toBe(576)
    expect(box.height).toBe(324)
    expect(box.kind).toBe('face')
  })

  it('keeps a minimum 16px size on tiny canvases', () => {
    const box = defaultTargetBox([10, 10], 'object')
    expect(box.width).toBe(16)
    expect(box.height).toBe(16)
  })
})

describe('clampTargetBox', () => {
  it('keeps the center within the canvas and enforces a minimum size', () => {
    const box = clampTargetBox(
      { x: -50, y: 5000, width: 4, height: 9000, kind: 'face' },
      [1920, 1080]
    )
    expect(box.x).toBe(0)
    expect(box.y).toBe(1080)
    expect(box.width).toBe(16)
    expect(box.height).toBe(1080)
    expect(box.kind).toBe('face')
  })

  it('leaves an in-bounds box unchanged', () => {
    const input = { x: 100, y: 200, width: 300, height: 200, kind: 'object' as const }
    expect(clampTargetBox(input, [1920, 1080])).toEqual(input)
  })
})

describe('nudgeAnchor', () => {
  it('adds the delta to the anchor offset', () => {
    expect(nudgeAnchor({ dx: 0, dy: 0 }, ANCHOR_NUDGE_PX, -ANCHOR_NUDGE_PX)).toEqual({
      dx: ANCHOR_NUDGE_PX,
      dy: -ANCHOR_NUDGE_PX
    })
    expect(nudgeAnchor({ dx: 5, dy: 5 }, -2, 3)).toEqual({ dx: 3, dy: 8 })
  })
})

describe('videoSourceOptions', () => {
  it('lists distinct video mediaRefs in order, ignoring non-video tracks and text clips', () => {
    const project = {
      tracks: [
        {
          id: 't-text',
          type: 'text',
          clips: [{ id: 'tx', mediaRef: '', in: 0, out: 1, start: 0, transform: {} }]
        },
        {
          id: 't-vid',
          type: 'video',
          clips: [
            { id: 'a', mediaRef: 'media/a.mp4', in: 0, out: 1, start: 0, transform: {} },
            { id: 'b', mediaRef: 'media/a.mp4', in: 0, out: 1, start: 1, transform: {} },
            { id: 'c', mediaRef: 'media/sub/b.mov', in: 0, out: 1, start: 2, transform: {} }
          ]
        }
      ]
    } as unknown as Project

    expect(videoSourceOptions(project)).toEqual([
      { ref: 'media/a.mp4', label: 'a.mp4' },
      { ref: 'media/sub/b.mov', label: 'b.mov' }
    ])
  })

  it('returns an empty list when there are no video clips', () => {
    const project = { tracks: [] } as unknown as Project
    expect(videoSourceOptions(project)).toEqual([])
  })
})

describe('TRACK_TARGET_KIND_OPTIONS', () => {
  it('offers face and object', () => {
    expect(TRACK_TARGET_KIND_OPTIONS.map((o) => o.id)).toEqual(['face', 'object'])
  })
})

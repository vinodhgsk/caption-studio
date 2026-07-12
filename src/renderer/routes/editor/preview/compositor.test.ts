import { describe, expect, it } from 'vitest'
import type { Clip, ClipTransform } from '../../../../shared/project-schema'
import { defaultTransform } from '../../../../shared/project-schema'
import type { ProjectTrack } from '../../../../shared/storage'
import {
  clipBoundsAt,
  clipCenter,
  clipSourceTime,
  computeDrawRect,
  computeDrawTransform,
  hitTestClip,
  letterboxFit,
  pointInBounds,
  pointInRotatedBounds,
  rotatedClipCorners,
  visibleClipsAt
} from './compositor'

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

function transform(partial: Partial<ClipTransform>): ClipTransform {
  return { ...defaultTransform(), ...partial }
}

describe('visibleClipsAt', () => {
  it('includes a clip exactly at its start (inclusive)', () => {
    const tracks: ProjectTrack[] = [
      { id: 't', type: 'video', clips: [clip({ start: 2, in: 0, out: 3 })] } // [2,5)
    ]
    expect(visibleClipsAt(tracks, 2)).toHaveLength(1)
  })

  it('excludes a clip exactly at its end (exclusive)', () => {
    const tracks: ProjectTrack[] = [
      { id: 't', type: 'video', clips: [clip({ start: 2, in: 0, out: 3 })] } // [2,5)
    ]
    expect(visibleClipsAt(tracks, 5)).toHaveLength(0)
  })

  it('uses out - in as the duration', () => {
    const tracks: ProjectTrack[] = [
      { id: 't', type: 'video', clips: [clip({ start: 0, in: 2, out: 5 })] } // dur 3 → [0,3)
    ]
    expect(visibleClipsAt(tracks, 2.9)).toHaveLength(1)
    expect(visibleClipsAt(tracks, 3)).toHaveLength(0)
  })

  it('excludes audio tracks (never drawn)', () => {
    const tracks: ProjectTrack[] = [
      { id: 'a', type: 'audio', clips: [clip({ start: 0, in: 0, out: 5 })] }
    ]
    expect(visibleClipsAt(tracks, 1)).toHaveLength(0)
  })

  it('orders by track index first, then by transform.z', () => {
    const tracks: ProjectTrack[] = [
      {
        id: 't1',
        type: 'video',
        clips: [clip({ id: 'a', start: 0, in: 0, out: 5, transform: transform({ z: 9 }) })]
      },
      {
        id: 't2',
        type: 'video',
        clips: [
          clip({ id: 'b', start: 0, in: 0, out: 5, transform: transform({ z: 1 }) }),
          clip({ id: 'c', start: 0, in: 0, out: 5, transform: transform({ z: 5 }) })
        ]
      }
    ]
    // Track 0 first (even though its z is higher), then track 1 by z ascending.
    expect(visibleClipsAt(tracks, 1).map((i) => i.clip.id)).toEqual(['a', 'b', 'c'])
  })

  it('reorders same-track clips when transform.z changes (P3.13 layer order)', () => {
    // Two overlapping same-track clips: 'low' (z=0) starts behind 'high' (z=1).
    const before: ProjectTrack[] = [
      {
        id: 't',
        type: 'video',
        clips: [
          clip({ id: 'low', start: 0, in: 0, out: 5, transform: transform({ z: 0 }) }),
          clip({ id: 'high', start: 0, in: 0, out: 5, transform: transform({ z: 1 }) })
        ]
      }
    ]
    // Drawn back-to-front; LAST is on top.
    expect(visibleClipsAt(before, 1).map((i) => i.clip.id)).toEqual(['low', 'high'])

    // Raise 'low' above 'high' (z=2) → it now draws last (on top).
    const after: ProjectTrack[] = [
      {
        id: 't',
        type: 'video',
        clips: [
          clip({ id: 'low', start: 0, in: 0, out: 5, transform: transform({ z: 2 }) }),
          clip({ id: 'high', start: 0, in: 0, out: 5, transform: transform({ z: 1 }) })
        ]
      }
    ]
    const items = visibleClipsAt(after, 1)
    expect(items.map((i) => i.clip.id)).toEqual(['high', 'low'])

    // hitTestClip picks the topmost (last-drawn) overlapping clip → 'low' now wins.
    const res: readonly [number, number] = [1920, 1080]
    const sizes = new Map([
      ['low', { width: 200, height: 200 }],
      ['high', { width: 200, height: 200 }]
    ])
    expect(hitTestClip(items, sizes, 960, 540, res)).toBe('low')
  })
})

describe('clipSourceTime', () => {
  it('maps a playhead time to the source offset clip.in + (t - start)', () => {
    expect(clipSourceTime(clip({ in: 2, start: 10 }), 13)).toBe(5)
  })

  it('equals clip.in at the clip start', () => {
    expect(clipSourceTime(clip({ in: 1.5, start: 4 }), 4)).toBe(1.5)
  })
})

describe('computeDrawTransform', () => {
  const res: [number, number] = [1920, 1080]

  it('translates to the canvas center plus transform x/y', () => {
    const dt = computeDrawTransform(transform({ x: 100, y: -50 }), res)
    expect(dt.translateX).toBe(960 + 100)
    expect(dt.translateY).toBe(540 - 50)
  })

  it('converts rotation degrees to radians', () => {
    const dt = computeDrawTransform(transform({ rotation: 90 }), res)
    expect(dt.rotation).toBeCloseTo(Math.PI / 2)
  })

  it('encodes flipH/flipV as negative axis scale', () => {
    const dt = computeDrawTransform(transform({ scale: 2, flipH: true, flipV: true }), res)
    expect(dt.scaleX).toBe(-2)
    expect(dt.scaleY).toBe(-2)
  })

  it('passes opacity through as alpha, clamped to [0,1]', () => {
    expect(computeDrawTransform(transform({ opacity: 0.4 }), res).alpha).toBe(0.4)
    expect(computeDrawTransform(transform({ opacity: 2 }), res).alpha).toBe(1)
    expect(computeDrawTransform(transform({ opacity: -1 }), res).alpha).toBe(0)
  })
})

describe('computeDrawRect', () => {
  it('centers the source on the origin (no canvas dims = native size)', () => {
    expect(computeDrawRect(200, 100)).toEqual({ x: -100, y: -50, width: 200, height: 100 })
  })

  it('scales source to contain within canvas (landscape in portrait)', () => {
    // 1920x1080 image in 1080x1920 canvas → fitScale = min(1080/1920, 1920/1080) = 0.5625
    const rect = computeDrawRect(1920, 1080, 1080, 1920)
    expect(rect.width).toBe(1080)
    expect(rect.height).toBeCloseTo(607.5)
    expect(rect.x).toBe(-540)
    expect(rect.y).toBeCloseTo(-303.75)
  })

  it('scales small image to fit canvas', () => {
    // 8x8 image in 1080x1920 canvas → fitScale = min(1080/8, 1920/8) = 135
    const rect = computeDrawRect(8, 8, 1080, 1920)
    expect(rect.width).toBe(1080)
    expect(rect.height).toBe(1080)
    expect(rect.x).toBe(-540)
    expect(rect.y).toBe(-540)
  })
})

describe('letterboxFit', () => {
  it('fits a 16:9 surface into a wide viewport with horizontal bars', () => {
    const fit = letterboxFit(1920, 1080, 1920, 1200)
    expect(fit.width).toBe(1920)
    expect(fit.height).toBe(1080)
    expect(fit.offsetX).toBe(0)
    expect(fit.offsetY).toBe(60)
  })

  it('fits into a narrow viewport with vertical bars', () => {
    const fit = letterboxFit(1080, 1080, 800, 400)
    expect(fit.height).toBe(400)
    expect(fit.width).toBe(400)
    expect(fit.offsetX).toBe(200)
  })

  it('returns a zero fit for a degenerate viewport', () => {
    expect(letterboxFit(1920, 1080, 0, 0)).toEqual({
      width: 0,
      height: 0,
      offsetX: 0,
      offsetY: 0,
      scale: 0
    })
  })
})

describe('clipBoundsAt', () => {
  const res: [number, number] = [1920, 1080]

  it('returns the fit-scaled source rect centered at canvas center for neutral transform', () => {
    // 640x360 in 1920x1080 → fitScale = min(1920/640, 1080/360) = 3
    // halfW = 640*3*1/2 = 960, halfH = 360*3*1/2 = 540
    const b = clipBoundsAt(transform({}), 640, 360, res)
    expect(b.left).toBe(960 - 960)
    expect(b.right).toBe(960 + 960)
    expect(b.top).toBe(540 - 540)
    expect(b.bottom).toBe(540 + 540)
  })

  it('offsets by transform.x/y (center-relative)', () => {
    // 200x100 in 1920x1080 → fitScale = min(9.6, 10.8) = 9.6
    // halfW = 200*9.6/2 = 960, halfH = 100*9.6/2 = 480
    const b = clipBoundsAt(transform({ x: 100, y: -50 }), 200, 100, res)
    expect(b.left).toBe(960 + 100 - 960)
    expect(b.top).toBe(540 - 50 - 480)
  })

  it('scales the extent by |scale| (flip sign does not change extent)', () => {
    // 100x100 in 1920x1080 → fitScale = min(19.2, 10.8) = 10.8
    // halfW = 100*10.8*2/2 = 1080, halfH = 100*10.8*2/2 = 1080
    const b = clipBoundsAt(transform({ scale: 2, flipH: true }), 100, 100, res)
    expect(b.right - b.left).toBe(2160)
    expect(b.bottom - b.top).toBe(2160)
  })
})

describe('pointInBounds', () => {
  it('is true inside and false outside (inclusive edges)', () => {
    const b = { left: 0, top: 0, right: 10, bottom: 10 }
    expect(pointInBounds(b, 5, 5)).toBe(true)
    expect(pointInBounds(b, 0, 0)).toBe(true)
    expect(pointInBounds(b, 11, 5)).toBe(false)
    expect(pointInBounds(b, 5, -1)).toBe(false)
  })
})

describe('hitTestClip', () => {
  const res: [number, number] = [1920, 1080]
  // Two overlapping clips centered on the canvas; both 200x200.
  const items = visibleClipsAt(
    [
      {
        id: 't1',
        type: 'video',
        clips: [clip({ id: 'back', start: 0, in: 0, out: 5, transform: transform({ z: 0 }) })]
      },
      {
        id: 't2',
        type: 'video',
        clips: [clip({ id: 'front', start: 0, in: 0, out: 5, transform: transform({ z: 0 }) })]
      }
    ],
    1
  )
  const sizes = new Map([
    ['back', { width: 200, height: 200 }],
    ['front', { width: 200, height: 200 }]
  ])

  it('returns the topmost (last-drawn) clip when both contain the point', () => {
    // Canvas center (960, 540) is inside both.
    expect(hitTestClip(items, sizes, 960, 540, res)).toBe('front')
  })

  it('returns null when the point hits no clip', () => {
    expect(hitTestClip(items, sizes, 10, 10, res)).toBeNull()
  })

  it('skips clips whose source size is unknown', () => {
    const partial = new Map([['back', { width: 200, height: 200 }]])
    expect(hitTestClip(items, partial, 960, 540, res)).toBe('back')
  })

  it('hits a single clip whose offset bounds contain the point', () => {
    const offsetItems = visibleClipsAt(
      [
        {
          id: 't',
          type: 'video',
          clips: [clip({ id: 'only', start: 0, in: 0, out: 5, transform: transform({ x: 400 }) })]
        }
      ],
      1
    )
    // Use source matching canvas so fitScale=1 (1920x1080 in 1920x1080)
    const s = new Map([['only', { width: 1920, height: 1080 }]])
    // Center moved to 960+400=1360; clip fills full canvas shifted right by 400
    // left = 1360-960=400, right = 1360+960=2320
    expect(hitTestClip(offsetItems, s, 1360, 540, res)).toBe('only')
    expect(hitTestClip(offsetItems, s, 300, 540, res)).toBeNull()
  })

  it('is rotation-aware: a corner inside the AABB but outside the rotated rect misses', () => {
    // A 200x200 clip rotated 45deg at canvas center (960,540).
    // fitScale = min(1920/200, 1080/200) = 5.4 → drawn size 1080x1080
    // After 45° rotation the diamond extends ±(1080*√2/2)≈764 from center.
    // The AABB corner at (200,0) relative to center is inside the AABB
    // but outside the diamond when far enough from center.
    const rotItems = visibleClipsAt(
      [
        {
          id: 't',
          type: 'video',
          clips: [
            clip({ id: 'r', start: 0, in: 0, out: 5, transform: transform({ rotation: 45 }) })
          ]
        }
      ],
      1
    )
    // Use canvas-matching source so fitScale=1, drawn size 200x200
    const s = new Map([['r', { width: 1920, height: 1080 }]])
    // fitScale=1, halfW=960, halfH=540 → bounds [0,0,1920,1080]
    // Center hits regardless of rotation.
    expect(hitTestClip(rotItems, s, 960, 540, res)).toBe('r')
    // A point at the corner (0,0) is inside the AABB but outside the 45°-rotated rect
    // inverse-rotate: dx=-960,dy=-540 → localX=(-960-540)*cos45≈-1061 > halfW(960) → miss
    expect(hitTestClip(rotItems, s, 0, 0, res)).toBeNull()
    // A point along the rotated long axis (toward a rotated corner) still hits.
    expect(hitTestClip(rotItems, s, 1060, 540, res)).toBe('r')
  })
})

describe('clipCenter', () => {
  it('returns the midpoint of the bounds', () => {
    expect(clipCenter({ left: 0, top: 0, right: 10, bottom: 20 })).toEqual({ x: 5, y: 10 })
  })
})

describe('pointInRotatedBounds', () => {
  const b = { left: 90, top: 40, right: 110, bottom: 160 } // center (100,100), 20x120
  it('reduces to pointInBounds at rotation 0', () => {
    expect(pointInRotatedBounds(b, 0, 100, 150)).toBe(true)
    expect(pointInRotatedBounds(b, 0, 130, 100)).toBe(false)
  })

  it('respects rotation: a point along the rotated long axis is inside', () => {
    // Rotate the tall box 90deg → it becomes wide; (160,100) now inside.
    expect(pointInRotatedBounds(b, 90, 155, 100)).toBe(true)
    // …and a point on the original (unrotated) long axis is now outside.
    expect(pointInRotatedBounds(b, 90, 100, 155)).toBe(false)
  })
})

describe('rotatedClipCorners', () => {
  it('returns the axis-aligned corners at rotation 0', () => {
    const corners = rotatedClipCorners({ left: 0, top: 0, right: 10, bottom: 10 }, 0)
    expect(corners[0].x).toBeCloseTo(0)
    expect(corners[0].y).toBeCloseTo(0)
    expect(corners[2].x).toBeCloseTo(10)
    expect(corners[2].y).toBeCloseTo(10)
  })

  it('rotates the corners about the center by +deg (clockwise on screen)', () => {
    // 10x10 box centered at (5,5), rotated 90deg: top-left (0,0) → (10,0).
    const corners = rotatedClipCorners({ left: 0, top: 0, right: 10, bottom: 10 }, 90)
    expect(corners[0].x).toBeCloseTo(10)
    expect(corners[0].y).toBeCloseTo(0)
  })
})

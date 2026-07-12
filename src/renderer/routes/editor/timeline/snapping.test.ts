import { describe, expect, it } from 'vitest'
import type { Clip } from '../../../../shared/project-schema'
import { defaultTransform } from '../../../../shared/project-schema'
import type { ProjectTrack } from '../../../../shared/storage'
import { gatherSnapTargets, snapStart } from './snapping'

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

function track(id: string, clips: Clip[]): ProjectTrack {
  return { id, type: 'video', clips }
}

// All snapping tests use pxPerSec = 100, snapPx = 8 => tolerance = 0.08s.
const PX_PER_SEC = 100
const SNAP_PX = 8

describe('snapping math — snapStart', () => {
  it('snaps the start edge to the nearest target within snapPx', () => {
    // Candidate start 5.05s, target (playhead) at 5.0s; 0.05s < 0.08s tolerance.
    const result = snapStart(5.05, 2, [5.0], SNAP_PX, PX_PER_SEC)
    expect(result.start).toBe(5.0)
    expect(result.snappedTo).toBe(5.0)
  })

  it('snaps the END edge to a target, resulting start = target - duration', () => {
    // Duration 2s, candidate start 2.95 (end 4.95). Target at 5.0 hits the END
    // (dist 0.05) closer than the start side (dist 2.05) -> start = 5.0 - 2 = 3.0.
    const result = snapStart(2.95, 2, [5.0], SNAP_PX, PX_PER_SEC)
    expect(result.start).toBeCloseTo(3.0, 10)
    expect(result.snappedTo).toBe(5.0)
  })

  it('chooses the closest target among many (clip edge over playhead)', () => {
    // Candidate start 7.02. Targets: playhead 5.0, a clip edge at 7.0.
    // Start side: |7.0 - 7.02| = 0.02 wins; |5.0 - 7.02| out of range.
    const result = snapStart(7.02, 1, [5.0, 7.0, 10.0], SNAP_PX, PX_PER_SEC)
    expect(result.start).toBe(7.0)
    expect(result.snappedTo).toBe(7.0)
  })

  it('prefers the start side over the end side at equal distance (deterministic)', () => {
    // Duration 1. Candidate start 4.95 (end 5.95). Target 5.0 is 0.05 from start
    // and 0.95 from end -> start side wins; start = 5.0.
    const result = snapStart(4.95, 1, [5.0], SNAP_PX, PX_PER_SEC)
    expect(result.start).toBe(5.0)
    expect(result.snappedTo).toBe(5.0)
  })

  it('does NOT snap when every target is outside snapPx', () => {
    // Candidate 5.5, nearest target 5.0 => 0.5s > 0.08s tolerance.
    const result = snapStart(5.5, 2, [5.0, 12.0], SNAP_PX, PX_PER_SEC)
    expect(result.start).toBe(5.5)
    expect(result.snappedTo).toBeNull()
  })

  it('returns the candidate unchanged when there are no targets (snap-disabled path)', () => {
    const result = snapStart(3.3, 2, [], SNAP_PX, PX_PER_SEC)
    expect(result.start).toBe(3.3)
    expect(result.snappedTo).toBeNull()
  })

  it('returns the candidate unchanged when snapPx is non-positive', () => {
    const result = snapStart(5.01, 2, [5.0], 0, PX_PER_SEC)
    expect(result.start).toBe(5.01)
    expect(result.snappedTo).toBeNull()
  })

  it('returns the candidate unchanged when pxPerSec is non-positive', () => {
    const result = snapStart(5.01, 2, [5.0], SNAP_PX, 0)
    expect(result.start).toBe(5.01)
    expect(result.snappedTo).toBeNull()
  })

  it('returns the candidate unchanged when snapPx is negative', () => {
    const result = snapStart(5.01, 2, [5.0], -8, PX_PER_SEC)
    expect(result.start).toBe(5.01)
    expect(result.snappedTo).toBeNull()
  })

  it('returns the candidate unchanged when pxPerSec is negative', () => {
    const result = snapStart(5.01, 2, [5.0], SNAP_PX, -100)
    expect(result.start).toBe(5.01)
    expect(result.snappedTo).toBeNull()
  })

  it('snaps the START edge at EXACTLY the tolerance boundary (inclusive `<=`)', () => {
    // tolerance = 8 / 100 = 0.08s. Distance |0.0 - 0.08| = 0.08 is exactly the
    // tolerance; the start side uses `<=`, so it snaps. (Target at 0 keeps the
    // arithmetic exact, avoiding float drift around 0.08.)
    const result = snapStart(0.08, 2, [0.0], SNAP_PX, PX_PER_SEC)
    expect(result.start).toBe(0.0)
    expect(result.snappedTo).toBe(0.0)
  })

  it('does NOT snap just past the tolerance boundary', () => {
    // |0.0 - 0.09| = 0.09 > 0.08 tolerance -> no snap.
    const result = snapStart(0.09, 2, [0.0], SNAP_PX, PX_PER_SEC)
    expect(result.start).toBeCloseTo(0.09, 10)
    expect(result.snappedTo).toBeNull()
  })

  it('the END side does NOT snap at exactly the tolerance (strict `<`)', () => {
    // Candidate start -2.08 -> end (dur 2) = -0.08. Target 0.0: end dist 0.08
    // (== tolerance, strict `<` rejects); start dist 2.08 (out of range) -> no
    // snap. The target at 0 keeps the boundary arithmetic exact.
    const result = snapStart(-2.08, 2, [0.0], SNAP_PX, PX_PER_SEC)
    expect(result.start).toBeCloseTo(-2.08, 10)
    expect(result.snappedTo).toBeNull()
  })

  it('picks the nearer of two in-range targets (both within tolerance)', () => {
    // Candidate 5.03. Targets 5.0 (dist 0.03) and 5.06 (dist 0.03)… make 5.0 the
    // clear winner instead: 5.0 dist 0.03, 5.07 dist 0.04 -> 5.0 wins.
    const result = snapStart(5.03, 1, [5.07, 5.0], SNAP_PX, PX_PER_SEC)
    expect(result.start).toBe(5.0)
    expect(result.snappedTo).toBe(5.0)
  })

  it('with two equidistant targets, the LATER one in the list wins (last `<=` write)', () => {
    // Candidate 5.0. Targets 4.95 and 5.05 are both 0.05 away. The start-side
    // comparison uses `<=`, so the last equal target encountered overwrites the
    // earlier one -> 5.05 wins (deterministic by iteration order).
    const result = snapStart(5.0, 1, [4.95, 5.05], SNAP_PX, PX_PER_SEC)
    expect(result.start).toBe(5.05)
    expect(result.snappedTo).toBe(5.05)
  })

  it('does not clamp negative starts (clamping is the caller’s job)', () => {
    // End-side snap can drive start negative; snapStart must not clamp.
    const result = snapStart(-0.02, 1, [0.5], SNAP_PX, PX_PER_SEC)
    // Start side: |0.5 - (-0.02)| = 0.52 out of range; end side end = 0.98,
    // |0.5 - 0.98| = 0.48 out of range -> no snap, unchanged negative value.
    expect(result.start).toBe(-0.02)
    expect(result.snappedTo).toBeNull()
  })

  it('snaps to a marker target', () => {
    const result = snapStart(8.04, 2, [8.0], SNAP_PX, PX_PER_SEC)
    expect(result.start).toBe(8.0)
    expect(result.snappedTo).toBe(8.0)
  })
})

describe('snapping math — gatherSnapTargets', () => {
  const tracks = [
    track('t1', [
      clip({ id: 'moving', start: 1, in: 0, out: 2 }), // end 3
      clip({ id: 'a', start: 4, in: 0, out: 2 }) // start 4, end 6
    ]),
    track('t2', [
      clip({ id: 'b', start: 10, in: 1, out: 4 }) // start 10, end 13
    ])
  ]

  it('includes the playhead, all OTHER clip edges (all tracks), and markers', () => {
    const targets = gatherSnapTargets(tracks, 7.5, 'moving', [20])
    // playhead 7.5; clip a -> 4, 6; clip b -> 10, 13; marker 20.
    expect(targets).toEqual([7.5, 4, 6, 10, 13, 20])
  })

  it('excludes the moving clip’s own start and end', () => {
    const targets = gatherSnapTargets(tracks, 7.5, 'moving')
    expect(targets).not.toContain(1) // moving start
    expect(targets).not.toContain(3) // moving end
  })

  it('defaults markers to an empty list', () => {
    const targets = gatherSnapTargets(tracks, 0, 'moving')
    expect(targets).toEqual([0, 4, 6, 10, 13])
  })
})

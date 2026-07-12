/**
 * Tests for lyrics-first Tap-Sync anchor actions and low-confidence review.
 *
 * addLyricsAnchor / clearLyricsAnchors — persist tap-sync anchors on the
 *   open project's captions.anchors (no IPC, no undo — live session state).
 * seekNextLowConfidenceCaption — seeks playhead to the next caption clip with
 *   > 20% of words below the 0.6 confidence threshold.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../../../shared/storage'
import type { Clip } from '../../../shared/project-schema'
import { useProjectStore } from '../projectStore'
import { useTimelineStore } from '../timelineStore'
import { CAPTION_TRACK_ID } from '../timeline'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(tracks: Project['tracks'] = [], captions?: Project['captions']): Project {
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
    storage: { location: 'local', root: '/tmp' },
    tracks,
    ...(captions !== undefined ? { captions } : {})
  }
}

function makeCaptionClip(id: string, start: number, out: number, confidences: (number | undefined)[]): Clip {
  return {
    id,
    mediaRef: 'text:',
    in: 0,
    out,
    start,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, flipH: false, flipV: false, z: 0 },
    text: { lines: ['line'] },
    caption: {
      words: confidences.map((c, i) => ({
        text: `w${i}`,
        start: start + i * 0.1,
        end: start + i * 0.1 + 0.09,
        ...(c !== undefined ? { confidence: c } : {})
      }))
    }
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal('window', { api: { invoke: vi.fn() } })
  useProjectStore.setState({ currentRef: null, currentProject: null })
  useTimelineStore.setState({ playhead: 0 })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// addLyricsAnchor
// ---------------------------------------------------------------------------

describe('addLyricsAnchor', () => {
  it('no-ops when no project is open', () => {
    useTimelineStore.getState().addLyricsAnchor('line', 0, 1.0)
    // Nothing to assert — just must not throw.
  })

  it('appends an anchor to captions.anchors', () => {
    useProjectStore.setState({ currentProject: makeProject(), currentRef: { location: 'local', id: 'p1', name: 'P', path: '/tmp' } })
    useTimelineStore.getState().addLyricsAnchor('line', 2, 5.5)
    const project = useProjectStore.getState().currentProject!
    expect(project.captions?.anchors).toEqual([{ unit: 'line', index: 2, t: 5.5 }])
  })

  it('replaces an existing anchor for the same unit + index', () => {
    const captions = { anchors: [{ unit: 'line' as const, index: 1, t: 2.0 }] }
    useProjectStore.setState({ currentProject: makeProject([], captions), currentRef: { location: 'local', id: 'p1', name: 'P', path: '/tmp' } })
    useTimelineStore.getState().addLyricsAnchor('line', 1, 3.0)
    const anchors = useProjectStore.getState().currentProject!.captions?.anchors ?? []
    expect(anchors).toHaveLength(1)
    expect(anchors[0].t).toBe(3.0)
  })

  it('preserves anchors for different indices', () => {
    const captions = { anchors: [{ unit: 'line' as const, index: 0, t: 1.0 }] }
    useProjectStore.setState({ currentProject: makeProject([], captions), currentRef: { location: 'local', id: 'p1', name: 'P', path: '/tmp' } })
    useTimelineStore.getState().addLyricsAnchor('line', 1, 2.5)
    const anchors = useProjectStore.getState().currentProject!.captions?.anchors ?? []
    expect(anchors).toHaveLength(2)
  })

  it('records word-level anchors too', () => {
    useProjectStore.setState({ currentProject: makeProject(), currentRef: { location: 'local', id: 'p1', name: 'P', path: '/tmp' } })
    useTimelineStore.getState().addLyricsAnchor('word', 4, 7.2)
    const anchors = useProjectStore.getState().currentProject!.captions?.anchors ?? []
    expect(anchors[0]).toEqual({ unit: 'word', index: 4, t: 7.2 })
  })
})

// ---------------------------------------------------------------------------
// clearLyricsAnchors
// ---------------------------------------------------------------------------

describe('clearLyricsAnchors', () => {
  it('no-ops when no project is open', () => {
    useTimelineStore.getState().clearLyricsAnchors()
  })

  it('no-ops when there are no anchors', () => {
    useProjectStore.setState({ currentProject: makeProject(), currentRef: { location: 'local', id: 'p1', name: 'P', path: '/tmp' } })
    useTimelineStore.getState().clearLyricsAnchors()
    expect(useProjectStore.getState().currentProject!.captions?.anchors ?? []).toHaveLength(0)
  })

  it('removes all anchors', () => {
    const captions = { anchors: [{ unit: 'line' as const, index: 0, t: 1.0 }, { unit: 'line' as const, index: 1, t: 2.0 }] }
    useProjectStore.setState({ currentProject: makeProject([], captions), currentRef: { location: 'local', id: 'p1', name: 'P', path: '/tmp' } })
    useTimelineStore.getState().clearLyricsAnchors()
    expect(useProjectStore.getState().currentProject!.captions?.anchors ?? []).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// seekNextLowConfidenceCaption
// ---------------------------------------------------------------------------

describe('seekNextLowConfidenceCaption', () => {
  it('returns false when no project is open', () => {
    expect(useTimelineStore.getState().seekNextLowConfidenceCaption()).toBe(false)
  })

  it('returns false when no caption track exists', () => {
    useProjectStore.setState({ currentProject: makeProject(), currentRef: { location: 'local', id: 'p1', name: 'P', path: '/tmp' } })
    expect(useTimelineStore.getState().seekNextLowConfidenceCaption()).toBe(false)
  })

  it('returns false when all clips are high-confidence', () => {
    const clip = makeCaptionClip('c1', 1.0, 2.0, [0.9, 0.85, 0.95])
    const tracks = [{ id: CAPTION_TRACK_ID, type: 'text' as const, clips: [clip] }]
    useProjectStore.setState({ currentProject: makeProject(tracks), currentRef: { location: 'local', id: 'p1', name: 'P', path: '/tmp' } })
    expect(useTimelineStore.getState().seekNextLowConfidenceCaption()).toBe(false)
  })

  it('seeks to the start of the next low-confidence clip and returns true', () => {
    const clip = makeCaptionClip('c1', 5.0, 3.0, [0.2, 0.3, 0.1])  // all low
    const tracks = [{ id: CAPTION_TRACK_ID, type: 'text' as const, clips: [clip] }]
    useProjectStore.setState({ currentProject: makeProject(tracks), currentRef: { location: 'local', id: 'p1', name: 'P', path: '/tmp' } })
    useTimelineStore.setState({ playhead: 0 })
    const found = useTimelineStore.getState().seekNextLowConfidenceCaption()
    expect(found).toBe(true)
    expect(useTimelineStore.getState().playhead).toBeCloseTo(5.0, 6)
  })

  it('wraps around when playhead is past all low-confidence clips', () => {
    const clip = makeCaptionClip('c1', 2.0, 1.0, [0.1, 0.1, 0.1])
    const tracks = [{ id: CAPTION_TRACK_ID, type: 'text' as const, clips: [clip] }]
    useProjectStore.setState({ currentProject: makeProject(tracks), currentRef: { location: 'local', id: 'p1', name: 'P', path: '/tmp' } })
    useTimelineStore.setState({ playhead: 10.0 })
    const found = useTimelineStore.getState().seekNextLowConfidenceCaption()
    expect(found).toBe(true)
    // Should wrap to the first (and only) low-confidence clip.
    expect(useTimelineStore.getState().playhead).toBeCloseTo(2.0, 6)
  })

  it('skips to the NEXT clip after current playhead (not the one at/before it)', () => {
    const c1 = makeCaptionClip('c1', 1.0, 1.0, [0.1, 0.1])   // low
    const c2 = makeCaptionClip('c2', 5.0, 1.0, [0.1, 0.1])   // low
    const tracks = [{ id: CAPTION_TRACK_ID, type: 'text' as const, clips: [c1, c2] }]
    useProjectStore.setState({ currentProject: makeProject(tracks), currentRef: { location: 'local', id: 'p1', name: 'P', path: '/tmp' } })
    useTimelineStore.setState({ playhead: 1.0 })
    useTimelineStore.getState().seekNextLowConfidenceCaption()
    // c1 is at 1.0 (not strictly after), c2 at 5.0 is the next candidate.
    expect(useTimelineStore.getState().playhead).toBeCloseTo(5.0, 6)
  })
})

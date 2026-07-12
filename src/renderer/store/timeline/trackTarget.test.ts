/**
 * P8.10 — `trackTarget` store-action (tracking:run IPC wrapper) test (Doc 11).
 *
 * Verifies the renderer thunk: sends `tracking:run` with the open project's ref +
 * the bundle-relative `videoRef` (NO frame bytes), the picked target box, and the
 * clip-local duration/fps; on success PERSISTS the returned per-frame `TrackPath`
 * onto `clip.tracking` (inlined fps + samples, `enabled:true`) as an undoable
 * command; unwraps the `{ok,error}` envelope; and guards "no project open".
 *
 * The IPC bridge (`window.api`) is mocked; the project store holds a real clip so
 * the test asserts the persisted attachment via `runCommand`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectRef, Project } from '../../../shared/storage'
import type { TargetBox, TrackPath } from '../../../shared/tracking'
import { defaultTransform } from '../../../shared/project-schema'
import { useProjectStore } from '../projectStore'
import { useTimelineStore } from '../timelineStore'

const REF: ProjectRef = { location: 'local', id: 'p1', name: 'p1', path: '/tmp/p1.vproj' }
const invoke = vi.fn()

const TARGET: TargetBox = { x: 200, y: 100, width: 80, height: 40, kind: 'face' }

const PATH: TrackPath = {
  fps: 30,
  samples: [
    { t: 0, x: 200, y: 100, scale: 1, rotation: 0, confidence: 0.9 },
    { t: 4, x: 260, y: 100, scale: 1, rotation: 0, confidence: 0.9 }
  ]
}

function makeProject(): Project {
  return {
    version: 1,
    id: 'p1',
    name: 'P',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    settings: {
      fps: 30,
      resolution: [1920, 1080],
      aspect: '16:9',
      background: '#000000',
      language: 'ta',
      languages: ['ta']
    },
    storage: { location: 'local', root: '/tmp' },
    tracks: [
      {
        id: 'tk',
        type: 'video',
        clips: [
          {
            id: 'c1',
            mediaRef: 'media/clip.mp4',
            in: 0,
            out: 4,
            start: 0,
            transform: defaultTransform()
          }
        ]
      }
    ]
  }
}

beforeEach(() => {
  invoke.mockReset()
  vi.stubGlobal('window', { api: { invoke } })
  useProjectStore.setState({ currentRef: null, currentProject: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('timelineStore.trackTarget (tracking:run IPC wrapper)', () => {
  it('errors when no project is open (and never touches IPC)', async () => {
    const result = await useTimelineStore.getState().trackTarget('c1', TARGET)
    expect(result).toEqual({ ok: false, error: 'No project is open.' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('invokes tracking:run with ref + bundle-relative videoRef + duration/fps (no bytes)', async () => {
    useProjectStore.setState({ currentRef: REF, currentProject: makeProject() })
    invoke.mockResolvedValue({ ok: true, data: PATH })

    await useTimelineStore.getState().trackTarget('c1', TARGET)

    expect(invoke).toHaveBeenCalledWith('tracking:run', {
      ref: REF,
      videoRef: 'media/clip.mp4',
      target: TARGET,
      durationSec: 4,
      fps: 30
    })
    const [, payload] = invoke.mock.calls[0] as [string, { videoRef: unknown }]
    expect(typeof payload.videoRef).toBe('string')
  })

  it('persists the returned TrackPath onto clip.tracking (enabled, inlined fps+samples)', async () => {
    useProjectStore.setState({ currentRef: REF, currentProject: makeProject() })
    invoke.mockResolvedValue({ ok: true, data: PATH })

    const result = await useTimelineStore.getState().trackTarget('c1', TARGET)

    expect(result).toEqual({ ok: true, samples: 2 })
    const clip = useProjectStore.getState().currentProject!.tracks[0].clips[0]
    expect(clip.tracking).toEqual({
      enabled: true,
      target: 'face',
      targetBox: TARGET,
      fps: 30,
      path: PATH.samples
    })
  })

  it('clears the transient target selection on success', async () => {
    useProjectStore.setState({ currentRef: REF, currentProject: makeProject() })
    invoke.mockResolvedValue({ ok: true, data: PATH })
    useTimelineStore.getState().beginTrackTarget('c1', TARGET)

    await useTimelineStore.getState().trackTarget('c1', TARGET)

    expect(useTimelineStore.getState().trackingTarget).toBeNull()
  })

  it('surfaces a main-side error envelope as { ok:false, error } (no persist)', async () => {
    useProjectStore.setState({ currentRef: REF, currentProject: makeProject() })
    invoke.mockResolvedValue({ ok: false, error: 'tracker crashed' })

    const result = await useTimelineStore.getState().trackTarget('c1', TARGET)
    expect(result).toEqual({ ok: false, error: 'tracker crashed' })
    expect(useProjectStore.getState().currentProject!.tracks[0].clips[0].tracking).toBeUndefined()
  })

  it('catches a thrown bridge error', async () => {
    useProjectStore.setState({ currentRef: REF, currentProject: makeProject() })
    invoke.mockRejectedValue(new Error('bridge down'))

    const result = await useTimelineStore.getState().trackTarget('c1', TARGET)
    expect(result).toEqual({ ok: false, error: 'bridge down' })
  })

  it('uses the clip mediaRef as videoRef by default; honours an explicit override', async () => {
    useProjectStore.setState({ currentRef: REF, currentProject: makeProject() })
    invoke.mockResolvedValue({ ok: true, data: PATH })

    await useTimelineStore.getState().trackTarget('c1', TARGET, 'media/other.mp4')

    const [, payload] = invoke.mock.calls[0] as [string, { videoRef: string }]
    expect(payload.videoRef).toBe('media/other.mp4')
  })
})

describe('timelineStore tracking manual-correction actions', () => {
  it('setTrackingAnchor persists the anchor as an undoable command', () => {
    const p = makeProject()
    p.tracks[0].clips[0].tracking = {
      enabled: true,
      targetBox: TARGET,
      fps: 30,
      path: PATH.samples
    }
    useProjectStore.setState({ currentRef: REF, currentProject: p })

    useTimelineStore.getState().setTrackingAnchor('c1', { dx: -20, dy: 8 })

    const clip = useProjectStore.getState().currentProject!.tracks[0].clips[0]
    expect(clip.tracking?.anchor).toEqual({ dx: -20, dy: 8 })
  })

  it('setTrackingSmoothing clamps into [0,1] and persists', () => {
    const p = makeProject()
    p.tracks[0].clips[0].tracking = { enabled: true, fps: 30, path: PATH.samples }
    useProjectStore.setState({ currentRef: REF, currentProject: p })

    useTimelineStore.getState().setTrackingSmoothing('c1', 2)
    expect(useProjectStore.getState().currentProject!.tracks[0].clips[0].tracking?.smoothing).toBe(1)
  })

  it('setTrackingEnabled toggles without losing the path', () => {
    const p = makeProject()
    p.tracks[0].clips[0].tracking = { enabled: true, fps: 30, path: PATH.samples }
    useProjectStore.setState({ currentRef: REF, currentProject: p })

    useTimelineStore.getState().setTrackingEnabled('c1', false)
    const clip = useProjectStore.getState().currentProject!.tracks[0].clips[0]
    expect(clip.tracking?.enabled).toBe(false)
    expect(clip.tracking?.path).toEqual(PATH.samples)
  })

  it('clearTracking drops the attachment', () => {
    const p = makeProject()
    p.tracks[0].clips[0].tracking = { enabled: true, fps: 30, path: PATH.samples }
    useProjectStore.setState({ currentRef: REF, currentProject: p })

    useTimelineStore.getState().clearTracking('c1')
    expect(useProjectStore.getState().currentProject!.tracks[0].clips[0].tracking).toBeUndefined()
  })

  it('manual actions are no-ops without an existing tracking attachment', () => {
    useProjectStore.setState({ currentRef: REF, currentProject: makeProject() })
    useTimelineStore.getState().setTrackingAnchor('c1', { dx: 1, dy: 1 })
    expect(useProjectStore.getState().currentProject!.tracks[0].clips[0].tracking).toBeUndefined()
  })
})

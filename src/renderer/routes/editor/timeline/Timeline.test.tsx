/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Clip } from '../../../../shared/project-schema'
import { defaultTransform } from '../../../../shared/project-schema'
import type { Project } from '../../../../shared/storage'
import { Timeline } from './Timeline'
import { zoomToFitPxPerSec } from './scale'
import { useProjectStore } from '@/store/projectStore'
import { useTimelineStore } from '@/store/timelineStore'

vi.mock('../usePlayheadClock', () => ({
  usePlayheadClock: () => undefined
}))

vi.mock('./useVisibleWindow', () => ({
  useVisibleWindow: () => ({ startSec: 0, endSec: 10 })
}))

vi.mock('./useBundlePath', () => ({
  useBundlePath: () => null
}))

vi.mock('./EditControls', () => ({
  EditControls: () => <div data-testid='edit-controls' />
}))

vi.mock('./TimeRuler', () => ({
  TimeRuler: ({ durationSec }: { durationSec: number }) => (
    <div data-testid='time-ruler'>{`duration:${durationSec}`}</div>
  )
}))

vi.mock('./TrackHeader', () => ({
  TrackHeader: () => <div data-testid='track-header' />
}))

vi.mock('./TrackLane', () => ({
  TrackLane: () => <div data-testid='track-lane' />
}))

vi.mock('./KeyframeLane', () => ({
  KeyframeLanes: () => <div data-testid='keyframe-lanes' />
}))

vi.mock('./ZoomControl', () => ({
  ZoomControl: () => <div data-testid='zoom-control' />
}))

function makeClip(id: string, start: number, durationSec: number): Clip {
  return {
    id,
    mediaRef: `media/${id}.mp4`,
    in: 0,
    out: durationSec,
    start,
    transform: defaultTransform()
  }
}

function makeProject(clips: Clip[]): Project {
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
    tracks: [{ id: 'tk1', type: 'video', clips }]
  }
}

describe('Timeline view mode label', () => {
  let container: HTMLDivElement
  let root: Root
  let clientWidthDescriptor: PropertyDescriptor | undefined

  beforeEach(() => {
    ; (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 700
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    if (clientWidthDescriptor !== undefined) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
    }
    container.remove()
      ; (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
    useProjectStore.getState().closeProject()
    useTimelineStore.setState({
      selection: [],
      zoom: 100,
      snap: true,
      playhead: 0,
      isPlaying: false,
      inPoint: null,
      outPoint: null,
      previewQuality: 'full',
      dragTransform: null,
      motionPathDraw: null,
      editingTextClipId: null,
      trackingTarget: null
    })
  })

  it('shows "View: Fit media" when total duration is within 6 minutes', async () => {
    const project = makeProject([makeClip('c1', 0, 120)])

    await act(async () => {
      root.render(<Timeline project={project} />)
      await Promise.resolve()
    })

    expect(container.textContent).toContain('View: Fit media')
  })

  it('shows "View: Fit media" when total duration exceeds 6 minutes', async () => {
    const project = makeProject([makeClip('c1', 0, 400)])

    await act(async () => {
      root.render(<Timeline project={project} />)
      await Promise.resolve()
    })

    expect(container.textContent).toContain('View: Fit media')
  })

  it('passes the exact media duration to the ruler instead of flooring to 10 seconds', async () => {
    const project = makeProject([makeClip('c1', 0, 5)])

    await act(async () => {
      root.render(<Timeline project={project} />)
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="time-ruler"]')?.textContent).toBe('duration:5')
  })

  it('auto-fits zoom against the exact media duration on render', async () => {
    const project = makeProject([makeClip('c1', 0, 350)])

    await act(async () => {
      root.render(<Timeline project={project} />)
      await Promise.resolve()
    })

    expect(useTimelineStore.getState().zoom).toBeCloseTo(zoomToFitPxPerSec(350, 700), 10)
  })
})

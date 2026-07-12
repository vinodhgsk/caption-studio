/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Clip } from '../../../../shared/project-schema'
import type { Project } from '../../../../shared/storage'
import { PreviewInteraction } from './PreviewInteraction'
import { useProjectStore } from '@/store/projectStore'
import { useTimelineStore } from '@/store/timelineStore'

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
    tracks: [{ id: 'tk-text', type: 'text', clips }]
  }
}

describe('PreviewInteraction text edit overlay', () => {
  let container: HTMLDivElement
  let root: Root
  let getContextSpy: { mockRestore: () => void } | null = null

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(
        () =>
          ({
            font: '',
            measureText: (s: string) => ({ width: s.length * 10 })
          } as unknown as CanvasRenderingContext2D)
      )

    class MockResizeObserver {
      private readonly callback: ResizeObserverCallback

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
      }

      observe(): void {
        this.callback(
          [
            {
              contentRect: {
                width: 960,
                height: 540
              }
            } as ResizeObserverEntry
          ],
          this as unknown as ResizeObserver
        )
      }

      disconnect(): void {}

      unobserve(): void {}
    }

    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
      cb(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    getContextSpy?.mockRestore()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
    vi.unstubAllGlobals()
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

  it('mounts textarea in edit mode when drawnSizes includes the edited clip', async () => {
    const clip = makeTextClip('text-1', ['Visible while editing'])
    const project = makeProject([clip])
    const drawnSizes = new Map<string, { width: number; height: number }>([
      ['text-1', { width: 420, height: 96 }]
    ])

    useProjectStore.setState({ currentProject: project })
    useTimelineStore.setState({
      editingTextClipId: 'text-1',
      selection: ['text-1'],
      playhead: 0
    })

    await act(async () => {
      root.render(<PreviewInteraction project={project} drawnSizes={drawnSizes} />)
      await Promise.resolve()
    })

    const ta = container.querySelector('textarea')
    expect(ta).not.toBeNull()
    expect(ta?.value).toBe('Visible while editing')
  })

  it('does not mount textarea when drawnSizes is missing for the edited clip', async () => {
    const clip = makeTextClip('text-1', ['Needs bounds'])
    const project = makeProject([clip])
    const drawnSizes = new Map<string, { width: number; height: number }>()

    useProjectStore.setState({ currentProject: project })
    useTimelineStore.setState({
      editingTextClipId: 'text-1',
      selection: ['text-1'],
      playhead: 0
    })

    await act(async () => {
      root.render(<PreviewInteraction project={project} drawnSizes={drawnSizes} />)
      await Promise.resolve()
    })

    const ta = container.querySelector('textarea')
    expect(ta).toBeNull()
  })
})

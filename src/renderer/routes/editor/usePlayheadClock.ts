import { useEffect, useRef } from 'react'
import type { ProjectTrack } from '../../../shared/storage'
import { useTimelineStore } from '@/store/timelineStore'
import { useProjectStore } from '@/store/projectStore'
import { advancePlayhead } from '@/store/timeline'
import { projectDurationSec } from './timeline/scale'

/**
 * The SINGLE authoritative playhead clock (P3.8, constraint A).
 *
 * When `timelineStore.isPlaying` is true this runs a `requestAnimationFrame`
 * loop that advances `timelineStore.playhead` by REAL elapsed wall-clock time
 * (`performance.now()` deltas — independent of frame rate), clamping at the
 * project duration and pausing once the end is reached. There must be exactly
 * ONE instance: it is mounted once in `Timeline.tsx`.
 *
 * The loop logic stays OUT of the store (the store holds the flag + playhead);
 * the pure arithmetic lives in `advancePlayhead` so it is unit-testable without
 * rAF/DOM. The hook reads `isPlaying`/`setPlayhead` from the store directly via
 * `getState()` inside the loop so it never re-subscribes per frame.
 */
export function usePlayheadClock(tracks: readonly ProjectTrack[]): void {
  const isPlaying = useTimelineStore((s) => s.isPlaying)

  // Keep the latest duration in a ref so the running loop sees edits without
  // restarting (the effect only re-runs when play state flips).
  const durationRef = useRef(projectDurationSec(tracks))
  durationRef.current = projectDurationSec(tracks)

  useEffect(() => {
    if (!isPlaying) return
    if (typeof requestAnimationFrame === 'undefined') return

    let rafId = 0
    let last = performance.now()

    const tick = (now: number): void => {
      const deltaSec = (now - last) / 1000
      last = now
      const { playhead, setPlayhead, pause } = useTimelineStore.getState()
      const latestProject = useProjectStore.getState().currentProject
      const durationSec = latestProject === null
        ? durationRef.current
        : projectDurationSec(latestProject.tracks)
      const { next, atEnd } = advancePlayhead(playhead, deltaSec, durationSec)
      setPlayhead(next)
      if (atEnd) {
        pause()
        return
      }
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [isPlaying])
}

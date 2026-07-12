import { afterEach, describe, expect, it } from 'vitest'
import type { Project } from '../../shared/storage'
import type { Clip } from '../../shared/project-schema'
import { defaultTransform } from '../../shared/project-schema'
import type { Transcript } from '../../shared/stt'
import { useProjectStore } from './projectStore'
import { useTimelineStore } from './timelineStore'
import { CAPTION_TRACK_ID, buildCaptionClipsFromTranscript } from './timeline'

function makeClip(id: string, overrides: Partial<Clip> = {}): Clip {
  return {
    id,
    mediaRef: `media/${id}.mp4`,
    in: 0,
    out: 5,
    start: 0,
    transform: defaultTransform(),
    ...overrides
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

afterEach(() => {
  useTimelineStore.setState({
    selection: [],
    zoom: 100,
    snap: true,
    playhead: 0,
    isPlaying: false,
    inPoint: null,
    outPoint: null,
    previewQuality: 'full'
  })
  useProjectStore.getState().closeProject()
})

describe('timelineStore view state', () => {
  it('boots with sane defaults', () => {
    const s = useTimelineStore.getState()
    expect(s.selection).toEqual([])
    expect(s.zoom).toBe(100)
    expect(s.snap).toBe(true)
    expect(s.playhead).toBe(0)
    expect(s.isPlaying).toBe(false)
    expect(s.inPoint).toBeNull()
    expect(s.outPoint).toBeNull()
    expect(s.previewQuality).toBe('full')
  })

  it('manages selection', () => {
    const t = useTimelineStore.getState()
    t.setSelection(['a'])
    t.addToSelection('b')
    t.addToSelection('b') // dedupes
    expect(useTimelineStore.getState().selection).toEqual(['a', 'b'])
    useTimelineStore.getState().clearSelection()
    expect(useTimelineStore.getState().selection).toEqual([])
  })

  it('manages zoom, snap, and playhead', () => {
    const t = useTimelineStore.getState()
    t.setZoom(250)
    t.toggleSnap()
    t.setPlayhead(3.5)
    const s = useTimelineStore.getState()
    expect(s.zoom).toBe(250)
    expect(s.snap).toBe(false)
    expect(s.playhead).toBe(3.5)
    useTimelineStore.getState().setSnap(true)
    expect(useTimelineStore.getState().snap).toBe(true)
  })
})

describe('timelineStore playback clock (P3.8)', () => {
  it('play / pause / togglePlay toggle isPlaying', () => {
    const t = useTimelineStore.getState()
    expect(useTimelineStore.getState().isPlaying).toBe(false)

    t.play()
    expect(useTimelineStore.getState().isPlaying).toBe(true)
    t.play() // idempotent
    expect(useTimelineStore.getState().isPlaying).toBe(true)

    t.pause()
    expect(useTimelineStore.getState().isPlaying).toBe(false)

    t.togglePlay()
    expect(useTimelineStore.getState().isPlaying).toBe(true)
    t.togglePlay()
    expect(useTimelineStore.getState().isPlaying).toBe(false)
  })

  it('seek frame-snaps the playhead at the project fps', () => {
    // fps=30 → frame period 1/30s. 2.012s snaps to 2.0 (frame 60).
    useProjectStore.setState({ currentProject: makeProject([]) })
    useTimelineStore.getState().seek(2.012)
    expect(useTimelineStore.getState().playhead).toBeCloseTo(2.0, 10)

    // 2.02s is closer to frame 61 (2.0333…s) than frame 60.
    useTimelineStore.getState().seek(2.02)
    expect(useTimelineStore.getState().playhead).toBeCloseTo(61 / 30, 10)
  })

  it('seek defaults to 30 fps when no project is open', () => {
    expect(useProjectStore.getState().currentProject).toBeNull()
    useTimelineStore.getState().seek(2.012)
    expect(useTimelineStore.getState().playhead).toBeCloseTo(2.0, 10)
  })
})

describe('timelineStore transport (P3.10)', () => {
  it('stepFrame moves the playhead by exactly one frame and pauses', () => {
    useProjectStore.setState({ currentProject: makeProject([]) })
    useTimelineStore.setState({ playhead: 1, isPlaying: true })

    useTimelineStore.getState().stepFrame(1)
    let s = useTimelineStore.getState()
    expect(s.isPlaying).toBe(false) // playback paused on step
    expect(s.playhead).toBeCloseTo(1 + 1 / 30, 10)

    useTimelineStore.getState().stepFrame(-1)
    s = useTimelineStore.getState()
    expect(s.playhead).toBeCloseTo(1, 10)
  })

  it('stepFrame clamps at 0', () => {
    useProjectStore.setState({ currentProject: makeProject([]) })
    useTimelineStore.setState({ playhead: 0 })
    useTimelineStore.getState().stepFrame(-1)
    expect(useTimelineStore.getState().playhead).toBe(0)
  })

  it('stepFrame clamps at the project duration', () => {
    // Empty project → projectDurationSec floors at 10s.
    useProjectStore.setState({ currentProject: makeProject([]) })
    useTimelineStore.setState({ playhead: 10 })
    useTimelineStore.getState().stepFrame(1)
    expect(useTimelineStore.getState().playhead).toBeCloseTo(10, 10)
  })

  it('setInPoint / setOutPoint / clearInOut manage the markers', () => {
    const t = useTimelineStore.getState()
    t.setInPoint(2)
    t.setOutPoint(5)
    let s = useTimelineStore.getState()
    expect(s.inPoint).toBe(2)
    expect(s.outPoint).toBe(5)

    useTimelineStore.getState().clearInOut()
    s = useTimelineStore.getState()
    expect(s.inPoint).toBeNull()
    expect(s.outPoint).toBeNull()
  })

  it('setInPoint at/after the out clears the out (and vice versa)', () => {
    useTimelineStore.getState().setInPoint(2)
    useTimelineStore.getState().setOutPoint(5)
    // Move In past Out → Out clears.
    useTimelineStore.getState().setInPoint(6)
    expect(useTimelineStore.getState().inPoint).toBe(6)
    expect(useTimelineStore.getState().outPoint).toBeNull()

    // Now set an Out before the In → In clears.
    useTimelineStore.getState().setOutPoint(3)
    expect(useTimelineStore.getState().outPoint).toBe(3)
    expect(useTimelineStore.getState().inPoint).toBeNull()
  })

  it('null clears a single marker without touching the other', () => {
    useTimelineStore.getState().setInPoint(2)
    useTimelineStore.getState().setOutPoint(5)
    useTimelineStore.getState().setInPoint(null)
    expect(useTimelineStore.getState().inPoint).toBeNull()
    expect(useTimelineStore.getState().outPoint).toBe(5)
  })

  it('setPreviewQuality / togglePreviewQuality switch quality', () => {
    expect(useTimelineStore.getState().previewQuality).toBe('full')
    useTimelineStore.getState().togglePreviewQuality()
    expect(useTimelineStore.getState().previewQuality).toBe('half')
    useTimelineStore.getState().togglePreviewQuality()
    expect(useTimelineStore.getState().previewQuality).toBe('full')

    useTimelineStore.getState().setPreviewQuality('half')
    expect(useTimelineStore.getState().previewQuality).toBe('half')
  })
})

describe('timelineStore edit ops dispatch through projectStore.runCommand', () => {
  it('moveClip mutates the single source of truth and is undoable', () => {
    useProjectStore.setState({
      currentProject: makeProject([makeClip('c1', { start: 1 })])
    })
    useTimelineStore.getState().moveClip('c1', 8)
    expect(useProjectStore.getState().currentProject?.tracks[0].clips[0].start).toBe(8)
    expect(useProjectStore.getState().canUndo()).toBe(true)

    useProjectStore.getState().undo()
    expect(useProjectStore.getState().currentProject?.tracks[0].clips[0].start).toBe(1)
  })

  it('edit ops are no-ops when no project is open', () => {
    expect(useProjectStore.getState().currentProject).toBeNull()
    useTimelineStore.getState().moveClip('c1', 5) // should not throw
    expect(useProjectStore.getState().canUndo()).toBe(false)
  })
})

describe('splitSelectedAtPlayhead (P3.7)', () => {
  it('commits an interior split, selects the new right clip, and is undoable', () => {
    useProjectStore.setState({
      currentProject: makeProject([makeClip('c1', { in: 0, out: 5, start: 0 })])
    })
    useTimelineStore.setState({ selection: ['c1'], playhead: 2 })

    const committed = useTimelineStore.getState().splitSelectedAtPlayhead()
    expect(committed).toBe(true)

    const clips = useProjectStore.getState().currentProject!.tracks[0].clips
    expect(clips).toHaveLength(2)
    const [left, right] = clips
    expect(left.id).toBe('c1')
    expect(left.in).toBe(0)
    expect(left.out).toBe(2)
    expect(left.start).toBe(0)
    expect(right.in).toBe(2)
    expect(right.out).toBe(5)
    expect(right.start).toBe(2)

    // Post-split selection = the new right clip.
    expect(useTimelineStore.getState().selection).toEqual([right.id])
    expect(right.id).not.toBe('c1')

    // Undo merges the halves back into the original clip.
    useProjectStore.getState().undo()
    const undone = useProjectStore.getState().currentProject!.tracks[0].clips
    expect(undone).toHaveLength(1)
    expect(undone[0].id).toBe('c1')
    expect(undone[0].out).toBe(5)
  })

  it('frame-snaps the split time to the project fps boundary', () => {
    // fps=30 → frame period 1/30s. A playhead at 2.012s snaps to 2.0s (frame 60).
    useProjectStore.setState({
      currentProject: makeProject([makeClip('c1', { in: 0, out: 5, start: 0 })])
    })
    useTimelineStore.setState({ selection: ['c1'], playhead: 2.012 })

    expect(useTimelineStore.getState().splitSelectedAtPlayhead()).toBe(true)
    const right = useProjectStore.getState().currentProject!.tracks[0].clips[1]
    expect(right.start).toBeCloseTo(2.0, 10)
    expect(right.in).toBeCloseTo(2.0, 10)
  })

  it('falls back to the first clip containing the playhead when selection misses', () => {
    useProjectStore.setState({
      currentProject: makeProject([
        makeClip('c1', { in: 0, out: 4, start: 0 }),
        makeClip('c2', { in: 0, out: 4, start: 4 })
      ])
    })
    // c1 selected but the playhead sits inside c2.
    useTimelineStore.setState({ selection: ['c1'], playhead: 6 })

    expect(useTimelineStore.getState().splitSelectedAtPlayhead()).toBe(true)
    const clips = useProjectStore.getState().currentProject!.tracks[0].clips
    // c2 was the one split.
    expect(clips.map((c) => c.id).filter((id) => id === 'c2')).toEqual(['c2'])
    expect(clips).toHaveLength(3)
  })

  it('is a no-op on an edge hit', () => {
    useProjectStore.setState({
      currentProject: makeProject([makeClip('c1', { in: 0, out: 5, start: 0 })])
    })
    useTimelineStore.setState({ selection: ['c1'], playhead: 0 })

    expect(useTimelineStore.getState().splitSelectedAtPlayhead()).toBe(false)
    expect(useProjectStore.getState().currentProject!.tracks[0].clips).toHaveLength(1)
    expect(useProjectStore.getState().canUndo()).toBe(false)
  })

  it('is a no-op when no clip contains the playhead', () => {
    useProjectStore.setState({
      currentProject: makeProject([makeClip('c1', { in: 0, out: 5, start: 0 })])
    })
    useTimelineStore.setState({ selection: [], playhead: 10 })

    expect(useTimelineStore.getState().splitSelectedAtPlayhead()).toBe(false)
    expect(useProjectStore.getState().canUndo()).toBe(false)
  })

  it('is a no-op when no project is open', () => {
    expect(useProjectStore.getState().currentProject).toBeNull()
    expect(useTimelineStore.getState().splitSelectedAtPlayhead()).toBe(false)
  })
})

describe('rippleDeleteSelected (P3.7)', () => {
  it('closes the gap, clears selection, and is undoable', () => {
    useProjectStore.setState({
      currentProject: makeProject([
        makeClip('c1', { in: 0, out: 4, start: 0 }),
        makeClip('c2', { in: 0, out: 4, start: 4 }),
        makeClip('c3', { in: 0, out: 4, start: 8 })
      ])
    })
    useTimelineStore.setState({ selection: ['c2'] })

    expect(useTimelineStore.getState().rippleDeleteSelected()).toBe(true)

    const clips = useProjectStore.getState().currentProject!.tracks[0].clips
    expect(clips.map((c) => c.id)).toEqual(['c1', 'c3'])
    // c3 shifted left by c2's 4s duration to close the gap.
    expect(clips.find((c) => c.id === 'c3')!.start).toBe(4)
    expect(useTimelineStore.getState().selection).toEqual([])

    // Undo restores the original clip array (ordering + positions).
    useProjectStore.getState().undo()
    const restored = useProjectStore.getState().currentProject!.tracks[0].clips
    expect(restored.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
    expect(restored.find((c) => c.id === 'c3')!.start).toBe(8)
  })

  it('is a no-op when nothing is selected', () => {
    useProjectStore.setState({
      currentProject: makeProject([makeClip('c1', { in: 0, out: 4, start: 0 })])
    })
    useTimelineStore.setState({ selection: [] })

    expect(useTimelineStore.getState().rippleDeleteSelected()).toBe(false)
    expect(useProjectStore.getState().currentProject!.tracks[0].clips).toHaveLength(1)
    expect(useProjectStore.getState().canUndo()).toBe(false)
  })

  it('is a no-op when no project is open', () => {
    expect(useProjectStore.getState().currentProject).toBeNull()
    expect(useTimelineStore.getState().rippleDeleteSelected()).toBe(false)
  })
})

describe('caption text edit preserves timing + Re-sync (P4.10)', () => {
  /** Two-sentence fixture: a >0.7s pause forces a block break → 2 caption lines. */
  const TRANSCRIPT: Transcript = {
    language: 'en',
    words: [
      { text: 'Hello', start: 0.5, end: 0.92 },
      { text: 'there', start: 1.0, end: 1.4 },
      { text: 'world.', start: 1.45, end: 2.0 },
      // 0.95s gap (> 0.7s default) → forces a new block/line here.
      { text: 'How', start: 2.95, end: 3.2 },
      { text: 'are', start: 3.25, end: 3.5 },
      { text: 'you', start: 3.55, end: 3.9 },
      { text: 'today?', start: 3.95, end: 4.6 }
    ]
  }

  /** A project whose Caption track is generated from {@link TRANSCRIPT}. */
  function projectWithCaptions(): Project {
    const clips = buildCaptionClipsFromTranscript(TRANSCRIPT, () => crypto.randomUUID())
    const base = makeProject([])
    return {
      ...base,
      tracks: [...base.tracks, { id: CAPTION_TRACK_ID, type: 'text', clips }]
    }
  }

  function captionClips(): Clip[] {
    const project = useProjectStore.getState().currentProject!
    return project.tracks.find((t) => t.id === CAPTION_TRACK_ID)!.clips
  }

  it('editing a caption clip text updates lines but KEEPS clip.caption.words timing', () => {
    useProjectStore.setState({ currentProject: projectWithCaptions() })
    const first = captionClips()[0]
    const originalWords = first.caption?.words
    expect(originalWords).toBeDefined()
    expect(first.text?.lines).toEqual(['Hello there world.'])

    // Manual edit via the inline-edit commit path (textarea value → text.lines).
    useTimelineStore.getState().beginTextEdit(first.id)
    useTimelineStore.getState().commitTextEdit(first.id, 'Greetings, world!')

    const edited = captionClips()[0]
    // Text changed...
    expect(edited.text?.lines).toEqual(['Greetings, world!'])
    // ...but the per-word timing is byte-for-byte preserved.
    expect(edited.caption?.words).toEqual(originalWords)
    // And the clip's start/out (spoken boundaries) are untouched.
    expect(edited.start).toBe(first.start)
    expect(edited.out).toBe(first.out)
  })

  it('resyncCaptions regroups lines from the transcript and REPLACES the clips', () => {
    useProjectStore.setState({ currentProject: projectWithCaptions() })

    // Edit BOTH lines so re-sync clearly reverts the manual text.
    const before = captionClips()
    expect(before).toHaveLength(2)
    useTimelineStore.getState().beginTextEdit(before[0].id)
    useTimelineStore.getState().commitTextEdit(before[0].id, 'EDITED ONE')
    useTimelineStore.getState().beginTextEdit(before[1].id)
    useTimelineStore.getState().commitTextEdit(before[1].id, 'EDITED TWO')
    expect(captionClips().map((c) => c.text?.lines?.join(' '))).toEqual([
      'EDITED ONE',
      'EDITED TWO'
    ])

    const ids = useTimelineStore.getState().resyncCaptions()
    expect(ids).not.toBeNull()
    const after = captionClips()
    // Same number of grouped lines, regenerated FROM the transcript words
    // (manual edits discarded by design).
    expect(after).toHaveLength(2)
    expect(after.map((c) => c.text?.lines?.join(' '))).toEqual([
      'Hello there world.',
      'How are you today?'
    ])
    // New clips carry fresh ids (replace, not in-place mutate).
    expect(after.map((c) => c.id)).toEqual(ids)
    // Timing still aligned to spoken words. `out` is the clip DURATION (in===0),
    // so the on-screen END is start + out; the last line ends at 4.6.
    expect(after[0].start).toBe(0.5)
    expect(after[1].start + (after[1].out - after[1].in)).toBeCloseTo(4.6, 10)
    // Did not duplicate the Caption track.
    expect(
      useProjectStore.getState().currentProject!.tracks.filter((t) => t.id === CAPTION_TRACK_ID)
    ).toHaveLength(1)
  })

  it('resyncCaptions is one undoable step that restores the prior (edited) clips', () => {
    useProjectStore.setState({ currentProject: projectWithCaptions() })
    const original = captionClips()[0]
    useTimelineStore.getState().beginTextEdit(original.id)
    useTimelineStore.getState().commitTextEdit(original.id, 'MANUAL EDIT')

    const editedLines = captionClips().map((c) => c.text?.lines?.join(' '))
    expect(editedLines[0]).toBe('MANUAL EDIT')

    useTimelineStore.getState().resyncCaptions()
    expect(captionClips()[0].text?.lines).toEqual(['Hello there world.'])

    // Undo the re-sync → the manual edit comes back.
    useProjectStore.getState().undo()
    expect(captionClips().map((c) => c.text?.lines?.join(' '))).toEqual(editedLines)
  })

  it('respects grouping opts passed to resyncCaptions', () => {
    useProjectStore.setState({ currentProject: projectWithCaptions() })
    // A tiny line width forces every word onto its own line.
    const ids = useTimelineStore.getState().resyncCaptions({ maxCharsPerLine: 1 })
    expect(ids).toHaveLength(TRANSCRIPT.words.length)
  })

  it('resyncCaptions is a no-op (null) when the Caption track has no word timing', () => {
    // Project with a Caption track but a wordless clip (no caption surface).
    const base = makeProject([])
    const wordless: Clip = {
      id: 'plain',
      mediaRef: '',
      in: 0,
      out: 3,
      start: 0,
      transform: defaultTransform(),
      text: { lines: ['hi'], align: 'center' }
    }
    useProjectStore.setState({
      currentProject: {
        ...base,
        tracks: [...base.tracks, { id: CAPTION_TRACK_ID, type: 'text', clips: [wordless] }]
      }
    })
    expect(useTimelineStore.getState().hasCaptionTranscript()).toBe(false)
    expect(useTimelineStore.getState().resyncCaptions()).toBeNull()
    expect(useProjectStore.getState().canUndo()).toBe(false)
  })

  it('resyncCaptions is a no-op when there is no Caption track', () => {
    useProjectStore.setState({ currentProject: makeProject([]) })
    expect(useTimelineStore.getState().hasCaptionTranscript()).toBe(false)
    expect(useTimelineStore.getState().resyncCaptions()).toBeNull()
  })

  it('resyncCaptions is a no-op when no project is open', () => {
    expect(useProjectStore.getState().currentProject).toBeNull()
    expect(useTimelineStore.getState().hasCaptionTranscript()).toBe(false)
    expect(useTimelineStore.getState().resyncCaptions()).toBeNull()
  })
})

describe('healCaptionClipDurations (self-heal old caption clips)', () => {
  function captionClips(): Clip[] {
    const project = useProjectStore.getState().currentProject!
    return project.tracks.find((t) => t.id === CAPTION_TRACK_ID)!.clips
  }

  /** A caption clip stored in the OLD, buggy shape: out = ABSOLUTE end time. */
  function legacyCaptionClip(id: string, start: number, end: number): Clip {
    return {
      id,
      mediaRef: '',
      in: 0,
      out: end, // BUG: absolute end instead of duration.
      start,
      transform: defaultTransform(),
      text: { lines: ['x'], align: 'center' },
      caption: { words: [{ text: 'x', start, end }] }
    }
  }

  function projectWith(clips: Clip[]): Project {
    const base = makeProject([])
    return { ...base, tracks: [...base.tracks, { id: CAPTION_TRACK_ID, type: 'text', clips }] }
  }

  it('rewrites out from absolute-end to duration (out = lastWord.end - start)', () => {
    useProjectStore.setState({
      currentProject: projectWith([
        legacyCaptionClip('c1', 5, 6), // out was 6 (abs) → should become 1
        legacyCaptionClip('c2', 10, 12.5) // out was 12.5 (abs) → should become 2.5
      ])
    })
    useTimelineStore.getState().healCaptionClipDurations()
    const clips = captionClips()
    expect(clips[0].in).toBe(0)
    expect(clips[0].out).toBeCloseTo(1, 10)
    expect(clips[0].start + clips[0].out).toBeCloseTo(6, 10) // on-screen END
    expect(clips[1].out).toBeCloseTo(2.5, 10)
    expect(clips[1].start + clips[1].out).toBeCloseTo(12.5, 10)
    expect(useProjectStore.getState().isDirty).toBe(true)
  })

  it('is idempotent — a correctly-built caption clip is left untouched', () => {
    const built = buildCaptionClipsFromTranscript(
      { language: 'en', words: [{ text: 'hi', start: 2, end: 2.9 }] },
      () => 'c1'
    )
    useProjectStore.setState({ currentProject: projectWith(built) })
    const before = captionClips()[0]
    useTimelineStore.getState().healCaptionClipDurations()
    const after = captionClips()[0]
    expect(after).toEqual(before)
  })

  it('is a no-op when no project is open', () => {
    useProjectStore.setState({ currentProject: null })
    expect(() => useTimelineStore.getState().healCaptionClipDurations()).not.toThrow()
  })
})


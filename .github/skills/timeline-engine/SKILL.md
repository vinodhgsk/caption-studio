---
name: timeline-engine
description: The track/clip data model and timeline operations — snapping, ripple, split, drag-trim, keyframe lanes, and the single playhead clock. Use for any timeline editing logic.
---
# timeline-engine

## State (Zustand slice, mirrors project.json tracks[])
`tracks: Track[]`, `playhead: seconds`, `zoom: pxPerSec`, `snap: bool`, `selection: clipId[]`.

## Core operations (pure reducers, all undoable)
- `addClip / removeClip / moveClip(clipId, start)` — moveClip respects snapping.
- `trimClip(clipId, edge, delta)` — adjusts in/out + start; clamps to media bounds.
- `splitAtPlayhead(clipId)` — splits into two clips sharing media.
- `rippleDelete` / `rippleInsert` — shift downstream clips.
- snapping: snap to playhead, clip edges, markers, beats within `snapPx`.

## Playhead clock
- One authoritative clock (requestAnimationFrame in renderer). Preview and timeline both read it.
- Frame-accurate: `frame = round(t * fps)`; seek snaps to frame boundaries.

## Keyframe lanes
- Each clip has a lane; keyframes are `{t, props, ease}` sorted by t. Engine exposes `evalAt(clip,t)`.

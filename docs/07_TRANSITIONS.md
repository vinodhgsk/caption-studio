# 07 — Transitions

**Phase:** 9 · **Owning agent:** `transitions-agent` · **Skills:** `preview-compositor`, `ffmpeg-export`

## Goal
Implement a clip transition engine with presets (dissolve/crossfade, slide, zoom, glitch, and more), applied at clip boundaries, rendered identically in preview and export.

## Dependencies
- Doc 01 (timeline/preview), `preview-compositor`, `ffmpeg-export` (export-side parity).

## Data model touchpoints
- `clips[].transitions = { in:{presetId,duration,params}, out:{presetId,duration,params} }`; transitions overlap adjacent clips by `duration`.

## UI/UX spec
Transitions panel: preset gallery, drag a transition onto a clip edge or between two clips; duration slider; direction param for slide/zoom. Timeline shows a transition badge spanning the overlap region.

## Build prompts
```
PROMPT 7.1 — Define a Transition schema and engine: given two clips and an overlap window, blend their rendered frames via a transition function over normalized progress. Integrate with preview-compositor.
```
```
PROMPT 7.2 — Implement presets: dissolve/crossfade, slide (directional), zoom (in/out), glitch. Each is a frame-blend function of progress + params.
```
```
PROMPT 7.3 — Implement timeline UX: drop transition on a clip edge/junction, adjust duration by dragging the overlap, show a badge; persist to clips[].transitions.
```
```
PROMPT 7.4 — Implement export parity in ffmpeg-export: map each transition to an equivalent FFmpeg xfade/filtergraph so exported output matches preview (hand off verification to render-parity-agent).
```

## Acceptance criteria
- Transitions render smoothly in preview at the clip boundary.
- Duration/direction adjustable; persisted and undoable.
- Exported video matches preview for each transition.

## Test notes
Sample blend at progress {0,0.5,1}. Compare a few exported frames against preview snapshots per transition. Test back-to-back transitions on a track.

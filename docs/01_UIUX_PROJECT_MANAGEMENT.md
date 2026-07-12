# 01 — CapCut-Style UI/UX & Project Management

**Phase:** 2–3 · **Owning agents:** `feature-builder`, `positioning-layout-agent` · **Skills:** `electron-scaffold`, `timeline-engine`, `preview-compositor`, `frontend-design`

## Goal
Stand up the Electron shell and the two top-level screens — **Projects Home** and the **single unified Editor** (preview + timeline + contextual side panels) — matching CapCut Desktop's layout and interaction model with original assets.

## Dependencies
- Master plan Sections 3 (stack), 4 (data model), 5 (storage).
- Doc 09 (storage provider) for create/open/save.
- Skills: `electron-scaffold`, `timeline-engine`, `preview-compositor`.

## Data model touchpoints
- Reads/writes whole `project.json`.
- `settings` (fps, resolution, aspect, background), `tracks[]`, `clips[].transform` (x/y/scale/rotation/flipH/flipV/opacity/z), `clips[].start/in/out`.

## UI/UX spec
**Projects Home:** card grid/list — thumbnail, name, last-modified, duration, storage badge (Local / OneDrive). Actions: New, Open, Duplicate, Rename, Delete, Reveal in folder. New-project dialog: name, aspect ratio, fps, storage location.
**Editor shell (3 regions):** top toolbar (project name, undo/redo, export); center = Preview (transport: play/pause, frame step, playhead scrub, in/out, zoom-to-fit, quality toggle); bottom = multi-track Timeline (video/audio/text/effect tracks, ruler, zoom, snap toggle, ripple, split, drag-trim, keyframe lanes); right = contextual side panels switched by a left rail (Media, Text, Captions, Effects, Decorations, Animation, Transitions, Audio, Fonts, AI Tools, Presets, Export).
**Positioning/layout (this doc owns):** free drag on canvas, alignment snapping (center/edges), rotation handle (any angle), flip H/V, layer ordering (bring forward/send back via `transform.z`), multi-line text with manual breaks.

## Build prompts
```
PROMPT 1.1 — Using the electron-scaffold skill, create the Electron app: main + preload (contextIsolation on, no nodeIntegration) + React/TS renderer with Tailwind and the design tokens from the frontend-design skill. Add a typed IPC bridge stub. Verify it boots to a blank window.
```
```
PROMPT 1.2 — Build the Projects Home screen. Render project cards from storageProvider.listProjects() (stub provider for now). Implement New/Open/Duplicate/Rename/Delete/Reveal actions and a New-Project dialog (name, aspect, fps, storage location). Route selecting a project to the Editor.
```
```
PROMPT 1.3 — Build the Editor shell layout: top toolbar, center Preview region, bottom Timeline region, left rail + right contextual panel container. Wire panel switching. No editing logic yet — just the responsive 3-region layout matching the CapCut reference.
```
```
PROMPT 1.4 — Implement the Preview using the preview-compositor skill: a Canvas/WebGL surface that renders the composited frame at the current playhead, with transport controls (play/pause, frame-step, scrub, zoom-to-fit, quality toggle). Drive playback from a single playhead clock.
```
```
PROMPT 1.5 — Implement the Timeline using the timeline-engine skill: multi-track lanes, time ruler, zoom, snap toggle, ripple, split at playhead, drag-trim handles, and per-clip keyframe lane placeholders. Keep timeline state in a Zustand slice mapping 1:1 to tracks[]/clips[].
```
```
PROMPT 1.6 — Implement positioning & layout on the preview canvas (positioning-layout-agent): drag to move (writes transform.x/y), alignment snap guides, rotation handle (transform.rotation), flip H/V, layer ordering via transform.z, and multi-line text break editing. Persist to project.json.
```
```
PROMPT 1.7 — Wire undo/redo over the Zustand store (command stack) and connect Save to storageProvider.writeProject. Autosave on a debounce.
```

## Acceptance criteria
- App boots to Projects Home; can create, open, rename, duplicate, delete a project.
- Editor opens with working preview playback and a frame-accurate playhead.
- Timeline supports zoom, snap, split, drag-trim across multiple tracks.
- Clips can be moved/rotated/flipped/reordered on canvas and changes persist.
- Undo/redo and autosave work.

## Test notes
Unit: Zustand reducers (split, trim, reorder) and snapping math. Integration: open → edit → save → reopen round-trips project.json without drift. Visual: layout matches reference at 16:9, 9:16, 1:1.

# 13 — Export & Output

**Phase:** 12 · **Owning agent:** `export-agent` · **Skills:** `ffmpeg-export`, `subtitle-export`, `indic-text`

## Goal
Export the composited timeline to video with burn-in captions, plus sidecar subtitle export (SRT / VTT / ASS), with caption-length handling and output written to local or OneDrive. All subtitle files are UTF-8 and burn-in uses an Indic-capable font with HarfBuzz shaping so Tamil/Telugu/Malayalam/Kannada/Hindi render correctly (indic-text).

## Dependencies
- All render docs (preview must match export), Doc 09 (write output to storage), `ffmpeg-export`, `subtitle-export`.

## Data model touchpoints
- Reads whole `project.json`; writes to bundle `exports/`; uses `captions` + caption clips for subtitle files.

## UI/UX spec
Export panel: resolution/fps/format, "burn captions in" toggle, subtitle sidecar checkboxes (SRT/VTT/ASS), output location (Local/OneDrive), progress bar with cancel. Warn on caption-length limits if a tier cap applies.

## Build prompts
```
PROMPT 13.1 — Build the export job model: serialize the timeline into an FFmpeg filtergraph (clips, transforms, transitions, text overlays, effects) via ffmpeg-export; stream progress over IPC with cancel.
```
```
PROMPT 13.2 — Implement caption burn-in: render caption/text clips into the video via the same text pipeline used in preview (parity, including HarfBuzz Indic shaping with an Indic-capable font), or as an ASS overlay; verify alignment to audio.
```
```
PROMPT 13.3 — Implement subtitle sidecar export (subtitle-export): generate SRT, VTT, and ASS from caption clips/transcript with correct timecodes and styling (ASS carries style). Write UTF-8; ASS references/embeds an Indic-capable font for Tamil/Telugu/Malayalam/Kannada/Devanagari.
```
```
PROMPT 13.4 — Implement output writing via storageProvider.writeOutput to local or OneDrive; handle caption-length limits/warnings; finalize files in exports/.
```

## Acceptance criteria
- Exported video matches preview (verified by render-parity-agent).
- Burn-in captions align to audio; sidecar SRT/VTT/ASS have correct timecodes.
- Subtitle files are UTF-8 and Indic scripts (Tamil/Telugu/Malayalam/Kannada/Hindi) render correctly in burn-in and ASS.
- Output writes to local and OneDrive.

## Test notes
Compare sampled exported frames to preview snapshots. Validate SRT/VTT/ASS against a parser. Test cancel mid-export and large-project performance.

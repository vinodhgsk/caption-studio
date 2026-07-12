# 03 — Captions & Subtitle Styles (Premium Presets)

**Phase:** 5 · **Owning agent:** `caption-style-agent` (+ `autocaption-agent` for active-word sync) · **Skills:** `text-render`, `caption-sync`, `indic-text`

## Goal
Provide a one-click premium caption preset library (Karaoke Highlight, Pop by Word, Bounce, Typewriter, TikTok Classic, and more) plus word-by-word reveal, animated active-word highlight, sound-effect cues, lower thirds, and title cards.

## Dependencies
- Doc 02 (caption track + transcript for active-word timing), Doc 06 (animation), Doc 10 (color/stroke/shadow), Doc 14 (saving presets), Doc 16 (Indic scripts + default Tamil font).
- Skills: `text-render`, `indic-text` (complex-script shaping + grapheme clusters).

## Data model touchpoints
- `captions.styleId`; per-clip `text.*` (fill, stroke, shadow, decoration, effects); `animation` for reveal; uses transcript word times for active-word highlight.

## UI/UX spec
Captions panel: scrollable preset gallery (live thumbnails), one click applies to the entire caption track. Sub-controls: position (lower third / center / custom), max lines, safe-margin. Toggles for word-by-word reveal and animated highlight (active word color). Bracketed sound-effect cue insertion (e.g. `[applause]`). Lower-thirds and title-card category presets (Game/Tech/Sports/Trending). All presets render with an Indic-capable default font (Tamil default) and word-by-word/typewriter reveal advances by **grapheme cluster** so Tamil/Indic text reveals correctly (indic-text).

## Build prompts
```
PROMPT 3.1 — Define a CaptionPreset schema (font, fill, stroke, shadow, decoration, in/out/loop animation, layout, highlight behavior) and a registry of built-in presets: Karaoke Highlight, Pop by Word, Bounce, Typewriter, TikTok Classic. Render preview thumbnails.
```
```
PROMPT 3.2 — Implement "apply preset to track": set captions.styleId and stamp the preset's text/* + animation onto every caption clip. Make it reversible via undo.
```
```
PROMPT 3.3 — Implement word-by-word reveal and animated active-word highlight driven by transcript word times: as the playhead crosses each word's start, the active word changes color/scale per the preset. Verify timing against audio.
```
```
PROMPT 3.4 — Implement sound-effect caption cues: detect/allow bracketed cues like [applause]; render them in the cue style; exclude from spoken-word highlight.
```
```
PROMPT 3.5 — Add lower-thirds and title-card preset categories (Game/Tech/Sports/Trending) with their own layout anchors and entrance animations.
```

## Acceptance criteria
- Any preset applies to the whole caption track in one click and is undoable.
- Active-word highlight tracks the audio within ±1 frame.
- Sound-effect cues render distinctly and are skipped by highlighting.
- Lower-thirds/title cards anchor correctly per aspect ratio.
- Presets render Tamil/Telugu/Malayalam/Kannada/Hindi/English correctly (shaping + grapheme-cluster reveal), with Tamil as the default.

## Test notes
Snapshot-render each preset on a sample line. Assert active-word index matches transcript at sampled playhead times. Verify safe margins at 9:16/16:9/1:1.

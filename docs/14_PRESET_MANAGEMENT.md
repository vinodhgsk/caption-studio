# 14 — Preset Management

**Phase:** 11 · **Owning agent:** `preset-manager-agent` · **Skill:** `preset-store`

## Goal
Let users save a customized text style (font, color, stroke, shadow, effects, decoration, animation) as a reusable preset, import community/third-party preset packs, and handle format-specific variants (9:16 / 16:9 / square) to avoid cropping.

## Dependencies
- Docs 04/05/06/08/10 (the style fields), Doc 03 (caption presets), `preset-store`.

## Data model touchpoints
- `presets.savedStyleIds[]`; a preset captures the `text.*` + `animation` subtree; format-specific layout anchors.

## UI/UX spec
Presets panel: "Save current style as preset" (name + thumbnail), saved-preset gallery (apply/rename/delete), import preset pack (file), and per-aspect variant selector (9:16/16:9/square) shown when applying.

## Build prompts
```
PROMPT 14.1 — Define a Preset schema (captured text/* + animation subtree + format variants) and a preset store (save/list/apply/delete) via preset-store, persisted to user-level storage and/or the bundle.
```
```
PROMPT 14.2 — Implement "save current style as preset": snapshot the selected clip's style/animation, capture a thumbnail, store it.
```
```
PROMPT 14.3 — Implement applying a preset to a selected clip or whole caption track, resolving the correct format-specific variant for the project aspect.
```
```
PROMPT 14.4 — Implement preset pack import (validated schema) and export; gallery management (rename/delete); guard against unsafe/unsupported fields.
```

## Acceptance criteria
- Save → apply reproduces the exact style/animation on another clip.
- Format-specific variants apply correct layout per aspect ratio.
- Import/export of packs works with schema validation.

## Test notes
Round-trip save→apply and assert field equality. Apply same preset at 9:16/16:9/1:1 and verify no cropping. Reject malformed imported packs.

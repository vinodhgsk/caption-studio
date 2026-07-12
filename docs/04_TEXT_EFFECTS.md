# 04 — Text Effects

**Phase:** 7 · **Owning agent:** `text-effects-agent` · **Skill:** `text-render`

## Goal
Implement layered text effects: glow, neon glow, glitch (RGB split / digital distortion), 3D depth, retro/vintage, blur, and echo/double-exposure — as presets with adjustable parameters.

## Dependencies
- Doc 01 (preview compositor), Doc 10 (color/stroke/shadow base styling).
- Skill: `text-render` (shader/canvas primitives).

## Data model touchpoints
- `text.effects[] = { type: "glow|neon|glitch|3d|retro|blur|echo", params }`.

## UI/UX spec
Effects panel: effect gallery with on/off per effect, parameter sliders (intensity, blur radius, color, offset, RGB-split distance, depth, grain). Effects stack in order; live preview on the canvas.

## Build prompts
```
PROMPT 4.1 — In text-render, add a composable text-effects pipeline (ordered list applied over the base glyph layer). Define a TextEffect schema with type + params and a renderer hook per type.
```
```
PROMPT 4.2 — Implement glow and neon (soft luminous halo; neon = tighter core + saturated bloom) with intensity, radius, and color params.
```
```
PROMPT 4.3 — Implement glitch: RGB channel split + scanline/jitter distortion with split-distance and frequency params.
```
```
PROMPT 4.4 — Implement 3D depth (extruded offset layers), retro/vintage (palette + grain + slight chroma), blur (layer Gaussian), and echo/double-exposure (offset translucent copies).
```
```
PROMPT 4.5 — Wire the Effects panel: gallery, per-effect toggle + sliders, drag to reorder stack; persist to text.effects[]; verify export parity with render-parity-agent later.
```

## Acceptance criteria
- Each effect renders in preview and stacks correctly in order.
- Parameters update live and persist to project.json.
- Effects survive save/reload and match on export.

## Test notes
Golden-image snapshots per effect at fixed params. Test stacking order (glow under glitch vs over). Verify performance with multiple effects on one clip.

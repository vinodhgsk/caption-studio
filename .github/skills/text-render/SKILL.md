---
name: text-render
description: The shared text rendering pipeline — glyph layout/metrics, fill (solid/gradient/per-word), stroke stacking, shadow (drop/inner/long), effects (glow/neon/glitch/3d/retro/blur/echo), decorations, and per-character/word animation hooks. Used by preview AND export for parity.
---
# text-render

## Layout
- Shape text into lines/runs/glyphs with metrics (advance, ascent/descent). Honor letterSpacing, lineHeight, alignment, manual breaks, and arc/curve.
- Expose per-glyph and per-word boxes (needed by decorations, highlights, animation staggering).
- **Indic-first:** shape complex scripts (Tamil/Telugu/Malayalam/Kannada/Devanagari) via HarfBuzz and segment by **grapheme clusters** for all per-character work; resolve a per-script font fallback (the default family renders Tamil). See `indic-text`.

## Pipeline (ordered, composable)
1. measure → 2. decoration.background → 3. shadow → 4. fill → 5. stroke layers → 6. effects stack → 7. apply animation transforms.

## Schemas
fill `{type,value,opacity}`; stroke `[{color,width}]`; shadow `{color,opacity,blur,angle,distance,inner,long}`; effect `{type,params}`; decoration `{background,underline,strike,highlight,emoji[]}`.

## Headless mode
Must render to an offscreen surface identically to on-canvas so ffmpeg-export can bake frames. No DOM dependencies in the core.

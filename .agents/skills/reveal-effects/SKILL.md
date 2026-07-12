---
name: reveal-effects
description: Kinetic text-reveal primitives — animated frame/border, swipe & stripe wipes, typewriter caret, masked slide, glossy sheen sweep, appear-by staggering, stomp impact, and curtain split. Drives the nine reveal effects in preview AND export for parity.
---
# reveal-effects

## Purpose
Time-driven, mask-based text reveals that sit between `text-render` (visual treatment) and the `keyframe-engine` animation evaluator (timing). Each effect turns clip-local time into a reveal of the base glyph layer plus optional overlay geometry. They are richer than the plain In presets in Doc 06: they add masks, sweeping bars, borders, and sheen rather than only transforming the whole block.

## The nine effects
- **Frame** — an animated rectangular border draws around the measured text box (thickness, color, corner radius, padding, draw direction cw/ccw); optionally gate the text reveal until the frame closes.
- **Swipe** — a solid color bar sweeps across the box (L/R/T/B); glyphs are revealed via a clip mask in the bar's wake (bar color, width, softness).
- **Type** — typewriter character reveal with a blinking caret; speed = `duration ÷ glyphCount` (caret toggle/color; optional key-tick cue).
- **Slide** — masked directional slide: units translate in from an offset while clipped to their final box (L/R/T/B; unit char/word/line; overshoot). Distinct from plain Slide-In, which has no clip mask.
- **Glossy** — a specular sheen band sweeps diagonally across the already-visible filled glyphs (angle, band width, intensity, color); one-shot or looping glint.
- **Appear by** — staggered fade+scale reveal by Character / Word / Line (per-unit stagger and ease).
- **Stomp** — impact entrance: units slam from large scale + blur down to a settled 1.0 with squash/overshoot; beat-syncable, usually per word.
- **Stripe** — parallel diagonal stripe bars wipe across to reveal text sequentially (stripe count, angle, gap, direction, color).
- **Curtain** — curtain-open mask reveal splitting from center / top / bottom / sides (softness, direction).

## Engine
Each effect is a pure function `(progress|time, layoutBoxes, params) → { mask, perUnit[], overlays[] }`:
- One-shot reveals are functions of normalized progress `p ∈ [0,1]` over `duration`; **Glossy** and any loop variant are functions of time scaled by `speed`.
- `unit` = char|word|line consumes the per-glyph / per-word / per-line boxes exposed by `text-render`; easing comes from `keyframe-engine`.
- Output composes over the base glyph layer; overlays (frame border, swipe bar, sheen band, stripes, curtain panels) draw within the effect stack so they stack predictably with Doc 04 effects and Doc 05 decorations.

## Schema
`clips[].animation.reveal = { effectId:"frame|swipe|type|slide|glossy|appearBy|stomp|stripe|curtain", params, unit:"char|word|line", direction:"l|r|t|b|center", duration, ease }`.

## Determinism / parity
Pure function of (progress|time, layout, params) — no DOM access, no randomness (seed any jitter from params). The offscreen render must match on-canvas exactly so `ffmpeg-export` bakes identical frames. Sample parity at `p ∈ {0, .25, .5, .75, 1}` and assert loop continuity for Glossy at the wrap.

# 10 — Color & Fill, Stroke & Outline, Shadow

**Phase:** 6 · **Owning agents:** `color-fill-agent`, `stroke-outline-agent`, `shadow-agent` · **Skill:** `text-render`

## Goal
Implement static text styling: color & fill (solid/gradient, per-word override, opacity), stroke/outline (color, thickness, multi-layer stacking, hollow/outline-only), and shadow (drop/inner/long; color, opacity, blur, angle, distance).

## Dependencies
- Doc 01 (preview), Doc 08 (glyph metrics), `text-render`.

## Data model touchpoints
- `text.fill = {type:"solid|gradient", value, opacity}`; `text.runs[].color` (per-word); `text.stroke = [{color,width}]`; `text.shadow = {color,opacity,blur,angle,distance,inner,long}`.

## UI/UX spec
Color panel: fill type (solid/gradient), hex picker + gradient stops, opacity, per-word color (select word → color). Stroke panel: toggle, color, thickness slider, "add stroke layer" (stacking), hollow toggle. Shadow panel: toggle, color, opacity, blur, angle (±180°), distance, inner/long toggles.

## Build prompts
```
PROMPT 10.1 — Implement fill in text-render: solid + gradient (multi-stop) with opacity. Support per-word color via text.runs[].color overriding the base fill.
```
```
PROMPT 10.2 — Implement stroke: single stroke (color+width), multiple stacked stroke layers rendered outside-in for depth, and hollow/outline-only mode (transparent body).
```
```
PROMPT 10.3 — Implement shadow: drop shadow (color/opacity/blur/angle/distance), inner shadow, and long shadow (extended flat offset). Render order: shadow → fill → stroke → effects.
```
```
PROMPT 10.4 — Wire Color/Stroke/Shadow panels; persist to text.fill/runs/stroke/shadow; ensure render order is consistent and matches export.
```

## Acceptance criteria
- Solid + gradient fills and per-word color render and persist.
- Multiple stroke layers and hollow mode work.
- Drop/inner/long shadows render with correct angle/distance/blur.

## Test notes
Snapshot gradient + per-word color. Verify stroke stacking order. Test shadow angle across ±180° and long-shadow extension. Confirm render order vs effects.

# 06 — Text Animation (In / Out / Loop)

**Phase:** 8 · **Owning agent:** `text-animation-agent` · **Skills:** `text-render`, `keyframe-engine`, `indic-text`

## Goal
Implement the In (entrance), Out (exit), and Loop (continuous) animation preset libraries with duration/speed control and per-character/word reveal and easing.

## Dependencies
- Doc 01 (playhead clock), Doc 08 (per-glyph layout), `keyframe-engine` (easing/interp).

## Data model touchpoints
- `clips[].animation = { in:{presetId,duration,ease}, out:{presetId,duration,ease}, loop:{presetId,speed} }`.

## UI/UX spec
Animation panel: three tabs (In / Out / Loop), preset galleries with live thumbnails, duration slider (In/Out), speed slider (Loop), per-character vs per-word toggle, easing dropdown.
**In presets:** Fade, Zoom, Typewriter, Slide (L/R/T/B), Bounce, Flip, Fold, Pop/Scale-up, Blur, Glitch, Spin, Scream(elastic).
**Out presets:** Fade, Zoom, Slide, Bounce, Glitch, Blur, Flip, Fold, Shrink.
**Loop presets:** Wave, Bounce, Shake, Pulse/Breathe, Spin, Flicker, Float/Drift, Donut.

## Build prompts
```
PROMPT 6.1 — Define an Animation schema (in/out/loop with presetId + timing + ease) and an animation evaluator that, given local clip time, returns transform/opacity/per-glyph offsets. Use keyframe-engine easing.
```
```
PROMPT 6.2 — Implement all In presets as functions of normalized progress (0→1) over `in.duration`, supporting per-character (**grapheme-cluster**, Indic-aware via indic-text) and per-word staggering (e.g. Typewriter, Slide, Bounce).
```
```
PROMPT 6.3 — Implement all Out presets over the clip's trailing `out.duration`.
```
```
PROMPT 6.4 — Implement all Loop presets as continuous functions of time scaled by `loop.speed` (Wave, Shake, Pulse, Spin, Flicker, Float, Donut, Bounce).
```
```
PROMPT 6.5 — Wire the Animation panel (tabs, galleries, sliders, per-char/word toggle, easing); persist to clips[].animation; verify in preview and that timing composes with effects.
```

## Acceptance criteria
- Each In/Out/Loop preset renders correctly and respects duration/speed.
- Per-character and per-word staggering work (per-character = grapheme cluster, so Tamil/Indic clusters animate as single units).
- Animations compose with effects/decorations without conflict.

## Test notes
Sample the evaluator at progress {0,0.25,0.5,0.75,1} and assert expected transform/opacity. Snapshot per preset mid-animation. Verify loop continuity (no jump at wrap).

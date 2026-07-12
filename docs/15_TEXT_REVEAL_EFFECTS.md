# 15 — Animated Text Reveal Effects

**Phase:** 8.5 · **Owning agent:** `text-reveal-agent` · **Skills:** `reveal-effects`, `text-render`, `keyframe-engine`, `indic-text`

## Goal
Implement nine kinetic, mask/sweep/border-driven text-reveal effects — **Frame, Swipe, Type, Slide, Glossy, Appear by, Stomp, Stripe, Curtain** — as presets with adjustable parameters. These extend the plain In presets in Doc 06 by adding animated masks, sweeping bars, borders, and sheen rather than only transforming the whole text block.

## Dependencies
- Doc 04 (text effects pipeline / stacking), Doc 06 (animation evaluator + per-char/word stagger), Doc 08 (per-glyph/word/line layout boxes), Doc 01 (playhead clock).
- Skills: `reveal-effects` (reveal primitives), `text-render` (glyph layer + boxes), `keyframe-engine` (easing/interp), `indic-text` (grapheme clusters so `unit:"char"` reveals Tamil/Indic clusters as single units).
- Optional: Doc 11 `beat-sync-agent` for Stomp impact snapping.

## Data model touchpoints
- `clips[].animation.reveal = { effectId:"frame|swipe|type|slide|glossy|appearBy|stomp|stripe|curtain", params, unit:"char|word|line", direction:"l|r|t|b|center", duration, ease }`.
- The gallery's **named variants** (below) are one-click sugar that resolve to a base `effectId` + `params` (plus, where noted, an auto-set `text.decoration.*` or `text.effects[]` entry). Decoration/sheen color follows the text color by default.

## Effects
| Effect | Mechanics | Key params |
|---|---|---|
| Frame | Animated border draws around the text box; optionally gates text until closed | color, thickness, radius, padding, drawDir |
| Swipe | Color bar sweeps across; glyphs revealed in its wake via clip mask | barColor, barWidth, direction, softness |
| Type | Typewriter char reveal with blinking caret; speed = duration ÷ glyphCount | caret, caretColor, tickCue |
| Slide | Masked directional slide; units move from offset, clipped to final box | direction, unit, overshoot |
| Glossy | Specular sheen band sweeps diagonally across filled glyphs (one-shot/loop) | angle, bandWidth, intensity, color, speed |
| Appear by | Staggered fade+scale reveal by Character / Word / Line | unit, stagger, ease |
| Stomp | Units slam from large scale + blur to a settled 1.0 with squash/overshoot | unit, overshoot, blurIn, settle |
| Stripe | Parallel diagonal stripe bars wipe across to reveal sequentially | stripeCount, angle, gap, direction, color |
| Curtain | Curtain-open mask splits from center/top/bottom/sides | direction, softness |

## Named variant presets (one-click)
The gallery exposes these ready-made variants (wave-style pack); each stamps a base `effectId` with preset `params` (and any decoration/effect) onto `clips[].animation.reveal`. Per-letter variants (`swipe-word`, `appear-symbol`) operate on **grapheme clusters** (`indic-text`) so Tamil/Indic reveals as single units.

| Variant preset | Resolves to | Notes |
|---|---|---|
| `frame` | Frame | border draws around the box, then text appears inside |
| `swipe-bottom` / `swipe-top` / `swipe-left` / `swipe-right` | Swipe · `direction` b/t/l/r | bar sweeps from that edge |
| `swipe-word` | Swipe · `unit:"word"` | per-word mask, staggered |
| `type` | Type | typewriter + blinking caret |
| `slide-down` | Slide · `direction:"b"` | plain masked slide, no decoration |
| `slide-border` | Slide + `text.decoration.border` | border draws in synced with the slide |
| `slide-stripes` | Slide + `text.decoration.stripe` (2 bars) | text slides in framed between two stripe bars |
| `glossy-entrance` | Glossy (one-shot) | sheen sweep on appearance |
| `glossy-slide` | Glossy + Slide | sheen sweep composed with a slide-in |
| `appear-symbol` | Appear by · `unit:"char"` | smooth per-cluster fade + slight rise |
| `appear-word` | Appear by · `unit:"word"` | step per word |
| `stomp` | Stomp · `unit:"word"` | scale-down impact; beat-syncable |
| `stripe-top` | Stripe · `stripeCount:1` | single top bar |
| `stripe-slide` | Stripe · `stripeCount:2` | top + bottom bars slide in |
| `curtain` | Curtain · `direction` center/t/b | curtain-open mask; optional colored panels |

## UI/UX spec
Reveal Effects panel: gallery with live preview thumbnails; select one effect per clip; shared controls (unit char/word/line, direction, duration slider, easing dropdown) plus effect-specific sliders (e.g. Frame thickness/radius, Swipe bar width, Glossy angle/intensity, Stripe count/gap). Drag an effect onto a text/caption clip to apply; live preview on the canvas. Glossy exposes a loop toggle + speed.

## Build prompts
```
PROMPT 15.1 (P8R.1) — Define the reveal-effects engine: a kinetic-reveal evaluator that maps clip-local time → normalized progress p (or scaled time for loops) and returns { mask, perUnit[], overlays[] } composed over the base glyph layer from text-render, using keyframe-engine easing. Define the RevealEffect schema {effectId,params,unit,direction,duration,ease} and persist to clips[].animation.reveal.
```
```
PROMPT 15.2 (P8R.2) — Frame: an animated rectangular border that draws around the measured text box (color, thickness, corner radius, padding, draw direction cw/ccw), optionally gating the text reveal until the frame completes.
```
```
PROMPT 15.3 (P8R.3) — Swipe: a solid color bar that sweeps across the text box (L/R/T/B) and reveals glyphs in its wake via a clip mask (bar color, width, softness).
```
```
PROMPT 15.4 (P8R.4) — Type: typewriter character reveal with a blinking caret; speed derived from duration ÷ glyph count; caret toggle/color and optional key-tick cue.
```
```
PROMPT 15.5 (P8R.5) — Slide: masked directional slide reveal — units translate from an offset while clipped to their final box (direction L/R/T/B; unit char/word/line; overshoot). Distinct from plain Slide-In (no mask).
```
```
PROMPT 15.6 (P8R.6) — Glossy: a specular sheen band that sweeps diagonally across the filled glyphs (angle, band width, intensity, color); support one-shot and looping (speed) modes.
```
```
PROMPT 15.7 (P8R.7) — Appear by: staggered reveal by Character / Word / Line (fade + scale per unit with configurable stagger and ease).
```
```
PROMPT 15.8 (P8R.8) — Stomp: impact entrance — units slam from large scale + blur down to a settled 1.0 with squash/overshoot (usually per word; beat-syncable via beat-sync-agent).
```
```
PROMPT 15.9 (P8R.9) — Stripe: parallel diagonal stripe bars that wipe across to reveal the text sequentially (stripe count, angle, gap, direction, color).
```
```
PROMPT 15.10 (P8R.10) — Curtain: a curtain-open mask reveal that splits from center / top / bottom / sides with adjustable softness.
```
```
PROMPT 15.11 (P8R.11) — Wire the Reveal Effects panel: gallery with live thumbnails, shared + per-effect params, the named one-click variants (see “Named variant presets” above, decoration color defaulting to text color), drag onto a text/caption clip; persist to clips[].animation.reveal; verify headless export parity with render-parity-agent.
```

## Acceptance criteria
- Each of the nine effects renders in preview, respects `duration`/`ease`, and (where relevant) `unit` and `direction`.
- Reveals compose with Doc 04 effects and Doc 05 decorations without conflict and persist to project.json.
- Effects survive save/reload and match on export (headless parity).

## Test notes
Sample the evaluator at progress {0, 0.25, 0.5, 0.75, 1} and assert expected mask coverage / per-unit opacity. Snapshot each effect mid-reveal. Verify Glossy loop continuity at the wrap, Type caret blink phase, and Stomp settle landing at scale 1.0.

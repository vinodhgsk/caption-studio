# 17 — Community-Reference Text Animations

**Phase:** 8.6 · **Owning agent:** `community-animation-agent` · **Skills:** `reveal-effects`, `text-render`, `keyframe-engine`, `indic-text`

> ⚠️ **Best-guess specs — confirm against the source pens.** The animations below were requested via CodePen links. The pens are behind Cloudflare bot verification and could not be read directly, so each "Behavior" is a **best-guess based on the author's known work** and must be confirmed/corrected against the source. The plan structure (registry, params, build prompts, parity) holds regardless of the exact effect.

> 🛠 **Recreation recipes:** [`COMMUNITY_ANIMATION_RECIPES.md`](COMMUNITY_ANIMATION_RECIPES.md) is the implementation-level companion to this doc — per-glyph math, parameter tables with defaults, reference CSS sketches, and the Canvas/WebGL mapping for each of the six presets. Implement each `P8C.*` prompt against its recipe section.

## Goal
Add a curated gallery of seventeen community-inspired kinetic text animations as selectable presets. Each is registered under a `community/` namespace and **composes existing primitives** (the Doc 06 animation evaluator, the Doc 15 reveal engine, Doc 04 effects, Doc 10 gradient fill) wherever possible, adding new mechanics only where required. Per-letter work is grapheme-cluster-aware (Indic-first, Doc 16).

## Source pens & best-guess mapping
| # | Preset id | Source (to confirm) | Best-guess behavior | Builds on |
|---|---|---|---|---|
| 1 | `community/wave-ripple` | https://codepen.io/nefejames/pen/JoPPBxK | Per-letter sine-wave ripple — staggered vertical bob across the word | Doc 06 loop evaluator + per-glyph stagger |
| 2 | `community/glitch-split` | https://codepen.io/nefejames/pen/azooadB | Glitch — RGB channel split + jitter/scanline distortion | Doc 04 `glitch` effect + Doc 06 in |
| 3 | `community/typewriter-caret` | https://codepen.io/yemon/pen/YrPmQr | Typewriter character reveal with a blinking caret | Doc 15 `Type` reveal |
| 4 | `community/kinetic-3d` | https://codepen.io/amit_sheen/pen/wvORNYm | Per-letter 3D rotation / extruded depth wave (kinetic 3D type) | **new** 3D per-letter transform + keyframe-engine |
| 5 | `community/scramble-decode` | https://codepen.io/robjoeol/pen/WNywdEW | Random-character scramble resolving to the final text (decode) | **new** scramble mechanic + grapheme clusters |
| 6 | `community/gloss-sweep` | https://codepen.io/ostylowany/pen/vYzPVZL | Animated gloss / sheen band sweeping across the letters | Doc 15 `Glossy` reveal |
| 7 | `community/mask-line-rise` | https://codepen.io/jpbelley/pen/gbwdzwa | Line-by-line masked slide-up reveal (lines emerge from a clip edge) | Doc 15 Slide/mask reveal |
| 8 | `community/elastic-word-pop` | https://codepen.io/jpbelley/pen/PwGBZBJ | Per-word elastic spring scale-in with overshoot + rotation kick | Doc 06 `in` (elastic) |
| 9 | `community/focus-blur-in` | https://codepen.io/Muhammad-Ibrar-the-sans/pen/RNNwdqw | Pull-focus: wide-tracked blur resolves into crisp text | Doc 06 Blur in + Doc 04 blur |
| 10 | `community/char-drop-tumble` | https://codepen.io/11elevenpasteleven11/pen/xbOwgjg | Letters fall in with a seeded random tumble and settle | Doc 06 in + per-glyph stagger |
| 11 | `community/shimmer-gradient` | https://codepen.io/dermalhealth/pen/YPybzva | Animated multi-stop gradient flows through the text fill | Doc 10 gradient fill (animated) |
| 12 | `community/jelly-squash` | https://codepen.io/tortaruga/pen/dPPwGzZ | Gummy squash-and-stretch wobble (volume-conserving) | Doc 06 loop + non-uniform scale |
| 13 | `community/neon-flicker` | https://codepen.io/sunny_thakor/pen/KKYZvZr | Neon sign flickers on, then steady hum | Doc 04 glow/neon + seeded flicker |
| 14 | `community/liquid-fill` | https://codepen.io/KACTOPKA/pen/qBMeKeQ | Color floods up into the glyphs behind a wavy liquid surface | **new** wavy alpha-mask fill |
| 15 | `community/particle-assemble` | https://codepen.io/dotonion/pen/MWmMJXz | Letters assemble from scattered particles/dots | **new** seeded particle system |
| 16 | `community/perspective-slam` | https://codepen.io/jpbelley/pen/JjjeQZp | Title slams in from deep Z with skew + motion-blur, overshoots | `kinetic-3d` primitive + blur |
| 17 | `community/variable-weight-wave` | https://codepen.io/devinargenta/pen/BNOoVv | Weight/width wave morphs glyph outlines across the text | **new** variable-font axis animation |

## Dependencies
- Doc 06 (animation schema + evaluator + per-char/word stagger), Doc 15 (reveal engine), Doc 04 (glitch effect), Doc 08/16 (per-glyph layout + grapheme clusters), Doc 01 (playhead clock).
- Skills: `keyframe-engine` (easing/interp), `reveal-effects` (Type/Glossy primitives), `text-render` (glyph layer + boxes), `indic-text` (grapheme clusters).
- Recipes: [`COMMUNITY_ANIMATION_RECIPES.md`](COMMUNITY_ANIMATION_RECIPES.md) — the detailed per-preset recreation spec (math, params, CSS reference, render mapping).

## Data model touchpoints
- No schema change. Presets register under a `community/` namespace into the existing registries and are selected through the standard slots:
  - timed entrances/loops → `clips[].animation.in.presetId` / `clips[].animation.loop.presetId` = `"community/<id>"`.
  - mask/sweep reveals (typewriter-caret, gloss-sweep) → `clips[].animation.reveal.effectId` = `"community/<id>"`.
- Per-preset params live alongside the existing `params`/timing fields.

## UI/UX spec
A "Community" section in the Animation panel gallery (Doc 06) with live preview thumbnails for the seventeen presets; selecting one fills the appropriate In/Loop/Reveal slot. Shared controls (duration/speed, easing, per-char/word unit) plus per-preset params (see the recipe tables). Each card links its source pen for reference.

## Build prompts
```
PROMPT 17.1 (P8C.1) — Add a `community/` preset namespace that registers into the existing animation (Doc 06) and reveal (Doc 15) registries. Each preset is a function of progress/time returning transform/opacity/per-unit offsets (or a reveal mask), composing existing primitives; per-letter work uses grapheme clusters (indic-text). Render live thumbnails.
```
```
PROMPT 17.2 (P8C.2) — wave-ripple (nefejames/JoPPBxK, confirm): per-letter sine-wave vertical ripple with configurable amplitude, wavelength, and per-glyph stagger; loop-capable. Build on the Doc 06 loop evaluator. (Recipe: COMMUNITY_ANIMATION_RECIPES.md §1.)
```
```
PROMPT 17.3 (P8C.3) — glitch-split (nefejames/azooadB, confirm): RGB channel split + jitter/scanline distortion entrance; reuse the Doc 04 glitch effect with split-distance/frequency params over an entrance window. (Recipe §2.)
```
```
PROMPT 17.4 (P8C.4) — typewriter-caret (yemon/YrPmQr, confirm): typewriter character reveal with a blinking caret; reuse the Doc 15 Type reveal (caret color/blink, optional key-tick). (Recipe §3.)
```
```
PROMPT 17.5 (P8C.5) — kinetic-3d (amit_sheen/wvORNYm, confirm): per-letter 3D rotation/extruded-depth wave — a new 3D per-letter transform driven by the keyframe-engine (depth, axis, per-glyph phase); keep transforms animation-compatible and export-parity-safe. (Recipe §4.)
```
```
PROMPT 17.6 (P8C.6) — scramble-decode (robjoeol/WNywdEW, confirm): each grapheme cycles through random characters from a charset, settling to the final glyph on a staggered schedule (decode). New deterministic mechanic — seed randomness from params so preview and export match. (Recipe §5.)
```
```
PROMPT 17.7 (P8C.7) — gloss-sweep (ostylowany/vYzPVZL, confirm): animated gloss/sheen band sweeping diagonally across the filled glyphs; reuse the Doc 15 Glossy reveal (angle, band width, intensity, speed; one-shot or loop). (Recipe §6.)
```
```
PROMPT 17.8 (P8C.8) — mask-line-rise (jpbelley/gbwdzwa, confirm): line-by-line masked slide-up reveal; lines emerge from a per-line clip band, staggered. Reuse the Doc 15 Slide/mask reveal. (Recipe §7.)
```
```
PROMPT 17.9 (P8C.9) — elastic-word-pop (jpbelley/PwGBZBJ, confirm): per-word elastic spring scale-in with overshoot + damped rotation kick; easeOutElastic from keyframe-engine. (Recipe §8.)
```
```
PROMPT 17.10 (P8C.10) — focus-blur-in (Muhammad-Ibrar-the-sans/RNNwdqw, confirm): pull-focus — blur high→0 and letter-spacing wide→normal together; reuse Doc 04 blur + per-frame letterSpacing relayout. (Recipe §9.)
```
```
PROMPT 17.11 (P8C.11) — char-drop-tumble (11elevenpasteleven11/xbOwgjg, confirm): letters fall in with a seeded random rotation/offset and settle (easeOutBack); seed from (clipId,i) for parity. (Recipe §10.)
```
```
PROMPT 17.12 (P8C.12) — shimmer-gradient (dermalhealth/YPybzva, confirm): animated multi-stop gradient flows through the glyph-clipped fill; reuse the gradient-fill primitive with a time-driven offset; cyclic stops = seamless loop. (Recipe §11.)
```
```
PROMPT 17.13 (P8C.13) — jelly-squash (tortaruga/dPPwGzZ, confirm): gummy squash-and-stretch wobble with non-uniform scale + baseline origin and volume coupling; per-cluster phase. (Recipe §12.)
```
```
PROMPT 17.14 (P8C.14) — neon-flicker (sunny_thakor/KKYZvZr, confirm): neon glow flickers on via a seeded sequence, then steady hum; drive the Doc 04 neon/glow intensity. Seed so preview↔export blink identically. (Recipe §13.)
```
```
PROMPT 17.15 (P8C.15) — liquid-fill (KACTOPKA/qBMeKeQ, confirm): color floods up into the glyphs behind a wavy liquid surface; new analytic wavy alpha-mask compositing filled/empty glyph layers. (Recipe §14.)
```
```
PROMPT 17.16 (P8C.16) — particle-assemble (dotonion/MWmMJXz, confirm): letters assemble from scattered seeded particles converging to sampled glyph points; new particle layer, fully seeded, perf-budgeted. (Recipe §15.)
```
```
PROMPT 17.17 (P8C.17) — perspective-slam (jpbelley/JjjeQZp, confirm): title slams from deep Z with skew + decaying motion-blur and overshoot; reuse the kinetic-3d primitive + Doc 04 blur. (Recipe §16.)
```
```
PROMPT 17.18 (P8C.18) — variable-weight-wave (devinargenta/BNOoVv, confirm): a weight/width wave morphs glyph outlines via per-cluster variable-font axes; new text-render capability, re-shaped identically preview↔export (HarfBuzz variable instancing); graceful fallback for non-variable fonts. (Recipe §17.)
```
```
PROMPT 17.19 (P8C.19) — Wire the Community section into the Animation panel gallery: thumbnails, per-preset params, source-pen links; selecting a preset fills the correct In/Loop/Reveal slot and persists to clips[].animation.
```
```
PROMPT 17.20 (P8C.20) — Tests: sample each of the seventeen presets at progress {0,.25,.5,.75,1}; assert per-recipe QA (loop continuity, settle-to-identity, seeded determinism, fill correctness, variable-font shaping); verify headless export parity.
```

## Acceptance criteria
- All seventeen presets render in preview, respect timing/easing, and (where relevant) per-char/word unit and grapheme clusters.
- Presets compose with Doc 04 effects and Doc 05 decorations without conflict and persist via the existing `clips[].animation` slots.
- Presets with randomness (scramble-decode, char-drop-tumble, glitch-split, neon-flicker, particle-assemble) are seeded and deterministic, matching on export; `variable-weight-wave` shapes identically preview↔export.
- Each preset's behavior is confirmed against its source pen (or corrected) before its box is checked.

## Test notes
Sample evaluators at progress {0,0.25,0.5,0.75,1}. Assert per-preset behavior (see each recipe's QA in [`COMMUNITY_ANIMATION_RECIPES.md`](COMMUNITY_ANIMATION_RECIPES.md)): loop continuity (wave-ripple, gloss-sweep, shimmer-gradient, jelly-squash, variable-weight-wave); settle-to-identity entrances (elastic-word-pop, char-drop-tumble, focus-blur-in, kinetic-3d, perspective-slam, mask-line-rise); seeded determinism (scramble-decode, char-drop-tumble, glitch-split, neon-flicker, particle-assemble); fill correctness (liquid-fill empty→full, shimmer cyclic stops). Verify preview↔export parity for all. Re-verify against source pens once confirmed.

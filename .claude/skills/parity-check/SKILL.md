---
name: parity-check
description: Procedure and acceptance thresholds for verifying that the live preview is frame-faithful to the headless FFmpeg export, plus the determinism checks. Use after any change to the text-render / animation / reveal engine or a renderer, when setting up golden frames, or when debugging a preview-vs-export mismatch.
---
# parity-check

## The promise
"What you see is what you get." The live **preview compositor** (Canvas/WebGL) and the **headless FFmpeg export** must produce frame-faithful output because both consume the **same resolved draw list** produced by the pure engine (`text-render`, `keyframe-engine`, reveal/animation evaluators). The renderers only paint that list — they contain no animation/effect/layout math.

Given identical inputs (project.json + assets + font bytes), preview and export must match. When they diverge, the **export is canonical** (it is the final artifact): fix the engine and/or make the preview match the export — never loosen the test.

## Static determinism checks (fast — run first)
Adjust globs to the actual source layout once code exists (shared engine dir vs. the two renderers).

```bash
# 1) No nondeterminism in the engine render paths — must return NOTHING:
grep -rnE "Math\.random\(|Date\.now\(|performance\.now\(|new Date\(" shared/ \
  | grep -v "// allowed:"

# 2) No animation math in the painters — preview compositor & export renderer
#    should only switch on draw-command kind and paint:
grep -rniE "easeOut|easeIn|interpolate|lerp|Math\.(sin|cos)|/ *totalFrames|frame *\/" \
  src/preview/ src/export/        # any hit = likely PARITY violation (math leaked into a painter)

# 3) Indic safety — no raw code-point splitting on text:
grep -rnE "\.split\(''\)|\.charAt\(|codePointAt" shared/ \
  | grep -v cluster                # per-char logic must use the grapheme-cluster utility (see indic-text)
```

The **only** sanctioned randomness is a seeded PRNG (e.g. mulberry32), seeded from `(clipId, unitIndex, frameTick)` — never wall-clock. This is what makes glitch/scramble/char-drop/neon-flicker/particle-assemble reproducible (see `reveal-effects`, Doc 17 community presets).

## Golden-frame tests
Reference PNGs live under the engine golden dir, per preset/clip, at `t ∈ {0, .25, .5, .75, 1}` on a caption that **includes a Tamil line**.

```bash
npm run test:golden                 # render headless, diff vs committed references
npm run test:golden -- <preset>     # scope to one preset
npm run golden:update -- <preset>   # regenerate after an INTENTIONAL visual change
```
Always eyeball updated goldens — they are the visual source of truth; a wrong reference hides regressions forever.

## Cross-environment parity test
Render the same frames in the preview (headless Electron/Canvas) and via the FFmpeg export path, then diff.

```bash
npm run test:parity                 # all presets
npm run test:parity -- <preset>     # one preset
```

### Acceptance thresholds
- **SSIM ≥ 0.995** per frame (structural match).
- Max per-channel pixel delta within the documented tolerance; pin small anti-aliasing differences in the test config rather than loosening globally.
- **Determinism:** rendering the same seeded frame (particles/jitter/flicker) twice is byte-identical.

## Cluster-integrity test (Indic — release-blocking)
For known Tamil/Telugu/Malayalam/Kannada/Devanagari strings with conjuncts, assert the expected grapheme-cluster count and that **no** text animator, reveal, or karaoke/active-word highlight splits a cluster at any sampled `t`. See `indic-text`.

## When invoked, report
- **VERDICT:** PASS / FAIL.
- **Static checks:** any nondeterminism / painter-math / Indic-split hits (file:line).
- **Golden:** stale or missing references, by preset.
- **Parity:** min SSIM and worst frame, by preset.
- **Remediation:** prioritized list (P1 breaks parity/determinism, P2 stale golden, P3 style/coverage). Do **not** loosen thresholds to make a test pass.

Used by `render-parity-agent` and `capcut-parity-agent`; complements the `/parity-check` command.

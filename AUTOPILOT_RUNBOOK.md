# Autopilot Runbook — CapCut-Style Editor (Full Build Sequence)

> The single ordered list of atomic build prompts. Each `Px.y` is one self-contained task.
> `[agent-name]` = the specialist that executes it. Run top-to-bottom. `build-orchestrator`
> dispatches each prompt, the post-build-feature gate must pass, then the box is checked `[x]`.
>
> **How to run:** `/autopilot` (current phase) · `/autopilot all` · `/build-phase N` · `/next` (one prompt).
> State lives in `BUILD_STATE.json`. Specs live in `docs/NN_*.md`. Schema = docs/00 §4.

Legend: `[ ]` todo · `[x]` done · `[agent]` owner · (Doc NN) spec.

---

## Phase 0 — Foundation & Scaffold  (Doc 01 · skill: electron-scaffold)
- [x] **P0.1** `[feature-builder]` Init repo: package.json, TypeScript (strict), Vite, electron, electron-builder. Add scripts: dev, build, test, lint, format, package.
- [x] **P0.2** `[feature-builder]` Create the main process entry: BrowserWindow with contextIsolation:true, nodeIntegration:false, sandbox:true; load the renderer; basic app lifecycle (ready/quit).
- [x] **P0.3** `[feature-builder]` Create the preload bridge: `contextBridge.exposeInMainWorld('api', { invoke, on })`; no raw ipcRenderer leakage.
- [x] **P0.4** `[feature-builder]` Define `src/shared/ipc.ts`: a typed channel registry (discriminated union of {channel, request, response}) + an `invoke<T>` helper.
- [x] **P0.5** `[feature-builder]` Scaffold the React renderer: root, router (Home / Editor routes), Tailwind config.
- [x] **P0.6** `[ui-reviewer]` Add design tokens from the frontend-design skill (color, spacing, type scale, radius, dark theme) as CSS vars + Tailwind theme extension.
- [x] **P0.7** `[feature-builder]` Wire ESLint + Prettier + the post-edit hook; ensure `npx tsc --noEmit` passes on the empty app.
- [x] **P0.8** `[feature-builder]` Add Zustand and create an empty `editorStore` + `projectStore` with typed slices placeholders.
- [x] **P0.9** `[test-writer]` Add the test runner (vitest) + one smoke test that the app module imports cleanly.
- [x] **P0.10** `[feature-builder]` Boot to a blank window via `npm run dev`; commit. **Milestone 0: app boots.**

## Phase 1 — Storage Layer  (Doc 09 · skill: storage-provider)
- [x] **P1.1** `[storage-agent]` Define `StorageProvider` interface + `ProjectMeta`/`ProjectRef` types in shared.
- [x] **P1.2** `[storage-agent]` Implement the `.vproj` bundle layout helpers (project.json + media/ cache/ exports/ media/fonts/).
- [x] **P1.3** `[storage-agent]` LocalProvider: createProject (scaffold bundle) with atomic write (temp + rename).
- [x] **P1.4** `[storage-agent]` LocalProvider: listProjects (scan a root, read metadata), readProject, writeProject.
- [x] **P1.5** `[storage-agent]` LocalProvider: readMedia (stream) + writeOutput (to exports/).
- [x] **P1.6** `[storage-agent]` Wire storage over IPC (domain: storage) via the typed bridge.
- [x] **P1.7** `[storage-agent]` OneDriveProvider synced-folder mode: detect the local OneDrive path; reuse LocalProvider logic against it.
- [x] **P1.8** `[storage-agent]` OneDriveProvider Graph mode: MSAL device-code/PKCE auth in main; token cache. _(STUBBED — GraphOneDriveProvider throws "not implemented"; MSAL/Graph deferred.)_
- [x] **P1.9** `[storage-agent]` Graph mode: read/write bundle items via Graph drive API; upload/download media + exports. _(STUBBED — not implemented.)_
- [x] **P1.10** `[storage-agent]` Graph mode: local cache + reconcile on reconnect; offline read. _(STUBBED — not implemented.)_
- [x] **P1.11** `[storage-agent]` Conflict handling: detect via updatedAt/etag; last-write-wins + warning.
- [x] **P1.12** `[test-writer]` Tests: bundle round-trip, atomic-write interruption safety, local↔OneDrive move without loss. **Milestone 1: create/open/save local + OneDrive.**

## Phase 2 — Projects Home & Editor Shell  (Doc 01)
- [x] **P2.1** `[feature-builder]` Build the Projects Home layout: responsive card grid/list with empty + loading states.
- [x] **P2.2** `[feature-builder]` Project card: thumbnail, name, last-modified, duration, storage badge (Local/OneDrive).
- [x] **P2.3** `[feature-builder]` New-Project dialog: name, aspect (16:9/9:16/1:1), fps, language (default Tamil; choices ta/te/ml/kn/hi/en → settings.language/languages), storage location → storageProvider.createProject.
- [x] **P2.4** `[feature-builder]` Card actions: Open, Duplicate, Rename, Delete (confirm), Reveal in folder.
- [x] **P2.5** `[feature-builder]` Route Open → Editor with the selected ProjectRef; load project.json into projectStore.
- [x] **P2.6** `[feature-builder]` Editor shell: top toolbar (project name, undo/redo, Export), center Preview region, bottom Timeline region.
- [x] **P2.7** `[feature-builder]` Left rail + right contextual panel container; panel switching (Media, Text, Captions, Effects, Decorations, Animation, Transitions, Audio, Fonts, AI Tools, Presets, Export).
- [x] **P2.8** `[feature-builder]` Implement undo/redo as a command stack over the stores.
- [x] **P2.9** `[feature-builder]` Implement Save (writeProject) + debounced autosave + dirty indicator.
- [x] **P2.10** `[ui-reviewer]` Review Home + shell against docs/01 and tokens at 16:9/9:16/1:1. **Milestone 2: manage projects; editor opens.**

## Phase 3 — Timeline & Preview Core  (Doc 01 · skills: timeline-engine, preview-compositor)
- [x] **P3.1** `[feature-builder]` Timeline Zustand slice mirroring tracks[]/clips[]; selection, zoom, snap, playhead.
- [x] **P3.2** `[feature-builder]` Render multi-track lanes + time ruler; track headers (video/audio/text/effect); zoom control.
- [x] **P3.3** `[feature-builder]` Media import into a clip (video/image) → bundle media/ → clip on a track.
- [x] **P3.4** `[feature-builder]` Clip rendering on the timeline: position from start, width from duration, thumbnails/waveform strip.
- [x] **P3.5** `[feature-builder]` Drag to move clips with snapping (playhead, clip edges, markers).
- [x] **P3.6** `[feature-builder]` Drag-trim handles: adjust in/out + start; clamp to media bounds.
- [x] **P3.7** `[feature-builder]` Split at playhead; ripple delete; ripple insert.
- [x] **P3.8** `[feature-builder]` Single playhead clock (rAF); scrub by dragging the ruler; frame-snap seeking.
- [x] **P3.9** `[preview-compositor → feature-builder]` Preview Canvas/WebGL surface; render the composited frame at the playhead (video + image clips first).
- [x] **P3.10** `[feature-builder]` Transport controls: play/pause, frame-step, in/out, zoom-to-fit, quality toggle; bind to the clock.
- [x] **P3.11** `[positioning-layout-agent]` Canvas drag to move (transform.x/y) with alignment snap guides.
- [x] **P3.12** `[positioning-layout-agent]` Rotation handle (transform.rotation), flip H/V, opacity.
- [x] **P3.13** `[positioning-layout-agent]` Layer ordering via transform.z (bring forward / send back).
- [x] **P3.14** `[positioning-layout-agent]` Multi-line text + manual breaks editing on canvas.
- [x] **P3.15** `[test-writer]` Unit tests: split/trim/move reducers, snapping math, frame seek. **Milestone 3: edit video, scrub frame-accurately, transform clips.**

## Phase 4 — Audio & Auto-Caption (MP3 Word Sync)  (Doc 02 · skills: caption-sync, ffmpeg-export)
- [x] **P4.1** `[audio-agent]` Import MP3 into bundle media/; add an audio clip; volume/fade controls.
- [x] **P4.2** `[audio-agent]` Decode + render the audio waveform on the timeline.
- [x] **P4.3** `[audio-agent]` IPC + FFmpeg: normalize MP3 → 16kHz mono WAV in cache/.
- [x] **P4.4** `[autocaption-agent]` Define the STT provider interface `transcribe(wav)->{language,words[]}`; wire over IPC (domain: stt).
- [x] **P4.5** `[autocaption-agent]` Integrate whisper.cpp with --word-timestamps + language auto-detect; write cache/transcript.json; set captions.transcript/language.
- [x] **P4.6** `[autocaption-agent]` Implement word→line grouping (caption-sync): maxChars/line, maxLines, punctuation, pause gap → lines[].
- [x] **P4.7** `[autocaption-agent]` Generate the Caption track: a text clip per line with start/out from the group + default style.
- [x] **P4.8** `[autocaption-agent]` Auto-Caption panel: Generate button, language dropdown, grouping params, progress bar.
- [x] **P4.9** `[autocaption-agent]` Verify captions appear exactly when words are spoken (±1 frame) against the audio.
- [x] **P4.10** `[autocaption-agent]` Edit caption text preserving timing; explicit Re-sync (regroup from transcript) action.
- [x] **P4.11** `[remove-silence-agent]` Detect silence/filler from waveform+transcript; trim audio + ripple captions; undoable.
- [x] **P4.12** `[test-writer]` Tests with a known-script MP3 fixture: assert caption.start within ±1 frame; grouping boundary cases; mock STT. **Milestone 4: MP3 → captions land on the right words.**

## Phase 5 — Caption Styles (Premium Presets)  (Doc 03 · skill: text-render)
- [x] **P5.1** `[caption-style-agent]` Define the CaptionPreset schema (font, fill, stroke, shadow, decoration, in/out/loop animation, layout, highlight behavior).
- [x] **P5.2** `[caption-style-agent]` Built-in preset registry: Karaoke Highlight, Pop by Word, Bounce, Typewriter, TikTok Classic (+ room to add).
- [x] **P5.3** `[caption-style-agent]` Render live preview thumbnails for each preset in the Captions panel.
- [x] **P5.4** `[caption-style-agent]` Apply-preset-to-track: set captions.styleId, stamp text/* + animation onto every caption clip; undoable.
- [x] **P5.5** `[caption-style-agent]` Word-by-word reveal driven by transcript word times.
- [x] **P5.6** `[caption-style-agent]` Animated active-word highlight (active word changes color/scale as the playhead crosses it); verify ±1 frame.
- [x] **P5.7** `[caption-style-agent]` Sound-effect cues: detect/insert bracketed cues like [applause]; render in cue style; exclude from word highlight.
- [x] **P5.8** `[caption-style-agent]` Position controls: lower-third / center / custom; safe margins per aspect.
- [x] **P5.9** `[caption-style-agent]` Lower-thirds + title-card categories (Game/Tech/Sports/Trending) with anchors + entrance animations.
- [x] **P5.10** `[test-writer]` Snapshot each preset; assert active-word index vs transcript at sampled times. **Milestone 5: one-click premium captions with animated highlight.**

## Phase 6 — Fonts/Typography & Color/Stroke/Shadow  (Docs 08, 10 · skill: text-render)
- [x] **P6.1** `[typography-agent]` Font registry: bundled (incl. Indic-capable defaults for Tamil/Telugu/Malayalam/Kannada/Devanagari + Latin) + system fonts, categorized (sans/serif/script/decorative/cinematic), search, live previews, per-script fallback chain; Tamil-capable family is the global default.
- [x] **P6.2** `[typography-agent]` Custom font import (TTF/OTF) → bundle media/fonts/, register at runtime, reference by family; ensure it travels with the project.
- [x] **P6.3** `[typography-agent]` Typographic controls: size, bold, italic, letterSpacing, lineHeight in text-render layout.
- [x] **P6.4** `[typography-agent]` Expose per-glyph/per-word boxes from layout (needed by decorations/animation).
- [x] **P6.5** `[typography-agent]` Curved/arc text: lay glyphs along an arc controlled by text.font.curve; keep per-glyph transforms animation-compatible.
- [x] **P6.6** `[typography-agent]` AI font generator behind a provider (prompt → suggested families); selectable suggestions, no external IP baked in.
- [x] **P6.7** `[color-fill-agent]` Solid fill with hex picker + opacity in text-render.
- [x] **P6.8** `[color-fill-agent]` Gradient fill (multi-stop) with angle.
- [x] **P6.9** `[color-fill-agent]` Per-word color override via text.runs[].color.
- [x] **P6.10** `[stroke-outline-agent]` Single stroke (color + thickness slider).
- [x] **P6.11** `[stroke-outline-agent]` Multiple stacked stroke layers (outside-in) for depth.
- [x] **P6.12** `[stroke-outline-agent]` Hollow / outline-only mode (transparent body).
- [x] **P6.13** `[shadow-agent]` Drop shadow: color, opacity, blur, angle (±180°), distance.
- [x] **P6.14** `[shadow-agent]` Inner shadow + long shadow (extended flat offset).
- [x] **P6.15** `[shadow-agent]` Lock render order shadow→fill→stroke→effects in text-render.
- [x] **P6.16** `[ui-reviewer]` Wire Fonts + Color + Stroke + Shadow panels; persist to text.*.
- [x] **P6.17** `[typography-agent]` Indic-first fonts: bundle Indic-capable defaults (Tamil/Telugu/Malayalam/Kannada/Devanagari + Latin), set a Tamil-capable global default, resolve a per-script fallback chain (text.font.fallback). _(NOTE: catalog/default/fallback logic done + tested; physical media/fonts/ TTF bundling + @font-face/export registration is an open follow-up.)_
- [x] **P6.18** `[typography-agent]` Enable HarfBuzz complex-script shaping + grapheme-cluster segmentation in text-render (matras/conjuncts/reordering) with identical headless-export shaping (indic-text).
- [x] **P6.19** `[test-writer]` Tests: imported-font reload parity, gradient + per-word color snapshot, stroke stacking, shadow geometry across ±180°; Indic shaping + grapheme-cluster counts match preview↔export (Tamil கி, க்ஷி; Devanagari क्षि). **Milestone 6: full font + fill + stroke + shadow control, Indic scripts shape correctly.**

## Phase 7 — Text Effects & Decorations  (Docs 04, 05 · skill: text-render)
- [x] **P7.1** `[text-effects-agent]` Composable text-effects pipeline (ordered stack over the base glyph layer) + TextEffect schema.
- [x] **P7.2** `[text-effects-agent]` Glow + neon (intensity, radius, color).
- [x] **P7.3** `[text-effects-agent]` Glitch (RGB channel split + scanline/jitter; split-distance, frequency).
- [x] **P7.4** `[text-effects-agent]` 3D depth (extruded offset layers).
- [x] **P7.5** `[text-effects-agent]` Retro/vintage (palette + grain + slight chroma).
- [x] **P7.6** `[text-effects-agent]` Blur (layer Gaussian) + echo/double-exposure (offset translucent copies).

- [x] **P7.7** `[text-effects-agent]` Effects panel: gallery, per-effect toggle + sliders, drag to reorder stack; persist to text.effects[].
- [x] **P7.8** `[text-decoration-agent]` Background bubble: rect behind measured text box (color, opacity, padding, corner radius).
- [x] **P7.9** `[text-decoration-agent]` Underline + strikethrough (baseline-aware, scales with size).
- [x] **P7.10** `[text-decoration-agent]` Highlight bars (per-word or full-line) using run bounds.
- [x] **P7.11** `[text-decoration-agent]` Inline emoji in the run flow (correct advance/metrics, wraps + animates with text).
- [x] **P7.12** `[text-decoration-agent]` Decorations panel; persist to text.decoration; render beneath effects, above clip bg.
- [x] **P7.13** `[test-writer]` Golden-image snapshots per effect + decoration extremes; stacking order tests. **Milestone 7: effects + bubbles render in preview.**

## Phase 8 — Animation, Keyframes & Motion  (Docs 06, 11 · skills: keyframe-engine, motion-tracking)
- [x] **P8.1** `[text-animation-agent]` Animation schema + evaluator: clip-local time → transform/opacity/per-glyph offsets (keyframe-engine easing).
- [x] **P8.2** `[text-animation-agent]` In presets: Fade, Zoom, Typewriter, Slide(L/R/T/B), Bounce, Flip, Fold, Pop, Blur, Glitch, Spin, Scream — with per-char/word stagger.
- [x] **P8.3** `[text-animation-agent]` Out presets: Fade, Zoom, Slide, Bounce, Glitch, Blur, Flip, Fold, Shrink over trailing out.duration.
- [x] **P8.4** `[text-animation-agent]` Loop presets: Wave, Bounce, Shake, Pulse/Breathe, Spin, Flicker, Float/Drift, Donut (continuous, speed-scaled).
- [x] **P8.5** `[text-animation-agent]` Animation panel: In/Out/Loop tabs, galleries, duration/speed sliders, per-char/word toggle, easing dropdown; persist to clips[].animation.
- [x] **P8.6** `[keyframe-motion-agent]` Keyframe lane UX: add/move/delete diamonds; per-segment easing.
- [x] **P8.7** `[keyframe-motion-agent]` Keyframe-driven props: x/y/scale/rotation/opacity; evaluator drives the preview transform; persist to clips[].keyframes.
- [x] **P8.8** `[keyframe-motion-agent]` Custom motion path: draw on canvas, sample to a parametric path, drive the clip over its duration.
- [x] **P8.9** `[motion-tracking-agent]` Tracking provider integration: pick target (face/object), produce per-frame transforms → clip.tracking.path.
- [x] **P8.10** `[motion-tracking-agent]` Attach text to the tracked path in the compositor; manual anchor correction + jitter smoothing.
- [x] **P8.11** `[beat-sync-agent]` Beat detection from the audio track; expose beat markers to snapping.
- [x] **P8.12** `[beat-sync-agent]` Snap clip start/out + caption appearance to nearest beats.
- [x] **P8.13** `[test-writer]` Sample evaluator at progress {0,.25,.5,.75,1}; loop continuity; tracking on a known-motion clip; beats vs metronome. **Milestone 8: in/out/loop + keyframes + tracking + beat-sync.**

## Phase 8.5 — Animated Text Reveal Effects  (Doc 15 · skills: reveal-effects, text-render, keyframe-engine)
- [x] **P8R.1** `[text-reveal-agent]` Define the reveal-effects engine: clip-local time → progress p (or scaled time for loops) → `{ mask, perUnit[], overlays[] }` composed over the base glyph layer (text-render) with keyframe-engine easing. Define `RevealEffect {effectId,params,unit,direction,duration,ease}`; persist to `clips[].animation.reveal`.
- [x] **P8R.2** `[text-reveal-agent]` Frame: animated border draws around the measured text box (color, thickness, corner radius, padding, draw direction); optionally gate the text until the frame closes.
- [x] **P8R.3** `[text-reveal-agent]` Swipe: a color bar sweeps across the box (L/R/T/B); reveal glyphs in its wake via a clip mask (bar color, width, softness).
- [x] **P8R.4** `[text-reveal-agent]` Type: typewriter character reveal with a blinking caret; speed = duration ÷ glyph count; caret toggle/color + optional key-tick cue.
- [x] **P8R.5** `[text-reveal-agent]` Slide: masked directional slide — units translate from an offset while clipped to their final box (L/R/T/B; char/word/line; overshoot). Distinct from plain Slide-In.
- [x] **P8R.6** `[text-reveal-agent]` Glossy: a specular sheen band sweeps diagonally across the filled glyphs (angle, band width, intensity, color); one-shot or loop (speed).
- [x] **P8R.7** `[text-reveal-agent]` Appear by: staggered fade+scale reveal by Character / Word / Line (stagger, per-unit ease).
- [x] **P8R.8** `[text-reveal-agent]` Stomp: impact entrance — units slam from large scale + blur to a settled 1.0 with squash/overshoot (usually per word; beat-syncable).
- [x] **P8R.9** `[text-reveal-agent]` Stripe: parallel diagonal stripe bars wipe across to reveal text sequentially (stripe count, angle, gap, direction, color).
- [x] **P8R.10** `[text-reveal-agent]` Curtain: curtain-open mask reveal splitting from center / top / bottom / sides (softness, direction).
- [x] **P8R.11** `[text-reveal-agent]` Reveal Effects panel: gallery with live thumbnails, shared + per-effect params, drag onto a text/caption clip; expose the **named one-click variants** (swipe-bottom/top/left/right/word, slide-down/border/stripes, glossy-entrance/slide, appear-symbol/word, stripe-top/slide, curtain) with decoration color defaulting to the text color; persist to `clips[].animation.reveal`.
- [x] **P8R.12** `[test-writer]` Sample each effect at progress {0,.25,.5,.75,1}; assert mask coverage / per-unit opacity; Glossy loop continuity; Type caret blink; Stomp settle at scale 1.0; export parity. **Milestone 8.5: reveal effects (frame/swipe/type/slide/glossy/appear-by/stomp/stripe/curtain) render in preview and export.**

## Phase 8.6 — Community-Reference Text Animations  (Doc 17 · skills: reveal-effects, text-render, keyframe-engine, indic-text)
> Best-guess specs from external CodePen refs — confirm each against its source pen (linked in Doc 17) before checking its box.
- [x] **P8C.1** `[community-animation-agent]` Add a `community/` preset namespace registering into the existing animation (Doc 06) + reveal (Doc 15) registries; each composes existing primitives, per-letter = grapheme cluster (indic-text); live thumbnails.
- [x] **P8C.2** `[community-animation-agent]` wave-ripple (nefejames/JoPPBxK, confirm): per-letter sine-wave ripple — amplitude, wavelength, per-glyph stagger; loop-capable (Doc 06 loop evaluator). (Recipe §1.)
- [x] **P8C.3** `[community-animation-agent]` glitch-split (nefejames/azooadB, confirm): RGB-split + jitter/scanline entrance; reuse Doc 04 glitch (split-distance, frequency). (Recipe §2.)
- [x] **P8C.4** `[community-animation-agent]` typewriter-caret (yemon/YrPmQr, confirm): typewriter reveal + blinking caret; reuse Doc 15 Type (caret color/blink, key-tick). (Recipe §3.)
- [x] **P8C.5** `[community-animation-agent]` kinetic-3d (amit_sheen/wvORNYm, confirm): per-letter 3D rotation/extrude wave — new 3D per-letter transform via keyframe-engine (depth, axis, per-glyph phase); export-parity-safe. (Recipe §4.)
- [x] **P8C.6** `[community-animation-agent]` scramble-decode (robjoeol/WNywdEW, confirm): grapheme cycles random chars from a charset, settling to the final glyph on a staggered schedule; seed randomness so preview↔export match. (Recipe §5.)
- [x] **P8C.7** `[community-animation-agent]` gloss-sweep (ostylowany/vYzPVZL, confirm): animated gloss/sheen band sweeping across the glyphs; reuse Doc 15 Glossy (angle, width, intensity, speed). (Recipe §6.)
- [x] **P8C.8** `[community-animation-agent]` mask-line-rise (jpbelley/gbwdzwa, confirm): line-by-line masked slide-up reveal; lines emerge from a per-line clip band, staggered; reuse Doc 15 Slide/mask. (Recipe §7.)
- [x] **P8C.9** `[community-animation-agent]` elastic-word-pop (jpbelley/PwGBZBJ, confirm): per-word elastic spring scale-in with overshoot + damped rotation kick (easeOutElastic, keyframe-engine). (Recipe §8.)
- [x] **P8C.10** `[community-animation-agent]` focus-blur-in (Muhammad-Ibrar-the-sans/RNNwdqw, confirm): pull-focus — blur high→0 and letter-spacing wide→normal together; reuse Doc 04 blur + per-frame letterSpacing relayout. (Recipe §9.)
- [x] **P8C.11** `[community-animation-agent]` char-drop-tumble (11elevenpasteleven11/xbOwgjg, confirm): letters fall in with seeded random rotation/offset, settle (easeOutBack); seed (clipId,i) for parity. (Recipe §10.)
- [x] **P8C.12** `[community-animation-agent]` shimmer-gradient (dermalhealth/YPybzva, confirm): animated multi-stop gradient flows through the glyph-clipped fill; reuse gradient fill with time-driven offset; cyclic stops = seamless loop. (Recipe §11.)
- [x] **P8C.13** `[community-animation-agent]` jelly-squash (tortaruga/dPPwGzZ, confirm): gummy squash-and-stretch wobble — non-uniform scale, baseline origin, volume coupling, per-cluster phase. (Recipe §12.)
- [x] **P8C.14** `[community-animation-agent]` neon-flicker (sunny_thakor/KKYZvZr, confirm): neon glow flickers on via a seeded sequence then steady hum; drive the Doc 04 neon/glow intensity; seed so preview↔export blink identically. (Recipe §13.)
- [x] **P8C.15** `[community-animation-agent]` liquid-fill (KACTOPKA/qBMeKeQ, confirm): color floods up into the glyphs behind a wavy liquid surface; new analytic wavy alpha-mask compositing filled/empty glyph layers. (Recipe §14.)
- [x] **P8C.16** `[community-animation-agent]` particle-assemble (dotonion/MWmMJXz, confirm): letters assemble from scattered seeded particles converging to sampled glyph points; new seeded particle layer, perf-budgeted. (Recipe §15.)
- [x] **P8C.17** `[community-animation-agent]` perspective-slam (jpbelley/JjjeQZp, confirm): title slams from deep Z with skew + decaying motion-blur and overshoot; reuse kinetic-3d primitive + Doc 04 blur. (Recipe §16.)
- [x] **P8C.18** `[community-animation-agent]` variable-weight-wave (devinargenta/BNOoVv, confirm): weight/width wave morphs glyph outlines via per-cluster variable-font axes; new text-render capability re-shaped identically preview↔export (HarfBuzz variable instancing); fallback for non-variable fonts. (Recipe §17.)
- [x] **P8C.19** `[community-animation-agent]` Community section in the Animation panel: thumbnails, per-preset params, source-pen links; selecting fills the correct In/Loop/Reveal slot; persist to clips[].animation.
- [x] **P8C.20** `[test-writer]` Sample each of the seventeen presets at progress {0,.25,.5,.75,1}; assert per-recipe QA (loop continuity, settle-to-identity, seeded determinism, fill correctness, variable-font shaping); export parity. **Milestone 8.6: seventeen community-reference text animations render in preview and export (specs confirmed vs source pens).**

## Phase 9 — Transitions  (Doc 07 · skills: preview-compositor, ffmpeg-export)
- [x] **P9.1** `[transitions-agent]` Transition schema + engine: blend two clips over an overlap window by progress.
- [x] **P9.2** `[transitions-agent]` Presets: dissolve/crossfade, slide (directional), zoom (in/out), glitch.
- [x] **P9.3** `[transitions-agent]` Timeline UX: drop a transition on a clip edge/junction; drag the overlap to set duration; badge.
- [x] **P9.4** `[transitions-agent]` Persist to clips[].transitions; undoable.
- [x] **P9.5** `[transitions-agent]` Export parity: map each transition to an FFmpeg xfade/filtergraph equivalent.
- [x] **P9.6** `[render-parity-agent]` Compare exported frames vs preview per transition. **Milestone 9: transitions render in preview and export.**

## Phase 10 — AI Text Tools  (Docs 12, 16 · skills: tts-provider, transliteration, indic-text, caption-sync)
- [x] **P10.1** `[tts-agent]` TTS provider interface (listVoices, synthesize) wired over IPC (domain: tts).
- [x] **P10.2** `[tts-agent]` Generate VO from a selected text layer + voice (a voice for one of the six supported languages, Tamil default) → audio into media/ → audio clip on the timeline.
- [x] **P10.3** `[tts-agent]` Optional: return word timings from TTS to drive captions.
- [x] **P10.4** `[tts-agent]` Graceful disabled state when no provider is available.
- [x] **P10.5** `[translation-agent]` Translate caption lines/transcript to a target language (provider behind interface).
- [x] **P10.6** `[translation-agent]` Render translated line inline beneath the original on the caption track; persist captions.translation.
- [x] **P10R.1** `[transliteration-agent]` Transliteration engine (skill transliteration): any-to-any across {ta,te,ml,kn,hi,en} via a phonetic pivot; English↔Indic Romanization; behind a pluggable provider with a local default; persist captions.transliteration.
- [x] **P10R.2** `[transliteration-agent]` Transliteration tool in the AI Tools panel: source/target/scheme, inline vs replace, live preview, apply to a text layer or the whole caption track.
- [x] **P10R.3** `[transliteration-agent]` Romanized input: convert Latin typing to the selected Indic script on a text layer (the transliteration engine in reverse).
- [x] **P10.7** `[keyword-highlight-agent]` Auto-detect emphasis words from the transcript.
- [x] **P10.8** `[keyword-highlight-agent]` Apply per-word color via text.runs[].color; manual add/remove; persist captions.keywordHighlights.
- [x] **P10.9** `[feature-builder]` AI Tools panel assembling TTS + Translation + Transliteration + Keyword Highlight controls; every language dropdown defaults to Tamil and is limited to {ta,te,ml,kn,hi,en}.
- [x] **P10.10** `[test-writer]` Mock providers; assert translated-line timing matches source; highlighted indices map to transcript words; transliteration round-trips (ta→en→ta, ta↔hi) and Romanized input produces correct Tamil. **Milestone 10: TTS, inline translation, transliteration, AI keyword highlights.**

## Phase 11 — Preset Management  (Doc 14 · skill: preset-store)
- [x] **P11.1** `[preset-manager-agent]` Preset schema (style + animation subtree + format variants) + preset store (save/list/apply/delete).
- [x] **P11.2** `[preset-manager-agent]` Save current style as preset: snapshot the selected clip's style+animation, capture a thumbnail.
- [x] **P11.3** `[preset-manager-agent]` Apply preset to a clip or whole caption track, resolving the format variant for the project aspect.
- [x] **P11.4** `[preset-manager-agent]` Import preset packs (schema-validated; reject unknown/unsafe fields) + export.
- [x] **P11.5** `[preset-manager-agent]` Presets panel: gallery, apply/rename/delete, per-aspect variant selector.
- [x] **P11.6** `[test-writer]` Round-trip save→apply field equality; apply at 9:16/16:9/1:1 with no cropping; reject malformed packs. **Milestone 11: reusable presets per aspect ratio.**

## Phase 12 — Export & Output  (Doc 13 · skills: ffmpeg-export, subtitle-export)
- [x] **P12.1** `[export-agent]` Export job model: serialize timeline → FFmpeg inputs + filtergraph (trim/scale/rotate/opacity per clip).
- [x] **P12.2** `[export-agent]` Compose transitions (xfade/custom) + audio mix (amix) into the graph.
- [x] **P12.3** `[export-agent]` Bake text/captions via text-render headless and overlay frames for full effect parity.
- [x] **P12.4** `[export-agent]` Caption burn-in path; verify alignment to audio in the output.
- [x] **P12.5** `[export-agent]` Subtitle sidecars: SRT, VTT, ASS (ASS carries style) from caption clips/transcript.
- [x] **P12.6** `[export-agent]` Export panel: resolution/fps/format, burn-in toggle, sidecar checkboxes, output location, progress + cancel.
- [x] **P12.7** `[export-agent]` Write output via storageProvider.writeOutput to local or OneDrive; handle caption-length warnings.
- [x] **P12.8** `[render-parity-agent]` Diff sampled exported frames vs preview within threshold; validate SRT/VTT/ASS with a parser. **Milestone 12: end-to-end export to local/OneDrive.**

## Phase 13 — Hardening, Parity & Packaging
- [x] **P13.1** `[capcut-parity-agent]` Run /parity-check: every feature in CapCut_Text_and_Caption_Features.md maps to a doc and an implemented surface; fix gaps.
- [x] **P13.2** `[render-parity-agent]` Full preview↔export parity sweep across fonts, effects, transitions, animation timing.
- [x] **P13.3** `[test-writer]` Raise coverage on reducers, providers, and round-trips; add a few end-to-end smoke flows.
- [x] **P13.4** `[feature-builder]` Performance pass: virtualize the timeline, throttle preview renders, cache waveforms/thumbnails/transcripts.
- [x] **P13.5** `[feature-builder]` Large-project + long-MP3 stress test; fix memory/leak issues.
- [x] **P13.6** `[feature-builder]` Error handling + recovery: crash-safe autosave, corrupt-bundle recovery, offline OneDrive UX.
- [x] **P13.7** `[ui-reviewer]` Final UI polish vs the CapCut reference + accessibility (focus, contrast, keyboard).
- [x] **P13.8** `[feature-builder]` electron-builder config; package Windows + macOS; code-signing placeholders; auto-update stub.
- [x] **P13.9** `[feature-builder]` First-run + onboarding (storage choice, OneDrive connect, model download for STT/TTS).
- [x] **P13.10** `[feature-builder]` Wire pre-commit hook into CI; release checklist. **Milestone 13: shippable build.**

---

## Continuous / cross-cutting (run anytime a related change lands)
- [ ] **C.1** `[ui-reviewer]` Re-review any new panel against tokens before its milestone.
- [ ] **C.2** `[capcut-parity-agent]` Re-run /parity-check at the end of every phase.
- [ ] **C.3** `[render-parity-agent]` Re-validate export parity whenever the text-render or compositor pipeline changes.
- [ ] **C.4** `[test-writer]` Every prompt that adds behavior gets a test before its box is checked.

---

*End of runbook. `build-orchestrator` advances through these; the post-build-feature gate must pass before any box flips to `[x]`.*

# Master Plan — CapCut-Style Electron Video Editor

> **Phase scope:** This document and its companion files define **documentation + automation only**.
> No application code is written in this phase. Each feature is authored as a step-by-step,
> prompt-executable `.md` doc plus the skills/agents/hooks/commands needed to build it later.
> The app is built afterwards purely by executing these prompts in order.
>
> **Feature source of truth:** the full text/caption feature surface is taken from
> `CapCut_Text_and_Caption_Features.md` (bundled in this doc set). Section 8.5 maps every
> feature in that list to an owning agent and doc.

---

## 0. How To Use This Plan

1. Read this master plan end-to-end first. It is the single source of truth for scope, architecture, and sequence.
2. Author the **per-feature docs** (Section 7) and the **automation artifacts** (Section 8). That completes this phase.
3. To build the app later, execute the docs in the **build sequence** order (Section 9), one prompt block at a time, letting the agents/commands/hooks do the heavy lifting.
4. Every feature doc is self-contained: it states its goal, dependencies, data model touchpoints, the ordered prompts to run, and its acceptance criteria.

---

## 1. Vision & Scope

Build a native-feeling Electron desktop video editor whose look, feel, and editing model closely follow **CapCut Desktop**, with first-class **local + OneDrive** project storage and a standout **MP3 word-level auto-caption** feature.

**In scope**
- Project-based workflow: a Projects home/list screen that opens into one unified editor (preview + timeline + side panels).
- CapCut-style UI/UX and interaction model.
- Media import (video, image, audio/MP3).
- Auto-Caption: import MP3 → transcribe with word-level timestamps → captions snap to the exact timeline position of each spoken word.
- The **complete CapCut text/caption surface** from the bundled feature reference: typography & fonts, color & fill, stroke & outline, shadow, text effects, decorations, animations (in/out/loop), caption preset styles, keyframes & motion, AI text tools (auto-caption, language detection, translation, TTS, keyword highlight, remove silence), transitions, export (burn-in + SRT/VTT/ASS), and reusable preset management.
- **Indic-first language scope:** the app primarily targets **Tamil (primary), Telugu, Malayalam, Kannada, Hindi, and English** — complex-script shaping, grapheme-cluster handling, Indic-capable fonts, language detection/translation/TTS restricted to this set (Tamil default), and **full any-to-any transliteration** between all six (see Doc 16).
- Save projects and exported output to **local storage** or a **network OneDrive folder**.

**Out of scope (this phase)**
- Writing the actual app code.
- Cloud rendering, multi-user collaboration, mobile builds.

---

## 2. Product Overview (the eventual app)

**Two top-level screens:**

1. **Projects Home / List** — grid or list of project cards (thumbnail, name, last-modified, duration, storage location badge: Local / OneDrive). Actions: New Project, Open, Duplicate, Rename, Delete, Reveal in folder.
2. **Editor** — a single unified workspace:
   - **Preview** (player with transport controls, playhead scrubbing, resolution/quality toggle).
   - **Timeline** (multi-track: video, audio, text/caption, effects; zoom, snap, ripple, split, drag-trim; keyframe lanes).
   - **Side panels** (contextual): Media, Text, Captions/Auto-Caption, Effects, Decorations, Animation, Transitions, Audio, Fonts, AI Tools, Presets, Export.

The editor mirrors CapCut's layout conventions and panel behavior as a **design reference**, implemented with original assets and code.

---

## 3. Technology Stack & Architecture

| Layer | Choice | Notes |
|---|---|---|
| Shell | **Electron** (main + preload + renderer) | Context isolation on; no `nodeIntegration` in renderer. |
| UI | **React + TypeScript** | Component-driven; strict mode. |
| State | **Zustand** (editor/project state) | Lightweight, serializable slices map cleanly to the project file. |
| Styling | **Tailwind CSS** + design tokens | Tokens enforce the CapCut-style visual language (see frontend-design skill). |
| Timeline/Preview render | **Canvas/WebGL compositor** (PixiJS or custom) | Frame-accurate preview compositing of clips, text, effects, keyframes. |
| Text rendering | **WebGL/Canvas text pipeline** | Shared primitives for fill, stroke, shadow, glow/neon/glitch, decorations, per-character animation. |
| Script shaping | **HarfBuzz** (complex Indic scripts) | Tamil/Telugu/Malayalam/Kannada/Devanagari shaping (matras, conjuncts) + grapheme clusters; same shaper in preview and export. |
| Media decode/encode/export | **FFmpeg** (bundled native binary via `ffmpeg-static`, invoked from main) | Renderer requests export jobs over IPC; main runs FFmpeg. Subtitle burn-in + SRT/VTT/ASS muxing. |
| Speech-to-text | **whisper.cpp** (local, word-timestamps) with optional cloud STT adapter | Local-first; pluggable provider; restricted to Tamil/Telugu/Malayalam/Kannada/Hindi/English (Tamil default). |
| Text-to-speech | **Pluggable TTS provider** (local + cloud adapter) | Generates voiceover audio clips from text layers; voices for the six supported languages (Tamil default). |
| Transliteration | **Pluggable transliteration provider** (local default) | Any-to-any across the six languages via a phonetic pivot; Romanized typing → Indic script. |
| Motion tracking | **Tracking provider** (e.g. lightweight CV / cloud adapter) | Attaches text to a moving subject. |
| Storage | **Storage Provider abstraction** | `LocalProvider` (fs) + `OneDriveProvider` (sync-folder path and/or Microsoft Graph). |
| IPC | Typed channels via preload bridge | All privileged ops (fs, ffmpeg, stt, tts, tracking) live in main. |
| Packaging | **electron-builder** | Win/macOS targets. |

**Process boundaries**
- **Main process:** filesystem, FFmpeg, STT, TTS, motion tracking, OneDrive/Graph, project read/write.
- **Renderer:** UI, timeline editing, preview compositing, text rendering, panels.
- **Preload:** the only bridge; exposes a narrow, typed API surface.

---

## 4. Data Model & Project File Format

A project is a directory (the **project bundle**) so it works identically on local disk or inside a OneDrive folder.

```
MyProject.vproj/            # project bundle (a folder)
  project.json             # the serialized timeline + settings (schema below)
  media/                   # imported/linked or copied media
  cache/                   # waveforms, thumbnails, transcripts
  exports/                 # rendered output files
```

**`project.json` (high-level schema)**
```jsonc
{
  "version": 1,
  "id": "uuid",
  "name": "My Project",
  "createdAt": "iso",
  "updatedAt": "iso",
  "settings": { "fps": 30, "resolution": [1920,1080], "aspect": "16:9|9:16|1:1", "background": "#000", "language": "ta", "languages": ["ta","te","ml","kn","hi","en"] },  // language = project default (Tamil)
  "storage": { "location": "local|onedrive", "root": "absolute-or-graph-path" },
  "tracks": [
    {
      "id": "track-uuid",
      "type": "video|audio|text|effect",
      "clips": [
        {
          "id": "clip-uuid",
          "mediaRef": "media/clip1.mp4",
          "in": 0, "out": 5.0,            // source trim (s)
          "start": 0,                      // timeline position (s)
          "transitions": { "in": {...}, "out": {...} },
          "transform": { "x":0,"y":0,"scale":1,"rotation":0,"flipH":false,"flipV":false,"opacity":1,"z":0 },
          "keyframes": [ { "t":0, "props":{...}, "ease":"..." } ],   // position/scale/rotation/opacity over time
          "tracking": { "enabled":false, "target":"face|object", "path":[...] },
          "text": {
            "lang": "ta",                                                    // ta|te|ml|kn|hi|en — drives shaping/fallback/transliteration
            "runs": [ { "chars":"Hello", "color":"#fff", "gradient":null } ],  // per-word/char overrides
            "font": { "family":"...", "size":48, "bold":false, "italic":false,
                      "letterSpacing":0, "lineHeight":1.2, "curve":0, "fallback":["..."] },   // curve = arc; fallback = per-script chain
            "align": "left|center|right", "lines": ["..."],
            "fill": { "type":"solid|gradient", "value":"#fff|[stops]", "opacity":1 },
            "stroke": [ { "color":"#000", "width":4 } ],                       // stacking = multiple layers
            "shadow": { "color":"#000","opacity":0.6,"blur":8,"angle":45,"distance":6,"inner":false,"long":false },
            "effects": [ { "type":"glow|neon|glitch|3d|retro|blur|echo", "params":{...} } ],
            "decoration": { "background":{"color":"#000","opacity":0.5,"padding":12,"radius":8}, "underline":false, "strike":false, "highlight":null, "emoji":[] }
          },
          "animation": { "in": {...}, "out": {...}, "loop": {...}, "reveal": {...} }, // preset id + duration/speed; reveal = kinetic mask effect
          "effects": [ {...} ]                                                 // clip-level (non-text) effects
        }
      ]
    }
  ],
  "captions": {
    "source": "media/audio.mp3",
    "transcript": "cache/transcript.json",   // word-level timestamps
    "language": "auto|<code>",
    "translation": { "target":"<code>", "mode":"inline" },
    "transliteration": { "target":"ta|te|ml|kn|hi|en", "scheme":"iso15919", "mode":"inline|replace" },
    "styleId": "caption-preset-id",
    "keywordHighlights": [ { "word":"sale", "color":"#ff0" } ]
  },
  "presets": { "savedStyleIds": ["..."] }
}
```

This schema is the **contract** every feature doc and agent writes against. They reference these fields rather than inventing their own.

---

## 5. Storage Layer (Local + OneDrive)

A single `StorageProvider` interface backs both targets so the editor code never branches on location:

```ts
interface StorageProvider {
  listProjects(): Promise<ProjectMeta[]>;
  createProject(name: string): Promise<ProjectRef>;
  readProject(ref: ProjectRef): Promise<Project>;
  writeProject(ref: ProjectRef, p: Project): Promise<void>;
  readMedia(ref): Promise<Stream>;
  writeOutput(ref, file): Promise<void>;
  resolvePath(ref): string;            // local fs path or Graph item path
}
```

- **LocalProvider:** plain Node `fs`/`fs.promises`.
- **OneDriveProvider:** two supported modes —
  1. **Synced-folder mode** (simplest): treat the user's local OneDrive folder as a normal path; OneDrive's own client syncs it.
  2. **Graph API mode** (true network): authenticate via Microsoft Graph (MSAL), read/write project bundles as Graph drive items. Used when the folder isn't locally synced.

The detailed behavior, auth flow, conflict handling, and offline strategy live in `09_STORAGE_LOCAL_ONEDRIVE.md`.

---

## 6. The Auto-Caption Pipeline (headline feature)

Goal: import an MP3, transcribe with **word-level timestamps**, and place each caption so it appears exactly when its word is spoken — CapCut "Auto Caption" behavior.

```
MP3 import
  → (main) FFmpeg normalize to 16kHz mono WAV
  → (main) whisper.cpp transcribe with --word-timestamps  (+ language detection)
  → transcript.json:  [{ word, start, end }, ...]
  → segment into caption lines (max chars/line, max duration, sentence/pause breaks)
  → generate text clips on a Caption track: clip.start = wordGroup.start, out = wordGroup.end
  → apply selected caption style preset (karaoke / pop-by-word / etc.)
  → optional: keyword highlight, translation overlay, remove-silence pass
  → user can edit text/timing; edits write back to project.json
```

Key decisions captured in the audio/auto-caption doc:
- Word→line grouping rules (punctuation, pauses, max 2 lines, configurable max chars).
- Re-sync on text edit (keep timing) vs re-transcribe.
- Provider interface so cloud STT can replace whisper.cpp without touching the editor.

Full spec: `02_AUDIO_AUTOCAPTION_MP3SYNC.md`.

---

## 7. Documentation Set (author all of these)

Each is a standalone, prompt-executable `.md`. Numbering = recommended authoring/reading order.

| # | File | Covers |
|---|---|---|
| 00 | `00_MASTER_PLAN.md` | This file. |
| 01 | `01_UIUX_PROJECT_MANAGEMENT.md` | CapCut-style shell, Projects home → editor, panels, layout, design tokens, **positioning & layout** (drag, snap, rotate, flip, layer order, multi-line). |
| 02 | `02_AUDIO_AUTOCAPTION_MP3SYNC.md` | MP3 import, STT pipeline, word-level sync, language detection, caption generation, **remove silence**, **beat-sync source**. |
| 03 | `03_CAPTIONS_SUBTITLE_STYLES.md` | Premium caption presets (karaoke, pop-by-word, bounce, typewriter, TikTok classic), word-by-word reveal, animated active-word highlight, sound-effect cues, lower thirds, title cards. |
| 04 | `04_TEXT_EFFECTS.md` | Glow, neon, glitch (RGB split), 3D depth, retro/vintage, blur, echo/double-exposure. |
| 05 | `05_TEXT_DECORATIONS.md` | Background bubble (solid/semi), padding/margin, rounded vs sharp corners, underline/strike/highlight, inline emoji. |
| 06 | `06_TEXT_ANIMATION.md` | In / Out / Loop animation presets + duration/speed sliders, per-character/word reveal, easing. |
| 07 | `07_TRANSITIONS.md` | Clip transitions (dissolve, slide, zoom, glitch) + transition engine. |
| 08 | `08_FONTS_TYPOGRAPHY.md` | Font library, **AI font generator**, custom font import/embed, size, bold/italic, letter spacing, line height, curved/arc text, fallback. |
| 09 | `09_STORAGE_LOCAL_ONEDRIVE.md` | Storage provider, OneDrive sync/Graph modes, project bundle I/O. |
| 10 | `10_COLOR_STROKE_SHADOW.md` | Color & fill (solid/gradient/per-word, opacity), stroke/outline (thickness, stacking, hollow), shadow (drop/inner/long, color/opacity/blur/angle/distance). |
| 11 | `11_KEYFRAMES_MOTION.md` | Keyframe animation (pos/scale/rotation/opacity), custom motion path, AI motion tracking, beat-sync. |
| 12 | `12_AI_TEXT_TOOLS.md` | Text-to-Speech (multi-voice), caption translation, keyword color highlighting, language detection surfacing. |
| 13 | `13_EXPORT_OUTPUT.md` | Burn-in captions, SRT / VTT / ASS export, caption length handling, final FFmpeg composite export to local/OneDrive. |
| 14 | `14_PRESET_MANAGEMENT.md` | Save customized text styles as reusable presets, import preset packs, format-specific (9:16 / 16:9 / square) handling. |
| 15 | `15_TEXT_REVEAL_EFFECTS.md` | Animated text-reveal effects (Frame, Swipe, Type, Slide, Glossy, Appear by, Stomp, Stripe, Curtain) — mask/sweep/border-driven kinetic reveals. |
| 16 | `16_LANGUAGES_SCRIPTS_TRANSLITERATION.md` | Indic-first language scope (Tamil primary; te/ml/kn/hi/en), complex-script shaping + grapheme clusters, and full any-to-any transliteration. |
| 17 | `17_COMMUNITY_TEXT_ANIMATIONS.md` | Seventeen community-reference kinetic text animations (wave-ripple, glitch-split, typewriter-caret, kinetic-3d, scramble-decode, gloss-sweep, mask-line-rise, elastic-word-pop, focus-blur-in, char-drop-tumble, shimmer-gradient, jelly-squash, neon-flicker, liquid-fill, particle-assemble, perspective-slam, variable-weight-wave) composed from the animation + reveal primitives. Detailed recreation math in `COMMUNITY_ANIMATION_RECIPES.md`. |

**Required structure for every feature doc**
```
# <Feature>
## Goal
## Dependencies (which docs/skills/data-model fields it relies on)
## Data model touchpoints (fields it reads/writes in project.json)
## UI/UX spec (panels, controls, states)
## Build prompts (ordered, each a copy-paste prompt block for the build agent)
## Acceptance criteria / Definition of Done
## Test notes
```

---

## 8. Automation Artifacts (author all of these)

### 8.1 Skills (`/.../skills/*/SKILL.md`) — reusable capability knowledge

- `electron-scaffold` — process model, IPC, preload bridge conventions.
- `timeline-engine` — track/clip model, snapping, ripple, frame-accurate playhead, keyframe lanes.
- `preview-compositor` — Canvas/WebGL compositing rules and render loop.
- `text-render` — text styling primitives: fill/gradient, stroke stacking, shadow, glow/neon/glitch/3d/retro/blur/echo, decorations, per-character animation.
- `keyframe-engine` — interpolation, easing, motion paths.
- `motion-tracking` — subject tracking → per-frame transform.
- `caption-sync` — STT word-timestamp handling and word→line grouping.
- `tts-provider` — text → audio clip generation behind a provider interface.
- `subtitle-export` — SRT / VTT / ASS serialization + FFmpeg burn-in filtergraphs.
- `ffmpeg-export` — building export jobs, filtergraphs, progress IPC.
- `preset-store` — serialize/import/apply reusable style presets; format-specific variants.
- `storage-provider` — StorageProvider contract, OneDrive modes, bundle I/O.
- `reveal-effects` — kinetic text-reveal primitives: animated frame/border, swipe & stripe wipes, type caret, masked slide, glossy sheen, appear-by staggering, stomp impact, curtain split.
- `indic-text` — Indic complex-script shaping (HarfBuzz), grapheme-cluster segmentation, line breaking, syllable splitting for karaoke, per-script fonts/fallback, script detection (Tamil/Telugu/Malayalam/Kannada/Devanagari/Latin).
- `transliteration` — any-to-any script/phonetic conversion across the six languages via a phonetic pivot; Romanized input.
- `parity-check` — preview↔FFmpeg-export verification: static determinism greps, golden frames, SSIM thresholds, and Indic cluster-integrity checks.

### 8.2 Agents — orchestration

- `build-orchestrator` — reads the master plan, walks the Section 9 build sequence, dispatches each doc to its specialist agent (or `feature-builder`), and gates on milestones.
- `feature-builder` — generic builder for any doc without a dedicated specialist; implements against the data model + skills.

### 8.3 Agents — text styling & decoration specialists

- `typography-agent` — Doc 08. Font library, AI font generator, custom import/embed, size, bold/italic, spacing, line height, curved/arc.
- `color-fill-agent` — Doc 10. Solid/gradient fills, per-word color overrides, opacity.
- `stroke-outline-agent` — Doc 10. Stroke toggle, thickness, multi-layer stacking, hollow/outline-only.
- `shadow-agent` — Doc 10. Drop/inner/long shadow; color, opacity, blur, angle, distance.
- `text-effects-agent` — Doc 04. Glow, neon, glitch, 3D, retro, blur, echo.
- `text-decoration-agent` — Doc 05. Background bubble, padding, corner radius, underline/strike/highlight, inline emoji.
- `positioning-layout-agent` — Doc 01. Drag-drop, alignment snapping, rotation, flip H/V, layer ordering, multi-line breaks.

### 8.4 Agents — animation, motion & caption/AI specialists

- `text-animation-agent` — Doc 06. In/Out/Loop preset library + duration/speed controls, per-char/word reveal.
- `text-reveal-agent` — Doc 15. Animated text-reveal effects: Frame, Swipe, Type, Slide, Glossy, Appear by, Stomp, Stripe, Curtain (mask/sweep/border-driven kinetic reveals).
- `community-animation-agent` — Doc 17. Seventeen community-reference kinetic text animations composed from the animation + reveal primitives (wave-ripple, glitch-split, typewriter-caret, kinetic-3d, scramble-decode, gloss-sweep, mask-line-rise, elastic-word-pop, focus-blur-in, char-drop-tumble, shimmer-gradient, jelly-squash, neon-flicker, liquid-fill, particle-assemble, perspective-slam, variable-weight-wave); recreation math in `COMMUNITY_ANIMATION_RECIPES.md`.
- `keyframe-motion-agent` — Doc 11. Keyframe animation + custom motion path.
- `motion-tracking-agent` — Doc 11. AI motion tracking (text sticks to face/hand/object).
- `beat-sync-agent` — Doc 11/02. Beat detection and snap of text in/out to audio beats.
- `transitions-agent` — Doc 07. Clip transition engine + presets.
- `audio-agent` — Doc 02. MP3 import, normalize, waveform, provider plumbing.
- `autocaption-agent` — Doc 02. STT word-level sync + language detection + caption generation.
- `caption-style-agent` — Doc 03. Caption preset templates, word-by-word reveal, animated active-word highlight, sound-effect cues, lower thirds, title cards.
- `translation-agent` — Doc 12. Inline caption translation.
- `transliteration-agent` — Doc 16. Any-to-any transliteration across Tamil/Telugu/Malayalam/Kannada/Hindi/English + Romanized input.
- `tts-agent` — Doc 12. Text-to-Speech voiceover generation.
- `keyword-highlight-agent` — Doc 12. AI emphasis detection + per-word color highlighting.
- `remove-silence-agent` — Doc 02. Strip filler/silence from auto-captioned timelines.

### 8.5 Agents — export, presets & storage

- `export-agent` — Doc 13. Burn-in captions, SRT/VTT/ASS export, length handling, final composite export.
- `preset-manager-agent` — Doc 14. Save/import reusable presets; format-specific (9:16/16:9/square) variants.
- `storage-agent` — Doc 09. Local + OneDrive (synced-folder & Graph) project bundle I/O.

### 8.6 Agents — QA & review

- `test-writer` — generates unit/integration tests for each feature as it's built.
- `ui-reviewer` — checks new UI against design tokens / CapCut-style reference.
- `capcut-parity-agent` — validates implemented features against `CapCut_Text_and_Caption_Features.md`; flags any unmapped or missing item.
- `render-parity-agent` — verifies the preview matches FFmpeg-rendered export (font metrics, effects, animation timing).

### 8.7 Commands (slash commands)

- `/scaffold` — create the Electron + React + TS baseline.
- `/build-feature <doc>` — dispatch the doc to its specialist agent (via `build-orchestrator`).
- `/wire-ipc <name>` — add a typed IPC channel end-to-end (main↔preload↔renderer).
- `/add-skill <name>` — scaffold a new skill folder.
- `/parity-check` — run `capcut-parity-agent` against the feature reference.

### 8.8 Hooks

- `post-edit` → run `tsc --noEmit` + ESLint on changed files.
- `pre-commit` → typecheck + lint + format gate.
- `post-build-feature` → invoke `test-writer`, run the new tests, then `capcut-parity-agent`.

---

## 8.5 Feature → Agent Coverage Matrix

Every line in `CapCut_Text_and_Caption_Features.md` maps to an owning agent and doc.

| Feature (from reference) | Owning agent(s) | Doc |
|---|---|---|
| Font library / sans/serif/script/cinematic | `typography-agent` | 08 |
| AI font generator (from prompt) | `typography-agent` | 08 |
| Custom font import | `typography-agent` | 08 |
| Font size, bold/italic | `typography-agent` | 08 |
| Letter spacing, line height | `typography-agent` | 08 |
| Curved / arc text | `typography-agent` | 08 |
| Solid color fill (hex picker) | `color-fill-agent` | 10 |
| Gradient fill | `color-fill-agent` | 10 |
| Per-word color override | `color-fill-agent` (+ `keyword-highlight-agent` for AI) | 10/12 |
| Opacity / transparency | `color-fill-agent` | 10 |
| Stroke/outline + color | `stroke-outline-agent` | 10 |
| Stroke thickness | `stroke-outline-agent` | 10 |
| Multiple stroke layers | `stroke-outline-agent` | 10 |
| Hollow / outline-only text | `stroke-outline-agent` | 10 |
| Drop shadow (+ color) | `shadow-agent` | 10 |
| Shadow opacity / blur / angle / distance | `shadow-agent` | 10 |
| Long shadow | `shadow-agent` | 10 |
| Inner shadow | `shadow-agent` | 10 |
| Glow / neon glow | `text-effects-agent` | 04 |
| Glitch (RGB split) | `text-effects-agent` | 04 |
| 3D depth | `text-effects-agent` | 04 |
| Retro / vintage | `text-effects-agent` | 04 |
| Blur on text layer | `text-effects-agent` | 04 |
| Echo / double-exposure | `text-effects-agent` | 04 |
| Text background bubble | `text-decoration-agent` | 05 |
| Background padding / margin | `text-decoration-agent` | 05 |
| Rounded vs sharp corners | `text-decoration-agent` | 05 |
| Inline emoji | `text-decoration-agent` | 05 |
| Drag-drop positioning | `positioning-layout-agent` | 01 |
| Alignment snapping | `positioning-layout-agent` | 01 |
| Rotation (any angle) | `positioning-layout-agent` | 01 |
| Flip H / V | `positioning-layout-agent` | 01 |
| Layer ordering | `positioning-layout-agent` | 01 |
| Multi-line / manual breaks | `positioning-layout-agent` | 01 |
| Text animations — In (all presets) | `text-animation-agent` | 06 |
| Text animations — Out (all presets) | `text-animation-agent` | 06 |
| Text animations — Loop (all presets) | `text-animation-agent` | 06 |
| Animation duration/speed sliders | `text-animation-agent` | 06 |
| Reveal effect — Frame (animated border) | `text-reveal-agent` | 15 |
| Reveal effect — Swipe (bar wipe) | `text-reveal-agent` | 15 |
| Reveal effect — Type (typewriter + caret) | `text-reveal-agent` | 15 |
| Reveal effect — Slide (masked directional) | `text-reveal-agent` | 15 |
| Reveal effect — Glossy (sheen sweep) | `text-reveal-agent` | 15 |
| Reveal effect — Appear by (char/word/line) | `text-reveal-agent` | 15 |
| Reveal effect — Stomp (impact) | `text-reveal-agent` | 15 |
| Reveal effect — Stripe (stripe wipe) | `text-reveal-agent` | 15 |
| Reveal effect — Curtain (split mask) | `text-reveal-agent` | 15 |
| Caption preset library (karaoke, pop-by-word, bounce, typewriter, TikTok classic) | `caption-style-agent` | 03 |
| Word-by-word reveal | `caption-style-agent` + `autocaption-agent` | 03/02 |
| Animated active-word highlight | `caption-style-agent` + `autocaption-agent` | 03/02 |
| Sound-effect captions `[applause]` | `caption-style-agent` | 03 |
| Lower thirds / title cards | `caption-style-agent` | 03 |
| Keyframe animation | `keyframe-motion-agent` | 11 |
| Custom motion path | `keyframe-motion-agent` | 11 |
| AI motion tracking | `motion-tracking-agent` | 11 |
| Beat-sync | `beat-sync-agent` | 11/02 |
| Auto Captions (STT, 130+ langs) | `autocaption-agent` | 02 |
| Language detection | `autocaption-agent` | 02 |
| Caption translation (inline) | `translation-agent` | 12 |
| Keyword color highlighting (AI) | `keyword-highlight-agent` | 12 |
| Text-to-Speech (multi-voice) | `tts-agent` | 12 |
| Indic-first language support (Tamil primary; te/ml/kn/hi/en) | `typography-agent` + `autocaption-agent` | 16/08/02 |
| Complex-script shaping + grapheme clusters | `typography-agent` | 16/08 |
| Transliteration (any-to-any, 6 languages) | `transliteration-agent` | 16 |
| Romanized input → Indic script | `transliteration-agent` | 16 |
| Remove Silence | `remove-silence-agent` | 02 |
| Burn-in captions | `export-agent` | 13 |
| SRT / VTT / ASS export | `export-agent` | 13 |
| Caption length handling | `export-agent` | 13 |
| Save custom presets | `preset-manager-agent` | 14 |
| Import preset packs | `preset-manager-agent` | 14 |
| Format-specific presets (9:16/16:9/square) | `preset-manager-agent` | 14 |
| Local / OneDrive storage & output | `storage-agent` | 09 |

`capcut-parity-agent` re-derives this matrix from the reference file on every `/parity-check` and fails the build if any feature is unmapped.

---

## 9. Build Sequence (phases & milestones)

Execute in this order when building later. `build-orchestrator` drives it; specialist agents implement.

> **Indic-first:** every text/caption phase targets Tamil (primary), Telugu, Malayalam, Kannada, Hindi, English per Doc 16 — complex-script shaping and grapheme-cluster handling apply from the typography phase onward, and language pickers default to Tamil.

1. **Foundation** — `/scaffold`; Electron shell, preload bridge, base IPC, design tokens. *(skill: `electron-scaffold`)*
2. **Projects + Storage** — Docs 09 + 01 home; `storage-agent` builds the provider + bundle I/O (local first, then OneDrive). **Milestone:** create/open/save a project locally and on OneDrive.
3. **Editor core** — Doc 01 editor shell; `timeline-engine` + `preview-compositor`; `positioning-layout-agent` for transforms/layout; import media; trim/split/drag. **Milestone:** edit a video and scrub frame-accurately.
4. **Audio + Auto-Caption** — Doc 02; `audio-agent`, `autocaption-agent`, `remove-silence-agent`. **Milestone:** MP3 → captions land on the correct words.
5. **Caption styles** — Doc 03; `caption-style-agent`. **Milestone:** one-click premium caption styles with animated active-word highlight.
6. **Text styling** — Docs 08, 10; `typography-agent`, `color-fill-agent`, `stroke-outline-agent`, `shadow-agent`. **Milestone:** full font + fill + stroke + shadow control.
7. **Text effects & decorations** — Docs 04, 05; `text-effects-agent`, `text-decoration-agent`. **Milestone:** glow/neon/glitch/etc. + background bubbles render in preview.
8. **Animation & motion** — Docs 06, 11; `text-animation-agent`, `keyframe-motion-agent`, `motion-tracking-agent`, `beat-sync-agent`. **Milestone:** in/out/loop + keyframes + tracking + beat-sync.
8.5. **Reveal effects** — Doc 15; `text-reveal-agent`. **Milestone:** Frame/Swipe/Type/Slide/Glossy/Appear-by/Stomp/Stripe/Curtain reveals render in preview and export.
8.6. **Community-reference animations** — Doc 17; `community-animation-agent`. **Milestone:** seventeen community-inspired text animations (wave-ripple/glitch-split/typewriter-caret/kinetic-3d/scramble-decode/gloss-sweep/mask-line-rise/elastic-word-pop/focus-blur-in/char-drop-tumble/shimmer-gradient/jelly-squash/neon-flicker/liquid-fill/particle-assemble/perspective-slam/variable-weight-wave) render in preview and export.
9. **Transitions** — Doc 07; `transitions-agent`. **Milestone:** transitions render in preview and export.
10. **AI text tools** — Docs 12, 16; `tts-agent`, `translation-agent`, `keyword-highlight-agent`, `transliteration-agent`. **Milestone:** TTS voiceover, inline translation, AI keyword highlights, and any-to-any transliteration.
11. **Presets** — Doc 14; `preset-manager-agent`. **Milestone:** save/import/apply reusable styles per aspect ratio.
12. **Export** — Doc 13; `export-agent`. **Milestone:** burn-in + SRT/VTT/ASS + full composite export to local/OneDrive.
13. **Hardening** — `test-writer`, `render-parity-agent`, `capcut-parity-agent`, performance, packaging via electron-builder.

Each phase gates the next; don't proceed until its milestone passes acceptance criteria.

---

## 10. Repository Structure (target)

```
repo/
  docs/                      # the per-feature MD files (00–14) + CapCut feature reference
  .claude/
    skills/                  # SKILL.md folders (Section 8.1)
    agents/                  # all agents from Section 8.2–8.6
    commands/                # /scaffold, /build-feature, /wire-ipc, /add-skill, /parity-check
    hooks/                   # post-edit, pre-commit, post-build-feature
  src/
    main/                    # Electron main: fs, ffmpeg, stt, tts, tracking, storage, graph
    preload/                 # typed bridge
    renderer/                # React UI
      app/                   # projects home, editor shell
      timeline/
      preview/
      text/                  # text render pipeline (fill/stroke/shadow/effects/decorations/animation)
      panels/                # media, text, captions, effects, decorations, animation, transitions, audio, fonts, ai-tools, presets, export
      state/                 # zustand slices
      design/                # tokens, theme
  resources/                 # ffmpeg-static, whisper model, tts/tracking assets, default fonts
  package.json
```

---

## 11. Definition of Done (this phase)

- [ ] `00_MASTER_PLAN.md` complete (this file).
- [ ] All feature docs (`01`–`17`) authored in the required structure.
- [ ] All skills authored with valid `SKILL.md`.
- [ ] All agents (Sections 8.2–8.6), commands, and hooks defined.
- [ ] **Coverage matrix (8.5) accounts for every feature in `CapCut_Text_and_Caption_Features.md` — no unmapped items.**
- [ ] Docs cross-reference the shared data model in Section 4 (no schema drift).
- [ ] A reader can build the app end-to-end by executing the docs in Section 9 order with no missing steps.

---

## 12. Risks & Open Questions

- **OneDrive mode:** confirm whether synced-folder mode suffices, or Graph API auth is required for true network access. Affects Doc 09 auth scope.
- **STT / TTS / tracking licensing & size:** local model footprint vs cloud fallbacks; which voices/languages ship by default.
- **Preview vs export parity:** ensuring the Canvas/WebGL preview matches FFmpeg-rendered output (font metrics, effects, animation timing) — owned by `render-parity-agent`.
- **Premium fonts & preset packs:** licensing for any bundled premium fonts or community packs; otherwise user-supplied/system fonts only.
- **"CapCut-like":** UI/UX, effect names, and presets are a *design reference*; all assets, icons, and code must be original to avoid IP issues.

---

*End of master plan. Author the feature docs and automation artifacts next, then build via the Section 9 sequence.*

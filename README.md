# CapCut-Style Electron Video Editor — Plan & Autopilot

This repo is the **documentation + automation** for building a CapCut-style desktop video editor
(Electron + React + TS) with local + OneDrive storage and MP3 word-level auto-captions.
**Indic-first:** primary **Tamil**, plus Telugu, Malayalam, Kannada, Hindi, and English — with complex-script shaping and **full any-to-any transliteration** (see docs/16).
**No app code is written yet** — this is the plan and the machinery that builds it, phase by phase, on autopilot.

## What's here
```
docs/                     18 spec docs (00 master plan + 01–17 feature specs) + the CapCut feature reference + community-animation recipes
.claude/
  settings.json           hook wiring + autopilot config
  skills/    (16)          reusable capability knowledge (SKILL.md each)
  agents/    (31)          one orchestrator + specialists per feature + QA agents
  commands/  (8)           /autopilot /next /scaffold /build-phase /build-feature /wire-ipc /add-skill /parity-check
  hooks/     (3)           post-edit (typecheck+lint), pre-commit gate, post-build-feature gate
AUTOPILOT_RUNBOOK.md      193 atomic, ordered, checkbox prompts across 16 phases (0–13 + 8.5, 8.6) — the execution layer
BUILD_STATE.json          tracker the orchestrator advances
```

## Two layers
- **Spec layer** (`docs/`): *what* each feature is — data model, UI/UX, acceptance criteria.
- **Execution layer** (`AUTOPILOT_RUNBOOK.md`): *the exact ordered prompts* that build it, each tagged with its owning agent and spec doc.

The runbook never duplicates the specs — it points at them. Edit a spec to change behavior; edit the runbook to change build order.

## How to run (hands-off)
1. Open this folder in Claude Code (it auto-loads `.claude/`).
2. Start the build: `/scaffold` (Phase 0) or just `/autopilot`.
3. `/autopilot` runs the current phase's prompts in order, dispatching each to its specialist agent, gating on `post-build-feature` (typecheck + lint + tests + parity), checking each box, and stopping at the phase milestone for you to verify.
4. Continue with `/autopilot` (next phase), `/build-phase N` (a specific phase), `/build-feature 06` (one doc), or `/next` (a single prompt).
5. `/parity-check` any time to confirm every CapCut feature is still covered.

Set `autopilot.continueAcrossPhases: true` in `.claude/settings.json` to run all phases without stopping.

## Phase map (milestones)
0 boots · 1 storage · 2 projects+shell · 3 timeline+preview · 4 auto-caption · 5 caption styles ·
6 fonts/color/stroke/shadow · 7 effects/decorations · 8 animation/keyframes/motion · 8.5 reveal effects · 8.6 community animations · 9 transitions ·
10 AI text tools (TTS/translation/transliteration) · 11 presets · 12 export · 13 hardening/packaging.

Text & captions are **Indic-first** (Tamil primary; Telugu/Malayalam/Kannada/Hindi/English) with any-to-any transliteration — see docs/16.

## Guardrails baked in
- Every prompt writes against the single `project.json` schema (docs/00 §4) — no schema drift.
- No box is checked until the quality gate passes.
- `capcut-parity-agent` fails the build if any feature from the reference is unmapped or unimplemented.
- `render-parity-agent` keeps preview and FFmpeg export identical.
- "CapCut-like" is a design reference only; all assets/code must be original.

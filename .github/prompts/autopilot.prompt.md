---
description: Run the build hands-off — execute runbook prompts in order, gating on quality, until a phase milestone (or the whole build) is done.
mode: agent
tools: ['search', 'edit', 'runCommands', 'runTasks']
---
Engage the build-orchestrator agent.

Target: ${input:args:[all | phase N | until PX.Y]} (default: finish the current phase, then stop).

Loop:
1. Read BUILD_STATE.json + AUTOPILOT_RUNBOOK.md; pick the next unchecked prompt.
2. Dispatch it to the agent named in its [brackets] (or feature-builder).
3. Run the post-build-feature gate (typecheck, lint, tests, parity). On failure, fix before advancing.
4. Mark the prompt [x], update BUILD_STATE.json, continue.
5. Stop at the phase boundary and print the milestone for verification — unless target is "all".

Never skip a prompt or advance past a failing gate. Keep all writes consistent with docs/00 §4.

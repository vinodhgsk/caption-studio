---
description: Build one full phase of the runbook (all its prompts), gating on quality, then stop at the milestone.
mode: agent
tools: ['search', 'edit', 'runCommands', 'runTasks']
---
Engage build-orchestrator to run every unchecked prompt in Phase $1 of AUTOPILOT_RUNBOOK.md in order, dispatching each to its specialist agent and gating on the quality hook. Mark each [x] and update BUILD_STATE.json. Stop and print the phase milestone for verification.

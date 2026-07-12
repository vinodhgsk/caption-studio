---
description: Build one full phase of the runbook (all its prompts), gating on quality, then stop at the milestone.
argument-hint: "<phase number 0-13, or 8.5 for reveal effects>"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task
---
Engage build-orchestrator to run every unchecked prompt in Phase $1 of AUTOPILOT_RUNBOOK.md in order, dispatching each to its specialist agent and gating on the quality hook. Mark each [x] and update BUILD_STATE.json. Stop and print the phase milestone for verification.

---
description: Execute just the next single runbook prompt, then stop and report.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task
---
Engage build-orchestrator for exactly ONE prompt: read BUILD_STATE.json, find the next unchecked prompt, dispatch it to its specialist, run the quality gate, mark it [x], update state, and report what changed and how to verify. Do not continue to the following prompt.

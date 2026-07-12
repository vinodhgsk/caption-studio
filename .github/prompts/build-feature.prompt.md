---
description: Build a single feature doc end-to-end by running its prompts.
mode: agent
tools: ['search', 'edit', 'runCommands', 'runTasks']
---
Read docs/$1_*.md. Run its Build Prompts in order via the owning agent named in the doc header, gating on the quality hook, and verify against the doc's Acceptance criteria. Report results.

---
description: Build a single feature doc end-to-end by running its prompts.
argument-hint: "<doc number, e.g. 06>"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task
---
Read docs/$1_*.md. Run its Build Prompts in order via the owning agent named in the doc header, gating on the quality hook, and verify against the doc's Acceptance criteria. Report results.

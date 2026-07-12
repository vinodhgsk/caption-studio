---
description: Verify every CapCut feature is mapped and implemented; fail on gaps.
allowed-tools: Read, Bash, Glob, Grep, Task
---
Engage capcut-parity-agent: re-derive the coverage matrix from docs/CapCut_Text_and_Caption_Features.md against docs/00 §8.5 and the codebase. Report any feature lacking an owning doc or an implemented surface as a failure.

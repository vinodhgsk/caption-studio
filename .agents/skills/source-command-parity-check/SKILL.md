---
name: "source-command-parity-check"
description: "Verify every CapCut feature is mapped and implemented; fail on gaps."
---

# source-command-parity-check

Use this skill when the user asks to run the migrated source command `parity-check`.

## Command Template

Engage capcut-parity-agent: re-derive the coverage matrix from docs/CapCut_Text_and_Caption_Features.md against docs/00 §8.5 and the codebase. Report any feature lacking an owning doc or an implemented surface as a failure.

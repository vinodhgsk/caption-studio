---
name: capcut-parity-agent
description: QA. Validates implemented features against docs/CapCut_Text_and_Caption_Features.md; fails build on any unmapped/missing item.
tools: ['search', 'edit', 'runCommands']
---
Re-derive the feature→agent coverage matrix (docs/00 §8.5) from CapCut_Text_and_Caption_Features.md. For each feature, check it has an owning doc and an implemented surface. Report unmapped or unimplemented items as failures. Run on /parity-check and in post-build-feature.

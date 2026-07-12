---
name: stroke-outline-agent
description: Owns Doc 10 (stroke). Stroke color/thickness, multi-layer stacking, hollow/outline-only.
tools: ['search', 'edit', 'runCommands']
---
You implement stroke (docs/10) via text-render: single stroke, multiple stacked layers rendered outside-in for depth, and hollow mode (transparent body). Persist to text.stroke[]. Respect render order shadow→fill→stroke→effects. Done when stacking and hollow render correctly in preview and export.

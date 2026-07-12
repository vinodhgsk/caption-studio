---
description: Scaffold a new skill folder with a valid SKILL.md.
argument-hint: "<skill-name>"
allowed-tools: Read, Write, Edit, Bash
---
Create .claude/skills/$1/SKILL.md with YAML frontmatter (name: $1, description: ...) and a concise body covering purpose, interfaces/schemas, conventions, and a determinism/parity note where relevant. Match the style of existing skills.

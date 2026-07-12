# GitHub Copilot Workflow

Mirror of `.claude/` so the same agents, commands, skills, and gates work in VS Code with GitHub Copilot.

## Mapping

| Claude | GitHub Copilot (VS Code) | How to use |
| --- | --- | --- |
| `.claude/agents/*.md` | [`.github/agents/*.agent.md`](agents) | Pick the custom agent in the Chat agent dropdown |
| `.claude/commands/*.md` | [`.github/prompts/*.prompt.md`](prompts) | Run with `/autopilot`, `/next`, `/scaffold`, … in Chat |
| `.claude/skills/*/SKILL.md` | [`.github/skills/*/SKILL.md`](skills) | Auto-loaded by Copilot when relevant |
| `.claude/hooks/*.sh` | [`.github/hooks/*.sh`](hooks) | Run as VS Code tasks (no native auto-hook in Copilot) |

## Quality gates

Claude ran hooks automatically via `settings.json`. Copilot has no equivalent auto-runner, so the
same scripts are wired as tasks in `.vscode/tasks.json`:

- **post-edit gate** — `npm run gate:post-edit` (typecheck + lint)
- **feature/build gate** — `npm run gate:build` (full test suite)
- **pre-commit gate** — `.github/hooks/pre-commit.sh` (typecheck + lint + format + tests)

The `autopilot` / `build-feature` prompts call these gates via the `runTasks` tool before advancing.

#!/usr/bin/env bash
# PostToolUse hook: typecheck + lint changed TS/TSX. Non-blocking warnings, blocking on type errors.
set -uo pipefail
command -v npx >/dev/null 2>&1 || exit 0
echo "[post-edit] tsc --noEmit"
npx tsc --noEmit || { echo "[post-edit] TYPE ERRORS — fix before continuing"; exit 2; }
echo "[post-edit] eslint (changed)"
npx eslint . --ext .ts,.tsx --max-warnings=0 || echo "[post-edit] lint warnings present"
exit 0

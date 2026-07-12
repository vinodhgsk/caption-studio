#!/usr/bin/env bash
# Quality gate before a commit: typecheck + lint + format check + unit tests.
set -uo pipefail
npx tsc --noEmit || exit 1
npx eslint . --ext .ts,.tsx --max-warnings=0 || exit 1
npx prettier --check . || exit 1
npm test --silent || exit 1
echo "[pre-commit] OK"

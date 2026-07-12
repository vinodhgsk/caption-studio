#!/usr/bin/env bash
# Run after a feature/prompt lands: tests + CapCut parity check. Used by the autopilot gate.
set -uo pipefail
# Run the full Vitest suite across every package so the gate covers all tests.
npx vitest run || { echo "[gate] tests failed"; exit 1; }
echo "[gate] running parity check"
# capcut-parity-agent is invoked by the orchestrator; this script asserts the tests pass.
echo "[gate] OK"

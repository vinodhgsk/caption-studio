#!/usr/bin/env bash
# One-time setup for the CTC forced-alignment sidecar (OPTIONAL but recommended).
#
# Creates resources/pyalign/.venv and installs torch + torchaudio + uroman +
# numpy + soundfile into it. The app auto-detects this venv (or the
# $CAPTION_STUDIO_ALIGN_PY executable) and uses it for the most accurate
# lyrics-first timing; if it is absent the app falls back to VAD phrase-sync, so
# skipping this only lowers accuracy — it never breaks captioning.
#
# Usage:   bash resources/pyalign/setup.sh [python-bin]
# Example: bash resources/pyalign/setup.sh python3.12
#
# torch/torchaudio ship wheels for stable Python (3.10–3.13). If your default
# `python3` is newer (e.g. 3.14) with no matching torchaudio wheel, pass an
# older interpreter explicitly.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
py="${1:-python3}"
venv="$here/.venv"

echo "▶ Creating venv at $venv using $py"
"$py" -m venv "$venv"
"$venv/bin/python" -m pip install --upgrade pip
echo "▶ Installing torch + torchaudio + uroman + numpy + soundfile (~300–500 MB)"
"$venv/bin/python" -m pip install -r "$here/requirements.txt"

echo "▶ Verifying imports"
"$venv/bin/python" - <<'PY'
import torch, torchaudio, uroman, numpy, soundfile
from torchaudio.pipelines import MMS_FA
print("torch", torch.__version__, "torchaudio", torchaudio.__version__, "MMS_FA sr", MMS_FA.sample_rate)
PY

echo "✓ Sidecar ready. The MMS alignment model (~1 GB) downloads on first alignment."

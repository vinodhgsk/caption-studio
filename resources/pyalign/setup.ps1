$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
$py = "python"
$venv = Join-Path $here ".venv"

Write-Host "▶ Creating venv at $venv using $py"
& $py -m venv $venv

$pythonExe = Join-Path $venv "Scripts\python.exe"

& $pythonExe -m pip install --upgrade pip

Write-Host "▶ Installing torch + torchaudio (CPU) + uroman + numpy + soundfile"
# Install torch and torchaudio using CPU wheels for Windows (saves ~2GB download)
& $pythonExe -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
& $pythonExe -m pip install uroman numpy soundfile


Write-Host "Done: Sidecar ready. The MMS alignment model (~1 GB) downloads on first alignment."

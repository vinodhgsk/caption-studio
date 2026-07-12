#!/usr/bin/env bash
# Download bundled Noto Indic + Latin fonts for FFmpeg/libass export rendering.
# Run once after cloning: npm run download-fonts
# Fonts are gitignored (binary); this script fetches them from the Noto GitHub releases.
set -euo pipefail

DEST="$(dirname "$0")/../resources/fonts"
mkdir -p "$DEST"

BASE="https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf"

download() {
  local url="$1"
  local out="$2"
  if [ -f "$out" ]; then
    echo "  skip (exists): $(basename "$out")"
  else
    echo "  downloading: $(basename "$out")"
    curl -fsSL -o "$out" "$url"
  fi
}

echo "=== Noto Sans Tamil ==="
download "$BASE/NotoSansTamil/NotoSansTamil-Regular.ttf" \
  "$DEST/NotoSansTamil-Regular.ttf"
download "$BASE/NotoSansTamil/NotoSansTamil-Bold.ttf" \
  "$DEST/NotoSansTamil-Bold.ttf"

echo "=== Noto Serif Tamil ==="
download "$BASE/NotoSerifTamil/NotoSerifTamil-Regular.ttf" \
  "$DEST/NotoSerifTamil-Regular.ttf"
download "$BASE/NotoSerifTamil/NotoSerifTamil-Bold.ttf" \
  "$DEST/NotoSerifTamil-Bold.ttf"

echo "=== Tamil devotional display faces (caption font options; Google Fonts OFL) ==="
OFL="https://github.com/google/fonts/raw/main/ofl"
download "$OFL/baloothambi2/BalooThambi2%5Bwght%5D.ttf" "$DEST/BalooThambi2.ttf"
download "$OFL/catamaran/Catamaran%5Bwght%5D.ttf"       "$DEST/Catamaran.ttf"
download "$OFL/muktamalar/MuktaMalar-ExtraBold.ttf"     "$DEST/MuktaMalar-ExtraBold.ttf"
download "$OFL/anektamil/AnekTamil%5Bwdth,wght%5D.ttf"  "$DEST/AnekTamil.ttf"
download "$OFL/hindmadurai/HindMadurai-SemiBold.ttf"    "$DEST/HindMadurai-SemiBold.ttf"
download "$OFL/pavanam/Pavanam-Regular.ttf"             "$DEST/Pavanam-Regular.ttf"

echo "=== Noto Sans Telugu ==="
download "$BASE/NotoSansTelugu/NotoSansTelugu-Regular.ttf" \
  "$DEST/NotoSansTelugu-Regular.ttf"
download "$BASE/NotoSansTelugu/NotoSansTelugu-Bold.ttf" \
  "$DEST/NotoSansTelugu-Bold.ttf"

echo "=== Noto Sans Malayalam ==="
download "$BASE/NotoSansMalayalam/NotoSansMalayalam-Regular.ttf" \
  "$DEST/NotoSansMalayalam-Regular.ttf"
download "$BASE/NotoSansMalayalam/NotoSansMalayalam-Bold.ttf" \
  "$DEST/NotoSansMalayalam-Bold.ttf"

echo "=== Noto Sans Kannada ==="
download "$BASE/NotoSansKannada/NotoSansKannada-Regular.ttf" \
  "$DEST/NotoSansKannada-Regular.ttf"
download "$BASE/NotoSansKannada/NotoSansKannada-Bold.ttf" \
  "$DEST/NotoSansKannada-Bold.ttf"

echo "=== Noto Sans Devanagari ==="
download "$BASE/NotoSansDevanagari/NotoSansDevanagari-Regular.ttf" \
  "$DEST/NotoSansDevanagari-Regular.ttf"
download "$BASE/NotoSansDevanagari/NotoSansDevanagari-Bold.ttf" \
  "$DEST/NotoSansDevanagari-Bold.ttf"

echo ""
echo "Done. Fonts in $DEST/"
ls -lh "$DEST/"*.ttf 2>/dev/null || true
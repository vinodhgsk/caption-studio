#!/usr/bin/env python3
"""Diagnostic: check uroman romanization for Tamil lyrics words."""
import sys
import re

sys.stdout.reconfigure(encoding='utf-8')

import uroman

ur = uroman.Uroman()
_KEEP = re.compile(r"[^a-z' ]+")

# Read lyrics
with open("media/1.txt", "r", encoding="utf-8") as f:
    lyrics = f.read()

# Parse words
words = []
for line in lyrics.replace("\r\n", "\n").split("\n"):
    line = line.strip()
    if not line or line.startswith("#") or line.startswith("["):
        continue
    line = re.sub(r"\s+#.*$", "", line).strip()
    if not line:
        continue
    for w in line.split():
        w = w.strip()
        if w:
            words.append(w)

print(f"Total words: {len(words)}")
print()

# Romanize each word
empty_count = 0
for i, w in enumerate(words[:50]):
    r = ur.romanize_string(w, lcode="tam")
    norm = _KEEP.sub("", r.lower()).strip()
    if not norm:
        empty_count += 1
    print(f"  [{i:3d}] '{w}' -> roman='{r}' -> norm='{norm}'{'  *** EMPTY ***' if not norm else ''}")

print(f"\n... (showing first 50 of {len(words)})")
print(f"Empty romanizations in first 50: {empty_count}")

# Count total empty
all_empty = 0
for w in words:
    r = ur.romanize_string(w, lcode="tam")
    norm = _KEEP.sub("", r.lower()).strip()
    if not norm:
        all_empty += 1

print(f"Total empty romanizations: {all_empty} / {len(words)}")

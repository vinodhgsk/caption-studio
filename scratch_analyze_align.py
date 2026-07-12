#!/usr/bin/env python3
"""Analyze alignment quality: look for timing gaps, overlap, and score distribution."""
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open("scratch_align_result.json", "r", encoding="utf-8") as f:
    data = json.load(f)

words = data["words"]
print(f"Total words: {len(words)}")

# Check for large gaps (instrumental sections)
print("\n=== Large gaps (>2s) between consecutive words ===")
prev_end = 0
for i, w in enumerate(words):
    t = w["timing"]
    if t is None:
        continue
    gap = t["start"] - prev_end
    if gap > 2.0:
        print(f"  Gap: {prev_end:.2f}s - {t['start']:.2f}s ({gap:.2f}s) -- before word [{i}] '{w['text']}'")
    prev_end = t["end"]

# Score distribution
print("\n=== Score distribution ===")
scores = [w["timing"]["score"] for w in words if w["timing"] is not None]
buckets = [0]*10
for s in scores:
    b = min(9, int(s * 10))
    buckets[b] += 1
for i, count in enumerate(buckets):
    low = i/10
    high = (i+1)/10
    bar = "#" * count
    print(f"  {low:.1f}-{high:.1f}: {count:3d} {bar}")

# Check what lyrics lines look like as caption blocks
print("\n=== Lyrics grouped by lines (as they'd appear as captions) ===")
with open("media/1.txt", "r", encoding="utf-8") as f:
    lyrics = f.read()

word_idx = 0
for line_num, line in enumerate(lyrics.replace("\r\n", "\n").split("\n")):
    line = line.strip()
    if not line or line.startswith("#") or line.startswith("["):
        continue
    import re
    line = re.sub(r"\s+#.*$", "", line).strip()
    if not line:
        continue
    
    line_words = [w.strip() for w in line.split() if w.strip()]
    if not line_words:
        continue
    
    # Get timing for this line's words
    first_timing = None
    last_timing = None
    low_score = False
    for w in line_words:
        if word_idx < len(words):
            t = words[word_idx]["timing"]
            if t is not None:
                if first_timing is None:
                    first_timing = t
                last_timing = t
                if t["score"] < 0.1:
                    low_score = True
            word_idx += 1
    
    if first_timing and last_timing:
        dur = last_timing["end"] - first_timing["start"]
        flag = " *** LOW SCORE ***" if low_score else ""
        print(f"  Line {line_num:3d}: {first_timing['start']:7.2f}s - {last_timing['end']:7.2f}s ({dur:5.2f}s) '{line[:60]}'{flag}")

print(f"\nTotal words processed: {word_idx}")

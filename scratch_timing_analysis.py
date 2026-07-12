#!/usr/bin/env python3
"""
Diagnostic: Check if the lyrics in 1.txt actually match audio in 1.wav.
Count the large gaps and misalignment patterns.
"""
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

with open("scratch_align_result.json", "r", encoding="utf-8") as f:
    data = json.load(f)

words = data["words"]

# Calculate expected vs actual timing
# Expected: if lyrics have 285 words over 245 seconds, ~0.86s per word
# Actual: check timing distribution

# Group by 30-word chunks and see how the timing distributes
chunk_size = 30
print("=== Word timing distribution by chunks ===")
for chunk_start in range(0, len(words), chunk_size):
    chunk = words[chunk_start:chunk_start + chunk_size]
    timings = [w["timing"] for w in chunk if w["timing"] is not None]
    if not timings:
        continue
    t_start = timings[0]["start"]
    t_end = timings[-1]["end"]
    dur = t_end - t_start
    avg_score = sum(t["score"] for t in timings) / len(timings)
    count = len(timings)
    
    # Expected: evenly distributed would be ~26s per 30 words
    print(f"  Words [{chunk_start:3d}-{chunk_start+count-1:3d}]: {t_start:7.2f}s - {t_end:7.2f}s "
          f"({dur:6.2f}s, avg {dur/count:.2f}s/word, score {avg_score:.3f})")

print(f"\nAudio duration: 245.24s")
print(f"Alignment span: {words[0]['timing']['start']:.2f}s - {words[-1]['timing']['end']:.2f}s")
print(f"Ideal: {245.24/285:.2f}s per word")

# Find where the alignment "breaks" - sudden compression
print("\n=== Compression detection (words/sec rate change) ===")
window = 20
for i in range(0, len(words) - window, 10):
    chunk = words[i:i+window]
    timings = [w["timing"] for w in chunk if w["timing"] is not None]
    if len(timings) < 2:
        continue
    dur = timings[-1]["end"] - timings[0]["start"]
    rate = len(timings) / max(0.01, dur)  # words per second
    if rate > 3:  # More than 3 words/sec = too compressed
        print(f"  *** COMPRESSED *** Words [{i}-{i+window}]: {rate:.1f} words/sec "
              f"({timings[0]['start']:.2f}s - {timings[-1]['end']:.2f}s)")

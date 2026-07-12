#!/usr/bin/env python3
"""
Test chunked alignment: run forced_align.py with VAD segments on 1.wav + 1.txt.
Compare the result quality vs monolithic alignment.
"""
import json
import subprocess
import sys
import os
import re

sys.stdout.reconfigure(encoding='utf-8')

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

print(f"Total lyric words: {len(words)}")

# Run VAD to detect vocal regions (simulate what the TypeScript side does)
# We'll use a simple approach: read the WAV and detect energy regions
import wave
import struct
import math

wav_path = os.path.abspath("media/1.wav")

# Read WAV for duration
with wave.open(wav_path, 'rb') as wf:
    n_frames = wf.getnframes()
    sr = wf.getframerate()
    n_ch = wf.getnchannels()
    dur = n_frames / sr
    print(f"WAV: {dur:.2f}s, {sr}Hz, {n_ch}ch")
    
    # Read samples for energy-based VAD
    raw = wf.readframes(n_frames)
    samples = struct.unpack(f'<{n_frames * n_ch}h', raw)
    # Downmix to mono
    if n_ch > 1:
        mono = []
        for i in range(0, len(samples), n_ch):
            mono.append(sum(samples[i:i+n_ch]) / n_ch)
        samples = mono

# Simple energy-based VAD (matching the TypeScript implementation closely)
window_size = 1024
hop_size = 512
# Resample conceptually: we're at 48kHz, the analysis works on the raw signal
num_frames_e = (len(samples) - window_size) // hop_size + 1
energy = []
for f in range(num_frames_e):
    base = f * hop_size
    s = sum(samples[base + i] ** 2 for i in range(window_size))
    energy.append(math.sqrt(s / window_size))

# Adaptive threshold
sorted_e = sorted(energy)
n_e = len(sorted_e)
quiet = sorted_e[int(0.2 * (n_e - 1))]
loud = sorted_e[int(0.9 * (n_e - 1))]
global_peak = sorted_e[-1]
threshold = max(quiet + 0.6 * max(0, loud - quiet), global_peak * 0.1)

# Detect voiced runs
raw_regions = []
run_start = -1
for f in range(num_frames_e):
    voiced = energy[f] > threshold
    if voiced and run_start < 0:
        run_start = f
    elif not voiced and run_start >= 0:
        s = run_start * hop_size / sr
        e = (f * hop_size + window_size) / sr
        raw_regions.append([s, e])
        run_start = -1
if run_start >= 0:
    s = run_start * hop_size / sr
    e = (num_frames_e * hop_size + window_size) / sr
    raw_regions.append([s, e])

# Bridge short gaps
min_gap = 0.35
bridged = [list(raw_regions[0])] if raw_regions else []
for i in range(1, len(raw_regions)):
    prev = bridged[-1]
    cur = raw_regions[i]
    if cur[0] - prev[1] < min_gap:
        prev[1] = cur[1]
    else:
        bridged.append(list(cur))

# Drop tiny regions, pad edges
min_region = 0.15
pad = 0.05
segments = []
for r in bridged:
    if r[1] - r[0] < min_region:
        continue
    s = max(0, r[0] - pad)
    e = min(dur, r[1] + pad)
    if segments and s <= segments[-1][1]:
        segments[-1][1] = max(segments[-1][1], e)
    else:
        segments.append([s, e])

print(f"Detected {len(segments)} vocal segments:")
for i, seg in enumerate(segments):
    print(f"  [{i}] {seg[0]:.2f}s - {seg[1]:.2f}s ({seg[1]-seg[0]:.2f}s)")
total_vocal = sum(s[1] - s[0] for s in segments)
print(f"Total vocal: {total_vocal:.2f}s / {dur:.2f}s")

# Build request WITH segments
req = {
    "wav_path": wav_path,
    "language": "ta",
    "words": words,
    "segments": segments
}

print(f"\nRunning chunked forced_align.py...")
result = subprocess.run(
    [r"resources\pyalign\.venv\Scripts\python.exe", "resources/pyalign/forced_align.py"],
    input=json.dumps(req),
    capture_output=True,
    text=True,
    encoding="utf-8",
    timeout=600
)

print(f"Exit code: {result.returncode}")
if result.stderr:
    print(f"STDERR (first 2000): {result.stderr[:2000]}")

if not result.stdout:
    print("No stdout!")
    sys.exit(1)

out = json.loads(result.stdout)
if not out.get("ok"):
    print(f"Error: {out.get('error')}")
    sys.exit(1)

aligned_words = out["words"]
non_null = [w for w in aligned_words if w is not None]
print(f"Aligned: {len(non_null)}/{len(aligned_words)}")

# Compare with monolithic result
with open("scratch_align_result.json", "r", encoding="utf-8") as f:
    mono_data = json.load(f)

print("\n=== COMPARISON: Monolithic vs Chunked (last 30 words) ===")
print(f"{'Word':>6s}  {'Mono Start':>10s}  {'Mono End':>10s}  {'Chunk Start':>11s}  {'Chunk End':>11s}  {'Mono dur':>8s}  {'Chunk dur':>9s}")
for i in range(max(0, len(words)-30), len(words)):
    mono_t = mono_data["words"][i]["timing"] if mono_data["words"][i]["timing"] else None
    chunk_t = aligned_words[i] if aligned_words[i] else None
    
    mono_s = f"{mono_t['start']:.2f}" if mono_t else "NULL"
    mono_e = f"{mono_t['end']:.2f}" if mono_t else "NULL"
    chunk_s = f"{chunk_t['start']:.2f}" if chunk_t else "NULL"
    chunk_e = f"{chunk_t['end']:.2f}" if chunk_t else "NULL"
    mono_d = f"{mono_t['end']-mono_t['start']:.2f}" if mono_t else "---"
    chunk_d = f"{chunk_t['end']-chunk_t['start']:.2f}" if chunk_t else "---"
    
    print(f"  [{i:3d}]  {mono_s:>10s}  {mono_e:>10s}  {chunk_s:>11s}  {chunk_e:>11s}  {mono_d:>8s}  {chunk_d:>9s}  '{words[i][:20]}'")

# Score distribution comparison
mono_scores = [w["timing"]["score"] for w in mono_data["words"] if w["timing"]]
chunk_scores = [w["score"] for w in aligned_words if w]
print(f"\nMean score: monolithic={sum(mono_scores)/len(mono_scores):.3f}, chunked={sum(chunk_scores)/len(chunk_scores):.3f}")

# Timing distribution by chunks
print("\n=== Timing distribution (30-word chunks): Chunked ===")
chunk_size = 30
for cs in range(0, len(words), chunk_size):
    chunk = aligned_words[cs:cs + chunk_size]
    timings = [w for w in chunk if w is not None]
    if not timings:
        continue
    t_start = timings[0]["start"]
    t_end = timings[-1]["end"]
    d = t_end - t_start
    count = len(timings)
    avg_score = sum(t["score"] for t in timings) / len(timings)
    print(f"  Words [{cs:3d}-{cs+count-1:3d}]: {t_start:7.2f}s - {t_end:7.2f}s "
          f"({d:6.2f}s, avg {d/count:.2f}s/word, score {avg_score:.3f})")

# Save chunked results
with open("scratch_chunked_result.json", "w", encoding="utf-8") as f:
    json.dump({"words": [{"text": w, "timing": t} for w, t in zip(words, aligned_words)]}, f, ensure_ascii=False, indent=2)
print("\nChunked results saved to scratch_chunked_result.json")

#!/usr/bin/env python3
"""Quick diagnostic: run forced_align.py on the provided 1.wav + 1.txt."""
import json
import subprocess
import sys
import os
import re

# Force UTF-8 stdout
sys.stdout.reconfigure(encoding='utf-8')

# Read the lyrics
with open("media/1.txt", "r", encoding="utf-8") as f:
    lyrics = f.read()

# Parse lyrics into words (matching lyricWordSequence in TS)
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

# Build the request
req = {
    "wav_path": os.path.abspath("media/1.wav"),
    "language": "ta",
    "words": words
}

print(f"WAV path: {req['wav_path']}")
print(f"WAV exists: {os.path.exists(req['wav_path'])}")

# Check WAV duration
import wave
try:
    with wave.open(req['wav_path'], 'rb') as wf:
        dur = wf.getnframes() / wf.getframerate()
        print(f"WAV duration: {dur:.2f}s, channels: {wf.getnchannels()}, rate: {wf.getframerate()}")
except Exception as e:
    print(f"Could not read WAV: {e}")

# Run the aligner
print("\nRunning forced_align.py...")
result = subprocess.run(
    [r"resources\pyalign\.venv\Scripts\python.exe", "resources/pyalign/forced_align.py"],
    input=json.dumps(req),
    capture_output=True,
    text=True,
    encoding="utf-8",
    timeout=300
)

print(f"Exit code: {result.returncode}")
if result.stderr:
    print(f"STDERR (first 2000): {result.stderr[:2000]}")

if result.stdout:
    try:
        out = json.loads(result.stdout)
        print(f"Response OK: {out.get('ok')}")
        if out.get("ok"):
            aligned_words = out.get("words", [])
            print(f"Aligned words count: {len(aligned_words)}")
            
            non_null = [w for w in aligned_words if w is not None]
            null_count = len(aligned_words) - len(non_null)
            print(f"Non-null alignments: {len(non_null)}")
            print(f"Null (unalignable): {null_count}")
            
            # Dump first 30 word timings
            print("\nFirst 30 word timings:")
            for i in range(min(30, len(words))):
                timing = aligned_words[i] if i < len(aligned_words) else None
                w = words[i]
                if timing is not None:
                    print(f"  [{i:3d}] {timing['start']:8.3f}s - {timing['end']:8.3f}s  score={timing['score']:.3f}  '{w}'")
                else:
                    print(f"  [{i:3d}]    NULL                                     '{w}'")
            
            # Last 10
            print(f"\nLast 10 word timings:")
            for i in range(max(0, len(words)-10), len(words)):
                timing = aligned_words[i] if i < len(aligned_words) else None
                w = words[i]
                if timing is not None:
                    print(f"  [{i:3d}] {timing['start']:8.3f}s - {timing['end']:8.3f}s  score={timing['score']:.3f}  '{w}'")
                else:
                    print(f"  [{i:3d}]    NULL                                     '{w}'")
            
            starts = [w['start'] for w in non_null]
            ends = [w['end'] for w in non_null]
            scores = [w['score'] for w in non_null]
            if starts and ends:
                print(f"\nOverall alignment span: {min(starts):.3f}s - {max(ends):.3f}s")
                print(f"Total aligned duration: {max(ends) - min(starts):.3f}s")
                print(f"Score range: {min(scores):.3f} - {max(scores):.3f}")
                print(f"Mean score: {sum(scores)/len(scores):.3f}")
                
                # Save full results for analysis
                with open("scratch_align_result.json", "w", encoding="utf-8") as f:
                    json.dump({
                        "words": [{"text": w, "timing": t} for w, t in zip(words, aligned_words)]
                    }, f, ensure_ascii=False, indent=2)
                print("\nFull results saved to scratch_align_result.json")
        else:
            print(f"Error: {out.get('error')}")
    except json.JSONDecodeError as e:
        print(f"Failed to parse JSON: {e}")
        print(f"Raw stdout (first 500): {result.stdout[:500]}")
else:
    print("No stdout output!")

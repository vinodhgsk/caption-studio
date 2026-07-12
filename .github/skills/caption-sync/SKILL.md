---
name: caption-sync
description: Turning word-level STT output into timed caption lines — grouping rules, active-word timing, re-sync on edit. Use for auto-caption and caption styles.
---
# caption-sync

## Input
`words: [{word,start,end}]` (+ detected language).

## Grouping → lines
Greedy group by: maxCharsPerLine, maxLines, sentence punctuation, and pause gap (> gapThreshold seconds forces a break). Output `[{text, start, end, words[]}]`. Count `maxCharsPerLine` in **grapheme clusters** (indic-text), not codepoints. Supported languages: Tamil (default), Telugu, Malayalam, Kannada, Hindi, English.

## Active-word timing
For highlight styles, keep per-word `{start,end}` so the compositor can color/scale the word whose `[start,end]` contains the playhead.

## Re-sync vs re-transcribe
Editing line TEXT keeps timing. "Re-sync" regroups from the stored transcript. "Re-transcribe" re-runs STT (provider call). Never silently re-transcribe on edit.

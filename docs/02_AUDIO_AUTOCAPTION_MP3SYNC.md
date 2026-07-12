# 02 — Audio Import & Auto-Caption (MP3 Word-Level Sync)

**Phase:** 4 · **Owning agents:** `audio-agent`, `autocaption-agent`, `remove-silence-agent` · **Skills:** `caption-sync`, `ffmpeg-export`, `indic-text`

## Goal
Import an MP3, transcribe it with **word-level timestamps**, and generate captions that snap to the exact timeline position of each spoken word — CapCut "Auto Caption" behavior. Includes language detection and a remove-silence pass. This is the headline feature. The app is **Indic-first**: STT, language detection, and grouping target **Tamil (primary), Telugu, Malayalam, Kannada, Hindi, English**, defaulting to Tamil (see Doc 16).

## Dependencies
- Doc 01 (timeline/preview), Doc 03 (caption styles to apply after generation).
- Skills: `caption-sync` (word→line grouping), `ffmpeg-export` (audio normalize).
- Master plan Section 6 (pipeline), Section 4 (`captions` block).

## Data model touchpoints
- `captions.source`, `captions.transcript`, `captions.language`.
- Caption track + text clips: `clips[].start = wordGroup.start`, `clips[].out = wordGroup.end`, `clips[].text`.

## UI/UX spec
Audio panel: import MP3, show waveform, volume/fade. Auto-Caption panel: "Generate captions" button, language dropdown (Auto-detect + the six supported languages, default Tamil), max chars/line, max lines, min gap. Progress bar during transcription. Generated captions appear as editable clips on a Caption track; editing text keeps timing; a "Re-sync" and "Remove silence" action are available.

## Build prompts
```
PROMPT 2.1 — Implement audio import (audio-agent): accept MP3, copy into bundle media/, decode a waveform for the timeline, and add an audio clip. Add an IPC channel for FFmpeg to normalize the MP3 to 16kHz mono WAV in cache/.
```
```
PROMPT 2.2 — Wire whisper.cpp behind a pluggable STT provider interface (transcribe(wav) -> { language, words:[{word,start,end}] }) invoked in main over IPC. Enable --word-timestamps and language auto-detect restricted to {ta,te,ml,kn,hi,en} with Tamil as the default/fallback. Write transcript.json to cache/ and set captions.transcript/language.
```
```
PROMPT 2.3 — Implement word→line grouping using the caption-sync skill: group words into caption lines by max chars/line, max lines, sentence punctuation, and pause gaps. Count line length in **grapheme clusters** (indic-text), not codepoints, so Tamil/Indic clusters wrap correctly. Output an ordered list of {text, start, end}.
```
```
PROMPT 2.4 — Generate the Caption track: for each grouped line create a text clip with start/out from the group and default caption style. Render on the timeline and preview; verify words appear exactly when spoken against the audio.
```
```
PROMPT 2.5 — Implement caption editing that preserves timing: editing text does not re-transcribe; add an explicit Re-sync action that re-runs grouping from transcript.json. Persist edits to project.json.
```
```
PROMPT 2.6 — Implement Remove Silence (remove-silence-agent): detect filler/silence segments from the transcript/waveform and offer to trim them from the audio + ripple captions accordingly.
```

## Acceptance criteria
- Importing an MP3 produces a waveform and a transcript with word timestamps.
- Generated captions align to spoken words within one frame at project fps.
- Language auto-detect (restricted to the six supported languages, Tamil default) populates `captions.language`.
- Editing caption text preserves timing; Re-sync regroups correctly.
- Remove Silence trims gaps and re-aligns captions.

## Test notes
Use a short known-script MP3 with ground-truth word times; assert caption.start within ±1 frame. Test grouping rules at boundary cases (long words, no punctuation, long pauses). Mock the STT provider for deterministic unit tests.

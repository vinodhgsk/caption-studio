# 12 — AI Text Tools (TTS, Translation, Transliteration, Keyword Highlight)

**Phase:** 10 · **Owning agents:** `tts-agent`, `translation-agent`, `transliteration-agent`, `keyword-highlight-agent` · **Skills:** `tts-provider`, `transliteration`, `indic-text`, `caption-sync`

## Goal
Implement Text-to-Speech (generate voiceover from a text layer, multi-voice), inline caption translation to a target language, AI keyword color highlighting (auto-detect emphasis words), and host the **Transliteration** tool (any-to-any, defined in Doc 16). All language features target the six supported languages — **Tamil (primary), Telugu, Malayalam, Kannada, Hindi, English** — defaulting to Tamil. Language detection is surfaced from Doc 02.

## Dependencies
- Doc 02 (transcript/captions), Doc 10 (per-word color for highlights), Doc 03 (caption track), `tts-provider`.

## Data model touchpoints
- `captions.translation = {target, mode:"inline"}`; `captions.transliteration = {target, scheme, mode}` (Doc 16); `captions.keywordHighlights = [{word,color}]`; TTS output as a new audio clip in `media/`.

## UI/UX spec
AI Tools panel: TTS (pick text layer, voice dropdown — voices for the six languages, Tamil default, generate → adds audio clip), Translation (target language from the six, inline toggle → adds translated line under captions), Transliteration (source/target language + scheme, inline vs replace → converts script preserving pronunciation; Doc 16), Keyword Highlight (auto-detect button + manual add/remove, color per keyword). Every language dropdown defaults to Tamil and is restricted to {ta,te,ml,kn,hi,en}.

## Build prompts
```
PROMPT 12.1 — Implement TTS behind tts-provider (text + voice -> audio): generate a voiceover clip from a selected text layer using a voice for one of the six supported languages (Tamil default), write to media/, add as an audio clip on the timeline.
```
```
PROMPT 12.2 — Implement caption translation: translate caption lines (or transcript) to a target language among the six supported (Tamil/Telugu/Malayalam/Kannada/Hindi/English); render inline beneath the original on the same caption track; persist captions.translation.
```
```
PROMPT 12.3 — Implement keyword highlighting (keyword-highlight-agent): auto-detect emphasis words from the transcript; apply per-word color via text.runs[].color; allow manual add/remove; persist captions.keywordHighlights.
```
```
PROMPT 12.4 — Wire the AI Tools panel (TTS, Translation, Keyword Highlight, and the Transliteration tool from Doc 16); ensure providers are pluggable (local/cloud) and degrade gracefully when unavailable; every language dropdown defaults to Tamil and is limited to {ta,te,ml,kn,hi,en}.
```

## Acceptance criteria
- TTS produces an audio clip aligned to the timeline.
- Translation renders inline and persists.
- Transliteration (Doc 16) is reachable from this panel and converts script preserving pronunciation.
- Keyword highlights color the right words and are editable.
- All language pickers default to Tamil and expose only the six supported languages.

## Test notes
Mock providers for deterministic tests. Verify translated line timing matches source captions. Assert highlighted word indices map to transcript words.

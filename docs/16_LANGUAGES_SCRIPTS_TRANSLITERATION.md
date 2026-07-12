# 16 — Languages, Scripts & Transliteration (Indic-first)

**Phase:** 10 (transliteration) · script support enforced across Phases 4–8 · **Owning agents:** `transliteration-agent` (+ `typography-agent`, `autocaption-agent`, `translation-agent`, `tts-agent` for language coverage) · **Skills:** `indic-text`, `transliteration`, `text-render`, `caption-sync`

## Goal
Make the editor **Indic-first**. Officially support six languages — **Tamil (primary), Telugu, Malayalam, Kannada, Hindi, English** — across typing, fonts/shaping, auto-caption, caption styles, animation, translation, TTS, and export. Provide **full any-to-any transliteration** between all six (script/phonetic conversion, distinct from meaning translation).

## Supported languages
| Name | Code | Script | Notes |
|---|---|---|---|
| Tamil | `ta` | Tamil | **Primary / default everywhere** |
| Telugu | `te` | Telugu | |
| Malayalam | `ml` | Malayalam | |
| Kannada | `kn` | Kannada | |
| Hindi | `hi` | Devanagari | |
| English | `en` | Latin | Romanization source/target |

Tamil is the default project language, default caption/STT language, and the default text-input script. Every language picker defaults to Tamil and is restricted to this set.

## Dependencies
- Doc 02 (STT language set), Doc 03 (caption rendering), Doc 06/15 (per-grapheme animation), Doc 08 (fonts/shaping/fallback), Doc 12 (AI Tools panel host for translation/TTS/keyword + transliteration), Doc 13 (export encoding/burn-in font).
- Skills: `indic-text` (shaping, grapheme clusters, fallback, script detection), `transliteration` (engine), `text-render`, `caption-sync`.

## Script & shaping requirements (cross-cutting)
- Complex-script shaping via **HarfBuzz** (matras, conjuncts, reordering, combining marks) in **both** preview and headless export for parity.
- All per-character operations (typewriter/Type reveal, per-char animation stagger, reveal `unit:"char"`, `maxCharsPerLine` counting) operate on **extended grapheme clusters**, not codepoints (e.g. Tamil `கி`, Devanagari `क्षि`).
- Per-script font fallback chain; bundle Indic-capable default fonts; the global default family renders Tamil.
- Script detection picks font/shaping and the transliteration source language.

## Transliteration (any-to-any)
- Convert any supported language's script → any other supported script, preserving pronunciation (not meaning). E.g. Tamil `வணக்கம்` → Latin `vaṇakkam` → Devanagari `वणक्कम्` → Telugu `వణక్కమ్`.
- English (Latin) ↔ Indic = Romanization / de-Romanization (ISO 15919 / ITRANS-style); de-Romanization powers Romanized typing → Indic script input.
- Pivot through a common phonetic intermediate so N languages need O(N) mappings, not O(N²). Provider-pluggable (local default + optional cloud), graceful degradation.

## Data model touchpoints
- `settings.language` (default `"ta"`), `settings.languages` (supported set).
- `text.lang` (optional per-clip language/script override; drives shaping/fallback/transliteration source).
- `captions.transliteration = { target:"ta|te|ml|kn|hi|en", scheme, mode:"inline|replace" }` (parallel to `captions.translation`).
- `text.font.fallback[]` (per-script fallback families).

## UI/UX spec
- Global language defaults to Tamil; every language dropdown exposes only the six and defaults to Tamil.
- AI Tools panel → **Transliteration** tool: source (auto/explicit) + target language, scheme, inline vs replace, live preview; apply to a text layer or the whole caption track.
- Romanized input helper: type in Latin, convert to the chosen Indic script on the text layer.

## Build prompts
```
PROMPT 16.1 — Establish the language model: add settings.language (default "ta") + settings.languages; restrict every language picker to {ta,te,ml,kn,hi,en} defaulting to Tamil; thread text.lang through the text pipeline.
```
```
PROMPT 16.2 — Implement the transliteration engine (transliteration skill): any-to-any across the six via a phonetic pivot; English↔Indic Romanization; reversible where defined; behind a pluggable provider with a local default and graceful degradation.
```
```
PROMPT 16.3 — Wire the Transliteration tool into the AI Tools panel: source/target/scheme/mode, live preview, apply to a text layer or caption track; persist captions.transliteration.
```
```
PROMPT 16.4 — Romanized input: convert Latin typing to the selected Indic script on a text layer (the transliteration engine in reverse).
```
```
PROMPT 16.5 — Ensure shaping/fallback/grapheme parity (indic-text): verify complex-script rendering + grapheme-cluster per-char behavior in preview and headless export across all six scripts.
```

## Acceptance criteria
- All six languages render correctly (shaping, matras, conjuncts) in preview and export; Tamil is the default everywhere.
- Per-character animation/reveal/line-wrap operate on grapheme clusters for Indic scripts.
- Transliteration converts any supported language to any other, reversibly where defined, and persists.
- Romanized Latin input produces correct Tamil/Indic script.

## Test notes
Golden strings per script (Tamil `கி`, `க்ஷி`; Devanagari `क्षि`) shaped identically preview vs export, with equal grapheme-cluster counts. Round-trip transliteration `ta→en→ta` and `ta↔hi` on known pairs. Grapheme-cluster count tests for line wrap. Mock the transliteration provider for determinism.

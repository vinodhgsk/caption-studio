---
name: transliteration
description: Any-to-any transliteration across the six supported languages (Tamil/Telugu/Malayalam/Kannada/Hindi/English) — script/phonetic conversion via a common phonetic pivot, distinct from meaning translation. Pluggable provider.
---
# transliteration

## Purpose
Convert text from any supported language's script into any other supported script **preserving pronunciation, not meaning**. This is script/phonetic conversion, not translation.
- Translation: வணக்கம் → "Hello" (meaning).
- Transliteration: வணக்கம் → `vaṇakkam` (Latin) → `वणक्कम्` (Devanagari) → `వణక్కమ్` (Telugu) (sound).

## Languages
Tamil `ta` (primary), Telugu `te`, Malayalam `ml`, Kannada `kn`, Hindi `hi`, English `en` (Latin). Any source → any target within this set.

## Engine
- **Phonetic pivot:** map each script to/from a common phonetic intermediate (ISO 15919–style) so N languages need O(N) mappings, not O(N²). Source script → pivot → target script.
- **English (Latin):** Indic → Latin = Romanization (ISO 15919 / ITRANS-style); Latin → Indic = de-Romanization, which also powers Romanized typing (type `vanakkam` → `வணக்கம்`).
- **Reversibility:** round-trips are lossless only where the scheme defines it (e.g. ISO 15919 with diacritics); document lossy pairs.
- Schwa/virama, anusvara, and script-specific vowel-sign rules handled in the per-script tables.

## Interface
`listSchemes() -> Scheme[]`; `transliterate({text, from?, to, scheme}) -> { text }`. `from` may be omitted (auto-detect script via `indic-text`). Provider-pluggable (local rule-based default + optional cloud); degrade gracefully when unavailable.

## Schema
`captions.transliteration = { target:"ta|te|ml|kn|hi|en", scheme, mode:"inline|replace" }` (parallel to `captions.translation`). Per text layer, transliteration may replace or annotate `text` while keeping `text.lang` in sync.

## Determinism / parity
Pure mapping for a given (text, from, to, scheme) — no randomness. Test round-trips on known pairs (`ta→en→ta`, `ta↔hi`) and assert exact output for golden words. Mock the provider in unit tests.

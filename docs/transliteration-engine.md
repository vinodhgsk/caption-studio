# Transliteration Engine — Technical Documentation

> **TextStyler** | Offline Multi-Script Indic Transliteration  
> Last updated: 2026-06-27

---

## Table of Contents

1. [Overview](#overview)
2. [Supported Languages](#supported-languages)
3. [Architecture](#architecture)
4. [Dependencies](#dependencies)
5. [Dual Tamil Scheme Strategy](#dual-tamil-scheme-strategy)
6. [Pipeline Details](#pipeline-details)
   - [Tamil → English (Tanglish)](#tamil--english-tanglish)
   - [Tamil → Hindi / Telugu / Malayalam](#tamil--hindi--telugu--malayalam)
   - [English (Tanglish) → Tamil](#english-tanglish--tamil)
   - [English (Tanglish) → Other Indic Scripts](#english-tanglish--other-indic-scripts)
   - [Cross-Indic (Hindi ↔ Telugu ↔ Malayalam)](#cross-indic-hindi--telugu--malayalam)
   - [Indic → Tamil](#indic--tamil)
   - [Indic → English](#indic--english)
7. [Phonological Voicing Rules](#phonological-voicing-rules)
8. [Tamil Orthography Post-Processor](#tamil-orthography-post-processor)
9. [High-Frequency Exception Trie](#high-frequency-exception-trie)
10. [Tanglish ↔ ITRANS Conversion](#tanglish--itrans-conversion)
11. [Language Auto-Detection](#language-auto-detection)
12. [UI Integration](#ui-integration)
13. [Validation Results](#validation-results)
14. [Known Limitations](#known-limitations)
15. [File Reference](#file-reference)

---

## Overview

TextStyler includes a fully **offline, deterministic transliteration engine** that converts text between five scripts in real-time. It is purpose-built for devotional Tamil poetry but supports any Indic content. The engine operates entirely in the browser — no API calls, no server round-trips, no network dependency.

### Core Challenges Solved

1. **Tamil's limited consonant inventory:** Tamil has no voiced/aspirated consonant distinction in its script (க covers k/kh/g/gh), but spoken Tamil applies complex phonological voicing rules. Standard transliteration libraries produce raw, unnatural English results like "Anpe Civam" instead of "Anbe Sivam".

2. **Sanscript's reverse-mapping ambiguity:** The `@indic-transliteration/sanscript` library maps multiple Devanagari consonants to the same Tamil character (e.g., `क,ख,ग,घ` all → `க`). When reversing, it picks the **last** entry, producing incorrect voiced/aspirated characters (e.g., `க` → `घ` instead of `क`). Our dual-scheme strategy solves this.

3. **Tamil ந/ன disambiguation:** ITRANS has no separate code for the alveolar nasal `ன` (U+0BA9). Our orthography post-processor uses positional heuristics to correctly place `ன` vs `ந` when generating Tamil output.

---

## Supported Languages

| Code | Language   | Script       | Unicode Block    |
|------|------------|--------------|------------------|
| `ta` | Tamil      | Tamil        | `U+0B80–U+0BFF` |
| `hi` | Hindi      | Devanagari   | `U+0900–U+097F` |
| `te` | Telugu     | Telugu       | `U+0C00–U+0C7F` |
| `ml` | Malayalam  | Malayalam    | `U+0D00–U+0D7F` |
| `en` | English    | Latin/ITRANS | ASCII            |

Defined in: `src/types/styler.ts` as `LanguageCode = 'en' | 'ta' | 'te' | 'ml' | 'hi'`

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     transliterateIndic()                        │
│                   Main entry point (exported)                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  PATH 1: Source = Tamil                                         │
│  ├─ Pre-map: ன → ந                                             │
│  ├─ Tamil → ITRANS (via tamil_reverse scheme, unvoiced)         │
│  ├─ Target = English?                                           │
│  │   ├─ YES → applyTamilVoicing() → itransToTanglish()         │
│  │   └─ NO  → ITRANS → target Indic script (NO voicing)        │
│  │                                                              │
│  PATH 2: Source = English                                       │
│  ├─ tanglishToItrans() preprocessor                             │
│  ├─ Target = Tamil?                                             │
│  │   ├─ YES → ITRANS → Tamil (stock scheme) → fixOrthography() │
│  │   └─ NO  → ITRANS → target Indic script                     │
│  │                                                              │
│  PATH 3: Indic → Indic                                          │
│  ├─ Target = English? → Source → ITRANS → itransToTanglish()    │
│  ├─ Target = Tamil?   → Direct mapping → fixOrthography()       │
│  └─ Otherwise         → Direct Sanscript Brahmic mapping        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

All pipelines use **ITRANS** (Indian Languages Transliteration) as the intermediate representation. ITRANS is an ASCII encoding where uppercase/lowercase carry phonetic meaning (e.g., `T` = retroflex ட, `t` = dental த, `ch` = ச).

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@indic-transliteration/sanscript` | `1.3.3` | Core Brahmic script conversion engine. Handles raw character-level mapping between Unicode script blocks via ITRANS as an intermediary. |

Sanscript provides correct character-level mapping but has no awareness of Tamil phonology. All phonological intelligence is custom code in our engine.

---

## Dual Tamil Scheme Strategy

This is the most critical design decision in the engine.

### The Problem

Sanscript's stock `tamil` scheme has **many-to-one** consonant mappings:

```
क (ka) → க    ख (kha) → க    ग (ga) → க    घ (gha) → க
```

When doing **forward** mapping (ITRANS/Devanagari → Tamil), this works perfectly — all variants correctly collapse into Tamil's limited consonant set.

When doing **reverse** mapping (Tamil → ITRANS/Devanagari), Sanscript picks the **last** matching entry. Since `घ` (gha) is the last entry mapping to `க`, it produces:

```
க → घ (gha) ← WRONG! Should be क (ka)
```

This causes **every** Tamil consonant to be transliterated as its voiced/aspirated variant:
- `க` → `gha` (should be `ka`)
- `ப` → `bha` (should be `pa`)
- `த` → `dha` (should be `ta`)

### The Solution: Two Schemes

We register a separate **`tamil_reverse`** scheme with only **one** Devanagari entry per Tamil character — the unvoiced, unaspirated form:

| Scheme | Purpose | `க` maps to/from |
|--------|---------|-------------------|
| `tamil` (stock) | **Forward**: ITRANS → Tamil | `क,ख,ग,घ` all → `க` |
| `tamil_reverse` (custom) | **Reverse**: Tamil → ITRANS | `க` → `क` (ka only) |

```typescript
// Used in code as:
const SANSCRIPT_SOURCE_MAP = { ta: 'tamil_reverse', ... };  // Tamil → other
const SANSCRIPT_TARGET_MAP = { ta: 'tamil', ... };           // other → Tamil
```

### Additional Tamil Characters

The reverse scheme also includes three Tamil-specific characters absent from the stock ITRANS mapping:

| Devanagari | Tamil | ITRANS | Description |
|------------|-------|--------|-------------|
| `ऱ` | `ற` | `Ra` | Alveolar r (மற்றும்) |
| `ऴ` | `ழ` | `zha` | Retroflex approximant (தமிழ்) |
| `ऩ` | `ன` | — | Alveolar n (no ITRANS code; handled by pre-mapping) |

---

## Pipeline Details

### Tamil → English (Tanglish)

**Goal:** Produce natural, human-readable romanized Tamil (e.g., "அன்பே சிவம்" → "Anbe Sivam")

```
Input: அன்பே சிவம்
  ↓
Step 1: ன→ந pre-mapping         → அந்பே சிவம்
Step 2: Tamil → ITRANS           → "anpe chivam"    (via tamil_reverse)
Step 3: applyTamilVoicing()      → "anbe chivam"    (np→nb)
Step 4: itransToTanglish()       → "Anbe Sivam"     (ch→s, Title Case)
  ↓
Output: Anbe Sivam
```

### Tamil → Hindi / Telugu / Malayalam

**Goal:** Faithful character-level transliteration preserving Tamil orthographic structure.

```
Input: அன்பே சிவம்
  ↓
Step 1: ன→ந pre-mapping         → அந்பே சிவம்
Step 2: Tamil → ITRANS           → "anpe chivam"    (via tamil_reverse)
Step 3: ITRANS → target script   → "అన్పే చివమ్"   (NO voicing applied)
  ↓
Output: అన్పే చివమ్  (Telugu)
```

> **Key insight:** Phonological voicing is **never** applied to Indic target scripts. Voicing is a spoken-language phenomenon that only matters for English romanization. Telugu, Hindi, and Malayalam readers expect to see the raw Tamil orthographic structure faithfully transliterated.

### English (Tanglish) → Tamil

```
Input: Anbe Sivam
  ↓
Step 1: tanglishToItrans()       → "anpe chivam"    (b→p, s→ch)
Step 2: ITRANS → Tamil           → "அந்பே சிவம்"   (via stock tamil scheme)
Step 3: fixTamilOrthography()    → "அன்பே சிவம்"   (ந→ன mid-word)
  ↓
Output: அன்பே சிவம்
```

### English (Tanglish) → Other Indic Scripts

Same as English → Tamil but without Step 3 (orthography fix):

```
Input: Anbe Sivam  →  tanglishToItrans()  →  ITRANS → Telugu  →  అన్పే చివమ్
```

### Cross-Indic (Hindi ↔ Telugu ↔ Malayalam)

For non-Tamil, non-English source/target pairs, the engine delegates directly to Sanscript's Brahmic-to-Brahmic mapping:

```typescript
return Sanscript.t(text, sourceSchema, targetSchema);
```

This works reliably because Hindi, Telugu, and Malayalam share a nearly 1:1 consonant inventory across the Brahmic family.

### Indic → Tamil

When any Indic script targets Tamil, the orthography post-processor runs:

```typescript
let tamil = Sanscript.t(text, sourceSchema, 'tamil');
return fixTamilOrthography(tamil);
```

### Indic → English

When any Indic script targets English, we go through ITRANS and format as Tanglish:

```typescript
const itrans = Sanscript.t(text, sourceSchema, 'itrans');
return itransToTanglish(itrans);
```

---

## Phonological Voicing Rules

These rules transform raw Tamil orthography into phonetically accurate representations. They are **only** applied when the target is English — never for Indic scripts.

### Nasal Assimilations

| Pattern | ITRANS | Replacement | Tamil Example |
|---------|--------|-------------|---------------|
| ங + க | `~Nk` | `~Ng` | ங்க → ng |
| ஞ + ச | `~nch` | `~nj` | ஞ்ச → nj |
| ண + ட | `NT`   | `ND`  | ண்ட → ND |
| ந + த | `nt`   | `ndh` | ந்த → ndh |
| ம + ப | `mp`   | `mb`  | ம்ப → mb |
| ந + ப | `np`   | `nb`  | ந்ப → nb (அன்பே → anbe) |
| ந + க | `nk`   | `ng`  | ந்க → ng |

### Intervocalic Voicing

When a stop consonant appears between two vowels, it voices:

| Pattern | Replacement | Tamil Example |
|---------|-------------|---------------|
| V + `k` + V | V + `g` + V | அகம் → agam |
| V + `ch` + V | V + `s` + V | அசை → asai |
| V + `T` + V | V + `D` + V | அடி → aDi |
| V + `t` + V | V + `dh` + V | அதை → adhai |
| V + `p` + V | V + `b` + V | அபம் → abam |

*(V = any vowel: `A E I O U a e i o u`)*

---

## Tamil Orthography Post-Processor

**Problem:** When converting into Tamil script, ITRANS `n` maps to dental `ந` (U+0BA8). But Tamil orthography requires the alveolar `ன` (U+0BA9) in most mid-word and word-final positions.

**When applied:** Every path that produces Tamil output (English→Tamil, Hindi→Tamil, Telugu→Tamil, Malayalam→Tamil).

**Rules (applied in order):**

1. **`ந்` (with virama) at mid-word position:**
   - If followed by `த` → keep as `ந்` (ந்த cluster: vandha = வந்த)
   - Otherwise → replace with `ன்` (anbe = அன்பே, unnai = உன்னை)
   - Exception: word-initial always stays `ந்`

2. **`ந` (without virama) at mid-word position:**
   - Replace with `ன` (puvanam = புவனம்)
   - Exception: word-initial stays `ந` (nilai = நிலை)

```typescript
function fixTamilOrthography(tamil: string): string {
  return tamil
    .replace(/ந்/g, (match, offset, str) => {
      // Recognizes \u200C as word boundary to protect ந்
      if (offset === 0 || /[\s\n\u200C]/.test(str[offset - 1])) return 'ந்';
      if (str[offset + 2] === 'த') return 'ந்';
      return 'ன்';
    })
    .replace(/ந(?!்)/g, (match, offset, str) => {
      // Recognizes \u200C as word boundary to protect ந
      if (offset === 0 || /[\s\n\u200C]/.test(str[offset - 1])) return 'ந';
      return 'ன';
    });
}
```

---

## High-Frequency Exception Trie

To solve inherent Tanglish ambiguities (e.g., distinguishing between `ல`/`ள`, `ர`/`ற`, and short/long vowels), the engine includes a highly compressed **O(L) Exception Trie** (`tamilExceptions.ts`).

**How it works:**
1. During `tanglishToItrans`, the input is tokenized by word boundaries.
2. Each word is checked against the `ExceptionTrie`.
3. If an exact match is found (e.g., `ullam` -> `uLLam`), the exact ITRANS string is swapped in *before* the generic regex parser runs.
4. If no match is found, the generic regex parsing takes over.

### The Compound Word Fix (`\u200C`)

The Trie also fixes a critical issue where the Tamil Orthography Post-Processor breaks compound words. For example, `thirunaamam` consists of `thiru` + `naamam` (திருநாமம்). The post-processor normally sees the `ந` as "mid-word" and incorrectly converts it to `திருனாமம்`.

**The Solution:**
The dictionary stores compound words with a **Zero-Width Non-Joiner (ZWNJ, `\u200C`)**. 
- Dictionary entry: `"thirunaamam": "tiru\u200CnAmam"`
- The post-processor regex recognizes `\u200C` as a word boundary, successfully preserving the `ந` (yielding `திரு\u200Cநாமம்`).
- A `finalizeOutput()` function strips the `\u200C` globally before returning the text, ensuring the invisible character never leaks into the final output or other Indic scripts (Telugu/Hindi).

---

## Tanglish ↔ ITRANS Conversion

### Tanglish → ITRANS (English input preprocessing)

Converts natural English romanization to strict ITRANS notation:

| Tanglish | ITRANS | Explanation |
|----------|--------|-------------|
| `oo` | `U` | Long u vowel |
| `ee` | `I` | Long i vowel |
| `aa` | `A` | Long a vowel |
| `thth` | `tt` | Double dental |
| `th` | `t` | Single dental |
| `dh` | `t` | Voiced dental → unvoiced |
| `b` | `p` | Voiced labial → unvoiced |
| `g` | `k` | Voiced velar → unvoiced |
| `d` | `T` | Voiced retroflex → unvoiced |
| `s` | `ch` | Sibilant → ச (ITRANS `ch`) |
| `ng` | `~Nk` | Velar nasal cluster |
| `nb` | `np` | Nasal + voiced → unvoiced |
| `rr` | `RR` | Alveolar trill (ற்ற) |

### ITRANS → Tanglish (English output formatting)

Converts strict ITRANS to readable English:

| ITRANS | Tanglish | Explanation |
|--------|----------|-------------|
| `U` | `oo` | Long u vowel |
| `A` | `aa` | Long a vowel |
| `I` | `ee` | Long i vowel |
| `tt` | `thth` | Double dental |
| `t` | `th` | Single dental |
| `T` | `t` | Retroflex |
| `ch` | `s` | ச → s in Tanglish |
| All caps | lowercase + Title Case | Clean formatting |

---

## Language Auto-Detection

The `detectIndicLanguage()` function identifies the script of pasted text:

```typescript
const tamilRegex      = /[\u0B80-\u0BFF]/;
const devanagariRegex = /[\u0900-\u097F]/;
const teluguRegex     = /[\u0C00-\u0C7F]/;
const malayalamRegex  = /[\u0D00-\u0D7F]/;
```

**Priority order:** Tamil > Hindi > Telugu > Malayalam > English (ASCII fallback)

---

## UI Integration

### Paste Detection (Textarea `onChange`)

Auto-detects language of pasted text and updates the dropdown:

```tsx
onChange={(e) => {
  const newText = e.target.value;
  const detectedLang = detectIndicLanguage(newText);
  setTextStyle({
    content: newText,
    language: detectedLang || textStyle.language
  });
}}
```

### Language Switch (Dropdown `onChange`)

Transliterates content when the user changes the language:

```tsx
onChange={(e) => {
  const newLang = e.target.value as LanguageCode;
  const transliterated = transliterateIndic(
    textStyle.content, textStyle.language, newLang
  );
  setTextStyle({ language: newLang, content: transliterated });
}}
```

---

## Validation Results

### Tamil → All Languages

Source: `வைராக்கிய நிலை எய்த / பூத்தவளே புவனம்...`

| Target | Sample Output | Status |
|--------|---------------|--------|
| English | `Vairaakkiya Nilai Eytha / Pooththavale Puvanam...` | ✅ |
| Telugu | `వైరాక్కియ నిలై ఎయ్త / పూత్తవళే పువనమ్...` | ✅ |
| Hindi | `वैराक्किय निलै ऎय्त / पूत्तवळे पुवनम्...` | ✅ |
| Malayalam | `വൈരാക്കിയ നിലൈ എയ്ത / പൂത്തവളേ പുവനമ്...` | ✅ |

### Critical Test: அன்பே சிவம்

| Target | Output | Status |
|--------|--------|--------|
| English | `Anbe Sivam` | ✅ |
| Telugu | `అన్పే చివమ్` | ✅ |
| Hindi | `अन्पे चिवम्` | ✅ |
| Malayalam | `അന്പേ ചിവമ്` | ✅ |

### Round-Trip: Tamil → English → Tamil

```
அன்பே சிவம்  →  Anbe Sivam  →  அன்பே சிவம்  ✅
```

### Cross-Indic

| Path | Output | Status |
|------|--------|--------|
| Telugu → Hindi | `అన్పే చివమ్` → `अन्पे चिवम्` | ✅ |
| Hindi → Tamil | `अन्पे चिवम्` → `அன்பே சிவம்` | ✅ |
| Telugu → Malayalam | `అన్పే చివమ్` → `അന്പേ ചിവമ്` | ✅ |

---

## Known Limitations

| Area | Limitation | Reason |
|------|-----------|--------|
| **ல vs ள** | English → Tamil disambiguated only for known words | `Exception Trie` handles high-frequency words; others default to `ல` |
| **ர vs ற** | English → Tamil defaults `r` to `ர`; `ற` requires `rr` | `Exception Trie` handles classical exceptions; otherwise defaults to `ர` |
| **Short/long e/o** | `e` in Tanglish defaults to long `ே`/`ஏ` | `Exception Trie` handles exact vowels for known words |
| **ன vs ந** | Post-processor uses positional heuristics (~95% accurate) | Compound words like `thirunaamam` use ZWNJ (`\u200C`) in Trie to guarantee `ந` |
| **English → Tamil is lossy** | Tamil has 18 consonants; Tanglish collapses many | Inherent limitation of romanization |
| **Telugu/Hindi → English** | Voicing rules are Tamil-specific; other languages use raw ITRANS | `అన్పే` → "Anpe" not "Anbe" (correct behavior) |

---

## File Reference

All transliteration code is consolidated under `src/utils/transliteration/`.

| File | Purpose |
|------|---------|
| [algorithmicTransliterator.ts](../src/utils/transliteration/algorithmicTransliterator.ts) | Core engine — schemes, pipelines, voicing, orthography, detection |
| [tamilExceptions.ts](../src/utils/transliteration/tamilExceptions.ts) | High-Frequency Exception Trie and ZWNJ dictionary |
| [baminiConverter.ts](../src/utils/transliteration/baminiConverter.ts) | Bamini font encoding conversions |
| [textParser.ts](../src/utils/transliteration/textParser.ts) | Multi-language text parsing utilities |
| [tamilFontLoader.ts](../src/utils/transliteration/tamilFontLoader.ts) | Tamil typography and font loaders |
| [zipFontLoader.ts](../src/utils/transliteration/zipFontLoader.ts) | ZIP-based font loading engine |
| [styler.ts](../src/types/styler.ts) | `LanguageCode` type definition |
| [App.tsx](../src/App.tsx) | UI integration — textarea paste handler, language dropdown |
| [useStylerStore.ts](../src/store/useStylerStore.ts) | Zustand store for state management |

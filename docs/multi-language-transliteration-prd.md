# Product Requirements Document (PRD)
## Multi-Language Transliteration Engine

---

## 1. Product Overview

The Multi-Language Transliteration Engine is a deterministic, fully offline module designed to translate text across multiple Indic scripts (Tamil, Telugu, Hindi, Malayalam) and English (Tanglish) in real-time. It ensures that when a user pastes text in one script, it is perfectly synchronized and transliterated across all supported languages, preserving both orthographic integrity and phonetic accuracy.

**Key Objectives:**
- **Zero Network Dependency:** The engine must run 100% on the client side using algorithmic mappings, without relying on external APIs (like Google Translate).
- **Phonetic Accuracy for English:** Tanglish output must reflect spoken phonetics (e.g., "Anbe Sivam" instead of "Anpe Chivam").
- **Orthographic Accuracy for Indic Scripts:** Hindi, Telugu, and Malayalam outputs must maintain exact structural mapping without applying English-specific voicing rules.
- **Real-Time Sync:** Updating text in one language must instantly generate accurate translations across all other available languages.

---

## 2. Technical Architecture & Approach

The engine uses **ITRANS** (Indian Languages Transliteration) as an intermediate ASCII bridge. It leverages the `@indic-transliteration/sanscript` library for raw Unicode mapping but layers complex custom logic to handle script-specific anomalies.

### 2.1 The Dual-Scheme Architecture (The Core Breakthrough)
Standard transliteration libraries struggle with reverse mapping Tamil because it has a limited consonant inventory (e.g., `क`, `ख`, `ग`, `घ` all map to `க`). A naive reverse lookup defaults to the last mapped character, causing `க` to always transliterate back as `घ` (gha).

**Solution:**
We use a **Dual-Scheme Strategy**:
1. **`tamil` (Stock Scheme):** Used for forward mapping (Other → Tamil). It safely collapses all voiced/aspirated consonants into Tamil's limited set.
2. **`tamil_reverse` (Custom Scheme):** Used for reverse mapping (Tamil → Other). It strips all voiced/aspirated mappings, ensuring `க` strictly maps back to the unvoiced `क` (ka).

### 2.2 Contextual Phonological Voicing
Tamil script lacks voiced consonants (b, d, g, j), but spoken Tamil uses them contextually. 
**Rule:** Voicing logic (e.g., `np` → `nb`, `mp` → `mb`, intervocalic voicing) is applied **ONLY** when the target language is English. It is strictly bypassed when translating to Telugu, Hindi, or Malayalam to preserve raw orthography.

### 2.3 Exception Trie & ZWNJ Strategy
To handle exact classical/devotional exceptions (e.g., retroflex `L` vs dental `l`, `ழ` vs `zha`):
- A highly compressed **O(L) Trie Dictionary** checks tokens before regex parsing.
- **Compound Word Fix:** To protect the dental `ந` from incorrectly mutating into alveolar `ன` at compound word boundaries (e.g., `thirunaamam`), the dictionary stores words with a Zero-Width Non-Joiner (`\u200C`). The engine recognizes `\u200C` as a word boundary, preserves the `ந`, and globally strips the `\u200C` before final output.

---

## 3. Functional Implementation: How Languages Stay in Sync

1. **Auto-Detection:** When text is pasted into a generic input field, a Unicode-range regex (`/[\u0B80-\u0BFF]/` for Tamil, etc.) detects the source language.
2. **State Management:** The source text and detected language are committed to a centralized store (e.g., Zustand/Redux).
3. **On-Demand Transliteration:** When the user switches the UI dropdown to a new language, the app calls `transliterateIndic(text, sourceLang, targetLang)`.
4. **Pipeline Execution:**
   - If `source === 'ta'`, the text is pre-mapped (e.g., `ன` → `ந`), converted to ITRANS via `tamil_reverse`, and pushed to the target script.
   - If `target === 'en'`, phonological voicing and Title Case formatting are applied.
   - If `target === 'ta'`, the Tamil Orthography Post-Processor fixes mid-word `ந`/`ன` rules.

---

## 4. Step-by-Step Prompt Guide to Recreate This Engine

If you need an AI or engineer to replicate this exact offline transliteration functionality in a new project, feed them the following prompts sequentially. These prompts are highly detailed and architecturally precise to ensure exact reproduction.

### Prompt 1: Project Initialization & Auto-Detection
> **Prompt:** "Set up a new transliteration utility module in a TypeScript project. Install the `@indic-transliteration/sanscript` library. Create a file named `algorithmicTransliterator.ts`. Define a type `LanguageCode` supporting `'en' | 'ta' | 'te' | 'ml' | 'hi'`. Create a function `detectIndicLanguage(text: string): LanguageCode` that uses Unicode regex blocks to detect if a string is Tamil (`[\u0B80-\u0BFF]`), Telugu (`[\u0C00-\u0C7F]`), Hindi (`[\u0900-\u097F]`), Malayalam (`[\u0D00-\u0D7F]`), or English (fallback). Finally, create two mapping objects `SANSCRIPT_SOURCE_MAP` and `SANSCRIPT_TARGET_MAP` to map `LanguageCode` to Sanscript scheme names."

<details>
<summary><b>Code Implementation Reference</b></summary>

```typescript
import Sanscript from '@indic-transliteration/sanscript';

export type LanguageCode = 'en' | 'ta' | 'hi' | 'te' | 'ml';

export const SANSCRIPT_SOURCE_MAP: Record<string, string> = {
  hi: 'devanagari', te: 'telugu', ml: 'malayalam', ta: 'tamil_reverse'
};

export const SANSCRIPT_TARGET_MAP: Record<string, string> = {
  hi: 'devanagari', te: 'telugu', ml: 'malayalam', ta: 'tamil'
};

export function detectIndicLanguage(text: string): LanguageCode | null {
  if (/[\u0B80-\u0BFF]/.test(text)) return 'ta';
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  if (/[\u0C00-\u0C7F]/.test(text)) return 'te';
  if (/[\u0D00-\u0D7F]/.test(text)) return 'ml';
  if (/^[a-zA-Z\s.,!?'"()-]+$/.test(text)) return 'en';
  return null;
}
```
</details>

---

### Prompt 2: The Dual-Scheme Setup
> **Prompt:** "In `algorithmicTransliterator.ts`, we must solve Sanscript's reverse-mapping ambiguity for Tamil. Deep copy the stock `Sanscript.schemes.tamil` to create a new scheme called `tamil_reverse`. In the `consonants` object of this new scheme, restrict the mapping so that each Tamil character only has ONE Devanagari equivalent — strictly the unvoiced, unaspirated versions (e.g., `'क': 'க'`, remove `'ख'`, `'ग'`, `'घ'`). Also include Tamil-specific alveolar characters in the `consonants` array: map `'ऱ'` to `'ற'`, `'ऴ'` to `'ழ'`, and `'ऩ'` to `'ன'`. Register this scheme via `Sanscript.addBrahmicScheme('tamil_reverse', customScheme)`."

<details>
<summary><b>Code Implementation Reference</b></summary>

```typescript
const tamilReverseScheme = JSON.parse(JSON.stringify(Sanscript.schemes.tamil));
tamilReverseScheme.consonants = {
  'क': 'க', 'च': 'ச', 'ट': 'ட', 'त': 'த', 'प': 'ப',
  'ङ': 'ங', 'ञ': 'ஞ', 'ण': 'ண', 'न': 'ந', 'म': 'ம',
  'य': 'ய', 'र': 'ர', 'ल': 'ல', 'व': 'வ',
  'ळ': 'ள', 'ऱ': 'ற', 'ऴ': 'ழ', 'ऩ': 'ன'
};
Sanscript.addBrahmicScheme('tamil_reverse', tamilReverseScheme);
```
</details>

---

### Prompt 3: English (Tanglish) Formatting & Voicing
> **Prompt:** "Create a function `applyTamilVoicing(itrans: string): string` that applies Tamil phonological rules to an ITRANS string. Implement regex replacements for:
> 1. Nasal assimilations: `~Nk` to `~Ng`, `~nch` to `~nj`, `NT` to `ND`, `nt` to `ndh`, `mp` to `mb`, `np` to `nb`, `nk` to `ng`.
> 2. Intervocalic voicing: stop consonants (`k, ch, T, t, p`) between two vowels (case-insensitive `[AEIOUaeiou]`) become `g, s, D, dh, b` respectively.
> 
> Next, create `itransToTanglish(itrans: string): string` that converts strict ITRANS to readable English (e.g., `U` -> `oo`, `I` -> `ee`, `A` -> `aa`, `tt` -> `thth`, `t` -> `th`, `T` -> `t`, `ch` -> `s`, `RR` -> `rr`). Finally, apply Title Case to every word."

<details>
<summary><b>Code Implementation Reference</b></summary>

```typescript
function applyTamilVoicing(itrans: string): string {
  let voiced = itrans
    .replace(/~Nk/g, '~Ng')
    .replace(/~nch/g, '~nj')
    .replace(/NT/g, 'ND')
    .replace(/nt/g, 'ndh')
    .replace(/mp/g, 'mb')
    .replace(/np/g, 'nb')
    .replace(/nk/g, 'ng');

  const vowels = 'AEIOUaeiou';
  const v = `[${vowels}]`;
  return voiced
    .replace(new RegExp(`(${v})k(${v})`, 'g'), '$1g$2')
    .replace(new RegExp(`(${v})ch(${v})`, 'g'), '$1s$2')
    .replace(new RegExp(`(${v})T(${v})`, 'g'), '$1D$2')
    .replace(new RegExp(`(${v})t(${v})`, 'g'), '$1dh$2')
    .replace(new RegExp(`(${v})p(${v})`, 'g'), '$1b$2');
}

function itransToTanglish(itrans: string): string {
  let tanglish = itrans
    .replace(/U/g, 'oo')
    .replace(/A/g, 'aa')
    .replace(/I/g, 'ee')
    .replace(/tt/g, 'thth')
    .replace(/t/g, 'th')
    .replace(/T/g, 't')
    .replace(/ch/g, 's')
    .replace(/~N/g, 'n')
    .replace(/RR/g, 'rr')
    .replace(/R/g, 'r')
    .toLowerCase();
    
  return tanglish.replace(/\b[a-z]/g, char => char.toUpperCase());
}
```
</details>

---

### Prompt 4: Tamil Orthography Post-Processor
> **Prompt:** "Create a function `fixTamilOrthography(tamil: string): string`. When Sanscript converts ITRANS `n` to Tamil, it defaults to the dental `ந`. We must fix mid-word placements to use the alveolar `ன`.
> Write two regex replacements using positional heuristics: 
> 1. Replace `ந்` (with virama): If it is word-initial (or preceded by `\u200C`) OR followed immediately by `த` (like in `வந்த`), keep it as `ந்`. Otherwise, change it to `ன்`. 
> 2. Replace `ந` (without virama): If it is word-initial (or preceded by `\u200C`), keep it as `ந`. Otherwise, change it to `ன`.
> 
> Also create a `finalizeOutput(text: string)` function that simply runs `.replace(/\u200C/g, '')` to globally strip the ZWNJ marker."

<details>
<summary><b>Code Implementation Reference</b></summary>

```typescript
function fixTamilOrthography(tamil: string): string {
  return tamil
    .replace(/ந்/g, (_: string, offset: number, str: string) => {
      // Recognizes \u200C as word boundary to protect ந்
      if (offset === 0 || /[\s\n\u200C]/.test(str[offset - 1])) return 'ந்';
      if (str[offset + 2] === 'த') return 'ந்'; // ந்த cluster
      return 'ன்';
    })
    .replace(/ந(?!்)/g, (_: string, offset: number, str: string) => {
      // Recognizes \u200C as word boundary to protect ந
      if (offset === 0 || /[\s\n\u200C]/.test(str[offset - 1])) return 'ந';
      return 'ன';
    });
}

function finalizeOutput(text: string): string {
  return text.replace(/\u200C/g, '');
}
```
</details>

---

### Prompt 5: The Exception Trie & ZWNJ Dictionary
> **Prompt:** "Create a new file `tamilExceptions.ts`. Implement a `TamilExceptionTrie` class using a standard Trie data structure (nodes with `children` maps and `isEndOfWord/value` properties). Expose `insert(word, value)` and `search(word)` methods.
> 
> Instantiate `exceptionTrie` and populate it with a dictionary of high-frequency classical Tamil words mapped from exact Tanglish to strict ITRANS (e.g., `'ullam': 'uLLam'`, `'pazham': 'pazham'`, `'arul': 'aruL'`). 
> For compound words where the second word starts with `n` (which must map to `ந`), inject a Zero-Width Non-Joiner `\u200C` into the ITRANS string to protect it from the post-processor (e.g., `'thirunaamam': 'tiru\u200CnAmam'`). Export the populated trie."

<details>
<summary><b>Code Implementation Reference</b></summary>

```typescript
class TrieNode {
  children: Map<string, TrieNode> = new Map();
  isEndOfWord: boolean = false;
  value: string = '';
}

export class TamilExceptionTrie {
  root: TrieNode = new TrieNode();

  insert(word: string, value: string) {
    let node = this.root;
    for (const char of word.toLowerCase()) {
      if (!node.children.has(char)) {
        node.children.set(char, new TrieNode());
      }
      node = node.children.get(char)!;
    }
    node.isEndOfWord = true;
    node.value = value;
  }

  search(word: string): string | null {
    let node = this.root;
    for (const char of word.toLowerCase()) {
      if (!node.children.has(char)) return null;
      node = node.children.get(char)!;
    }
    return node.isEndOfWord ? node.value : null;
  }
}

export const exceptionTrie = new TamilExceptionTrie();
const exceptions: Record<string, string> = {
  "ullam": "uLLam",
  "pazham": "pazham",
  "arul": "aruL",
  // Compound word using \u200C to protect the dental 'n' (ந)
  "thirunaamam": "tiru\u200CnAmam", 
};

for (const [key, val] of Object.entries(exceptions)) {
  exceptionTrie.insert(key, val);
}
```
</details>

---

### Prompt 6: Token-Aware English Preprocessing
> **Prompt:** "In `algorithmicTransliterator.ts`, import `exceptionTrie`. Create a function `tanglishToItrans(text: string): string`. This function must be token-aware: split the input into tokens using regex `/([a-zA-Z]+)/g`. For each token:
> 1. If it's a word, check `exceptionTrie.search(word)`. If a match is found, return it immediately!
> 2. If no match, run generic fallback replacements: convert `oo->U`, `ee->I`, `aa->A`, `th->t`, `ng->~Nk`, `nb->np`. Convert all voiced English consonants (`b, d, g, j`) to unvoiced (`p, T, k, ch`).
> Join the tokens back together."

<details>
<summary><b>Code Implementation Reference</b></summary>

```typescript
import { exceptionTrie } from './tamilExceptions';

function tanglishToItrans(text: string): string {
  // Tokenize by word to allow exact trie dictionary matching
  const tokens = text.split(/([a-zA-Z]+)/g);
  
  return tokens.map(token => {
    if (!/^[a-zA-Z]+$/.test(token)) return token; // Skip punctuation/spaces
    
    // 1. Check Trie for exact word match
    const exactMatch = exceptionTrie.search(token);
    if (exactMatch) return exactMatch;

    // 2. Generic regex fallback
    return token.toLowerCase()
      .replace(/oo/g, 'U').replace(/ee/g, 'I').replace(/aa/g, 'A')
      .replace(/thth/g, 'tt').replace(/th/g, 't')
      .replace(/ng/g, '~Nk').replace(/nb/g, 'np')
      .replace(/dh/g, 't').replace(/b/g, 'p')
      .replace(/g/g, 'k').replace(/d/g, 'T')
      .replace(/s/g, 'ch').replace(/rr/g, 'RR');
  }).join('');
}
```
</details>

---

### Prompt 7: Assembling the Final Pipeline
> **Prompt:** "Create the main exported `transliterateIndic(text: string, sourceLang: LanguageCode, targetLang: LanguageCode): string` function. 
> 
> Handle three distinct paths:
> **Path 1 (Source = Tamil):** Replace `ன` with `ந` (since `tamil_reverse` only maps `ந`). Convert to ITRANS using `tamil_reverse`. If target is English, apply `applyTamilVoicing` then `itransToTanglish`. If target is Indic, map straight to the target script.
> 
> **Path 2 (Source = English):** Convert to ITRANS using `tanglishToItrans`. If target is Tamil, map using stock `tamil` schema and wrap in `fixTamilOrthography`. If target is other Indic, map straight to target.
> 
> **Path 3 (Indic to Indic):** If target is English, convert to ITRANS and `itransToTanglish`. If target is Tamil, map to `tamil` and `fixTamilOrthography`. Otherwise, directly map Brahmic to Brahmic.
> 
> *Crucial:* Wrap EVERY single return statement inside `transliterateIndic` with the `finalizeOutput()` function to strip ZWNJ markers globally."

<details>
<summary><b>Code Implementation Reference</b></summary>

```typescript
export function transliterateIndic(text: string, sourceLang: LanguageCode, targetLang: LanguageCode): string {
  if (!text || sourceLang === targetLang) return text;

  // PATH 1: Tamil Source
  if (sourceLang === 'ta') {
    const preMappedTa = text.replace(/ன/g, 'ந').replace(/ன்/g, 'ந்');
    const itrans = Sanscript.t(preMappedTa, 'tamil_reverse', 'itrans');

    if (targetLang === 'en') {
      const phonetized = applyTamilVoicing(itrans);
      return finalizeOutput(itransToTanglish(phonetized));
    } else {
      return finalizeOutput(Sanscript.t(itrans, 'itrans', SANSCRIPT_TARGET_MAP[targetLang]));
    }
  }

  // PATH 2: English Source
  if (sourceLang === 'en') {
    const itrans = tanglishToItrans(text);

    if (targetLang === 'ta') {
      let tamil = Sanscript.t(itrans, 'itrans', 'tamil');
      return finalizeOutput(fixTamilOrthography(tamil));
    } else {
      return finalizeOutput(Sanscript.t(itrans, 'itrans', SANSCRIPT_TARGET_MAP[targetLang]));
    }
  }

  // PATH 3: Indic -> Indic (Non-Tamil/English Source)
  const sourceSchema = SANSCRIPT_SOURCE_MAP[sourceLang];
  const targetSchema = SANSCRIPT_TARGET_MAP[targetLang];

  if (targetLang === 'en') {
    const itrans = Sanscript.t(text, sourceSchema, 'itrans');
    return finalizeOutput(itransToTanglish(itrans));
  }

  if (targetLang === 'ta') {
    let tamil = Sanscript.t(text, sourceSchema, targetSchema);
    return finalizeOutput(fixTamilOrthography(tamil));
  }

  return finalizeOutput(Sanscript.t(text, sourceSchema, targetSchema));
}
```
</details>

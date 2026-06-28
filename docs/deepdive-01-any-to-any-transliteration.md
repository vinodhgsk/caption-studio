# Deep Dive: Any-to-Any Language Transliteration Engine

---

## 1. The Core Philosophy

The heart of the TextStyler transliteration engine is its **Any-to-Any** routing architecture. It supports 5 scripts (Tamil, Telugu, Hindi, Malayalam, and English/Tanglish) which results in `5 x 5 = 25` possible directional pairs.

Instead of writing 25 separate conversion logic paths, the engine uses **ITRANS (Indian Languages Transliteration)** as a universal intermediate bridge. The `@indic-transliteration/sanscript` library powers the raw Unicode mapping, but it is heavily augmented with custom logic to handle orthographic and phonological edge cases that a raw mapper cannot solve.

---

## 2. The Three Pipeline Paths

The `transliterateIndic(text, sourceLang, targetLang)` function is designed around **three distinct execution paths** based on the source language. This routing guarantees that whether the user is typing in Hindi and translating to Tamil, or typing in English and translating to Telugu, the text perfectly synchronizes.

### Path 1: Tamil Source (The Reverse Mapping Problem)
Tamil has a limited consonant inventory (`க` represents k, kh, g, gh). Standard transliteration fails when reversing Tamil back to other scripts because it defaults to voiced/aspirated consonants (e.g., mapping `க` to `gh`). 

**The Solution:**
When `sourceLang === 'ta'`, the engine uses a custom `tamil_reverse` scheme that restricts the reverse mapping strictly to unvoiced consonants.
1. **Pre-map:** Convert alveolar `ன` to dental `ந` (because `ன` has no Devanagari equivalent).
2. **Bridge:** Convert Tamil to ITRANS using the `tamil_reverse` scheme.
3. **Target Routing:** 
   - If target is **English**: Apply Tamil phonological voicing (e.g. `nk` -> `ng`) and format as Tanglish.
   - If target is **Indic (Hindi/Telugu/Malayalam)**: Convert ITRANS directly to the target script. *No voicing is applied to preserve strict orthographic mapping.*

### Path 2: English Source (The English-to-Indic Bridge)
English (Tanglish) relies heavily on classical conventions (e.g., `th` for `த`, `zh` for `ழ`).

**The Solution:**
When `sourceLang === 'en'`, the input passes through the `tanglishToItrans` preprocessor.
1. **Tokenization & Trie Check:** The text is split by words. Each word is checked against an `ExceptionTrie` for classical overrides (e.g., `ullam` -> `uLLam`).
2. **Regex Fallbacks:** Generic mappings are applied (e.g., `oo` -> `U`, voiced English `b/d/g` stripped back to unvoiced `p/T/k`).
3. **Target Routing:**
   - If target is **Tamil**: Convert ITRANS to Tamil (using stock scheme), then run `fixTamilOrthography` to fix mid-word `ந`/`ன` boundaries.
   - If target is **Indic**: Convert ITRANS directly to target script.

### Path 3: Indic-to-Indic (The Brahmic Highway)
For non-Tamil, non-English source languages (e.g., Hindi → Telugu, Malayalam → Hindi), the engine delegates to direct Brahmic mapping, as these scripts share nearly 1:1 structural parity.

**The Solution:**
1. Determine `sourceSchema` (e.g., `devanagari`) and `targetSchema` (e.g., `telugu`).
2. **Target Routing:**
   - If target is **English**: Convert source to ITRANS, format to Tanglish.
   - If target is **Tamil**: Convert source directly to Tamil, run `fixTamilOrthography`.
   - If target is **Other Indic**: Convert source directly to target via Sanscript.

---

## 3. The Centralized Engine Code

Here is the exact TypeScript implementation of this Any-to-Any architecture:

```typescript
export function transliterateIndic(
  text: string,
  sourceLang: LanguageCode,
  targetLang: LanguageCode
): string {
  if (!text || text.trim() === '') return '';
  if (sourceLang === targetLang) return text;

  // Strips the Zero-Width Non-Joiner used for compound words
  const finalizeOutput = (str: string) => str.replace(/\u200C/g, '');

  try {
    // =========================================================================
    // PATH 1: Tamil Source
    // =========================================================================
    if (sourceLang === 'ta') {
      const textToProcess = text.replace(/ன/g, 'ந');
      const itrans = Sanscript.t(textToProcess, 'tamil_reverse', 'itrans');

      if (targetLang === 'en') {
        const phonetized = applyTamilVoicing(itrans);
        return finalizeOutput(itransToTanglish(phonetized));
      } else {
        return finalizeOutput(Sanscript.t(itrans, 'itrans', SANSCRIPT_TARGET_MAP[targetLang]));
      }
    }

    // =========================================================================
    // PATH 2: English Source
    // =========================================================================
    if (sourceLang === 'en') {
      const itrans = tanglishToItrans(text);

      if (targetLang === 'ta') {
        let tamil = Sanscript.t(itrans, 'itrans', 'tamil');
        return finalizeOutput(fixTamilOrthography(tamil));
      } else {
        return finalizeOutput(Sanscript.t(itrans, 'itrans', SANSCRIPT_TARGET_MAP[targetLang]));
      }
    }

    // =========================================================================
    // PATH 3: Indic Source (Hindi, Telugu, Malayalam)
    // =========================================================================
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

    // Hindi <-> Telugu <-> Malayalam direct mapping
    return finalizeOutput(Sanscript.t(text, sourceSchema, targetSchema));

  } catch (error) {
    console.error(`[Transliteration Error] Failed: ${sourceLang} → ${targetLang}`, error);
    return text;
  }
}
```

---

## 4. The Sync Mechanism

The any-to-any architecture allows perfect state synchronization. In the React UI, the state holds the active `content` and the `sourceLanguage`. When a user clicks a dropdown to change the language to Telugu:
1. The `transliterateIndic(content, 'en', 'te')` function is called.
2. The state is updated: `content` becomes the Telugu text, `sourceLanguage` becomes `te`.
3. If they switch back to English, `transliterateIndic(content, 'te', 'en')` is called, reversing the process. 

This creates a seamless, autonomous, real-time multi-language ecosystem inside the browser.

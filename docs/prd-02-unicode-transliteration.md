# PRD 02: Unicode Transliteration & Phonology
## Multi-Language Transliteration Engine

---

## 1. The Dual-Scheme Setup
Standard transliteration libraries struggle with reverse mapping Tamil because it has a limited consonant inventory (e.g., `क`, `ख`, `ग`, `घ` all map to `க`). A naive reverse lookup defaults to the last mapped character, causing `க` to always transliterate back as `घ` (gha).

### Prompt 1
> **Prompt:** "In `algorithmicTransliterator.ts`, we must solve Sanscript's reverse-mapping ambiguity for Tamil. Deep copy the stock `Sanscript.schemes.tamil` to create a new scheme called `tamil_reverse`. In the `consonants` object of this new scheme, restrict the mapping so that each Tamil character only has ONE Devanagari equivalent — strictly the unvoiced, unaspirated versions (e.g., `'क': 'க'`, remove `'ख'`, `'ग'`, `'घ'`). Also include Tamil-specific alveolar characters in the `consonants` array: map `'ऱ'` to `'ற'`, `'ऴ'` to `'ழ'`, and `'ऩ'` to `'ன'`. Register this scheme via `Sanscript.addBrahmicScheme('tamil_reverse', customScheme)`."

### Code Implementation
```typescript
const tamilReverseScheme = JSON.parse(JSON.stringify(Sanscript.schemes.tamil));
tamilReverseScheme.consonants = {
  'क': 'க', 'च': 'ச', 'ट': 'ட', 'त': 'த', 'प': 'ப',
  'ङ': 'ங', 'ञ': 'ஞ', 'ण': 'ண', 'न': 'ந', 'म': 'ம',
  'य': 'ய', 'र': 'ர', 'ल': 'ல', 'व': 'வ',
  'ळ': 'ள', 'ऱ': 'ற', 'ऴ': 'ழ', 'ऩ': 'ன' // ன mapped to Devanagari ऩ
};
Sanscript.addBrahmicScheme('tamil_reverse', tamilReverseScheme);
```

---

## 2. English (Tanglish) Formatting & Voicing

Tamil script lacks voiced consonants (b, d, g, j), but spoken Tamil uses them contextually. These rules are ONLY applied when outputting English.

### Prompt 2
> **Prompt:** "Create a function `applyTamilVoicing(itrans: string): string` that applies Tamil phonological rules to an ITRANS string. Implement regex replacements for:
> 1. Nasal assimilations: `~Nk` to `~Ng`, `~nch` to `~nj`, `NT` to `ND`, `nt` to `ndh`, `mp` to `mb`, `np` to `nb`, `nk` to `ng`.
> 2. Intervocalic voicing: stop consonants (`k, ch, T, t, p`) between two vowels (case-insensitive `[AEIOUaeiou]`) become `g, s, D, dh, b` respectively.
> 
> Next, create `itransToTanglish(itrans: string): string` that converts strict ITRANS to readable English (e.g., `U` -> `oo`, `I` -> `ee`, `A` -> `aa`, `tt` -> `thth`, `t` -> `th`, `T` -> `t`, `ch` -> `s`, `RR` -> `rr`). Finally, apply Title Case to every word."

### Code Implementation
```typescript
function applyTamilVoicing(itrans: string): string {
  let voiced = itrans
    .replace(/(~N)k/g, '$1g')       // ங்க → ng
    .replace(/(~n)ch/g, '$1j')      // ஞ்ச → nj
    .replace(/NT/g, 'ND')           // ண்ட → ND
    .replace(/nt/g, 'ndh')          // ந்த → ndh
    .replace(/mp/g, 'mb')           // ம்ப → mb
    .replace(/np/g, 'nb')           // ந்ப → nb 
    .replace(/nk/g, 'ng');          // ந்க → ng

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
  return itrans
    .replace(/U/g, 'oo').replace(/A/g, 'aa').replace(/I/g, 'ee')
    .replace(/tt/g, 'thth').replace(/t(?!h)/g, 'th').replace(/T/g, 't')
    .replace(/ch/g, 's').replace(/sh/g, 's')
    .toLowerCase()
    .split('\n')
    .map(line => line.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '))
    .join('\n');
}
```

---

## 3. Tamil Orthography Post-Processor & ZWNJ
When mapping into Tamil, ITRANS `n` always becomes dental `ந`. We must fix it to alveolar `ன` in mid-word scenarios using positional heuristics. We also must protect compound words (like `thirunaamam`) using a Zero-Width Non-Joiner (`\u200C`).

### Prompt 3
> **Prompt:** "Create a function `fixTamilOrthography(tamil: string): string`. Write two regex replacements: 
> 1. Replace `ந்` (with virama): If it is word-initial (or preceded by `\u200C`) OR followed by `த`, keep it as `ந்`. Otherwise, change to `ன்`. 
> 2. Replace `ந` (without virama): If it is word-initial (or preceded by `\u200C`), keep it as `ந`. Otherwise, change to `ன`.
> Also create `finalizeOutput(text: string)` to globally strip `\u200C`."

### Code Implementation
```typescript
function fixTamilOrthography(tamil: string): string {
  return tamil
    .replace(/ந்/g, (_: string, offset: number, str: string) => {
      if (offset === 0 || /[\s\n\u200C]/.test(str[offset - 1])) return 'ந்';
      if (str[offset + 2] === 'த') return 'ந்';
      return 'ன்';
    })
    .replace(/ந(?!்)/g, (_: string, offset: number, str: string) => {
      if (offset === 0 || /[\s\n\u200C]/.test(str[offset - 1])) return 'ந';
      return 'ன';
    });
}

function finalizeOutput(text: string): string {
  return text.replace(/\u200C/g, ''); // Strip ZWNJ
}
```

---

## 4. Exception Trie & The Final Pipeline

### Prompt 4
> **Prompt:** "Create `tamilExceptions.ts` with a `TamilExceptionTrie` class. Populate it with classical Tamil words mapped from Tanglish to strict ITRANS (e.g., `'ullam': 'uLLam'`). For compound words starting with `n`, use `\u200C` (e.g., `'thirunaamam': 'tiru\u200CnAmam'`).
> 
> In `algorithmicTransliterator.ts`, create `tanglishToItrans(text)`. Split text by `([a-zA-Z]+)`. Check `exceptionTrie.search(token)` first; if no match, apply regex fallbacks (`oo->U`, `b->p`, etc).
> 
> Finally, create `transliterateIndic(text, sourceLang, targetLang)`. Handle Tamil Source, English Source, and Indic Source paths. Wrap all returns in `finalizeOutput()`."

### Code Implementation
```typescript
import { exceptionTrie } from './tamilExceptions';

function tanglishToItrans(text: string): string {
  const tokens = text.split(/([a-zA-Z]+)/);
  return tokens.map(token => {
    if (!/^[a-zA-Z]+$/.test(token)) return token;
    
    const exceptionMatch = exceptionTrie.search(token);
    if (exceptionMatch) return exceptionMatch;

    return token.toLowerCase()
      .replace(/oo/g, 'U').replace(/ee/g, 'I').replace(/aa/g, 'A')
      .replace(/b/g, 'p').replace(/g/g, 'k').replace(/d/g, 'T').replace(/j/g, 'ch');
  }).join('');
}

export function transliterateIndic(text: string, sourceLang: LanguageCode, targetLang: LanguageCode): string {
  if (!text || sourceLang === targetLang) return text;

  if (sourceLang === 'ta') {
    const itrans = Sanscript.t(text.replace(/ன/g, 'ந'), 'tamil_reverse', 'itrans');
    if (targetLang === 'en') return finalizeOutput(itransToTanglish(applyTamilVoicing(itrans)));
    return finalizeOutput(Sanscript.t(itrans, 'itrans', SANSCRIPT_TARGET_MAP[targetLang]));
  }
  
  if (sourceLang === 'en') {
    const itrans = tanglishToItrans(text);
    if (targetLang === 'ta') return finalizeOutput(fixTamilOrthography(Sanscript.t(itrans, 'itrans', 'tamil')));
    return finalizeOutput(Sanscript.t(itrans, 'itrans', SANSCRIPT_TARGET_MAP[targetLang]));
  }

  // Handle Indic->Indic
  const sourceSchema = SANSCRIPT_SOURCE_MAP[sourceLang];
  const targetSchema = SANSCRIPT_TARGET_MAP[targetLang];
  if (targetLang === 'en') return finalizeOutput(itransToTanglish(Sanscript.t(text, sourceSchema, 'itrans')));
  if (targetLang === 'ta') return finalizeOutput(fixTamilOrthography(Sanscript.t(text, sourceSchema, targetSchema)));
  return finalizeOutput(Sanscript.t(text, sourceSchema, targetSchema));
}
```

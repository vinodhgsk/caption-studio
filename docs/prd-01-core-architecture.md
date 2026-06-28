# PRD 01: Core Architecture & System Integration
## Multi-Language Transliteration & Typography Engine

---

## 1. Executive Summary

This engine is a fully autonomous, offline client-side application designed to solve two deeply coupled problems in Indic text rendering:
1. **Multi-Language Unicode Synchronization:** When a user types in Tanglish (English), it must automatically transliterate into Tamil, Telugu, Hindi, and Malayalam. If they paste Tamil, it must convert back to Tanglish and all other scripts.
2. **Legacy Typography Rendering:** Classical and devotional Tamil calligraphy relies heavily on legacy non-Unicode `.ttf` fonts encoded in the "Bamini" format. The engine must autonomously intercept Unicode text and map it to legacy keyboard strokes whenever one of these fonts is applied to the canvas.

---

## 2. Architecture Overview

The system consists of three major interconnected modules located in `src/utils/transliteration/`:

1. **The Unicode Transliterator (`algorithmicTransliterator.ts`, `tamilExceptions.ts`)**
   Handles purely standard Unicode-to-Unicode and ASCII-to-Unicode mapping. It resolves Tamil's phonetic complexities (which lacks voiced consonants in script but uses them in speech).

2. **The Autonomous Font Engine (`zipFontLoader.ts`, `tamilFontLoader.ts`)**
   Handles extracting binary `.ttf` or `.woff2` files from uploaded ZIPs or local directories, registering them into the browser's `document.fonts` API across multiple weights dynamically.

3. **The Legacy Encoding Engine (`baminiConverter.ts`)**
   A specialized mapping array that safely converts Unicode Tamil strings into the exact ASCII keystroke sequences required to render correctly on legacy Bamini fonts.

---

## 3. Step 1: Initialization, Types, & Auto-Detection
*This is the foundational setup step to recreate the engine.*

### Prompt 1
> **Prompt:** "Set up a new transliteration utility module in a TypeScript project. Install the `@indic-transliteration/sanscript` library. Create a file named `algorithmicTransliterator.ts`. Define a type `LanguageCode` supporting `'en' | 'ta' | 'te' | 'ml' | 'hi'`. Create a function `detectIndicLanguage(text: string): LanguageCode` that uses Unicode regex blocks to detect if a string is Tamil (`[\u0B80-\u0BFF]`), Telugu (`[\u0C00-\u0C7F]`), Hindi (`[\u0900-\u097F]`), Malayalam (`[\u0D00-\u0D7F]`), or English (fallback). Finally, create two mapping objects `SANSCRIPT_SOURCE_MAP` and `SANSCRIPT_TARGET_MAP` to map `LanguageCode` to Sanscript scheme names."

### Code Implementation
```typescript
import Sanscript from '@indic-transliteration/sanscript';
import { LanguageCode } from '../../types/styler';

// Source map defines how we read FROM a language
const SANSCRIPT_SOURCE_MAP: Record<string, string> = {
  hi: 'devanagari', te: 'telugu', ml: 'malayalam', ta: 'tamil_reverse'
};

// Target map defines how we write TO a language
const SANSCRIPT_TARGET_MAP: Record<string, string> = {
  hi: 'devanagari', te: 'telugu', ml: 'malayalam', ta: 'tamil'
};

export function detectIndicLanguage(text: string): LanguageCode | null {
  if (!text) return null;
  if (/[\u0B80-\u0BFF]/.test(text)) return 'ta';
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  if (/[\u0C00-\u0C7F]/.test(text)) return 'te';
  if (/[\u0D00-\u0D7F]/.test(text)) return 'ml';
  if (/[a-zA-Z]/.test(text)) return 'en';
  return null;
}
```

---

## 4. UI Integration & State Management

The frontend uses React and a Zustand store (or similar) to maintain the state of the active text and language. When text is pasted, `detectIndicLanguage` runs.

### Prompt 2
> **Prompt:** "Explain how to hook this into a React component's `onChange` handler for a textarea. When the user pastes text, it should detect the language and update the store. When the user switches the language dropdown, it should call `transliterateIndic(text, oldLang, newLang)` and update the store with the translated text."

### Code Implementation (React Example)
```tsx
import { detectIndicLanguage, transliterateIndic } from '../utils/transliteration/algorithmicTransliterator';

// Handle text paste
const handleTextChange = (e) => {
  const newText = e.target.value;
  const detectedLang = detectIndicLanguage(newText);
  setTextStyle({
    content: newText,
    language: detectedLang || textStyle.language
  });
};

// Handle language dropdown switch
const handleLanguageSwitch = (e) => {
  const newLang = e.target.value as LanguageCode;
  const transliterated = transliterateIndic(
    textStyle.content, 
    textStyle.language, 
    newLang
  );
  setTextStyle({ language: newLang, content: transliterated });
};
```

---
*Proceed to **prd-02-unicode-transliteration.md** for the core transliteration logic.*

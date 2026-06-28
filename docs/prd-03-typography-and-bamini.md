# PRD 03: Autonomous Typography & Bamini Encoding
## Multi-Language Transliteration Engine

---

## 1. Autonomous TTF/ZIP Font Extraction (`zipFontLoader.ts`)

For cinematic Devotional Tamil typography, the app allows users to upload custom `.ttf` or `.zip` fonts. The engine must autonomously parse these files on the client-side and dynamically register them into the browser's memory without falling back to system fonts.

### Prompt 1
> **Prompt:** "Create `zipFontLoader.ts`. Import `JSZip`. Create a function `parseFontFilename(filename: string)` that extracts the font family, font style (checking for `italic`), and font weight (parsing words like `Bold`->`700`, `Light`->`300`). 
> 
> Create `loadFontsFromZip(zipBuffer: ArrayBuffer)`. Parse the ZIP looking for `.ttf|.otf|.woff` files. Read their ArrayBuffers. For every font, instantiate a new `FontFace()` and register it to `document.fonts`. *Critical:* Register each extracted font across weights `['400','500','600','700','900']` to prevent canvas font fallback failure. Finally, wait for `document.fonts.ready` before returning the font configurations. Set `encoding: 'bamini'` if the filename contains 'bamini'."

### Code Implementation
```typescript
import JSZip from 'jszip';
import type { FontConfiguration } from '../../types/styler';

function parseFontFilename(filename: string) {
  // Strip extension and parse e.g. "Oswald-BoldItalic.ttf"
  const basename = filename.split('/').pop()!.split('.')[0];
  if (!basename.includes('-')) return { family: basename, weight: '400', style: 'normal' };
  
  const [family, suffix] = basename.split('-');
  const style = suffix.toLowerCase().includes('italic') ? 'italic' : 'normal';
  const weight = suffix.toLowerCase().includes('bold') ? '700' : '400';
  
  return { family: family.replace(/_/g, ' '), weight, style };
}

async function registerFontFaceAllWeights(family: string, buffer: ArrayBuffer, style: string) {
  const weights = ['400', '500', '600', '700', '900'];
  await Promise.all(weights.map(async (w) => {
    try {
      const fontFace = new FontFace(family, buffer, { weight: w, style });
      await fontFace.load();
      document.fonts.add(fontFace);
    } catch (e) {
      console.warn(`[FontLoader] Failed to register weight ${w} for ${family}`);
    }
  }));
}

export async function loadFontsFromZip(zipFileBuffer: ArrayBuffer): Promise<FontConfiguration[]> {
  const zip = new JSZip();
  const contents = await zip.loadAsync(zipFileBuffer);
  const configs: FontConfiguration[] = [];
  
  for (const [path, file] of Object.entries(contents.files)) {
    if (!file.dir && /\.(ttf|otf|woff2?)$/i.test(path)) {
      const buffer = await file.async('arraybuffer');
      const { family, style } = parseFontFilename(path);
      
      await registerFontFaceAllWeights(family, buffer, style);
      
      configs.push({
        family,
        displayName: `${family} (Upload)`,
        category: 'calligraphic',
        source: 'uploaded',
        encoding: family.toLowerCase().includes('bamini') ? 'bamini' : 'unicode'
      });
    }
  }
  
  await document.fonts.ready;
  return configs;
}
```

---

## 2. Legacy Bamini Converter (`baminiConverter.ts`)

Many classic Tamil fonts were made before Unicode and map Tamil shapes to standard English QWERTY keys (e.g. `M` renders as `ஆ`). We must autonomously convert standard Unicode Tamil into this legacy keystroke sequence.

### Prompt 2
> **Prompt:** "Create `baminiConverter.ts`. Define a `baminiKeymap` object mapping Unicode Tamil characters to their legacy Latin equivalents (e.g., `'ஸ்ரீ':'='`, `'ஆ':'M'`, `'அ':'m'`). 
> *Critical implementation detail:* Sort `Object.keys(baminiKeymap)` by string length descending. This ensures that larger clusters (like 'ஹௌ') are replaced before single characters (like 'ஹ'), preventing mapping collisions. Create an exported function `convertUnicodeToBamini(text: string)` that splits and joins the string through the sorted keymap."

### Code Implementation
```typescript
const baminiKeymap: Record<string, string | string[]> = {
  "ஸ்ரீ":"=",
  "ஹௌ":"n`s",
  "ஆ":"M",
  "அ":"m",
  // (Hundreds of mappings omitted for brevity)
};

// Sort keys by length descending to ensure longer combinations are replaced first
const sortedKeys = Object.keys(baminiKeymap).sort((a, b) => b.length - a.length);

export function convertUnicodeToBamini(text: string): string {
  let converted = text;

  // Process main keymap
  for (const key of sortedKeys) {
    const val = baminiKeymap[key];
    const replacement = Array.isArray(val) ? val[0] : val;
    converted = converted.split(key).join(replacement);
  }

  return converted;
}
```

---

## 3. Autonomous UI Canvas Integration

The user should never know if a font is Unicode or Bamini. The UI must intercept the render cycle, check the font's encoding metadata (set automatically by the `zipFontLoader`), and autonomously convert the text.

### Prompt 3
> **Prompt:** "Explain how to integrate `convertUnicodeToBamini` into a React Canvas component (e.g., `CanvasEditor.tsx`). When rendering text to the canvas using Fabric.js or HTML5 Canvas, check the currently selected `fontConfig.encoding`. If it is `'bamini'`, intercept the standard Unicode Tamil string, pass it through `convertUnicodeToBamini`, and render the returned ASCII keystrokes onto the canvas."

### Code Implementation (React Example)
```tsx
import { convertUnicodeToBamini } from '../utils/transliteration/baminiConverter';

// Example inside a React component managing a Fabric.js canvas
useEffect(() => {
    // textStyle.content holds the standard Unicode Tamil text (e.g. "அன்பே சிவம்")
    let displayContent = textStyle.content;
    
    // Autonomously convert to legacy ASCII encoding if a Bamini TTF is selected
    if (activeFontConfig.encoding === 'bamini') {
        displayContent = convertUnicodeToBamini(displayContent);
    }
    
    // Render the text object onto the canvas
    if (canvasTextObject) {
        canvasTextObject.set({ 
            text: displayContent, 
            fontFamily: activeFontConfig.family 
        });
        canvas.renderAll();
    }
}, [textStyle.content, activeFontConfig]);
```

/**
 * zipFontLoader.ts
 *
 * Client-side Google Fonts ZIP parsing and registration utility.
 * Uses JSZip to extract binary font files (.ttf, .otf, .woff, .woff2) from
 * uploaded packages, registers them dynamically in the browser's Document
 * FontFaceSet, and maps them to the application store.
 */

import JSZip from 'jszip';
import { FontConfiguration } from '../../types/styler';

interface ParsedFontInfo {
  family: string;
  weight: string;
  style: string;
  buffer: ArrayBuffer;
}

/**
 * Parses weight name into standard CSS font-weight string value.
 */
function parseWeight(suffix: string): string {
  const s = suffix.toLowerCase();
  if (s.includes('thin')) return '100';
  if (s.includes('extralight') || s.includes('extra_light')) return '200';
  if (s.includes('light')) return '300';
  if (s.includes('semibold') || s.includes('semi_bold')) return '600';
  if (s.includes('extrabold') || s.includes('extra_bold')) return '800';
  if (s.includes('black') || s.includes('heavy')) return '900';
  if (s.includes('bold')) return '700';
  if (s.includes('medium')) return '500';
  return '400'; // Default is regular
}

/**
 * Extract font family, weight, and style from filename.
 * Example: "Oswald-BoldItalic.ttf" -> Family="Oswald", Weight="700", Style="italic"
 */
function parseFontFilename(filename: string): { family: string; weight: string; style: string } {
  // Strip directories and extension
  const parts = filename.split('/');
  const basenameWithExt = parts[parts.length - 1];
  const basename = basenameWithExt.substring(0, basenameWithExt.lastIndexOf('.')) || basenameWithExt;

  const dashIndex = basename.indexOf('-');
  if (dashIndex === -1) {
    // No dash: e.g. "Oswald.ttf"
    return {
      family: basename.replace(/_/g, ' '),
      weight: '400',
      style: 'normal',
    };
  }

  const family = basename.substring(0, dashIndex).replace(/_/g, ' ');
  const suffix = basename.substring(dashIndex + 1);

  const style = suffix.toLowerCase().includes('italic') ? 'italic' : 'normal';
  const weight = parseWeight(suffix);

  return { family, weight, style };
}

/**
 * Safely registers a font face buffer across all standard weights (400, 500, 600, 700, 900)
 * to ensure that browser canvas context calls (which request specific weights like 700)
 * resolve to the uploaded font rather than falling back to system serif.
 */
async function registerFontFaceAllWeights(
  family: string,
  buffer: ArrayBuffer,
  style: string
): Promise<void> {
  const weights = ['400', '500', '600', '700', '900'];
  const promises = weights.map(async (w) => {
    try {
      const fontFace = new FontFace(family, buffer, {
        weight: w,
        style: style,
      });
      await fontFace.load();
      document.fonts.add(fontFace);
    } catch (e) {
      console.warn(`[FontLoader] Failed to register weight ${w} for ${family}:`, e);
    }
  });
  await Promise.all(promises);
}

/**
 * Processes a Google Font ZIP archive file buffer.
 * Extracts fonts, registers them to document.fonts, and returns configurations.
 */
export async function loadFontsFromZip(zipFileBuffer: ArrayBuffer): Promise<FontConfiguration[]> {
  const zip = new JSZip();
  const contents = await zip.loadAsync(zipFileBuffer);
  
  const fontFiles: { name: string; file: JSZip.JSZipObject }[] = [];
  
  // Find all supported font formats
  contents.forEach((relativePath, file) => {
    if (!file.dir && /\.(ttf|otf|woff|woff2)$/i.test(relativePath)) {
      fontFiles.push({ name: relativePath, file });
    }
  });

  if (fontFiles.length === 0) {
    throw new Error('No font files (.ttf, .otf, .woff, .woff2) found in the ZIP archive.');
  }

  const parsedFonts: ParsedFontInfo[] = [];

  // Read all font file contents as binary ArrayBuffers
  for (const item of fontFiles) {
    const buffer = await item.file.async('arraybuffer');
    const { family, weight, style } = parseFontFilename(item.name);
    parsedFonts.push({ family, weight, style, buffer });
  }

  const registeredConfigs: Map<string, FontConfiguration> = new Map();

  // Register each FontFace to document.fonts across all weights
  for (const font of parsedFonts) {
    try {
      await registerFontFaceAllWeights(font.family, font.buffer, font.style);

      console.info(
        `[ZipFontLoader] Registered custom font family: "${font.family}" (style: ${font.style})`
      );

      // Create configuration mapping
      if (!registeredConfigs.has(font.family)) {
        registeredConfigs.set(font.family, {
          family: font.family,
          displayName: `${font.family} (Upload)`,
          category: 'calligraphic', // Custom fonts categorise as calligraphic so they bypass filters
          source: 'uploaded',
          encoding: font.family.toLowerCase().includes('bamini') ? 'bamini' : 'unicode',
        });
      }
    } catch (err) {
      console.error(`[ZipFontLoader] Failed to load font face "${font.family}":`, err);
    }
  }

  // Verify and resolve once browser confirms loaded fonts are ready
  await document.fonts.ready;

  return Array.from(registeredConfigs.values());
}

/**
 * Processes a single TTF/OTF/WOFF/WOFF2 font file buffer.
 * Registers it to document.fonts, and returns its configuration mapping.
 */
export async function loadFontFile(
  filename: string,
  fontBuffer: ArrayBuffer
): Promise<FontConfiguration> {
  const { family, style } = parseFontFilename(filename);

  try {
    // Register across all standard weights
    await registerFontFaceAllWeights(family, fontBuffer, style);

    console.info(
      `[FontLoader] Registered custom font file: "${family}" (style: ${style})`
    );

    // Verify ready status
    await document.fonts.ready;

    return {
      family,
      displayName: `${family} (TTF/Local)`,
      category: 'calligraphic', // Mark user uploaded fonts as calligraphic so they bypass filters
      source: 'uploaded',
      encoding: family.toLowerCase().includes('bamini') ? 'bamini' : 'unicode',
    };
  } catch (err) {
    console.error(`[FontLoader] Failed to load font file "${family}":`, err);
    throw new Error(`Failed to load font file "${filename}": ${err instanceof Error ? err.message : String(err)}`);
  }
}

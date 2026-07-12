/**
 * Manifest of the app-bundled font FACES to register in the renderer at startup
 * (P6.x). The renderer canvas (preview AND the caption-overlay export) can only
 * shape a family that is present in `document.fonts`; nothing force-loads the
 * bundled `resources/fonts` TTFs there, so Indic text had been relying on
 * whatever the OS happened to have. This manifest is the single list of faces
 * main reads (from `resources/fonts`) and the renderer turns into `FontFace`s, so
 * preview == overlay-export == what the presets ask for, on any machine.
 *
 * Pure data — no electron/node/DOM. `file` is the basename inside the app fonts
 * dir; `weight` is a CSS weight or a variable-font range (e.g. `'400 800'`).
 */
export interface BundledFontFace {
  /** CSS family name (must match the family a preset/clip requests). */
  family: string
  /** File basename inside the app fonts dir (resources/fonts). */
  file: string
  /** CSS weight or variable range (e.g. `'700'` or `'400 800'`). */
  weight: string
  /** CSS style. */
  style: 'normal' | 'italic'
}

/**
 * The faces to load. Baloo Thambi 2 (the default caption face) is a VARIABLE
 * font, registered across its 400–800 range so `ctx.font` weight selection picks
 * ExtraBold. The Noto families back the other presets + per-script fallback so
 * every language shapes in preview exactly as it exports.
 */
export const BUNDLED_FONT_FACES: readonly BundledFontFace[] = [
  // --- Tamil devotional display faces (selectable for any caption style) ----
  { family: 'Baloo Thambi 2', file: 'BalooThambi2.ttf', weight: '400 800', style: 'normal' },
  { family: 'Catamaran', file: 'Catamaran.ttf', weight: '100 900', style: 'normal' },
  { family: 'Mukta Malar', file: 'MuktaMalar-ExtraBold.ttf', weight: '800', style: 'normal' },
  { family: 'Anek Tamil', file: 'AnekTamil.ttf', weight: '100 800', style: 'normal' },
  { family: 'Hind Madurai', file: 'HindMadurai-SemiBold.ttf', weight: '600', style: 'normal' },
  { family: 'Pavanam', file: 'Pavanam-Regular.ttf', weight: '400', style: 'normal' },
  { family: 'Noto Serif Tamil', file: 'NotoSerifTamil-Regular.ttf', weight: '400', style: 'normal' },
  { family: 'Noto Serif Tamil', file: 'NotoSerifTamil-Bold.ttf', weight: '700', style: 'normal' },
  { family: 'Noto Sans Tamil', file: 'NotoSansTamil-Regular.ttf', weight: '400', style: 'normal' },
  { family: 'Noto Sans Tamil', file: 'NotoSansTamil-Bold.ttf', weight: '700', style: 'normal' },
  { family: 'Noto Sans Telugu', file: 'NotoSansTelugu-Regular.ttf', weight: '400', style: 'normal' },
  { family: 'Noto Sans Telugu', file: 'NotoSansTelugu-Bold.ttf', weight: '700', style: 'normal' },
  { family: 'Noto Sans Malayalam', file: 'NotoSansMalayalam-Regular.ttf', weight: '400', style: 'normal' },
  { family: 'Noto Sans Malayalam', file: 'NotoSansMalayalam-Bold.ttf', weight: '700', style: 'normal' },
  { family: 'Noto Sans Kannada', file: 'NotoSansKannada-Regular.ttf', weight: '400', style: 'normal' },
  { family: 'Noto Sans Kannada', file: 'NotoSansKannada-Bold.ttf', weight: '700', style: 'normal' },
  { family: 'Noto Sans Devanagari', file: 'NotoSansDevanagari-Regular.ttf', weight: '400', style: 'normal' },
  { family: 'Noto Sans Devanagari', file: 'NotoSansDevanagari-Bold.ttf', weight: '700', style: 'normal' }
]

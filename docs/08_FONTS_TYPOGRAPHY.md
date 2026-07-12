# 08 — Fonts & Typography (Premium)

**Phase:** 6 · **Owning agent:** `typography-agent` · **Skills:** `text-render`, `indic-text`

## Goal
Implement font management and typographic controls: built-in font library, AI font generator (style from prompt), custom font import + embedding into the project bundle, size, bold/italic, letter spacing, line height, curved/arc text, and fallback handling. The app is **Indic-first**: bundle Indic-capable default fonts covering Tamil/Telugu/Malayalam/Kannada/Devanagari + Latin, enable HarfBuzz complex-script shaping, and resolve a per-script fallback chain — the global default family renders Tamil (see Doc 16).

## Dependencies
- Doc 01 (text layout), Doc 05/06 (decorations/animation rely on glyph metrics), `text-render`.

## Data model touchpoints
- `text.font = { family, size, bold, italic, letterSpacing, lineHeight, curve }`; embedded font files in bundle `media/fonts/`.

## UI/UX spec
Fonts panel: categorized font library (Indic: Tamil/Telugu/Malayalam/Kannada/Devanagari + Latin sans/serif/script/decorative/cinematic) with live previews (Tamil sample by default), search; "Import font" (TTF/OTF) → embeds into bundle; AI font generator (prompt → suggested families); controls for size (slider), bold/italic, letter spacing, line height; curved/arc text slider. Default family is Indic-capable (Tamil).

## Build prompts
```
PROMPT 8.1 — Build a font registry: load bundled fonts (including Indic-capable defaults for Tamil/Telugu/Malayalam/Kannada/Devanagari + Latin) + system fonts, categorize, expose live-preview swatches and search. Define a per-script fallback chain; the global default family is Tamil-capable.
```
```
PROMPT 8.2 — Implement custom font import: copy TTF/OTF into bundle media/fonts/, register at runtime, reference by family in text.font; ensure it travels with the project (local + OneDrive).
```
```
PROMPT 8.3 — Implement typographic controls: size, bold, italic, letterSpacing, lineHeight — applied in text-render layout with HarfBuzz complex-script shaping and grapheme-cluster metrics. Verify metrics feed decorations/animation correctly.
```
```
PROMPT 8.4 — Implement curved/arc text: lay glyphs along an arc whose curvature is text.font.curve; keep per-glyph transforms compatible with animation.
```
```
PROMPT 8.5 — Implement the AI font generator behind a provider interface: prompt -> suggested font families/styles; present as selectable suggestions (no external IP baked in).
```
```
PROMPT 8.6 — Enable HarfBuzz complex-script shaping for Indic scripts (Tamil/Telugu/Malayalam/Kannada/Devanagari) in text-render so matras/conjuncts/reordering render correctly, with grapheme-cluster segmentation feeding per-char animation; verify identical shaping in headless export (indic-text).
```

## Acceptance criteria
- Built-in + imported fonts render with correct metrics and fallback.
- Imported fonts embed in the bundle and load on reopen from local/OneDrive.
- Size/bold/italic/spacing/line-height/curve all apply and persist.
- Tamil/Telugu/Malayalam/Kannada/Hindi render with correct complex-script shaping (matras/conjuncts) identically in preview and headless export; the default family renders Tamil.

## Test notes
Verify imported font renders identically after reload. Test fallback when a referenced family is missing. Snapshot arc text at several curvature values.

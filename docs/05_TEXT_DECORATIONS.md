# 05 — Text Decorations

**Phase:** 7 · **Owning agent:** `text-decoration-agent` · **Skill:** `text-render`

## Goal
Implement text decorations: background bubble (solid/semi-transparent fill behind the text block), padding/margin control, rounded vs sharp corners, underline/strike/highlight, and inline emoji.

## Dependencies
- Doc 01 (preview), Doc 10 (color), Doc 08 (typography metrics for highlight bounds).
- Skill: `text-render`.

## Data model touchpoints
- `text.decoration = { background:{color,opacity,padding,radius}, underline, strike, highlight, emoji[] }`.

## UI/UX spec
Decorations panel: background toggle + color + opacity + padding slider + corner-radius slider (0 = sharp). Underline/strike toggles. Highlight (per-word or full-line) color. Inline emoji picker that inserts emoji into the text run flow.

## Build prompts
```
PROMPT 5.1 — In text-render, compute the text block bounding box (per line, with padding) and draw a background rect with color, opacity, and corner radius behind the glyphs.
```
```
PROMPT 5.2 — Implement underline and strikethrough as baseline-aware rules scaled to font size.
```
```
PROMPT 5.3 — Implement highlight bars (per-word or full-line) drawn behind glyphs using measured run bounds.
```
```
PROMPT 5.4 — Implement inline emoji: insert emoji glyphs into the text run flow with correct advance/metrics so they wrap and animate with the text.
```
```
PROMPT 5.5 — Wire the Decorations panel; persist to text.decoration; ensure decorations render beneath effects but above clip background.
```

## Acceptance criteria
- Background bubble respects padding and corner radius across multi-line text.
- Underline/strike/highlight align to glyph metrics at any font size.
- Inline emoji wrap and animate with surrounding text.

## Test notes
Snapshot multi-line blocks with padding/radius extremes. Verify highlight bounds match per-word run boxes. Test emoji wrapping at line boundaries.

---
name: subtitle-export
description: Serialize caption clips/transcript to SRT, VTT, and ASS with correct timecodes and (for ASS) styling, plus FFmpeg burn-in filtergraphs. Use for export sidecars and burn-in.
---
# subtitle-export

## Formats
- SRT: index, `HH:MM:SS,mmm --> ...`, text.
- VTT: `WEBVTT` header, `HH:MM:SS.mmm` timecodes.
- ASS: `[Script Info]/[V4+ Styles]/[Events]`; map caption style (font, color, outline, shadow, alignment) to a Style; one Dialogue per line.
- **Encoding:** write all files UTF-8. ASS references/embeds an Indic-capable font so Tamil/Telugu/Malayalam/Kannada/Devanagari render; burn-in uses the same HarfBuzz-shaped text pipeline (see `indic-text`).

## Burn-in
Build an FFmpeg filtergraph using `subtitles=` (ASS for styling) OR render text via text-render headless and overlay frames for full effect parity. Prefer the latter when effects/animations are present.

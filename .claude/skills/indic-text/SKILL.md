---
name: indic-text
description: Indic-first script support — complex-script shaping (HarfBuzz), grapheme-cluster segmentation, line breaking, syllable splitting for karaoke, per-script fonts/fallback, and script detection for Tamil/Telugu/Malayalam/Kannada/Devanagari/Latin. Used by preview AND export for parity.
---
# indic-text

## Purpose
The app is Indic-first. This skill captures the rendering and text-segmentation rules every text/caption feature must honor so Tamil (primary), Telugu, Malayalam, Kannada, Hindi, and English all render and animate correctly. Correct Indic rendering is a **release blocker** — glyph corruption makes the app unusable for its core audience. Consumed by `text-render`, `typography`, `caption-sync`, animation (Doc 06), and reveal effects (Doc 15).

## Supported languages
| Name | Code | Script |
|---|---|---|
| Tamil | `ta` | Tamil | **primary / default** |
| Telugu | `te` | Telugu |
| Malayalam | `ml` | Malayalam |
| Kannada | `kn` | Kannada |
| Hindi | `hi` | Devanagari |
| English | `en` | Latin |

Tamil is the global default language/script. Restrict language pickers to this set.

## The cardinal rule: grapheme clusters are atomic
A "character" the user perceives (e.g. Tamil `கி`, `க்ஷ`; Devanagari `क्षि`) is an **extended grapheme cluster** of multiple code points: a base consonant + dependent vowel sign(s), virama-joined conjuncts, and combining marks. The cluster is the smallest unit you may move, color, time, break, or animate.

**NEVER do this on Indic text:**
- `text.split('')` — splits code points, shattering clusters.
- `text[i]` / `charAt(i)` / `codePointAt(i)` indexing for per-character logic.
- breaking a line mid-cluster.
- highlighting half a cluster in karaoke / active-word highlight.

**ALWAYS** get clusters from the shared text-render cluster utility, which uses HarfBuzz cluster info (preferred) or `Intl.Segmenter(locale, { granularity: 'grapheme' })`. Cluster count — not code-point length — drives Type/typewriter speed, per-char stagger, reveal `unit:"char"`, and `maxCharsPerLine` line-wrap.

## Complex-script shaping (identical preview ↔ export)
1. Choose the font for the run's script from `typography.fontByLang` (script detection below).
2. Shape with **HarfBuzz** — matras/vowel signs, conjuncts, reordering, combining marks. The same shaper runs in the **preview compositor** (Canvas/WebGL) and in **headless/export** (FFmpeg burn-in via libass/freetype+harfbuzz, see `ffmpeg-export`/`subtitle-export`).
3. The pipeline emits positioned glyphs `{ glyphId, x, y, cluster }`; renderers draw glyph outlines by id — identical on both paths.

Do **NOT** use Canvas2D native `fillText` for Tamil/Telugu/Malayalam/Kannada/Devanagari: its shaping differs across OSes and breaks both correctness and parity. (Latin-only text may use native measurement, but routing it through HarfBuzz keeps one code path.) Never assume 1 codepoint = 1 visual unit.

## Line breaking
- Break only at spaces and permitted punctuation; **never** inside a cluster.
- Balance lines (avoid an orphan word) via the layout module while keeping cluster integrity.
- Respect per-script line-height: Indic scripts stack vowel signs above/below the base, so they need more leading than Latin. Maintain a per-script metrics table (extra ascent/descent multipliers).

## Syllable splitting (for syllable-level karaoke)
Lyrical/Carnatic lines often stretch one word over seconds, needing per-syllable highlight (ties into `caption-sync`):
- A syllable = a consonant cluster + its following vowel (sign or inherent), grouped with leading conjuncts.
- Expose `splitSyllables(text, lang)` returning cluster-index ranges so timing can be interpolated within a word; document the heuristic per script.
- When unsure, fall back to word-level highlight rather than risk a wrong split.

## Fonts (bundle the identical files for preview + export)
- **Tamil:** Catamaran, Noto Sans/Serif Tamil, Mukta Malar, Meera Inimai
- **Telugu:** Noto Sans/Serif Telugu, Tiro Telugu
- **Malayalam:** Noto Sans Malayalam, Chilanka
- **Kannada:** Noto Sans/Serif Kannada, Tiro Kannada
- **Hindi/Devanagari:** Noto Sans/Serif Devanagari, Mukta
- **Latin:** Inter, Bebas Neue, Oswald, Playfair Display, Rajdhani, Lora (+ your display picks)

The global default family must render Tamil. Maintain a per-script fallback chain (`text.font.fallback[]`); resolve missing glyphs by script before falling back to a tofu box. Register the **same font files** in the preview and the export renderer and content-hash them so a preview/export mismatch is a hard error — parity depends on identical font bytes.

## Script detection
Detect the dominant script of a run from its Unicode blocks to pick font/shaping and the transliteration source language. Ranges:

Tamil `U+0B80–0BFF` · Telugu `U+0C00–0C7F` · Kannada `U+0C80–0CFF` · Malayalam `U+0D00–0D7F` · Devanagari `U+0900–097F` · Latin `U+0000–007F`.

## Determinism / parity
Shaping, cluster segmentation, fallback, and line breaking must be deterministic and identical preview↔export. Tests you must add for any Indic change:
- Known strings with conjuncts per script (e.g. Tamil `கி`, `க்ஷி`; Devanagari `क्षि`) → assert exact grapheme-cluster count.
- For each text animator, reveal, and karaoke/active-word style → assert **no cluster is split** at sampled `t ∈ {0,.25,.5,.75,1}`.
- Shaping determinism → the same string+font yields identical positioned glyph ids in the preview compositor and the export renderer.

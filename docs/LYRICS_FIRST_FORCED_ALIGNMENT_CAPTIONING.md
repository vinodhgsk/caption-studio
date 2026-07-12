# Lyrics-First (Forced-Alignment) Captioning — Feature Specification

> **Independent context document.** Not an agent, skill, or runbook file. Drop it into a chat/Claude Code
> session as reference material when building or refining the captioning system.
> Scope: replace the unreliable *fully-automatic* Auto Caption path with a *lyrics-first* path where the
> user supplies the known lyrics and the system finds the precise on-audio timing.

---

## 0. How to use this document
This is a design + implementation spec. It defines the feature, the pipeline, the alignment engine
options with a recommendation, the Indic/transliteration handling, the data model (additive to the
existing caption schema), the editing UX, and acceptance criteria. Tool/model names are candidates —
**verify current language support for each engine before committing**, since availability changes.

---

## 1. Problem & approach

**Problem.** Fully-automatic Auto Caption (open speech-to-text that both *recognizes the words* and
*times them*) is unreliable for this app's core content: sung Indic vocals over music. The recognizer
guesses wrong words (melody, sustained vowels, background instruments, code-mixing), so both the text
*and* the timing are off.

**Approach — Lyrics-First Forced Alignment.** When the user already knows the lyrics, we remove the
hard half of the problem. The user provides the exact lyrics in the chosen language; the system only
has to answer **"when is each line / word / syllable sung?"** — this is *forced alignment*: fitting a
known transcript to audio. The words are never invented; only timing is computed, and timing is easy to
let the user correct.

**Definition (forced alignment).** Given audio A and known text T, find the time interval for each unit
of T (line, word, syllable) that best matches A under an acoustic model or a synthesis-and-warp method.

---

## 2. Supported languages & the atomic unit

Target languages (user selects one per lyrics set):

| Language | Code | Script | Notes |
|---|---|---|---|
| Tamil | `ta` | Tamil | primary / default |
| Telugu | `te` | Telugu | |
| Malayalam | `ml` | Malayalam | |
| Hindi | `hi` | Devanagari | |

These are **abugida** scripts. The perceived "character" a singer lands on is an **akshara**
(syllable: a base consonant + vowel sign(s), with virama-joined conjuncts). For karaoke and active-word
highlighting the akshara/grapheme cluster is the **smallest unit you may time, color, or split** — never
a Unicode code point. This is a release blocker: splitting `கி`, `க்ஷ`, or `क्षि` produces broken text.

**Timing granularities produced:** line → word → syllable (akshara). Line and word are always produced;
syllable is produced when the engine supports sub-word timing (needed for karaoke syllable fill).

---

## 3. User workflow (UX)

1. User imports the song (MP3/WAV) as the audio track (existing flow).
2. User opens **Captions → "Add lyrics" (Lyrics-First)** and:
   - selects the language (ta/te/ml/hi),
   - pastes or uploads the full lyrics (see §4 for format),
   - optionally marks sections (verse/chorus) and instrumental gaps.
3. User clicks **Align**. The system runs the pipeline (§5) and produces timed caption clips.
4. The editor shows the captions on the timeline over the waveform, with a **confidence heatmap**.
   Low-confidence regions are flagged for review.
5. User reviews/corrects timing only (never re-types words): drag boundaries, "re-align from here", or
   use **Tap-Sync** (§9) for regions the aligner got wrong.
6. Captions feed straight into the existing caption styles, karaoke roll-up, active-word highlight, and
   the optional transliteration row.

Key UX principle: **the lyrics are ground truth.** Editing changes *timing*, not *text*. Editing text is
a separate, explicit action that triggers re-alignment of the changed span.

---

## 4. Lyrics input format

Accept plain text (one line per caption line) and an optional lightweight structure. Both work:

**Minimal (plain):**
```
நெஞ்சுக்குள் ஓடும் நதியே
உன் பேரை சொல்லடி
...
```

**Structured (optional, recommended for music videos):**
```
[lang: ta]
[section: verse]
நெஞ்சுக்குள் ஓடும் நதியே        # one caption line
உன் பேரை சொல்லடி

[gap: instrumental]              # no lyrics here; aligner should expect silence/vocals-absent

[section: chorus]
...
```

Parsing rules: blank line = soft grouping; `#` = comment; `[gap: …]` = an interval with no lyrics (the
aligner must not force text into it); `[section: …]` tags flow through to section-aware theming.
Normalize line endings to `\n`. Preserve the original script exactly (no auto-correction).

---

## 5. System pipeline (stages)

```
audio ──▶ (1) decode/normalize ──▶ (2) vocal isolation ──▶ (3) VAD / vocal regions
lyrics ─▶ (4) parse + segment (line/word/akshara) ──┐
                                                     ▼
                              (5) FORCED ALIGNMENT (engine, §6)
                                                     ▼
                    (6) confidence scoring + gap handling (§7)
                                                     ▼
                    (7) map tokens → aksharas → caption timings (frame-snapped)
                                                     ▼
                    (8) write caption clips + wordTimings/syllableTimings (§10)
```

1. **Decode/normalize:** FFmpeg → mono 16 kHz WAV (aligner input). Keep the original for playback.
2. **Vocal isolation (music-critical):** run source separation (e.g. Demucs/Spleeter) to get a *vocals
   stem*; align on the stem, not the full mix. This is the single biggest accuracy win for songs.
   Make it toggleable (skip for a cappella / clean speech).
3. **VAD / vocal-activity regions:** detect where vocals are present; use to bound alignment and to keep
   text out of instrumental gaps (also seeded by `[gap: …]`).
4. **Lyrics parse + segment:** split into lines → words → aksharas using a script-aware syllabifier
   (grapheme clusters as the safe minimum; a proper akshara splitter for karaoke). Build the token
   sequence the engine expects (native-script characters, or phonemes/romanization — see §8).
5. **Forced alignment (§6):** compute start/end for each token; aggregate to word and line.
6. **Confidence + gaps (§7):** per-unit confidence; low-confidence and no-vocal spans handled/flagged.
7. **Map to aksharas + frame-snap:** collapse engine tokens into aksharas; snap all times to the project
   fps (`frame = round(t·fps)`); enforce min/max line duration and readability (≤2 lines, max chars).
8. **Emit caption clips:** one caption clip per line with `wordTimings` and `syllableTimings`; cache the
   full alignment JSON.

---

## 6. Alignment engines (options + recommendation)

Wrap the aligner behind a **provider interface** so it is swappable and local-first:

```
interface Aligner {
  align(vocalsWavPath, tokens /* per-line words+aksharas */, lang) ->
    { units: [{ text, start, end, confidence, level: "word"|"syllable" }], lineSpans: [...] }
}
```

Candidate engines (verify current per-language support):

**A. CTC forced alignment with a multilingual model (recommended primary).**
Use a wav2vec2/**MMS**-class CTC model that natively supports ta/te/ml/hi, via a Python sidecar
(e.g. `torchaudio.functional.forced_align`, or the MMS aligner). Given the reference tokens + audio, it
emits per-token time spans and posteriors (→ confidence). Pros: native script, robust, offline after a
one-time model download, sub-word (→ akshara) timing. Cons: Python runtime + model (~hundreds of MB to
~1 GB); sung-vocal accuracy varies (mitigated by vocal isolation, §5.2).

**B. Montreal Forced Aligner (MFA).**
Acoustic model + pronunciation dictionary per language. Very strong for clean speech; needs a G2P /
dictionary for each language (Hindi is well supported; Tamil/Telugu/Malayalam vary — verify). More
setup; heavier. Good as an alternative/high-accuracy path for spoken-word or well-covered languages.

**C. Aeneas (TTS + DTW), line/fragment-level.**
Synthesizes the lyrics with TTS (eSpeak-ng phonemization supports these scripts) and dynamic-time-warps
the synthetic audio to the real audio to get *line*-level (fragment) timings. Pros: simple, offline,
language-flexible; great for line granularity. Cons: not naturally word/syllable-level; sung audio warps
imperfectly. Good **line-level fallback** and a fast first pass.

**D. Cloud alignment API.**
Optional adapter for environments that prefer a hosted aligner. Keep behind the same interface; not the
default (privacy, offline, cost).

**Recommended layered strategy:** vocal-isolate (§5.2) → **engine A (MMS CTC)** for word+akshara timing
→ confidence scoring → **Tap-Sync anchors (§9)** and/or **engine C (Aeneas)** line-level for low-confidence
or failed regions → proportional fallback as the last resort. Provider-abstract so any engine can be the
primary later.

---

## 7. Music-specific handling

Songs break naive alignment. Handle explicitly:
- **Vocal isolation** before alignment (see §5.2).
- **Instrumental gaps:** VAD + `[gap: …]` tags create no-text intervals; the aligner must not stretch
  lyrics across them. Long inter-line silences are legal, not errors.
- **Sustained syllables:** a held note means one akshara can span a long interval; do not cap syllable
  duration too aggressively. Karaoke fill should animate across the held span.
- **Repeated/backing lines:** duplicate lyric lines are common (chorus). Alignment operates in reading
  order; if the same words recur, anchor by section and by monotonic time (alignment is monotonic).
- **Melisma / vowel elongation:** allow a syllable's end to extend to the next onset; confidence may dip.
- **Confidence:** derive from model posteriors (A), DTW cost (C), or dictionary coverage (B). Expose a
  per-line/per-word/per-syllable confidence used to drive the review heatmap and fallback decisions.

---

## 8. Indic script segmentation & transliteration

**Segmentation (mandatory).** Split lyrics into aksharas with a script-aware syllabifier; use Unicode
extended grapheme clusters as the atomic floor (never `split('')`, never code-point indexing). Word
boundaries by whitespace + script punctuation. This segmentation is the geometry the karaoke fill and
active-word highlight consume, so it must match what the renderer draws.

**Transliteration — three distinct roles (keep them separate):**
1. **Alignment aid (fallback only).** If a chosen engine lacks native-script support, romanize the lyrics
   to a consistent scheme (ISO 15919 recommended; ITRANS/IAST acceptable) or to phonemes (eSpeak-ng G2P)
   so a Latin/phoneme model can align. With a native-script engine (A/MMS) this is unnecessary — prefer
   native script for accuracy.
2. **Pronunciation for dictionary-based engines.** MFA (B) needs a G2P/pronunciation dictionary; generate
   phonemes per language.
3. **Display row (user-facing).** Optionally render a romanized caption line beneath the native lyric,
   sharing the *same* timings, via the app's existing transliteration capability. This is presentation,
   not alignment — compute it after timing is fixed, mapping romanized units back to the source aksharas
   so per-syllable karaoke stays in sync on both rows.

Keep the romanization scheme configurable and consistent across a project; store which scheme was used.

---

## 9. Hybrid Anchor / Tap-Sync (fallback & correction)

Automatic alignment will sometimes drift on music. Provide a manual-assist that is fast and reliable:

- **Tap-Sync (anchors):** the user plays the song and taps a key at each line start (and optionally each
  word). Each tap becomes a **hard anchor**. The system pins line/word starts to anchors and interpolates
  the aksharas within each anchored span (proportional to text length or to detected vocal energy). This
  alone yields excellent line-level karaoke with zero model accuracy needed.
- **Anchor + align hybrid (recommended default for songs):** run forced alignment for within-line
  word/syllable timing, but let user anchors override line boundaries so global drift is corrected while
  fine timing stays automatic.
- **Proportional fallback:** if an entire region has no usable alignment and no anchors, distribute
  aksharas evenly across the region's VAD-detected vocal span. Always beats "wrong words at wrong times."

Anchors and alignment coexist: alignment fills the gaps between anchors; anchors are never overwritten by
re-alignment.

---

## 10. Data model (additive)

Fits the existing caption schema; **new optional fields only** — nothing existing changes shape.

```jsonc
"captions": {
  "mode": "lyricsFirst",                 // vs existing "auto"; additive
  "language": "ta|te|ml|hi",
  "romanization": "iso15919|itrans|iast|none",
  "lyricsRef": "cache/lyrics.txt",       // the exact user-provided lyrics
  "alignmentRef": "cache/alignment.json",// cached engine output (see Appendix A)
  "engine": "mms-ctc|mfa|aeneas|cloud",
  "vocalStem": true,
  "anchors": [ { "unit": "line|word", "index": 12, "t": 34.20 } ]  // Tap-Sync hard anchors
}
```

Per caption clip (existing shape, populated by this feature):
```jsonc
"text": {
  "content": "நெஞ்சுக்குள் ஓடும் நதியே",
  "caption": {
    "wordTimings":     [ { "word": "நெஞ்சுக்குள்", "start": 34.20, "end": 35.05, "confidence": 0.82 } ],
    "syllableTimings": [ { "akshara": "நெ", "start": 34.20, "end": 34.38, "confidence": 0.79 } ],
    "lineSpan": { "start": 34.20, "end": 37.90 }
  }
}
```
All times are seconds, frame-snapped on emit. `syllableTimings` present only when the engine gives
sub-word timing (or when derived from anchors + proportional split).

---

## 11. Editing & correction UX

- **Waveform + captions:** show caption blocks over the (vocal-stem) waveform; drag line/word edges to
  retime; snapping to onsets/beats.
- **Confidence heatmap:** color low-confidence units; a "review next low-confidence" jump.
- **Re-align from here:** re-run alignment for a selected span only, respecting surrounding anchors.
- **Tap-Sync mode:** record anchors live (§9).
- **Text edits are explicit:** editing the lyric text marks that span dirty and offers re-align; it never
  silently re-transcribes. Words remain user-owned.
- **Nudge tools:** shift all downstream captions by ±N ms (fix a constant offset); stretch/compress a
  region to fix drift.

---

## 12. Determinism, caching & export parity

- **Cache the alignment.** Run the engine once; store `alignment.json`. Re-render/export reads the cache —
  never re-aligns at draw/export time. Re-align only when audio, lyrics, engine, or vocal-stem toggle change.
- **Deterministic emit.** Given the cached alignment + anchors, caption timing is a pure function → preview
  and FFmpeg export produce identical caption timing. No live audio sampling during render.
- **Frame-snapping** happens once, on emit, so preview and export agree to the frame.

---

## 13. Confidence, QA & edge cases

- Empty/partial lyrics; more lines than vocal regions (or fewer).
- Code-mixed lines (Indic + English words) — segmenter must handle mixed scripts per word.
- Conjuncts and rare aksharas that the syllabifier may mis-split — prefer grapheme-cluster floor.
- Very fast rap-like passages (word timing collides) vs long held notes (sustained syllables).
- Duplicate chorus lines; instrumental intros/outros with no lyrics.
- Silence at file head/tail; leading count-in.
- Language mismatch (user picked wrong language) — surface a low global confidence warning.
- Two-line readability: never show >2 lines; split long lyric lines while keeping aksharas intact.

QA: assert monotonic non-overlapping timings; every akshara maps to a source cluster; karaoke fill lands
within ±1 frame of `syllableTimings`; export caption timing == preview.

---

## 14. Acceptance criteria

1. User can pick ta/te/ml/hi, paste full lyrics, and produce timed captions without any word being
   invented or changed by the system.
2. On a vocal-isolated song, automatic alignment places lines within a small, reviewable error, and the
   confidence heatmap flags the weak spots.
3. Tap-Sync anchors reliably pin line timing even when automatic alignment fails; proportional fallback
   never produces empty/garbled output.
4. Karaoke syllable fill and active-word highlight advance by akshara/grapheme cluster (no cluster
   splitting) and track the audio within ±1 frame.
5. Optional romanized display row stays in sync with the native lyric per syllable.
6. Alignment is cached; preview and export caption timing are identical to the frame.
7. Editing timing never alters text; editing text is explicit and re-aligns only the changed span.

---

## 15. Integration with the existing app

- This **replaces the fully-automatic path** as the recommended method for Indic music captions; keep the
  old auto path available as `captions.mode: "auto"`. `lyricsFirst` is a sibling mode (additive).
- Output is the **same caption clip shape** the caption styles, karaoke roll-up, active-word highlight, and
  section-aware theming already consume — so all existing caption styling works unchanged on lyrics-first
  captions.
- Reuse existing capabilities: FFmpeg (decode/normalize), the grapheme-cluster/Indic segmentation rules,
  the transliteration capability (for the display row and any romanization fallback), beat markers (for
  Tap-Sync snapping and beat-cut caption transitions).
- New pieces this feature needs: a **vocal-separation** step, a **forced-alignment provider** (Python
  sidecar over IPC, local-first), a **lyrics input + Tap-Sync** UI, and the **confidence-review** UI.

---

## 16. Recommended defaults & open decisions

Recommended defaults: vocal isolation **on** for songs; primary engine **MMS/wav2vec2 CTC** (native
script); **anchor+align hybrid** with Tap-Sync available; romanization **off** for display, **ISO 15919**
if enabled; alignment cached; frame-snap on emit.

Decisions to confirm before building:
- Which engine ships by default per language (verify ta/te/ml/hi coverage for MMS/MFA/Aeneas *now*).
- Whether the Python alignment/separation sidecar is bundled or downloaded on first run (size vs. UX).
- Syllabifier: grapheme-cluster floor only, or a full akshara splitter per script (better karaoke).
- Whether Tap-Sync is offered up front for all songs or only after low-confidence alignment.

---

## Appendix A — example `alignment.json`
```jsonc
{
  "language": "ta",
  "engine": "mms-ctc",
  "vocalStem": true,
  "fps": 30,
  "lines": [
    {
      "index": 0,
      "text": "நெஞ்சுக்குள் ஓடும் நதியே",
      "start": 34.20, "end": 37.90, "confidence": 0.81,
      "words": [
        { "word": "நெஞ்சுக்குள்", "start": 34.20, "end": 35.05, "confidence": 0.82,
          "syllables": [
            { "akshara": "நெ", "start": 34.20, "end": 34.38, "confidence": 0.79 },
            { "akshara": "ஞ்", "start": 34.38, "end": 34.55, "confidence": 0.74 }
          ]
        }
      ]
    }
  ],
  "gaps": [ { "start": 0.0, "end": 34.20, "type": "intro" } ]
}
```

## Appendix B — pipeline (compact)
```
MP3 ─▶ FFmpeg WAV ─▶ Demucs vocals ─▶ VAD
lyrics(ta/te/ml/hi) ─▶ parse ─▶ akshara-segment ─┐
                                                 ▼
                        MMS CTC forced align (on vocals)
                                                 ▼
                    confidence + gaps + Tap-Sync anchors
                                                 ▼
              tokens→aksharas, frame-snap, readability
                                                 ▼
       caption clips (wordTimings + syllableTimings) ─▶ styles / karaoke / active-word / transliteration row
```

*End of specification. Words come from the user; the system supplies only timing — and lets the user
correct it fast.*

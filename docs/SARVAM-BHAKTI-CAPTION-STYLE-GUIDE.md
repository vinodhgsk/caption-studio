# Sarvam Bhakti Studio — Signature Caption Style Guide
### 3D Glossy Golden Devotional Text — Master Specification

> **Purpose:** This is the single source of truth for the channel's primary/default caption style. Every caption — Tamil, Telugu, Malayalam, Kannada, Hindi, and English — must use this exact gold treatment so the brand looks consistent across all languages.
>
> **Two things vary, everything else is locked:**
> 1. The **font** changes per language (§7).
> 2. The **fill colour** changes only for the **word being sung** (vocal-sync highlight, §2.7 & §3).
>
> The **bevel, 3D depth, dark outline, gloss, and shadow never change**, and captions are **always on a transparent background** (§2.6).

All values below were measured directly from the reference artwork (`caption-01.png`, `caption-02.png`, `new-logo.png`), so following them reproduces the look pixel-for-pixel.

---

## 1. The Look at a Glance

A heavy, rounded, traditional devotional letterform rendered as **polished 3D gold**, delivered as a **transparent overlay caption** that sits on top of the video. As the vocalist sings, the **current word lights up in a highlight colour** while the rest stays gold.

- Light **top-lit metallic gradient** — creamy highlight along the top of each stroke rolling down into a rich amber/bronze base.
- A crisp **dark-brown contour** hugging every letter edge for definition.
- A genuine **3D extrusion** (a solid bronze "wall") that gives the letters real depth.
- A **tight, warm drop shadow** so the text sits proudly above any footage.
- A subtle **gloss streak / hotspot** on the upper curves that reads as reflected light on metal.
- **Word-by-word vocal highlight** — the sung word switches fill colour; nothing else about the letter changes.

The overall feeling should be **temple gold, premium, auspicious, celebratory** — never flat, never neon.

---

## 2. Master Colour Palette (measured from the artwork)

### 2.1 Gold fill gradient — the default (un-sung) state
This is a **linear gradient at 90° (top → bottom)**. Bright at the top of the letter, deep at the bottom. Use these exact stops:

| Stop | Position | HEX | RGB | Role |
|------|----------|-----|-----|------|
| 1 | 0 %  | `#FFF7C2` | 255, 247, 194 | Top rim — creamy highlight |
| 2 | 15 % | `#FFE884` | 255, 232, 132 | Upper highlight |
| 3 | 40 % | `#FDD24C` | 253, 210, 76  | Bright gold |
| 4 | 60 % | `#FBC42E` | 251, 196, 46  | Main body gold |
| 5 | 78 % | `#F0A616` | 240, 166, 22  | Lower amber |
| 6 | 100 %| `#C9760A` | 201, 118, 10  | Base — deep amber/bronze |

### 2.2 Letter contour / outline (thin dark edge around every glyph)
| HEX | RGB | Role |
|-----|-----|------|
| `#3D2100` | 61, 33, 0  | Darkest contour |
| `#512F1B` | 81, 47, 27 | Contour mid |
| `#7F3B10` | 127, 59, 16 | Contour warm edge |

Use `#3B2200` as the single flat outline colour if only one is possible.

### 2.3 3D extrusion "wall" (the side/depth of the letters)
| HEX | RGB | Role |
|-----|-----|------|
| `#B25E04` | 178, 94, 4 | Top of the extruded wall |
| `#8E4705` | 142, 71, 5 | Mid wall |
| `#5C2D08` | 92, 45, 8  | Bottom of the wall (deepest) |

### 2.4 Bevel highlight & shadow (glossy metal sheen)
| HEX | RGB | Role |
|-----|-----|------|
| `#FFFDF0` | 255, 253, 240 | Bevel highlight (near-white gloss) |
| `#FFF7C2` | 255, 247, 194 | Soft gloss streak |
| `#5C3A00` | 92, 58, 0 | Bevel shadow (Multiply) |

### 2.5 Drop shadow
| HEX | RGB | Notes |
|-----|-----|-------|
| `#1A0E00` | 26, 14, 0 | Warm near-black. Opacity **45–55 %**, Multiply |

### 2.6 Background — always transparent
Captions are **always rendered on a transparent background** and placed as an overlay on top of the video. There is **no solid colour plate** behind the text.

| Name | HEX | Use |
|------|-----|-----|
| **Transparent** | — (alpha = 0) | **The only caption background.** Always export as transparent PNG / with alpha channel. |
| Temple Red | `#811305` | Logo medallion / title cards only — never behind captions |

> The green and white seen in the reference files were just preview backdrops. The **deliverable caption always has a transparent background** so it composites cleanly over any footage.

Because the gold now sits over live, unpredictable video, the **dark contour (§2.2) and drop shadow (§2.5) are mandatory, not optional** — they are what keep the text legible over bright, busy, or gold-coloured footage. See **§8.3** for legibility over difficult backgrounds.

### 2.7 Active-word highlight — the "vocal-sync" state
When a word is being sung, only its **fill gradient** changes to a highlight colour. The **outline, bevel, 3D wall, gloss, and shadow stay exactly the same** — so it reads as the *same letters lighting up*, not a different style.

**Pick ONE highlight colour per video or series and keep it consistent.** Three approved options (all are 90° top→bottom gradients):

**A — Pearl White-Gold (DEFAULT — recommended)** — the word appears to catch extra light. Premium, subtle, works over any footage.
| Position | HEX |
|----------|-----|
| 0 %  | `#FFFFFF` |
| 45 % | `#FFF6D0` |
| 100 %| `#FFE79A` |

**B — Kumkum Saffron-Red** — maximum devotional contrast and punch.
| Position | HEX |
|----------|-----|
| 0 %  | `#FF7A2F` |
| 55 % | `#F23A11` |
| 100 %| `#C21807` |

**C — Emerald Green** — ties to the logo/brand green.
| Position | HEX |
|----------|-----|
| 0 %  | `#3BD37A` |
| 55 % | `#12A24A` |
| 100 %| `#036322` |

> **Optional active glow:** to help the eye track the sung word, add a soft outer glow in the highlight hue — Blend **Screen**, ~**40 %**, small size. Keep it gentle. Never add glow to the gold (un-sung) state.

---

## 3. Word Highlight — Vocal Sync (Karaoke) Implementation

The caption has exactly **two states per word**:

- **Base state** → Gold fill (§2.1).
- **Active state** → Highlight fill (§2.7). *Everything else identical.*

There are two accepted timing styles — choose one and stay consistent within a video:

- **Sweep fill (classic karaoke):** each word turns from gold → highlight as the sweep passes, and **stays** highlighted for the rest of the line. Best for full-screen bhajan/lyric videos.
- **Current-word pop:** only the word being sung is highlighted; it reverts to gold once the next word starts. Cleaner for lower-third captions.

### 3.1 Method 1 — ASS/SSA subtitles (best for song lyrics, frame-accurate)
Karaoke `.ass` files give the most precise vocal sync with the smallest effort, and they render the sweep automatically with `\k` tags. ASS colours are **&HBBGGRR** (blue-green-red), so the RGB values are byte-reversed:

| Purpose | Our RGB | ASS value |
|---------|---------|-----------|
| `SecondaryColour` (not-yet-sung = gold body) | `#FBC42E` | `&H002EC4FB` |
| `PrimaryColour` (sung = white-gold highlight) | `#FFF6D0` | `&H00D0F6FF` |
| `OutlineColour` | `#3B2200` | `&H0000223B` |
| `BackColour` (shadow) | `#1A0E00` | `&H00000E1A` |

In ASS karaoke, text begins as `SecondaryColour` and each `\k` syllable flips to `PrimaryColour` as it is sung — i.e. **gold turns to white-gold in time with the vocal.** Set `BorderStyle=1`, a bold outline and shadow, and use the matching font (§7). The full 3D bevel isn't native to ASS, so for the richest look use Method 2 or 3; ASS is the choice when you need many minutes of precisely-timed lyrics fast.

### 3.2 Method 2 — After Effects / Premiere (richest look)
Keep the full 3D gold treatment and animate the fill:

- Build the caption text with the full style (§4). Duplicate it into two layers: **Gold** (base) and **Highlight** (same style, fill swapped to §2.7).
- Put **Highlight on top**, and reveal it word-by-word using an **animated rectangular mask / Linear Wipe** that moves left→right in sync with the vocal (sweep style), **or** keyframe a mask that only exposes the current word (pop style).
- Because both layers share identical outline/bevel/shadow, the transition looks like the letters simply changing colour.
- Alternatively, animate the **Fill/Gradient colour** with keyframes per word (no second layer needed).

### 3.3 Method 3 — CapCut / mobile editors
- Newer CapCut has an **auto-caption / lyric highlight** feature: set the **base text colour** to gold and the **highlight colour** to your chosen §2.7 colour. Apply the gold PNG-style look via a template where possible.
- Reliable fallback that works in any app: **stack two text/PNG overlays** (gold underneath, highlighted on top) and keyframe the top layer's **crop/mask or opacity** to reveal the sung word in time with the audio.
- For guaranteed brand-exact gold, pre-render both states as transparent PNGs (§6) and reveal the highlighted one in sync.

---

## 4. The Definitive Recipe — Adobe Photoshop Layer Style

This is the exact stack that recreates the reference. Set your type, then apply these layer effects **from bottom to top of the FX list**. Sizes below assume text drawn at roughly the reference scale (2048 px canvas, cap-height ~180–200 px). **Scale all pixel sizes proportionally** to your actual canvas — see §8.

**1. Gradient Overlay** *(the metal fill)*
- Blend: Normal, 100 %
- Style: Linear, Angle **90°**, Scale 100 %
- Gradient: use the six stops from §2.1 (for the highlight state, swap to §2.7)

**2. Bevel & Emboss** *(the gloss + roundness)*
- Style: **Inner Bevel**
- Technique: **Chisel Hard** (crisp) or **Smooth** (softer, rounder)
- Depth: **220 %** · Direction: Up
- Size: **10–16 px** · Soften: **1–2 px**
- Angle: **90°** · Use Global Light: off · Altitude: **38°**
- Gloss Contour: **Ring** or **Cove – Deep** (this creates the shiny metal band) · Anti-aliased: on
- Highlight: **Screen**, `#FFFDF0`, **75 %**
- Shadow: **Multiply**, `#5C3A00`, **60 %**

**3. Contour** *(sharpens the glossy roll — nested under Bevel)*
- Contour: Half Round · Range: 60 % · Anti-aliased: on

**4. Inner Shadow** *(deepens the inside edges)*
- Blend: Multiply, `#6B3A00`, **40 %** · Angle 90°, Distance **3 px**, Size **6 px**

**5. Inner Glow** *(centre core sheen)*
- Blend: Screen, `#FFF6C0`, **35 %** · Source: Center · Size **12–18 px**

**6. Stroke** *(the dark contour from §2.2)*
- Position: **Outside** · Size **4–6 px**
- Fill: **Gradient**, Linear 90°: `#7F3B10` → `#3B2200` (or flat `#3B2200`)

**7. Drop Shadow** *(anchor over video)*
- Blend: Multiply, `#1A0E00`, **50 %** · Angle 90° · Distance **6 px** · Spread 0 % · Size **10 px**

> **Tip:** Save this as **two Style presets** — `Sarvam-Gold` (base) and `Sarvam-Gold-Highlight` (only the Gradient Overlay differs, §2.7). Then any word in any language is one click to style.

### 4.1 Adding the true 3D extrusion (matches reference best)
The reference letters have a visible solid side wall. Two ways:

- **Illustrator (recommended):** Set type → *Effect → 3D and Materials → Extrude & Bevel* → Depth ~40–60 pt, small bevel, then fill the extrude faces with the wall gradient (`#B25E04 → #5C2D08`). Paste into Photoshop and apply the layer style above on top.
- **Photoshop fake-3D:** Duplicate the text layer, fill with `#8E4705`, nudge **1 px right + 1 px down**, repeat 8–12 times behind the main layer (an Action makes this instant), then place the styled gold layer on top.

---

## 5. Web / SVG / HTML Method (thumbnails, lower-thirds, motion graphics)

Reproduces the effect for web-generated captions and overlays. `.sarvam-gold` is the base; `.sarvam-gold--active` swaps only the fill for the sung word.

```css
.sarvam-gold {
  font-family: "Baloo Thambi 2", sans-serif; /* swap per language, see §7 */
  font-weight: 800;
  font-size: 120px;
  line-height: 1.05;
  text-align: center;

  /* metal fill (base / un-sung) */
  background: linear-gradient(180deg,
    #FFF7C2 0%, #FFE884 15%, #FDD24C 40%,
    #FBC42E 60%, #F0A616 78%, #C9760A 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;

  /* outline + 3D extrusion walls + drop shadow (over transparent bg) */
  filter: drop-shadow(0 1px 0 #3b2200)      /* dark contour   */
          drop-shadow(1px 1px 0 #8e4705)    /* 3D wall        */
          drop-shadow(2px 2px 0 #7a3b08)
          drop-shadow(3px 3px 0 #5c2d08)
          drop-shadow(6px 9px 7px rgba(26,14,0,.55)); /* shadow */
}

/* active / sung word — ONLY the fill changes (default = White-Gold, §2.7 A) */
.sarvam-gold--active {
  background: linear-gradient(180deg,#FFFFFF 0%,#FFF6D0 45%,#FFE79A 100%);
  -webkit-background-clip: text;
  background-clip: text;
  /* inherit the same filter stack from .sarvam-gold — keep both classes on the element */
}
```

> Wrap each word in its own `<span class="sarvam-gold">`, then add/remove `sarvam-gold--active` in time with the audio (via the `timeupdate` event or lyric-timing JSON). Use `filter: drop-shadow()` (not `text-shadow`) because it respects the clipped text shape. For a **pixel-exact** result, prefer the Photoshop/AE method — CSS is a close, fast approximation.

For **After Effects**, recreate §4 with Gradient Overlay + Bevel Alpha + Inner/Drop Shadow layer styles, or use **Element 3D / Saber** to extrude. Keep the same hex values.

---

## 6. Quick Methods for Mobile / Template Editors

**CapCut, VN, Canva, KineMaster** don't expose full layer styles. Best-quality workflow:

1. **Pre-render the caption text as a transparent PNG** in Photoshop/Illustrator using §4, at 2× the final size — export **two versions** where you need highlighting: an all-gold plate and a per-word highlighted plate.
2. Import as an **image/sticker overlay** and reveal in sync with the vocal (see §3.3).
3. This guarantees identical gold across every video regardless of the app.

If you must type live in the app: choose the **boldest** available font for the language, apply a **gold gradient** (§2.1), a **thin dark outline** (`#3B2200`), and a **soft dark shadow**; set the app's highlight/karaoke colour to your §2.7 choice. Not pixel-perfect, but on-brand.

> **Recommended production pipeline:** build a reusable **Photoshop (.psd)** and **Illustrator (.ai)** template with the saved `Sarvam-Gold` + `Sarvam-Gold-Highlight` styles and one placeholder text box per language. Making a caption becomes: type/paste the words → export transparent PNG.

---

## 7. Fonts by Language — Keep One Family Personality

The reference face is **heavy, rounded, and traditional**. To keep every language looking like the same brand, use the **Baloo super-family** — it has a sibling font for each script with the identical rounded, devotional personality. All are free (SIL Open Font License) on Google Fonts.

| Language | Script | Primary font (Bold/ExtraBold 700–800) | Premium / alternate options |
|----------|--------|----------------------------------------|------------------------------|
| **Tamil** (primary) | Tamil | **Baloo Thambi 2** — ExtraBold | Mukta Malar Bold · Hind Madurai Bold · *(commercial:* Vanavil Avvaiyar, Theneevu TSC *)* |
| **Telugu** | Telugu | **Baloo Tammudu 2** — ExtraBold | Mallanna · Ramabhadra · Noto Serif Telugu Bold |
| **Malayalam** | Malayalam | **Baloo Chettan 2** — ExtraBold | Manjari Bold · Gayathri Bold · Noto Serif Malayalam Bold |
| **Kannada** | Kannada | **Baloo Tamma 2** — ExtraBold | Benne · Noto Serif Kannada Bold |
| **Hindi** | Devanagari | **Baloo 2** — ExtraBold | Mukta Bold · Tiro Devanagari Hindi · Noto Serif Devanagari Bold |
| **English** | Latin | **Baloo 2** — ExtraBold (matches the set) | *Premium/regal:* **Cinzel** or **Cinzel Decorative** · Playfair Display Bold · Marcellus |

**Rules for consistency:**
- Always use **Bold / ExtraBold** weight — the 3D bevel needs thick strokes to read well. Never use Regular/Light.
- Keep the **same gold treatment (§2 and §4)** on every script; only the font glyphs change.
- For English devotional titles, **Cinzel** gives the most "premium / sacred" feel; use **Baloo 2** for visual unity with the Indic captions.

> If you later license a single commercial Indic display family that covers all scripts, you may standardise on it — but the gold effect and highlight system stay exactly as specified here.

---

## 8. Layout, Sizing & Spacing

- **Alignment:** Centre-aligned, stacked lines (as in all references), placed in the **lower third** for captions.
- **Line spacing:** Tight — **1.0 to 1.1×** the cap height. The rounded loops should nearly touch; keep it dense and monumental.
- **Letter spacing:** Default (0). Do not track out.
- **Minimum legible size:** Caption cap-height ≥ **9 % of frame height**. For 1080p that's roughly **≥ 110 px** for a two-word line.
- **Safe margins:** Keep text within the **inner 90 %** of the frame; keep the bottom **12 %** clear of the YouTube progress-bar / control zone.
- **Effect scaling:** All px values in §4 are tuned for a ~2048 px canvas. At 1080p multiply bevel/stroke/shadow sizes by **~0.5**; at 4K by **~2**. Keep proportions, not absolute pixels.

### 8.1 Recommended canvases
| Deliverable | Size |
|-------------|------|
| Master / social square | 2048 × 2048 |
| YouTube video frame | 1920 × 1080 |
| YouTube thumbnail | 1280 × 720 |
| Shorts / reels | 1080 × 1920 |

### 8.2 Optional divider ornament
The reference includes a **gold filigree divider** between stanzas (a slim scrolled flourish, seen in `caption-01` and the logo). Use it to separate two-line couplets. Render it in the **same gold gradient (§2.1)** with a **thin `#3B2200` outline** so it matches. Centre it at ~60–70 % of the text width.

### 8.3 Legibility over difficult (bright / gold / busy) backgrounds
Since the caption is transparent over live footage:
- The **dark contour + drop shadow are mandatory** — never remove them.
- If footage is very bright or itself gold, add a **soft contact shadow behind the whole caption block**: a low-opacity dark blurred plate (≈30–40 % black, heavily blurred, no hard edges). It should feel invisible — just enough separation. **Never a solid colour box.**
- For extreme cases, add a second **outer stroke** in very dark brown (`#1A0E00`, 3–6 px) beneath the main outline.
- Keep captions in the calmer lower third of the frame where possible.

---

## 9. Do & Don't (protect the brand)

**Do**
- Always export captions on a **transparent background** (alpha).
- Keep the exact gold gradient, dark contour, 3D wall, and warm shadow on every caption.
- Use bold/extrabold fonts only.
- Pick **one** vocal-highlight colour per series (§2.7) and keep the sung-word highlight consistent.
- Keep outline + shadow on at all times for legibility over video.
- Pre-render captions as PNG overlays for mobile editors; scale effects proportionally to canvas size.

**Don't**
- Don't put a **solid colour box or plate** behind captions — background is always transparent.
- Don't use flat single-colour gold (no gradient, no bevel) — it looks cheap.
- Don't switch to neon yellow, chrome/silver, or rainbow.
- Don't **rainbow the highlight** or change the highlight colour mid-video.
- Don't use thin/condensed fonts, or ALL-CAPS Latin in a plain sans.
- Don't add heavy glow to the gold state or mix multiple font personalities in one graphic.

---

## 10. Reusable Colour Tokens (copy/paste)

```
# --- GOLD (base / un-sung) ---
GOLD_HL_TOP     #FFF7C2
GOLD_HL         #FFE884
GOLD_BRIGHT     #FDD24C
GOLD_BODY       #FBC42E
GOLD_AMBER      #F0A616
GOLD_BASE       #C9760A

# --- STRUCTURE ---
OUTLINE_DARK    #3B2200
OUTLINE_WARM    #7F3B10
WALL_TOP        #B25E04
WALL_MID        #8E4705
WALL_DEEP       #5C2D08
BEVEL_HL        #FFFDF0
BEVEL_SHADOW    #5C3A00
DROP_SHADOW     #1A0E00   (opacity 50%, Multiply)

# --- BACKGROUND ---
BG_CAPTION      transparent (alpha = 0)   # the only caption background
LOGO_RED        #811305                   # logo / title cards only

# --- VOCAL-SYNC HIGHLIGHT (pick ONE set per series) ---
# A. White-Gold (default)
HI_WHITE_TOP    #FFFFFF
HI_WHITE_MID    #FFF6D0
HI_WHITE_BASE   #FFE79A
# B. Saffron-Red
HI_SAFFRON_TOP  #FF7A2F
HI_SAFFRON_MID  #F23A11
HI_SAFFRON_BASE #C21807
# C. Emerald Green
HI_GREEN_TOP    #3BD37A
HI_GREEN_MID    #12A24A
HI_GREEN_BASE   #036322

# --- ASS/SSA karaoke (BGR) ---
ASS_SECONDARY   &H002EC4FB   # gold body (not yet sung)
ASS_PRIMARY     &H00D0F6FF   # white-gold (sung)
ASS_OUTLINE     &H0000223B
ASS_SHADOW      &H00000E1A
```

---

*Version 1.1 · Sarvam Bhakti Studio caption master style. Transparent overlay only. Same gold on all six languages — change only the font (§7); the vocal-sync highlight (§2.7) is the only word-level colour change.*

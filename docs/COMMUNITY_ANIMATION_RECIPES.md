# Community Text Animations — Recreation Recipes

A detailed, implementation-level companion to [`17_COMMUNITY_TEXT_ANIMATIONS.md`](17_COMMUNITY_TEXT_ANIMATIONS.md). For each of the seventeen community-reference animations this gives the exact mechanism, the per-glyph math expressed against our animation evaluator, a parameter table with defaults, a short reference CSS sketch (for intuition), and the Canvas/WebGL mapping used by our headless-parity render pipeline.

> ⚠️ **Best-guess recreations — confirm against the source pens.** The source pens are behind Cloudflare bot verification and could not be read. Every recipe below is reconstructed from the author's known work and the standard technique for that effect. Treat each as a faithful, self-consistent *recreation* — it will produce the named effect, but may differ from the original in detail. Confirm/adjust against the source URL before checking the matching `P8C.*` box.

---

## How to read these recipes

**Engine contract.** Animations are pure functions evaluated per frame; they never touch the DOM. Two output shapes (from the `keyframe-engine` / `reveal-effects` skills):

- **Transform presets** → `evaluate(tLocal, layout, params) → { perUnit: PerUnit[], overlays?, blend? }` where each `PerUnit` (one per grapheme cluster or word) is `{ dx, dy, scaleX, scaleY, rotate, rotateX, rotateY, skewX, opacity, glyphOverride? }`. `dx/dy` in `em` (font-size relative) unless noted.
- **Reveal presets** → `evaluate(tLocal, layout, params) → { mask, perUnit?, overlays? }` (a clip mask + optional overlay layers, e.g. a sheen band).

**Time.** `p ∈ [0,1]` = normalized progress over `duration` for one-shot entrances; `t` (seconds) for loops. `i` = unit index, `N` = unit count.

**Units = grapheme clusters.** "Per-letter" always means extended grapheme clusters via `indic-text`, so Tamil/Indic clusters (e.g. `கி`) animate as one unit.

**Determinism / parity.** No DOM, no wall-clock, no unseeded randomness. Any randomness is seeded from `(clipId, unitIndex, frameTick)` so the **preview and the FFmpeg/headless export render identical frames**. Sample every recipe at `p ∈ {0,.25,.5,.75,1}` in tests.

**Easing.** `ease()` refers to the `keyframe-engine` easing chosen in the panel; defaults noted per recipe.

---

## 1. `community/wave-ripple`

**Source (confirm):** https://codepen.io/nefejames/pen/JoPPBxK · **Builds on:** Doc 06 loop evaluator · **Slot:** `animation.loop` (or `animation.in`)

**Effect.** Letters undulate vertically in a travelling sine wave — a ripple that runs across the word and repeats.

**Mechanism.** Each unit is offset on Y by a sine of time minus a per-unit phase, so the crest travels along the text.

**Math (per unit `i`):**
```
ω      = 2π · speed                  // angular frequency (rad/s)
k      = 2π / wavelength             // phase step per unit (units/cycle)
dy_i   = -amplitude · sin(ω·t − k·i + phase)
// optional coupling for richness:
rotate_i = tiltCouple · cos(ω·t − k·i)     // slight tilt with the slope
scaleY_i = 1 + lift · max(0, sin(ω·t − k·i))
```
For a one-shot `in` variant, multiply `amplitude` by `ease(p)` ramping 1→0 so it settles flat.

**Params:**
| name | default | range | note |
|---|---|---|---|
| `amplitude` | `0.15em` | 0–0.6em | crest height |
| `wavelength` | `6` | 2–20 | units per full wave |
| `speed` | `1` | 0.1–4 | cycles/sec (loop) |
| `phase` | `0` | 0–2π | start offset |
| `axis` | `y` | x \| y | ripple direction |
| `tiltCouple` | `0` | 0–15° | optional letter tilt |

**Reference CSS sketch:**
```css
@keyframes wave { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-0.15em) } }
.letter { display:inline-block; animation: wave 1s ease-in-out infinite; }
.letter:nth-child(n) { animation-delay: calc(var(--i) * -0.08s); } /* per-letter phase */
```

**Canvas/WebGL.** Pure transform — set `perUnit[i].dy` (and optional `rotate`,`scaleY`). No overlay, no mask. Identical in both render paths.

**QA.** Continuous at the loop wrap (`t` and `t+1/speed` match); crest visibly travels (varies with `i`); `amplitude→0` gives static text.

---

## 2. `community/glitch-split`

**Source (confirm):** https://codepen.io/nefejames/pen/azooadB · **Builds on:** Doc 04 `glitch` effect · **Slot:** `animation.in` (settling) or `animation.loop`

**Effect.** RGB channel separation with jitter and horizontal slice tearing that resolves into clean text.

**Mechanism.** Draw the glyph layer three times — red, green, blue channels — at small opposing offsets, screen/additive-blended; add per-frame jitter and occasional horizontal slice displacement. For an entrance, the displacement amplitude rides `1 − ease(p)` so it settles to a clean, aligned render.

**Math:**
```
amp     = splitDistance · (mode==='in' ? (1 − ease(p)) : 1)
jx, jy  = (rand(seed,frame)·2−1)·jitter            // seeded per frame
R layer at (−amp + jx, −jy)   tint #F00, blend screen
G layer at ( 0,         0 )   tint #0F0, blend screen
B layer at (+amp − jx, +jy)   tint #00F, blend screen
// slices: every 1/frequency s, pick `sliceCount` horizontal bands,
// shift each band by ±sliceShift for `sliceHold` frames (seeded)
```

**Params:**
| name | default | range | note |
|---|---|---|---|
| `splitDistance` | `3px` | 0–20 | channel offset |
| `frequency` | `12` | 1–30 | jitter/slice events per sec |
| `jitter` | `1.5px` | 0–8 | random shake |
| `sliceCount` | `3` | 0–12 | torn bands |
| `sliceShift` | `8px` | 0–40 | band displacement |
| `intensity` | `1` | 0–1 | master mix |

**Reference CSS sketch:**
```css
.glitch { position:relative; }
.glitch::before,.glitch::after{ content:attr(data-text); position:absolute; inset:0; }
.glitch::before{ color:#f00; transform:translate(-3px,0); mix-blend-mode:screen; }
.glitch::after { color:#00f; transform:translate( 3px,0); mix-blend-mode:screen; }
/* animate clip-path inset bands + transform for the tear */
```

**Canvas/WebGL.** Returns `overlays` = 3 tinted copies of the glyph layer with `blend:'screen'` + per-band clip rects. **Seed jitter/slice from `(clipId, frameIndex)`** — never `Math.random()` — so export matches preview. Reuse the Doc 04 glitch shader; this preset just drives its params over the entrance window.

**QA.** Channel offset ≤ `splitDistance+jitter`; identical frames for a fixed seed across two runs; at `p=1` (mode `in`) the three channels coincide (clean text).

---

## 3. `community/typewriter-caret`

**Source (confirm):** https://codepen.io/yemon/pen/YrPmQr · **Builds on:** Doc 15 `Type` reveal · **Slot:** `animation.reveal`

**Effect.** Text types out one cluster at a time with a blinking block/line caret trailing the last revealed character.

**Mechanism.** A hard reveal mask exposes the first `n` clusters; a caret quad is drawn at the right edge of cluster `n`, blinking on an independent clock.

**Math:**
```
N       = graphemeCount(layout)
n       = floor(p · N)               // or floor(t · cps) for fixed speed
reveal cluster k visible  ⇔  k < n
caretX  = rightEdge(cluster[n-1])    // or lineStart if n==0
caretOn = ((t · blinkHz) mod 1) < 0.5
```
Speed: either `duration` (derive `cps = N/duration`) or a fixed `cps`.

**Params:**
| name | default | range | note |
|---|---|---|---|
| `cps` | derived | 4–40 | clusters/sec (overrides duration if set) |
| `caretChar` | `▋` | ▋ \| \| \| _ | glyph or block |
| `caretColor` | fill color | hex | |
| `blinkHz` | `1.1` | 0–4 | 0 = no blink |
| `holdCaretAtEnd` | `true` | bool | keep caret after last cluster |
| `keyTick` | `false` | bool | optional per-cluster SFX cue |

**Reference CSS sketch:**
```css
.type { width:0; overflow:hidden; white-space:nowrap; border-right:.1em solid;
        animation: type 2s steps(var(--n)) forwards, blink .8s step-end infinite; }
@keyframes type { to { width:100% } }
@keyframes blink{ 50% { border-color:transparent } }
```

**Canvas/WebGL.** Returns `mask` = visible cluster range `[0,n)` + an `overlays` caret quad at `caretX`. **Step by grapheme cluster** (`indic-text`) so Tamil `கி` types as one keystroke. Blink clock is independent of reveal progress.

**QA.** `n` increments by exactly 1 per `1/cps`; caret tracks the last cluster's right edge; blink phase ≈ `blinkHz`; Indic clusters never split mid-reveal.

---

## 4. `community/kinetic-3d`

**Source (confirm):** https://codepen.io/amit_sheen/pen/wvORNYm · **Builds on:** new 3D per-letter transform + `keyframe-engine` · **Slot:** `animation.in` or `animation.loop`

**Effect.** Letters rotate in 3D — a wave of `rotateX`/`rotateY` (optionally with extruded depth) sweeps across the word and settles upright (entrance) or rotates continuously (loop).

**Mechanism.** Per-unit 3D rotation with a travelling phase under a shared perspective. Optional depth = stacked extrude copies along −Z with darkening for a solid 3D body.

**Math (per unit `i`):**
```
phase_i = i · stagger
θ_i     = mode==='in' ? maxAngle·(1 − ease(clamp(p − phase_i)))     // settles to 0
                      : maxAngle·sin(ω·t − k·i)                       // loop
apply rotateX=θ_i (axis 'x') or rotateY=θ_i (axis 'y') under perspective P
// extrude (optional): for d in 1..depth → draw copy at z=−d·dz,
//   color = fill · (1 − d/depth·shade)
```

**Params:**
| name | default | range | note |
|---|---|---|---|
| `axis` | `x` | x \| y | tumble axis |
| `maxAngle` | `90°` | 0–180 | peak rotation |
| `stagger` | `0.05` | 0–0.2 | per-unit delay (of `p`) |
| `perspective` | `600px` | 200–1500 | camera depth |
| `depth` | `0` | 0–12 | extrude layers (0 = flat) |
| `shade` | `0.5` | 0–1 | depth darkening |
| `mode` | `in` | in \| loop | settle vs continuous |

**Reference CSS sketch:**
```css
.word { perspective: 600px; }
.letter { display:inline-block; transform-style:preserve-3d; animation: tumble .6s both; }
.letter:nth-child(n){ animation-delay: calc(var(--i)*.05s); }
@keyframes tumble { from { transform: rotateX(90deg) } to { transform: rotateX(0) } }
```

**Canvas/WebGL.** **WebGL path is authoritative**: apply a real perspective matrix + per-glyph `rotateX/rotateY` (and extrude instances). The Canvas-2D fallback approximates with `scaleY=cos θ` + vertical shear + edge shading; both paths must agree within the parity threshold, so derive the 2D approximation from the same projection math. Output `perUnit[i].{rotateX,rotateY}` plus `overlays` for extrude copies.

**QA.** At `p=1` (mode `in`) every `θ_i=0` (upright, identity); rotation wave is staggered across `i`; WebGL vs 2D fallback within threshold; depth copies render behind the face.

---

## 5. `community/scramble-decode`

**Source (confirm):** https://codepen.io/robjoeol/pen/WNywdEW · **Builds on:** new deterministic scramble mechanic + grapheme clusters · **Slot:** `animation.in`

**Effect.** Each position flickers through random characters and "locks" into the final glyph on a staggered schedule — a decrypt/decode reveal.

**Mechanism.** Per unit a **lock time**; before it, substitute a seeded-random character from a charset re-rolled at `tickHz`; after it, show the real cluster. This is the one preset that overrides glyph **content**, not just transform.

**Math (per unit `i`):**
```
lock_i  = (i / N) · spread · duration            // staggered lock schedule
tick    = floor(t · tickHz)
if t < lock_i:  glyphOverride_i = charset[ prng(seed, i, tick) mod charset.length ]
else:           glyphOverride_i = finalCluster_i
// optional flicker: opacity_i = 0.6 + 0.4·rand(seed,i,tick) while scrambling
```
Use a small fast PRNG (e.g. `mulberry32(hash(clipId,i,tick))`).

**Params:**
| name | default | range | note |
|---|---|---|---|
| `duration` | `1.2s` | 0.3–4 | total decode time |
| `tickHz` | `20` | 5–60 | re-roll rate |
| `spread` | `0.7` | 0–1 | stagger amount (1 = fully sequential) |
| `charset` | `A–Z0–9` | — | pool; script-aware for Indic |
| `seed` | `clipId` | — | determinism key |

**Indic note.** For Tamil/Telugu/Malayalam/Kannada/Devanagari, draw the scramble pool from clusters of the **same script** so the flicker looks native, then settle to the actual grapheme cluster.

**Reference (JS, not pure CSS):**
```js
el.textContent = [...graphemes].map((g,i) =>
  t < lock[i] ? charset[(prng(seed,i,tick))%charset.length] : g
).join('');
```

**Canvas/WebGL.** Requires the text pipeline's **per-frame content-substitution hook** (`glyphOverride`) — most presets are transform-only, this one re-shapes substituted clusters each tick. **Must be seeded** so preview and export scramble identically. Re-shape overridden clusters through `indic-text` for correct widths.

**QA.** Deterministic for a fixed seed (two runs byte-identical); at `t ≥ duration` text equals the exact source string; substituted clusters use the configured/script charset; no layout jitter from width changes (reserve final advance width while scrambling).

---

## 6. `community/gloss-sweep`

**Source (confirm):** https://codepen.io/ostylowany/pen/vYzPVZL · **Builds on:** Doc 15 `Glossy` reveal · **Slot:** `animation.loop` (or one-shot `animation.in`)

**Effect.** A bright specular band slides diagonally across the letters — a glossy light glint — clipped to the glyph shapes.

**Mechanism.** A linear-gradient highlight band, masked to the glyph alpha, whose centre sweeps from before the text to past it; screen/additive blended over the fill.

**Math:**
```
sweep   = mode==='loop' ? frac(t·speed) : ease(p)     // 0→1
centre  = lerp(−bandWidth, textWidth + bandWidth, sweep)
// band = linear gradient along `angle`, peak `intensity` at `centre`,
//        falloff over `bandWidth`; masked by glyph alpha; blend 'screen'
```

**Params:**
| name | default | range | note |
|---|---|---|---|
| `angle` | `20°` | −80–80 | band tilt |
| `bandWidth` | `0.4em` | 0.1–1.5em | glint width |
| `intensity` | `0.9` | 0–1 | peak brightness |
| `color` | `#fff` | hex | glint color |
| `speed` | `0.8` | 0.1–3 | sweeps/sec (loop) |
| `mode` | `loop` | loop \| in | repeating vs one-shot |

**Reference CSS sketch:**
```css
.gloss { background: linear-gradient(110deg, transparent 40%, #fff 50%, transparent 60%) ,
                     var(--fill);
         -webkit-background-clip: text; background-clip: text; color: transparent;
         background-size: 250% 100%; animation: sheen 2s linear infinite; }
@keyframes sheen { to { background-position: -200% 0 } }
```

**Canvas/WebGL.** Returns an `overlays` sheen layer (gradient band) with `mask = glyphAlpha` and `blend:'screen'`. Reuse the Doc 15 Glossy primitive; this preset only sets its sweep params. Loop must be continuous at the wrap.

**QA.** Glint clipped to letters (background stays dark); centre moves monotonically with `sweep`; loop continuous at `frac` wrap; `intensity=0` ⇒ no visible change.

---

## 7. `community/mask-line-rise`

**Source (confirm):** https://codepen.io/jpbelley/pen/gbwdzwa · **Builds on:** Doc 15 Slide/mask reveal · **Slot:** `animation.in` (reveal)

**Effect.** Each line rises up into view from behind a hard horizontal mask edge — the classic motion-graphics "masked line reveal" (lines slide up, clipped to their own band), staggered top-to-bottom.

**Mechanism.** Per **line**, a clip rect fixed to the line's box; the line content starts fully below the box (`dy = +lineHeight`) and translates to `0` under that clip, so it appears to emerge from the mask edge. Stagger each line by `lineStagger`.

**Math (per line `L`):**
```
pL    = ease(clamp01((p − L·lineStagger) / max(ε, 1 − (Nlines−1)·lineStagger)))
dy_L  = (1 − pL) · (lineHeight + overshoot)        // starts below, settles to 0
clip  = line[L].box                                 // hard mask = the line band
opacity_L = pL < 0.001 ? 0 : 1                      // mask hides it anyway
```
Optionally apply the same per **word** within a line for a tighter cascade (`unit:"word"`).

**Params:**
| name | default | range | note |
|---|---|---|---|
| `unit` | `line` | line \| word | rising unit |
| `lineStagger` | `0.12` | 0–0.4 | delay between lines (of `p`) |
| `overshoot` | `0` | 0–0.3em | rise past then settle |
| `direction` | `up` | up \| down | emerge direction |
| `clipPad` | `0` | 0–0.2em | mask bleed |

**Reference CSS sketch:**
```css
.line { overflow:hidden; }            /* the mask band */
.line > span { display:inline-block; transform:translateY(100%); animation:rise .7s both; }
.line:nth-child(n) > span { animation-delay: calc(var(--l)*.12s); }
@keyframes rise { to { transform:translateY(0) } }
```

**Canvas/WebGL.** Returns `perUnit` (per line/word `dy`) **plus a per-line `mask`** = the line band. The mask is what sells it — render with a hard clip rect per line. Reuse the Doc 15 Slide reveal's mask path.

**QA.** At `p=1` every `dy=0` and lines sit on baseline; content never visible outside its line band during the rise; line stagger visible; works for multi-line Tamil/Indic (mask uses shaped line metrics).

---

## 8. `community/elastic-word-pop`

**Source (confirm):** https://codepen.io/jpbelley/pen/PwGBZBJ · **Builds on:** Doc 06 `in` (elastic/Scream) · **Slot:** `animation.in`

**Effect.** Words punch in one-by-one with an elastic spring overshoot — scale from 0 past 1 and settle, with a tiny rotation kick.

**Mechanism.** Per **word**, an elastic-out easing on scale with staggered start; small damped rotation for energy.

**Math (per word `w`):**
```
pw      = clamp01((p − w·wordStagger) / segment)
s       = easeOutElastic(pw, amplitude, period)        // overshoots 1 then settles
scale_w = s
rot_w   = (1 − pw) · kick · sign(alternate(w))         // damped ± rotation
opacity_w = clamp01(pw·3)                               // quick fade-in
```
`easeOutElastic` from `keyframe-engine`; `segment = 1 − (Nwords−1)·wordStagger`.

**Params:**
| name | default | range | note |
|---|---|---|---|
| `unit` | `word` | word \| char | pop unit |
| `wordStagger` | `0.08` | 0–0.3 | delay between words |
| `amplitude` | `1.0` | 0.2–2 | elastic overshoot |
| `period` | `0.35` | 0.1–0.7 | spring period |
| `kick` | `6°` | 0–20 | rotation energy |

**Reference CSS sketch:**
```css
.word { display:inline-block; transform:scale(0); animation:pop .6s both cubic-bezier(.2,1.6,.3,1); }
.word:nth-child(n){ animation-delay: calc(var(--w)*.08s); }
@keyframes pop { to { transform:scale(1) } }
```

**Canvas/WebGL.** Pure transform — `perUnit[w].{scaleX,scaleY,rotate,opacity}`. No mask/overlay. Identical both paths.

**QA.** Scale overshoots >1 mid-animation then lands exactly at 1 (`p=1`); rotation decays to 0; word stagger visible; no residual rotation/scale at end.

---

## 9. `community/focus-blur-in`

**Source (confirm):** https://codepen.io/Muhammad-Ibrar-the-sans/pen/RNNwdqw · **Builds on:** Doc 06 `Blur in` + Doc 04 blur · **Slot:** `animation.in`

**Effect.** The whole title resolves from a soft, wide-tracked blur into a crisp, tight word — like a camera pulling focus.

**Mechanism.** Animate blur radius high→0 and letter-spacing wide→normal together, with a slight opacity ramp. Can be per-line or per-word.

**Math:**
```
q          = ease(p)
blurPx     = (1 − q) · maxBlur
tracking   = (1 − q) · maxTracking            // extra letter-spacing (em)
opacity    = lerp(startOpacity, 1, q)
scale      = lerp(1 + zoom, 1, q)             // optional subtle zoom-out
```

**Params:**
| name | default | range | note |
|---|---|---|---|
| `maxBlur` | `12px` | 2–40 | start blur |
| `maxTracking` | `0.4em` | 0–1.2em | start letter-spacing |
| `startOpacity` | `0` | 0–1 | start alpha |
| `zoom` | `0.06` | 0–0.3 | subtle scale settle |
| `unit` | `all` | all \| word | whole vs staggered |

**Reference CSS sketch:**
```css
.focus { filter:blur(12px); letter-spacing:.4em; opacity:0; animation:focus .8s both; }
@keyframes focus { to { filter:blur(0); letter-spacing:normal; opacity:1 } }
```

**Canvas/WebGL.** A layer-level Gaussian blur (reuse Doc 04 blur) driven by `blurPx`, plus a `letterSpacing` override fed back into `text-render` layout per frame (re-layout advances). For Indic, tracking adds inter-cluster space without breaking shaping.

**QA.** `p=1` ⇒ blur 0, normal spacing, opacity 1; monotonic sharpen; relayout stable (no glyph reflow jumps); Indic clusters stay intact while spacing animates.

---

## 10. `community/char-drop-tumble`

**Source (confirm):** https://codepen.io/11elevenpasteleven11/pen/xbOwgjg · **Builds on:** Doc 06 `in` + per-glyph stagger · **Slot:** `animation.in`

**Effect.** Letters fall in from above with a random tumble and settle into place — playful "dropping letters" entrance.

**Mechanism.** Per **cluster**, start above with a seeded random rotation/offset; ease down to the resting position with a small bounce.

**Math (per cluster `i`):**
```
pi      = clamp01((p − i·charStagger) / segment)
b       = easeOutBack(pi)                              // slight settle bounce
dy_i    = (1 − b) · (−dropHeight − rand(seed,i)·spread)
rot_i   = (1 − b) · randRot(seed,i)                    // ±maxRot, seeded
opacity = clamp01(pi·4)
```
`randRot(seed,i) ∈ [−maxRot, +maxRot]`; seeded so it's deterministic.

**Params:**
| name | default | range | note |
|---|---|---|---|
| `charStagger` | `0.04` | 0–0.15 | per-letter delay |
| `dropHeight` | `1.2em` | 0.3–3em | start height above |
| `spread` | `0.4em` | 0–1.5em | random extra height |
| `maxRot` | `40°` | 0–180 | tumble range |
| `seed` | `clipId` | — | determinism key |

**Reference CSS sketch:**
```css
.char { display:inline-block; transform:translateY(-1.2em) rotate(30deg); opacity:0;
        animation:drop .5s both cubic-bezier(.2,1.2,.3,1); }
.char:nth-child(n){ animation-delay: calc(var(--i)*.04s) }
@keyframes drop { to { transform:none; opacity:1 } }
```

**Canvas/WebGL.** Transform-only `perUnit[i].{dy,rotate,opacity}`, but randomness **must be seeded** `(clipId,i)` for export parity. Grapheme clusters drop as one unit.

**QA.** Deterministic for a seed; `p=1` all clusters at rest (dy 0, rot 0); stagger visible; Tamil/Indic clusters don't split.

---

## 11. `community/shimmer-gradient`

**Source (confirm):** https://codepen.io/dermalhealth/pen/YPybzva · **Builds on:** Doc 10 gradient fill (animated) · **Slot:** `animation.loop`

**Effect.** A multi-stop color gradient flows continuously through the text fill — an animated shimmer/holographic sweep (the fill itself is animated, not an overlay).

**Mechanism.** Reuse the gradient fill; animate its `position`/phase offset over time so the stops scroll across the glyph-clipped fill. (Distinct from `gloss-sweep`, which is a specular band over a solid fill.)

**Math:**
```
phase  = frac(t · speed)
// shift gradient stops by phase along `angle`, clipped to glyph alpha
offset = phase · gradientSpan
fill   = sampleGradient(stops, (u along angle) − offset)   // u in glyph space
```
For seamless looping, the stop list must be cyclic (first color == last).

**Params:**
| name | default | range | note |
|---|---|---|---|
| `stops` | brand gradient | — | ≥2 colors, cyclic |
| `angle` | `90°` | 0–360 | flow direction |
| `speed` | `0.5` | 0.05–3 | loops/sec |
| `scale` | `1.5` | 0.5–4 | gradient span vs text width |

**Reference CSS sketch:**
```css
.shimmer { background:linear-gradient(90deg,#f0f,#0ff,#ff0,#f0f); background-size:200% 100%;
           -webkit-background-clip:text; background-clip:text; color:transparent;
           animation:flow 3s linear infinite; }
@keyframes flow { to { background-position:200% 0 } }
```

**Canvas/WebGL.** Replaces the static fill with an animated gradient fill (`text.fill` of type gradient with a per-frame `offset`), masked by glyph alpha. Reuse the existing gradient-fill primitive (see `fillGradient`); only the offset is time-driven. Cyclic stops ⇒ seamless loop.

**QA.** Loop seamless at `frac` wrap (first==last color); gradient stays clipped to glyphs; `speed=0` ⇒ static gradient; readable contrast maintained.

---

## 12. `community/jelly-squash`

**Source (confirm):** https://codepen.io/tortaruga/pen/dPPwGzZ · **Builds on:** Doc 06 loop + non-uniform scale · **Slot:** `animation.loop` (or `in`)

**Effect.** Letters wobble with a gummy squash-and-stretch — bouncing jelly text that conserves volume (wide-and-short ↔ tall-and-thin).

**Mechanism.** Per cluster, drive a squash signal `s(t)`; set `scaleY = 1 + a·s`, `scaleX = 1 − a·s·ν` (volume-ish), anchored at the baseline so it squashes onto the line. Stagger phase per cluster for a travelling wobble.

**Math (per cluster `i`):**
```
s_i      = sin(2π·speed·t − phaseStep·i)
scaleY_i = 1 + amplitude · s_i
scaleX_i = 1 − amplitude · s_i · couple          // volume coupling
anchor   = baseline (transform-origin bottom-center)
dy_i     = squashSink · max(0, s_i)              // optional sink on squash
```

**Params:**
| name | default | range | note |
|---|---|---|---|
| `amplitude` | `0.18` | 0–0.5 | squash depth |
| `couple` | `0.7` | 0–1 | x/y volume coupling |
| `speed` | `1.2` | 0.2–4 | wobbles/sec |
| `phaseStep` | `0.5` | 0–2 | per-letter phase |
| `anchor` | `bottom` | bottom \| center | squash origin |

**Reference CSS sketch:**
```css
.jelly { display:inline-block; transform-origin:bottom center; animation:jelly 1s ease-in-out infinite; }
@keyframes jelly { 0%,100%{transform:scale(1,1)} 50%{transform:scale(.85,1.18)} }
```

**Canvas/WebGL.** Transform-only with **non-uniform scale + baseline transform-origin** per cluster. `perUnit[i].{scaleX,scaleY,dy}`. No mask. Ensure transform-origin is the cluster's baseline-center.

**QA.** Volume roughly conserved (x shrinks as y grows); loop continuous; anchored to baseline (letters don't float); Indic clusters squash as units.

---

## 13. `community/neon-flicker`

**Source (confirm):** https://codepen.io/sunny_thakor/pen/KKYZvZr · **Builds on:** Doc 04 glow/neon + seeded flicker · **Slot:** `animation.in` (then steady) or `loop`

**Effect.** A neon sign buzzes to life — the glow flickers erratically a few times, drops out, then holds steady with a faint pulsing hum.

**Mechanism.** Drive the Doc 04 neon/glow intensity with a seeded flicker envelope: scripted on/off blips during the startup window, then settle to a low-amplitude sine hum.

**Math:**
```
if p < startup:
   flick = flickerTable(seed, p)        // seeded 0/dim/full blips (deterministic)
   glow  = full · flick
else:
   glow  = full · (1 − humDepth·(0.5+0.5·sin(2π·humHz·t)))   // steady hum
emit  = glow                            // feeds neon bloom intensity + core brightness
```
`flickerTable` is a fixed seeded sequence so preview==export.

**Params:**
| name | default | range | note |
|---|---|---|---|
| `color` | `#19f6ff` | hex | neon hue |
| `startup` | `0.5` | 0.1–1 | flicker window (of `p`) |
| `humHz` | `0.6` | 0–3 | steady pulse |
| `humDepth` | `0.12` | 0–0.5 | pulse depth |
| `radius` | `0.5em` | 0.1–1.5em | bloom radius |
| `seed` | `clipId` | — | flicker determinism |

**Reference CSS sketch:**
```css
@keyframes flicker { 0%,19%,21%,55%,57%,100%{opacity:1} 20%,56%{opacity:.3} }
.neon { color:#fff; text-shadow:0 0 .25em #19f6ff,0 0 .5em #19f6ff; animation:flicker 2s both; }
```

**Canvas/WebGL.** Drives the Doc 04 neon effect's intensity per frame (bloom + core). **Seed the flicker sequence** so both render paths blink identically. No geometry change — purely emissive.

**QA.** Flicker sequence identical across runs (seeded); settles to steady hum after `startup`; `humDepth=0` ⇒ rock-steady; bloom clipped/composited like the Doc 04 neon.

---

## 14. `community/liquid-fill`

**Source (confirm):** https://codepen.io/KACTOPKA/pen/qBMeKeQ · **Builds on:** new vertical-wave alpha mask + glyph fill · **Slot:** `animation.in` (or `loop`)

**Effect.** Color floods up into the letters like liquid filling a glass — a wavy fluid surface rises through the glyphs, empty (outline/dim) above, filled (solid/bright) below.

**Mechanism.** A per-frame fill **level** rises 0→1; the boundary is a sine surface. Pixels below the wavy line use the fill color, above use the empty style (outline-only / low-alpha). Implemented as an alpha mask over a "filled" layer composited above an "empty" layer.

**Math:**
```
level   = ease(p)                                    // 0 (empty) → 1 (full)
surfaceY(x) = textBottom − level·textHeight + waveAmp·sin(2π·x/waveLen + 2π·waveSpeed·t)
filledMask(x,y) = y > surfaceY(x) ? 1 : 0            // below surface = filled
out = empty·(1−filledMask) + filled·filledMask        // both glyph-clipped
```

**Params:**
| name | default | range | note |
|---|---|---|---|
| `fillColor` | `#19a0ff` | hex | liquid color |
| `emptyStyle` | `outline` | outline \| dim | above-surface look |
| `waveAmp` | `0.06em` | 0–0.3em | surface ripple |
| `waveLen` | `1.5em` | 0.3–4em | ripple wavelength |
| `waveSpeed` | `0.6` | 0–3 | surface motion |
| `mode` | `in` | in \| loop | fill once vs slosh |

**Reference (SVG/clip intuition):**
```
two glyph-clipped layers (filled / empty) + an animated wavy clip-path boundary
rising over time; the wave is a sampled sine path.
```

**Canvas/WebGL.** New mechanic: build a **wavy horizontal alpha mask** (the liquid surface) and composite a filled glyph layer below it over an empty (outline) glyph layer, all clipped to glyph alpha. Returns `overlays:[filled, empty]` + the dynamic surface `mask`. Wave is analytic (no randomness) ⇒ parity automatic.

**QA.** `p=0` empty, `p=1` fully filled; surface ripples and is clipped to glyphs; empty region shows outline/dim; loop (if `loop`) continuous at wave wrap.

---

## 15. `community/particle-assemble`

**Source (confirm):** https://codepen.io/dotonion/pen/MWmMJXz · **Builds on:** new particle system → glyph sample points · **Slot:** `animation.in`

**Effect.** Letters materialize from a cloud of scattered dots/particles that fly in and snap into the glyph shapes (assemble/converge); reverse = disperse.

**Mechanism.** Sample each glyph's fill into target points; spawn each particle at a seeded scattered start; interpolate start→target with eased, staggered timing; fade the solid glyph in as particles arrive (or keep pure particles).

**Math (per particle `j` with target `T_j`):**
```
S_j     = T_j + scatter·unitVec(rand(seed,j))·(0.5+rand(seed,j))   // seeded start
pj      = clamp01((p − delay(seed,j)) / segment)
pos_j   = lerp(S_j, T_j, easeOutCubic(pj))
size_j  = lerp(startSize, dotSize, pj)
glyphAlpha = smoothstep(revealStart, 1, p)        // optional solidify at the end
```

**Params:**
| name | default | range | note |
|---|---|---|---|
| `density` | `1` | 0.3–3 | particles per area |
| `scatter` | `2.5em` | 0.5–8em | start spread |
| `dotSize` | `2px` | 1–6 | particle size |
| `converge` | `0.8` | 0.3–1.5 | assemble duration share |
| `solidify` | `true` | bool | fade solid glyph at end |
| `seed` | `clipId` | — | determinism key |

**Reference (canvas intuition):**
```
sample glyph fill → target points; each particle lerps from a random start to its
target with a staggered ease; draw dots; optionally cross-fade to the solid glyph.
```

**Canvas/WebGL.** **Heaviest new mechanic** — a particle layer. Sample glyph fill to target points (cache per text/clip), spawn seeded particles, integrate per frame on the GPU/2D. **Fully seeded** so export matches. Returns an `overlays` particle layer (+ optional solidifying glyph layer). Budget particle count for long captions.

**QA.** Deterministic for a seed; at `p=1` particles coincide with glyph shapes (and solid glyph shown if `solidify`); performance within budget for many clusters; disperse = same in reverse.

---

## 16. `community/perspective-slam`

**Source (confirm):** https://codepen.io/jpbelley/pen/JjjeQZp · **Builds on:** `kinetic-3d` primitive (§4) + motion blur · **Slot:** `animation.in`

**Effect.** A bold title slams toward the camera — flies in from deep Z with perspective + slight skew, overshoots, and snaps to place with a motion-blur streak (impactful kinetic title).

**Mechanism.** Reuse the 3D per-letter transform: animate `translateZ` from far→0 with `rotateX/skew` easing out (back/overshoot), and ramp a directional blur that decays as it lands. Can hit per-word for a staccato slam.

**Math (per word/line `w`):**
```
pw      = clamp01((p − w·slamStagger)/segment)
e       = easeOutBack(pw, overshoot)
z_w     = (1 − e) · startZ                          // deep → 0
rotX_w  = (1 − e) · startRotX
skew_w  = (1 − e) · startSkew
blur_w  = (1 − ease(pw)) · maxBlur                  // motion streak decays
opacity = clamp01(pw·3)
```

**Params:**
| name | default | range | note |
|---|---|---|---|
| `unit` | `word` | word \| line \| all | slam grouping |
| `startZ` | `-800px` | -200…-2000 | start depth |
| `startRotX` | `35°` | 0–80 | incoming tilt |
| `startSkew` | `8°` | 0–25 | shear energy |
| `overshoot` | `1.2` | 1–2 | back-ease overshoot |
| `maxBlur` | `8px` | 0–24 | motion streak |
| `slamStagger` | `0.06` | 0–0.25 | per-unit delay |

**Reference CSS sketch:**
```css
.slam { perspective:800px }
.word { transform:translateZ(-800px) rotateX(35deg); filter:blur(8px); opacity:0;
        animation:slam .5s both cubic-bezier(.2,1.4,.3,1) }
@keyframes slam { to { transform:none; filter:blur(0); opacity:1 } }
```

**Canvas/WebGL.** Reuse §4 `kinetic-3d` (real perspective matrix, WebGL authoritative) + a directional blur from Doc 04 that decays to 0. `perUnit` 3D transform + per-unit `blur` over the entrance.

**QA.** Lands at identity (`p=1`: z 0, rot 0, skew 0, blur 0); overshoot visible; per-unit slam stagger; WebGL/2D-fallback agree within threshold.

---

## 17. `community/variable-weight-wave`

**Source (confirm):** https://codepen.io/devinargenta/pen/BNOoVv · **Builds on:** new variable-font axis animation in `text-render` · **Slot:** `animation.loop` (or `in`)

**Effect.** A wave of **font weight/width** travels across the text — letters thicken and thin (and optionally stretch/slant) in sequence, morphing the glyph outlines themselves via variable-font axes.

**Mechanism.** Animate `font-variation-settings` per cluster (`wght`, optionally `wdth`/`slnt`) with a travelling sine phase. This morphs outlines (not a transform), so it needs variable-font support in shaping for both preview and export.

**Math (per cluster `i`):**
```
ph     = 2π·speed·t − phaseStep·i
wght_i = mid(wghtMin,wghtMax) + amp(wght)·sin(ph)
wdth_i = mid(wdthMin,wdthMax) + amp(wdth)·sin(ph + wdthLag)
// re-shape cluster i with font-variation-settings { wght:wght_i, wdth:wdth_i }
```
For an `in` variant, sweep weight `wghtMin→rest` once across the line.

**Params:**
| name | default | range | note |
|---|---|---|---|
| `wghtMin` | `200` | 1–1000 | light end |
| `wghtMax` | `800` | 1–1000 | bold end |
| `wdthMin` | `100` | 50–200 | optional width |
| `wdthMax` | `100` | 50–200 | set ≠min to morph width |
| `speed` | `0.7` | 0.1–3 | wave speed |
| `phaseStep` | `0.6` | 0–2 | per-cluster phase |

**Reference CSS sketch:**
```css
.vf { font-variation-settings:"wght" 400; animation:weight 2s ease-in-out infinite }
.vf span:nth-child(n){ animation-delay: calc(var(--i)*-.08s) }
@keyframes weight { 0%,100%{font-variation-settings:"wght" 200} 50%{font-variation-settings:"wght" 800} }
```

**Canvas/WebGL.** **New text-render capability:** per-cluster variable-font variation, re-shaped each frame with the same axis values in preview and **headless export** (HarfBuzz variable-font instancing). Requires the bundled font to expose the axes; degrade to a faux-bold scale if not variable. No randomness ⇒ parity automatic once shaping matches.

**QA.** Requires a variable font with `wght` (and `wdth` if used); weight wave travels across `i`; preview and export shape identically at sampled axis values; non-variable fonts fall back gracefully; Indic clusters re-shape correctly.

---

## Shared reference

**Defaults & easing.** One-shot presets default to `ease = easeOutCubic`; loops use linear or sinusoidal time. Duration/speed come from the standard `animation.in.duration` / `animation.loop.speed` fields — no new schema.

**Registry.** All presets register as `"community/<id>"` into the existing animation (Doc 06) and reveal (Doc 15) registries; selection persists through `clips[].animation.{in|loop|reveal}` (see Doc 17 — no schema change).

**New engine capabilities introduced here** (track during build):
- per-unit **3D rotation + perspective** with a Canvas-2D fallback (`kinetic-3d`, `perspective-slam`);
- per-frame **`glyphOverride` content substitution** + seeded PRNG (`scramble-decode`);
- per-frame **letterSpacing relayout** (`focus-blur-in`);
- **animated gradient fill** offset, glyph-clipped (`shimmer-gradient`);
- **non-uniform scale with baseline origin** (`jelly-squash`);
- seeded **emissive flicker** envelope over the Doc 04 neon (`neon-flicker`);
- **wavy alpha-mask fill surface** compositing filled/empty glyph layers (`liquid-fill`);
- a seeded **particle system** sampling glyph fill to target points (`particle-assemble`);
- per-cluster **variable-font axis animation** re-shaped identically preview↔export (`variable-weight-wave`).

**Parity matrix (preview ↔ export):**
| preset | output kind | randomness | special |
|---|---|---|---|
| wave-ripple | transform | none | — |
| glitch-split | overlays/blend | seeded/frame | reuse Doc 04 |
| typewriter-caret | mask + caret | none | grapheme step |
| kinetic-3d | transform 3D | none | WebGL authoritative |
| scramble-decode | content override | seeded/(i,tick) | reserve advance width |
| gloss-sweep | overlay/mask | none | reuse Doc 15 |
| mask-line-rise | transform + mask | none | per-line clip band |
| elastic-word-pop | transform | none | elastic overshoot |
| focus-blur-in | blur + relayout | none | letterSpacing animates |
| char-drop-tumble | transform | seeded/(i) | clusters drop as units |
| shimmer-gradient | animated fill | none | cyclic stops = seamless |
| jelly-squash | transform (non-uniform) | none | baseline origin |
| neon-flicker | emissive | seeded sequence | reuse Doc 04 neon |
| liquid-fill | overlays + dynamic mask | none | analytic wave surface |
| particle-assemble | particle overlay | seeded/(j) | perf budget |
| perspective-slam | transform 3D + blur | none | reuse kinetic-3d |
| variable-weight-wave | outline morph | none | variable-font axes |

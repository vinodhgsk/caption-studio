/**
 * The CANONICAL per-token text painting pipeline (P6.15 — Doc 10; skill
 * `text-render`).
 *
 * ONE ordered sequence of canvas passes, used by EVERY draw branch in
 * `PreviewCanvas.drawTextClips` (straight line, curved/arc per-cluster, per-word
 * cue/wipe/character/wholeWord, active-word highlight) AND by the thumbnail
 * renderer (`captionTextRender.drawPresetCaption`). Factoring the order into this
 * single function eliminates the per-branch divergence that used to let one branch
 * drift out of order from another, and gives Phase 7 effects a single, documented
 * insertion point that composes in the right place WITHOUT any reordering.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CANONICAL PAINT ORDER (back → front), locked by P6.15:
 *
 *   1. SHADOW (behind the glyph)   — drop / long shadow cast as a dedicated
 *                                    pre-pass, then the canvas `shadow*` is CLEARED
 *                                    so no later pass casts a second shadow.
 *                                    (inner shadow is NOT cast here — see pass 4.)
 *   2. STROKE layers (outside-in)  — WIDEST layer first so each thinner ring stacks
 *                                    ON TOP, framing the glyph (P6.10/P6.11).
 *   3. FILL (glyph body)           — solid / gradient / per-word color, painted
 *                                    ON TOP of the stroke. Skipped when HOLLOW
 *                                    (P6.12 — outline-only body).
 *   4. INNER shadow (over body)    — an inner shadow lives INSIDE the glyph, so it
 *                                    paints AFTER the fill. No-op for drop/long.
 *                                    Suppressed when hollow (no body to carve).
 *   5. EFFECTS  ← Phase 7 hook     — glow / neon / glitch / 3d / retro / blur / echo
 *                                    (docs/04) compose HERE, after the glyph is
 *                                    fully painted (shadow+stroke+fill+inner) and
 *                                    before the active-word highlight overlay.
 *                                    Today this is a NO-OP placeholder
 *                                    ({@link runEffectsHook}); Phase 7 fills it in
 *                                    with NO change to this order.
 *   6. HIGHLIGHT overlay           — the active-word karaoke/highlight color/scale/
 *                                    wipe sits LAST, on top of everything, so the
 *                                    active word reads above its own effects.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY "stroke UNDER fill" and not the runbook's literal "fill → stroke":
 *
 * The P6.15 runbook NAMES the order "shadow → fill → stroke → effects". That label
 * is the CONCEPTUAL layer list (shadow behind, body, outline, decoration). But
 * P6.10/P6.11 deliberately paint the STROKE FIRST and the FILL ON TOP so the
 * outline FRAMES the glyph (a stroke painted over the fill would eat into the glyph
 * body and hide half the outline); the milestone tests assert that widest-first
 * stroke-then-fill look. Painting the canvas ops as literal "fill then stroke"
 * would break that established visual AND those passing tests.
 *
 * RECONCILIATION (the decision this module encodes): we treat the runbook label as
 * the conceptual list and implement the CORRECT, CONSISTENT canvas pass order —
 * SHADOW → STROKE (outside-in) → FILL → INNER-SHADOW → EFFECTS → HIGHLIGHT — once,
 * here, and make every branch + the thumbnail follow it identically. "Stroke under
 * fill" is the canonical canvas order; the runbook's "fill before stroke" is the
 * layer-naming order. They describe the same picture.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PURE-ish + headless-safe: this module only SETS thin canvas properties and issues
 * fill/stroke text ops a stubbed ctx accepts (no DOM, no pixels read back). The
 * unit tests drive it with a recording ctx that logs the op sequence.
 */
import {
  applyDropShadow,
  clearShadow,
  longShadowLength,
  longShadowSteps,
  LONG_SHADOW_STEP_PX,
  type ResolvedTextShadow
} from './textShadowSpec'
import { applyStrokeLayer, type ResolvedTextStroke } from './textStrokeSpec'

/**
 * A drawable token (a whole line, a word, an arc cluster, or a wipe half) plus the
 * canvas position it paints at. `text`/`x`/`y` feed `fillText`/`strokeText`.
 */
export interface GlyphToken {
  text: string
  x: number
  y: number
}

/**
 * Inputs to a single run of the canonical pipeline. `shadow`/`stroke` may be null
 * (no shadow / no stroke); `fill` is invoked to paint the body unless `hollow`.
 */
export interface PaintGlyphArgs {
  ctx: CanvasRenderingContext2D
  /** The token (text + position) every pass paints. */
  token: GlyphToken
  /** Resolved shadow, or null for none. Drop/long cast behind; inner over the body. */
  shadow: ResolvedTextShadow | null
  /** Resolved stroke, or null for none. Layers are WIDEST-first already. */
  stroke: ResolvedTextStroke | null
  /**
   * Paint the glyph BODY (the FILL pass). The caller owns the exact fill (it may set
   * `ctx.fillStyle` to a solid, a gradient, a per-word run color, or the active-word
   * highlight color before/inside this callback). Called with the same token so the
   * body registers under the inner shadow. NOT called when the stroke is hollow.
   */
  fill: (ctx: CanvasRenderingContext2D, token: GlyphToken) => void
  /**
   * Phase 7 EFFECTS hook (pass 5). Optional; when omitted the pipeline runs the
   * built-in {@link runEffectsHook} no-op. Composes AFTER the glyph is fully painted
   * (shadow+stroke+fill+inner) and BEFORE the highlight overlay.
   */
  effects?: EffectsPass
  /**
   * The active-word HIGHLIGHT overlay (pass 6), painted LAST. Optional; most tokens
   * have no highlight. The caller owns what it draws (e.g. a karaoke color swap).
   */
  highlight?: (ctx: CanvasRenderingContext2D, token: GlyphToken) => void
}

/**
 * Phase 7 EFFECTS pass signature. An effect receives the live ctx + the token it
 * decorates and the resolved shadow/stroke (so e.g. a glow can match the outline).
 * Phase 7 will register concrete effects (glow/neon/glitch/3d/retro/blur/echo);
 * until then the pipeline runs {@link NO_EFFECTS} (a no-op).
 */
export type EffectsPass = (
  ctx: CanvasRenderingContext2D,
  token: GlyphToken,
  context: { shadow: ResolvedTextShadow | null; stroke: ResolvedTextStroke | null }
) => void

/**
 * The Phase 7 effects insertion point — a NO-OP for now. Phase 7 (docs/04) replaces
 * the body with the composed effect chain (glow/neon/glitch/3d/retro/blur/echo).
 * Keeping a named, exported hook here means effects slot into pass 5 of the
 * canonical order with NO reordering of the surrounding shadow/stroke/fill passes.
 */
export const NO_EFFECTS: EffectsPass = () => {
  /* Phase 7 effects compose here (pass 5). Intentionally empty for P6.15. */
}

/**
 * Run the effects pass (pass 5). Today this dispatches to the supplied `effects`
 * callback or the built-in {@link NO_EFFECTS} no-op. Phase 7 swaps the default for
 * the real effect chain; the call SITE (here, after fill+inner, before highlight)
 * never moves.
 */
export function runEffectsHook(
  ctx: CanvasRenderingContext2D,
  token: GlyphToken,
  context: { shadow: ResolvedTextShadow | null; stroke: ResolvedTextStroke | null },
  effects?: EffectsPass
): void {
  ;(effects ?? NO_EFFECTS)(ctx, token, context)
}

// ───────────────────────────────────────────────────────────────────────────
// Pass 1 — SHADOW (behind the glyph): drop / long. Inner is deferred to pass 4.
// ───────────────────────────────────────────────────────────────────────────

/**
 * PASS 1 — cast the BEHIND-glyph shadow (drop/long) as a dedicated pre-pass, then
 * leave the canvas `shadow*` CLEARED so passes 2–6 cast NO further shadow (the glyph
 * casts exactly ONE shadow regardless of how many stroke/fill ops follow).
 *
 * `drop`: set `ctx.shadow*` and paint the OUTERMOST silhouette (the widest stroke
 *   layer when there is a stroke, else the body) in a fully TRANSPARENT paint so only
 *   the soft offset/blurred shadow lands; then clear.
 * `long`: a flat trail of SOLID offset copies along the angle (crisp, no `shadow*`).
 * `inner`: a NO-OP here — an inner shadow paints OVER the body, in pass 4.
 */
export function shadowBehindPass(
  ctx: CanvasRenderingContext2D,
  shadow: ResolvedTextShadow,
  stroke: ResolvedTextStroke | null,
  token: GlyphToken
): void {
  if (token.text.length === 0) return
  if (shadow.kind === 'long') {
    longShadowBehind(ctx, shadow, token)
  } else if (shadow.kind === 'inner') {
    /* inner shadow paints AFTER the fill — see innerShadowOverPass (pass 4) */
  } else {
    dropShadowBehind(ctx, shadow, stroke, token)
  }
}

/**
 * DROP shadow (P6.13): set the canvas `shadow*` and paint the OUTERMOST silhouette in
 * a fully transparent paint so ONLY the soft offset/blurred shadow lands, then clear.
 */
function dropShadowBehind(
  ctx: CanvasRenderingContext2D,
  shadow: ResolvedTextShadow,
  stroke: ResolvedTextStroke | null,
  token: GlyphToken
): void {
  ctx.save()
  applyDropShadow(ctx, shadow)
  if (stroke !== null && stroke.layers.length > 0) {
    const widest = stroke.layers[0] // resolver sorts WIDEST-first
    ctx.strokeStyle = 'rgba(0, 0, 0, 0)'
    ctx.lineWidth = widest.width
    ctx.lineJoin = 'round'
    ctx.miterLimit = 2
    ctx.strokeText(token.text, token.x, token.y)
  } else {
    ctx.fillStyle = 'rgba(0, 0, 0, 0)'
    ctx.fillText(token.text, token.x, token.y)
  }
  ctx.restore()
  clearShadow(ctx)
}

/**
 * LONG (extruded) shadow (P6.14): a flat trail of SOLID copies of the glyph nudged
 * along the angle. {@link longShadowSteps} owns the geometry (farthest-first); we
 * just `fillText` a solid copy at each offset, back-to-front, in the shadow color.
 */
function longShadowBehind(
  ctx: CanvasRenderingContext2D,
  shadow: ResolvedTextShadow,
  token: GlyphToken
): void {
  const steps = longShadowSteps(
    shadow.angleDeg,
    longShadowLength(shadow.distance),
    LONG_SHADOW_STEP_PX
  )
  if (steps.length === 0) return
  ctx.save()
  clearShadow(ctx) // crisp solids — make sure no stale blur leaks in
  ctx.fillStyle = shadow.color
  for (const s of steps) ctx.fillText(token.text, token.x + s.x, token.y + s.y)
  ctx.restore()
  clearShadow(ctx)
}

// ───────────────────────────────────────────────────────────────────────────
// Pass 2 — STROKE layers (outside-in: WIDEST first → thinner rings on top).
// ───────────────────────────────────────────────────────────────────────────

/**
 * PASS 2 — paint the STROKE layers UNDER the fill. Layers are WIDEST-first already,
 * so painting in order stacks a thinner ring ON TOP (P6.11) and a single layer just
 * frames the glyph (P6.10). A no-layer/empty stroke is a cheap no-op.
 */
export function strokePass(
  ctx: CanvasRenderingContext2D,
  stroke: ResolvedTextStroke | null,
  token: GlyphToken
): void {
  if (stroke === null || stroke.layers.length === 0 || token.text.length === 0) return
  for (const layer of stroke.layers) {
    applyStrokeLayer(ctx, layer)
    ctx.strokeText(token.text, token.x, token.y)
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Pass 4 — INNER shadow (over the glyph body). Drop/long are no-ops here.
// ───────────────────────────────────────────────────────────────────────────

/**
 * PASS 4 — paint the INNER shadow OVER the glyph body (it sits INSIDE the glyph, so
 * it must come AFTER the fill). For drop/long this is a no-op (cast behind in pass 1).
 *
 * Standard canvas inner-shadow technique:
 *   1. Paint the glyph body SOLID in the shadow color → a shadow-colored mask.
 *   2. `globalCompositeOperation = 'source-atop'` clips further paint to the body.
 *   3. With `ctx.shadow*` set, draw the SAME glyph OFFSET; under source-atop the
 *      opaque copy is kept only inside the body and its blurred shadow lands on the
 *      far inner edge → the inner shadow.
 * Wrapped in save/restore; {@link clearShadow} on exit upholds the cleared contract.
 */
export function innerShadowOverPass(
  ctx: CanvasRenderingContext2D,
  shadow: ResolvedTextShadow,
  token: GlyphToken
): void {
  if (token.text.length === 0 || shadow.kind !== 'inner') return
  const prevComposite = ctx.globalCompositeOperation
  ctx.save()
  ctx.fillStyle = shadow.color
  ctx.fillText(token.text, token.x, token.y)
  ctx.globalCompositeOperation = 'source-atop'
  applyDropShadow(ctx, shadow)
  ctx.shadowOffsetX = shadow.offset.x
  ctx.shadowOffsetY = shadow.offset.y
  ctx.fillStyle = shadow.color
  ctx.fillText(token.text, token.x + shadow.offset.x, token.y + shadow.offset.y)
  ctx.restore()
  ctx.globalCompositeOperation = prevComposite
  clearShadow(ctx)
}

// ───────────────────────────────────────────────────────────────────────────
// The pipeline — run all passes in the canonical order for one token.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Paint ONE token through the canonical pipeline (passes 1–6, in order). Used by
 * every PreviewCanvas branch and the thumbnail so the order is locked in exactly
 * one place.
 *
 *   1. shadow behind   (drop/long)         — {@link shadowBehindPass}
 *   2. stroke layers   (outside-in)        — {@link strokePass}
 *   3. fill body                            — args.fill (skipped when hollow)
 *   4. inner shadow    (over body)         — {@link innerShadowOverPass}
 *   5. effects hook    (Phase 7)           — {@link runEffectsHook}
 *   6. highlight overlay (active word)     — args.highlight
 *
 * The fill is SKIPPED when the stroke is hollow (P6.12 — outline-only body); the
 * inner shadow is likewise suppressed when hollow (no body to carve a shadow into).
 */
export function paintGlyphPasses(args: PaintGlyphArgs): void {
  const { ctx, token, shadow, stroke, fill, effects, highlight } = args
  if (token.text.length === 0) return
  const hollow = stroke?.hollow === true

  // 1. SHADOW behind (drop/long). Clears ctx.shadow* on exit so 2–6 cast none.
  if (shadow !== null) shadowBehindPass(ctx, shadow, stroke, token)

  // 2. STROKE layers, outside-in (widest first → thinner rings on top).
  strokePass(ctx, stroke, token)

  // 3. FILL the glyph body (on top of the stroke). Hollow → outline only, no fill.
  if (!hollow) fill(ctx, token)

  // 4. INNER shadow over the body (no-op for drop/long; suppressed when hollow).
  if (shadow !== null && !hollow) innerShadowOverPass(ctx, shadow, token)

  // 5. EFFECTS hook — Phase 7 composes here (no-op today).
  runEffectsHook(ctx, token, { shadow, stroke }, effects)

  // 6. HIGHLIGHT overlay — the active-word color/scale/wipe sits LAST, on top.
  if (highlight !== undefined) highlight(ctx, token)
}

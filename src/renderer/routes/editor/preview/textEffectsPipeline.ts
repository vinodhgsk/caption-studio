/**
 * The composable TEXT-EFFECTS pipeline (P7.1 — Doc 04; skill `text-render`).
 *
 * This is the RENDER side of the {@link TextEffect} data model
 * (`shared/textEffect`). It owns:
 *   1. {@link EffectRenderer} — the interface a single effect type implements to
 *      PAINT over the base glyph layer (a thin canvas function).
 *   2. an effect REGISTRY ({@link registerEffectRenderer} / {@link getEffectRenderer})
 *      keyed by `type`, so P7.2–P7.6 each register ONE renderer and the pipeline
 *      dispatches by `type` with no central switch.
 *   3. {@link composeEffectsPass} — builds the {@link EffectsPass} the canonical
 *      paint pipeline (`textPaintPipeline`, pass 5 / P6.15) runs, applying the
 *      clip's ORDERED, enabled effects in array order over the painted glyph.
 *
 * WHERE IT HOOKS IN: `PreviewCanvas.drawTextClips` (and the thumbnail / export)
 * resolve a clip's `text.effects[]` once per clip, build the pass with
 * {@link composeEffectsPass}, and pass it to `paintGlyphPasses({ effects })`. The
 * pipeline runs it at the EFFECTS step — AFTER shadow+stroke+fill+inner, BEFORE the
 * highlight overlay — so effects compose in exactly the locked place with NO
 * reordering of the surrounding passes.
 *
 * EXPORT PARITY (master plan §6): the export path resolves `clip.text.effects` with
 * the SAME `normalizeTextEffects` (shared) and runs the SAME `composeEffectsPass`
 * against its (headless) canvas through `paintGlyphPasses`. Because both the schema
 * (shared) and the registry (this module, imported by both preview and the engine)
 * are process-agnostic — no DOM beyond the `CanvasRenderingContext2D` ops — the same
 * effect stack produces the same pixels in preview and export. P7.2–P7.6 register
 * their renderers in a module both sides import (a shared `registerBuiltinEffects()`)
 * so neither side can drift in which effects exist.
 *
 * COMPOSABILITY CONTRACT: an effect renderer paints over the CURRENT canvas and must
 * leave the context in a state the NEXT effect (and the highlight overlay) can paint
 * on cleanly. The pipeline wraps EACH effect in `ctx.save()/ctx.restore()` and applies
 * the effect's master `opacity` as `globalAlpha` for it, so a renderer only has to
 * draw its look — it never has to undo its own state for the next effect.
 *
 * BACKWARD COMPATIBLE: an empty/absent effect stack → {@link composeEffectsPass}
 * returns `undefined`, so `paintGlyphPasses` runs its built-in NO_EFFECTS no-op and
 * the output is byte-identical to pre-P7.1 (existing tests stay green).
 */
import type { TextEffect, TextEffectType } from '../../../../shared/textEffect'
import type { EffectsPass, GlyphToken } from './textPaintPipeline'
import type { ResolvedTextShadow } from './textShadowSpec'
import type { ResolvedTextStroke } from './textStrokeSpec'

/**
 * The context an {@link EffectRenderer} receives alongside the live ctx + token:
 * the resolved shadow/stroke of the glyph (so e.g. a glow can match the outline
 * geometry), plus the effect's own master `intensity` (already read off the
 * effect; passed through so a renderer scales its look without re-reading the base).
 */
export interface EffectRenderContext {
  /** The resolved drop/inner/long shadow of the base glyph, or null. */
  shadow: ResolvedTextShadow | null
  /** The resolved (widest-first) stroke of the base glyph, or null. */
  stroke: ResolvedTextStroke | null
  /** The effect's master strength 0..1 (its `intensity`), surfaced for convenience. */
  intensity: number
}

/**
 * A single effect type's RENDERER. Given the live canvas, the token it decorates,
 * the effect's `params` (already validated for this `type`), and the render context,
 * it PAINTS the effect's look over the current canvas.
 *
 * Contract:
 *   - The pipeline has ALREADY `ctx.save()`d and set `ctx.globalAlpha` to the
 *     effect's `opacity` before calling, and will `ctx.restore()` after — so a
 *     renderer does NOT need to save/restore for its OWN opacity. (It SHOULD still
 *     save/restore around its own composite/filter changes if it wants them scoped.)
 *   - It must not assume any state beyond a standard text context (font/baseline are
 *     set by the caller before the whole pipeline runs).
 *   - PURE-ish: only canvas side-effects; no DOM, no pixel readback required for the
 *     headless engine (renderers needing readback must degrade gracefully).
 *
 * `P` is the params shape for the renderer's type (so a registered renderer is
 * typed against its own params).
 */
export type EffectRenderer<P = unknown> = (
  ctx: CanvasRenderingContext2D,
  token: GlyphToken,
  params: P,
  context: EffectRenderContext
) => void

// ---------------------------------------------------------------------------
// Registry — type → renderer. P7.2–P7.6 register their renderer here.
// ---------------------------------------------------------------------------

const REGISTRY = new Map<TextEffectType, EffectRenderer<never>>()

/**
 * Register the renderer for an effect `type`. P7.2–P7.6 call this at module load
 * (glow/neon, glitch, 3d/retro/blur/echo). Re-registering a type OVERWRITES the
 * prior renderer (last registration wins) — handy for tests that swap in a stub.
 * Returns nothing; the registry is a process-global single source of truth.
 */
export function registerEffectRenderer<T extends TextEffectType>(
  type: T,
  renderer: EffectRenderer<Extract<TextEffect, { type: T }>['params']>
): void {
  REGISTRY.set(type, renderer as unknown as EffectRenderer<never>)
}

/** Look up the renderer for `type`, or `undefined` when none is registered. */
export function getEffectRenderer(type: TextEffectType): EffectRenderer<never> | undefined {
  return REGISTRY.get(type)
}

/** True when a renderer is registered for `type`. */
export function hasEffectRenderer(type: TextEffectType): boolean {
  return REGISTRY.has(type)
}

/** Remove a type's renderer (test isolation / hot-swap). */
export function unregisterEffectRenderer(type: TextEffectType): void {
  REGISTRY.delete(type)
}

/** Every currently-registered effect type (insertion order). For tests/diagnostics. */
export function registeredEffectTypes(): TextEffectType[] {
  return [...REGISTRY.keys()]
}

// ---------------------------------------------------------------------------
// Dispatch one effect + compose the ordered stack into an EffectsPass.
// ---------------------------------------------------------------------------

/**
 * Render ONE effect over the current canvas (a single step of the stack). Skips a
 * disabled effect, an effect with zero intensity AND zero opacity (it contributes
 * nothing), and an effect whose `type` has no registered renderer (so an unknown /
 * not-yet-implemented effect is a safe no-op rather than a crash). Wraps the
 * renderer in save/restore + applies the effect's master `opacity` as `globalAlpha`.
 * PURE except for the canvas side-effects of the renderer it dispatches.
 */
export function renderOneEffect(
  ctx: CanvasRenderingContext2D,
  token: GlyphToken,
  effect: TextEffect,
  context: { shadow: ResolvedTextShadow | null; stroke: ResolvedTextStroke | null }
): void {
  if (!effect.enabled) return
  if (effect.opacity <= 0) return
  const renderer = REGISTRY.get(effect.type)
  if (renderer === undefined) return
  ctx.save()
  ctx.globalAlpha = ctx.globalAlpha * effect.opacity
  renderer(ctx, token, effect.params as never, {
    shadow: context.shadow,
    stroke: context.stroke,
    intensity: effect.intensity
  })
  ctx.restore()
}

/**
 * Compose an ORDERED, already-normalized effect stack into the {@link EffectsPass}
 * the canonical pipeline runs at pass 5. The returned pass applies each enabled
 * effect IN ARRAY ORDER (`effects[0]` first → `effects[n-1]` last) over the painted
 * glyph via {@link renderOneEffect}.
 *
 * Returns `undefined` when there is NOTHING to do — no effects, or every effect is
 * disabled / transparent / has no registered renderer. `paintGlyphPasses` then runs
 * its built-in no-op, so the output is identical to pre-P7.1 (backward compatible).
 * Returning a callback ONLY when there is real work keeps the no-effects path free.
 */
export function composeEffectsPass(effects: readonly TextEffect[]): EffectsPass | undefined {
  // Keep only effects that could actually paint: enabled, non-transparent, and
  // (so the pass is truly empty when nothing is implemented yet) backed by a
  // registered renderer. Order is preserved verbatim.
  const active = effects.filter(
    (e) => e.enabled && e.opacity > 0 && REGISTRY.has(e.type)
  )
  if (active.length === 0) return undefined
  return (ctx, token, context) => {
    for (const effect of active) renderOneEffect(ctx, token, effect, context)
  }
}

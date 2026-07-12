/**
 * Caption positioning math (P5.8 — Doc 03 caption styles; skills `text-render`
 * + `preview-compositor`).
 *
 * Turns a layout ANCHOR (`lower-third` | `center` | `custom` | `top`) plus the
 * project's ASPECT / canvas resolution plus a per-aspect SAFE-MARGIN spec into
 * the pixel `transform.y` offset the compositor consumes (Doc 00 §4 — the
 * compositor draws a clip at `translateY = height/2 + transform.y`, so the
 * caption-block y is a signed offset from the frame CENTER in canvas pixels).
 *
 * WHY A SEPARATE PIXEL LAYER
 * --------------------------
 * `captionPreset.resolveLayoutY` returns an aspect-NEUTRAL NORMALIZED offset
 * (fraction of frame height from center: lower-third = +0.35, center = 0,
 * top = -0.35, or the preset's explicit `layout.y` for `custom`). That fraction
 * is reused VERBATIM here (we do NOT reinvent the anchor table) and converted to
 * canvas pixels for the CURRENT resolution, then CLAMPED so the caption BLOCK
 * (whose height we know) never crosses the title-safe margins. Different aspects
 * have different safe areas (a 9:16 phone reel keeps more bottom room for the
 * platform UI than a 16:9 frame), so the clamp is aspect-aware.
 *
 * Headless-safe: pure types + pure functions ONLY. NO electron / node / DOM /
 * crypto / Date — so the renderer (Captions panel, preview) AND a node/vitest
 * engine AND the export path all import this identically (master plan §6 parity).
 */
import type { Aspect } from '../renderer/routes/home/aspect'
import type { LayoutAnchor, PresetLayout } from './captionPreset'
import { resolveLayoutY } from './captionPreset'

// ---------------------------------------------------------------------------
// Safe-margin spec (per aspect)
// ---------------------------------------------------------------------------

/**
 * Title-safe insets as FRACTIONS of the frame's own width/height (0..0.5 each
 * edge). A caption block must stay fully inside the rectangle these insets carve
 * out. Stored as fractions (not px) so one spec serves every resolution of a
 * given aspect.
 */
export interface SafeMarginSpec {
  /** Top inset, fraction of frame HEIGHT (0..0.5). */
  top: number
  /** Bottom inset, fraction of frame HEIGHT (0..0.5). */
  bottom: number
  /** Left inset, fraction of frame WIDTH (0..0.5). */
  left: number
  /** Right inset, fraction of frame WIDTH (0..0.5). */
  right: number
}

/**
 * Per-aspect title-safe margins. Distinct per aspect because each delivery
 * surface reserves different chrome:
 *   - 9:16 (reels/shorts) — generous bottom (platform action rail + caption UI)
 *     and a tall top for the status bar; captions live in the lower band.
 *   - 16:9 (landscape) — classic ~5% broadcast title-safe all round.
 *   - 1:1 (square feed) — modest symmetric inset.
 * These are the single source of truth; `safeMarginsForAspect` is the only read.
 */
export const SAFE_MARGINS: Record<Aspect, SafeMarginSpec> = {
  '9:16': { top: 0.08, bottom: 0.14, left: 0.06, right: 0.06 },
  '16:9': { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 },
  '1:1': { top: 0.07, bottom: 0.07, left: 0.07, right: 0.07 }
}

/** The safe-margin spec for an aspect (the only read of {@link SAFE_MARGINS}). */
export function safeMarginsForAspect(aspect: Aspect): SafeMarginSpec {
  return SAFE_MARGINS[aspect]
}

/**
 * A representative caption-block height (canvas px) for the safe-area clamp when
 * the exact drawn height is not measured headlessly (e.g. the store action). A
 * 2-line block at the compositor's default 64px body × 1.2 line-height. The
 * clamp degrades gracefully if the real block is taller/shorter — the preview
 * re-clamps with the measured height on draw.
 */
export const DEFAULT_CAPTION_BLOCK_HEIGHT = 64 * 1.2 * 2

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** The title-safe band in canvas (project-resolution) PIXELS for an aspect. */
export interface SafeAreaPx {
  top: number
  bottom: number
  left: number
  right: number
}

/**
 * Resolve a {@link SafeMarginSpec} (fractions) into absolute canvas pixels for a
 * given resolution `[w,h]`. `top`/`bottom` scale by height, `left`/`right` by
 * width. Pure.
 */
export function safeAreaPx(
  spec: SafeMarginSpec,
  resolution: readonly [number, number]
): SafeAreaPx {
  const [w, h] = resolution
  return {
    top: spec.top * h,
    bottom: h - spec.bottom * h,
    left: spec.left * w,
    right: w - spec.right * w
  }
}

/**
 * Clamp a signed center-relative y offset (canvas px) so a caption block of
 * `blockHeight` px stays fully inside the safe band. The block is centered on
 * the offset (the compositor draws text centered at `height/2 + y`), so its top
 * edge is `center + y - blockHeight/2` and its bottom `center + y + blockHeight/2`.
 *
 * If the safe band is SHORTER than the block (a very tall block in a tight safe
 * area) the band's own center is returned — the best achievable placement —
 * rather than producing an empty clamp range. Pure.
 */
export function clampYToSafeArea(
  y: number,
  resolution: readonly [number, number],
  safe: SafeAreaPx,
  blockHeight: number
): number {
  const [, h] = resolution
  const center = h / 2
  const half = blockHeight / 2
  // Allowed center-of-block range (absolute px), then expressed as offsets.
  const minCenterAbs = safe.top + half
  const maxCenterAbs = safe.bottom - half
  if (minCenterAbs > maxCenterAbs) {
    // Block taller than the band → sit it on the band's center.
    return (safe.top + safe.bottom) / 2 - center
  }
  const minY = minCenterAbs - center
  const maxY = maxCenterAbs - center
  if (y < minY) return minY
  if (y > maxY) return maxY
  return y
}

// ---------------------------------------------------------------------------
// Public: anchor → pixel y
// ---------------------------------------------------------------------------

/** Inputs for {@link resolveCaptionY}. */
export interface ResolveCaptionYInput {
  /** Where the caption block sits. */
  anchor: LayoutAnchor
  /** Project aspect → selects the safe-margin spec. */
  aspect: Aspect
  /** Canvas/project resolution `[w,h]` in px (e.g. `resolutionForAspect(aspect)`). */
  resolution: readonly [number, number]
  /** Drawn caption-block height in px (used for the safe-area clamp). */
  blockHeight: number
  /**
   * Explicit center-relative y offset (canvas px) for `custom`. Ignored for the
   * named anchors. When omitted for `custom`, falls back to the preset's
   * normalized `layout.y` via {@link resolveLayoutY} (or 0).
   */
  customY?: number
  /**
   * Honor the safe margins (clamp inside the band). Defaults to TRUE — captions
   * normally must not cross the title-safe area regardless of anchor. Pass the
   * preset's `layout.safeMargin` to opt out.
   */
  safeMargin?: boolean
}

/**
 * Resolve a layout anchor to the signed center-relative `transform.y` offset
 * (canvas px) the compositor applies, CLAMPED into the aspect's safe area when
 * `safeMargin` is on.
 *
 * Named anchors (`lower-third`/`center`/`top`) take their aspect-neutral
 * NORMALIZED fraction from {@link resolveLayoutY} and multiply by frame height
 * → px. `custom` uses the explicit `customY` px (draggable / manual value); when
 * absent it falls back to the normalized fraction so a `custom` preset with only
 * `layout.y` still positions sensibly. The result is then clamped so the block
 * never crosses the safe margins (unless `safeMargin === false`).
 *
 * PURE — no DOM/electron/Date; fully unit-testable.
 */
export function resolveCaptionY(input: ResolveCaptionYInput): number {
  const { anchor, aspect, resolution, blockHeight } = input
  const [, h] = resolution
  const safeMargin = input.safeMargin ?? true

  // 1) Raw, unclamped center-relative offset in px.
  let y: number
  if (anchor === 'custom') {
    // Explicit px wins; else fall back to the normalized fraction × height.
    if (input.customY !== undefined) {
      y = input.customY
    } else {
      y = resolveLayoutY({ anchor: 'custom', safeMargin, maxLines: 1 }) * h
    }
  } else {
    // Reuse the shared anchor table (do NOT reinvent it), fraction × height.
    const fraction = resolveLayoutY({ anchor, safeMargin, maxLines: 1 })
    y = fraction * h
  }

  // 2) Clamp into the aspect's safe band (unless opted out).
  if (!safeMargin) return y
  const safe = safeAreaPx(safeMarginsForAspect(aspect), resolution)
  return clampYToSafeArea(y, resolution, safe, blockHeight)
}

/**
 * Convenience: resolve the pixel y straight from a {@link PresetLayout} (the
 * shape a preset carries) + aspect/resolution/block height. Honors the layout's
 * own `safeMargin` flag and, for `custom`, its normalized `layout.y` (converted
 * to px) when no explicit px override is supplied. Reuses {@link resolveCaptionY}.
 */
export function resolveCaptionYForLayout(
  layout: PresetLayout,
  aspect: Aspect,
  resolution: readonly [number, number],
  blockHeight: number,
  customY?: number
): number {
  return resolveCaptionY({
    anchor: layout.anchor,
    aspect,
    resolution,
    blockHeight,
    safeMargin: layout.safeMargin,
    ...(customY !== undefined ? { customY } : {})
  })
}

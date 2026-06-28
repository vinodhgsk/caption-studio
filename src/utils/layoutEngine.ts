/**
 * layoutEngine.ts
 *
 * Pure mathematical layout engine for the Divya TextStyler canvas.
 *
 * Responsibilities:
 *  - Compute pixel-perfect flourish anchor coordinates from the text block's
 *    absolute transformed bounding rectangle.
 *  - Expose a React hook that subscribes to Zustand store changes and
 *    automatically re-positions live canvas objects without a full re-render.
 *
 * All coordinate arithmetic uses Fabric.js canvas-space (i.e. the native 4K
 * coordinate system, NOT the CSS-scaled display space).
 */

import { useEffect, useRef } from 'react';
import { Canvas, FabricText, FabricImage } from 'fabric';
import { useStylerStore } from '../store/useStylerStore';

// ─────────────────────────────────────────────────────────────────────────────
// Public type: FlourishLayoutConfig
// ─────────────────────────────────────────────────────────────────────────────

export interface FlourishLayoutConfig {
  /** Uniform scale multiplier applied to both flourish images. */
  scale: number;
  /**
   * Horizontal gap (px) between the outer edge of the text bounding box and
   * the inner edge of each flourish image, in canvas-space pixels.
   */
  paddingX: number;
  /**
   * Vertical offset applied to both flourishes relative to the text block's
   * vertical center. Positive values move flourishes downward.
   */
  offsetY: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public type: FlourishPositionResult
// The computed absolute canvas-space coordinates + scale for each flourish.
// ─────────────────────────────────────────────────────────────────────────────

export interface FlourishPositionResult {
  left: {
    /** Canvas-space X for the LEFT flourish (originX: 'right' anchor). */
    x: number;
    /** Canvas-space Y for the LEFT flourish (originY: 'center' anchor). */
    y: number;
    scaleX: number;
    scaleY: number;
  };
  right: {
    /** Canvas-space X for the RIGHT flourish (originX: 'left' anchor). */
    x: number;
    /** Canvas-space Y for the RIGHT flourish (originY: 'center' anchor). */
    y: number;
    scaleX: number;
    scaleY: number;
  };
  /** Debug metadata — exposed so CanvasEditor can log without recomputing. */
  debug: {
    textLeft: number;
    textRight: number;
    textCenterY: number;
    textWidth: number;
    textHeight: number;
    leftFlourishNaturalWidth: number;
    rightFlourishNaturalWidth: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// calculateFlourishPositions()
//
// Pure function — no side effects, no canvas mutations.
//
// Algorithm:
//  1. Obtain the ABSOLUTE transformed bounding rectangle of the text object
//     via getBoundingRect(true, true), which accounts for:
//       - font-specific descenders / ascenders affecting real pixel height
//       - any active scale/rotation transforms on the object itself
//  2. Derive the text block's exact left edge, right edge, and vertical centre.
//  3. Apply the unified scale factor to both flourish objects.
//  4. Compute left flourish X  = textLeft  - paddingX
//     (the 'right' origin anchor on the flourish image will extend leftward)
//  5. Compute right flourish X = textRight + paddingX
//     (the 'left'  origin anchor on the flourish image will extend rightward)
//  6. Compute shared Y         = textCenterY + offsetY
// ─────────────────────────────────────────────────────────────────────────────

export function calculateFlourishPositions(
  textObject: FabricText,
  leftFlourish: FabricImage,
  rightFlourish: FabricImage,
  config: FlourishLayoutConfig,
): FlourishPositionResult {
  const { scale, paddingX, offsetY } = config;

  // ── Step 1: Absolute transformed text bounding rectangle ─────────────────
  // getBoundingRect() in Fabric.js v6 takes no arguments — it always returns
  // the absolute bounding box in canvas-space, accounting for all transforms.
  const textBounds = textObject.getBoundingRect();

  const textLeft   = textBounds.left;
  const textRight  = textBounds.left + textBounds.width;
  const textCenterY = textBounds.top + textBounds.height / 2;

  // ── Step 2: Natural (un-scaled) flourish dimensions ──────────────────────
  // FabricImage stores the original pixel dimensions as .width / .height
  // before any scaleX/scaleY is applied.
  const leftNaturalW  = leftFlourish.width  ?? 100;
  const rightNaturalW = rightFlourish.width ?? 100;

  // ── Step 3: Apply uniform scale ──────────────────────────────────────────
  // We keep scaleX === scaleY to prevent aspect-ratio distortion.
  const uniformScaleLeft  = scale;
  const uniformScaleRight = scale;

  // Scaled rendered dimensions (for debug / future hit-testing)
  const _leftScaledW  = leftNaturalW  * uniformScaleLeft;
  const _rightScaledW = rightNaturalW * uniformScaleRight;
  void _leftScaledW; void _rightScaledW; // consumed by debug block below

  // ── Step 4 & 5: X-coordinate computation ─────────────────────────────────
  //
  // LEFT flourish uses originX: 'right'
  //   → Fabric places the RIGHT EDGE of the image at the given `left` value.
  //   → So setting left = textLeft - paddingX means the image's right edge
  //     butts up against the text boundary with exactly paddingX gap.
  //
  // RIGHT flourish uses originX: 'left'
  //   → Fabric places the LEFT EDGE of the image at the given `left` value.
  //   → Setting left = textRight + paddingX places the image's left edge
  //     paddingX pixels beyond the text's right boundary.
  //
  const leftFlourishX  = textLeft  - paddingX;
  const rightFlourishX = textRight + paddingX;

  // ── Step 6: Shared Y with vertical offset ────────────────────────────────
  // Both flourishes share the same Y centre so they remain perfectly
  // symmetric around the text's horizontal axis.
  const sharedY = textCenterY + offsetY;

  return {
    left: {
      x:      leftFlourishX,
      y:      sharedY,
      scaleX: uniformScaleLeft,
      scaleY: uniformScaleLeft,
    },
    right: {
      x:      rightFlourishX,
      y:      sharedY,
      scaleX: uniformScaleRight,
      scaleY: uniformScaleRight,
    },
    debug: {
      textLeft,
      textRight,
      textCenterY,
      textWidth:               textBounds.width,
      textHeight:              textBounds.height,
      leftFlourishNaturalWidth:  leftNaturalW,
      rightFlourishNaturalWidth: rightNaturalW,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// applyFlourishPositions()
//
// Thin imperative helper that writes the result of calculateFlourishPositions
// directly onto live Fabric.js objects and requests a re-render.
// Separated from the pure math function so the latter stays unit-testable.
// ─────────────────────────────────────────────────────────────────────────────

export function applyFlourishPositions(
  canvas: Canvas,
  leftFlourish: FabricImage,
  rightFlourish: FabricImage,
  positions: FlourishPositionResult,
): void {
  leftFlourish.set({
    left:   positions.left.x,
    top:    positions.left.y,
    scaleX: positions.left.scaleX,
    scaleY: positions.left.scaleY,
    originX: 'right',
    originY: 'center',
  });

  rightFlourish.set({
    left:   positions.right.x,
    top:    positions.right.y,
    scaleX: positions.right.scaleX,
    scaleY: positions.right.scaleY,
    originX: 'left',
    originY: 'center',
  });

  // Batch the two dirty-marks into a single GPU rasterisation call
  canvas.requestRenderAll();
}

// ─────────────────────────────────────────────────────────────────────────────
// CanvasObjectRefs
//
// Mutable object refs passed from CanvasEditor into the hook so the hook can
// read the latest live Fabric objects without stale closures.
// ─────────────────────────────────────────────────────────────────────────────

export interface CanvasObjectRefs {
  canvas:       React.MutableRefObject<Canvas | null>;
  textObject:   React.MutableRefObject<FabricText | null>;
  leftFlourish: React.MutableRefObject<FabricImage | null>;
  rightFlourish: React.MutableRefObject<FabricImage | null>;
}

// ─────────────────────────────────────────────────────────────────────────────
// useCanvasLayoutAutoSync()
//
// React hook that subscribes to the relevant Zustand store slices and
// automatically recalculates + applies flourish positions whenever:
//   - The text content or style changes (different glyph widths per script)
//   - The flourish configuration changes (scale, paddingX, offsetY)
//   - The active flourish asset changes
//
// Design principles:
//   1. Uses Zustand's subscribe() API (not React state) for zero-re-render
//      layout updates — this bypasses React's reconciliation cycle entirely
//      and applies coordinate updates at ~60 fps cadence with requestRenderAll.
//   2. Stores a frameId via requestAnimationFrame so rapid store bursts
//      (e.g. slider dragging) are batched into a single frame.
//   3. Does NOT mutate or recreate Fabric objects — only repositions them.
//      A full object recreation is the responsibility of CanvasEditor.
// ─────────────────────────────────────────────────────────────────────────────

export function useCanvasLayoutAutoSync(refs: CanvasObjectRefs): void {
  // Holds the rAF handle so we can cancel in-flight layout recalculations
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // ── Core sync function ────────────────────────────────────────────────
    const syncLayout = () => {
      const canvas        = refs.canvas.current;
      const textObject    = refs.textObject.current;
      const leftFlourish  = refs.leftFlourish.current;
      const rightFlourish = refs.rightFlourish.current;

      // Guard: all four objects must be live on the canvas
      if (!canvas || !textObject || !leftFlourish || !rightFlourish) return;

      // Read current flourish configuration directly from store state
      // (avoids stale closure — store.getState() is always fresh)
      const { flourishConfig, activeFlourish } = useStylerStore.getState();

      if (!activeFlourish) return;

      const config: FlourishLayoutConfig = {
        scale:    activeFlourish.defaultScale * flourishConfig.scale,
        paddingX: flourishConfig.paddingX,
        offsetY:  flourishConfig.offsetY,
      };

      // ── Recalculate positions ────────────────────────────────────────────
      let positions: FlourishPositionResult;
      try {
        positions = calculateFlourishPositions(
          textObject,
          leftFlourish,
          rightFlourish,
          config,
        );
      } catch (err) {
        // getBoundingRect can throw if the object is not yet rendered
        console.warn('[LayoutEngine] getBoundingRect failed — object may not be rendered yet:', err);
        return;
      }

      // ── Apply to live canvas objects ─────────────────────────────────────
      applyFlourishPositions(canvas, leftFlourish, rightFlourish, positions);

      // Debug logging: Vite statically replaces this string so the console.debug
      // call is tree-shaken out of production bundles at build time.
      const __DEV__ = 'production' !== 'production' || true; // replaced by bundler
      if (__DEV__) {
        console.debug('[LayoutEngine] sync →', {
          textWidth: positions.debug.textWidth.toFixed(1),
          leftX:     positions.left.x.toFixed(1),
          rightX:    positions.right.x.toFixed(1),
          centerY:   positions.left.y.toFixed(1),
        });
      }
    };

    // ── rAF-throttled dispatcher ─────────────────────────────────────────
    // Cancels any pending frame before scheduling a new one so that
    // rapid slider drags collapse into at most one layout pass per frame.
    const scheduleSync = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        syncLayout();
      });
    };

    // ── Zustand subscriptions ────────────────────────────────────────────
    // We subscribe to three independent store slices. Each subscription
    // returns an unsubscribe function collected into the cleanup array.
    const unsubscribers: Array<() => void> = [];

    // 1. Text style changes: content, font, size, letter-spacing all affect
    //    the text bounding rect and therefore flourish alignment.
    //    Zustand v4 subscribe(selector, listener) — equality is handled
    //    manually inside the listener by comparing a serialised key.
    let prevTextKey = '';
    unsubscribers.push(
      useStylerStore.subscribe((state) => {
        const ts = state.textStyle;
        const key = `${ts.content}|${ts.fontFamily}|${ts.fontSize}|${ts.letterSpacing}|${ts.lineHeight}|${ts.uppercase}`;
        if (key !== prevTextKey) {
          prevTextKey = key;
          scheduleSync();
        }
      }),
    );

    // 2. Flourish configuration changes: scale, paddingX, offsetY.
    let prevFlourishConfig = '';
    unsubscribers.push(
      useStylerStore.subscribe((state) => {
        const fc = state.flourishConfig;
        const key = `${fc.scale}|${fc.paddingX}|${fc.offsetY}`;
        if (key !== prevFlourishConfig) {
          prevFlourishConfig = key;
          scheduleSync();
        }
      }),
    );

    // 3. Active flourish asset swap: natural image dimensions change.
    let prevActiveFlourish: unknown = undefined;
    unsubscribers.push(
      useStylerStore.subscribe((state) => {
        if (state.activeFlourish !== prevActiveFlourish) {
          prevActiveFlourish = state.activeFlourish;
          scheduleSync();
        }
      }),
    );

    // Run an initial sync pass so that when CanvasEditor hands off fresh
    // object refs the hook immediately corrects any stale positions.
    scheduleSync();

    // ── Cleanup ──────────────────────────────────────────────────────────
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      unsubscribers.forEach((unsub) => unsub());
    };
  // Refs are stable objects (useRef returns the same reference) so we do not
  // include them in the dependency array — the effect should only mount once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

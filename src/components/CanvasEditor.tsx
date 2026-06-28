import React, { useEffect, useRef, useState } from 'react';
import { Canvas, FabricText, FabricImage, Rect, Gradient, Shadow, cache } from 'fabric';
import { useStylerStore } from '../store/useStylerStore';
import { useCanvasLayoutAutoSync } from '../utils/layoutEngine';
import { registerCanvas, unregisterCanvas } from '../utils/canvasRegistry';
import { convertUnicodeToBamini } from '../utils/transliteration/baminiConverter';
import { DEVOTIONAL_FONTS } from '../utils/transliteration/fontConfig';
import { WordTiming } from '../types/timeline';
import { MotionConfig } from '../types/transitions';

export function applyKaraokeState(
  textObject: FabricText,
  activeWordIndex: number,
  wordTimings: WordTiming[],
  config: MotionConfig,
  canvasInstance: Canvas
) {
  if (!textObject || !wordTimings || wordTimings.length === 0) return;

  const totalLength = (textObject.text || '').length;
  // Reset the entire text to the inactive color
  textObject.setSelectionStyles({ fill: config.karaokeInactiveColor }, 0, totalLength);

  // Apply the active bright/glowing style to all words up to the active index
  for (let i = 0; i <= activeWordIndex; i++) {
    if (i < wordTimings.length) {
      const word = wordTimings[i];
      textObject.setSelectionStyles(
        { fill: config.karaokeActiveColor },
        word.startIndex,
        word.endIndex + 1 // +1 because setSelectionStyles end index is typically exclusive
      );
    }
  }

  textObject.dirty = true;
  canvasInstance.requestRenderAll();
}

export function useKaraokePlayback(
  textObjectRef: React.MutableRefObject<FabricText | null>,
  canvasInstanceRef: React.MutableRefObject<Canvas | null>,
  wordTimings: WordTiming[],
  config: MotionConfig,
  isPlaying: boolean,
  startTimestamp: number
) {
  useEffect(() => {
    if (!isPlaying || !textObjectRef.current || !canvasInstanceRef.current || wordTimings.length === 0) return;

    let animationFrameId: number;

    const tick = () => {
      const currentTimestampMs = performance.now() - startTimestamp;
      
      // Determine active word based on timestamp
      let activeWordIndex = -1;
      for (let i = 0; i < wordTimings.length; i++) {
        if (currentTimestampMs >= wordTimings[i].timestampMs) {
          activeWordIndex = i;
        } else {
          break;
        }
      }

      if (activeWordIndex !== -1 && textObjectRef.current && canvasInstanceRef.current) {
        applyKaraokeState(
          textObjectRef.current,
          activeWordIndex,
          wordTimings,
          config,
          canvasInstanceRef.current
        );
      }

      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying, startTimestamp, wordTimings, config, textObjectRef, canvasInstanceRef]);
}

export const CanvasEditor: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Keep track of the active fabric canvas instance
  const [canvasInstance, setCanvasInstance] = useState<Canvas | null>(null);
  
  // Track rendering cycles to prevent async race conditions
  const renderCountRef = useRef<number>(0);

  // ── Stable mutable refs for live Fabric objects ──────────────────────────
  // These are updated after every successful render and read by the layout
  // engine hook without causing React re-renders.
  const canvasInstanceRef  = useRef<Canvas | null>(null);
  const textObjectRef      = useRef<FabricText | null>(null);
  const leftFlourishRef    = useRef<FabricImage | null>(null);
  const rightFlourishRef   = useRef<FabricImage | null>(null);

  // ── Layout auto-sync hook ────────────────────────────────────────────────
  // Subscribes to Zustand store changes and repositions flourishes on the
  // live canvas objects without triggering a full re-render cycle.
  useCanvasLayoutAutoSync({
    canvas:       canvasInstanceRef,
    textObject:   textObjectRef,
    leftFlourish: leftFlourishRef,
    rightFlourish: rightFlourishRef,
  });

  // Responsive scaling state
  const [scale, setScale] = useState<number>(1);

  // Sourced from Zustand Store
  const canvasDimensions = useStylerStore((state) => state.canvas);
  const textStyle = useStylerStore((state) => state.textStyle);
  const activeFlourish = useStylerStore((state) => state.activeFlourish);
  const flourishConfig = useStylerStore((state) => state.flourishConfig);
  const backgroundImage = useStylerStore((state) => state.backgroundImage);
  const isLoading = useStylerStore((state) => state.isLoading);
  const customFonts = useStylerStore((state) => state.customFonts);

  // 1. Canvas Lifecycle Management: Initialize and Dispose Fabric Canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new Canvas(canvasRef.current, {
      width: canvasDimensions.width,
      height: canvasDimensions.height,
      backgroundColor: 'transparent',
      selection: false,
    });

    setCanvasInstance(canvas);
    canvasInstanceRef.current = canvas;

    return () => {
      // Invalidate registry before disposal so ExportPanel cannot
      // operate on a dead canvas instance.
      unregisterCanvas();
      textObjectRef.current    = null;
      leftFlourishRef.current  = null;
      rightFlourishRef.current = null;
      canvas.dispose();
      setCanvasInstance(null);
      canvasInstanceRef.current = null;
    };
  }, [canvasDimensions.width, canvasDimensions.height]);

  // 2. Responsive CSS Matrix Scaling
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleResize = () => {
      const parentWidth = container.clientWidth;
      const parentHeight = container.clientHeight;

      // Allow 40px padding around the canvas bounds
      const padding = 80;
      const availableWidth = Math.max(parentWidth - padding, 200);
      const availableHeight = Math.max(parentHeight - padding, 200);

      const scaleX = availableWidth / canvasDimensions.width;
      const scaleY = availableHeight / canvasDimensions.height;
      
      // Maintain aspect ratio while fitting completely within parent
      const newScale = Math.min(scaleX, scaleY);
      setScale(newScale);
    };

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    
    resizeObserver.observe(container);
    handleResize();

    window.addEventListener('resize', handleResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [canvasDimensions.width, canvasDimensions.height]);

  // 3. Render Canvas Layers and Apply Filters
  useEffect(() => {
    if (!canvasInstance) return;

    const renderCanvas = async () => {
      // Clear Fabric.js global font widths cache Map to force recalculation with the new font
      cache.charWidthsCache.clear();

      const renderId = ++renderCountRef.current;

      // Wait for Indic/Google fonts to load to ensure bounding boxes are calculated accurately
      if (document.fonts) {
        try {
          await document.fonts.ready;
        } catch (e) {
          console.warn('Devotional font check warning:', e);
        }
      }

      // Check if this render cycle is still the latest one
      if (renderId !== renderCountRef.current) return;

      // Clear existing canvas objects and invalidate stale object refs so
      // the layout hook does not attempt to reposition orphaned objects.
      // Also clear the registry so ExportPanel sees a clean state.
      unregisterCanvas();
      textObjectRef.current    = null;
      leftFlourishRef.current  = null;
      rightFlourishRef.current = null;
      canvasInstance.clear();

      try {
        const cx = canvasDimensions.width / 2;
        const cy = canvasDimensions.height / 2;

        // --- Layer 0: Background Layer ---
        if (backgroundImage) {
          if (backgroundImage.startsWith('#') || backgroundImage === 'white' || backgroundImage === 'transparent') {
            const bgRect = new Rect({
              width: canvasDimensions.width,
              height: canvasDimensions.height,
              fill: backgroundImage,
              left: 0,
              top: 0,
              originX: 'left',
              originY: 'top',
              selectable: false,
              evented: false,
              hoverCursor: 'default',
              hasControls: false,
            });
            canvasInstance.add(bgRect);
          } else {
            const bgImg = await FabricImage.fromURL(backgroundImage, {
              crossOrigin: 'anonymous',
            });

            if (renderId !== renderCountRef.current) return;

            // Scale background to cover the entire canvas
            const scaleX = canvasDimensions.width / bgImg.width;
            const scaleY = canvasDimensions.height / bgImg.height;
            const bgScale = Math.max(scaleX, scaleY);

            bgImg.set({
              scaleX: bgScale,
              scaleY: bgScale,
              left: cx,
              top: cy,
              originX: 'center',
              originY: 'center',
              selectable: false,
              evented: false,
              hoverCursor: 'default',
              hasControls: false,
            });

            canvasInstance.add(bgImg);
          }
        }

        // --- Layer 1: Devotional Typography Engine ---
        const allSystemFonts = Object.values(DEVOTIONAL_FONTS).flat();
        const activeFontConfig = allSystemFonts.find(f => f.family === textStyle.fontFamily) 
                                 || customFonts.find(f => f.family === textStyle.fontFamily);
        const isBamini = activeFontConfig?.encoding === 'bamini';

        let textContent = textStyle.uppercase
          ? (textStyle.content || '').toUpperCase()
          : textStyle.content || '';

        if (isBamini) {
          textContent = convertUnicodeToBamini(textContent);
        }

        // Shared text options applied to ALL text layers (depth + foreground)
        const sharedTextOpts = {
          originX: 'center' as const,
          originY: 'center' as const,
          fontFamily: `"${textStyle.fontFamily}"`,
          fontWeight: textStyle.fontWeight,
          fontSize: textStyle.fontSize,
          lineHeight: textStyle.lineHeight,
          charSpacing: textStyle.letterSpacing * 10,
          selectable: false,
          evented: false,
          hoverCursor: 'default' as const,
          hasControls: false,
          opacity: textStyle.opacity,
        };

        // --- Layer 1a: 3D Extrusion Depth Stack ---
        // We render between 1 and MAX_STEPS copies of the text at progressively
        // smaller offsets (back → front). Each copy uses the solid depth colour.
        // The foreground text (Layer 1b) is always added last so it sits on top.
        if (textStyle.enable3D && textStyle.depth3D > 0) {
          const angleRad  = (textStyle.depth3DAngle * Math.PI) / 180;
          const dx        = Math.cos(angleRad);
          const dy        = Math.sin(angleRad);
          const depth     = textStyle.depth3D;
          // Clamp step count so we never add more than 14 extra canvas objects
          const steps     = Math.min(Math.max(Math.round(depth * 0.8), 1), 14);

          for (let step = steps; step >= 1; step--) {
            const t       = step / steps;
            const depthLayer = new FabricText(textContent || ' ', {
              ...sharedTextOpts,
              left: cx + t * depth * dx,
              top:  cy + t * depth * dy,
              fill: textStyle.depth3DColor,
              // No stroke or glow on depth layers — keeps edges crisp
              stroke:      undefined,
              strokeWidth: 0,
            });
            canvasInstance.add(depthLayer);
          }
        }

        // --- Layer 1b: Foreground text (gradient fill + glow) ---
        const textObj = new FabricText(textContent || ' ', {
          ...sharedTextOpts,
          left: cx,
          top:  cy,
          stroke:          textStyle.strokeWidth > 0 ? textStyle.strokeColor : undefined,
          strokeWidth:     textStyle.strokeWidth,
          strokeLineJoin:  textStyle.strokeLineJoin,
        });

        // Apply Premium Typography Gradient Fill
        if (typeof textStyle.fillColor === 'string') {
          textObj.set('fill', textStyle.fillColor);
        } else if (Array.isArray(textStyle.fillColor)) {
          const textHeight = textObj.height || 100;
          
          const gradient = new Gradient({
            type: 'linear',
            coords: {
              x1: 0,
              y1: -textHeight / 2,
              x2: 0,
              y2: textHeight / 2,
            },
            colorStops: textStyle.fillColor.map((stop) => ({
              offset: stop.offset,
              color: stop.color,
            })),
          });
          
          textObj.set('fill', gradient);
        }

        // Apply High-Contrast Auric Glow
        if (textStyle.glowBlur > 0) {
          const glowShadow = new Shadow({
            color: textStyle.glowColor,
            blur: textStyle.glowBlur,
            offsetX: textStyle.shadowOffsetX,
            offsetY: textStyle.shadowOffsetY,
          });
          
          textObj.set('shadow', glowShadow);
        }

        // Add the text object to the canvas (crucial for dimensions checking)
        canvasInstance.add(textObj);
        // Publish ref so the layout hook can read the live bounding rect,
        // and so ExportPanel can update text content directly.
        textObjectRef.current = textObj;

        // --- Layer 2: Symmetrical Flourish Bookends ---
        if (activeFlourish) {
          const { leftSrc, rightSrc, defaultScale } = activeFlourish;

          // Load Left Flourish Image
          const leftFlourish = await FabricImage.fromURL(leftSrc, {
            crossOrigin: 'anonymous',
          });
          if (renderId !== renderCountRef.current) return;

          // Determine Right Flourish Image asset (with fallback mirroring)
          const useMirroring = !rightSrc || rightSrc === leftSrc;
          const rightFlourish = useMirroring
            ? await FabricImage.fromURL(leftSrc, { crossOrigin: 'anonymous' })
            : await FabricImage.fromURL(rightSrc, { crossOrigin: 'anonymous' });
          
          if (renderId !== renderCountRef.current) return;

          if (useMirroring) {
            rightFlourish.set({ flipX: true });
          }

          const textWidth = textObj.width || 0;
          const scaleFactor = defaultScale * flourishConfig.scale;
          const paddingX = flourishConfig.paddingX;
          const offsetY = flourishConfig.offsetY;

          // Configure Left Flourish
          leftFlourish.set({
            scaleX: scaleFactor,
            scaleY: scaleFactor,
            originX: 'right',
            originY: 'center',
            left: cx - textWidth / 2 - paddingX,
            top: cy + offsetY,
            selectable: false,
            evented: false,
            hoverCursor: 'default',
            hasControls: false,
          });

          // Configure Right Flourish
          rightFlourish.set({
            scaleX: scaleFactor,
            scaleY: scaleFactor,
            originX: 'left',
            originY: 'center',
            left: cx + textWidth / 2 + paddingX,
            top: cy + offsetY,
            selectable: false,
            evented: false,
            hoverCursor: 'default',
            hasControls: false,
          });

          canvasInstance.add(leftFlourish);
          canvasInstance.add(rightFlourish);

          // Publish refs so useCanvasLayoutAutoSync can reposition without
          // a full canvas redraw on subsequent config slider changes.
          leftFlourishRef.current  = leftFlourish;
          rightFlourishRef.current = rightFlourish;
        }

        canvasInstance.renderAll();

        // ── Publish to canvas registry ───────────────────────────────────
        // Done after renderAll() so ExportPanel always reads a fully
        // composed canvas with all layers applied.
        if (textObjectRef.current) {
          registerCanvas(canvasInstance, textObjectRef.current);
        }
      } catch (error) {
        console.error('Error rendering Divya TextStyler canvas layers:', error);
      }
    };

    renderCanvas();
  }, [
    canvasInstance,
    textStyle,
    activeFlourish,
    flourishConfig,
    backgroundImage,
    canvasDimensions.width,
    canvasDimensions.height,
  ]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full min-h-0 bg-zinc-950 flex items-center justify-center overflow-hidden"
    >
      {/* Decorative Grid Pattern Overlay */}
      <div 
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: `
            radial-gradient(circle at 1px 1px, white 1px, transparent 0),
            linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)
          `,
          backgroundSize: '24px 24px, 120px 120px, 120px 120px',
        }}
      />

      {/* Render Canvas Wrapper centered and scaled dynamically */}
      <div
        className="transition-transform duration-200 ease-out shadow-[0_0_80px_rgba(0,0,0,0.8)] border border-zinc-800/40 rounded-sm overflow-hidden"
        style={{
          width: canvasDimensions.width,
          height: canvasDimensions.height,
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
          position: 'absolute',
        }}
      >
        <canvas ref={canvasRef} />
      </div>

      {/* Ambient Metadata UI tag */}
      <div className="absolute bottom-4 left-4 z-10 flex items-center gap-3 px-3 py-1.5 rounded-lg bg-zinc-900/80 border border-zinc-800/60 backdrop-blur-md text-xs font-mono text-zinc-400 select-none">
        <span className="flex h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
        <span>{canvasDimensions.aspectPreset}</span>
        <span className="text-zinc-600">|</span>
        <span>{canvasDimensions.width} × {canvasDimensions.height} px</span>
      </div>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-zinc-950/70 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-50 animate-fade-in">
          <div className="w-10 h-10 border-2 border-amber-500/25 border-t-amber-500 rounded-full animate-spin" />
          <p className="text-sm font-medium text-amber-500/90 tracking-wide font-mono">
            Rerendering Canvas...
          </p>
        </div>
      )}
    </div>
  );
};

/**
 * canvasRegistry.ts
 *
 * Module-level singleton that holds live references to the active Fabric.js
 * canvas objects. This pattern decouples ExportPanel from CanvasEditor without
 * requiring prop drilling, React context, or Zustand state (which would trigger
 * unnecessary re-renders when canvas objects change).
 *
 * Lifecycle:
 *   - CanvasEditor calls registerCanvas() after each successful render cycle.
 *   - CanvasEditor calls unregisterCanvas() in its useEffect cleanup / dispose.
 *   - ExportPanel calls getCanvasRegistry() to obtain the current live refs.
 *
 * Thread safety:
 *   JavaScript is single-threaded, so no mutex is needed. The export pipeline
 *   must still check for null refs before using them, as the canvas can be
 *   unmounted while an export is in progress (e.g. user navigates away).
 */

import { Canvas, FabricText } from 'fabric';

// ─────────────────────────────────────────────────────────────────────────────
// Registry shape
// ─────────────────────────────────────────────────────────────────────────────

export interface CanvasRegistryEntry {
  /** The active Fabric.js Canvas instance */
  fabricCanvas: Canvas;
  /** The live FabricText object currently rendered on Layer 1 */
  textObject: FabricText;
  /**
   * The raw HTML <canvas> element managed by Fabric. Used to call .toBlob()
   * directly, bypassing Fabric's abstraction layer.
   * Obtained via fabricCanvas.getElement() at registration time.
   */
  htmlCanvas: HTMLCanvasElement;
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton storage (module-level, not exported directly)
// ─────────────────────────────────────────────────────────────────────────────

let _registry: CanvasRegistryEntry | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Called by CanvasEditor after every successful canvas render cycle to publish
 * the current live Fabric object references.
 */
export function registerCanvas(
  fabricCanvas: Canvas,
  textObject: FabricText,
): void {
  _registry = {
    fabricCanvas,
    textObject,
    htmlCanvas: fabricCanvas.getElement() as HTMLCanvasElement,
  };
}

/**
 * Called by CanvasEditor's useEffect cleanup block and on canvas disposal.
 * Clears stale references so ExportPanel cannot operate on a dead canvas.
 */
export function unregisterCanvas(): void {
  _registry = null;
}

/**
 * Returns the current registry snapshot, or null if no canvas is mounted.
 * ExportPanel must handle the null case gracefully.
 */
export function getCanvasRegistry(): CanvasRegistryEntry | null {
  return _registry;
}

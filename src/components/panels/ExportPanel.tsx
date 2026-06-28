/**
 * ExportPanel.tsx
 *
 * 4K sequential frame export pipeline for Divya TextStyler.
 *
 * Processing sequence for each text chunk:
 *   1. Directly mutate the live FabricText object content (bypasses React)
 *   2. Call canvas.renderAll() to composite all layers at native 4K resolution
 *   3. Extract the frame via HTMLCanvasElement.toBlob() at quality 1.0
 *   4. Append the Blob to an in-memory ordered map with padded filenames
 *   5. Yield to the browser event loop via a 30 ms microtask pause
 *
 * After all frames are collected:
 *   - Pack every Blob into a JSZip archive
 *   - Generate the final .zip Blob
 *   - Trigger a browser download via file-saver
 */

import React, { useState, useRef, useCallback } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { useStylerStore } from '../../store/useStylerStore';
import { getCanvasRegistry } from '../../utils/canvasRegistry';
import { convertUnicodeToBamini } from '../../utils/transliteration/baminiConverter';
import { DEVOTIONAL_FONTS } from '../../utils/transliteration/fontConfig';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ExportPhase =
  | 'idle'
  | 'preflight'
  | 'rendering'
  | 'packing'
  | 'done'
  | 'error'
  | 'cancelled';

interface ExportProgress {
  current: number;
  total: number;
  currentChunk: string;
  framesCollected: number;
  elapsedMs: number;
  estimatedRemainingMs: number;
}

interface ExportResult {
  framesExported: number;
  zipSizeBytes: number;
  durationMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: zero-padded filename (lyrics_001.png … lyrics_999.png)
// ─────────────────────────────────────────────────────────────────────────────

function frameFilename(index: number, total: number): string {
  const digits = Math.max(3, String(total).length);
  const padded = String(index + 1).padStart(digits, '0');
  return `lyrics_${padded}.png`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: promise wrapper for HTMLCanvasElement.toBlob()
// Returns null on failure (never throws) so the pipeline can decide whether
// to skip the frame or abort.
// ─────────────────────────────────────────────────────────────────────────────

function canvasToBlob(
  htmlCanvas: HTMLCanvasElement,
  quality = 1.0
): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => {
    htmlCanvas.toBlob(resolve, 'image/png', quality);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: microtask pause to breathe between frames
// 30 ms is enough to flush one browser paint cycle and prevent tab freezing
// while keeping total export overhead negligible for ≤500 frames.
// ─────────────────────────────────────────────────────────────────────────────

function breathe(ms = 30): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-component: PhaseTag
// ─────────────────────────────────────────────────────────────────────────────

interface PhaseTagProps {
  phase: ExportPhase;
}

const PHASE_CONFIGS: Record<ExportPhase, { label: string; color: string }> = {
  idle:       { label: 'READY',      color: 'text-slate-500 bg-slate-800 border-slate-700' },
  preflight:  { label: 'CHECKING',   color: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
  rendering:  { label: 'RENDERING',  color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  packing:    { label: 'PACKAGING',  color: 'text-violet-400 bg-violet-500/10 border-violet-500/30' },
  done:       { label: 'COMPLETE',   color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
  error:      { label: 'ERROR',      color: 'text-red-400 bg-red-500/10 border-red-500/30' },
  cancelled:  { label: 'CANCELLED',  color: 'text-slate-400 bg-slate-800 border-slate-700' },
};

const PhaseTag: React.FC<PhaseTagProps> = ({ phase }) => {
  const cfg = PHASE_CONFIGS[phase];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-mono font-bold tracking-widest ${cfg.color}`}>
      {phase === 'rendering' && (
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
      )}
      {phase === 'packing' && (
        <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
      )}
      {cfg.label}
    </span>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-component: LuxuryProgressBar
// ─────────────────────────────────────────────────────────────────────────────

interface LuxuryProgressBarProps {
  value: number;       // 0–100
  phase: ExportPhase;
  animated?: boolean;
}

const LuxuryProgressBar: React.FC<LuxuryProgressBarProps> = ({
  value,
  phase,
  animated = true,
}) => {
  const clampedValue = Math.max(0, Math.min(100, value));

  const trackColor =
    phase === 'done'      ? 'from-emerald-500 to-emerald-400' :
    phase === 'error'     ? 'from-red-600 to-red-400' :
    phase === 'packing'   ? 'from-violet-600 to-violet-400' :
    phase === 'cancelled' ? 'from-slate-600 to-slate-500' :
                            'from-amber-600 to-amber-400';

  return (
    <div className="relative w-full h-2 rounded-full bg-slate-800 overflow-hidden">
      {/* Filled bar */}
      <div
        className={`absolute inset-y-0 left-0 rounded-full bg-gradient-to-r ${trackColor} transition-all duration-300 ease-out`}
        style={{ width: `${clampedValue}%` }}
      />
      {/* Shimmer overlay during active phases */}
      {animated && (phase === 'rendering' || phase === 'packing') && (
        <div
          className="absolute inset-y-0 w-16 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[shimmer_1.5s_ease-in-out_infinite]"
          style={{ left: `${Math.max(0, clampedValue - 8)}%` }}
        />
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-component: StatBadge
// ─────────────────────────────────────────────────────────────────────────────

const StatBadge: React.FC<{ label: string; value: string | number; accent?: boolean }> = ({
  label,
  value,
  accent = false,
}) => (
  <div className={`flex flex-col gap-0.5 px-3 py-2 rounded-lg border ${accent ? 'border-amber-500/20 bg-amber-500/5' : 'border-slate-800 bg-slate-900'}`}>
    <span className="text-[9px] font-mono tracking-widest text-slate-500 uppercase">{label}</span>
    <span className={`text-sm font-bold font-mono tabular-nums ${accent ? 'text-amber-400' : 'text-slate-300'}`}>
      {value}
    </span>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Utility: human-readable duration
// ─────────────────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main: ExportPanel
// ─────────────────────────────────────────────────────────────────────────────

export const ExportPanel: React.FC = () => {
  // ── Store selectors ─────────────────────────────────────────────────────────
  const textChunks      = useStylerStore((s) => s.textChunks);
  const canvasDimensions = useStylerStore((s) => s.canvas);
  const textStyle = useStylerStore((s) => s.textStyle);
  const customFonts = useStylerStore((s) => s.customFonts);
  const setCurrentChunkIndex = useStylerStore((s) => s.setCurrentChunkIndex);

  // ── Local state ─────────────────────────────────────────────────────────────
  const [phase, setPhase]           = useState<ExportPhase>('idle');
  const [progress, setProgress]     = useState<ExportProgress | null>(null);
  const [result, setResult]         = useState<ExportResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Cancellation signal — checked at the top of every loop iteration
  const cancelledRef = useRef<boolean>(false);

  // ─────────────────────────────────────────────────────────────────────────
  // Core sequential rendering pipeline
  // ─────────────────────────────────────────────────────────────────────────

  const runExport = useCallback(async () => {
    cancelledRef.current = false;
    setResult(null);
    setErrorMessage(null);

    // ── Phase: PREFLIGHT ─────────────────────────────────────────────────────
    setPhase('preflight');

    const registry = getCanvasRegistry();

    if (!registry) {
      setPhase('error');
      setErrorMessage(
        'Canvas is not initialised. Render at least one text frame before exporting.'
      );
      return;
    }

    if (textChunks.length === 0) {
      setPhase('error');
      setErrorMessage(
        'No text chunks found. Process your devotional text via the server endpoint first.'
      );
      return;
    }

    const { fabricCanvas, textObject, htmlCanvas } = registry;
    const total = textChunks.length;
    const startTime = Date.now();

    const allSystemFonts = Object.values(DEVOTIONAL_FONTS).flat();
    const activeFontConfig = allSystemFonts.find(f => f.family === textStyle.fontFamily) 
                             || customFonts.find(f => f.family === textStyle.fontFamily);
    const isBamini = activeFontConfig?.encoding === 'bamini';

    // Save the original text content so we can restore it after export
    const originalText = textObject.text ?? '';

    // In-memory ordered map: filename → Blob
    // Using Map to preserve insertion order (critical for sequential naming).
    const frameMap = new Map<string, Blob>();

    // ── Phase: RENDERING ─────────────────────────────────────────────────────
    setPhase('rendering');

    for (let i = 0; i < total; i++) {
      // Check cancellation before every frame
      if (cancelledRef.current) {
        // Restore original text before bailing
        textObject.set('text', originalText);
        fabricCanvas.renderAll();
        setPhase('cancelled');
        setProgress(null);
        return;
      }

      const chunk = textChunks[i];
      const elapsed = Date.now() - startTime;
      const avgMsPerFrame = i > 0 ? elapsed / i : 0;
      const estimatedRemaining = avgMsPerFrame * (total - i);

      // ── a. Push text update directly to all live Fabric text objects ───────
      // We bypass React / Zustand state here intentionally: writing directly
      // to the Fabric objects avoids triggering a full React re-render cycle
      // for every frame, which would be ~100× slower for large chunk arrays.
      
      let renderText = textStyle.uppercase ? chunk.toUpperCase() : chunk;
      if (isBamini) {
        renderText = convertUnicodeToBamini(renderText);
      }
      
      fabricCanvas.getObjects().forEach((obj) => {
        if ('text' in obj && typeof obj.set === 'function') {
          obj.set('text', renderText);
        }
      });

      // Update the store index so the UI counter stays in sync without
      // re-rendering the entire CanvasEditor.
      setCurrentChunkIndex(i);

      // ── b. Composite all layers at native 4K resolution ───────────────────
      fabricCanvas.renderAll();

      // ── c. Extract the composited frame as a lossless PNG Blob ────────────
      const blob = await canvasToBlob(htmlCanvas, 1.0);

      if (!blob) {
        // toBlob can return null on memory exhaustion or security restrictions.
        // Log and skip the frame rather than crashing the entire export.
        console.warn(`[ExportPanel] toBlob() returned null for frame ${i + 1}. Skipping.`);
      } else {
        // ── d. Store blob in the ordered frame map ─────────────────────────
        const filename = frameFilename(i, total);
        frameMap.set(filename, blob);
      }

      // ── e. Update progress state ──────────────────────────────────────────
      setProgress({
        current: i + 1,
        total,
        currentChunk: chunk,
        framesCollected: frameMap.size,
        elapsedMs: elapsed,
        estimatedRemainingMs: Math.max(0, Math.round(estimatedRemaining)),
      });

      // ── f. Microtask pause — yield to the browser event loop ─────────────
      // 30 ms allows the browser to:
      //   - Process any pending input events (e.g. cancel button click)
      //   - Run CSS animations / transitions so the progress bar updates
      //   - Prevent the "Page Unresponsive" dialog on long exports
      await breathe(30);
    }

    // Restore the original text content to all live text objects on canvas
    fabricCanvas.getObjects().forEach((obj) => {
      if ('text' in obj && typeof obj.set === 'function') {
        obj.set('text', originalText);
      }
    });
    fabricCanvas.renderAll();
    setCurrentChunkIndex(0);

    if (frameMap.size === 0) {
      setPhase('error');
      setErrorMessage('All frames returned null blobs. Check browser memory and canvas state.');
      return;
    }

    // ── Phase: PACKING ────────────────────────────────────────────────────────
    setPhase('packing');

    // Brief yield so the UI transitions to the PACKING state visually
    await breathe(60);

    try {
      const zip = new JSZip();

      // Pack every frame blob into the zip root directory
      for (const [filename, blob] of frameMap.entries()) {
        zip.file(filename, blob);
      }

      // Generate the final binary payload
      const zipBlob = await zip.generateAsync(
        {
          type: 'blob',
          compression: 'DEFLATE',
          compressionOptions: { level: 6 }, // balanced speed vs size
        },
        // Progress callback from JSZip (0–100)
        (metadata) => {
          setProgress((prev) =>
            prev
              ? {
                  ...prev,
                  currentChunk: `Compressing… ${metadata.percent.toFixed(0)}%`,
                }
              : prev
          );
        }
      );

      // ── Trigger browser download ───────────────────────────────────────────
      saveAs(zipBlob, 'divya_styler_lyrics.zip');

      const totalDuration = Date.now() - startTime;

      setResult({
        framesExported: frameMap.size,
        zipSizeBytes: zipBlob.size,
        durationMs: totalDuration,
      });

      setPhase('done');
      setProgress(null);
    } catch (packError) {
      console.error('[ExportPanel] Zip packing failed:', packError);
      setPhase('error');
      setErrorMessage(
        packError instanceof Error
          ? `Packaging failed: ${packError.message}`
          : 'Unknown error during zip packaging.'
      );
    }
  }, [textChunks, setCurrentChunkIndex]);

  // ── Cancel handler ────────────────────────────────────────────────────────
  const handleCancel = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  // ── Reset handler ─────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    cancelledRef.current = false;
    setPhase('idle');
    setProgress(null);
    setResult(null);
    setErrorMessage(null);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Derived display values
  // ─────────────────────────────────────────────────────────────────────────

  const progressPct = progress
    ? Math.round((progress.current / progress.total) * 100)
    : phase === 'done'      ? 100
    : phase === 'packing'   ? 99  // indeterminate packing
    : phase === 'preflight' ? 2
    : 0;

  const isActive  = phase === 'rendering' || phase === 'packing' || phase === 'preflight';
  const isSettled = phase === 'done' || phase === 'error' || phase === 'cancelled';

  const canExport =
    phase === 'idle' &&
    textChunks.length > 0 &&
    getCanvasRegistry() !== null;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="w-full space-y-6 text-slate-100">

      {/* ── Section Header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <span className="text-base">📦</span>
          <h3 className="text-[11px] font-bold tracking-[0.18em] text-slate-300 uppercase font-mono">
            4K Export Pipeline
          </h3>
        </div>
        <PhaseTag phase={phase} />
      </div>

      {/* ── Canvas & Chunk Summary ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2">
        <StatBadge
          label="Resolution"
          value={`${canvasDimensions.width} × ${canvasDimensions.height}`}
        />
        <StatBadge
          label="Total Frames"
          value={textChunks.length === 0 ? '—' : textChunks.length}
          accent={textChunks.length > 0}
        />
        <StatBadge
          label="Aspect"
          value={canvasDimensions.aspectPreset}
        />
        <StatBadge
          label="Format"
          value="PNG 100%"
        />
      </div>

      {/* ── No-chunks warning ───────────────────────────────────────────── */}
      {phase === 'idle' && textChunks.length === 0 && (
        <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs text-amber-400/80 leading-relaxed">
          <span className="text-base shrink-0">⚠</span>
          <p>
            No text chunks loaded. Process your devotional verse through the{' '}
            <span className="font-mono font-semibold text-amber-400">POST /api/process-text</span>{' '}
            endpoint first, then call <span className="font-mono font-semibold text-amber-400">setTextChunks()</span> to load the array.
          </p>
        </div>
      )}

      {/* ── Canvas not ready warning ─────────────────────────────────────── */}
      {phase === 'idle' && textChunks.length > 0 && getCanvasRegistry() === null && (
        <div className="flex items-start gap-2.5 p-3 rounded-lg bg-red-500/5 border border-red-500/20 text-xs text-red-400/80 leading-relaxed">
          <span className="text-base shrink-0">🚫</span>
          <p>
            Canvas is not yet initialised. Switch to the workbench view and render
            your composition before exporting.
          </p>
        </div>
      )}

      {/* ── Active: Rendering Progress ───────────────────────────────────── */}
      {isActive && progress && (
        <div className="space-y-4 p-4 rounded-xl bg-slate-900/60 border border-slate-800">
          {/* Counter label */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-mono">
              {phase === 'packing'
                ? 'Packaging archive…'
                : `Processing frame ${progress.current} of ${progress.total}`}
            </span>
            <span className="text-sm font-bold font-mono text-amber-400 tabular-nums">
              {progressPct}%
            </span>
          </div>

          {/* Progress bar */}
          <LuxuryProgressBar value={progressPct} phase={phase} />

          {/* Current chunk preview */}
          {phase === 'rendering' && (
            <div className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800/60">
              <span className="block text-[9px] font-mono text-slate-600 uppercase tracking-widest mb-1">
                Current Chunk
              </span>
              <p className="text-sm text-slate-300 font-medium truncate" title={progress.currentChunk}>
                {progress.currentChunk || '\u00A0'}
              </p>
            </div>
          )}

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] font-mono text-slate-600 uppercase">Collected</span>
              <span className="text-xs font-mono font-semibold text-emerald-400 tabular-nums">
                {progress.framesCollected} frames
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] font-mono text-slate-600 uppercase">Elapsed</span>
              <span className="text-xs font-mono font-semibold text-slate-300 tabular-nums">
                {formatMs(progress.elapsedMs)}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] font-mono text-slate-600 uppercase">Remaining</span>
              <span className="text-xs font-mono font-semibold text-slate-300 tabular-nums">
                {progress.estimatedRemainingMs > 0
                  ? `~${formatMs(progress.estimatedRemainingMs)}`
                  : '…'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Packing phase without frame progress ────────────────────────── */}
      {phase === 'packing' && !progress && (
        <div className="space-y-3 p-4 rounded-xl bg-violet-500/5 border border-violet-500/20">
          <div className="flex items-center gap-2 text-sm text-violet-300 font-mono">
            <div className="w-4 h-4 rounded-full border border-violet-400/30 border-t-violet-400 animate-spin shrink-0" />
            Compressing and packaging archive…
          </div>
          <LuxuryProgressBar value={99} phase="packing" />
        </div>
      )}

      {/* ── Success Result ───────────────────────────────────────────────── */}
      {phase === 'done' && result && (
        <div className="space-y-4 p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-400">
            <span className="text-base">✅</span>
            Export complete — file downloaded!
          </div>
          <LuxuryProgressBar value={100} phase="done" animated={false} />
          <div className="grid grid-cols-3 gap-2 pt-1">
            <StatBadge label="Frames" value={result.framesExported} accent />
            <StatBadge
              label="Zip Size"
              value={
                result.zipSizeBytes > 1_000_000
                  ? `${(result.zipSizeBytes / 1_000_000).toFixed(1)} MB`
                  : `${(result.zipSizeBytes / 1024).toFixed(0)} KB`
              }
            />
            <StatBadge label="Duration" value={formatMs(result.durationMs)} />
          </div>
          <p className="text-[11px] text-slate-500 font-mono">
            📁 <span className="text-emerald-500/80">divya_styler_lyrics.zip</span> saved to your
            Downloads folder. Drop the PNG sequence into your CapCut timeline.
          </p>
        </div>
      )}

      {/* ── Error State ──────────────────────────────────────────────────── */}
      {phase === 'error' && errorMessage && (
        <div className="space-y-3 p-4 rounded-xl bg-red-500/5 border border-red-500/20">
          <div className="flex items-start gap-2 text-sm text-red-400">
            <span className="text-base shrink-0">❌</span>
            <p className="leading-relaxed">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* ── Cancelled State ──────────────────────────────────────────────── */}
      {phase === 'cancelled' && (
        <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700 text-sm text-slate-400 font-mono">
          Export cancelled by user.
        </div>
      )}

      {/* ── Export Settings (idle only) ───────────────────────────────────── */}
      {(phase === 'idle') && (
        <div className="space-y-3 p-4 rounded-xl bg-slate-900/40 border border-slate-800/60">
          <h4 className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-500">
            Output Settings
          </h4>
          <div className="space-y-2 text-[11px] font-mono text-slate-500">
            <div className="flex justify-between">
              <span>Format</span>
              <span className="text-slate-400">PNG · Lossless (quality 1.0)</span>
            </div>
            <div className="flex justify-between">
              <span>Compression</span>
              <span className="text-slate-400">DEFLATE level 6</span>
            </div>
            <div className="flex justify-between">
              <span>Filename</span>
              <span className="text-slate-400">divya_styler_lyrics.zip</span>
            </div>
            <div className="flex justify-between">
              <span>Frame naming</span>
              <span className="text-slate-400">lyrics_001.png … lyrics_NNN.png</span>
            </div>
            <div className="flex justify-between">
              <span>Frame pause</span>
              <span className="text-slate-400">30 ms / frame (UI-safe)</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Action Buttons ────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 pt-1">
        {/* Primary: Export */}
        {(phase === 'idle') && (
          <button
            onClick={runExport}
            disabled={!canExport}
            className={`w-full py-3 px-4 rounded-xl font-mono font-bold text-sm tracking-wider transition-all duration-200 flex items-center justify-center gap-2
              ${canExport
                ? 'bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-black shadow-[0_0_20px_rgba(251,191,36,0.3)] hover:shadow-[0_0_28px_rgba(251,191,36,0.45)] active:scale-[0.98]'
                : 'bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700'
              }`}
          >
            <span className="text-base">🎬</span>
            {canExport
              ? `EXPORT ${textChunks.length} FRAMES`
              : textChunks.length === 0
              ? 'NO CHUNKS LOADED'
              : 'CANVAS NOT READY'}
          </button>
        )}

        {/* Cancel during active processing */}
        {isActive && (
          <button
            onClick={handleCancel}
            className="w-full py-2.5 px-4 rounded-xl border border-red-500/30 bg-red-500/5 hover:bg-red-500/10 text-red-400 font-mono font-semibold text-sm tracking-wider transition-colors"
          >
            ✕ CANCEL EXPORT
          </button>
        )}

        {/* Reset after any settled state */}
        {isSettled && (
          <button
            onClick={handleReset}
            className="w-full py-2.5 px-4 rounded-xl border border-slate-700 bg-slate-800/40 hover:bg-slate-800 text-slate-400 font-mono font-semibold text-sm tracking-wider transition-colors"
          >
            ↩ RESET
          </button>
        )}

        {/* Re-export shortcut on success */}
        {phase === 'done' && (
          <button
            onClick={() => { handleReset(); setTimeout(runExport, 50); }}
            className="w-full py-2.5 px-4 rounded-xl border border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10 text-amber-400 font-mono font-semibold text-sm tracking-wider transition-colors flex items-center justify-center gap-2"
          >
            <span>↺</span> RE-EXPORT
          </button>
        )}
      </div>

    </div>
  );
};

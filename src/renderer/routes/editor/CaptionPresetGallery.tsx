import { useEffect, useRef } from 'react'
import type { CaptionPreset } from '../../../shared/captionPreset'
import { listCaptionPresets } from '../../../shared/captionPresetRegistry'
import { registerCaptionCategoryTemplates } from '../../../shared/captionCategoryTemplates'
import {
  SAMPLE_CAPTION_TEXT,
  drawPresetCaption,
  presetToTextDrawSpec
} from './preview/captionTextRender'

// Ensure the P5.9 lower-third / title-card category templates are present in the
// shared registry before the gallery reads it. Idempotent — safe at module load.
registerCaptionCategoryTemplates()

/** Thumbnail backing-store size — small + cheap; CSS upscales to fill the card. */
const THUMB_W = 220
const THUMB_H = 96
/** Card backdrop so light text on a transparent preset is still visible. */
const THUMB_BACKDROP = '#0b0d12'

interface CaptionPresetGalleryProps {
  /**
   * The currently-applied preset id (`project.captions.styleId`), highlighted as
   * active. `undefined`/unknown id → nothing highlighted.
   */
  activePresetId?: string
  /**
   * Selection hook for P5.4 ("apply preset to track"). Called with the clicked
   * preset's id (and the preset object for convenience). P5.3 only wires the
   * callback + active highlight; the real apply (setting `captions.styleId` +
   * stamping clips) lands in P5.4 by passing an `onSelect` that dispatches it.
   */
  onSelect?: (presetId: string, preset: CaptionPreset) => void
}

/**
 * Caption preset gallery (P5.3 — Doc 03; skills `text-render` + `preview-compositor`).
 *
 * Renders ONE live thumbnail per preset from {@link listCaptionPresets} (the
 * single source of truth). Each thumbnail draws the sample caption through the
 * SHARED caption text-render path ({@link drawPresetCaption}) so it is faithful
 * to what applying the preset produces — same font/fill/stroke/shadow/background
 * the live preview uses, not a hand-rolled lookalike.
 *
 * Selection: clicking a card calls `onSelect(presetId, preset)` and the card
 * matching `activePresetId` is highlighted. The actual track apply is P5.4 — a
 * parent passes an `onSelect` that dispatches the apply command.
 */
export function CaptionPresetGallery({
  activePresetId,
  onSelect
}: CaptionPresetGalleryProps): JSX.Element {
  const presets = listCaptionPresets()

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-text-primary">Caption styles</span>
      <ul role="listbox" aria-label="Caption style presets" className="flex flex-col gap-2">
        {presets.map((preset) => (
          <PresetThumbnail
            key={preset.id}
            preset={preset}
            active={preset.id === activePresetId}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </div>
  )
}

interface PresetThumbnailProps {
  preset: CaptionPreset
  active: boolean
  onSelect?: (presetId: string, preset: CaptionPreset) => void
}

/** One selectable card: a live preset-styled canvas + the preset displayName. */
function PresetThumbnail({ preset, active, onSelect }: PresetThumbnailProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // Repaint when the preset (its visual fields) changes. The draw goes through
  // the SAME spec + draw routine the live preview uses (parity).
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const ctx = canvas.getContext('2d')
    if (ctx === null) return
    const spec = presetToTextDrawSpec(preset)
    drawPresetCaption(ctx, spec, {
      width: THUMB_W,
      height: THUMB_H,
      lines: [SAMPLE_CAPTION_TEXT],
      backdrop: THUMB_BACKDROP
    })
  }, [preset])

  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={active}
        title={`Apply "${preset.displayName}" caption style`}
        onClick={() => onSelect?.(preset.id, preset)}
        className={`flex w-full flex-col gap-1 overflow-hidden rounded-md border bg-surface-2 p-1 text-left transition-colors ${
          active ? 'border-accent ring-1 ring-accent' : 'border-line hover:border-accent-hover'
        }`}
      >
        <canvas
          ref={canvasRef}
          width={THUMB_W}
          height={THUMB_H}
          aria-hidden
          className="h-16 w-full rounded-sm"
          style={{ width: '100%', height: '4rem', objectFit: 'cover' }}
        />
        <span className="flex items-center justify-between px-1 pb-0.5">
          <span className="text-xs font-medium text-text-primary">{preset.displayName}</span>
          <span className="text-[10px] uppercase tracking-wide text-text-muted">
            {preset.category}
          </span>
        </span>
      </button>
    </li>
  )
}

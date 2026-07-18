import { useEffect, useRef, useState } from 'react'
import type { ClipTransform } from '../../../../shared/project-schema'
import type { Clip, Project, ProjectRef } from '../../../../shared/storage'
import { useProjectStore } from '@/store/projectStore'
import { useTimelineStore } from '@/store/timelineStore'
import {
  type DrawItem,
  clipSourceTime,
  computeDrawRect,
  computeDrawTransform,
  visibleClipsAt,
  getTransitionModifier
} from './compositor'
import { drawKindFromMediaRef, mediaRefToUrl } from './mediaSource'
import {
  layoutArcClusters,
  layoutGlyphBoxes,
  layoutTextLines,
  layoutWordsInLine,
  lineClusters,
  measuredLineWidth,
  textBlockSize,
  type TextAlign
} from './textLayout'
import { resolveTextFont, fontShorthandWithList, resolveFontForRun } from './textFontSpec'
import { detectScript } from '../../../../shared/scriptDetect'
import {
  DEFAULT_TEXT_FILL,
  fillToCanvasPaint,
  normalizeTextRuns,
  runColorForWord,
  resolveTextFill
} from './textFillSpec'
import { hasStroke, resolveTextStroke } from './textStrokeSpec'
import { hasShadow, resolveTextShadow } from './textShadowSpec'
import {
  drawDecorationBackground,
  drawDecorationRules,
  drawHighlightBars,
  hasHighlightBars,
  hasRules,
  resolveDecoration
} from './textDecorationSpec'
import { paintGlyphPasses } from './textPaintPipeline'
import { normalizeTextEffects } from '../../../../shared/textEffect'
import { composeEffectsPass } from './textEffectsPipeline'
import { registerBuiltinEffects } from './textEffectsBuiltin'

// Populate the Phase-7 effect-renderer registry once at module load. The SAME call
// runs in the export engine setup so preview and export share one set of renderers.
registerBuiltinEffects()
import { DEFAULT_FONT_FAMILY } from '../../../../shared/fontRegistry'
import { evaluateClipReveal, revealedWordText } from '@/store/timeline/captionReveal'
import { evaluateClipAnimation, composeSamples } from '@/store/timeline/clipAnimation'
// Keyframe-driven props (P8.7 — Doc 11): sample `clip.keyframes` at the CLIP-LOCAL
// playhead and compose its x/y/scale/rotation/opacity delta with the in/out/loop
// animation sample (keyframes → animation) before folding onto the base transform.
import { sampleClipKeyframeSample, motionPathSample } from '@/store/timeline/keyframeSampler'
import { trackingSample } from '@/store/timeline/trackingSampler'
import { clipDuration } from '../../../../shared/project-schema'
// Populate the In-preset catalog (P8.2) into the shared animation registry at
// module load, the same way `registerBuiltinEffects()` wires the effect renderers.
// Importing the catalog module runs its `registerInPresets()` side-effect.
import { registerInPresets } from '@/store/timeline/clipAnimationPresetsIn'
registerInPresets()
// Populate the Out-preset catalog (P8.3) into the same shared animation registry.
import { registerOutPresets } from '@/store/timeline/clipAnimationPresetsOut'
registerOutPresets()
// Populate the Loop-preset catalog (P8.4) into the same shared animation registry.
import { registerLoopPresets } from '@/store/timeline/clipAnimationPresetsLoop'
registerLoopPresets()
import { evaluateClipHighlight, splitWipe } from '@/store/timeline/captionHighlight'
import { cueDrawStyle } from '@/store/timeline/captionCue'
import type { PresetHighlight, PresetReveal } from '../../../../shared/captionPreset'
import { getCaptionPreset } from '../../../../shared/captionPresetRegistry'

interface PreviewCanvasProps {
  /** The open project document — the single source of truth for tracks. */
  project: Project
  /**
   * Report the intrinsic (source) pixel size of every clip drawn this frame,
   * keyed by clip id. The interaction overlay (P3.11) uses these to hit-test
   * which clip is under the pointer and to compute drawn bounds. Called after
   * each paint with the decoded sizes currently available.
   */
  onDrawnSizes?: (sizes: Map<string, { width: number; height: number }>) => void
}

/** A drawable media source with its intrinsic pixel size. */
interface Drawable {
  element: CanvasImageSource
  width: number
  height: number
}

/**
 * Text-render DEFAULTS (P6.3). A text clip's typography now comes from
 * `clip.text.font` (family / size / bold / italic / letterSpacing / lineHeight),
 * resolved via {@link resolveTextFont}; these defaults fill any field a clip omits
 * so a bare "Add Text" clip still renders (Tamil-capable global default family,
 * Doc 08 / Doc 16). FILL (P6.7) now resolves from `clip.text.fill` via the shared
 * {@link resolveTextFill} (solid hex + opacity, with gradient/per-word designed in);
 * a clip without an explicit fill falls back to {@link DEFAULT_TEXT_FILL} (white).
 */
const TEXT_DEFAULT_FONT_PX = 64
const TEXT_LINE_HEIGHT_MULT = 1.2

/**
 * The composited preview surface (P3.9). A 2D canvas sized to the project
 * resolution; CSS letterboxes it into the stage without distortion. Draws the
 * VIDEO + IMAGE clips visible at the timeline playhead, applying each clip's
 * static transform. The pure pipeline lives in `compositor.ts` (export parity);
 * this component owns only the canvas/<img>/<video> side-effects.
 */
export function PreviewCanvas({ project, onDrawnSizes }: PreviewCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const currentRef = useProjectStore((s) => s.currentRef)
  const playhead = useTimelineStore((s) => s.playhead)
  const isPlaying = useTimelineStore((s) => s.isPlaying)
  const previewQuality = useTimelineStore((s) => s.previewQuality)
  // While inline-editing, the textarea overlay is the single source of visible
  // text for that clip; suppress the canvas text draw for the same clip to avoid
  // duplicate-overlap visuals.
  const editingTextClipId = useTimelineStore((s) => s.editingTextClipId)
  // Transient live drag-preview (P3.11): when present, the matching clip is
  // drawn at this in-progress center offset WITHOUT a command. Committed on
  // pointer-up by the interaction overlay.
  const dragTransform = useTimelineStore((s) => s.dragTransform)

  const [bundleAbs, setBundleAbs] = useState<string | null>(null)

  // Decoded-media caches keyed by app-media URL. Refs (not state) so the render
  // loop reads them without re-subscribing. A bump counter forces a paused
  // redraw once async media (image decode / video seek) becomes available.
  const images = useRef(new Map<string, HTMLImageElement>())
  const videos = useRef(new Map<string, HTMLVideoElement>())
  const [revision, setRevision] = useState(0)

  const [fullWidth, fullHeight] = project.settings.resolution
  // Preview quality (P3.10) scales ONLY the canvas backing-store pixel density,
  // never the compositor math: half renders the same composited frame into a
  // half-resolution buffer that the `objectFit: contain` letterbox upscales to
  // the same on-screen size — cheaper to paint while scrubbing/playing.
  const qualityScale = previewQuality === 'half' ? 0.5 : 1
  const width = Math.max(1, Math.round(fullWidth * qualityScale))
  const height = Math.max(1, Math.round(fullHeight * qualityScale))
  const pausedPlayhead = isPlaying ? null : playhead

  // Resolve + cache the bundle absolute path (needed to build app-media URLs).
  useEffect(() => {
    let cancelled = false
    if (currentRef === null) {
      setBundleAbs(null)
      return
    }
    void resolveBundlePath(currentRef).then((path) => {
      if (!cancelled) setBundleAbs(path)
    })
    return () => {
      cancelled = true
    }
  }, [currentRef])

  // Redraw once bundled fonts (Baloo Thambi 2 / Noto Indic) finish loading into
  // document.fonts — they arrive async at startup, so the first paint may use a
  // fallback face until they're ready. `loadingdone` fires per batch; fonts.ready
  // covers the already-resolved case. Bumping `revision` re-runs the render effect.
  useEffect(() => {
    if (typeof document === 'undefined' || document.fonts === undefined) return
    const bump = (): void => setRevision((r) => r + 1)
    const fonts = document.fonts as FontFaceSet & {
      addEventListener?: (t: string, cb: () => void) => void
      removeEventListener?: (t: string, cb: () => void) => void
    }
    fonts.addEventListener?.('loadingdone', bump)
    void fonts.ready.then(bump)
    return () => fonts.removeEventListener?.('loadingdone', bump)
  }, [])

  // Tear down media when the bundle changes so nothing leaks across opens.
  useEffect(() => {
    const imgMap = images.current
    const vidMap = videos.current
    return () => {
      imgMap.clear()
      vidMap.forEach((v) => {
        v.pause()
        v.removeAttribute('src')
        v.load()
      })
      vidMap.clear()
    }
  }, [bundleAbs])

  // The render loop. While playing, draw every animation frame (videos run via
  // .play()). While paused/scrubbing, draw once per playhead/track change and
  // seek videos to the exact source time; a `revision` bump redraws once async
  // media is ready.
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || bundleAbs === null) return
    const ctx = canvas.getContext('2d')
    if (ctx === null) return

    // Text (caption) clips are composited on their OWN transparent layer, then
    // blitted over the background. Effects like the 3D extrusion wall / glow /
    // echo paint with `destination-over` (they slide BEHIND the glyph); drawn
    // straight onto the main canvas they'd land behind the opaque background and
    // vanish. Isolating them on a transparent layer makes them visible AND makes
    // the preview match the transparent export overlay (parity). Cached per
    // effect-run (recreated only when the size/effect deps change).
    const textLayer = document.createElement('canvas')
    textLayer.width = canvas.width
    textLayer.height = canvas.height
    const textCtx = textLayer.getContext('2d')

    let rafId = 0
    let disposed = false

    const bumpWhenReady = (): void => {
      if (!disposed) setRevision((r) => r + 1)
    }

    const renderAt = (t: number): void => {
      // Draw order (back-to-front): visual (video/image) + text clips share the
      // same `visibleClipsAt` ordering (track then z); we split by track type so
      // each kind uses its own draw path, but paint visual first then text.
      const all = visibleClipsAt(project.tracks, t)
      const items = all.filter(isVisualClip)
      const textItems = all.filter(isTextClip)
      const drawables = new Map<string, Drawable | null>()
      const sizes = new Map<string, { width: number; height: number }>()
      for (const { clip } of items) {
        const url = mediaRefToUrl(bundleAbs, clip.mediaRef)
        const drawable = ensureDrawable(
          clip,
          url,
          t,
          isPlaying,
          images.current,
          videos.current,
          bumpWhenReady
        )
        drawables.set(clip.id, drawable)
        if (drawable !== null) sizes.set(clip.id, { width: drawable.width, height: drawable.height })
      }
      pauseHiddenVideos(items, bundleAbs, videos.current)
      drawFrame(ctx, width, height, items, drawables, dragTransform, t)
      // Text path (P3.14): measure → layout → fillText per line, applying the
      // same transform math. Reports each text clip's intrinsic block size so
      // the interaction overlay can hit-test + draw its selection box.
      //
      // Active-word highlight (P5.6) reads the highlight config LIVE from the
      // active preset (looked up by `captions.styleId`) — NOT denormalized onto
      // the clip — so changing the preset re-colors the active word with no clip
      // rewrite (P5.1 contract). Resolve it once per frame.
      const styleId = project.captions?.styleId
      const presetHighlight =
        styleId !== undefined ? getCaptionPreset(styleId)?.highlight : undefined
      // Render text onto the transparent layer (so `destination-over` effects
      // composite correctly), then blit it over the background. Fall back to the
      // main ctx if the layer context is unavailable.
      const drawCtx = textCtx ?? ctx
      if (textCtx !== null) textCtx.clearRect(0, 0, width, height)
      drawTextClips(
        drawCtx,
        width,
        height,
        textItems,
        dragTransform,
        sizes,
        t,
        presetHighlight,
        editingTextClipId
      )
      if (textCtx !== null) ctx.drawImage(textLayer, 0, 0)
      if (onDrawnSizes !== undefined) onDrawnSizes(sizes)
    }

    if (isPlaying && typeof requestAnimationFrame !== 'undefined') {
      // During playback the rAF loop reads playhead directly from the store on
      // each tick — we must NOT include `playhead` in the deps or React will
      // tear down + recreate this effect every frame, blanking the canvas.
      const tick = (): void => {
        if (disposed) return
        renderAt(useTimelineStore.getState().playhead)
        rafId = requestAnimationFrame(tick)
      }
      rafId = requestAnimationFrame(tick)
    } else {
      renderAt(pausedPlayhead ?? useTimelineStore.getState().playhead)
    }

    return () => {
      disposed = true
      if (rafId !== 0) cancelAnimationFrame(rafId)
    }
  }, [
    project,
    bundleAbs,
    // `playhead` is intentionally EXCLUDED while playing. `pausedPlayhead` is
    // null during playback (stable dep), and equals `playhead` while paused so
    // scrubs trigger redraws.
    pausedPlayhead,
    isPlaying,
    revision,
    width,
    height,
    dragTransform,
    onDrawnSizes,
    editingTextClipId
  ])

  return (
    <canvas
      ref={canvasRef}
      data-testid="preview-canvas"
      width={width}
      height={height}
      className="rounded-lg"
      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
    />
  )
}

/**
 * Clip-local PROGRESS 0→1 for the motion-path sampler: `(t - clip.start) /
 * clipDuration`, clamped. A zero-duration clip is progress 0 (the path start).
 * The path drives the clip ACROSS its life, so this is what `sampleMotionPath`
 * consumes (the keyframe sampler uses clip-local SECONDS instead).
 */
function clipLocalProgress(clip: Clip, t: number): number {
  const dur = clipDuration(clip)
  if (!(dur > 0)) return 0
  const p = (t - clip.start) / dur
  return p < 0 ? 0 : p > 1 ? 1 : p
}

/** Only video/image clips on visual tracks are drawn by the media path. */
function isVisualClip(item: DrawItem): boolean {
  return item.track.type === 'video'
}

/** Text clips (P3.14) on `text`-type tracks are drawn by the text path. */
function isTextClip(item: DrawItem): boolean {
  return item.track.type === 'text'
}

/** Resolve a project ref's bundle absolute path via the storage IPC bridge. */
async function resolveBundlePath(ref: ProjectRef): Promise<string | null> {
  try {
    const result = await window.api.invoke('storage:resolvePath', { ref })
    return result.ok ? result.data.path : null
  } catch {
    return null
  }
}

/**
 * Return a decoded drawable for a clip at time `t`, creating + caching the
 * underlying <img>/<video> on first sight. Returns null while the media is
 * still loading; `onReady` is wired to redraw once it becomes available.
 *
 * Video: seek to `clipSourceTime` when paused/scrubbing; `.play()` when the
 * timeline is playing so the element advances with the wall clock.
 */
function ensureDrawable(
  clip: Clip,
  url: string,
  t: number,
  isPlaying: boolean,
  images: Map<string, HTMLImageElement>,
  videos: Map<string, HTMLVideoElement>,
  onReady: () => void
): Drawable | null {
  if (drawKindFromMediaRef(clip.mediaRef) === 'image') {
    let img = images.get(url)
    if (img === undefined) {
      img = new Image()
      img.crossOrigin = 'anonymous'
      img.addEventListener('load', onReady, { once: true })
      img.addEventListener('error', () => {
        // Remove from cache so a subsequent render attempt can retry.
        images.delete(url)
      }, { once: true })
      img.src = url
      images.set(url, img)
    }
    if (img.complete && img.naturalWidth > 0) {
      return { element: img, width: img.naturalWidth, height: img.naturalHeight }
    }
    return null
  }

  let video = videos.get(url)
  if (video === undefined) {
    video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = clip.audio?.muted ?? false
    video.volume = Math.min(1, Math.max(0, clip.audio?.gain ?? 1))
    video.playsInline = true
    video.preload = 'auto'
    video.src = url
    video.addEventListener('loadeddata', onReady)
    video.addEventListener('seeked', onReady)
    video.addEventListener('error', () => {
      videos.delete(url)
    }, { once: true })
    videos.set(url, video)
  }

  // Keep runtime audio mix in sync with clip edits while reusing the cached element.
  video.muted = clip.audio?.muted ?? false
  video.volume = Math.min(1, Math.max(0, clip.audio?.gain ?? 1))

  const rawSource = clipSourceTime(clip, t)
  // Wrap the source time for clips extended beyond their source duration so the
  // video loops rather than freezing on the last frame. vDur is only finite once
  // the element has loaded metadata; before that, rawSource is used directly.
  const vDur = video.duration
  let source = rawSource
  if (Number.isFinite(vDur) && vDur > 0.001 && rawSource > vDur) {
    const loopLen = vDur - clip.in
    if (loopLen > 0.001) source = clip.in + ((rawSource - clip.in) % loopLen)
  }
  if (isPlaying) {
    if (video.ended) {
      // Video reached its natural end but the clip is still visible — loop.
      try { video.currentTime = Math.max(0, source) } catch { /* ignore */ }
      void video.play().catch(() => undefined)
    } else if (video.paused) {
      void video.play().catch(() => undefined)
    }
  } else {
    if (!video.paused) video.pause()
    if (Number.isFinite(source) && Math.abs(video.currentTime - source) > 1 / 120) {
      try {
        video.currentTime = Math.max(0, source)
      } catch {
        /* not ready yet; a later frame / seeked event will redraw */
      }
    }
  }

  if (video.readyState >= 2 && video.videoWidth > 0) {
    return { element: video, width: video.videoWidth, height: video.videoHeight }
  }
  return null
}

/** Pause videos whose clips are not visible at the current playhead. */
function pauseHiddenVideos(
  items: readonly DrawItem[],
  bundleAbs: string,
  videos: Map<string, HTMLVideoElement>
): void {
  const visible = new Set(
    items
      .filter(({ clip }) => drawKindFromMediaRef(clip.mediaRef) === 'video')
      .map(({ clip }) => mediaRefToUrl(bundleAbs, clip.mediaRef))
  )
  videos.forEach((video, url) => {
    if (!visible.has(url) && !video.paused) video.pause()
  })
}

/**
 * Paint the composited frame: fill the background, then draw each visible clip
 * with its static transform (translate → rotate → scale-with-flip → alpha).
 */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  items: readonly DrawItem[],
  drawables: ReadonlyMap<string, Drawable | null>,
  dragTransform: { clipId: string; patch: Partial<ClipTransform> } | null,
  t: number
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.clearRect(0, 0, width, height)

  for (const { clip, track } of items) {
    const source = drawables.get(clip.id)
    if (source === undefined || source === null) continue

    // Live gesture-preview: merge the transient patch for the active clip
    // (no command). P3.11 move patches {x,y}; P3.12 rotate patches {rotation}.
    const transform =
      dragTransform !== null && dragTransform.clipId === clip.id
        ? { ...clip.transform, ...dragTransform.patch }
        : clip.transform
    const dt = computeDrawTransform(transform, [width, height])
    const rect = computeDrawRect(source.width, source.height, width, height)

    // Clip ANIMATION (P8.1) + KEYFRAMES (P8.7) composed onto the base transform.
    // Keyframes sample at CLIP-LOCAL time (`t - clip.start`); the keyframe sample is
    // composed BEFORE the in/out/loop sample (keyframes → animation). x/y add to the
    // translate, scale multiplies, rotation adds (deg→rad in the sampler), opacity
    // multiplies. No keyframes + no animation → identity → unchanged draw.
    const anim = evaluateClipAnimation({
      animation: clip.animation,
      start: clip.start,
      end: clip.start + clipDuration(clip),
      t
    })
    const kfSample = sampleClipKeyframeSample(clip.keyframes, t - clip.start)
    // Custom MOTION PATH (P8.8): sample the drawn path at CLIP-LOCAL progress
    // ((t - start)/duration, 0→1) → an x/y translate offset, composed AFTER the
    // keyframes and BEFORE the in/out/loop sample. No path → identity (no offset).
    const pathSample = motionPathSample(clip.motionPath, clipLocalProgress(clip, t))
    // Motion TRACKING (P8.10): when enabled, offset the transform so the clip sticks
    // to the tracked subject at clip-local time (`t - clip.start`) — composed AFTER
    // the motion path and BEFORE the in/out/loop sample. No tracking → identity.
    const trackSample = trackingSample(clip.tracking, t - clip.start)
    const clipSample = composeSamples(
      composeSamples(composeSamples(kfSample, pathSample), trackSample),
      anim.clip
    )

    const trans = getTransitionModifier(track, clip.id, t)

    ctx.save()
    ctx.globalAlpha = dt.alpha * clipSample.opacity * trans.opacity
    ctx.translate(dt.translateX + clipSample.tx + trans.tx, dt.translateY + clipSample.ty + trans.ty)
    ctx.rotate(dt.rotation + clipSample.rotation)
    ctx.scale(dt.scaleX * clipSample.scale * trans.scale, dt.scaleY * clipSample.scale * trans.scale)
    ctx.drawImage(source.element, rect.x, rect.y, rect.width, rect.height)
    ctx.restore()
  }
}

/**
 * Set the canvas `letterSpacing` (tracking) in px where the impl supports it
 * (Chromium/Electron do; jsdom/node-canvas may not). When unsupported the
 * pure-math `measuredLineWidth` / per-cluster geometry still keeps measure +
 * layout correct; only the painted glyph advance falls back to the default 0.
 */
function setLetterSpacing(ctx: CanvasRenderingContext2D, px: number): void {
  if (!('letterSpacing' in ctx)) return
  try {
    ; (ctx as unknown as { letterSpacing: string }).letterSpacing = `${px}px`
  } catch {
    /* unsupported value — leave the canvas default */
  }
}

/**
 * Per-token painting (shadow → stroke → fill → inner shadow → effects → highlight)
 * is owned by the SINGLE canonical pipeline in `textPaintPipeline.ts`
 * ({@link paintGlyphPasses}). P6.15 locks that order and makes EVERY branch below
 * (and the thumbnail renderer) route through it, so no branch can drift out of
 * order and Phase 7 effects have exactly one documented insertion point. The
 * branches here only compute each token's text + position and supply the fill
 * (base/gradient/per-word/active color) the pipeline invokes for the body pass.
 */

/**
 * Paint visible TEXT clips. For each clip: resolve the typography from
 * `clip.text.font` ({@link resolveTextFont} — family/size/bold/italic/
 * letterSpacing/lineHeight, P6.3), set `ctx.font` to the resolved shorthand and
 * `ctx.letterSpacing` to the tracking, MEASURE every line via `ctx.measureText`
 * (letterSpacing folded in by the pure `measuredLineWidth`), lay them out with
 * `layoutTextLines` (lineHeight drives stacking, letterSpacing widens lines),
 * then `fillText` each line at the clip's transform origin.
 *
 * letterSpacing affects BOTH the measured block + per-line/word geometry AND the
 * painted advance (set on the context, with a manual per-cluster fallback when a
 * canvas impl lacks `ctx.letterSpacing`), so preview = export.
 *
 * Reports each clip's intrinsic (unscaled) text-block size into `sizes` so the
 * interaction overlay's `clipBoundsAt` (which scales by `transform.scale`)
 * hit-tests + draws the selection box correctly.
 *
 * DEFERRED: fill/stroke/shadow from `clip.text.fill/stroke/shadow`, effects, and
 * automatic word-wrap. Manual `text.lines` + `text.align` + `text.font` drive this.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function drawTextClips(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  items: readonly DrawItem[],
  dragTransform: { clipId: string; patch: Partial<ClipTransform> } | null,
  sizes: Map<string, { width: number; height: number }>,
  t: number,
  presetHighlight?: PresetHighlight,
  skipClipId?: string | null
): void {
  for (const { clip, track } of items) {
    // IMPORTANT: when inline-editing, we suppress PAINT for that clip to avoid
    // double text, but we MUST still compute/report its intrinsic block size so
    // TextEditOverlay can resolve bounds and mount the textarea.
    const skipPaint = skipClipId !== undefined && skipClipId !== null && clip.id === skipClipId
    const lines = clip.text?.lines ?? []
    const align: TextAlign = clip.text?.align ?? 'center'

    // Resolve the clip's typography (P6.3): family/size/bold/italic/spacing/lineHeight.
    const font = resolveTextFont(clip.text?.font, {
      family: DEFAULT_FONT_FAMILY,
      sizePx: TEXT_DEFAULT_FONT_PX,
      lineHeight: TEXT_LINE_HEIGHT_MULT
    })
    const fontPx = font.sizePx
    const lineHeightMult = font.lineHeight
    const letterSpacing = font.letterSpacing
    // Per-script font resolution (P6.17 — indic-text): detect the run's dominant
    // script from the clip's text, then build a CSS family list where a font that
    // COVERS that script leads (Tamil text → a Tamil-capable family first) ending
    // in a Latin family + generic — so Tamil/Telugu/etc. never tofu even when the
    // chosen `family` lacks the script's glyphs. One helper for preview + export.
    const runScript = detectScript(lines.join('\n'))
    const familyList = resolveFontForRun(font, runScript)
    const fontShorthand = fontShorthandWithList(font, familyList)

    // Resolve the clip's FILL (P6.7): a solid hex + opacity baked to rgba (or a
    // gradient stop list). The SAME shared resolver the thumbnail uses, so a color
    // change paints identically in preview + export. `fillToCanvasPaint` turns it
    // into a ctx-ready paint below (after the block width is known for gradients).
    const fillSpec = resolveTextFill(clip.text?.fill, DEFAULT_TEXT_FILL)
    // Resolve the clip's STROKE (P6.10): an ordered layer list `[{color,width}]`
    // (a single stroke = one layer), baked to rgba + sorted WIDEST-first by the
    // shared resolver — the SAME the thumbnail + export use. Painted UNDER the fill
    // (stroke first, fill on top) so the outline frames the glyph. `hollow` (P6.12)
    // would skip the fill; a single P6.10 stroke is solid-bodied (hollow = false).
    const strokeSpec = resolveTextStroke(clip.text?.stroke)
    const strokeOn = hasStroke(strokeSpec)
    // Resolve the clip's SHADOW (P6.13): color+opacity+blur+angle(±180°)+distance →
    // canvas `shadow*` params, baked by the SAME shared resolver the thumbnail +
    // export use (one geometry). `null` = no shadow (distance 0 / absent). Cast as a
    // dedicated pre-pass BEFORE fill/stroke (the SHADOW step of shadow→fill→stroke),
    // so the glyph casts exactly one shadow (no doubling across passes).
    const shadowSpec = resolveTextShadow(clip.text?.shadow)
    const shadowOn = hasShadow(shadowSpec)
    // Resolve the clip's EFFECTS stack (P7.1 — Doc 04): an ORDERED `text.effects[]`
    // composed OVER the base glyph at the canonical pass-5 hook (P6.15). Normalize the
    // open bag to a typed, valid `TextEffect[]` (order preserved; malformed entries
    // dropped), then build the single `EffectsPass` the pipeline runs after
    // shadow+stroke+fill+inner and before the highlight. `undefined` when there is no
    // active/implemented effect → the pipeline runs its no-op (output unchanged).
    const effectsPass = composeEffectsPass(normalizeTextEffects(clip.text?.effects))
    // Resolve the clip's DECORATIONS (P7.8 — Doc 05): today the background BUBBLE,
    // a rounded rect (color+opacity+padding+radius) behind the WHOLE measured text
    // block. The SAME shared resolver the thumbnail uses, baked to rgba, so it
    // paints identically (preview = export). Drawn BEHIND the text (before the
    // shadow/stroke/fill glyph passes), above the clip background (P7.12 order).
    const decoration = resolveDecoration(clip.text?.decoration)
    // Master opacity a per-word (P6.9) color override is baked at — read straight
    // from the clip fill so a run color honors the same opacity as the base fill.
    const rawOpacity = clip.text?.fill?.opacity
    const fillOpacity =
      typeof rawOpacity === 'number' && Number.isFinite(rawOpacity)
        ? Math.max(0, Math.min(1, rawOpacity))
        : DEFAULT_TEXT_FILL.opacity

    // Measure with the resolved font (set it AND letterSpacing before measuring so
    // a letterSpacing-aware `ctx.measureText` matches the painted advance).
    ctx.font = fontShorthand
    setLetterSpacing(ctx, letterSpacing)
    const measure = (line: string): number => ctx.measureText(line).width
    const block = textBlockSize(lines, fontPx, lineHeightMult, measure, letterSpacing)
    // Report a minimum 1×lineHeight box so an all-empty clip is still selectable.
    const minH = fontPx * lineHeightMult
    sizes.set(clip.id, {
      width: Math.max(block.w, fontPx),
      height: Math.max(block.h, minH)
    })

    if (skipPaint) continue

    const transform =
      dragTransform !== null && dragTransform.clipId === clip.id
        ? { ...clip.transform, ...dragTransform.patch }
        : clip.transform
    const dt = computeDrawTransform(transform, [width, height])
    // Clip ANIMATION (P8.1): in/out/loop transform + opacity offsets, evaluated at
    // the playhead. Composes ON TOP of the clip's static transform (`dt`): opacity
    // multiplies the alpha; tx/ty add to the translate; scale multiplies; rotation
    // adds. With no `clip.animation` configured this is the IDENTITY sample, so the
    // applied values equal `dt` and existing rendering is unchanged (no-op).
    const anim = evaluateClipAnimation({
      animation: clip.animation,
      start: clip.start,
      end: clip.start + clipDuration(clip),
      t
    })
    // Keyframe sample (P8.7): convert the playhead to CLIP-LOCAL time (`t -
    // clip.start`), sample `clip.keyframes` (x/y add to translate; scale multiplies;
    // rotation adds — keyframe deg already converted to radians by the sampler;
    // opacity multiplies), and COMPOSE it with the in/out/loop sample in the
    // documented order (keyframes → animation). No keyframes → identity (no change).
    const kfSample = sampleClipKeyframeSample(clip.keyframes, t - clip.start)
    // Custom MOTION PATH (P8.8): drawn-path x/y translate offset at clip-local
    // progress, composed keyframes → motion path → animation. No path → identity.
    const pathSample = motionPathSample(clip.motionPath, clipLocalProgress(clip, t))
    // Motion TRACKING (P8.10): subject-follow offset (+ manual anchor + jitter
    // smoothing) at clip-local time, composed motion path → tracking → animation.
    // No tracking / disabled → identity, so an untracked text clip is unchanged.
    const trackSample = trackingSample(clip.tracking, t - clip.start)
    const clipSample = composeSamples(
      composeSamples(composeSamples(kfSample, pathSample), trackSample),
      anim.clip
    )
    const trans = getTransitionModifier(track, clip.id, t)
    const animAlpha = dt.alpha * clipSample.opacity * trans.opacity
    const animTranslateX = dt.translateX + clipSample.tx + trans.tx
    const animTranslateY = dt.translateY + clipSample.ty + trans.ty
    const animRotation = dt.rotation + clipSample.rotation
    const animScaleX = dt.scaleX * clipSample.scale * trans.scale
    const animScaleY = dt.scaleY * clipSample.scale * trans.scale
    const laid = layoutTextLines(lines, fontPx, lineHeightMult, align, measure, letterSpacing)

    // Reveal coupling (P5.5): a caption clip carries per-word timing in
    // `caption.words` and a reveal mode in `animation.reveal`. When the mode is
    // word/character we draw WORD-BY-WORD so each word's drawn alpha can be the
    // pure reveal evaluator's per-word opacity (words appear as the playhead
    // reaches their spoken time). Otherwise we draw the whole line as before.
    const reveal = clip.animation?.reveal as PresetReveal | undefined
    const captionWords = clip.caption?.words
    const wordReveal =
      reveal !== undefined &&
      (reveal.mode === 'word' || reveal.mode === 'character') &&
      captionWords !== undefined &&
      captionWords.length > 0

    // Active-word highlight (P5.6): when the active preset has highlight enabled
    // and this clip carries per-word timing, evaluate which word is active + its
    // animated color/scale/wipe. We draw word-by-word whenever EITHER the reveal
    // OR the highlight is per-word, so a karaoke wipe (reveal `none`) still gets a
    // per-word draw to color the active word.
    const highlightOn =
      presetHighlight !== undefined &&
      presetHighlight.enabled &&
      captionWords !== undefined &&
      captionWords.length > 0
    // A line containing any sound-effect CUE (P5.7) also needs the per-word path
    // so cues draw in the distinct cue style even with reveal `none` + no highlight.
    const hasCue =
      captionWords !== undefined && captionWords.length > 0 && captionWords.some((w) => cueDrawStyle(w) !== null)
    // Per-word color (P6.9): a clip carrying `text.runs[i].color` overrides on words.
    // Normalize once (open bag → typed `TextRun[]`); a run color forces the per-word
    // path so the override renders even with no reveal/highlight/cue.
    const runs = normalizeTextRuns(clip.text?.runs)
    const hasRunColor =
      captionWords !== undefined && captionWords.length > 0 && runs.some((r) => typeof r.color === 'string')
    const perWordDraw = wordReveal || highlightOn || hasCue || hasRunColor

    ctx.save()
    ctx.globalAlpha = animAlpha
    ctx.translate(animTranslateX, animTranslateY)
    ctx.rotate(animRotation)
    ctx.scale(animScaleX, animScaleY)
    ctx.font = fontShorthand
    setLetterSpacing(ctx, letterSpacing)
    // Apply the resolved fill (P6.7): a solid rgba string or a gradient built across
    // the measured block width. This is the base fill for every line/word; the
    // per-word path may override it per run (P6.9 via `resolveRunColor`).
    const basePaint = fillToCanvasPaint(ctx, fillSpec, block.w, block.h)
    ctx.fillStyle = basePaint
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // Background BUBBLE (P7.8): drawn FIRST, BEHIND every glyph pass, framing the
    // WHOLE measured text block. The block box is centered on the transform origin
    // (the same origin the lines stack around), so the rounded rect tightly frames
    // text + padding across multi-line text. Above the clip bg, beneath the glyphs
    // (and beneath effects, since effects compose during the glyph passes) — P7.12.
    // This whole block obeys the locked `DECORATION_RENDER_ORDER` (textDecorationSpec),
    // the SINGLE documented order shared with the thumbnail/export path
    // (`drawPresetCaption`): clip-bg → bubble → bars → [glyphs incl. effects] → rules.
    drawDecorationBackground(ctx, decoration.background, {
      x: -block.w / 2,
      y: -block.h / 2,
      width: block.w,
      height: block.h
    })

    // Highlight BARS (P7.10 — Doc 05): the marker/highlighter look — colored rounded
    // rects behind the glyphs, ONE per WORD box (per-word) or ONE per LINE box
    // (full-line), framing the actual run bounds from `layoutGlyphBoxes`. Drawn AFTER
    // the background bubble and BEFORE the glyph passes (render order: clip-bg →
    // bubble → highlight bars → glyphs → underline/strike), so they read like a
    // highlighter PEN beneath the text. DISTINCT from the caption active-word
    // highlight (P5.6 `presetHighlight`) — this is a static `text.decoration` marker.
    if (hasHighlightBars(decoration)) {
      const barBoxes = layoutGlyphBoxes(
        lines,
        { fontSizePx: fontPx, lineHeightMult, align, letterSpacing },
        measure
      ).lines
      drawHighlightBars(ctx, decoration.highlight, barBoxes)
    }

    if (perWordDraw && captionWords !== undefined) {
      // Single caption line is the norm; align all words to the first laid line.
      const baseY = laid.length > 0 ? laid[0].y : 0
      // Reveal opacity (P5.5). With no per-word reveal (e.g. karaoke wipe) every
      // word is fully visible — evaluateClipReveal returns opacity 1 for `none`.
      const revealState = evaluateClipReveal({
        words: captionWords,
        reveal,
        clipStart: clip.start,
        t
      })
      // Active-word highlight (P5.6) — color/scale/wipe, read from the live preset.
      const highlight = evaluateClipHighlight({
        words: captionWords,
        highlight: presetHighlight,
        t
      })
      const isCharacter = reveal?.mode === 'character'
      const wordTexts = captionWords.map((w) => w.text)
      // WORD WRAP support: distribute the caption's words across the (possibly
      // wrapped) display `lines`, so each line's words render at that line's y.
      // `lines` came from word-wrap (`text.lines` chunked by N words); `laid`
      // carries each line's y. When the per-line word counts add up to the caption
      // word count we lay each line independently (centered); otherwise we fall
      // back to a single centered line (legacy behavior).
      const lineWordCounts = lines.map((ln) => (ln.trim() === '' ? 0 : ln.trim().split(/\s+/).length))
      const totalLineWords = lineWordCounts.reduce((a, b) => a + b, 0)
      const multiLine = lines.length > 1 && laid.length === lines.length && totalLineWords === wordTexts.length
      const placed: Array<{ word: string; x: number; width: number; y: number }> = []
      if (multiLine) {
        let wi = 0
        for (let li = 0; li < lines.length; li++) {
          const count = lineWordCounts[li]
          const lineY = laid[li]?.y ?? baseY
          const perLine = layoutWordsInLine(wordTexts.slice(wi, wi + count), measure, letterSpacing)
          for (const pw of perLine) placed.push({ ...pw, y: lineY })
          wi += count
        }
      } else {
        for (const pw of layoutWordsInLine(wordTexts, measure, letterSpacing)) {
          placed.push({ ...pw, y: baseY })
        }
      }
      const clipAlpha = animAlpha
      // Per-word color (P6.9): each `clip.text.runs[i]` MAY carry a `color` that
      // overrides the base fill for WORD `i`, baked at the base fill opacity. The
      // shared `runColorForWord` is the single override point (owns the word→run
      // index mapping); `null` keeps the base paint (e.g. a gradient). The
      // active-word highlight color still wins below (base < run < active).
      placed.forEach((p, i) => {
        const rs = revealState.words[i]
        if (rs === undefined || rs.opacity <= 0) return
        const hs = highlight.words[i]
        const word = captionWords[i]
        // CUE rendering (P5.7): a bracketed sound-effect cue (`[applause]`) draws
        // in a DISTINCT cue style (italic + dimmed) and is excluded from highlight
        // (`evaluateClipHighlight` never marks a cue active) and from the wipe path.
        const cue = cueDrawStyle(word)
        // A cue is shown in full, never typed out — ignore character slicing for it.
        const token = isCharacter && cue === null ? revealedWordText(p.word, rs.revealedGraphemes) : p.word
        if (token.length === 0) return
        ctx.globalAlpha = clipAlpha * rs.opacity * (cue?.opacity ?? 1)

        if (cue !== null) {
          // Plain, un-highlighted cue: italic + dimmed fill, no scale/wipe. The
          // cue forces italic on top of the clip's resolved family/size/weight.
          // Canonical pipeline (P6.15): shadow → stroke → fill (cue color) → inner.
          ctx.save()
          // Keep the per-script family list (familyList) so a cue word in Tamil/etc.
          // shapes correctly; only the italic flag changes for the cue look.
          ctx.font = fontShorthandWithList({ ...font, italic: cue.italic }, familyList)
          paintGlyphPasses({
            ctx,
            token: { text: token, x: p.x, y: p.y },
            shadow: shadowOn ? shadowSpec : null,
            stroke: strokeOn ? strokeSpec : null,
            effects: effectsPass,
            fill: (c, tk) => {
              c.fillStyle = cue.color
              c.fillText(tk.text, tk.x, tk.y)
            }
          })
          ctx.restore()
          return
        }

        // Per-word base fill (P6.9): reset to the clip base paint, then apply this
        // run's color override if any. Resetting each word stops a prior word's
        // override from leaking; the active-word highlight color still wins below.
        const runColor = runColorForWord(fillSpec, runs, i, fillOpacity)
        ctx.fillStyle = runColor !== null ? runColor : basePaint

        // wholeWord highlight scales the active word about its own center; wipe
        // keeps scale 1 (the fill carries the motion).
        const scale = hs?.scale ?? 1
        const scaled = scale !== 1
        if (scaled) {
          ctx.save()
          ctx.translate(p.x, p.y)
          ctx.scale(scale, scale)
        }
        const drawX = scaled ? 0 : p.x
        const drawY = scaled ? 0 : p.y

        if (hs?.active && hs.wipeProgress > 0 && !isCharacter) {
          // Karaoke WIPE: paint the already-wiped leading clusters in activeColor
          // and the remainder in the base fill — boundary is grapheme-aligned.
          // Canonical pipeline (P6.15): shadow + stroke + inner shadow are cast from
          // the WHOLE token at the left edge (so each is CONTINUOUS across the wipe
          // boundary — one shadow/ring, not two seams); only the FILL pass splits the
          // body into the two colored halves.
          const { filled, rest } = splitWipe(token, hs.wipeProgress)
          const baseFill = ctx.fillStyle
          ctx.save()
          ctx.textAlign = 'left'
          const leftEdge = drawX - p.width / 2
          const filledAdvance =
            measuredLineWidth(filled, measure, letterSpacing) + (letterSpacing !== 0 ? letterSpacing : 0)
          paintGlyphPasses({
            ctx,
            token: { text: token, x: leftEdge, y: drawY },
            shadow: shadowOn ? shadowSpec : null,
            stroke: strokeOn ? strokeSpec : null,
            effects: effectsPass,
            fill: (c) => {
              if (filled.length > 0) {
                c.fillStyle = hs.color ?? baseFill
                c.fillText(filled, leftEdge, drawY)
              }
              if (rest.length > 0) {
                c.fillStyle = baseFill
                // Offset by the filled portion's letterSpacing-aware advance (plus one
                // inter-cluster gap to the rest) so the wipe boundary matches layout.
                c.fillText(rest, leftEdge + filledAdvance, drawY)
              }
            }
          })
          ctx.restore()
        } else if (isCharacter && token !== p.word) {
          // Character mode shrinks the drawn token, so re-center it on the word
          // slot by anchoring its measured left edge where the full word's is.
          // Canonical pipeline (P6.15): shadow → stroke → fill → inner.
          const drawnW = measuredLineWidth(token, measure, letterSpacing)
          const charX = drawX - p.width / 2 + drawnW / 2
          const tokenFill = ctx.fillStyle
          paintGlyphPasses({
            ctx,
            token: { text: token, x: charX, y: drawY },
            shadow: shadowOn ? shadowSpec : null,
            stroke: strokeOn ? strokeSpec : null,
            effects: effectsPass,
            fill: (c, tk) => {
              c.fillStyle = hs?.active && hs.color ? hs.color : tokenFill
              c.fillText(tk.text, tk.x, tk.y)
            }
          })
        } else {
          // wholeWord active flip: swap fill to activeColor for the active word.
          // Canonical pipeline (P6.15): shadow → stroke → fill → inner. HOLLOW (P6.12)
          // active-word decision: when the body is hollow the pipeline SKIPS the fill
          // (and the inner shadow) — there is no glyph body to tint, so a karaoke/
          // active flip would otherwise paint a solid body and defeat the outline-only
          // look. The stroke still frames the active word (and its scale/wipe geometry
          // above still applies), so the active word is conveyed by motion, not a body
          // color. The wipe + cue branches above are hollow-safe the same way.
          const tokenFill = ctx.fillStyle
          paintGlyphPasses({
            ctx,
            token: { text: token, x: drawX, y: drawY },
            shadow: shadowOn ? shadowSpec : null,
            stroke: strokeOn ? strokeSpec : null,
            effects: effectsPass,
            fill: (c, tk) => {
              c.fillStyle = hs?.active && hs.color ? hs.color : tokenFill
              c.fillText(tk.text, tk.x, tk.y)
            }
          })
        }
        if (scaled) ctx.restore()
      })
    } else if (font.curve !== 0) {
      // Curved/arc text (P6.5): lay each grapheme cluster along the arc and draw
      // it at its composable per-cluster transform (translate → rotate → scale
      // about the cluster center). Falls back to the straight whole-line draw
      // when curve === 0 (the branch below). The arc layout reuses the P6.4
      // per-cluster boxes (no re-measure) so preview = export.
      const boxes = layoutGlyphBoxes(
        lines,
        { fontSizePx: fontPx, lineHeightMult, align, letterSpacing },
        measure
      )
      boxes.lines.forEach((lineBox, i) => {
        if (lineBox.line.length === 0) return
        const lineCenterY = laid[i]?.y ?? 0
        const transforms = layoutArcClusters(
          lineClusters(lineBox),
          lineBox.box,
          lineCenterY,
          font.curve
        )
        const clusterCount = transforms.length
        transforms.forEach((tr, ci) => {
          // Per-glyph ANIMATION (P8.1): compose the per-cluster animation sample
          // (in/out/loop with per-character stagger) ON TOP of the arc cluster's
          // base transform (P6.5). translate/rotation ADD; scale MULTIPLIES;
          // opacity multiplies the cluster alpha. With no stagger/animation this is
          // the identity sample so the arc draw is unchanged (composes cleanly).
          const g = anim.glyph(ci, clusterCount)
          ctx.save()
          ctx.globalAlpha = animAlpha * g.opacity
          ctx.translate(tr.x + g.tx, tr.y + g.ty)
          ctx.rotate(tr.rotation + g.rotation)
          const cs = tr.scale * g.scale
          if (cs !== 1) ctx.scale(cs, cs)
          // Canonical pipeline (P6.15): each arc cluster casts its own shadow (it has
          // its own rotated/scaled transform) → stroke follows the curve per glyph →
          // fill on top → inner shadow. Hollow skips the fill (outline follows curve).
          paintGlyphPasses({
            ctx,
            token: { text: tr.cluster, x: 0, y: 0 },
            shadow: shadowOn ? shadowSpec : null,
            stroke: strokeOn ? strokeSpec : null,
            effects: effectsPass,
            fill: (c, tk) => c.fillText(tk.text, tk.x, tk.y)
          })
          ctx.restore()
        })
      })
    } else {
      for (const l of laid) {
        if (l.line.length === 0) continue
        // Canonical pipeline (P6.15): shadow (once per line, no doubling) → stroke
        // (outside-in, framing the glyph) → fill on top → inner shadow over the body.
        // Hollow (P6.12) skips the fill (and the inner shadow) for an outline-only line.
        paintGlyphPasses({
          ctx,
          token: { text: l.line, x: l.x, y: l.y },
          shadow: shadowOn ? shadowSpec : null,
          stroke: strokeOn ? strokeSpec : null,
          effects: effectsPass,
          fill: (c, tk) => c.fillText(tk.text, tk.x, tk.y)
        })
      }
    }

    // Underline / strikethrough RULES (P7.9 — Doc 05): one baseline-aware,
    // size-scaled rule per VISUAL line, spanning the measured line box (so it
    // honors alignment) — computed from the SAME `layoutGlyphBoxes` line boxes the
    // glyphs lay out against, so the rule lines up with the text across multi-line.
    // Drawn just AFTER the glyph fill so it is visible (underline reads at the
    // baseline; strike crosses the x-height over the body), still BENEATH effects/
    // the active-word overlay conceptually (effects compose during the glyph passes;
    // P7.12 keeps decorations beneath effects). Default color = the glyph fill.
    if (hasRules(decoration)) {
      const ruleBoxes = layoutGlyphBoxes(
        lines,
        { fontSizePx: fontPx, lineHeightMult, align, letterSpacing },
        measure
      ).lines.map((lb) => lb.box)
      const ruleFill = fillSpec.type === 'solid' ? fillSpec.color : 'rgba(255, 255, 255, 1)'
      drawDecorationRules(ctx, decoration.underline, decoration.strike, ruleBoxes, fontPx, ruleFill)
    }
    ctx.restore()
  }
}

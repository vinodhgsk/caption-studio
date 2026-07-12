import { useMemo, useState, type ReactNode } from 'react'
import { useProjectStore } from '@/store/projectStore'
import { useTimelineStore } from '@/store/timelineStore'
import type { Clip, Project } from '../../../shared/storage'
import {
  ANIM_TABS,
  DEFAULT_ANIM_TAB,
  EASING_OPTIONS,
  deriveInOutLane,
  deriveLoopLane,
  galleryFor,
  inOutPatch,
  loopPatch,
  selectInOutPreset,
  selectLoopPreset,
  setInOutDuration,
  setLaneEasing,
  setLoopDuration,
  setLoopSpeed,
  setStaggerDelay,
  setStaggerUnit,
  toggleStagger,
  type AnimTab,
  type InOutLaneState,
  type LoopLaneState,
  type StaggerState
} from './animationPanelState'
import { COMMUNITY_ANIM_CATALOG, type CommunityAnimEntry } from '@/store/timeline/communityAnimations'
import {
  ANCHOR_NUDGE_PX,
  TRACK_TARGET_KIND_OPTIONS,
  clampSmoothing,
  defaultTargetBox,
  deriveTrackingLane,
  nudgeAnchor,
  videoSourceOptions
} from './trackingPanelState'
import type { TrackTargetKind } from '../../../shared/tracking'

/**
 * Animation panel (P8.5 — Doc 06 text animation; skills `keyframe-engine` +
 * `indic-text`). In / Out / Loop TABS, each with a GALLERY of its catalog presets
 * (P8.2–P8.4), a duration (in/out) or speed (loop) slider, a per-character /
 * per-word stagger toggle + delay, and an easing dropdown. Targets the SELECTED
 * text/caption clip.
 *
 * Every control writes the SAME `clip.animation.{in|out|loop}` shape the preview
 * (`PreviewCanvas.evaluateClipAnimation`) and the export read, through the single
 * undoable `setClipAnimation` command (one undo step per edit) — so preview =
 * export and edits survive reload. The pure projections from the open `animation.*`
 * bags onto editable lane state (and back) live in `animationPanelState.ts`
 * (unit-tested); this component is a thin wiring layer.
 *
 * Each tab writes only its own lane (`{in}` / `{out}` / `{loop}`); the undoable
 * reducer merges it over the existing animation, so switching tabs and tuning one
 * lane never disturbs the others' persisted configs.
 */
export function AnimationPanel(): JSX.Element {
  const project = useProjectStore((s) => s.currentProject)
  const setClipAnimation = useTimelineStore((s) => s.setClipAnimation)
  const selection = useTimelineStore((s) => s.selection)

  const [tab, setTab] = useState<AnimTab>(DEFAULT_ANIM_TAB)

  // Resolve the single selected TEXT/CAPTION clip (controls target it). Mirrors
  // TextPanel: a clip animates text when it carries a `text` or `caption` surface.
  const selectedClip: Clip | null = useMemo(() => {
    if (project === null || selection.length !== 1) return null
    for (const track of project.tracks) {
      const c = track.clips.find((x) => x.id === selection[0])
      if (c !== undefined) return c.text !== undefined || c.caption !== undefined ? c : null
    }
    return null
  }, [project, selection])

  const inLane = useMemo(
    () => deriveInOutLane(selectedClip?.animation?.in),
    [selectedClip]
  )
  const outLane = useMemo(
    () => deriveInOutLane(selectedClip?.animation?.out),
    [selectedClip]
  )
  const loopLane = useMemo(
    () => deriveLoopLane(selectedClip?.animation?.loop),
    [selectedClip]
  )

  const disabled = selectedClip === null

  // --- writers: each is one undoable setClipAnimation command (one lane) ----

  const writeInOut = (which: 'in' | 'out', next: InOutLaneState): void => {
    if (selectedClip === null) return
    setClipAnimation(selectedClip.id, inOutPatch(which, next))
  }
  const writeLoop = (next: LoopLaneState): void => {
    if (selectedClip === null) return
    setClipAnimation(selectedClip.id, loopPatch(next))
  }

  return (
    <section className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <h2 className="text-sm font-semibold text-text-primary">Animation</h2>

      {disabled ? (
        <p className="text-xs text-text-muted">
          Select a text or caption clip to give it an In / Out / Loop animation.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* ---- Tabs (In / Out / Loop) ----------------------------------- */}
          <div className="flex gap-1" role="tablist" aria-label="Animation lane">
            {ANIM_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 rounded-sm border px-2 py-1 text-xs ${
                  tab === t.id
                    ? 'border-accent bg-accent/20 text-text-primary'
                    : 'border-line text-text-secondary hover:bg-surface-2'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'loop' ? (
            <LoopTab lane={loopLane} onChange={writeLoop} />
          ) : (
            <InOutTab tab={tab} lane={tab === 'in' ? inLane : outLane} onChange={writeInOut} />
          )}
        </div>
      )}

      {!disabled && selectedClip !== null && project !== null && (
        <MotionTrackingSection clip={selectedClip} project={project} />
      )}

      {!disabled && selectedClip !== null && (
        <CommunitySection
          clipId={selectedClip.id}
          currentIn={selectedClip.animation?.in}
          currentLoop={selectedClip.animation?.loop}
          currentReveal={selectedClip.animation?.reveal}
          onApply={(patch) => setClipAnimation(selectedClip.id, patch)}
        />
      )}

      <p className="text-xs text-text-muted">
        In plays at the clip start, Out at the clip end, Loop runs continuously. Per-character
        stagger advances by grapheme cluster (Indic-aware), per-word by whole words.
      </p>
    </section>
  )
}

// ===========================================================================
// Motion tracking (P8.10, Doc 11; skill `motion-tracking`)
// ===========================================================================

/**
 * Motion Tracking section of the Animation panel (P8.10). Drives the already-built,
 * undoable `timelineStore` tracking commands so a text/caption clip can STICK to a
 * subject (face/object) in a source video:
 *
 *  1. PICK TARGET — seeds a centered target box (`beginTrackTarget`); the preview
 *     overlay (PreviewInteraction) lets the user drag/resize it over the subject.
 *  2. TRACK — runs the provider in main (`trackTarget` → IPC `tracking:run`, no
 *     frame bytes cross IPC) and persists the per-frame path to `clip.tracking`.
 *  3. CORRECT — once tracked: an enable toggle, a JITTER-SMOOTHING slider
 *     (`setTrackingSmoothing`), a MANUAL ANCHOR nudge pad (`setTrackingAnchor`), and
 *     Clear (`clearTracking`). The compositor (`trackingSampler`) applies all of
 *     these per frame so preview = export.
 *
 * Pure projections + clamps live in `trackingPanelState.ts` (unit-tested); this is a
 * thin wiring layer. Each control is ONE undoable command (one undo step per edit).
 */
function MotionTrackingSection({ clip, project }: { clip: Clip; project: Project }): JSX.Element {
  const trackingTarget = useTimelineStore((s) => s.trackingTarget)
  const beginTrackTarget = useTimelineStore((s) => s.beginTrackTarget)
  const cancelTrackTarget = useTimelineStore((s) => s.cancelTrackTarget)
  const trackTarget = useTimelineStore((s) => s.trackTarget)
  const setTrackingEnabled = useTimelineStore((s) => s.setTrackingEnabled)
  const setTrackingAnchor = useTimelineStore((s) => s.setTrackingAnchor)
  const setTrackingSmoothing = useTimelineStore((s) => s.setTrackingSmoothing)
  const clearTracking = useTimelineStore((s) => s.clearTracking)

  const lane = useMemo(() => deriveTrackingLane(clip.tracking), [clip.tracking])
  const sources = useMemo(() => videoSourceOptions(project), [project])

  const [kind, setKind] = useState<TrackTargetKind>(lane.kind)
  const [videoRef, setVideoRef] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The in-flight target box belongs to THIS clip (the store holds at most one).
  const picking = trackingTarget !== null && trackingTarget.clipId === clip.id
  const resolution = project.settings.resolution

  const effectiveVideoRef = videoRef !== '' ? videoRef : (sources[0]?.ref ?? clip.mediaRef)

  const onPick = (): void => {
    setError(null)
    beginTrackTarget(clip.id, defaultTargetBox(resolution, kind))
  }

  const onTrack = async (): Promise<void> => {
    if (!picking) return
    setBusy(true)
    setError(null)
    const target = { ...trackingTarget.box, kind }
    const result = await trackTarget(clip.id, target, effectiveVideoRef)
    setBusy(false)
    if (!result.ok) setError(result.error)
  }

  const nudge = (dx: number, dy: number): void =>
    setTrackingAnchor(clip.id, nudgeAnchor(lane.anchor, dx, dy))

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-line bg-surface-2/40 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          Motion Tracking
        </h3>
        {lane.hasTracking && (
          <label className="flex items-center gap-1.5 text-[11px] text-text-secondary">
            <input
              type="checkbox"
              aria-label="Enable motion tracking"
              checked={lane.enabled}
              onChange={(e) => setTrackingEnabled(clip.id, e.target.checked)}
              className="h-3.5 w-3.5 accent-accent"
            />
            <span>{lane.enabled ? 'On' : 'Off'}</span>
          </label>
        )}
      </div>

      {/* Subject kind + source video (used when picking / re-tracking). */}
      <label className="flex items-center justify-between gap-2 text-[11px] text-text-secondary">
        <span>Subject</span>
        <select
          aria-label="Tracking subject kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as TrackTargetKind)}
          className="min-w-0 flex-1 rounded-sm border border-line bg-surface-2 px-2 py-1 text-xs text-text-primary"
        >
          {TRACK_TARGET_KIND_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {sources.length > 0 && (
        <label className="flex items-center justify-between gap-2 text-[11px] text-text-secondary">
          <span>Follow</span>
          <select
            aria-label="Tracking source video"
            value={effectiveVideoRef}
            onChange={(e) => setVideoRef(e.target.value)}
            className="min-w-0 flex-1 rounded-sm border border-line bg-surface-2 px-2 py-1 text-xs text-text-primary"
          >
            {sources.map((s) => (
              <option key={s.ref} value={s.ref}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Pick / Track / Cancel controls. */}
      {picking ? (
        <div className="flex gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onTrack()}
            className="flex-1 rounded-sm border border-accent bg-accent/20 px-2 py-1 text-xs text-text-primary hover:bg-accent/30 disabled:opacity-50"
          >
            {busy ? 'Tracking…' : 'Track'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={cancelTrackTarget}
            className="rounded-sm border border-line px-2 py-1 text-xs text-text-secondary hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onPick}
          className="rounded-sm border border-line px-2 py-1 text-xs text-text-secondary hover:bg-surface-2"
        >
          {lane.hasTracking ? 'Pick new target' : 'Pick target on preview'}
        </button>
      )}

      {picking && (
        <p className="text-[10px] text-text-muted">
          Drag the box on the preview over the subject, then Track.
        </p>
      )}
      {error !== null && <p className="text-[10px] text-danger">{error}</p>}

      {/* Correction controls — only meaningful once a path exists. */}
      {lane.hasTracking && (
        <>
          <SliderField
            label="Jitter smoothing"
            ariaLabel="tracking smoothing"
            value={lane.smoothing}
            valueText={lane.smoothing.toFixed(2)}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => setTrackingSmoothing(clip.id, clampSmoothing(v))}
            hint="0 = raw path · higher = steadier."
          />
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between text-[11px] text-text-secondary">
              <span>Anchor nudge</span>
              <span className="tabular-nums text-text-muted">
                {lane.anchor.dx}, {lane.anchor.dy} px
              </span>
            </span>
            <div className="flex items-center gap-1">
              <AnchorButton label="◀" ariaLabel="Nudge anchor left" onClick={() => nudge(-ANCHOR_NUDGE_PX, 0)} />
              <AnchorButton label="▲" ariaLabel="Nudge anchor up" onClick={() => nudge(0, -ANCHOR_NUDGE_PX)} />
              <AnchorButton label="▼" ariaLabel="Nudge anchor down" onClick={() => nudge(0, ANCHOR_NUDGE_PX)} />
              <AnchorButton label="▶" ariaLabel="Nudge anchor right" onClick={() => nudge(ANCHOR_NUDGE_PX, 0)} />
              <button
                type="button"
                onClick={() => setTrackingAnchor(clip.id, { dx: 0, dy: 0 })}
                className="ml-auto rounded-sm border border-line px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-2"
              >
                Reset
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => clearTracking(clip.id)}
            className="self-start rounded-sm border border-line px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-2"
          >
            Clear tracking
          </button>
          <span className="text-[10px] text-text-muted">
            {lane.sampleCount} tracked frames. Text follows the subject; nudge to offset it.
          </span>
        </>
      )}
    </div>
  )
}

/** A small square button for one direction of the anchor nudge pad. */
function AnchorButton({
  label,
  ariaLabel,
  onClick
}: {
  label: string
  ariaLabel: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className="h-7 w-7 rounded-sm border border-line text-xs text-text-secondary hover:bg-surface-2"
    >
      {label}
    </button>
  )
}

// ===========================================================================
// Tab bodies
// ===========================================================================
/** The In or Out tab: gallery + duration slider + easing + stagger. */
function InOutTab({
  tab,
  lane,
  onChange
}: {
  tab: 'in' | 'out'
  lane: InOutLaneState
  onChange: (which: 'in' | 'out', next: InOutLaneState) => void
}): JSX.Element {
  const gallery = galleryFor(tab)
  const set = (next: InOutLaneState): void => onChange(tab, next)
  return (
    <div className="flex flex-col gap-3">
      <Gallery
        ariaLabel={`${tab === 'in' ? 'In' : 'Out'} preset`}
        items={gallery}
        selected={lane.preset}
        onSelect={(id) => set(selectInOutPreset(tab, lane, id === lane.preset ? 'none' : id))}
      />

      {lane.preset !== 'none' && (
        <>
          <SliderField
            label="Duration"
            ariaLabel={`${tab} duration`}
            value={lane.durationSec}
            valueText={`${lane.durationSec.toFixed(2)}s`}
            min={0}
            max={5}
            step={0.05}
            onChange={(v) => set(setInOutDuration(lane, v))}
          />
          <EasingSelect
            value={lane.easing}
            ariaLabel={`${tab} easing`}
            onChange={(v) => set(setLaneEasing(lane, v))}
          />
          <StaggerControls
            stagger={lane.stagger}
            onToggle={(on) => set(toggleStagger(lane, on))}
            onUnit={(u) => set(setStaggerUnit(lane, u))}
            onDelay={(d) => set(setStaggerDelay(lane, d))}
          />
        </>
      )}
    </div>
  )
}

/** The Loop tab: gallery + speed/period sliders + easing + stagger. */
function LoopTab({
  lane,
  onChange
}: {
  lane: LoopLaneState
  onChange: (next: LoopLaneState) => void
}): JSX.Element {
  const gallery = galleryFor('loop')
  return (
    <div className="flex flex-col gap-3">
      <Gallery
        ariaLabel="Loop preset"
        items={gallery}
        selected={lane.preset}
        onSelect={(id) => onChange(selectLoopPreset(lane, id === lane.preset ? 'none' : id))}
      />

      {lane.preset !== 'none' && (
        <>
          <SliderField
            label="Speed"
            ariaLabel="loop speed"
            value={lane.speed}
            valueText={`${lane.speed.toFixed(2)}×`}
            min={0.1}
            max={4}
            step={0.05}
            onChange={(v) => onChange(setLoopSpeed(lane, v))}
            hint="Higher = faster cycles."
          />
          <SliderField
            label="Period"
            ariaLabel="loop period"
            value={lane.durationSec}
            valueText={`${lane.durationSec.toFixed(2)}s`}
            min={0.1}
            max={6}
            step={0.05}
            onChange={(v) => onChange(setLoopDuration(lane, v))}
            hint="One cycle length at speed 1×."
          />
          <EasingSelect
            value={lane.easing}
            ariaLabel="loop easing"
            onChange={(v) => onChange(setLaneEasing(lane, v))}
          />
          <StaggerControls
            stagger={lane.stagger}
            onToggle={(on) => onChange(toggleStagger(lane, on))}
            onUnit={(u) => onChange(setStaggerUnit(lane, u))}
            onDelay={(d) => onChange(setStaggerDelay(lane, d))}
          />
        </>
      )}
    </div>
  )
}

// ===========================================================================
// Presentational helpers — shared so every tab matches the design tokens.
// ===========================================================================

/** A grid of selectable preset thumbnails (the per-tab gallery). */
function Gallery({
  ariaLabel,
  items,
  selected,
  onSelect
}: {
  ariaLabel: string
  items: { id: string; label: string }[]
  selected: string
  onSelect: (id: string) => void
}): JSX.Element {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={ariaLabel}>
      {items.map((item) => {
        const active = item.id === selected
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(item.id)}
            className={`rounded-sm border px-2 py-1 text-[11px] ${
              active
                ? 'border-accent bg-accent/20 text-text-primary'
                : 'border-line text-text-secondary hover:bg-surface-2'
            }`}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

/** The easing dropdown (the shared keyframe-engine named curves). */
function EasingSelect({
  value,
  ariaLabel,
  onChange
}: {
  value: string
  ariaLabel: string
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px] text-text-secondary">
      <span>Easing</span>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 rounded-sm border border-line bg-surface-2 px-2 py-1 text-xs text-text-primary"
      >
        {EASING_OPTIONS.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  )
}

/** The per-character / per-word stagger toggle + unit + delay slider. */
function StaggerControls({
  stagger,
  onToggle,
  onUnit,
  onDelay
}: {
  stagger: StaggerState
  onToggle: (on: boolean) => void
  onUnit: (unit: 'character' | 'word') => void
  onDelay: (delaySec: number) => void
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-line bg-surface-2/50 p-2">
      <label className="flex items-center justify-between gap-2 text-[11px] text-text-secondary">
        <span className="font-medium uppercase tracking-wide text-text-muted">Stagger</span>
        <span className="flex items-center gap-1.5">
          <input
            type="checkbox"
            aria-label="Enable stagger"
            checked={stagger.enabled}
            onChange={(e) => onToggle(e.target.checked)}
            className="h-3.5 w-3.5 shrink-0 accent-accent"
          />
          <span>{stagger.enabled ? 'On' : 'Off'}</span>
        </span>
      </label>

      {stagger.enabled && (
        <>
          <div className="flex gap-1" role="group" aria-label="Stagger unit">
            <button
              type="button"
              aria-pressed={stagger.unit === 'character'}
              onClick={() => onUnit('character')}
              className={`flex-1 rounded-sm border px-2 py-1 text-[11px] ${
                stagger.unit === 'character'
                  ? 'border-accent bg-accent/20 text-text-primary'
                  : 'border-line text-text-secondary hover:bg-surface-2'
              }`}
            >
              Per character
            </button>
            <button
              type="button"
              aria-pressed={stagger.unit === 'word'}
              onClick={() => onUnit('word')}
              className={`flex-1 rounded-sm border px-2 py-1 text-[11px] ${
                stagger.unit === 'word'
                  ? 'border-accent bg-accent/20 text-text-primary'
                  : 'border-line text-text-secondary hover:bg-surface-2'
              }`}
            >
              Per word
            </button>
          </div>
          <SliderField
            label="Per-unit delay"
            ariaLabel="stagger delay"
            value={stagger.delaySec}
            valueText={`${stagger.delaySec.toFixed(2)}s`}
            min={0}
            max={0.5}
            step={0.01}
            onChange={onDelay}
          />
          <span className="text-[10px] text-text-muted">
            Per character advances by grapheme cluster (Indic-aware).
          </span>
        </>
      )}
    </div>
  )
}

// ===========================================================================
// Community Animations (P8C — Doc 17) section
// ===========================================================================

/**
 * Community Animations section (P8C.19). Shows a gallery of the 17 community
 * presets grouped by slot (In / Loop / Reveal). Selecting a preset patches the
 * corresponding animation lane via `setClipAnimation`. Source pen links shown
 * as small external references.
 */
function CommunitySection({
  clipId: _clipId,
  currentIn,
  currentLoop,
  currentReveal,
  onApply
}: {
  clipId: string
  currentIn: Record<string, unknown> | undefined
  currentLoop: Record<string, unknown> | undefined
  currentReveal: Record<string, unknown> | undefined
  onApply: (patch: import('../../../shared/project-schema').ClipAnimation) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)

  const currentInPreset = typeof currentIn?.preset === 'string' ? currentIn.preset : ''
  const currentLoopPreset = typeof currentLoop?.preset === 'string' ? currentLoop.preset : ''
  const currentRevealEffect = typeof currentReveal?.effectId === 'string' ? currentReveal.effectId : ''

  function isActive(entry: CommunityAnimEntry): boolean {
    if (entry.slot === 'in') return currentInPreset === entry.id
    if (entry.slot === 'loop') return currentLoopPreset === entry.id
    return currentRevealEffect === entry.id
  }

  function applyEntry(entry: CommunityAnimEntry): void {
    if (entry.slot === 'in') {
      const wasActive = currentInPreset === entry.id
      onApply({ in: wasActive ? { preset: 'none' } : { preset: entry.id, durationSec: 0.8, easing: 'easeOut' } })
    } else if (entry.slot === 'loop') {
      const wasActive = currentLoopPreset === entry.id
      onApply({ loop: wasActive ? { preset: 'none' } : { preset: entry.id, durationSec: 2, speed: 1, easing: 'linear' } })
    } else {
      const wasActive = currentRevealEffect === entry.id
      onApply({ reveal: wasActive ? {} : { effectId: entry.id, duration: 1, unit: 'char', direction: 'b', ease: 'easeOut', loop: entry.loop, speed: 1 } })
    }
  }

  const inEntries = COMMUNITY_ANIM_CATALOG.filter((e) => e.slot === 'in')
  const loopEntries = COMMUNITY_ANIM_CATALOG.filter((e) => e.slot === 'loop')
  const revealEntries = COMMUNITY_ANIM_CATALOG.filter((e) => e.slot === 'reveal')

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-line bg-surface-2/40 p-3">
      <button
        type="button"
        className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-text-muted hover:text-text-primary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>Community Animations</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-3">
          <p className="text-[10px] text-text-muted">
            17 presets inspired by community CodePen demos. In/Loop presets fill the animation
            slot; Reveal presets fill the reveal slot. Click to toggle.
          </p>

          <CommunityGroup
            label="In Entrance"
            entries={inEntries}
            isActive={isActive}
            onApply={applyEntry}
          />
          <CommunityGroup
            label="Loop Continuous"
            entries={loopEntries}
            isActive={isActive}
            onApply={applyEntry}
          />
          <CommunityGroup
            label="Reveal Effects"
            entries={revealEntries}
            isActive={isActive}
            onApply={applyEntry}
          />
        </div>
      )}
    </div>
  )
}

/** A labeled group of community preset buttons. */
function CommunityGroup({
  label,
  entries,
  isActive,
  onApply
}: {
  label: string
  entries: readonly CommunityAnimEntry[]
  isActive: (e: CommunityAnimEntry) => boolean
  onApply: (e: CommunityAnimEntry) => void
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
        {label}
      </span>
      <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
        {entries.map((entry) => {
          const active = isActive(entry)
          return (
            <button
              key={entry.id}
              type="button"
              aria-pressed={active}
              title={entry.description}
              onClick={() => onApply(entry)}
              className={`rounded-sm border px-2 py-1 text-[11px] ${
                active
                  ? 'border-accent bg-accent/20 text-text-primary'
                  : 'border-line text-text-secondary hover:bg-surface-2'
              }`}
            >
              {entry.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** A labeled range slider with a right-aligned value readout + optional hint. */
function SliderField({
  label,
  ariaLabel,
  value,
  valueText,
  min,
  max,
  step,
  onChange,
  hint
}: {
  label: string
  ariaLabel?: string
  value: number
  valueText: string
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  hint?: string
}): ReactNode {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-text-secondary">
      <span className="flex items-center justify-between">
        <span>{label}</span>
        <span className="tabular-nums text-text-muted">{valueText}</span>
      </span>
      <input
        type="range"
        aria-label={ariaLabel ?? label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(v)
        }}
        className="w-full accent-accent"
      />
      {hint !== undefined && <span className="text-[10px] text-text-muted">{hint}</span>}
    </label>
  )
}

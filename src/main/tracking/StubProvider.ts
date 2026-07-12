/**
 * Deterministic STUB motion-tracking provider (P8.9, Doc 11; skill `motion-tracking`).
 *
 * A placeholder that satisfies the {@link TrackingProvider} contract so the IPC
 * channel + registry can be wired and tested end-to-end BEFORE a real face/object CV
 * tracker (OpenCV / cloud) lands — exactly like the STT stub before whisper.cpp.
 *
 * It does NOT decode the video or spawn anything. It derives a SYNTHETIC but
 * deterministic path from the picked `target` box and the requested range: the
 * subject starts at the box center and drifts along a smooth, gentle SINE/COSINE
 * orbit whose amplitude scales with the box size (so a larger subject "moves" more),
 * one sample per frame over `[0, durationSec]`. Confidence is a constant high value.
 * This gives P8.10 a believable, fully-correctable path to attach text to and gives
 * tests a reproducible curve (no Math.random / Date / I/O).
 *
 * PURE except for the (unused) bundle/video args — kept on the signature so the real
 * CV provider drops in behind the SAME interface with no caller change.
 */
import type { TargetBox, TrackOptions, TrackPath, TrackSample, TrackingProvider } from '../../shared/tracking'

export const STUB_TRACKING_PROVIDER_ID = 'stub'

/**
 * Build the deterministic synthetic path for `target` over `[0, durationSec]` at
 * `fps`. EXPORTED + PURE so it is unit-testable directly (no provider instance).
 *
 * - `n = round(durationSec * fps)` segments → `n + 1` samples at `t = i / fps`
 *   (the last sample lands exactly on `durationSec` when it is a frame multiple),
 *   covering the whole range inclusive of both ends.
 * - x/y orbit the box center: `x = cx + ampX * sin(2π · progress)`,
 *   `y = cy + ampY * (1 - cos(2π · progress))` where `progress = i / n ∈ [0,1]`,
 *   `ampX = width * 0.15`, `ampY = height * 0.15`. At `progress=0` (and a full loop)
 *   the subject is exactly at the box center, so a tracked text starts on target.
 * - `scale = 1`, `rotation = 0`, `confidence = 0.9` (constant) — a translate-only
 *   synthetic tracker. Deterministic for given `(target, durationSec, fps)`.
 */
export function buildStubTrackPath(target: TargetBox, opts: TrackOptions): TrackPath {
  const fps = opts.fps > 0 ? opts.fps : 30
  const duration = Math.max(0, opts.durationSec)
  const n = Math.max(1, Math.round(duration * fps))
  const ampX = target.width * 0.15
  const ampY = target.height * 0.15

  const samples: TrackSample[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / fps
    const progress = i / n
    const angle = 2 * Math.PI * progress
    samples.push({
      t,
      x: target.x + ampX * Math.sin(angle),
      y: target.y + ampY * (1 - Math.cos(angle)),
      scale: 1,
      rotation: 0,
      confidence: 0.9
    })
  }
  return { fps, samples }
}

export class StubTrackingProvider implements TrackingProvider {
  readonly id = STUB_TRACKING_PROVIDER_ID

  async track(
    _bundlePath: string,
    _videoRef: string,
    target: TargetBox,
    opts: TrackOptions
  ): Promise<TrackPath> {
    return buildStubTrackPath(target, opts)
  }
}

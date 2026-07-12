/**
 * Motion-tracking entry point (P8.9, Doc 11) — registers the `tracking:` IPC domain.
 *
 * Mirrors the STT entry point (`src/main/stt/index.ts`): it resolves the bundle path
 * for the request's project ref (NO frame bytes cross IPC — only the bundle-relative
 * `videoRef`), delegates to the ACTIVE provider from the registry (the stub now; a CV
 * tracker later), and returns the {@link TrackPath}. The provider runs in MAIN so a
 * real CV tracker can read/decode video frames off disk without shipping bytes over
 * IPC; the stub ignores the video but keeps the SAME boundary.
 *
 * PERSISTENCE NOTE: unlike `stt:transcribe` (which also writes
 * `cache/transcript.json` + project.json), tracking attaches to a SPECIFIC clip and
 * its result is small, so it is persisted RENDERER-SIDE as an UNDOABLE command
 * (`setClipTrackingCommand`, like the motion-path command) rather than in main —
 * keeping the clip edit on the existing command stack. Main only computes the path.
 */
import { handle } from '../ipc'
import { getProvider } from '../storage'
import { getTrackingProvider } from './registry'

/** Register the `tracking:run` handler (mirrors registerSttIpc). */
export function registerTrackingIpc(): void {
  handle('tracking:run', async (request) => {
    // Resolve the bundle root via the storage provider, then hand the provider the
    // absolute bundle path + bundle-relative videoRef so a CV tracker can decode the
    // video in MAIN. The renderer only ever sent the videoRef string + the target.
    const provider = getProvider(request.ref.location)
    const bundlePath = provider.resolvePath(request.ref)

    return getTrackingProvider().track(bundlePath, request.videoRef, request.target, {
      durationSec: request.durationSec,
      fps: request.fps
    })
  })
}

/**
 * TTS entry point (P10.1–P10.4, Doc 12) — registers the `tts:` IPC domain.
 *
 * The ONLY TTS module allowed to import electron (via the shared `handle()`
 * wrapper) + fs. The handlers resolve the bundle path for the request's project
 * ref, delegate to the active provider from the registry, then return the result
 * to the renderer. Providers stay pure behind the registry; a real TTS engine
 * drops in (P10R) with no caller change.
 *
 * Graceful disabled state: if no provider is registered or synthesize throws,
 * the IPC wrapper converts the throw to `{ok:false,error}` so the renderer
 * shows a disabled/error state without crashing.
 */
import { handle } from '../ipc'
import { getProvider } from '../storage'
import { getTtsProvider } from './registry'

/** Register the `tts:listVoices` and `tts:synthesize` handlers. */
export function registerTtsIpc(): void {
  handle('tts:listVoices', async () => {
    const provider = getTtsProvider()
    return provider.listVoices()
  })

  handle('tts:synthesize', async (request) => {
    const { ref, ...synthesizeReq } = request
    const storageProvider = getProvider(ref.location)
    const bundlePath = storageProvider.resolvePath(ref)

    const provider = getTtsProvider()
    return provider.synthesize(bundlePath, synthesizeReq)
  })
}

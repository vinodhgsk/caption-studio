/**
 * Motion-tracking provider registry / factory (P8.9, Doc 11) — the pluggability seam.
 *
 * Mirrors the STT provider registry (`src/main/stt/registry.ts`): callers (the
 * `tracking:run` IPC handler) resolve a provider through {@link getTrackingProvider}
 * and NEVER construct one directly, so a real face/object CV provider (OpenCV /
 * cloud) can be registered and made active WITHOUT changing any caller. Selection is
 * keyed by provider `id`; the active id defaults to the deterministic stub and is
 * overridable via the `CAPTION_STUDIO_TRACKING_PROVIDER` env var (tests/CI) or
 * {@link setActiveTrackingProvider}.
 *
 * Pure registry — no electron import; the providers it holds own their own OS
 * boundaries (the stub has none; a CV tracker decodes frames in its own module).
 */
import type { TrackingProvider } from '../../shared/tracking'
import { StubTrackingProvider, STUB_TRACKING_PROVIDER_ID } from './StubProvider'

/** Registered providers, keyed by `id`. A real CV tracker registers alongside. */
const providers = new Map<string, TrackingProvider>()

/** Register (or replace) a provider under its `id`. */
export function registerTrackingProvider(provider: TrackingProvider): void {
  providers.set(provider.id, provider)
}

/** The default/fallback provider id when none is selected (the stub). */
export const DEFAULT_TRACKING_PROVIDER_ID = STUB_TRACKING_PROVIDER_ID

/** The env var that pins the active provider (tests/CI / opt-in CV). */
export const TRACKING_PROVIDER_ENV = 'CAPTION_STUDIO_TRACKING_PROVIDER'

let activeId: string | null = null

/**
 * Override the active provider id (e.g. once a CV tracker is available). Pass `null`
 * to clear the explicit selection and fall back to the env var / default.
 */
export function setActiveTrackingProvider(id: string | null): void {
  activeId = id
}

/**
 * Resolve the active provider. Order of precedence:
 *   1. an explicit {@link setActiveTrackingProvider} id,
 *   2. the `CAPTION_STUDIO_TRACKING_PROVIDER` env var,
 *   3. the default (stub) id.
 * Throws if the resolved id is not registered (a programming error caught by the IPC
 * wrapper as `{ ok:false, error }`).
 */
export function getTrackingProvider(): TrackingProvider {
  const envId =
    typeof process !== 'undefined' && process.env
      ? process.env[TRACKING_PROVIDER_ENV]
      : undefined
  const id = activeId ?? envId ?? DEFAULT_TRACKING_PROVIDER_ID
  const provider = providers.get(id)
  if (provider === undefined) {
    throw new Error(`No tracking provider registered for id "${id}".`)
  }
  return provider
}

/** Register the built-in providers. Idempotent. Called at main startup. */
export function registerBuiltinTrackingProviders(): void {
  registerTrackingProvider(new StubTrackingProvider())
}

// Register built-ins on module load so a bare `getTrackingProvider()` works without
// an explicit setup call (mirrors the STT / font-suggest provider factories).
registerBuiltinTrackingProviders()

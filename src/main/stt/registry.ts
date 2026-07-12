/**
 * STT provider registry / factory (P4.4) — the pluggability seam.
 *
 * Callers (the `stt:transcribe` IPC handler) resolve a provider through
 * `getSttProvider()` and never construct one directly, so P4.5 can register the
 * real whisper.cpp provider (or swap the active one) WITHOUT changing any
 * caller. Selection is keyed by provider `id`; the active id defaults to the
 * stub and is overridable via `CAPTION_STUDIO_STT_PROVIDER` (tests/CI) or the
 * `setActiveSttProvider` setter.
 *
 * NO electron import — pure registry; the providers it holds own their own OS
 * boundaries (the stub has none; whisper.cpp will spawn in its own module).
 */
import type { SttProvider } from '../../shared/stt'
import { StubSttProvider } from './StubProvider'
import { E2eSttProvider } from './E2eProvider'
import { WhisperSttProvider, WHISPER_PROVIDER_ID, isWhisperAvailable } from './WhisperProvider'

/** Built-in providers, keyed by `id`. P4.5 adds `whisper`. */
const providers = new Map<string, SttProvider>()

/** Register (or replace) a provider under its `id`. */
export function registerSttProvider(provider: SttProvider): void {
  providers.set(provider.id, provider)
}

/** The default/fallback provider id when none is selected. */
export const DEFAULT_STT_PROVIDER_ID = 'stub'

let activeId: string | null = null

/**
 * Override the active provider id (e.g. once whisper.cpp is available). Pass
 * `null` to clear the explicit selection and fall back to the env var / default.
 */
export function setActiveSttProvider(id: string | null): void {
  activeId = id
}

/**
 * Resolve the active provider. Order of precedence:
 *   1. an explicit `setActiveSttProvider` id,
 *   2. the `CAPTION_STUDIO_STT_PROVIDER` env var,
 *   3. the default (stub) id.
 * Throws if the resolved id is not registered (a programming error caught by
 * the IPC wrapper as `{ ok:false, error }`).
 */
export function getSttProvider(): SttProvider {
  const id = activeId ?? process.env.CAPTION_STUDIO_STT_PROVIDER ?? DEFAULT_STT_PROVIDER_ID
  const provider = providers.get(id)
  if (provider === undefined) {
    throw new Error(`No STT provider registered for id "${id}".`)
  }
  return provider
}

/** Register the built-in providers. Idempotent. Called at main startup. */
export function registerBuiltinSttProviders(): void {
  registerSttProvider(new StubSttProvider())
  registerSttProvider(new WhisperSttProvider())
  // E2E-only provider — inert unless explicitly selected via
  // `CAPTION_STUDIO_STT_PROVIDER=e2e` (Playwright headed UI runs).
  registerSttProvider(new E2eSttProvider())
}

/**
 * Pick the best AVAILABLE provider as the active one (called once at main
 * startup, after `registerBuiltinSttProviders`). Precedence is preserved by
 * `getSttProvider`: an explicit `CAPTION_STUDIO_STT_PROVIDER` env var still wins,
 * so this only sets the active id when none is pinned. whisper.cpp becomes the
 * default WHEN its binary + model are present; otherwise the stub stays the
 * graceful fallback (never crashes if whisper isn't installed).
 *
 * Returns the selected id (useful for logging/tests).
 */
export function selectDefaultProvider(): string {
  if (process.env.CAPTION_STUDIO_STT_PROVIDER !== undefined) {
    return process.env.CAPTION_STUDIO_STT_PROVIDER
  }
  const id = isWhisperAvailable() ? WHISPER_PROVIDER_ID : DEFAULT_STT_PROVIDER_ID
  setActiveSttProvider(id)
  return id
}

// Register built-ins on module load so a bare `getSttProvider()` works without
// an explicit setup call (mirrors the storage provider factory pattern).
registerBuiltinSttProviders()

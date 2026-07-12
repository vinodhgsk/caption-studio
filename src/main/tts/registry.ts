/**
 * TTS provider registry / factory (P10.2, Doc 12) — the pluggability seam.
 *
 * Mirrors the STT provider registry (`src/main/stt/registry.ts`): callers (the
 * `tts:listVoices` / `tts:synthesize` IPC handlers) resolve a provider through
 * {@link getTtsProvider} and NEVER construct one directly, so a real TTS engine
 * (cloud/local) can be registered and made active WITHOUT changing any caller.
 *
 * The active id defaults to the stub and is overridable via the
 * `CAPTION_STUDIO_TTS_PROVIDER` env var (tests/CI) or {@link setActiveTtsProvider}.
 *
 * Pure registry — no electron import.
 */
import type { TTSProvider } from '../../shared/tts'
import { StubTtsProvider } from './StubProvider'

/** Registered providers, keyed by `id`. A real TTS engine registers alongside. */
const providers = new Map<string, TTSProvider>()

/** Register (or replace) a provider under its `id`. */
export function registerTtsProvider(id: string, provider: TTSProvider): void {
  providers.set(id, provider)
}

/** The default/fallback provider id when none is explicitly selected. */
export const DEFAULT_TTS_PROVIDER_ID = 'stub'

/** The env var that pins the active provider (tests/CI). */
export const TTS_PROVIDER_ENV = 'CAPTION_STUDIO_TTS_PROVIDER'

let activeId: string | null = null

/**
 * Override the active provider id. Pass `null` to clear the explicit selection
 * and fall back to the env var / default.
 */
export function setActiveTtsProvider(id: string | null): void {
  activeId = id
}

/**
 * Resolve the active provider. Order of precedence:
 *   1. an explicit {@link setActiveTtsProvider} id,
 *   2. the `CAPTION_STUDIO_TTS_PROVIDER` env var,
 *   3. the default (stub) id.
 * Throws if the resolved id is not registered (caught by the IPC wrapper as
 * `{ok:false,error}`).
 */
export function getTtsProvider(): TTSProvider {
  const envId =
    typeof process !== 'undefined' && process.env
      ? process.env[TTS_PROVIDER_ENV]
      : undefined
  const id = activeId ?? envId ?? DEFAULT_TTS_PROVIDER_ID
  const provider = providers.get(id)
  if (provider === undefined) {
    throw new Error(`No TTS provider registered for id "${id}".`)
  }
  return provider
}

/**
 * Returns true when a TTS provider is registered and usable (not necessarily
 * a real engine — the stub always satisfies this). Used to drive disabled state
 * in the UI without crashing.
 */
export function hasTtsProvider(): boolean {
  const envId =
    typeof process !== 'undefined' && process.env
      ? process.env[TTS_PROVIDER_ENV]
      : undefined
  const id = activeId ?? envId ?? DEFAULT_TTS_PROVIDER_ID
  return providers.has(id)
}

/** Register the built-in providers. Idempotent. Called at main startup. */
export function registerBuiltinTtsProviders(): void {
  registerTtsProvider(DEFAULT_TTS_PROVIDER_ID, new StubTtsProvider())
}

// Register built-ins on module load so a bare `getTtsProvider()` works without
// an explicit setup call (mirrors the STT / tracking provider factory pattern).
registerBuiltinTtsProviders()

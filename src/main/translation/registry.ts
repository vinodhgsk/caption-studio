/**
 * Translation provider registry / factory (P10.5, Doc 12) — the pluggability seam.
 *
 * Mirrors the TTS/STT provider registries: callers (the `translation:translate`
 * IPC handler) resolve a provider through {@link getTranslationProvider} and NEVER
 * construct one directly, so a real translation engine (cloud/local) can be
 * registered and made active WITHOUT changing any caller.
 *
 * Pure registry — no electron import.
 */
import type { TranslationProvider } from '../../shared/translation'
import { StubTranslationProvider } from './StubProvider'

/** Registered providers, keyed by `id`. A real engine registers alongside. */
const providers = new Map<string, TranslationProvider>()

/** Register (or replace) a provider under its `id`. */
export function registerTranslationProvider(id: string, provider: TranslationProvider): void {
  providers.set(id, provider)
}

/** The default/fallback provider id when none is explicitly selected. */
export const DEFAULT_TRANSLATION_PROVIDER_ID = 'stub'

/** The env var that pins the active provider (tests/CI). */
export const TRANSLATION_PROVIDER_ENV = 'CAPTION_STUDIO_TRANSLATION_PROVIDER'

let activeId: string | null = null

/**
 * Override the active provider id. Pass `null` to clear and fall back to the
 * env var / default.
 */
export function setActiveTranslationProvider(id: string | null): void {
  activeId = id
}

/**
 * Resolve the active provider. Order of precedence:
 *   1. an explicit {@link setActiveTranslationProvider} id,
 *   2. the `CAPTION_STUDIO_TRANSLATION_PROVIDER` env var,
 *   3. the default (stub) id.
 * Throws if the resolved id is not registered (caught by the IPC wrapper as
 * `{ok:false,error}`).
 */
export function getTranslationProvider(): TranslationProvider {
  const envId =
    typeof process !== 'undefined' && process.env
      ? process.env[TRANSLATION_PROVIDER_ENV]
      : undefined
  const id = activeId ?? envId ?? DEFAULT_TRANSLATION_PROVIDER_ID
  const provider = providers.get(id)
  if (provider === undefined) {
    throw new Error(`No translation provider registered for id "${id}".`)
  }
  return provider
}

/** Register the built-in providers. Idempotent. Called at main startup. */
export function registerBuiltinTranslationProviders(): void {
  registerTranslationProvider(DEFAULT_TRANSLATION_PROVIDER_ID, new StubTranslationProvider())
}

// Register built-ins on module load so a bare `getTranslationProvider()` works
// without an explicit setup call.
registerBuiltinTranslationProviders()

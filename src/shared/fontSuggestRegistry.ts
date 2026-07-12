/**
 * Font-suggestion provider registry / factory (P6.6) — the pluggability seam.
 *
 * Mirrors the STT provider registry (`src/main/stt/registry.ts`): callers (the
 * Fonts panel's "AI font" input) resolve a provider through
 * {@link getFontSuggestionProvider} and NEVER construct one directly, so a cloud
 * LLM-backed provider can be registered and made active WITHOUT changing any
 * caller. Selection is keyed by provider `id`; the active id defaults to the
 * local deterministic provider and is overridable via the
 * `CAPTION_STUDIO_FONT_SUGGEST_PROVIDER` env var (tests/CI) or
 * {@link setActiveFontSuggestionProvider}.
 *
 * Pure registry — no electron import. The built-in local provider is pure too
 * (it only reads the font registry). A cloud provider added later owns its own
 * network boundary in its own module.
 */
import type { FontSuggestionProvider } from './fontSuggest'
import { localFontSuggestionProvider, LOCAL_FONT_PROVIDER_ID } from './fontSuggestLocal'

/** Registered providers, keyed by `id`. */
const providers = new Map<string, FontSuggestionProvider>()

/** Register (or replace) a provider under its `id`. */
export function registerFontSuggestionProvider(provider: FontSuggestionProvider): void {
  providers.set(provider.id, provider)
}

/** The default/fallback provider id when none is selected (the local provider). */
export const DEFAULT_FONT_SUGGEST_PROVIDER_ID = LOCAL_FONT_PROVIDER_ID

/** The env var that pins the active provider (tests/CI / opt-in cloud). */
export const FONT_SUGGEST_PROVIDER_ENV = 'CAPTION_STUDIO_FONT_SUGGEST_PROVIDER'

let activeId: string | null = null

/**
 * Override the active provider id (e.g. once a cloud provider is available). Pass
 * `null` to clear the explicit selection and fall back to the env var / default.
 */
export function setActiveFontSuggestionProvider(id: string | null): void {
  activeId = id
}

/**
 * Resolve the active provider. Order of precedence:
 *   1. an explicit {@link setActiveFontSuggestionProvider} id,
 *   2. the `CAPTION_STUDIO_FONT_SUGGEST_PROVIDER` env var,
 *   3. the default (local) id.
 * Throws if the resolved id is not registered (a programming error).
 */
export function getFontSuggestionProvider(): FontSuggestionProvider {
  const envId =
    typeof process !== 'undefined' && process.env
      ? process.env[FONT_SUGGEST_PROVIDER_ENV]
      : undefined
  const id = activeId ?? envId ?? DEFAULT_FONT_SUGGEST_PROVIDER_ID
  const provider = providers.get(id)
  if (provider === undefined) {
    throw new Error(`No font-suggestion provider registered for id "${id}".`)
  }
  return provider
}

/** Register the built-in providers. Idempotent. */
export function registerBuiltinFontSuggestionProviders(): void {
  registerFontSuggestionProvider(localFontSuggestionProvider)
}

// Register built-ins on module load so a bare `getFontSuggestionProvider()` works
// without an explicit setup call (mirrors the STT provider factory pattern).
registerBuiltinFontSuggestionProviders()

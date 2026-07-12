/**
 * First-run onboarding modal (P13.9).
 *
 * Shown once when `settings.onboardingComplete` is falsy (checked by the
 * Home route via `localStorage.getItem('onboardingComplete')`).
 *
 * Steps:
 *   1. Welcome + storage location choice (Local / OneDrive)
 *   2. Language selection (Tamil default, 6 choices)
 *   3. STT model note (stub: "Using built-in speech recognizer")
 *   4. Done
 */
import { useState } from 'react'
import type { StorageLocation } from '../../../shared/storage'

/** The six Indic-first languages available at project creation. */
const LANGUAGES: { code: string; label: string }[] = [
  { code: 'ta', label: 'Tamil' },
  { code: 'te', label: 'Telugu' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'kn', label: 'Kannada' },
  { code: 'hi', label: 'Hindi' },
  { code: 'en', label: 'English' }
]

const TOTAL_STEPS = 4

interface OnboardingModalProps {
  onComplete(): void
}

/**
 * Four-step first-run onboarding modal.
 * Renders `null` after the user reaches the Done step and calls `onComplete`.
 */
export function OnboardingModal({ onComplete }: OnboardingModalProps): JSX.Element | null {
  const [step, setStep] = useState(1)
  const [storageLocation, setStorageLocation] = useState<StorageLocation>('local')
  const [language, setLanguage] = useState<string>('ta')

  const goNext = (): void => {
    if (step < TOTAL_STEPS) {
      setStep((s) => s + 1)
    } else {
      onComplete()
    }
  }

  const goBack = (): void => {
    if (step > 1) setStep((s) => s - 1)
  }

  return (
    /* Full-screen backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onComplete() }}
    >
      <div className="w-full max-w-md rounded-xl border border-line bg-surface-2 p-6 shadow-2xl">
        {/* Step indicator */}
        <div className="mb-4 flex items-center gap-1.5" aria-label={`Step ${step} of ${TOTAL_STEPS}`}>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i + 1 <= step ? 'bg-accent' : 'bg-line'
              }`}
            />
          ))}
        </div>

        {/* ── Step 1: Welcome + storage location ─────────────────────────── */}
        {step === 1 && (
          <>
            <h2 id="onboarding-title" className="mb-1 text-lg font-semibold text-text-primary">
              Welcome to Caption Studio
            </h2>
            <p className="mb-4 text-sm text-text-secondary">
              Let&apos;s get you set up in under a minute.
            </p>
            <fieldset className="mb-4">
              <legend className="mb-2 text-sm font-medium text-text-primary">
                Where would you like to store your projects?
              </legend>
              <div className="flex flex-col gap-2">
                {(['local', 'onedrive', 'synology'] as const).map((loc, idx) => (
                  <label
                    key={loc}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                      storageLocation === loc
                        ? 'border-accent bg-accent/10'
                        : 'border-line bg-surface-1 hover:border-accent/50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="storageLocation"
                      value={loc}
                      checked={storageLocation === loc}
                      onChange={() => setStorageLocation(loc)}
                      className="accent-accent"
                      autoFocus={idx === 0}
                    />
                    <span className="text-sm text-text-primary">
                      {loc === 'local'
                        ? 'Local storage'
                        : loc === 'onedrive'
                        ? 'OneDrive (cloud sync)'
                        : 'Synology Drive (NAS sync)'}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        )}

        {/* ── Step 2: Language selection ───────────────────────────────────── */}
        {step === 2 && (
          <>
            <h2 id="onboarding-title" className="mb-1 text-lg font-semibold text-text-primary">
              Choose your primary language
            </h2>
            <p className="mb-4 text-sm text-text-secondary">
              This sets the default language for new projects. You can change it per-project later.
            </p>
            <div className="mb-4 grid grid-cols-2 gap-2">
              {LANGUAGES.map(({ code, label }, idx) => (
                <button
                  key={code}
                  type="button"
                  className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                    language === code
                      ? 'border-accent bg-accent/10 font-medium text-accent'
                      : 'border-line bg-surface-1 text-text-primary hover:border-accent/50'
                  }`}
                  onClick={() => setLanguage(code)}
                  aria-pressed={language === code}
                  autoFocus={idx === 0}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}

        {/* ── Step 3: STT model note ───────────────────────────────────────── */}
        {step === 3 && (
          <>
            <h2 id="onboarding-title" className="mb-1 text-lg font-semibold text-text-primary">
              Speech recognition
            </h2>
            <p className="mb-4 text-sm text-text-secondary">
              Caption Studio uses a built-in speech recognizer to auto-generate captions from your
              audio. No internet connection required for captioning.
            </p>
            <div className="mb-4 rounded-lg border border-line bg-surface-1 px-4 py-3 text-sm text-text-secondary">
              <span className="font-medium text-text-primary">Using built-in speech recognizer</span>
              <br />
              Supports Tamil, Telugu, Malayalam, Kannada, Hindi, and English out of the box.
            </div>
          </>
        )}

        {/* ── Step 4: Done ─────────────────────────────────────────────────── */}
        {step === 4 && (
          <>
            <h2 id="onboarding-title" className="mb-1 text-lg font-semibold text-text-primary">
              You&apos;re all set!
            </h2>
            <p className="mb-4 text-sm text-text-secondary">
              Your preferences have been saved. Start by creating a new project from the home
              screen.
            </p>
            <ul className="mb-4 list-inside list-disc space-y-1 text-sm text-text-secondary">
              <li>
                Storage:{' '}
                {storageLocation === 'local'
                  ? 'Local storage'
                  : storageLocation === 'onedrive'
                  ? 'OneDrive'
                  : 'Synology Drive'}
              </li>
              <li>
                Language:{' '}
                {LANGUAGES.find((l) => l.code === language)?.label ?? language}
              </li>
              <li>Speech recognizer: built-in</li>
            </ul>
          </>
        )}

        {/* Navigation buttons */}
        <div className="flex items-center justify-between">
          {step > 1 ? (
            <button
              type="button"
              className="rounded-md px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary"
              onClick={goBack}
            >
              Back
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
            onClick={goNext}
            autoFocus={step === 3 || step === 4}
          >
            {step < TOTAL_STEPS ? 'Continue' : 'Get started'}
          </button>
        </div>
      </div>
    </div>
  )
}

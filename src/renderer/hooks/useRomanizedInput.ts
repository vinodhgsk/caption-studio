/**
 * Romanized input hook (P10R.3, Doc 16) — converts a Latin romanized string
 * to the chosen Indic script, debounced 200 ms.
 *
 * This is a thin React wrapper over `romanizedToIndic` from the shared module
 * and is intended for live-preview use in input fields where the user types in
 * Latin and sees the Indic equivalent in real time.
 */

import { useState, useEffect } from 'react'
import type { SupportedLang } from '../../shared/transliteration'
import { romanizedToIndic } from '../../shared/romanizedInput'

/**
 * Given a controlled text input value (latin), returns the converted Indic
 * string for `targetLang`. Debounced 200 ms so rapid keystrokes do not
 * trigger a conversion on every character.
 *
 * Returns the empty string while no `latin` input is provided.
 */
export function useRomanizedInput(
  latin: string,
  targetLang: SupportedLang
): string {
  const [converted, setConverted] = useState<string>('')

  useEffect(() => {
    if (latin === '') {
      setConverted('')
      return
    }

    if (targetLang === 'en') {
      // English target is identity — no conversion needed.
      setConverted(latin)
      return
    }

    const timerId = window.setTimeout(() => {
      const result = romanizedToIndic(
        latin,
        targetLang as Exclude<SupportedLang, 'en'>
      )
      setConverted(result)
    }, 200)

    return () => window.clearTimeout(timerId)
  }, [latin, targetLang])

  return converted
}

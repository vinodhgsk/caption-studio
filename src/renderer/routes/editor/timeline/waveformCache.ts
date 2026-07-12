/**
 * Per-media decoded-waveform cache (P4.2 — Doc 02 "show waveform on the
 * timeline").
 *
 * IMPURE: wraps the Web Audio decode (`decodeWaveform`) behind a module-level
 * memo so a source file is decoded ONCE per (bundle, mediaRef) — not on every
 * render, scroll, or zoom, and not once per clip that references it. The cache
 * stores the in-flight PROMISE (not just the resolved value) so concurrent
 * callers for the same media de-duplicate onto a single decode; a rejected decode
 * is evicted so a later mount can retry.
 *
 * The cache key + the pure peak->pixel mapping live in `clipWaveform.ts`
 * (node-testable); this module only owns the side-effecting memo + IPC plumbing.
 */

import { useEffect, useState } from 'react'
import { decodeWaveform } from './decodeWaveform'
import { mediaRefToUrl } from '../preview/mediaSource'
import { waveformCacheKey } from './clipWaveform'
import type { Waveform } from './waveform'

/** Resolved waveforms + in-flight decodes, keyed by `waveformCacheKey`. */
const cache = new Map<string, Waveform>()
const inFlight = new Map<string, Promise<Waveform>>()

/**
 * Decode (or return the cached) {@link Waveform} for a clip's `mediaRef` within
 * the bundle at `bundleAbs`. Resolves immediately from cache on a hit; otherwise
 * decodes once and shares the promise with concurrent callers. A failed decode is
 * NOT cached (evicted) so the next caller retries.
 */
export async function getWaveform(bundleAbs: string, mediaRef: string): Promise<Waveform> {
  const key = waveformCacheKey(bundleAbs, mediaRef)
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  const pending = inFlight.get(key)
  if (pending !== undefined) return pending

  const url = mediaRefToUrl(bundleAbs, mediaRef)
  const promise = decodeWaveform(url)
    .then((wf) => {
      cache.set(key, wf)
      inFlight.delete(key)
      return wf
    })
    .catch((err: unknown) => {
      inFlight.delete(key)
      throw err
    })
  inFlight.set(key, promise)
  return promise
}

/** Synchronous cache peek (used to avoid a decode flash when already resolved). */
export function peekWaveform(bundleAbs: string, mediaRef: string): Waveform | undefined {
  return cache.get(waveformCacheKey(bundleAbs, mediaRef))
}

/** Test-only: clear all cached + in-flight waveforms. */
export function __clearWaveformCache(): void {
  cache.clear()
  inFlight.clear()
}

/** Clear all cached + in-flight waveforms for a specific project bundle. */
export function clearProjectWaveforms(bundleAbs: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${bundleAbs}::`)) {
      cache.delete(key)
    }
  }
  for (const key of inFlight.keys()) {
    if (key.startsWith(`${bundleAbs}::`)) {
      inFlight.delete(key)
    }
  }
}

/**
 * React hook: resolve a clip's decoded waveform, decoding ONCE per (bundle,
 * mediaRef) via the shared cache. Returns the cached waveform synchronously on a
 * hit (no flash), else `null` until the shared decode resolves. A stale resolve
 * (clip/bundle changed mid-decode) is ignored so it never overwrites the current
 * waveform.
 */
export function useClipWaveform(bundleAbs: string | null, mediaRef: string): Waveform | null {
  const [waveform, setWaveform] = useState<Waveform | null>(() =>
    bundleAbs === null ? null : (peekWaveform(bundleAbs, mediaRef) ?? null)
  )

  useEffect(() => {
    if (bundleAbs === null) {
      setWaveform(null)
      return
    }
    const cached = peekWaveform(bundleAbs, mediaRef)
    if (cached !== undefined) {
      setWaveform(cached)
      return
    }
    let active = true
    setWaveform(null)
    void getWaveform(bundleAbs, mediaRef)
      .then((wf) => {
        if (active) setWaveform(wf)
      })
      .catch(() => {
        // Decode failure: leave the placeholder shape; the panel surfaces errors.
        if (active) setWaveform(null)
      })
    return () => {
      active = false
    }
  }, [bundleAbs, mediaRef])

  return waveform
}

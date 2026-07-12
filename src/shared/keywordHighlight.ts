/**
 * Keyword highlight shared contract + pure detection heuristic (P10.7–P10.8,
 * Doc 12).
 *
 * Pure types + pure functions ONLY. NO electron / node / DOM imports leak here
 * so the renderer, tests, and future server-side processes can all import this
 * module without rework.
 */

import type { Word } from './stt'

/** Re-export so callers can use `TranscriptWord` for clarity. */
export type TranscriptWord = Word

/**
 * A single keyword highlight entry: the matched `word`, a CSS-compatible hex
 * `color` swatch, and the 0-based `indices` into `transcript.words[]` that match.
 */
export interface KeywordHighlight {
  word: string
  color: string
  /** 0-based word indices in transcript words[] that match. */
  indices: number[]
}

/** Palette of up to 5 highlight colors (deterministic, accessible). */
const HIGHLIGHT_COLORS: readonly string[] = [
  '#FFD700', // gold
  '#FF6B6B', // coral
  '#4ECDC4', // teal
  '#9B59B6', // purple
  '#F39C12'  // amber
] as const

/**
 * Auto-detect emphasis words from a transcript.
 *
 * Heuristic: a word is a candidate when it meets ANY of these criteria:
 *   1. All-caps (e.g. "NOW", "STOP") — likely intentional emphasis.
 *   2. Appears at most `maxFreq` (default 2) times in the whole transcript AND
 *      is longer than 4 characters — rare, meaningful words.
 *   3. Is followed by a pause of more than 0.3 s (end-of-word gap to next word
 *      start) — speaker-marked emphasis.
 *
 * Returns at most `maxKeywords` (default 5) candidates in deterministic order
 * (order of first appearance), with colours assigned from the palette.
 * Normalises to lowercase for deduplication.
 */
export function detectKeywords(words: TranscriptWord[], maxKeywords = 5): KeywordHighlight[] {
  if (words.length === 0) return []

  // Build a frequency map (normalized lowercase).
  const freq = new Map<string, number>()
  for (const w of words) {
    const key = w.text.toLowerCase()
    freq.set(key, (freq.get(key) ?? 0) + 1)
  }

  const maxFreq = 2
  const pauseThreshold = 0.3

  /** Whether `w` at `idx` is followed by a pause > threshold. */
  function hasPause(idx: number): boolean {
    const next = words[idx + 1]
    if (next === undefined) return false
    return next.start - words[idx].end > pauseThreshold
  }

  // Collect candidates in first-appearance order, deduplicated by lowercase key.
  const seen = new Set<string>()
  const candidates: { key: string; indices: number[] }[] = []

  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const key = w.text.toLowerCase()
    const count = freq.get(key) ?? 0

    const isAllCaps = w.text.length > 1 && w.text === w.text.toUpperCase() && /[A-Z]/.test(w.text)
    const isRareAndLong = count <= maxFreq && w.text.length > 4
    const hasFollowPause = hasPause(i)

    if (!isAllCaps && !isRareAndLong && !hasFollowPause) continue

    if (!seen.has(key)) {
      seen.add(key)
      candidates.push({ key, indices: [] })
    }

    // Record this index into the matching candidate entry.
    const entry = candidates.find((c) => c.key === key)
    if (entry !== undefined) entry.indices.push(i)

    if (candidates.length >= maxKeywords) break
  }

  // For candidates found via first-pass break-out, fill remaining indices of
  // already-seen keys in a second pass (words after the break were not visited).
  for (let i = 0; i < words.length; i++) {
    const key = words[i].text.toLowerCase()
    const entry = candidates.find((c) => c.key === key)
    if (entry !== undefined && !entry.indices.includes(i)) {
      entry.indices.push(i)
    }
  }

  return candidates.slice(0, maxKeywords).map((c, colorIdx) => ({
    word: c.key,
    color: HIGHLIGHT_COLORS[colorIdx % HIGHLIGHT_COLORS.length] ?? '#FFD700',
    indices: c.indices.sort((a, b) => a - b)
  }))
}

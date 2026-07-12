/**
 * Pure formatters for Projects Home card metadata. Kept dependency-free so they
 * can be unit-tested in a node env and reused by card internals (P2.2).
 */

/**
 * Format an ISO timestamp as a coarse relative "last modified" label, e.g.
 * "just now", "5 min ago", "3 h ago", "2 d ago", else a locale date.
 * Returns an empty string for missing/unparseable input.
 *
 * @param now Injectable clock for deterministic tests (defaults to Date.now()).
 */
export function formatLastModified(iso: string | undefined, now: number = Date.now()): string {
  if (!iso) return ''
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const diffMs = now - then
  if (diffMs < 0) return 'just now'

  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`

  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} h ago`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} d ago`

  return new Date(then).toLocaleDateString()
}

/**
 * Format a duration in seconds as `m:ss` (or `h:mm:ss` past an hour).
 * Returns an empty string when duration is undefined.
 */
export function formatDuration(durationSec: number | undefined): string {
  if (durationSec === undefined || Number.isNaN(durationSec) || durationSec < 0) return ''
  const total = Math.floor(durationSec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/**
 * P13.3 — Coverage raise for new utilities.
 *
 * Covers:
 *   - LruCache            (src/renderer/utils/lruCache.ts)
 *   - throttleToFps       (src/renderer/utils/throttle.ts)
 *   - isClipVisible       (src/renderer/routes/editor/timeline/scale.ts)
 *   - countClips          (src/shared/projectStats.ts)
 *   - transliterateSync   (src/shared/transliteration.ts)
 *
 * All tests are deterministic, pure, and headless.
 * No file I/O, no process spawning, no Electron, no DOM.
 */

import { describe, expect, it } from 'vitest'

import { LruCache } from '../renderer/utils/lruCache'
import { throttleToFps } from '../renderer/utils/throttle'
import { isClipVisible } from '../renderer/routes/editor/timeline/scale'
import { countClips, LARGE_PROJECT_CLIP_THRESHOLD } from './projectStats'
import { transliterateSync } from './transliteration'
import type { Project } from './storage'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Project fixture with the given set of track clip-counts. */
function makeProject(clipCounts: number[]): Project {
  return {
    version: 1,
    id: 'test-project',
    name: 'Test',
    createdAt: '2026-07-04T00:00:00.000Z',
    updatedAt: '2026-07-04T00:00:00.000Z',
    settings: {
      fps: 30,
      resolution: [1920, 1080],
      aspect: '16:9',
      background: '#000000',
      language: 'ta',
      languages: ['ta', 'en']
    },
    storage: { location: 'local', root: '/tmp/test' },
    tracks: clipCounts.map((n, i) => ({
      id: `track-${i}`,
      type: 'video' as const,
      clips: Array.from({ length: n }, (_, j) => ({
        id: `clip-${i}-${j}`,
        mediaRef: `media/clip${i}-${j}.mp4`,
        in: 0,
        out: 1,
        start: j,
        transform: {
          x: 0, y: 0, scale: 1, rotation: 0,
          flipH: false, flipV: false, opacity: 1, z: 0
        }
      }))
    }))
  }
}

// ===========================================================================
// LruCache
// ===========================================================================

describe('LruCache — construction', () => {
  it('size starts at 0 for a new cache', () => {
    const cache = new LruCache<string, number>(3)
    expect(cache.size).toBe(0)
  })

  it('throws RangeError when maxSize < 1', () => {
    expect(() => new LruCache(0)).toThrow(RangeError)
  })
})

describe('LruCache — set and get', () => {
  it('set then get returns the stored value', () => {
    const cache = new LruCache<string, string>(3)
    cache.set('key', 'value')
    expect(cache.get('key')).toBe('value')
  })

  it('size is 1 after one set', () => {
    const cache = new LruCache<string, number>(3)
    cache.set('a', 42)
    expect(cache.size).toBe(1)
  })

  it('get on missing key returns undefined', () => {
    const cache = new LruCache<string, number>(3)
    expect(cache.get('missing')).toBeUndefined()
  })

  it('size reflects current count correctly after multiple sets', () => {
    const cache = new LruCache<string, number>(5)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    expect(cache.size).toBe(3)
  })
})

describe('LruCache — delete', () => {
  it('delete removes the entry; subsequent get returns undefined', () => {
    const cache = new LruCache<string, number>(3)
    cache.set('x', 99)
    cache.delete('x')
    expect(cache.get('x')).toBeUndefined()
  })

  it('size decrements after delete', () => {
    const cache = new LruCache<string, number>(3)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.delete('a')
    expect(cache.size).toBe(1)
  })

  it('delete on a missing key is a no-op (does not throw)', () => {
    const cache = new LruCache<string, number>(3)
    expect(() => cache.delete('nonexistent')).not.toThrow()
  })
})

describe('LruCache — clear', () => {
  it('clear empties the cache; size becomes 0', () => {
    const cache = new LruCache<string, number>(3)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.clear()
    expect(cache.size).toBe(0)
  })

  it('get returns undefined for all keys after clear', () => {
    const cache = new LruCache<string, string>(3)
    cache.set('k1', 'v1')
    cache.set('k2', 'v2')
    cache.clear()
    expect(cache.get('k1')).toBeUndefined()
    expect(cache.get('k2')).toBeUndefined()
  })
})

describe('LruCache — capacity enforcement', () => {
  it('set 4 items into a cache of maxSize 3 — oldest is evicted, size stays ≤ 3', () => {
    const cache = new LruCache<string, number>(3)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    cache.set('d', 4)       // evicts 'a' (oldest)
    expect(cache.size).toBe(3)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
    expect(cache.get('d')).toBe(4)
  })

  it('LRU eviction order: accessing an existing item promotes it; older item is evicted', () => {
    const cache = new LruCache<string, number>(3)
    cache.set('a', 1)       // insertion order: a
    cache.set('b', 2)       // insertion order: a, b
    cache.set('c', 3)       // insertion order: a, b, c
    // Access 'a' to make it most-recently-used → order becomes: b, c, a
    cache.get('a')
    // Add 'd' — should evict 'b' (now the oldest), not 'a'
    cache.set('d', 4)
    expect(cache.get('b')).toBeUndefined()  // 'b' evicted
    expect(cache.get('a')).toBe(1)           // 'a' survives
    expect(cache.get('c')).toBe(3)
    expect(cache.get('d')).toBe(4)
  })

  it('overwriting an existing key does not grow the cache beyond maxSize', () => {
    const cache = new LruCache<string, number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('a', 99)      // update 'a' — no eviction needed
    expect(cache.size).toBe(2)
    expect(cache.get('a')).toBe(99)
    expect(cache.get('b')).toBe(2)
  })
})

// ===========================================================================
// throttleToFps
// ===========================================================================

describe('throttleToFps — first call', () => {
  it('first call with lastTimestamp=0 always returns true (t=0 means never called)', () => {
    const ref = { current: 0 }
    // performance.now() is always > 0, so now - 0 >= interval → true
    expect(throttleToFps(30, ref)).toBe(true)
  })

  it('updates lastTimestampRef.current after the first accepted call', () => {
    const ref = { current: 0 }
    throttleToFps(30, ref)
    expect(ref.current).toBeGreaterThan(0)
  })
})

describe('throttleToFps — second call immediately after', () => {
  it('second call immediately after returns false (within the same frame interval)', () => {
    const ref = { current: 0 }
    throttleToFps(30, ref)        // first call — accepted, updates ref
    const result = throttleToFps(30, ref)  // second call — too soon
    expect(result).toBe(false)
  })
})

describe('throttleToFps — simulated elapsed time', () => {
  it('returns true after simulating elapsed time > 1000/fps ms (set ref far in the past)', () => {
    const ref = { current: performance.now() - 1000 }  // 1 second ago
    // At 30 fps, interval = ~33 ms; 1000 ms >> 33 ms → should return true
    expect(throttleToFps(30, ref)).toBe(true)
  })

  it('returns false when ref is only slightly in the past (within interval)', () => {
    const ref = { current: performance.now() - 1 }  // 1 ms ago
    // At 30 fps, interval = ~33 ms; 1 ms < 33 ms → should return false
    expect(throttleToFps(30, ref)).toBe(false)
  })
})

describe('throttleToFps — various fps values', () => {
  it('works correctly at 24 fps — elapsed 1 second is past the interval', () => {
    const ref = { current: performance.now() - 500 }  // 500 ms ago; 24 fps = ~41.7 ms interval
    expect(throttleToFps(24, ref)).toBe(true)
  })

  it('works correctly at 60 fps — elapsed 1 second is past the interval', () => {
    const ref = { current: performance.now() - 500 }  // 500 ms ago; 60 fps = ~16.7 ms interval
    expect(throttleToFps(60, ref)).toBe(true)
  })

  it('works correctly at 30 fps — immediately after accepted call is throttled', () => {
    const ref = { current: 0 }
    throttleToFps(30, ref)
    expect(throttleToFps(30, ref)).toBe(false)
  })

  it('handles fps=0 or negative without throwing (treated as fps=1)', () => {
    const ref = { current: 0 }
    expect(() => throttleToFps(0, ref)).not.toThrow()
    expect(() => throttleToFps(-10, ref)).not.toThrow()
  })
})

// ===========================================================================
// isClipVisible
// ===========================================================================

describe('isClipVisible — inside viewport', () => {
  it('clip fully inside viewport → true', () => {
    // viewport: [2, 8], clip: [3, 5]
    expect(isClipVisible(3, 5, 2, 8)).toBe(true)
  })

  it('clip spanning entire viewport → true', () => {
    // viewport: [2, 8], clip: [2, 8]
    expect(isClipVisible(2, 8, 2, 8)).toBe(true)
  })
})

describe('isClipVisible — outside viewport', () => {
  it('clip fully before viewport → false', () => {
    // viewport: [5, 10], clip: [1, 3]
    expect(isClipVisible(1, 3, 5, 10)).toBe(false)
  })

  it('clip fully after viewport → false', () => {
    // viewport: [2, 6], clip: [8, 12]
    expect(isClipVisible(8, 12, 2, 6)).toBe(false)
  })
})

describe('isClipVisible — partial overlap', () => {
  it('clip partially overlapping left edge → true', () => {
    // viewport: [5, 10], clip: [3, 7] — overlaps [5, 7]
    expect(isClipVisible(3, 7, 5, 10)).toBe(true)
  })

  it('clip partially overlapping right edge → true', () => {
    // viewport: [2, 6], clip: [5, 9] — overlaps [5, 6]
    expect(isClipVisible(5, 9, 2, 6)).toBe(true)
  })
})

describe('isClipVisible — boundary / zero-length cases', () => {
  it('zero-length clip exactly at viewport start → false (clipEnd=start not > viewportStart)', () => {
    // viewport: [5, 10], zero-length clip at 5: start=5, end=5
    // isClipVisible: clipStart(5) < viewportEnd(10) AND clipEnd(5) > viewportStart(5)
    // 5 > 5 is false → result is false
    expect(isClipVisible(5, 5, 5, 10)).toBe(false)
  })

  it('clip ending exactly at viewport start → false (open interval)', () => {
    // viewport: [5, 10], clip: [2, 5] — clipEnd(5) > viewportStart(5) is false
    expect(isClipVisible(2, 5, 5, 10)).toBe(false)
  })

  it('clip starting exactly at viewport end → false (open interval)', () => {
    // viewport: [2, 6], clip: [6, 8] — clipStart(6) < viewportEnd(6) is false
    expect(isClipVisible(6, 8, 2, 6)).toBe(false)
  })
})

// ===========================================================================
// countClips
// ===========================================================================

describe('countClips — empty project', () => {
  it('returns 0 for a project with no tracks', () => {
    const project = makeProject([])
    expect(countClips(project)).toBe(0)
  })
})

describe('countClips — single track', () => {
  it('returns 3 for a project with one track containing 3 clips', () => {
    const project = makeProject([3])
    expect(countClips(project)).toBe(3)
  })

  it('returns 0 for a project with one empty track', () => {
    const project = makeProject([0])
    expect(countClips(project)).toBe(0)
  })
})

describe('countClips — multiple tracks', () => {
  it('returns 4 for a project with 2 tracks, 2 clips each', () => {
    const project = makeProject([2, 2])
    expect(countClips(project)).toBe(4)
  })

  it('sums clips correctly across many tracks', () => {
    const project = makeProject([1, 2, 3, 4])
    expect(countClips(project)).toBe(10)
  })

  it('handles tracks with different clip counts', () => {
    const project = makeProject([0, 5, 0, 3])
    expect(countClips(project)).toBe(8)
  })
})

describe('LARGE_PROJECT_CLIP_THRESHOLD', () => {
  it('is exported and equals 500', () => {
    expect(LARGE_PROJECT_CLIP_THRESHOLD).toBe(500)
  })

  it('is a number', () => {
    expect(typeof LARGE_PROJECT_CLIP_THRESHOLD).toBe('number')
  })
})

// ===========================================================================
// transliterateSync — additional edge cases
// ===========================================================================

describe('transliterateSync — identity (same language)', () => {
  it('same-language pass-through returns text unchanged (ta → ta)', () => {
    const text = 'வணக்கம்'
    expect(transliterateSync(text, 'ta', 'ta')).toBe(text)
  })

  it('same-language pass-through returns text unchanged (en → en)', () => {
    expect(transliterateSync('hello', 'en', 'en')).toBe('hello')
  })
})

describe('transliterateSync — whitespace handling', () => {
  it('whitespace-only input (spaces) is returned as the same whitespace', () => {
    const ws = '   '
    const result = transliterateSync(ws, 'en', 'ta')
    expect(result).toBe(ws)
  })

  it('whitespace-only input (tab + newline) is returned unchanged', () => {
    const ws = '\t\n'
    const result = transliterateSync(ws, 'en', 'ta')
    expect(result).toBe(ws)
  })
})

describe('transliterateSync — vowel mappings (en → ta)', () => {
  it("'aa' maps to Tamil long-a vowel ஆ", () => {
    const result = transliterateSync('aa', 'en', 'ta')
    expect(result).toBe('ஆ')
  })

  it("'a' maps to Tamil short-a vowel அ", () => {
    const result = transliterateSync('a', 'en', 'ta')
    expect(result).toBe('அ')
  })

  it("'i' maps to Tamil short-i vowel இ", () => {
    const result = transliterateSync('i', 'en', 'ta')
    expect(result).toBe('இ')
  })
})

describe('transliterateSync — consonant mappings (en → ta)', () => {
  it("'k' maps to Tamil velar consonant க", () => {
    const result = transliterateSync('k', 'en', 'ta')
    expect(result).toBe('க')
  })

  it("'m' maps to Tamil anusvara form ம் (anusvara phoneme takes priority over labial)", () => {
    // In the pivot table, 'anusvara' has en:'m' and appears before the labial
    // consonant phoneme 'm'. The greedy tokenizer picks anusvara first, so
    // transliterating 'm' → ta yields the anusvara Tamil form 'ம்'.
    const result = transliterateSync('m', 'en', 'ta')
    expect(result).toBe('ம்')
  })

  it("'n' maps to Tamil dental consonant ன", () => {
    const result = transliterateSync('n', 'en', 'ta')
    expect(result).toBe('ன')
  })
})

describe('transliterateSync — mixed content (Tamil + digits)', () => {
  it('digits pass through unchanged in en→ta transliteration', () => {
    // Digits are not in the phoneme table, so they pass through as-is.
    const result = transliterateSync('a1b2', 'en', 'ta')
    // Digits must survive; Tamil chars replace 'a' and 'b'
    expect(result).toContain('1')
    expect(result).toContain('2')
  })

  it('Tamil script chars mixed with digits: digits are preserved in ta→en', () => {
    // Tamil 'a' vowel (அ) with a digit
    const input = 'அ1'
    const result = transliterateSync(input, 'ta', 'en')
    expect(result).toContain('1')
  })

  it('punctuation passes through unchanged', () => {
    const result = transliterateSync('a, b!', 'en', 'ta')
    expect(result).toContain(',')
    expect(result).toContain('!')
  })
})

describe('transliterateSync — cross-language vowel round-trips', () => {
  it("Tamil ஆ (long-a vowel) transliterates to English 'aa'", () => {
    const result = transliterateSync('ஆ', 'ta', 'en')
    expect(result).toBe('aa')
  })

  it("Tamil அ (short-a vowel) transliterates to English 'a'", () => {
    const result = transliterateSync('அ', 'ta', 'en')
    expect(result).toBe('a')
  })
})

describe('transliterateSync — empty string', () => {
  it('empty string returns empty string for any language pair', () => {
    expect(transliterateSync('', 'en', 'ta')).toBe('')
    expect(transliterateSync('', 'ta', 'en')).toBe('')
    expect(transliterateSync('', 'hi', 'ml')).toBe('')
  })
})

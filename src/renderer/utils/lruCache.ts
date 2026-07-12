/**
 * In-memory LRU cache utility (P13.4 — Performance Pass: waveform/thumbnail cache).
 *
 * Pure: no DOM / electron imports. Uses a `Map` whose insertion order tracks
 * recency — on every `get` the accessed entry is re-inserted last so the Map
 * keeps entries sorted oldest-first; eviction always removes the first entry.
 */
export class LruCache<K, V> {
  private readonly _maxSize: number
  private readonly _cache: Map<K, V>

  constructor(maxSize: number) {
    if (maxSize < 1) throw new RangeError('LruCache maxSize must be >= 1')
    this._maxSize = maxSize
    this._cache = new Map<K, V>()
  }

  /**
   * Return the cached value for `key`, or `undefined` if not present.
   * Marks the entry as most-recently-used.
   */
  get(key: K): V | undefined {
    if (!this._cache.has(key)) return undefined
    // Re-insert to make this entry the newest in Map iteration order.
    const value = this._cache.get(key) as V
    this._cache.delete(key)
    this._cache.set(key, value)
    return value
  }

  /**
   * Store `value` under `key`. If the cache is at capacity, the
   * least-recently-used entry is evicted first.
   */
  set(key: K, value: V): void {
    if (this._cache.has(key)) {
      // Refresh recency on update.
      this._cache.delete(key)
    } else if (this._cache.size >= this._maxSize) {
      // Evict the oldest entry (first in Map iteration order).
      const oldest = this._cache.keys().next().value as K
      this._cache.delete(oldest)
    }
    this._cache.set(key, value)
  }

  /** Remove an entry by key. No-op if the key is not present. */
  delete(key: K): void {
    this._cache.delete(key)
  }

  /** Evict all entries. */
  clear(): void {
    this._cache.clear()
  }

  /** Number of entries currently held in the cache. */
  get size(): number {
    return this._cache.size
  }
}

/**
 * Framework-free debounce. Collapses a burst of calls into a single trailing
 * invocation fired `waitMs` after the last call. Pure (timer-based, no React)
 * so it is unit-testable with fake timers.
 *
 * The returned function carries `.cancel()` (drop any pending call) and
 * `.flush()` (run a pending call now with its captured latest args).
 */
export interface Debounced<TArgs extends unknown[]> {
  (...args: TArgs): void
  /** Drop any pending trailing invocation. */
  cancel(): void
  /** Immediately run a pending trailing invocation (no-op if none pending). */
  flush(): void
}

export function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  waitMs: number
): Debounced<TArgs> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingArgs: TArgs | null = null

  const run = (): void => {
    timer = null
    if (pendingArgs === null) return
    const args = pendingArgs
    pendingArgs = null
    fn(...args)
  }

  const debounced = ((...args: TArgs): void => {
    pendingArgs = args
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(run, waitMs)
  }) as Debounced<TArgs>

  debounced.cancel = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    pendingArgs = null
  }

  debounced.flush = (): void => {
    if (timer !== null) clearTimeout(timer)
    run()
  }

  return debounced
}

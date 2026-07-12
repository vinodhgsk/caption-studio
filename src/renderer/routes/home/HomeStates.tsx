/**
 * Loading / empty / error states for Projects Home. Kept as small presentational
 * components so the route body stays a thin status switch.
 */

export interface LoadingStateProps {
  viewMode: 'grid' | 'list'
}

/** Skeleton container shown while `storage:listProjects` resolves. */
export function LoadingState({ viewMode }: LoadingStateProps): JSX.Element {
  if (viewMode === 'list') {
    return (
      <div className="w-full overflow-hidden rounded-lg border border-line bg-surface-1" aria-hidden>
        <div className="border-b border-line bg-surface-2/50 px-4 py-3 h-10 w-full" />
        <ul className="divide-y divide-line">
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className="flex items-center justify-between px-4 py-4">
              <div className="flex items-center gap-3 w-1/3">
                <div className="h-4 w-2/3 animate-pulse rounded bg-surface-2" />
                <div className="h-3.5 w-12 animate-pulse rounded bg-surface-2" />
              </div>
              <div className="h-4 w-12 animate-pulse rounded bg-surface-2" />
              <div className="h-4 w-16 animate-pulse rounded bg-surface-2" />
              <div className="h-4 w-24 animate-pulse rounded bg-surface-2" />
              <div className="h-6 w-6 animate-pulse rounded bg-surface-2" />
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <ul
      className="grid gap-4"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))' }}
      aria-hidden
    >
      {Array.from({ length: 6 }, (_, i) => (
        <li
          key={i}
          className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface-1"
        >
          <div className="aspect-video animate-pulse bg-surface-2" />
          <div className="flex flex-col gap-2.5 p-3.5">
            <div className="flex items-center justify-between">
              <div className="h-4 w-2/3 animate-pulse rounded bg-surface-2" />
              <div className="h-3.5 w-10 animate-pulse rounded bg-surface-2" />
            </div>
            <div className="h-3 w-1/3 animate-pulse rounded bg-surface-2" />
          </div>
        </li>
      ))}
    </ul>
  )
}

export interface EmptyStateProps {
  /** Seam for the New-Project dialog (P2.3). */
  onNewProject?: () => void
}

/** Shown when the listing resolves with zero projects. */
export function EmptyState({ onNewProject }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-line bg-surface-1/40 p-12 text-center max-w-2xl mx-auto my-8">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/5 text-accent border border-accent/10">
        <svg
          className="h-8 w-8"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
      </div>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-text-primary">No drafts yet</h2>
        <p className="max-w-sm text-xs text-text-secondary leading-relaxed">
          Create your first project to start generating captions. Drafts will be stored and cached in your selected workspace location.
        </p>
      </div>
      <button
        type="button"
        onClick={onNewProject}
        className="rounded-md bg-accent px-4 py-2 text-xs font-semibold text-text-primary transition-colors hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent"
      >
        Start Creating
      </button>
    </div>
  )
}

export interface ErrorStateProps {
  message: string
  onRetry?: () => void
}

/** Shown when `storage:listProjects` returns `{ ok: false }` or throws. */
export function ErrorState({ message, onRetry }: ErrorStateProps): JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-line bg-surface-1 p-12 text-center max-w-2xl mx-auto my-8">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger/10 text-danger">
        <svg
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-text-primary">Couldn&apos;t load drafts</h2>
        <p className="max-w-sm text-xs text-text-secondary leading-relaxed">{message}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-line bg-surface-2 px-4 py-2 text-xs font-semibold text-text-primary transition-colors hover:bg-surface-0 focus:outline-none focus:ring-2 focus:ring-accent"
      >
        Try again
      </button>
    </div>
  )
}

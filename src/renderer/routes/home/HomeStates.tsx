/**
 * Loading / empty / error states for Projects Home. Kept as small presentational
 * components so the route body stays a thin status switch.
 */

/** Skeleton grid shown while `storage:listProjects` resolves. */
export function LoadingState(): JSX.Element {
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
          <div className="flex flex-col gap-2 p-3">
            <div className="h-4 w-2/3 animate-pulse rounded-md bg-surface-2" />
            <div className="h-3 w-1/3 animate-pulse rounded-md bg-surface-2" />
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
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line bg-surface-1 p-12 text-center">
      <h2 className="text-lg font-medium text-text-primary">No projects yet</h2>
      <p className="max-w-sm text-sm text-text-secondary">
        Create your first project to start captioning. Projects are saved to your selected storage
        location.
      </p>
      <button
        type="button"
        onClick={onNewProject}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-accent-hover"
      >
        New Project
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
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-line bg-surface-1 p-12 text-center">
      <h2 className="text-lg font-medium text-text-primary">Couldn&apos;t load projects</h2>
      <p className="max-w-sm text-sm text-text-secondary">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-line bg-surface-2 px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-0"
      >
        Try again
      </button>
    </div>
  )
}

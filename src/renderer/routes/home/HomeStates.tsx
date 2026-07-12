/**
 * Loading / empty / error states for Projects Home.
 * Illustrated empty state, split offline/error, and staggered skeleton pulses.
 */

export interface LoadingStateProps {
  viewMode: 'grid' | 'list'
}

export function LoadingState({ viewMode }: LoadingStateProps): JSX.Element {
  if (viewMode === 'list') {
    return (
      <div className="w-full overflow-hidden rounded-xl border border-line bg-surface-1" aria-hidden>
        <div className="border-b border-line bg-surface-2/60 px-4 py-3 h-10 w-full" />
        <ul className="divide-y divide-line">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="flex items-center gap-4 px-4 py-3.5">
              {/* Mini thumbnail skeleton */}
              <div
                className="h-8 w-14 shrink-0 animate-pulse rounded bg-surface-2"
                style={{ animationDelay: `${i * 60}ms` }}
              />
              <div className="flex flex-1 items-center gap-3">
                <div
                  className="h-4 animate-pulse rounded bg-surface-2"
                  style={{ width: `${50 + ((i * 37) % 40)}%`, animationDelay: `${i * 60 + 30}ms` }}
                />
                <div className="h-3.5 w-14 animate-pulse rounded bg-surface-2" style={{ animationDelay: `${i * 60 + 60}ms` }} />
              </div>
              <div className="h-4 w-12 animate-pulse rounded bg-surface-2 hidden sm:block" />
              <div className="h-4 w-16 animate-pulse rounded bg-surface-2 hidden md:block" />
              <div className="h-4 w-24 animate-pulse rounded bg-surface-2 hidden lg:block" />
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
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}
      aria-hidden
    >
      {Array.from({ length: 8 }, (_, i) => (
        <li
          key={i}
          className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface-1"
        >
          <div
            className="aspect-video animate-pulse bg-surface-2"
            style={{ animationDelay: `${i * 50}ms` }}
          />
          <div className="flex flex-col gap-2.5 p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div
                className="h-4 animate-pulse rounded bg-surface-2"
                style={{ width: `${55 + ((i * 29) % 35)}%`, animationDelay: `${i * 50 + 25}ms` }}
              />
              <div className="h-3.5 w-12 animate-pulse rounded bg-surface-2" />
            </div>
            <div
              className="h-3 w-1/3 animate-pulse rounded bg-surface-2"
              style={{ animationDelay: `${i * 50 + 50}ms` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

export interface EmptyStateProps {
  onNewProject?: () => void
  location?: string
}

export function EmptyState({ onNewProject, location }: EmptyStateProps): JSX.Element {
  const isCloud = location === 'onedrive' || location === 'synology'
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-20 text-center">
      {/* Illustrated canvas art */}
      <div className="relative flex h-32 w-48 items-center justify-center">
        {/* Back card */}
        <div className="absolute left-4 top-4 h-24 w-36 rotate-[-6deg] rounded-xl border border-line bg-surface-2 shadow-lg" />
        {/* Mid card */}
        <div className="absolute left-6 top-2 h-24 w-36 rotate-[-2deg] rounded-xl border border-line bg-surface-2 shadow-lg" />
        {/* Front card with accent glow */}
        <div className="relative h-24 w-36 rounded-xl border border-accent/30 bg-gradient-to-br from-accent/10 via-surface-2 to-surface-1 shadow-xl shadow-accent/10 flex items-center justify-center">
          <svg className="h-10 w-10 text-accent/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>
        {/* + badge */}
        <div className="absolute -bottom-2 -right-2 flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white shadow-lg shadow-accent/40">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-base font-semibold text-text-primary">
          {isCloud ? 'No projects synced here yet' : 'No drafts yet'}
        </h2>
        <p className="max-w-xs text-xs text-text-secondary leading-relaxed">
          {isCloud
            ? 'Create a new project and save it to this cloud location, or switch to Local Drafts to see your offline projects.'
            : 'Create your first captioned video project. Your work auto-saves as you go.'}
        </p>
      </div>

      <div className="flex flex-col items-center gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onNewProject}
          className="flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-accent/20 transition-all hover:bg-accent-hover hover:shadow-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/50"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Project
        </button>
      </div>
    </div>
  )
}

export interface ErrorStateProps {
  message: string
  onRetry?: () => void
  /** True = cloud/network failure (amber). False = generic error (red). */
  isOffline?: boolean
}

export function ErrorState({ message, onRetry, isOffline }: ErrorStateProps): JSX.Element {
  const iconPath = isOffline
    ? 'M18.364 5.636a9 9 0 010 12.728m-3.536-3.536a4 4 0 010-5.656M9.172 15.828a4 4 0 010-5.656m-3.536 3.536a9 9 0 010-12.728'
    : 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'

  const iconBg = isOffline ? 'bg-warning/10 text-warning' : 'bg-danger/10 text-danger'
  const buttonTone = isOffline
    ? 'border-warning/30 text-warning hover:bg-warning/10'
    : 'border-danger/30 text-danger hover:bg-danger/10'

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 py-16 text-center">
      <div className={`flex h-14 w-14 items-center justify-center rounded-full ${iconBg}`}>
        <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
        </svg>
      </div>
      <div className="space-y-1.5">
        <h2 className="text-sm font-semibold text-text-primary">
          {isOffline ? 'Could not connect' : "Couldn't load drafts"}
        </h2>
        <p className="max-w-sm text-xs text-text-secondary leading-relaxed">{message}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className={`flex items-center gap-1.5 rounded-lg border bg-transparent px-4 py-2 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-accent/30 ${buttonTone}`}
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Try again
        </button>
      )}
    </div>
  )
}

/**
 * Projects Home header: app title + primary "New Project" action.
 * The New-Project dialog itself is wired in P2.3 — this exposes an
 * `onNewProject` seam the parent can fill later.
 */
export interface HomeHeaderProps {
  /** Invoked when the user clicks "New Project". Placeholder seam for P2.3. */
  onNewProject?: () => void
}

export default function HomeHeader({ onNewProject }: HomeHeaderProps): JSX.Element {
  return (
    <header className="flex items-center justify-between border-b border-line bg-surface-1 px-6 py-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">Projects</h1>
        <p className="text-sm text-text-secondary">Your Caption Studio projects</p>
      </div>
      <button
        type="button"
        onClick={onNewProject}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-accent-hover"
      >
        New Project
      </button>
    </header>
  )
}

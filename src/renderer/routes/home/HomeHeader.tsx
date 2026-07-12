import type { StorageLocation } from '../../../shared/storage'

export interface HomeHeaderProps {
  location: StorageLocation
  searchQuery: string
  onSearchChange: (q: string) => void
  onNewProject: () => void
}

const WORKSPACE_LABELS: Record<StorageLocation, string> = {
  local: 'Local Drafts',
  onedrive: 'OneDrive — YouTube Channel',
  synology: 'Synology NAS — YouTube Channel'
}

export default function HomeHeader({
  location,
  searchQuery,
  onSearchChange,
  onNewProject
}: HomeHeaderProps): JSX.Element {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-surface-1 px-5 z-20">
      {/* Left — App Logo + Workspace Breadcrumb */}
      <div className="flex items-center gap-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white font-extrabold text-xs shadow-lg shadow-accent/30 select-none">
          CS
        </div>
        <div className="flex items-center gap-1.5 text-xs text-text-secondary">
          <span className="font-semibold text-text-primary">Caption Studio</span>
          <svg className="h-3 w-3 shrink-0 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-text-muted truncate max-w-[200px]">{WORKSPACE_LABELS[location]}</span>
        </div>
      </div>

      {/* Center — Search */}
      <div className="relative w-72">
        <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-text-muted">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </span>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search projects..."
          aria-label="Search projects"
          className="w-full rounded-full border border-line bg-surface-2 py-1.5 pl-9 pr-8 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all"
        />
        {searchQuery.length > 0 && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute inset-y-0 right-3 flex items-center text-text-muted hover:text-text-primary transition-colors"
            aria-label="Clear search"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Right — Actions + Avatar */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onNewProject}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/20 focus:outline-none focus:ring-2 focus:ring-accent/50"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Project
        </button>

        {/* User Avatar */}
        <div className="flex h-7 w-7 cursor-default items-center justify-center rounded-full bg-gradient-to-br from-accent to-purple-500 text-[10px] font-bold text-white shadow-md select-none"
          title="Guest Creator"
        >
          GC
        </div>
      </div>
    </header>
  )
}

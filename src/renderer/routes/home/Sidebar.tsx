import type { StorageLocation } from '../../../shared/storage'

export interface SidebarProps {
  currentLocation: StorageLocation
  onLocationChange: (location: StorageLocation) => void
  onNewProject: () => void
}

export default function Sidebar({
  currentLocation,
  onLocationChange,
  onNewProject
}: SidebarProps): JSX.Element {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface-1 text-text-primary p-4">
      {/* Branding Header */}
      <div className="mb-6 flex items-center gap-2.5 px-1">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white font-bold shadow-md shadow-accent/20">
          CC
        </div>
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-text-primary">Caption Studio</h2>
          <span className="text-[10px] uppercase font-bold tracking-wider text-accent">Desktop v1.0</span>
        </div>
      </div>

      {/* Primary Action Button (CapCut style Start Creating) */}
      <button
        type="button"
        onClick={onNewProject}
        className="group mb-6 flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-accent/40 bg-surface-2 p-5 text-center transition-all hover:border-accent hover:bg-surface-0 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-accent"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent transition-transform group-hover:scale-110">
          <span className="text-xl font-bold">+</span>
        </div>
        <span className="text-xs font-semibold text-text-primary">Start creating</span>
      </button>

      {/* Navigation Menu */}
      <nav className="flex-1 space-y-1.5" aria-label="Main navigation">
        <button
          type="button"
          onClick={() => onLocationChange('local')}
          className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-medium transition-colors ${
            currentLocation === 'local'
              ? 'bg-surface-2 text-accent'
              : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary'
          }`}
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
            />
          </svg>
          <span>Local Drafts</span>
        </button>

        <button
          type="button"
          onClick={() => onLocationChange('onedrive')}
          className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs font-medium transition-colors ${
            currentLocation === 'onedrive'
              ? 'bg-surface-2 text-accent'
              : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary'
          }`}
        >
          <span className="flex items-center gap-3">
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
              />
            </svg>
            <span>Cloud Space</span>
          </span>
          <span className="rounded bg-accent/20 px-1 py-0.5 text-[9px] font-bold text-accent">
            OneDrive
          </span>
        </button>

        {/* Disabled Placeholder Navigation Items */}
        <div className="pt-4 pb-2">
          <span className="px-3 text-[10px] font-bold uppercase tracking-wider text-text-muted">
            Library
          </span>
        </div>

        <div className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-text-muted/60 cursor-not-allowed">
          <span className="flex items-center gap-3">
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <span>Templates</span>
          </span>
          <span className="rounded bg-line px-1 py-0.5 text-[8px] font-medium text-text-muted">
            Soon
          </span>
        </div>

        <div className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-text-muted/60 cursor-not-allowed">
          <span className="flex items-center gap-3">
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7 7h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <span>Brand Kit</span>
          </span>
          <span className="rounded bg-line px-1 py-0.5 text-[8px] font-medium text-text-muted">
            Soon
          </span>
        </div>
      </nav>

      {/* User Profile Info Area */}
      <div className="border-t border-line pt-4 mt-auto space-y-3">
        <div className="flex items-center gap-3 px-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 border border-line text-xs font-semibold text-text-primary">
            GC
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-xs font-semibold text-text-primary">Guest Creator</h3>
            <p className="truncate text-[10px] text-text-muted">
              {currentLocation === 'onedrive' ? 'Cloud Connected' : 'Local Mode'}
            </p>
          </div>
        </div>

        {/* Space Progress Meter */}
        <div className="px-1 space-y-1">
          <div className="flex items-center justify-between text-[9px] font-medium text-text-secondary">
            <span>Cloud Space</span>
            <span>0 MB / 512 MB</span>
          </div>
          <div className="h-1 w-full rounded-full bg-surface-2 overflow-hidden">
            <div className="h-full bg-accent" style={{ width: '0%' }} />
          </div>
        </div>

        {/* Bottom Utility Links */}
        <div className="flex items-center justify-between px-1 pt-2 text-[11px] text-text-secondary">
          <button type="button" className="hover:text-text-primary transition-colors flex items-center gap-1.5">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span>Settings</span>
          </button>
          <button type="button" className="hover:text-text-primary transition-colors flex items-center gap-1.5">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <span>Feedback</span>
          </button>
        </div>
      </div>
    </aside>
  )
}

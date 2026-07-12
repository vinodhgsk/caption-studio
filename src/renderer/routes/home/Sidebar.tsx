import type { StorageLocation } from '../../../shared/storage'

export interface SidebarProps {
  currentLocation: StorageLocation
  onLocationChange: (location: StorageLocation) => void
  onNewProject: () => void
}

interface NavItem {
  id: StorageLocation | 'templates' | 'brandkit'
  label: string
  disabled?: boolean
  soon?: boolean
  iconPath: string | string[]
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'local',
    label: 'Local Drafts',
    iconPath: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10'
  },
  {
    id: 'onedrive',
    label: 'OneDrive',
    iconPath: 'M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z'
  },
  {
    id: 'synology',
    label: 'Synology NAS',
    iconPath: 'M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01'
  }
]

const LIBRARY_ITEMS: NavItem[] = [
  {
    id: 'templates',
    label: 'Templates',
    disabled: true,
    soon: true,
    iconPath: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z'
  },
  {
    id: 'brandkit',
    label: 'Brand Kit',
    disabled: true,
    soon: true,
    iconPath: 'M7 7h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z'
  }
]

function NavButton({
  item,
  isActive,
  onClick
}: {
  item: NavItem
  isActive?: boolean
  onClick?: () => void
}): JSX.Element {
  const baseClass =
    'group relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200'
  const activeClass = 'bg-accent/15 text-accent shadow-lg shadow-accent/10'
  const inactiveClass = 'text-text-muted hover:bg-surface-2 hover:text-text-primary'
  const disabledClass = 'cursor-not-allowed text-text-muted/30'

  return (
    <div className="relative">
      <button
        type="button"
        onClick={item.disabled ? undefined : onClick}
        disabled={item.disabled}
        title={item.label}
        aria-label={item.label}
        aria-pressed={isActive}
        className={`${baseClass} ${item.disabled ? disabledClass : isActive ? activeClass : inactiveClass}`}
      >
        <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={isActive ? 2 : 1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d={item.iconPath as string} />
        </svg>

        {/* Active indicator bar */}
        {isActive && (
          <span className="absolute -left-2 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-accent" />
        )}
      </button>

      {/* Soon badge */}
      {item.soon && (
        <span className="absolute -right-1 -top-1 rounded-full bg-surface-2 border border-line px-1 text-[8px] font-bold text-text-muted leading-tight">
          Soon
        </span>
      )}
    </div>
  )
}

export default function Sidebar({
  currentLocation,
  onLocationChange,
  onNewProject
}: SidebarProps): JSX.Element {
  return (
    <aside
      className="flex w-14 shrink-0 flex-col items-center border-r border-line bg-surface-1 py-3 gap-1"
      aria-label="Navigation rail"
    >
      {/* App logo */}
      <div
        className="mb-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent font-extrabold text-xs text-white shadow-lg shadow-accent/30 select-none cursor-default"
        title="Caption Studio"
      >
        CS
      </div>

      {/* New project CTA */}
      <button
        type="button"
        onClick={onNewProject}
        title="New Project"
        aria-label="New Project"
        className="group mb-2 flex h-10 w-10 items-center justify-center rounded-xl border border-dashed border-accent/40 bg-surface-2 text-accent transition-all hover:border-accent hover:bg-accent hover:text-white hover:shadow-lg hover:shadow-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/50"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </button>

      {/* Divider */}
      <div className="my-1 h-px w-8 bg-line" />

      {/* Primary nav — location switchers */}
      <nav className="flex flex-col items-center gap-1" aria-label="Storage locations">
        {NAV_ITEMS.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            isActive={currentLocation === item.id}
            onClick={() => onLocationChange(item.id as StorageLocation)}
          />
        ))}
      </nav>

      {/* Divider */}
      <div className="my-1 h-px w-8 bg-line" />

      {/* Library items (disabled) */}
      <nav className="flex flex-col items-center gap-1" aria-label="Library">
        {LIBRARY_ITEMS.map((item) => (
          <NavButton key={item.id} item={item} isActive={false} />
        ))}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Settings */}
      <button
        type="button"
        title="Settings"
        aria-label="Settings"
        className="flex h-10 w-10 items-center justify-center rounded-xl text-text-muted transition-all hover:bg-surface-2 hover:text-text-primary"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      {/* User avatar */}
      <div
        title="Guest Creator"
        className="mt-1 flex h-8 w-8 cursor-default items-center justify-center rounded-full bg-gradient-to-br from-accent to-purple-500 text-[10px] font-bold text-white shadow select-none"
      >
        GC
      </div>
    </aside>
  )
}

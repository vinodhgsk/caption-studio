import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ProjectMeta, ProjectRef, StorageLocation } from '../../shared/storage'
import { useProjectStore } from '@/store/projectStore'
import Sidebar from './home/Sidebar'
import HomeHeader from './home/HomeHeader'
import ProjectGrid from './home/ProjectGrid'
import { EmptyState, ErrorState, LoadingState } from './home/HomeStates'
import NewProjectDialog from './home/NewProjectDialog'
import RenameProjectDialog from './home/RenameProjectDialog'
import DeleteProjectDialog from './home/DeleteProjectDialog'
import QuickCreateBanner from './home/QuickCreateBanner'
import { OnboardingModal } from './onboarding/OnboardingModal'
import type { Aspect } from './home/aspect'

/** A `ProjectMeta` carries every `ProjectRef` field — narrow to the ref shape. */
function toRef(project: ProjectMeta): ProjectRef {
  return {
    id: project.id,
    name: project.name,
    location: project.location,
    path: project.path
  }
}

function markOnboardingDone(): void {
  localStorage.setItem('onboardingComplete', '1')
}

const FILTER_TABS = [
  { id: 'recent', label: 'Recent' },
  { id: 'all', label: 'All' }
] as const
type FilterTab = (typeof FILTER_TABS)[number]['id']

const LOCATION_HEADING: Record<StorageLocation, string> = {
  local: 'Local Drafts',
  onedrive: 'Cloud Drafts',
  synology: 'Synology Drafts'
}

export default function Home(): JSX.Element {
  const projects = useProjectStore((s) => s.projects)
  const listStatus = useProjectStore((s) => s.listStatus)
  const listError = useProjectStore((s) => s.listError)
  const loadProjects = useProjectStore((s) => s.loadProjects)
  const duplicateProject = useProjectStore((s) => s.duplicateProject)
  const revealProject = useProjectStore((s) => s.revealProject)
  const navigate = useNavigate()

  const [location, setLocation] = useState<StorageLocation>('local')
  const [oneDriveOffline, setOneDriveOffline] = useState(false)
  const [onboardingComplete, setOnboardingComplete] = useState(
    () => localStorage.getItem('onboardingComplete') === '1'
  )
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'duration'>('date')
  const [activeTab, setActiveTab] = useState<FilterTab>('recent')

  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedDefaultAspect, setSelectedDefaultAspect] = useState<Aspect>('16:9')
  const [renameTarget, setRenameTarget] = useState<ProjectMeta | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProjectMeta | null>(null)

  useEffect(() => {
    void loadProjects(location).catch((err: unknown) => {
      if (location === 'onedrive') {
        console.warn('[Caption Studio] OneDrive listProjects failed', err)
        setOneDriveOffline(true)
      }
    })
  }, [loadProjects, location])

  const handleNewProject = (): void => {
    setSelectedDefaultAspect('16:9')
    setDialogOpen(true)
  }

  const handleQuickCreate = (aspect: Aspect): void => {
    setSelectedDefaultAspect(aspect)
    setDialogOpen(true)
  }

  const handleOpen = (project: ProjectMeta): void => {
    const ref = toRef(project)
    navigate(`/editor?id=${encodeURIComponent(ref.id)}&location=${ref.location}`)
  }

  const handleDuplicate = (project: ProjectMeta): void => {
    void duplicateProject(toRef(project))
  }

  const handleReveal = (project: ProjectMeta): void => {
    void revealProject(toRef(project))
  }

  const handleLocationChange = (newLoc: StorageLocation): void => {
    setLocation(newLoc)
    setOneDriveOffline(false)
  }

  /** Filter, search, and sort */
  const processedProjects = useMemo(() => {
    let list = projects

    // Search filter
    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase()
      list = list.filter((p) => p.name.toLowerCase().includes(q))
    }

    // Tab filter: 'recent' shows latest 20; 'all' shows everything
    if (activeTab === 'recent') {
      list = [...list]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 20)
    }

    // Sort
    return [...list].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      if (sortBy === 'duration') return (b.durationSec ?? 0) - (a.durationSec ?? 0)
      return b.updatedAt.localeCompare(a.updatedAt)
    })
  }, [projects, searchQuery, sortBy, activeTab])

  const isError = listStatus === 'error'
  const isLoading = listStatus === 'loading' || listStatus === 'idle'
  const isEmpty = !isError && !isLoading && processedProjects.length === 0

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-surface-0">
      {/* ── Zone 1: Icon-rail sidebar ── */}
      <Sidebar
        currentLocation={location}
        onLocationChange={handleLocationChange}
        onNewProject={handleNewProject}
      />

      {/* ── Zone 2 + 3: Top bar + Workspace ── */}
      <div className="flex flex-1 min-w-0 flex-col overflow-hidden">
        {/* ── Zone 2: Top navigation bar ── */}
        <HomeHeader
          location={location}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onNewProject={handleNewProject}
        />

        {/* ── Zone 3: Main scrollable workspace ── */}
        <div className="flex flex-1 flex-col overflow-y-auto">
          {/* Offline / network banner */}
          {oneDriveOffline && (
            <div
              role="alert"
              className="flex items-center gap-3 border-b border-warning/20 bg-warning/10 px-5 py-2 text-xs font-medium text-warning"
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728M9.172 15.828a4 4 0 010-5.656M9.172 9.172a4 4 0 015.656 0M5.636 18.364a9 9 0 010-12.728" />
              </svg>
              <span className="flex-1">OneDrive offline — showing cached projects. Check your network connection.</span>
              <button
                type="button"
                className="rounded-md border border-warning/30 px-2.5 py-1 text-[10px] font-semibold text-warning transition-colors hover:bg-warning/20"
                onClick={() => {
                  setOneDriveOffline(false)
                  void loadProjects(location).catch((err: unknown) => {
                    console.warn('[Caption Studio] OneDrive retry failed.', err)
                    setOneDriveOffline(true)
                  })
                }}
              >
                Retry
              </button>
            </div>
          )}

          <div className="flex flex-col gap-8 px-8 py-6">
            {/* ── Quick Create Banner ── */}
            <QuickCreateBanner onQuickCreate={handleQuickCreate} />

            {/* ── Projects workspace ── */}
            <section className="flex flex-col gap-4">
              {/* Section header: title + tabs + toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
                {/* Left: heading + filter tabs */}
                <div className="flex items-center gap-4">
                  <h2 className="text-sm font-semibold text-text-primary">
                    {LOCATION_HEADING[location]}
                  </h2>
                  <div className="flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5">
                    {FILTER_TABS.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={`rounded-md px-3 py-1 text-[11px] font-semibold transition-all ${
                          activeTab === tab.id
                            ? 'bg-surface-1 text-text-primary shadow-sm'
                            : 'text-text-muted hover:text-text-secondary'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  {/* Project count */}
                  {!isLoading && !isError && (
                    <span className="text-[10px] text-text-muted">
                      {processedProjects.length} {processedProjects.length === 1 ? 'project' : 'projects'}
                    </span>
                  )}
                </div>

                {/* Right: sort + layout toggle */}
                <div className="flex items-center gap-2">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                    aria-label="Sort by"
                    className="rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-[11px] text-text-secondary outline-none focus:border-accent transition-colors hover:border-line/60"
                  >
                    <option value="date">Date Modified</option>
                    <option value="name">Name (A–Z)</option>
                    <option value="duration">Duration</option>
                  </select>

                  {/* View toggle */}
                  <div className="flex items-center rounded-lg border border-line bg-surface-2 p-0.5">
                    <button
                      type="button"
                      onClick={() => setViewMode('grid')}
                      className={`rounded-md p-1.5 transition-colors ${
                        viewMode === 'grid'
                          ? 'bg-surface-1 text-accent shadow-sm'
                          : 'text-text-muted hover:text-text-secondary'
                      }`}
                      aria-label="Grid view"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('list')}
                      className={`rounded-md p-1.5 transition-colors ${
                        viewMode === 'list'
                          ? 'bg-surface-1 text-accent shadow-sm'
                          : 'text-text-muted hover:text-text-secondary'
                      }`}
                      aria-label="List view"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              {/* Content */}
              {isError ? (
                <ErrorState
                  message={listError ?? 'Something went wrong.'}
                  onRetry={() => void loadProjects(location)}
                  isOffline={location !== 'local'}
                />
              ) : isLoading ? (
                <LoadingState viewMode={viewMode} />
              ) : isEmpty ? (
                <EmptyState onNewProject={handleNewProject} location={location} />
              ) : (
                <ProjectGrid
                  projects={processedProjects}
                  viewMode={viewMode}
                  onOpenProject={handleOpen}
                  onDuplicateProject={handleDuplicate}
                  onRenameProject={setRenameTarget}
                  onDeleteProject={setDeleteTarget}
                  onRevealProject={handleReveal}
                />
              )}
            </section>
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <NewProjectDialog
        open={dialogOpen}
        defaultAspect={selectedDefaultAspect}
        onClose={() => setDialogOpen(false)}
      />
      <RenameProjectDialog
        open={renameTarget !== null}
        project={renameTarget}
        onClose={() => setRenameTarget(null)}
      />
      <DeleteProjectDialog
        open={deleteTarget !== null}
        project={deleteTarget}
        onClose={() => setDeleteTarget(null)}
      />

      {!onboardingComplete && (
        <OnboardingModal
          onComplete={() => {
            markOnboardingDone()
            setOnboardingComplete(true)
          }}
        />
      )}
    </main>
  )
}

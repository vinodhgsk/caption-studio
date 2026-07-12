import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ProjectMeta, ProjectRef, StorageLocation } from '../../shared/storage'
import { useProjectStore } from '@/store/projectStore'
import Sidebar from './home/Sidebar'
import ProjectGrid from './home/ProjectGrid'
import { EmptyState, ErrorState, LoadingState } from './home/HomeStates'
import NewProjectDialog from './home/NewProjectDialog'
import RenameProjectDialog from './home/RenameProjectDialog'
import DeleteProjectDialog from './home/DeleteProjectDialog'
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

/** Mark onboarding complete in localStorage and hide the modal. */
function markOnboardingDone(): void {
  localStorage.setItem('onboardingComplete', '1')
}

export default function Home(): JSX.Element {
  const projects = useProjectStore((s) => s.projects)
  const listStatus = useProjectStore((s) => s.listStatus)
  const listError = useProjectStore((s) => s.listError)
  const loadProjects = useProjectStore((s) => s.loadProjects)
  const duplicateProject = useProjectStore((s) => s.duplicateProject)
  const revealProject = useProjectStore((s) => s.revealProject)
  const navigate = useNavigate()

  /** Storage location (Local or OneDrive) */
  const [location, setLocation] = useState<StorageLocation>('local')
  /** True when a OneDrive `listProjects` call fails with a network error. */
  const [oneDriveOffline, setOneDriveOffline] = useState(false)
  /** Whether onboarding has been completed (persisted in localStorage). */
  const [onboardingComplete, setOnboardingComplete] = useState(
    () => localStorage.getItem('onboardingComplete') === '1'
  )

  // Layout View Mode (Grid vs List)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  // Real-time Search Query
  const [searchQuery, setSearchQuery] = useState('')
  // Sorting Mode
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'duration'>('date')

  useEffect(() => {
    void loadProjects(location).catch((err: unknown) => {
      if (location === 'onedrive') {
        console.warn('[Caption Studio] OneDrive listProjects failed — showing offline banner.', err)
        setOneDriveOffline(true)
      }
    })
  }, [loadProjects, location])

  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedDefaultAspect, setSelectedDefaultAspect] = useState<Aspect>('16:9')
  const [renameTarget, setRenameTarget] = useState<ProjectMeta | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProjectMeta | null>(null)

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

  // Filter & Sort Projects list in real-time
  const processedProjects = useMemo(() => {
    // 1. Filter by Search Query
    let filtered = projects
    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase()
      filtered = projects.filter((p) => p.name.toLowerCase().includes(q))
    }

    // 2. Sort by selected Sort Rule
    return [...filtered].sort((a, b) => {
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name)
      }
      if (sortBy === 'duration') {
        return (b.durationSec ?? 0) - (a.durationSec ?? 0)
      }
      // Default: sort by last modified date (date) descending
      return b.updatedAt.localeCompare(a.updatedAt)
    })
  }, [projects, searchQuery, sortBy])

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-surface-0">
      {/* Left Sidebar Panel */}
      <Sidebar
        currentLocation={location}
        onLocationChange={handleLocationChange}
        onNewProject={handleNewProject}
      />

      {/* Main Workspace Panel */}
      <div className="flex flex-1 flex-col overflow-y-auto">
        {/* OneDrive offline banner (P13.6) */}
        {oneDriveOffline && (
          <div
            role="alert"
            className="flex items-center gap-2 bg-amber-500/90 px-4 py-2 text-xs font-semibold text-white"
          >
            <span>OneDrive offline — showing cached projects. Check your network connection.</span>
            <button
              type="button"
              className="ml-auto rounded bg-white/20 px-2 py-0.5 text-[10px] underline hover:no-underline"
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

        {/* Dashboard Area */}
        <div className="flex flex-col gap-6 p-6">
          {/* Quick Presets Section (CapCut feature) */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-text-primary">Start Creating</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl">
              {/* Landscape Button */}
              <button
                type="button"
                onClick={() => handleQuickCreate('16:9')}
                className="group flex flex-col items-center gap-3 rounded-lg border border-line bg-surface-1 p-5 transition-all duration-300 hover:border-accent hover:bg-surface-2 hover:shadow-lg focus:outline-none"
              >
                <div className="flex h-12 w-20 items-center justify-center rounded border border-text-secondary/20 bg-surface-2 group-hover:border-accent/30 group-hover:bg-accent/5 transition-colors">
                  <svg className="h-6 w-6 text-text-secondary group-hover:text-accent transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-xs font-semibold text-text-primary">16:9 Landscape</p>
                  <span className="text-[10px] text-text-muted">YouTube, Presentation</span>
                </div>
              </button>

              {/* Portrait Button */}
              <button
                type="button"
                onClick={() => handleQuickCreate('9:16')}
                className="group flex flex-col items-center gap-3 rounded-lg border border-line bg-surface-1 p-5 transition-all duration-300 hover:border-accent hover:bg-surface-2 hover:shadow-lg focus:outline-none"
              >
                <div className="flex h-12 w-8 items-center justify-center rounded border border-text-secondary/20 bg-surface-2 group-hover:border-accent/30 group-hover:bg-accent/5 transition-colors">
                  <svg className="h-6 w-6 text-text-secondary group-hover:text-accent transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-xs font-semibold text-text-primary">9:16 Portrait</p>
                  <span className="text-[10px] text-text-muted">TikTok, Shorts, Reels</span>
                </div>
              </button>

              {/* Square Button */}
              <button
                type="button"
                onClick={() => handleQuickCreate('1:1')}
                className="group flex flex-col items-center gap-3 rounded-lg border border-line bg-surface-1 p-5 transition-all duration-300 hover:border-accent hover:bg-surface-2 hover:shadow-lg focus:outline-none"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded border border-text-secondary/20 bg-surface-2 group-hover:border-accent/30 group-hover:bg-accent/5 transition-colors">
                  <svg className="h-6 w-6 text-text-secondary group-hover:text-accent transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5z" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-xs font-semibold text-text-primary">1:1 Square</p>
                  <span className="text-[10px] text-text-muted">Instagram Feed</span>
                </div>
              </button>
            </div>
          </section>

          {/* Recent Drafts Title & Workspace Header Toolbar */}
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-2.5">
              <h2 className="text-sm font-semibold text-text-primary">
                {location === 'onedrive' ? 'Cloud Drafts' : 'Local Drafts'}
              </h2>

              {/* Toolbar Controls */}
              <div className="flex items-center gap-3">
                {/* Search Bar */}
                <div className="relative">
                  <span className="absolute inset-y-0 left-2.5 flex items-center text-text-muted">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search drafts..."
                    className="w-48 rounded bg-surface-1 border border-line pl-8 pr-7 py-1 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent transition-colors"
                  />
                  {searchQuery.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute inset-y-0 right-2 flex items-center text-text-muted hover:text-text-primary"
                    >
                      ×
                    </button>
                  )}
                </div>

                {/* Sort Selector */}
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as 'date' | 'name' | 'duration')}
                  className="rounded bg-surface-1 border border-line px-2 py-1 text-xs text-text-primary outline-none focus:border-accent transition-colors"
                >
                  <option value="date">Date Modified</option>
                  <option value="name">Name</option>
                  <option value="duration">Duration</option>
                </select>

                {/* Layout View Toggler */}
                <div className="flex items-center rounded border border-line bg-surface-1 p-0.5">
                  <button
                    type="button"
                    onClick={() => setViewMode('grid')}
                    className={`rounded p-1 transition-colors ${
                      viewMode === 'grid' ? 'bg-surface-2 text-accent' : 'text-text-muted hover:text-text-secondary'
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
                    className={`rounded p-1 transition-colors ${
                      viewMode === 'list' ? 'bg-surface-2 text-accent' : 'text-text-muted hover:text-text-secondary'
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

            {/* List status switch */}
            {listStatus === 'error' ? (
              <ErrorState
                message={listError ?? 'Something went wrong.'}
                onRetry={() => void loadProjects(location)}
              />
            ) : listStatus === 'loading' || listStatus === 'idle' ? (
              <LoadingState viewMode={viewMode} />
            ) : processedProjects.length === 0 ? (
              <EmptyState onNewProject={handleNewProject} />
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

      {/* Project Operations Dialogs */}
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

      {/* Onboarding Dialog */}
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

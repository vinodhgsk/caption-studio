import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ProjectMeta, ProjectRef, StorageLocation } from '../../shared/storage'
import { useProjectStore } from '@/store/projectStore'
import HomeHeader from './home/HomeHeader'
import ProjectGrid from './home/ProjectGrid'
import { EmptyState, ErrorState, LoadingState } from './home/HomeStates'
import NewProjectDialog from './home/NewProjectDialog'
import RenameProjectDialog from './home/RenameProjectDialog'
import DeleteProjectDialog from './home/DeleteProjectDialog'
import { OnboardingModal } from './onboarding/OnboardingModal'

/** Storage location backing the listing. OneDrive switching lands later. */
const LOCATION: StorageLocation = 'local'

/** A `ProjectMeta` carries every `ProjectRef` field — narrow to the ref shape. */
function toRef(project: ProjectMeta): ProjectRef {
  return {
    id: project.id,
    name: project.name,
    location: project.location,
    path: project.path
  }
}

/**
 * Mark onboarding complete in localStorage and hide the modal.
 * Called by OnboardingModal.onComplete.
 */
function markOnboardingDone(): void {
  localStorage.setItem('onboardingComplete', '1')
}

/**
 * Projects Home (P2.1–P2.4): header, responsive card grid, and loading / empty
 * / error states, plus the New-Project dialog (P2.3) and per-card actions
 * (P2.4): Open, Duplicate, Rename, Delete (confirm), Reveal in folder.
 */
export default function Home(): JSX.Element {
  const projects = useProjectStore((s) => s.projects)
  const listStatus = useProjectStore((s) => s.listStatus)
  const listError = useProjectStore((s) => s.listError)
  const loadProjects = useProjectStore((s) => s.loadProjects)
  const duplicateProject = useProjectStore((s) => s.duplicateProject)
  const revealProject = useProjectStore((s) => s.revealProject)
  const navigate = useNavigate()

  /** True when a OneDrive `listProjects` call fails with a network error. */
  const [oneDriveOffline, setOneDriveOffline] = useState(false)
  /** Whether onboarding has been completed (persisted in localStorage). */
  const [onboardingComplete, setOnboardingComplete] = useState(
    () => localStorage.getItem('onboardingComplete') === '1'
  )

  useEffect(() => {
    void loadProjects(LOCATION).catch((err: unknown) => {
      if (LOCATION === 'onedrive') {
        console.warn('[Caption Studio] OneDrive listProjects failed — showing offline banner.', err)
        setOneDriveOffline(true)
      }
    })
  }, [loadProjects])

  const [dialogOpen, setDialogOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<ProjectMeta | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProjectMeta | null>(null)

  const handleNewProject = (): void => setDialogOpen(true)
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

  return (
    <main className="flex min-h-screen flex-col">
      <HomeHeader onNewProject={handleNewProject} />

      {/* OneDrive offline banner (P13.6): shown when a network error is caught. */}
      {oneDriveOffline && (
        <div
          role="alert"
          className="flex items-center gap-2 bg-amber-500/90 px-4 py-2 text-sm font-medium text-white"
        >
          <span>OneDrive offline — showing cached projects. Check your network connection.</span>
          <button
            type="button"
            className="ml-auto rounded px-2 py-0.5 text-xs underline hover:no-underline"
            onClick={() => {
              setOneDriveOffline(false)
              void loadProjects(LOCATION).catch((err: unknown) => {
                console.warn('[Caption Studio] OneDrive retry failed.', err)
                setOneDriveOffline(true)
              })
            }}
          >
            Retry
          </button>
        </div>
      )}

      <section className="flex flex-1 flex-col p-6">
        {listStatus === 'error' ? (
          <ErrorState
            message={listError ?? 'Something went wrong.'}
            onRetry={() => void loadProjects(LOCATION)}
          />
        ) : listStatus === 'loading' || listStatus === 'idle' ? (
          <LoadingState />
        ) : projects.length === 0 ? (
          <EmptyState onNewProject={handleNewProject} />
        ) : (
          <ProjectGrid
            projects={projects}
            onOpenProject={handleOpen}
            onDuplicateProject={handleDuplicate}
            onRenameProject={setRenameTarget}
            onDeleteProject={setDeleteTarget}
            onRevealProject={handleReveal}
          />
        )}
      </section>
      <NewProjectDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
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

      {/* First-run onboarding modal (P13.9). */}
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

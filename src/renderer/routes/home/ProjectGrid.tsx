import type { ProjectMeta } from '../../../shared/storage'
import ProjectCard from './ProjectCard'

/**
 * Responsive grid container for project cards. Uses CSS `auto-fill` so columns
 * reflow to fit the viewport. Each project renders a {@link ProjectCard} (P2.2);
 * this only establishes the layout shell and the per-card seam.
 */
export interface ProjectGridProps {
  projects: ProjectMeta[]
  /** Selecting a card opens the project. */
  onOpenProject?: (project: ProjectMeta) => void
  /** Per-card actions (P2.4). */
  onDuplicateProject?: (project: ProjectMeta) => void
  onRenameProject?: (project: ProjectMeta) => void
  onDeleteProject?: (project: ProjectMeta) => void
  onRevealProject?: (project: ProjectMeta) => void
}

export default function ProjectGrid({
  projects,
  onOpenProject,
  onDuplicateProject,
  onRenameProject,
  onDeleteProject,
  onRevealProject
}: ProjectGridProps): JSX.Element {
  return (
    <ul
      className="grid gap-4"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))' }}
    >
      {projects.map((project) => (
        <li key={project.id}>
          <ProjectCard
            project={project}
            onOpen={onOpenProject}
            onDuplicate={onDuplicateProject}
            onRename={onRenameProject}
            onDelete={onDeleteProject}
            onReveal={onRevealProject}
          />
        </li>
      ))}
    </ul>
  )
}

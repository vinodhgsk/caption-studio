import type { ProjectMeta } from '../../../shared/storage'
import ProjectCard from './ProjectCard'
import ProjectCardMenu from './ProjectCardMenu'
import { formatDuration, formatLastModified } from './format'

/**
 * Responsive grid or list container for project cards. Uses CSS `auto-fill`
 * for columns in grid mode, and a table layout in list mode.
 */
export interface ProjectGridProps {
  projects: ProjectMeta[]
  viewMode: 'grid' | 'list'
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
  viewMode,
  onOpenProject,
  onDuplicateProject,
  onRenameProject,
  onDeleteProject,
  onRevealProject
}: ProjectGridProps): JSX.Element {
  if (viewMode === 'list') {
    return (
      <div className="w-full overflow-x-auto rounded-lg border border-line bg-surface-1">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-line bg-surface-2/50 text-text-secondary font-semibold">
              <th className="px-4 py-3.5">Name</th>
              <th className="px-4 py-3.5">Ratio</th>
              <th className="px-4 py-3.5">Duration</th>
              <th className="px-4 py-3.5">Date Modified</th>
              <th className="px-4 py-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {projects.map((project) => {
              const lastModified = formatLastModified(project.updatedAt)
              const duration = formatDuration(project.durationSec)
              const menuItems = [
                { key: 'open', label: 'Open', onSelect: () => onOpenProject?.(project) },
                { key: 'duplicate', label: 'Duplicate', onSelect: () => onDuplicateProject?.(project) },
                { key: 'rename', label: 'Rename', onSelect: () => onRenameProject?.(project) },
                { key: 'reveal', label: 'Reveal in folder', onSelect: () => onRevealProject?.(project) },
                { key: 'delete', label: 'Delete', danger: true, onSelect: () => onDeleteProject?.(project) }
              ]

              return (
                <tr
                  key={project.id}
                  onClick={() => onOpenProject?.(project)}
                  className="group cursor-pointer hover:bg-surface-2 transition-colors"
                >
                  <td className="px-4 py-3 font-semibold text-text-primary">
                    <div className="flex items-center gap-2">
                      <span className="truncate max-w-[15rem]" title={project.name}>
                        {project.name}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                          project.location === 'onedrive'
                            ? 'bg-accent/15 text-accent border border-accent/25'
                            : 'bg-surface-2 text-text-secondary border border-line'
                        }`}
                      >
                        {project.location === 'onedrive' ? 'Cloud' : 'Local'}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{project.aspect ?? '16:9'}</td>
                  <td className="px-4 py-3 text-text-secondary">{duration || '--'}</td>
                  <td className="px-4 py-3 text-text-secondary">{lastModified}</td>
                  <td className="px-4 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-block">
                      <ProjectCardMenu label={`Actions for ${project.name}`} items={menuItems} />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

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

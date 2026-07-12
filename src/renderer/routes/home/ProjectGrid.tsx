import type { ProjectMeta } from '../../../shared/storage'
import ProjectCard from './ProjectCard'
import ProjectCardMenu from './ProjectCardMenu'
import { formatDuration, formatLastModified } from './format'

export interface ProjectGridProps {
  projects: ProjectMeta[]
  viewMode: 'grid' | 'list'
  onOpenProject?: (project: ProjectMeta) => void
  onDuplicateProject?: (project: ProjectMeta) => void
  onRenameProject?: (project: ProjectMeta) => void
  onDeleteProject?: (project: ProjectMeta) => void
  onRevealProject?: (project: ProjectMeta) => void
}

/** Tiny aspect-shape thumbnail for list view */
function MiniThumbnail({ aspect }: { aspect?: string }): JSX.Element {
  const gradientClass =
    aspect === '9:16'
      ? 'from-purple-900/80 to-purple-700/40'
      : aspect === '1:1'
      ? 'from-emerald-900/80 to-teal-700/40'
      : 'from-blue-900/80 to-indigo-700/40'

  const shapeClass =
    aspect === '9:16'
      ? 'w-6 h-10'
      : aspect === '1:1'
      ? 'w-8 h-8'
      : 'w-14 h-8'

  return (
    <div
      className={`${shapeClass} shrink-0 rounded bg-gradient-to-br ${gradientClass} flex items-center justify-center border border-white/10`}
    >
      <span className="text-[7px] font-bold text-white/40 leading-none">{aspect ?? '16:9'}</span>
    </div>
  )
}

function locationBadge(location: ProjectMeta['location']): { text: string; tone: string } {
  if (location === 'onedrive') return { text: 'OneDrive', tone: 'bg-accent/15 text-accent border-accent/25' }
  if (location === 'synology') return { text: 'Synology', tone: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' }
  return { text: 'Local', tone: 'bg-surface-2 text-text-secondary border-line' }
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
      <div className="w-full overflow-x-auto rounded-xl border border-line bg-surface-1">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-line bg-surface-2/60 text-text-secondary font-semibold">
              <th className="px-4 py-3 w-8" />
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3 hidden sm:table-cell">Ratio</th>
              <th className="px-4 py-3 hidden md:table-cell">Duration</th>
              <th className="px-4 py-3 hidden lg:table-cell">Modified</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {projects.map((project) => {
              const lastModified = formatLastModified(project.updatedAt)
              const duration = formatDuration(project.durationSec)
              const loc = locationBadge(project.location)
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
                  className="group cursor-pointer hover:bg-surface-2/60 transition-colors"
                >
                  {/* Thumbnail */}
                  <td className="pl-4 py-3 pr-0">
                    <MiniThumbnail aspect={project.aspect} />
                  </td>

                  {/* Name + location badge */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="truncate max-w-[14rem] font-semibold text-text-primary group-hover:text-white transition-colors" title={project.name}>
                        {project.name}
                      </span>
                      <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold ${loc.tone}`}>
                        {loc.text}
                      </span>
                    </div>
                  </td>

                  <td className="px-4 py-3 text-text-secondary hidden sm:table-cell">
                    {project.aspect ?? '16:9'}
                  </td>
                  <td className="px-4 py-3 text-text-secondary hidden md:table-cell">
                    {duration || '—'}
                  </td>
                  <td className="px-4 py-3 text-text-secondary hidden lg:table-cell">
                    {lastModified}
                  </td>
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
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}
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

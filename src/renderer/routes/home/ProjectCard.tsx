import type { ProjectMeta } from '../../../shared/storage'
import { formatDuration, formatLastModified } from './format'
import ProjectCardMenu from './ProjectCardMenu'

export interface ProjectCardProps {
  project: ProjectMeta
  /** Selecting the card opens the project. */
  onOpen?: (project: ProjectMeta) => void
  /** Per-card menu actions (P2.4). Omitted in presentational contexts. */
  onDuplicate?: (project: ProjectMeta) => void
  onRename?: (project: ProjectMeta) => void
  onDelete?: (project: ProjectMeta) => void
  onReveal?: (project: ProjectMeta) => void
}

/**
 * Map a project aspect string to a Tailwind aspect-ratio class. Falls back to
 * 16:9 for missing/unknown values so the thumbnail region always has a shape.
 */
function aspectClass(aspect: string | undefined): string {
  switch (aspect) {
    case '9:16':
      return 'aspect-[9/16]'
    case '1:1':
      return 'aspect-square'
    case '16:9':
    default:
      return 'aspect-video'
  }
}

export default function ProjectCard({
  project,
  onOpen,
  onDuplicate,
  onRename,
  onDelete,
  onReveal
}: ProjectCardProps): JSX.Element {
  const lastModified = formatLastModified(project.updatedAt)
  const duration = formatDuration(project.durationSec)

  const menuItems = [
    { key: 'open', label: 'Open', onSelect: () => onOpen?.(project) },
    { key: 'duplicate', label: 'Duplicate', onSelect: () => onDuplicate?.(project) },
    { key: 'rename', label: 'Rename', onSelect: () => onRename?.(project) },
    { key: 'reveal', label: 'Reveal in folder', onSelect: () => onReveal?.(project) },
    { key: 'delete', label: 'Delete', danger: true, onSelect: () => onDelete?.(project) }
  ]

  return (
    <div className="group relative flex w-full flex-col overflow-hidden rounded-lg border border-line bg-surface-1 transition-all duration-300 hover:scale-[1.02] hover:border-accent hover:bg-surface-2 hover:shadow-xl focus-within:border-accent">
      {/* Actions menu overlay */}
      <div className="absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <ProjectCardMenu label={`Actions for ${project.name}`} items={menuItems} />
      </div>

      <button
        type="button"
        onClick={() => onOpen?.(project)}
        title={project.name}
        className="flex w-full flex-col text-left focus-visible:outline-none"
      >
        {/* Thumbnail area with Aspect overlay & play button hover effect */}
        <div className={`relative flex w-full items-center justify-center bg-surface-2 text-xs overflow-hidden ${aspectClass(project.aspect)}`}>
          {/* Default Dark Slate Background */}
          <div className="absolute inset-0 bg-gradient-to-t from-surface-0/60 to-transparent z-0" />
          
          {/* Subtle aspect visual */}
          <span className="text-[10px] uppercase font-bold tracking-wider text-text-muted/50 z-0">
            {project.aspect ?? '16:9'} Slate
          </span>

          {/* Absolute Overlays */}
          <div className="absolute left-2 top-2 z-10 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-text-primary backdrop-blur-sm border border-white/5">
            {project.aspect ?? '16:9'}
          </div>

          {duration ? (
            <div className="absolute right-2 bottom-2 z-10 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-text-primary backdrop-blur-sm border border-white/5">
              {duration}
            </div>
          ) : null}

          {/* Hover Play Button Overlay */}
          <div className="absolute inset-0 z-0 flex items-center justify-center bg-black/30 opacity-0 transition-all duration-300 group-hover:opacity-100 backdrop-blur-[1px]">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white shadow-lg shadow-accent/40 transform translate-y-2 transition-transform duration-300 group-hover:translate-y-0">
              <svg className="h-4 w-4 fill-current ml-0.5" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Content Metadata Area */}
        <div className="flex flex-col gap-1.5 p-3.5 z-10">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-semibold text-text-primary group-hover:text-accent transition-colors">
              {project.name}
            </span>
            <StorageBadge location={project.location} />
          </div>
          <div className="flex items-center gap-2 text-[10px] text-text-secondary/70">
            {lastModified ? <span>{lastModified}</span> : null}
          </div>
        </div>
      </button>
    </div>
  )
}

/**
 * Storage location chip. OneDrive uses an accent-tinted token treatment to read
 * as "synced/remote"; Local stays neutral. Tokens only — no hardcoded colors.
 */
function StorageBadge({ location }: { location: ProjectMeta['location'] }): JSX.Element {
  const isOneDrive = location === 'onedrive'
  const label = isOneDrive ? 'Cloud' : 'Local'
  const tone = isOneDrive
    ? 'bg-accent/15 text-accent border border-accent/25'
    : 'bg-surface-2 text-text-secondary border border-line'
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold ${tone}`}>{label}</span>
  )
}

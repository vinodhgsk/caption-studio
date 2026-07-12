import type { ProjectMeta } from '../../../shared/storage'
import { formatDuration, formatLastModified } from './format'
import ProjectCardMenu from './ProjectCardMenu'

export interface ProjectCardProps {
  project: ProjectMeta
  onOpen?: (project: ProjectMeta) => void
  onDuplicate?: (project: ProjectMeta) => void
  onRename?: (project: ProjectMeta) => void
  onDelete?: (project: ProjectMeta) => void
  onReveal?: (project: ProjectMeta) => void
  onArchive?: (project: ProjectMeta, archived: boolean) => void
}

/** Aspect-specific gradient & accent colors — no hardcoded hex values, only Tailwind tokens */
function aspectStyle(aspect: string | undefined): {
  gradient: string
  ringColor: string
  aspectRatio: string
} {
  switch (aspect) {
    case '9:16':
      return {
        gradient: 'from-purple-900/70 via-purple-800/30 to-surface-0/80',
        ringColor: 'hover:ring-purple-500/40',
        aspectRatio: 'aspect-[9/16]'
      }
    case '1:1':
      return {
        gradient: 'from-emerald-900/70 via-teal-800/30 to-surface-0/80',
        ringColor: 'hover:ring-emerald-500/40',
        aspectRatio: 'aspect-square'
      }
    case '16:9':
    default:
      return {
        gradient: 'from-blue-900/70 via-indigo-800/30 to-surface-0/80',
        ringColor: 'hover:ring-blue-500/40',
        aspectRatio: 'aspect-video'
      }
  }
}

function locationLabel(location: ProjectMeta['location']): { text: string; tone: string } {
  if (location === 'onedrive') return { text: 'OneDrive', tone: 'bg-accent/15 text-accent border-accent/25' }
  if (location === 'synology') return { text: 'Synology', tone: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' }
  return { text: 'Local', tone: 'bg-surface-2 text-text-secondary border-line' }
}

export default function ProjectCard({
  project,
  onOpen,
  onDuplicate,
  onRename,
  onDelete,
  onReveal,
  onArchive
}: ProjectCardProps): JSX.Element {
  const lastModified = formatLastModified(project.updatedAt)
  const duration = formatDuration(project.durationSec)
  const { gradient, ringColor, aspectRatio } = aspectStyle(project.aspect)
  const loc = locationLabel(project.location)

  const menuItems = [
    { key: 'open', label: 'Open', onSelect: () => onOpen?.(project) },
    { key: 'duplicate', label: 'Duplicate', onSelect: () => onDuplicate?.(project) },
    { key: 'rename', label: 'Rename', onSelect: () => onRename?.(project) },
    project.archived
      ? { key: 'unarchive', label: 'Unarchive', onSelect: () => onArchive?.(project, false) }
      : { key: 'archive', label: 'Archive', onSelect: () => onArchive?.(project, true) },
    { key: 'reveal', label: 'Reveal in folder', onSelect: () => onReveal?.(project) },
    { key: 'delete', label: 'Delete', danger: true, onSelect: () => onDelete?.(project) }
  ]

  return (
    <div
      className={`group relative flex w-full flex-col overflow-hidden rounded-xl border border-line bg-surface-1 ring-2 ring-transparent transition-all duration-300 hover:border-accent/40 ${ringColor} hover:shadow-2xl hover:shadow-black/40 hover:-translate-y-0.5 focus-within:border-accent/40`}
    >
      {/* Context menu — appears on hover */}
      <div className="absolute right-2 top-2 z-20 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <ProjectCardMenu label={`Actions for ${project.name}`} items={menuItems} />
      </div>

      <button
        type="button"
        onClick={() => onOpen?.(project)}
        title={project.name}
        className="flex w-full flex-col text-left focus-visible:outline-none"
      >
        {/* ── Thumbnail canvas ── */}
        <div className={`relative flex w-full items-center justify-center overflow-hidden bg-surface-2 ${aspectRatio}`}>
          {/* Animated gradient layer */}
          <div className={`absolute inset-0 bg-gradient-to-b ${gradient} transition-opacity duration-500 opacity-80 group-hover:opacity-100`} />

          {/* Subtle grid overlay for depth */}
          <div
            className="absolute inset-0 opacity-[0.04] group-hover:opacity-[0.07] transition-opacity"
            style={{
              backgroundImage:
                'repeating-linear-gradient(0deg, transparent, transparent 20px, rgba(255,255,255,1) 20px, rgba(255,255,255,1) 21px), repeating-linear-gradient(90deg, transparent, transparent 20px, rgba(255,255,255,1) 20px, rgba(255,255,255,1) 21px)'
            }}
          />

          {/* Aspect ratio label — centre watermark */}
          <span className="relative z-10 select-none text-[11px] font-black tracking-[0.2em] text-white/20 group-hover:text-white/30 transition-colors uppercase">
            {project.aspect ?? '16:9'}
          </span>

          {/* Aspect badge — top left */}
          <div className="absolute left-2 top-2 z-20 rounded-md bg-black/50 px-1.5 py-0.5 text-[9px] font-bold text-white backdrop-blur-sm border border-white/10">
            {project.aspect ?? '16:9'}
          </div>

          {/* Duration badge — bottom right */}
          {duration && (
            <div className="absolute bottom-2 right-2 z-20 rounded-md bg-black/50 px-1.5 py-0.5 text-[9px] font-bold text-white backdrop-blur-sm border border-white/10">
              {duration}
            </div>
          )}

          {/* Hover play overlay */}
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/20 opacity-0 transition-all duration-300 group-hover:opacity-100 backdrop-blur-[2px]">
            <div className="flex h-11 w-11 translate-y-3 transform items-center justify-center rounded-full bg-accent shadow-xl shadow-accent/40 transition-transform duration-300 group-hover:translate-y-0">
              <svg className="ml-0.5 h-5 w-5 fill-white" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        </div>

        {/* ── Metadata row ── */}
        <div className="flex flex-col gap-1.5 p-3.5">
          <div className="flex items-start justify-between gap-2">
            <span className="line-clamp-1 flex-1 text-xs font-semibold text-text-primary group-hover:text-white transition-colors leading-snug">
              {project.name}
            </span>
            <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold ${loc.tone}`}>
              {loc.text}
            </span>
          </div>
          {lastModified && (
            <span className="text-[10px] text-text-muted leading-none">
              {lastModified}
            </span>
          )}
        </div>
      </button>
    </div>
  )
}

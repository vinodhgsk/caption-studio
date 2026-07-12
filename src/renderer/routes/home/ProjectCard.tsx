import type { ProjectMeta } from '../../../shared/storage'
import { formatDuration, formatLastModified } from './format'
import ProjectCardMenu from './ProjectCardMenu'

/**
 * Polished, reusable project card for the Projects Home grid (P2.2 + P2.4).
 *
 * Shows a thumbnail region (aspect-aware, with a graceful "No preview"
 * fallback — real thumbnails arrive in a later phase), the project name
 * (truncated), a last-modified · duration metadata row, and a storage badge
 * distinguishing Local vs OneDrive. Clicking the card body opens the project.
 *
 * A kebab ("⋯") menu in the corner exposes the per-card actions (P2.4):
 * Open, Duplicate, Rename, Delete, Reveal in folder. The menu lives outside the
 * open button so the two affordances don't nest; menu clicks stop propagation.
 */
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
    <div className="group relative flex w-full flex-col overflow-hidden rounded-lg border border-line bg-surface-1 transition-colors hover:border-accent hover:bg-surface-2 focus-within:border-accent">
      {/* Actions menu — outside the open button so the two don't nest. */}
      <div className="absolute right-2 top-2 z-10">
        <ProjectCardMenu label={`Actions for ${project.name}`} items={menuItems} />
      </div>

      <button
        type="button"
        onClick={() => onOpen?.(project)}
        title={project.name}
        className="flex w-full flex-col text-left focus-visible:outline-none"
      >
        {/* Thumbnail seam — real preview thumbnail renders in a later phase. */}
        <div
          className={`flex w-full items-center justify-center bg-surface-2 text-xs text-text-muted ${aspectClass(
            project.aspect
          )}`}
        >
          No preview
        </div>
        <div className="flex flex-col gap-1.5 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium text-text-primary">{project.name}</span>
            <StorageBadge location={project.location} />
          </div>
          <div className="flex items-center gap-2 text-xs text-text-muted">
            {lastModified ? <span>{lastModified}</span> : null}
            {lastModified && duration ? <span aria-hidden>·</span> : null}
            {duration ? <span>{duration}</span> : null}
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
  const label = isOneDrive ? 'OneDrive' : 'Local'
  const tone = isOneDrive
    ? 'bg-accent/15 text-accent border border-accent/30'
    : 'bg-surface-2 text-text-secondary border border-line'
  return (
    <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${tone}`}>{label}</span>
  )
}

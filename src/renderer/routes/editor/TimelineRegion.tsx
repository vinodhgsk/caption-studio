import { useProjectStore } from '@/store/projectStore'
import { Timeline } from './timeline/Timeline'

/**
 * Bottom region (region 3 of the editor shell): the multi-track timeline (P3.2).
 * Reads the open document from `projectStore.currentProject` and renders the
 * track lanes, ruler, headers, zoom + snap controls, and the playhead marker.
 * Renders nothing until a project is open (the editor shell guards this anyway).
 */
export function TimelineRegion({ height }: { height?: number }): JSX.Element | null {
  const project = useProjectStore((s) => s.currentProject)
  if (project === null) return null
  return <Timeline project={project} height={height} />
}

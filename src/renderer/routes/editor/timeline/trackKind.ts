import type { ProjectTrack } from '../../../../shared/storage'

type TrackType = ProjectTrack['type']

/** Display label for each track type (pure data — no JSX). */
const TRACK_LABEL: Record<TrackType, string> = {
  video: 'Video',
  audio: 'Audio',
  text: 'Text',
  effect: 'Effect'
}

/** Human-readable label for a track type. */
export function trackLabel(type: TrackType): string {
  return TRACK_LABEL[type]
}

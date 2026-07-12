import type { ProjectSettings } from '../../../shared/storage'

/** The aspect literal union (mirrors `ProjectSettings['aspect']`). */
export type Aspect = ProjectSettings['aspect']

/**
 * Pure mapping from an aspect ratio to its canonical pixel resolution.
 * 16:9 → 1920×1080, 9:16 → 1080×1920, 1:1 → 1080×1080.
 */
export function resolutionForAspect(aspect: Aspect): [number, number] {
  switch (aspect) {
    case '16:9':
      return [1920, 1080]
    case '9:16':
      return [1080, 1920]
    case '1:1':
      return [1080, 1080]
  }
}

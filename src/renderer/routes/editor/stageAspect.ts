import type { Aspect } from '../home/aspect'

/**
 * Pure mapping from an aspect ratio to a CSS `aspect-ratio` value for the
 * letterboxed preview stage. 16:9 → '16 / 9', 9:16 → '9 / 16', 1:1 → '1 / 1'.
 */
export function aspectRatioStyle(aspect: Aspect): string {
  switch (aspect) {
    case '16:9':
      return '16 / 9'
    case '9:16':
      return '9 / 16'
    case '1:1':
      return '1 / 1'
  }
}

import type { StorageLocation } from '../../shared/storage'

/** Editor route query params: which project to open and where it lives. */
export interface EditorParams {
  id: string
  location: StorageLocation
}

/** Narrow a raw query value to a known `StorageLocation`, else null. */
function asLocation(value: string | null): StorageLocation | null {
  return value === 'local' || value === 'onedrive' || value === 'synology' ? value : null
}

/**
 * Validate the editor route's `id` + `location` query params. Returns the
 * narrowed params, or null when either is missing/invalid (deep-link guard).
 */
export function parseEditorParams(params: URLSearchParams): EditorParams | null {
  const id = params.get('id')
  const location = asLocation(params.get('location'))
  if (id === null || id === '' || location === null) return null
  return { id, location }
}

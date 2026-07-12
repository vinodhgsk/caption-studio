/**
 * Storage layer types — shared by main, preload, and renderer.
 *
 * Pure types only: NO electron / node imports leak here so the renderer can
 * reference them freely. The `StorageProvider` interface is the single contract
 * backing local disk and OneDrive (master plan §5); the `Project` shape mirrors
 * the project.json schema (master plan §4).
 */

import type { Clip } from './project-schema'
import type { Captions } from './stt'
import type { FontManifest, FontMetadata } from './fontParse'
import type { FontFileRef } from './fontRegistry'

export type { Clip, ClipTransform, ClipAudio, Keyframe, KeyframeProp, ClipKeyframes } from './project-schema'
export { defaultTransform, defaultClipAudio, clipDuration, KEYFRAME_PROPS } from './project-schema'

/** Where a project bundle physically lives. */
export type StorageLocation = 'local' | 'onedrive' | 'synology'

/** Lightweight handle to a project bundle on a given storage target. */
export interface ProjectRef {
  id: string
  name: string
  location: StorageLocation
  /** Absolute path to the `<name>.vproj` bundle directory. */
  path: string
}

/**
 * Listing-level metadata for a project — cheap to read (just project.json's
 * header fields) without loading the full track graph.
 */
export interface ProjectMeta {
  id: string
  name: string
  location: StorageLocation
  /** Absolute path to the `<name>.vproj` bundle directory. */
  path: string
  createdAt: string
  updatedAt: string
  aspect?: string
  durationSec?: number
  archived?: boolean
}

/** Project-level settings (mirrors project.json `settings`; master plan §4). */
export interface ProjectSettings {
  fps: number
  resolution: [number, number]
  aspect: '16:9' | '9:16' | '1:1'
  background: string
  /** Project default language (Tamil by default). */
  language: string
  languages: string[]
}

/**
 * A timeline track. `clips` is the typed `Clip[]` schema (master plan §4);
 * an empty track (`clips: []`) is valid, keeping Phase 0-2 fixtures working.
 */
export interface ProjectTrack {
  id: string
  type: 'video' | 'audio' | 'text' | 'effect'
  clips: Clip[]
}

/** The full serialized project (the contract of project.json; master plan §4). */
export interface Project {
  version: number
  id: string
  name: string
  createdAt: string
  updatedAt: string
  archived?: boolean
  settings: ProjectSettings
  storage: { location: StorageLocation; root: string }
  tracks: ProjectTrack[]
  /**
   * Captions block (master plan §4 / Doc 00 §4). `captions.styleId` records the
   * id of the applied {@link import('./captionPreset').CaptionPreset} (Doc 03
   * P5.1/P5.4). Typed via the shared {@link Captions} contract; optional so a
   * project with no captions yet omits it.
   */
  captions?: Captions
  /**
   * Imported-font manifest (P6.2 — Doc 08). References embedded font files by
   * their bundle-relative `media/fonts/…` paths so imported families "travel
   * with the project": on open, {@link import('./fontParse').rehydrateImportedFonts}
   * re-registers them deterministically from this list. Optional — a project
   * with no custom fonts omits it.
   */
  fonts?: FontManifest
  /** Open schema refined by later phases (saved style ids). */
  presets?: unknown
}

/** Result of a write. `conflict` flags a last-write-wins overwrite (P1.11). */
export interface WriteResult {
  conflict: boolean
  warning?: string
}

/** Kind of imported media, derived from the source file extension (P3.3, P4.1). */
export type MediaKind = 'video' | 'image' | 'audio'

/**
 * Result of importing a media file into a bundle (P3.3). `mediaRef` is the
 * bundle-relative path the Clip stores; `fileName` is the de-duplicated name
 * that physically landed in `media/`.
 */
export interface ImportMediaResult {
  mediaRef: string
  fileName: string
  kind: MediaKind
}

/**
 * Result of importing a TTF/OTF into a bundle's `media/fonts/` folder (P6.2).
 * `fileRef.path` is bundle-relative (`media/fonts/<file>`); `metadata` is the
 * parsed family + weight/style (or filename fallback). Path-based copy in MAIN —
 * NO font bytes cross IPC beyond the picked source path.
 */
export interface ImportFontResult {
  fileRef: FontFileRef
  fileName: string
  metadata: FontMetadata
}

/**
 * The single abstraction the editor saves/opens through, so editor code never
 * branches on storage location (master plan §5).
 */
export interface StorageProvider {
  listProjects(): Promise<ProjectMeta[]>
  createProject(name: string): Promise<ProjectRef>
  readProject(ref: ProjectRef): Promise<Project>
  writeProject(
    ref: ProjectRef,
    project: Project,
    expectedUpdatedAt?: string
  ): Promise<WriteResult>
  readMedia(ref: ProjectRef, mediaRelPath: string): Promise<import('node:stream').Readable>
  writeOutput(ref: ProjectRef, relPath: string, data: Buffer): Promise<void>
  /**
   * Copy a source media file (given by absolute path) into the bundle's
   * `media/` folder, de-duplicating the filename on collision. Returns the
   * bundle-relative `mediaRef`, the final file name, and the derived media
   * kind. Path-based copy in MAIN — NO Buffers cross IPC (P3.3).
   */
  copyMedia(ref: ProjectRef, sourceAbsPath: string): Promise<ImportMediaResult>
  /**
   * Copy a source TTF/OTF (given by absolute path) into the bundle's
   * `media/fonts/` folder, de-duplicating the filename on collision, parsing its
   * family + weight/style. Returns the bundle-relative `fileRef` + parsed
   * `metadata` + final file name. Path-based copy in MAIN — NO bytes cross IPC
   * beyond the source path (P6.2).
   */
  copyFont(ref: ProjectRef, sourceAbsPath: string): Promise<ImportFontResult>
  resolvePath(ref: ProjectRef): string
  /**
   * Copy the whole bundle to a new, uniquely-named bundle with a fresh id and
   * createdAt=updatedAt=now. `copyName` overrides the derived "<name> copy".
   */
  duplicateProject(ref: ProjectRef, copyName?: string): Promise<ProjectRef>
  /** Rename the bundle directory + project.json name; returns the updated ref. */
  renameProject(ref: ProjectRef, name: string): Promise<ProjectRef>
  /** Recursively remove the bundle directory. */
  deleteProject(ref: ProjectRef): Promise<void>
  /** Toggle the archived state of a project in its bundle. */
  archiveProject(ref: ProjectRef, archived: boolean): Promise<void>
}

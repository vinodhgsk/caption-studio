/**
 * PURE font-file metadata parsing + the project font manifest (P6.2 — Doc 08
 * typography; skills `text-render`, `indic-text`, `storage-provider`).
 *
 * Two responsibilities, both PURE (NO electron / node-fs / DOM):
 *
 *   1. {@link parseFontMetadata} — a lightweight TTF/OTF/`sfnt` name-table read
 *      over a raw byte buffer. Extracts the family name + sub-family (weight/
 *      style) WITHOUT a heavy font library, so the main process can call it on
 *      the bytes it just copied and the renderer/tests can call it on a fixture
 *      buffer. Falls back to the filename when the table is missing/unreadable.
 *
 *   2. The {@link FontManifest} — what persists in `project.json` so an imported
 *      family "travels with the project". It references the embedded bytes by
 *      their bundle-relative `media/fonts/…` paths ONLY (never absolute), so
 *      opening the bundle elsewhere (another machine, OneDrive) re-hydrates the
 *      SAME families deterministically. {@link manifestEntryToFontEntry} turns a
 *      manifest record back into a {@link FontEntry} the registry can register,
 *      and {@link rehydrateImportedFonts} replays a whole manifest into a
 *      {@link FontRegistry} on project open.
 *
 * WHY pure: the parse + manifest logic is the testable core; the fs copy and the
 * IPC plumbing (src/main/storage/fonts.ts, the `fonts:import` channel) are thin
 * shells over it. The renderer's runtime FontFace registration (loadImportedFont)
 * also reuses {@link FONT_MEDIA_DIR} + these shapes so persist/preview/export all
 * agree on one source of truth.
 */
import {
  type FontEntry,
  type FontFileRef,
  type FontRegistry,
  type FontCategory,
  type FontSource
} from './fontRegistry'
import { detectScript, ALL_SCRIPTS, type Script } from './scriptDetect'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The bundle subfolder embedded font files live in (under `media/`). */
export const FONT_MEDIA_DIR = 'media/fonts'

/** Accepted import extensions (lower-case, no dot). TrueType + OpenType. */
export const FONT_EXTENSIONS = ['ttf', 'otf', 'ttc', 'otc'] as const

/** Lower-case extension (no dot) of a path/filename, or '' when none. */
export function fontExtension(fileNameOrPath: string): string {
  const base = fileNameOrPath.split(/[\\/]/).pop() ?? fileNameOrPath
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/** True when a filename/path has an accepted font extension. */
export function isFontFile(fileNameOrPath: string): boolean {
  return (FONT_EXTENSIONS as readonly string[]).includes(fontExtension(fileNameOrPath))
}

// ---------------------------------------------------------------------------
// Parsed metadata
// ---------------------------------------------------------------------------

/** What {@link parseFontMetadata} extracts from a font's `name` table. */
export interface FontMetadata {
  /** The CSS family name (name id 16 "Typographic Family", else id 1). */
  family: string
  /** The sub-family / style string (name id 17, else id 2), e.g. "Bold Italic". */
  subfamily: string
  /** Numeric weight derived from the subfamily (100..900; 400 when unknown). */
  weight: number
  /** Whether the subfamily indicates an italic/oblique cut. */
  italic: boolean
  /** True when the family came from the name table (false ⇒ filename fallback). */
  fromNameTable: boolean
}

// ---------------------------------------------------------------------------
// Lightweight sfnt `name` table reader
// ---------------------------------------------------------------------------

// sfnt version tags that introduce a TrueType/OpenType table directory.
const SFNT_TAGS = new Set<number>([
  0x00010000, // TrueType outlines
  0x4f54544f, // 'OTTO' — CFF/OpenType
  0x74727565, // 'true'
  0x74797031 // 'typ1'
])
const TTC_TAG = 0x74746366 // 'ttcf' — TrueType Collection

// Name IDs we care about (OpenType `name` table spec).
const NAME_ID_FAMILY = 1
const NAME_ID_SUBFAMILY = 2
const NAME_ID_TYPO_FAMILY = 16
const NAME_ID_TYPO_SUBFAMILY = 17

/**
 * Read the `name` table of a TTF/OTF/TTC buffer and return the family +
 * subfamily strings, or `null` when the buffer is not a parseable sfnt or has
 * no usable name records. PURE + total — never throws on malformed input.
 *
 * Supports the common Windows-Unicode (platform 3) and Unicode (platform 0)
 * name records (UTF-16BE) plus the Mac-Roman (platform 1) ASCII subset, which
 * covers virtually every real font file. For a `.ttc` collection it reads the
 * first font's name table (the family the import will register under).
 */
export function readNameTable(
  buffer: Uint8Array
): { family?: string; subfamily?: string; typoFamily?: string; typoSubfamily?: string } | null {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  if (buffer.byteLength < 12) return null

  let sfntOffset = 0
  const head = view.getUint32(0)
  if (head === TTC_TAG) {
    // ttcf: header → numFonts (u32 @8) → offset table (u32[] @12). First font.
    if (buffer.byteLength < 16) return null
    sfntOffset = view.getUint32(12)
  } else if (!SFNT_TAGS.has(head)) {
    return null
  }

  if (sfntOffset + 12 > buffer.byteLength) return null
  const numTables = view.getUint16(sfntOffset + 4)

  // Walk the table directory for the `name` table record.
  let nameOffset = -1
  const dirStart = sfntOffset + 12
  for (let i = 0; i < numTables; i++) {
    const rec = dirStart + i * 16
    if (rec + 16 > buffer.byteLength) return null
    const tag = view.getUint32(rec)
    if (tag === 0x6e616d65 /* 'name' */) {
      nameOffset = view.getUint32(rec + 8)
      break
    }
  }
  if (nameOffset < 0 || nameOffset + 6 > buffer.byteLength) return null

  // name table header: format(u16), count(u16), stringOffset(u16).
  const count = view.getUint16(nameOffset + 2)
  const storageOffset = nameOffset + view.getUint16(nameOffset + 4)
  const recordsStart = nameOffset + 6

  const out: { family?: string; subfamily?: string; typoFamily?: string; typoSubfamily?: string } =
    {}

  for (let i = 0; i < count; i++) {
    const rec = recordsStart + i * 12
    if (rec + 12 > buffer.byteLength) break
    const platformId = view.getUint16(rec)
    const nameId = view.getUint16(rec + 6)
    const length = view.getUint16(rec + 8)
    const strOffset = storageOffset + view.getUint16(rec + 10)
    if (strOffset + length > buffer.byteLength) continue

    if (
      nameId !== NAME_ID_FAMILY &&
      nameId !== NAME_ID_SUBFAMILY &&
      nameId !== NAME_ID_TYPO_FAMILY &&
      nameId !== NAME_ID_TYPO_SUBFAMILY
    ) {
      continue
    }

    const value = decodeNameString(buffer, strOffset, length, platformId)
    if (value.length === 0) continue

    // Prefer the first occurrence (records are ordered by platform/encoding,
    // Windows-Unicode typically appearing — and we keep whichever decodes).
    if (nameId === NAME_ID_FAMILY && out.family === undefined) out.family = value
    else if (nameId === NAME_ID_SUBFAMILY && out.subfamily === undefined) out.subfamily = value
    else if (nameId === NAME_ID_TYPO_FAMILY && out.typoFamily === undefined) out.typoFamily = value
    else if (nameId === NAME_ID_TYPO_SUBFAMILY && out.typoSubfamily === undefined)
      out.typoSubfamily = value
  }

  if (
    out.family === undefined &&
    out.subfamily === undefined &&
    out.typoFamily === undefined &&
    out.typoSubfamily === undefined
  ) {
    return null
  }
  return out
}

/** Decode a name-record string by platform: UTF-16BE for 0/3, Latin1 for Mac (1). */
function decodeNameString(
  buffer: Uint8Array,
  offset: number,
  length: number,
  platformId: number
): string {
  if (platformId === 1) {
    // Mac Roman — treat as ASCII/Latin1 (covers the Latin family names we read).
    let s = ''
    for (let i = 0; i < length; i++) s += String.fromCharCode(buffer[offset + i])
    return s.trim()
  }
  // Unicode (0) / Windows (3): UTF-16BE.
  let s = ''
  for (let i = 0; i + 1 < length; i += 2) {
    s += String.fromCharCode((buffer[offset + i] << 8) | buffer[offset + i + 1])
  }
  return s.trim()
}

// ---------------------------------------------------------------------------
// Weight / italic derivation from the subfamily / family text
// ---------------------------------------------------------------------------

/**
 * Common weight keyword → numeric value (OpenType usWeightClass scale).
 * Matched as case-insensitive SUBSTRINGS so concatenated style tokens like
 * "BoldItalic" / "SemiBold" (common in filenames + subfamily strings) resolve.
 * Ordered most-specific-first so "SemiBold"/"ExtraBold" win over plain "Bold".
 */
const WEIGHT_KEYWORDS: ReadonlyArray<readonly [RegExp, number]> = [
  [/thin|hairline/i, 100],
  [/extra[ -]?light|ultra[ -]?light/i, 200],
  [/semi[ -]?bold|demi[ -]?bold/i, 600],
  [/extra[ -]?bold|ultra[ -]?bold/i, 800],
  [/black|heavy/i, 900],
  [/light/i, 300],
  [/medium/i, 500],
  [/regular|normal|book/i, 400],
  // plain "bold" last so the more-specific bold variants above win.
  [/bold/i, 700]
]

/** Derive a numeric weight (100..900) from a style/subfamily string; 400 default. */
export function weightFromStyle(style: string): number {
  for (const [re, w] of WEIGHT_KEYWORDS) if (re.test(style)) return w
  return 400
}

/** True when a style/subfamily string indicates an italic or oblique cut. */
export function isItalicStyle(style: string): boolean {
  return /italic|oblique/i.test(style)
}

/**
 * Parse a font file's family + weight/style from its raw bytes, falling back to
 * `fileName` (its stem, hyphen/underscore-split for a style hint) when the name
 * table is unreadable. PURE + total: a corrupt buffer yields a filename-derived
 * {@link FontMetadata} with `fromNameTable:false` rather than throwing.
 */
export function parseFontMetadata(buffer: Uint8Array, fileName: string): FontMetadata {
  const table = safeReadNameTable(buffer)

  const stem = fontStem(fileName)
  if (table !== null) {
    const family = (table.typoFamily ?? table.family ?? stem).trim()
    const subfamily = (table.typoSubfamily ?? table.subfamily ?? '').trim()
    if (family.length > 0) {
      return {
        family,
        subfamily,
        // weight/italic: prefer the subfamily, fall back to the family text.
        weight: weightFromStyle(subfamily.length > 0 ? subfamily : family),
        italic: isItalicStyle(subfamily.length > 0 ? subfamily : family),
        fromNameTable: true
      }
    }
  }

  // Filename fallback: "MyFont-BoldItalic.ttf" → family "MyFont", style "BoldItalic".
  const { family, style } = familyAndStyleFromStem(stem)
  return {
    family,
    subfamily: style,
    weight: weightFromStyle(style.length > 0 ? style : family),
    italic: isItalicStyle(style.length > 0 ? style : family),
    fromNameTable: false
  }
}

/** {@link readNameTable} guarded so a thrown DataView range error can't escape. */
function safeReadNameTable(buffer: Uint8Array): ReturnType<typeof readNameTable> {
  try {
    return readNameTable(buffer)
  } catch {
    return null
  }
}

/** Strip directories + extension from a filename, returning the stem. */
function fontStem(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName
  const dot = base.lastIndexOf('.')
  return (dot > 0 ? base.slice(0, dot) : base).trim()
}

/**
 * Split a filename stem into a family + style hint. Splits on the LAST hyphen/
 * underscore when the trailing token looks like a style word (e.g.
 * "MyFont-BoldItalic" → family "MyFont", style "BoldItalic"); otherwise the
 * whole (space-normalized) stem is the family and the style is empty.
 */
export function familyAndStyleFromStem(stem: string): { family: string; style: string } {
  const m = /^(.*)[-_]([A-Za-z]+)$/.exec(stem)
  if (m !== null) {
    const candidateStyle = m[2]
    if (
      weightFromStyle(candidateStyle) !== 400 ||
      isItalicStyle(candidateStyle) ||
      /regular/i.test(candidateStyle)
    ) {
      return { family: normalizeFamily(m[1]), style: candidateStyle }
    }
  }
  return { family: normalizeFamily(stem), style: '' }
}

/** Turn a filename family token into a presentable family name. */
function normalizeFamily(raw: string): string {
  const cleaned = raw.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned.length > 0 ? cleaned : 'Imported Font'
}

// ---------------------------------------------------------------------------
// Script coverage hint (cheap; the registry needs ≥1 script)
// ---------------------------------------------------------------------------

/**
 * Guess the scripts an imported family covers. We do NOT crack the cmap (kept
 * lightweight); instead we infer from the family name (a "Tamil"/"Telugu"/…
 * family declares that script + Latin) and otherwise default to `['latin']`.
 * Always non-empty so {@link FontRegistry.registerFont} accepts it. A caller can
 * override via {@link buildImportedFontEntry}'s `scripts` option.
 */
export function inferScripts(family: string): Script[] {
  const lower = family.toLowerCase()
  const named: Array<[string, Script]> = [
    ['tamil', 'tamil'],
    ['telugu', 'telugu'],
    ['malayalam', 'malayalam'],
    ['kannada', 'kannada'],
    ['devanagari', 'devanagari'],
    ['hindi', 'devanagari']
  ]
  for (const [needle, script] of named) {
    if (lower.includes(needle)) return [script, 'latin']
  }
  // Detect from the family text itself (an Indic-named family in its own script).
  const detected = detectScript(family)
  if (detected !== 'latin') return [detected, 'latin']
  return ['latin']
}

// ---------------------------------------------------------------------------
// Manifest — what persists in project.json (travels with the bundle)
// ---------------------------------------------------------------------------

/**
 * One imported family's record in the persisted manifest. Holds ONLY portable
 * data: the family name, render metadata, and bundle-relative file paths under
 * {@link FONT_MEDIA_DIR}. NO absolute paths — that is what makes a bundle moved
 * to another machine / OneDrive re-hydrate to the identical family.
 */
export interface FontManifestEntry {
  family: string
  displayName: string
  category: FontCategory
  scripts: Script[]
  weights: number[]
  styles: ('normal' | 'italic')[]
  /** Bundle-relative font files (each path under `media/fonts/`). */
  files: FontFileRef[]
}

/**
 * The persisted font manifest (lives at `project.fonts`). A flat list of
 * imported families so re-hydration is deterministic and order-stable.
 */
export interface FontManifest {
  imported: FontManifestEntry[]
}

/** An empty manifest (a project with no imported fonts yet). */
export function emptyFontManifest(): FontManifest {
  return { imported: [] }
}

/** True when `path` is a valid bundle-relative font path under `media/fonts/`. */
export function isBundleRelativeFontPath(path: string): boolean {
  if (typeof path !== 'string' || path.length === 0) return false
  // Reject absolute paths, drive letters, and traversal hops.
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.includes('\\')) return false
  if (path.split('/').some((s) => s === '..' || s === '')) return false
  return path.startsWith(`${FONT_MEDIA_DIR}/`)
}

// ---------------------------------------------------------------------------
// Build a FontEntry / manifest entry from a parse result + file ref
// ---------------------------------------------------------------------------

/** Options to override inferred metadata when building an imported entry. */
export interface BuildImportedFontEntryOptions {
  /** Override the family name (else from {@link FontMetadata}). */
  family?: string
  /** Override the category (else `'sans'`). */
  category?: FontCategory
  /** Override the inferred script coverage (else {@link inferScripts}). */
  scripts?: Script[]
}

/**
 * Build a registrable, imported {@link FontEntry} from a parse result and the
 * bundle-relative file ref the copy produced. PURE. The entry's `source` is
 * `'imported'`, it carries the single `FontFileRef`, and its `scripts`/`weights`/
 * `styles` come from the metadata (+ optional overrides). Throws if the file ref
 * is not a bundle-relative `media/fonts/` path (portability guarantee).
 */
export function buildImportedFontEntry(
  meta: FontMetadata,
  fileRef: FontFileRef,
  opts: BuildImportedFontEntryOptions = {}
): FontEntry {
  if (!isBundleRelativeFontPath(fileRef.path)) {
    throw new Error(
      `buildImportedFontEntry: file path must be bundle-relative under ${FONT_MEDIA_DIR}/ (got "${fileRef.path}")`
    )
  }
  const family = (opts.family ?? meta.family).trim()
  const scripts = opts.scripts ?? inferScripts(family)
  return {
    family,
    displayName: family,
    category: opts.category ?? 'sans',
    source: 'imported' as FontSource,
    scripts,
    weights: [fileRef.weight],
    styles: fileRef.italic ? ['italic'] : ['normal'],
    files: [{ ...fileRef }]
  }
}

/**
 * Merge a newly-imported {@link FontEntry} into an existing manifest. If a record
 * for the same family already exists (re-import of a different cut), the new file
 * + weight + style are UNIONED into it; otherwise a new record is appended. PURE
 * (returns a new manifest, never mutates the input).
 */
export function addEntryToManifest(manifest: FontManifest, entry: FontEntry): FontManifest {
  const key = entry.family.trim().toLowerCase()
  const next = manifest.imported.map(cloneManifestEntry)
  const existing = next.find((e) => e.family.trim().toLowerCase() === key)

  const incomingFiles = (entry.files ?? []).filter((f) => isBundleRelativeFontPath(f.path))

  if (existing !== undefined) {
    for (const f of incomingFiles) {
      if (!existing.files.some((g) => g.path === f.path)) existing.files.push({ ...f })
    }
    existing.weights = unionSorted(existing.weights, entry.weights)
    existing.styles = unionStyles(existing.styles, entry.styles)
    existing.scripts = entry.scripts.length > 0 ? [...entry.scripts] : existing.scripts
    return { imported: next }
  }

  next.push({
    family: entry.family,
    displayName: entry.displayName,
    category: entry.category,
    scripts: [...entry.scripts],
    weights: [...entry.weights],
    styles: [...entry.styles],
    files: incomingFiles.map((f) => ({ ...f }))
  })
  return { imported: next }
}

/**
 * Convert a persisted {@link FontManifestEntry} back into a registrable
 * {@link FontEntry} (source `'imported'`). PURE. Used by {@link rehydrateImportedFonts}
 * on project open so the family is usable again. Skips records whose file paths
 * are not bundle-relative (defensive against a hand-edited manifest).
 */
export function manifestEntryToFontEntry(entry: FontManifestEntry): FontEntry {
  return {
    family: entry.family,
    displayName: entry.displayName ?? entry.family,
    category: entry.category,
    source: 'imported',
    scripts: [...entry.scripts],
    weights: [...entry.weights],
    styles: [...entry.styles],
    files: entry.files.filter((f) => isBundleRelativeFontPath(f.path)).map((f) => ({ ...f }))
  }
}

/**
 * Re-register every imported family from a persisted manifest into `registry`
 * (project-open re-hydration). PURE over the manifest; only mutates the supplied
 * registry. Skips records that are empty/invalid or that collide with a bundled
 * family (the registry throws on a bundled collision — we swallow it so one bad
 * record cannot abort the open). Returns the families that were registered.
 */
export function rehydrateImportedFonts(
  registry: FontRegistry,
  manifest: FontManifest | undefined
): string[] {
  const registered: string[] = []
  if (manifest === undefined || !Array.isArray(manifest.imported)) return registered
  for (const record of manifest.imported) {
    if (
      typeof record.family !== 'string' ||
      record.family.trim().length === 0 ||
      !Array.isArray(record.scripts) ||
      record.scripts.length === 0
    ) {
      continue
    }
    const validScripts = record.scripts.filter((s) =>
      (ALL_SCRIPTS as readonly string[]).includes(s)
    )
    if (validScripts.length === 0) continue
    try {
      registry.registerFont(manifestEntryToFontEntry({ ...record, scripts: validScripts }))
      registered.push(record.family)
    } catch {
      // Bundled-collision or other rejection: skip this record, keep opening.
    }
  }
  return registered
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function cloneManifestEntry(e: FontManifestEntry): FontManifestEntry {
  return {
    ...e,
    scripts: [...e.scripts],
    weights: [...e.weights],
    styles: [...e.styles],
    files: e.files.map((f) => ({ ...f }))
  }
}

function unionSorted(a: number[], b: number[]): number[] {
  return Array.from(new Set([...a, ...b])).sort((x, y) => x - y)
}

function unionStyles(
  a: ('normal' | 'italic')[],
  b: ('normal' | 'italic')[]
): ('normal' | 'italic')[] {
  const set = new Set<'normal' | 'italic'>([...a, ...b])
  const out: ('normal' | 'italic')[] = []
  if (set.has('normal')) out.push('normal')
  if (set.has('italic')) out.push('italic')
  return out
}

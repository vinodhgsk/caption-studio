/**
 * Presets panel (P11.5, Doc 14 — preset-store skill).
 *
 * Lets the user:
 *   - Browse saved user presets in a gallery.
 *   - Apply a preset to the selected clip (P11.3).
 *   - Save the selected clip's current style as a new preset (P11.2).
 *   - Rename or delete a saved preset.
 *   - Import a preset pack from a JSON file (P11.4).
 *   - Export a single preset to a JSON file (P11.4).
 *
 * Layout: top toolbar (Save as preset / Import) → scrollable card grid → footer note.
 * Each card shows the preset name, creation date, and action icons (Apply / Export / Delete).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTimelineStore } from '@/store/timelineStore'
import { useProjectStore } from '@/store/projectStore'
import { clipTextToPresetStyle } from '../../../shared/userPreset'
import type { UserPreset } from '../../../shared/userPreset'

/** Generate a simple UUID v4 without any external dependency. */
function uuidV4(): string {
  // crypto.randomUUID is available in the sandboxed renderer (Chromium).
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback: Math.random-based (test/CI environments).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return iso
  }
}

export function PresetsPanel(): JSX.Element {
  const selection = useTimelineStore((s) => s.selection)
  const listUserPresets = useTimelineStore((s) => s.listUserPresets)
  const saveUserPreset = useTimelineStore((s) => s.saveUserPreset)
  const deleteUserPreset = useTimelineStore((s) => s.deleteUserPreset)
  const applyUserPreset = useTimelineStore((s) => s.applyUserPreset)
  const importUserPresets = useTimelineStore((s) => s.importUserPresets)
  const exportUserPreset = useTimelineStore((s) => s.exportUserPreset)

  const [presets, setPresets] = useState<UserPreset[]>([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const importRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    const list = await listUserPresets()
    setPresets(list)
  }, [listUserPresets])

  useEffect(() => {
    void reload()
  }, [reload])

  function flash(msg: string): void {
    setStatus(msg)
    window.setTimeout(() => setStatus(null), 3000)
  }

  // --- Save current clip as preset ---
  async function handleSave(): Promise<void> {
    if (selection.length === 0) {
      flash('Select a clip first.')
      return
    }
    const clipId = selection[0]
    const project = useProjectStore.getState().currentProject
    if (project === null) { flash('No project open.'); return }

    const track = project.tracks.find((t) => t.clips.some((c) => c.id === clipId))
    const clip = track?.clips.find((c) => c.id === clipId)
    if (clip === undefined) { flash('Clip not found.'); return }

    const name = window.prompt('Name this preset:', 'My style') ?? ''
    if (name.trim() === '') return

    const preset: UserPreset = {
      id: uuidV4(),
      name: name.trim(),
      createdAt: new Date().toISOString(),
      style: clipTextToPresetStyle(clip.text),
      animation: clip.animation ?? {},
      variants: {}
    }
    setBusy(true)
    const result = await saveUserPreset(preset)
    setBusy(false)
    if (result.ok) {
      flash('Preset saved.')
      await reload()
    } else {
      flash(`Save failed: ${result.error ?? 'unknown error'}`)
    }
  }

  // --- Apply preset to selected clip ---
  function handleApply(preset: UserPreset): void {
    if (selection.length === 0) {
      flash('Select a clip first.')
      return
    }
    applyUserPreset(selection[0], preset)
    flash(`Applied "${preset.name}".`)
  }

  // --- Delete preset ---
  async function handleDelete(id: string, name: string): Promise<void> {
    if (!window.confirm(`Delete preset "${name}"?`)) return
    setBusy(true)
    const result = await deleteUserPreset(id)
    setBusy(false)
    if (result.ok) {
      await reload()
    } else {
      flash(`Delete failed: ${result.error ?? 'unknown error'}`)
    }
  }

  // --- Rename preset (inline) ---
  function startRename(preset: UserPreset): void {
    setRenamingId(preset.id)
    setRenameValue(preset.name)
  }

  async function commitRename(preset: UserPreset): Promise<void> {
    if (renameValue.trim() === '' || renameValue === preset.name) {
      setRenamingId(null)
      return
    }
    const updated: UserPreset = { ...preset, name: renameValue.trim() }
    await saveUserPreset(updated)
    setRenamingId(null)
    await reload()
  }

  // --- Import ---
  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    if (file === undefined) return
    const json = await file.text()
    setBusy(true)
    const result = await importUserPresets(json)
    setBusy(false)
    if (result.errors.length > 0) {
      flash(`Import: ${result.imported} imported, ${result.skipped} skipped. Errors: ${result.errors[0]}`)
    } else {
      flash(`Imported ${result.imported} preset${result.imported === 1 ? '' : 's'}.`)
    }
    await reload()
    if (importRef.current !== null) importRef.current.value = ''
  }

  // --- Export ---
  async function handleExport(preset: UserPreset): Promise<void> {
    const json = await exportUserPreset(preset.id)
    if (json === null) { flash('Export failed.'); return }
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${preset.name.replace(/\s+/g, '-')}.preset.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const hasClip = selection.length > 0

  return (
    <section className="flex h-full flex-col gap-0">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-text-primary">Presets</h2>
        <div className="flex gap-1">
          <button
            type="button"
            disabled={!hasClip || busy}
            onClick={() => void handleSave()}
            title={hasClip ? 'Save selected clip as preset' : 'Select a clip first'}
            className="rounded px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            + Save
          </button>
          <label
            title="Import preset pack (JSON)"
            className="cursor-pointer rounded px-2 py-1 text-xs font-medium text-text-muted hover:bg-surface-2 hover:text-text-primary"
          >
            Import
            <input
              ref={importRef}
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={(e) => void handleImportFile(e)}
            />
          </label>
        </div>
      </div>

      {/* Status bar */}
      {status !== null && (
        <div className="border-b border-line bg-surface-2 px-4 py-1.5 text-xs text-text-muted">
          {status}
        </div>
      )}

      {/* Gallery */}
      <div className="flex-1 overflow-y-auto">
        {presets.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-xs text-text-muted">
            <span>No saved presets yet.</span>
            <span className="opacity-60">Select a styled clip and click&nbsp;+ Save.</span>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-line" role="list">
            {presets.map((preset) => (
              <li key={preset.id} className="group flex flex-col gap-1 px-4 py-3 hover:bg-surface-2">
                {/* Name row */}
                <div className="flex items-center gap-2">
                  {renamingId === preset.id ? (
                    <>
                      <label htmlFor={`preset-rename-${preset.id}`} className="sr-only">
                        Rename preset
                      </label>
                      <input
                        id={`preset-rename-${preset.id}`}
                        type="text"
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => void commitRename(preset)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitRename(preset)
                          if (e.key === 'Escape') setRenamingId(null)
                        }}
                        className="flex-1 rounded border border-accent bg-surface-1 px-1.5 py-0.5 text-xs text-text-primary outline-none focus:ring-1 focus:ring-accent"
                      />
                    </>
                  ) : (
                    <span
                      className="flex-1 cursor-pointer truncate text-xs font-medium text-text-primary"
                      onDoubleClick={() => startRename(preset)}
                      title="Double-click to rename"
                    >
                      {preset.name}
                    </span>
                  )}
                </div>

                {/* Meta + actions */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-text-muted">{formatDate(preset.createdAt)}</span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => handleApply(preset)}
                      disabled={!hasClip}
                      title={hasClip ? 'Apply to selected clip' : 'Select a clip first'}
                      className="rounded px-1.5 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleExport(preset)}
                      title="Export as JSON"
                      className="rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-surface-1 hover:text-text-primary"
                    >
                      Export
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(preset.id, preset.name)}
                      title="Delete preset"
                      aria-label={`Delete preset ${preset.name}`}
                      className="rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-danger/10 hover:text-danger"
                    >
                      ×
                    </button>
                  </div>
                </div>

                {/* Variant pills (when present) */}
                {Object.keys(preset.variants).length > 0 && (
                  <div className="flex gap-1 pt-0.5">
                    {(Object.keys(preset.variants) as string[]).map((aspect) => (
                      <span
                        key={aspect}
                        className="rounded-full bg-surface-1 px-1.5 py-0.5 text-[9px] text-text-muted ring-1 ring-line"
                      >
                        {aspect}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer hint */}
      <div className="border-t border-line px-4 py-2 text-[10px] text-text-muted">
        Double-click a name to rename. Changes are saved immediately.
      </div>
    </section>
  )
}

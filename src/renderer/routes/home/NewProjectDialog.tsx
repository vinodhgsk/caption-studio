import { useEffect, useRef, useState } from 'react'
import type { StorageLocation } from '../../../shared/storage'
import { useProjectStore } from '@/store/projectStore'
import Modal from '@/components/Modal'
import type { Aspect } from './aspect'

export interface NewProjectDialogProps {
  open: boolean
  onClose: () => void
  defaultAspect?: Aspect
}

const ASPECTS: readonly Aspect[] = ['16:9', '9:16', '1:1']
const FPS_OPTIONS = [24, 25, 30, 60] as const
const LANGUAGES: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'ta', label: 'Tamil' },
  { code: 'te', label: 'Telugu' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'kn', label: 'Kannada' },
  { code: 'hi', label: 'Hindi' },
  { code: 'en', label: 'English' }
]
const LOCATIONS: ReadonlyArray<{ code: StorageLocation; label: string }> = [
  { code: 'local', label: 'Local' },
  { code: 'onedrive', label: 'OneDrive' },
  { code: 'synology', label: 'Synology Drive' }
]

const fieldLabel = 'mb-1 block text-sm font-medium text-text-secondary'
const inputBase =
  'w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-text-primary outline-none focus:border-accent'

/**
 * New-Project dialog (P2.3): name, aspect, fps, default language, and storage
 * location. On Create it scaffolds via the store, applies the chosen settings,
 * refreshes the listing, then closes. Routing to the editor is P2.5.
 */
export default function NewProjectDialog({ open, onClose, defaultAspect }: NewProjectDialogProps): JSX.Element {
  const createProject = useProjectStore((s) => s.createProject)
  const nameRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState('')
  const [aspect, setAspect] = useState<Aspect>('16:9')
  const [fps, setFps] = useState<number>(30)
  const [language, setLanguage] = useState('ta')
  const [location, setLocation] = useState<StorageLocation>('local')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset to defaults and focus the first field each time the dialog opens.
  useEffect(() => {
    if (!open) return
    setName('')
    setAspect(defaultAspect ?? '16:9')
    setFps(30)
    setLanguage('ta')
    setLocation('local')
    setSubmitting(false)
    setError(null)
    const id = window.setTimeout(() => nameRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open])

  const trimmedName = name.trim()
  const canSubmit = trimmedName.length > 0 && !submitting

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    const result = await createProject({ location, name: trimmedName, aspect, fps, language })
    if (result.ok) {
      onClose()
    } else {
      setError(result.error)
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} title="New project" onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={(e) => void handleSubmit(e)}>
        <div>
          <label htmlFor="np-name" className={fieldLabel}>
            Name
          </label>
          <input
            id="np-name"
            ref={nameRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My project"
            className={inputBase}
            required
          />
        </div>

        <fieldset>
          <legend className={fieldLabel}>Aspect ratio</legend>
          <div className="flex gap-2" role="radiogroup" aria-label="Aspect ratio">
            {ASPECTS.map((value) => {
              const selected = value === aspect
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setAspect(value)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    selected
                      ? 'border-accent bg-accent text-text-primary'
                      : 'border-line bg-surface-2 text-text-secondary hover:bg-surface-0'
                  }`}
                >
                  {value}
                </button>
              )
            })}
          </div>
        </fieldset>

        <div className="flex gap-4">
          <div className="flex-1">
            <label htmlFor="np-fps" className={fieldLabel}>
              FPS
            </label>
            <select
              id="np-fps"
              value={fps}
              onChange={(e) => setFps(Number(e.target.value))}
              className={inputBase}
            >
              {FPS_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1">
            <label htmlFor="np-language" className={fieldLabel}>
              Language
            </label>
            <select
              id="np-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className={inputBase}
            >
              {LANGUAGES.map(({ code, label }) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="np-location" className={fieldLabel}>
            Storage location
          </label>
          <select
            id="np-location"
            value={location}
            onChange={(e) => setLocation(e.target.value as StorageLocation)}
            className={inputBase}
          >
            {LOCATIONS.map(({ code, label }) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line bg-surface-2 px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-0"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

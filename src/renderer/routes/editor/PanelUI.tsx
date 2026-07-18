import { type ReactNode } from 'react'

/**
 * A collapsible titled section (native `<details>`).
 * Used to group long lists of controls into expandable sections.
 */
export function Section({
  title,
  defaultOpen = true,
  children
}: {
  title: string
  defaultOpen?: boolean
  children: ReactNode
}): JSX.Element {
  return (
    <details open={defaultOpen} className="group rounded-md border border-line bg-surface-2/30">
      <summary className="flex cursor-pointer list-none items-center justify-between px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary hover:text-text-primary">
        <div className="flex items-center gap-1.5 min-w-0 flex-1 text-left">
          <span aria-hidden className="inline-block text-text-muted transition-transform group-open:rotate-90">
            ›
          </span>
          <span className="truncate">{title}</span>
        </div>
      </summary>
      <div className="flex flex-col gap-2 border-t border-line p-2">{children}</div>
    </details>
  )
}

/**
 * A titled sub-block WITHIN a section (used to group families of settings).
 * A bordered card with an uppercase title and an OPTIONAL right-aligned On/Off toggle.
 */
export function SubGroup({
  title,
  toggle,
  children
}: {
  title: string
  toggle?: { ariaLabel: string; on: boolean; onChange: (on: boolean) => void }
  children: ReactNode
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-line bg-surface-2/50 p-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{title}</h4>
        {toggle !== undefined && (
          <label className="flex items-center gap-1.5 text-[11px] text-text-secondary">
            <input
              type="checkbox"
              aria-label={toggle.ariaLabel}
              checked={toggle.on}
              onChange={(e) => toggle.onChange(e.target.checked)}
              className="h-3.5 w-3.5 shrink-0 accent-accent"
            />
            <span>{toggle.on ? 'On' : 'Off'}</span>
          </label>
        )}
      </div>
      {children}
    </div>
  )
}

/** A 1-of-N segmented toggle button block. */
export function ToggleButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex-1 rounded-sm border px-2 py-1 text-[11px] ${
        active ? 'border-accent bg-accent/20 text-text-primary' : 'border-line text-text-secondary hover:bg-surface-2'
      }`}
    >
      {children}
    </button>
  )
}

/** A labeled numeric input that emits parsed finite values only. */
export function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (v: number) => void
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-text-secondary">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(v)
        }}
        className="w-full rounded-sm border border-line bg-surface-2 px-2 py-1 text-xs text-text-primary"
      />
    </label>
  )
}

/** A labeled range slider with a right-aligned value readout + optional hint. */
export function SliderField({
  label,
  ariaLabel,
  value,
  valueText,
  min,
  max,
  step,
  onChange,
  hint
}: {
  label: string
  ariaLabel?: string
  value: number
  valueText: string
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  hint?: string
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-text-secondary">
      <span className="flex items-center justify-between">
        <span>{label}</span>
        <span className="tabular-nums text-text-muted">{valueText}</span>
      </span>
      <input
        type="range"
        aria-label={ariaLabel ?? label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(v)
        }}
        className="w-full accent-accent"
      />
      {hint !== undefined && <span className="text-[10px] text-text-muted">{hint}</span>}
    </label>
  )
}

/** A labeled color picker block (color input + hex readout). */
export function ColorRow({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px] text-text-secondary">
      <span>{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="font-mono tabular-nums uppercase text-text-muted">{value}</span>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-6 w-6 cursor-pointer rounded-sm border border-line bg-transparent p-0"
        />
      </div>
    </label>
  )
}

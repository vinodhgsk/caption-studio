import { formatTickLabel, generateTicks, timeToPx } from './scale'

interface TimeRulerProps {
  /** Total timeline duration to rule, in seconds. */
  durationSec: number
  /** Active horizontal scale, in pixels per second. */
  pxPerSec: number
  /** Project frame rate — bounds the finest tick spacing. */
  fps: number
}

/**
 * Time ruler across the top of the lanes (P3.2). Ticks + labels are computed by
 * the PURE `generateTicks` helper (constraint C) — no geometry math inline here.
 * Major ticks carry a label; minor ticks are bare. Width matches the lane track
 * area so it scrolls in lockstep with the lanes under a shared scroll container.
 */
export function TimeRuler({ durationSec, pxPerSec, fps }: TimeRulerProps): JSX.Element {
  const ticks = generateTicks(durationSec, pxPerSec, fps)
  const widthPx = timeToPx(durationSec, pxPerSec)

  return (
    <div
      className="relative h-7 shrink-0 select-none border-b border-line bg-surface-2"
      style={{ width: `${widthPx}px` }}
      role="presentation"
    >
      {ticks.map((tick) => (
        <div
          key={tick.t}
          className="absolute bottom-0 top-0"
          style={{ left: `${tick.px}px` }}
        >
          <span
            aria-hidden="true"
            className={[
              'absolute bottom-0 w-px',
              tick.major ? 'h-3 bg-text-secondary' : 'h-1.5 bg-text-muted'
            ].join(' ')}
          />
          {tick.major && (
            <span className="absolute top-0.5 left-1 whitespace-nowrap text-[10px] leading-none text-text-muted">
              {formatTickLabel(tick.t)}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

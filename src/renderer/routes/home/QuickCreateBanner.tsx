import type { Aspect } from './aspect'

export interface QuickCreateBannerProps {
  onQuickCreate: (aspect: Aspect) => void
}

interface FormatTile {
  aspect: Aspect
  label: string
  subLabel: string
  platforms: string
  /** Tailwind classes for the gradient background of the preview canvas */
  gradientClass: string
  /** Inline aspect-ratio style for the canvas shape */
  canvasStyle: React.CSSProperties
  /** Icon path: rough glyph representing this platform category */
  iconPath: string
}

const TILES: FormatTile[] = [
  {
    aspect: '16:9',
    label: '16:9  Landscape',
    subLabel: 'YouTube · Presentation · Stream',
    platforms: 'YT',
    gradientClass: 'from-blue-900/80 via-indigo-900/60 to-surface-0',
    canvasStyle: { aspectRatio: '16/9', width: '100%', maxWidth: '9rem' },
    iconPath: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z'
  },
  {
    aspect: '9:16',
    label: '9:16  Portrait',
    subLabel: 'TikTok · Shorts · Reels',
    platforms: 'TT',
    gradientClass: 'from-purple-900/80 via-pink-900/60 to-surface-0',
    canvasStyle: { aspectRatio: '9/16', width: '100%', maxWidth: '4.5rem' },
    iconPath: 'M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z'
  },
  {
    aspect: '1:1',
    label: '1:1  Square',
    subLabel: 'Instagram · Feed · Story',
    platforms: 'IG',
    gradientClass: 'from-emerald-900/80 via-teal-900/60 to-surface-0',
    canvasStyle: { aspectRatio: '1/1', width: '100%', maxWidth: '6rem' },
    iconPath: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5z'
  }
]

export default function QuickCreateBanner({ onQuickCreate }: QuickCreateBannerProps): JSX.Element {
  return (
    <section aria-label="Quick start formats" className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-text-primary">Start a new project</h2>
        <span className="text-[10px] text-text-muted">Pick a format to begin</span>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {TILES.map((tile) => (
          <button
            key={tile.aspect}
            type="button"
            onClick={() => onQuickCreate(tile.aspect)}
            className="group relative flex flex-col items-center gap-4 overflow-hidden rounded-xl border border-line bg-surface-1 px-4 py-5 text-center transition-all duration-300 hover:border-accent/60 hover:bg-surface-2 hover:shadow-2xl hover:shadow-accent/10 focus:outline-none focus:ring-2 focus:ring-accent/40"
          >
            {/* Animated gradient background glow */}
            <div className={`absolute inset-0 bg-gradient-to-b ${tile.gradientClass} opacity-0 transition-opacity duration-500 group-hover:opacity-100`} />

            {/* Platform badge — top right */}
            <span className="absolute right-3 top-3 z-10 rounded bg-white/5 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-text-muted border border-line group-hover:text-text-secondary transition-colors">
              {tile.platforms}
            </span>

            {/* Canvas preview shape */}
            <div className="relative z-10 flex items-center justify-center">
              <div
                style={tile.canvasStyle}
                className={`flex items-center justify-center rounded-md border border-white/10 bg-gradient-to-br ${tile.gradientClass} shadow-xl transition-transform duration-300 group-hover:scale-105`}
              >
                {/* Aspect watermark lines — mimicking a blank canvas */}
                <div className="absolute inset-0 flex flex-col justify-between p-2 opacity-20">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-px w-full rounded-full bg-white/40" />
                  ))}
                </div>
                <svg
                  className="relative h-6 w-6 text-white/40 group-hover:text-white/60 transition-colors"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d={tile.iconPath} />
                </svg>
              </div>
            </div>

            {/* Labels */}
            <div className="relative z-10 space-y-0.5">
              <p className="text-xs font-semibold text-text-primary group-hover:text-white transition-colors">
                {tile.label}
              </p>
              <p className="text-[10px] leading-tight text-text-muted group-hover:text-text-secondary transition-colors">
                {tile.subLabel}
              </p>
            </div>

            {/* Hover CTA */}
            <div className="relative z-10 mt-1 flex items-center gap-1 rounded-full border border-accent/0 bg-accent/0 px-3 py-1 text-[10px] font-semibold text-accent/0 transition-all duration-300 group-hover:border-accent/40 group-hover:bg-accent/10 group-hover:text-accent">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Create
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}

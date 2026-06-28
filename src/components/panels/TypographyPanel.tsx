import React, { useState, useCallback, useId } from 'react';
import { useStylerStore } from '../../store/useStylerStore';
import { LanguageCode, GradientStop } from '../../types/styler';
import {
  DEVOTIONAL_FONTS,
  DevotionalFontEntry,
  loadFont,
  getDefaultFont,
} from '../../utils/transliteration/fontConfig';
import { loadTamilCalligraphyFonts } from '../../utils/transliteration/tamilFontLoader';
import { getCanvasRegistry } from '../../utils/canvasRegistry';
import { loadFontsFromZip, loadFontFile } from '../../utils/transliteration/zipFontLoader';
import { transliterateIndic } from '../../utils/transliteration/algorithmicTransliterator';
import { cache } from 'fabric';

// ---------------------------------------------------------------------------
// Sub-component: LuxurySlider
// A premium-styled range input with a live value badge.
// ---------------------------------------------------------------------------
interface LuxurySliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  decimals?: number;
  onChange: (value: number) => void;
}

const LuxurySlider: React.FC<LuxurySliderProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  decimals = 0,
  onChange,
}) => {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  const displayVal = decimals > 0 ? value.toFixed(decimals) : Math.round(value);

  return (
    <div className="group space-y-2">
      <div className="flex items-center justify-between">
        <label
          htmlFor={id}
          className="text-[10px] font-bold tracking-widest text-slate-400 uppercase font-mono"
        >
          {label}
        </label>
        <span className="text-[11px] font-mono font-semibold text-amber-400 tabular-nums bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20">
          {displayVal}{unit}
        </span>
      </div>

      {/* Track + filled progress + thumb */}
      <div className="relative h-5 flex items-center">
        {/* Background track */}
        <div className="absolute inset-x-0 h-[3px] rounded-full bg-slate-800" />
        {/* Filled portion */}
        <div
          className="absolute h-[3px] rounded-full bg-gradient-to-r from-amber-600 to-amber-400 pointer-events-none"
          style={{ width: `${pct}%` }}
        />
        {/* Native input on top (transparent) */}
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="relative w-full h-5 appearance-none bg-transparent cursor-ew-resize
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-4
            [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-amber-400
            [&::-webkit-slider-thumb]:border-2
            [&::-webkit-slider-thumb]:border-amber-600
            [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(251,191,36,0.5)]
            [&::-webkit-slider-thumb]:transition-transform
            [&::-webkit-slider-thumb]:duration-100
            [&::-webkit-slider-thumb]:hover:scale-110
            [&::-moz-range-thumb]:w-4
            [&::-moz-range-thumb]:h-4
            [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-amber-400
            [&::-moz-range-thumb]:border-2
            [&::-moz-range-thumb]:border-amber-600
            [&::-moz-range-thumb]:cursor-ew-resize"
        />
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sub-component: SectionHeader
// ---------------------------------------------------------------------------
const SectionHeader: React.FC<{ icon: string; title: string }> = ({ icon, title }) => (
  <div className="flex items-center gap-2.5 pb-3 border-b border-slate-800/80">
    <span className="text-base">{icon}</span>
    <h3 className="text-[11px] font-bold tracking-[0.18em] text-slate-300 uppercase font-mono">
      {title}
    </h3>
  </div>
);

// ---------------------------------------------------------------------------
// Gradient Preset definitions
// ---------------------------------------------------------------------------
interface GradientPreset {
  id: string;
  name: string;
  stops: GradientStop[];
  cssPreview: string;
}

const GRADIENT_PRESETS: GradientPreset[] = [
  {
    id: 'imperial-gold',
    name: 'Imperial Gold',
    stops: [
      { offset: 0, color: '#FFF5B8' },
      { offset: 0.5, color: '#F3C63F' },
      { offset: 1, color: '#9E7810' },
    ],
    cssPreview: 'linear-gradient(to bottom, #FFF5B8, #F3C63F, #9E7810)',
  },
  {
    id: 'sacred-ruby',
    name: 'Sacred Ruby',
    stops: [
      { offset: 0, color: '#FFCDD2' },
      { offset: 0.5, color: '#E53935' },
      { offset: 1, color: '#5D0000' },
    ],
    cssPreview: 'linear-gradient(to bottom, #FFCDD2, #E53935, #5D0000)',
  },
  {
    id: 'divine-ivory',
    name: 'Divine Ivory',
    stops: [
      { offset: 0, color: '#FFFFFF' },
      { offset: 0.5, color: '#EDE9D0' },
      { offset: 1, color: '#B8A96A' },
    ],
    cssPreview: 'linear-gradient(to bottom, #FFFFFF, #EDE9D0, #B8A96A)',
  },
  {
    id: 'lotus-blush',
    name: 'Lotus Blush',
    stops: [
      { offset: 0, color: '#FFE4F3' },
      { offset: 0.5, color: '#E8598A' },
      { offset: 1, color: '#7B1140' },
    ],
    cssPreview: 'linear-gradient(to bottom, #FFE4F3, #E8598A, #7B1140)',
  },
  {
    id: 'temple-copper',
    name: 'Temple Copper',
    stops: [
      { offset: 0, color: '#FDD5A0' },
      { offset: 0.5, color: '#C2793D' },
      { offset: 1, color: '#5E2D05' },
    ],
    cssPreview: 'linear-gradient(to bottom, #FDD5A0, #C2793D, #5E2D05)',
  },
  {
    id: 'nirvana-white',
    name: 'Nirvana White',
    stops: [
      { offset: 0, color: '#FFFFFF' },
      { offset: 1, color: '#CCCCCC' },
    ],
    cssPreview: 'linear-gradient(to bottom, #FFFFFF, #CCCCCC)',
  },
];

// ---------------------------------------------------------------------------
// Text Style Preset definitions (Full Style Configs)
// ---------------------------------------------------------------------------
interface TextStylePreset {
  id: string;
  name: string;
  style: Partial<import('../../types/styler').TextStyle>;
}

const TEXT_STYLE_PRESETS: TextStylePreset[] = [
  {
    id: 'cinematic-gold',
    name: 'Cinematic Gold 3D',
    style: {
      fillColor: [
        { offset: 0, color: '#FFE67C' },
        { offset: 0.45, color: '#F1A92B' },
        { offset: 0.5, color: '#FFF8C7' },
        { offset: 0.75, color: '#D48600' },
        { offset: 1, color: '#FFC837' }
      ],
      strokeColor: '#FFE87C',
      strokeWidth: 2,
      glowColor: 'rgba(0,0,0,0.6)',
      glowBlur: 20,
      shadowOffsetX: 15,
      shadowOffsetY: 15,
      enable3D: true,
      depth3D: 25,
      depth3DColor: '#180D01',
      depth3DAngle: 105,
    }
  },
  {
    id: 'party-gold',
    name: 'Party Gold Script',
    style: {
      fillColor: [
        { offset: 0, color: '#FDE047' },
        { offset: 0.3, color: '#EAB308' },
        { offset: 0.5, color: '#FEF08A' },
        { offset: 0.8, color: '#CA8A04' },
        { offset: 1, color: '#FDE047' }
      ],
      strokeColor: '#FEF08A',
      strokeWidth: 3,
      glowColor: 'rgba(0,0,0,0.8)',
      glowBlur: 15,
      shadowOffsetX: 10,
      shadowOffsetY: 15,
      enable3D: true,
      depth3D: 20,
      depth3DColor: '#422006',
      depth3DAngle: 90,
    }
  },
  {
    id: 'flat-minimal',
    name: 'Flat Minimal',
    style: {
      fillColor: '#FFFFFF',
      strokeWidth: 0,
      glowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      enable3D: false,
      depth3D: 0,
    }
  }
];

// ---------------------------------------------------------------------------
// Main: TypographyPanel
// ---------------------------------------------------------------------------
export const TypographyPanel: React.FC = () => {
  // Store state
  const textStyle = useStylerStore((s) => s.textStyle);
  const setTextStyle = useStylerStore((s) => s.setTextStyle);
  const customFonts = useStylerStore((s) => s.customFonts);
  const addCustomFont = useStylerStore((s) => s.addCustomFont);

  // Track which gradient preset is active (null = solid fill)
  const [activePresetId, setActivePresetId] = useState<string | null>('imperial-gold');
  const [isFontLoading, setIsFontLoading] = useState(false);
  const [fontLoadError, setFontLoadError] = useState<string | null>(null);
  
  // Calligraphy toggle state for all scripts
  const [calligraphyOnly, setCalligraphyOnly] = useState(false);

  // Local state for selected font row (allows clicking a font in the list before hitting Apply)
  const [selectedFamily, setSelectedFamily] = useState<string>(textStyle.fontFamily);

  // Synchronise local selection when store fontFamily updates externally (e.g. language change or presets)
  React.useEffect(() => {
    setSelectedFamily(textStyle.fontFamily);
  }, [textStyle.fontFamily]);

  // Derive available fonts from currently selected language
  const availableFonts: DevotionalFontEntry[] = DEVOTIONAL_FONTS[textStyle.language] ?? [];

  // Filter available fonts if Calligraphy toggle is active
  const filteredFonts = calligraphyOnly
    ? availableFonts.filter((f) => f.category === 'calligraphic' || f.category === 'serif' || f.aesthetic.toLowerCase().includes('calligraphy') || f.aesthetic.toLowerCase().includes('manuscript'))
    : availableFonts;

  // Combine standard and uploaded custom fonts
  const allSelectableFonts: DevotionalFontEntry[] = [
    ...filteredFonts,
    ...customFonts.map((cf) => ({
      ...cf,
      label: cf.family,
      aesthetic: 'Custom Uploaded Font',
      weights: '400;700',
    })),
  ];

  // ── Language change ────────────────────────────────────────────────────────
  const handleLanguageChange = useCallback(
    async (lang: LanguageCode) => {
      // If calligraphy toggle is true, try to select the first calligraphy font available
      let defaultFont = getDefaultFont(lang);
      if (calligraphyOnly) {
        const langFonts = DEVOTIONAL_FONTS[lang] ?? [];
        const calligraphicFont = langFonts.find((f) => f.category === 'calligraphic' || f.category === 'serif' || f.aesthetic.toLowerCase().includes('calligraphy') || f.aesthetic.toLowerCase().includes('manuscript'));
        if (calligraphicFont) defaultFont = calligraphicFont;
      }

      setIsFontLoading(true);
      setFontLoadError(null);

      try {
        if (defaultFont.source === 'local') {
          await loadTamilCalligraphyFonts();
        } else if (defaultFont.source === 'google') {
          await loadFont(defaultFont);
        }
        
        // Transliterate the current styling content based on the new language
        const transliteratedContent = transliterateIndic(textStyle.content, textStyle.language, lang);

        setTextStyle({ 
          language: lang, 
          fontFamily: defaultFont.family,
          content: transliteratedContent
        });
        setSelectedFamily(defaultFont.family);
        
        const registry = getCanvasRegistry();
        if (registry) {
          registry.fabricCanvas.requestRenderAll();
        }
      } catch {
        setFontLoadError(`Failed to load ${defaultFont.family}`);
      } finally {
        setIsFontLoading(false);
      }
    },
    [setTextStyle, calligraphyOnly]
  );

  // ── Font family change — WebFont caching/local loading before canvas redraw ─────────────
  const handleFontChange = useCallback(
    async (fontEntry: DevotionalFontEntry) => {
      setIsFontLoading(true);
      setFontLoadError(null);

      try {
        if (fontEntry.source === 'local') {
          // Call specialized local font face injection & memory verification
          await loadTamilCalligraphyFonts();
        } else if (fontEntry.source === 'google') {
          // Google font loading
          await loadFont(fontEntry);
        } else if (fontEntry.source === 'uploaded') {
          // Force layout engine verification to warm the browser's font cache for this weight.
          // This ensures the canvas context maps immediately to the FontFace instead of using a fallback.
          const probeText = 'அன்பே சிவம் A B C';
          const weight = useStylerStore.getState().textStyle.fontWeight;
          await document.fonts.load(`${weight} 120px '${fontEntry.family}'`, probeText);
        }
        
        // Push the family into the store to trigger CanvasEditor state update
        setTextStyle({ fontFamily: fontEntry.family });

        // Explicitly clear the Fabric.js character cache and trigger redraw immediately
        const registry = getCanvasRegistry();
        if (registry) {
          cache.charWidthsCache.clear();
          registry.fabricCanvas.requestRenderAll();
        }

        // Schedule secondary redraw after 150ms to verify font is active.
        // This is a browser-safe mechanism to combat dynamic canvas font-mapping latency.
        setTimeout(() => {
          const secondaryRegistry = getCanvasRegistry();
          if (secondaryRegistry) {
            cache.charWidthsCache.clear();
            secondaryRegistry.fabricCanvas.requestRenderAll();
          }
        }, 150);

      } catch {
        setFontLoadError(`Font "${fontEntry.family}" could not be loaded.`);
      } finally {
        setIsFontLoading(false);
      }
    },
    [setTextStyle]
  );

  // ── Dynamic Font File/Package Uploader ──────────────────────────────────────
  const handleFontUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsFontLoading(true);
      setFontLoadError(null);

      try {
        const buffer = await file.arrayBuffer();
        const extension = file.name.split('.').pop()?.toLowerCase();

        let newFontFamily = '';

        if (extension === 'zip') {
          // Process Google Fonts ZIP archive
          const newFonts = await loadFontsFromZip(buffer);
          if (newFonts.length === 0) {
            throw new Error('No valid font files found in the uploaded ZIP package.');
          }
          newFonts.forEach((f) => addCustomFont(f));
          newFontFamily = newFonts[0].family;
        } else if (['ttf', 'otf', 'woff', 'woff2'].includes(extension || '')) {
          // Process single local font file directly (e.g. Tamil TTF font)
          const newFont = await loadFontFile(file.name, buffer);
          addCustomFont(newFont);
          newFontFamily = newFont.family;
        } else {
          throw new Error('Unsupported format. Please upload a .zip, .ttf, .otf, or .woff2 file.');
        }

        // Auto-select the newly registered font family locally
        setSelectedFamily(newFontFamily);
        
        // Push the family into the store
        setTextStyle({ fontFamily: newFontFamily });

        // Force a full canvas redraw immediately
        const registry = getCanvasRegistry();
        if (registry) {
          cache.charWidthsCache.clear();
          registry.fabricCanvas.requestRenderAll();
        }

        // Force secondary redraw
        setTimeout(() => {
          const secondaryRegistry = getCanvasRegistry();
          if (secondaryRegistry) {
            cache.charWidthsCache.clear();
            secondaryRegistry.fabricCanvas.requestRenderAll();
          }
        }, 150);

      } catch (err) {
        console.error(err);
        setFontLoadError(
          err instanceof Error ? err.message : 'Failed to parse and load the uploaded font file.'
        );
      } finally {
        setIsFontLoading(false);
        e.target.value = ''; // Reset input element
      }
    },
    [addCustomFont, setTextStyle]
  );

  // ── Gradient preset selection ──────────────────────────────────────────────
  const handlePresetClick = useCallback(
    (preset: GradientPreset) => {
      setActivePresetId(preset.id);
      setTextStyle({ fillColor: preset.stops });
    },
    [setTextStyle]
  );

  // ── Solid color fill ──────────────────────────────────────────────────────
  const handleSolidColor = useCallback(
    (color: string) => {
      setActivePresetId(null);
      setTextStyle({ fillColor: color });
    },
    [setTextStyle]
  );

  // ── Stroke color ──────────────────────────────────────────────────────────
  const handleStrokeColor = useCallback(
    (color: string) => setTextStyle({ strokeColor: color }),
    [setTextStyle]
  );

  // ── Glow color ────────────────────────────────────────────────────────────
  const handleGlowColor = useCallback(
    (color: string) => setTextStyle({ glowColor: color }),
    [setTextStyle]
  );

  // Resolve the solid hex shown in the color picker
  const solidFillHex =
    typeof textStyle.fillColor === 'string' ? textStyle.fillColor : '#F3C63F';

  return (
    <div className="w-full space-y-7 text-slate-100">

      {/* ── Section 0: Quick Styles ────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader icon="✨" title="Quick Style Presets" />
        <div className="grid grid-cols-2 gap-2">
          {TEXT_STYLE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => {
                setTextStyle(preset.style);
                setActivePresetId(null);
              }}
              className="px-3 py-2.5 rounded-lg border border-slate-800 bg-slate-900/50 hover:bg-amber-500/10 hover:border-amber-500/50 text-left transition-all duration-200"
            >
              <div className="text-[11px] font-bold text-slate-200 tracking-wider font-mono uppercase">
                {preset.name}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* ── Section 1: Language & Typeface ─────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader icon="🔤" title="Language & Typeface" />

        {/* Language selector */}
        <div className="space-y-1.5">
          <span className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest">
            Script Language
          </span>
          <div className="grid grid-cols-5 gap-1.5">
            {(['ta', 'hi', 'te', 'ml', 'en'] as LanguageCode[]).map((lang) => {
              const labels: Record<LanguageCode, string> = {
                ta: 'Tamil',
                hi: 'Hindi',
                te: 'Telugu',
                ml: 'Malayalam',
                en: 'English',
              };
              const scripts: Record<LanguageCode, string> = {
                ta: 'த',
                hi: 'ह',
                te: 'తె',
                ml: 'മ',
                en: 'A',
              };
              const isActive = textStyle.language === lang;
              return (
                <button
                  key={lang}
                  title={labels[lang]}
                  onClick={() => handleLanguageChange(lang)}
                  className={`flex flex-col items-center gap-1 py-2 rounded-lg border text-[9px] font-mono font-bold uppercase tracking-widest transition-all duration-150
                    ${isActive
                      ? 'bg-amber-500/15 border-amber-500/60 text-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.15)]'
                      : 'bg-slate-900 border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-400'
                    }`}
                >
                  <span className="text-base leading-none">{scripts[lang]}</span>
                  <span>{lang.toUpperCase()}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Font family selector */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest">
              Devotional Typeface
            </span>
          </div>

          {/* Calligraphy Toggle for all scripts */}
          <label className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900/50 border border-slate-800/80 cursor-pointer select-none">
            <div className="flex flex-col">
              <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest">
                Calligraphy & Manuscript Only
              </span>
              <span className="text-[9px] text-slate-600 font-mono mt-0.5">
                Filters cinematic & handwritten styles
              </span>
            </div>
            <div
              onClick={() => {
                setCalligraphyOnly((prev) => {
                  const newVal = !prev;
                  if (newVal) {
                    const firstCalligraphy = availableFonts.find((f) =>
                      f.category === 'calligraphic' || f.category === 'serif' || f.aesthetic.toLowerCase().includes('calligraphy') || f.aesthetic.toLowerCase().includes('manuscript')
                    );
                    if (firstCalligraphy) {
                      setSelectedFamily(firstCalligraphy.family);
                      handleFontChange(firstCalligraphy);
                    } else {
                      setIsFontLoading(false);
                    }
                  }
                  return newVal;
                });
              }}
              className={`w-9 h-5 rounded-full border transition-all duration-200 flex items-center px-0.5 cursor-pointer
                  ${calligraphyOnly
                    ? 'bg-amber-500/30 border-amber-500/60'
                    : 'bg-slate-950 border-slate-800'
                  }`}
              >
                <div
                  className={`w-4 h-4 rounded-full transition-all duration-200 shadow
                    ${calligraphyOnly ? 'translate-x-4 bg-amber-400' : 'translate-x-0 bg-slate-600'}`}
                />
              </div>
            </label>

          {/* Font loading overlay state */}
          {isFontLoading && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400 font-mono">
              <div className="w-3 h-3 rounded-full border border-amber-500/30 border-t-amber-500 animate-spin shrink-0" />
              Caching font glyphs…
            </div>
          )}

          {fontLoadError && (
            <p className="text-[10px] text-red-400 font-mono bg-red-500/10 border border-red-500/20 px-2 py-1.5 rounded">
              ⚠ {fontLoadError}
            </p>
          )}

          <div className="space-y-1.5">
            {allSelectableFonts.map((font) => {
              // Row is active in the list if it is selected locally
              const isSelectedLocally = selectedFamily === font.family;
              // Font is active in the store if it is what the canvas is using
              const isAppliedInStore = textStyle.fontFamily === font.family;

              return (
                <button
                  key={font.family}
                  onClick={() => setSelectedFamily(font.family)}
                  disabled={isFontLoading}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-left transition-all duration-150 disabled:opacity-40
                    ${isSelectedLocally
                      ? 'bg-amber-500/10 border-amber-500/50 shadow-[0_0_10px_rgba(251,191,36,0.1)]'
                      : 'bg-slate-900 border-slate-800 hover:border-slate-750'
                    }`}
                >
                  <div className="flex-1 pr-2">
                    <p
                      className={`text-sm font-medium leading-none ${isSelectedLocally ? 'text-amber-400' : 'text-slate-300'}`}
                      style={{ fontFamily: `'${font.family}', serif` }}
                    >
                      {font.displayName}
                    </p>
                    <p className="text-[10px] text-slate-600 mt-1 font-mono">{font.aesthetic}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isAppliedInStore && (
                      <span className="text-[9px] font-mono font-bold text-emerald-500/80 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                        ACTIVE
                      </span>
                    )}
                    {isSelectedLocally && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Apply Typeface Action Button */}
          <button
            onClick={() => {
              const fontEntry = allSelectableFonts.find((f) => f.family === selectedFamily);
              if (fontEntry) {
                handleFontChange(fontEntry);
              }
            }}
            disabled={isFontLoading || selectedFamily === textStyle.fontFamily}
            className={`w-full py-2.5 rounded-xl font-mono font-bold text-xs tracking-wider transition-all duration-200 flex items-center justify-center gap-2 border
              ${selectedFamily !== textStyle.fontFamily
                ? 'bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-black border-amber-500 shadow-[0_0_15px_rgba(251,191,36,0.25)] hover:shadow-[0_0_20px_rgba(251,191,36,0.35)] active:scale-[0.98]'
                : 'bg-slate-900/50 text-slate-500 border-slate-800 cursor-default'
              }`}
          >
            <span>✒</span>
            {selectedFamily !== textStyle.fontFamily
              ? 'APPLY SELECTED TYPEFACE'
              : 'TYPEFACE IS APPLIED'}
          </button>

          {/* Custom Google Fonts ZIP and TTF Uploader */}
          <div className="mt-4 p-3 rounded-lg border border-dashed border-slate-800 hover:border-amber-500/30 bg-slate-900/10 transition-colors">
            <div className="flex flex-col items-center justify-center text-center gap-2">
              <span className="text-xl">📁</span>
              <div className="space-y-0.5">
                <p className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">
                  Upload TTF or ZIP Package
                </p>
                <p className="text-[9px] text-slate-600 font-mono">
                  Supports custom Tamil TTF, OTF, and Google ZIP packages
                </p>
              </div>
              <label className="cursor-pointer px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-750 text-[10px] font-mono text-slate-450 transition-colors">
                UPLOAD FONT FILE
                <input
                  type="file"
                  accept=".zip,.ttf,.otf,.woff,.woff2"
                  onChange={handleFontUpload}
                  className="hidden"
                  disabled={isFontLoading}
                />
              </label>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 2: Text Layout Parameters ───────────────────────────── */}
      <section className="space-y-5">
        <SectionHeader icon="📐" title="Layout Parameters" />

        {/* Font Weight selector */}
        <div className="space-y-2">
          <span className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest">
            Font Weight
          </span>
          <div className="grid grid-cols-5 gap-1.5">
            {(['400','500','600','700','900'] as const).map((w) => {
              const labels: Record<string, string> = {
                '400': 'Regular', '500': 'Medium',
                '600': 'SemiBold', '700': 'Bold', '900': 'Black',
              };
              const isActive = textStyle.fontWeight === w;
              return (
                <button
                  key={w}
                  title={labels[w]}
                  onClick={() => setTextStyle({ fontWeight: w })}
                  className={`flex flex-col items-center gap-0.5 py-2 px-1 rounded-lg border text-[9px] font-mono transition-all duration-150
                    ${isActive
                      ? 'bg-amber-500/15 border-amber-500/60 text-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.15)]'
                      : 'bg-slate-900 border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-400'
                    }`}
                >
                  <span
                    className="text-sm leading-none"
                    style={{ fontWeight: w, fontFamily: `'${textStyle.fontFamily}', serif` }}
                  >
                    A
                  </span>
                  <span className="tracking-tight">{w}</span>
                </button>
              );
            })}
          </div>
        </div>

        <LuxurySlider
          label="Font Size"
          value={textStyle.fontSize}
          min={40}
          max={300}
          unit="px"
          onChange={(v) => setTextStyle({ fontSize: v })}
        />
        <LuxurySlider
          label="Line Height"
          value={textStyle.lineHeight}
          min={0.8}
          max={2.5}
          step={0.05}
          decimals={2}
          onChange={(v) => setTextStyle({ lineHeight: v })}
        />
        <LuxurySlider
          label="Letter Spacing"
          value={textStyle.letterSpacing}
          min={-10}
          max={50}
          unit="px"
          onChange={(v) => setTextStyle({ letterSpacing: v })}
        />
        <LuxurySlider
          label="Opacity"
          value={Math.round(textStyle.opacity * 100)}
          min={0}
          max={100}
          unit="%"
          onChange={(v) => setTextStyle({ opacity: v / 100 })}
        />

        <label className="flex items-center gap-3 cursor-pointer select-none">
          <div
            role="checkbox"
            aria-checked={textStyle.uppercase}
            tabIndex={0}
            onClick={() => setTextStyle({ uppercase: !textStyle.uppercase })}
            onKeyDown={(e) => e.key === 'Enter' && setTextStyle({ uppercase: !textStyle.uppercase })}
            className={`w-9 h-5 rounded-full border transition-all duration-200 flex items-center px-0.5 cursor-pointer
              ${textStyle.uppercase
                ? 'bg-amber-500/30 border-amber-500/60'
                : 'bg-slate-900 border-slate-700'
              }`}
          >
            <div
              className={`w-4 h-4 rounded-full transition-all duration-200 shadow
                ${textStyle.uppercase ? 'translate-x-4 bg-amber-400' : 'translate-x-0 bg-slate-600'}`}
            />
          </div>
          <span className="text-[11px] font-mono text-slate-400 uppercase tracking-widest">
            Uppercase Transform
          </span>
        </label>
      </section>

      {/* ── Section 3: 3D Extrusion Style ────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader icon="🧱" title="3D Extrusion Style" />

        {/* One-click Gold 3D preset */}
        <button
          onClick={() => setTextStyle({
            enable3D: true,
            depth3D: 10,
            depth3DColor: '#4A2800',
            depth3DAngle: 135,
            fontWeight: '700',
            fillColor: [
              { offset: 0, color: '#FFF5B8' },
              { offset: 0.5, color: '#F3C63F' },
              { offset: 1, color: '#9E7810' },
            ],
            strokeColor: '#2A1600',
            strokeWidth: 3,
            glowColor: '#FFDF7A',
            glowBlur: 18,
            shadowOffsetX: 2,
            shadowOffsetY: 2,
          })}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-950/60 to-yellow-950/40 hover:border-amber-400/50 hover:from-amber-900/60 transition-all duration-200 group"
        >
          {/* Live 3D text preview swatch */}
          <div className="shrink-0 w-10 h-10 rounded-lg bg-slate-950 border border-amber-800/40 flex items-center justify-center overflow-hidden">
            <span
              className="text-xl font-bold leading-none"
              style={{
                fontFamily: `'${textStyle.fontFamily}', serif`,
                fontWeight: 700,
                color: 'transparent',
                background: 'linear-gradient(to bottom, #FFF5B8, #F3C63F, #9E7810)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                filter: 'drop-shadow(2px 2px 0px #4A2800)',
              }}
            >
              A
            </span>
          </div>
          <div className="text-left">
            <p className="text-xs font-bold text-amber-400 font-mono tracking-wider">✦ GOLD 3D PRESET</p>
            <p className="text-[10px] text-amber-700/80 font-mono mt-0.5">Applies gradient + extrusion + glow</p>
          </div>
          <span className="ml-auto text-amber-600 group-hover:text-amber-400 transition-colors text-sm">→</span>
        </button>

        {/* Enable 3D toggle */}
        <label className="flex items-center justify-between cursor-pointer select-none py-1">
          <span className="text-[11px] font-mono text-slate-400 uppercase tracking-widest">Enable 3D Extrusion</span>
          <div
            role="checkbox"
            aria-checked={textStyle.enable3D}
            tabIndex={0}
            onClick={() => setTextStyle({ enable3D: !textStyle.enable3D })}
            onKeyDown={(e) => e.key === 'Enter' && setTextStyle({ enable3D: !textStyle.enable3D })}
            className={`w-9 h-5 rounded-full border transition-all duration-200 flex items-center px-0.5 cursor-pointer
              ${textStyle.enable3D
                ? 'bg-amber-500/30 border-amber-500/60'
                : 'bg-slate-900 border-slate-700'
              }`}
          >
            <div
              className={`w-4 h-4 rounded-full transition-all duration-200 shadow
                ${textStyle.enable3D ? 'translate-x-4 bg-amber-400' : 'translate-x-0 bg-slate-600'}`}
            />
          </div>
        </label>

        {/* 3D Controls — shown only when enabled */}
        <div
          className={`space-y-4 transition-all duration-300 overflow-hidden ${
            textStyle.enable3D ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0 pointer-events-none'
          }`}
        >
          <LuxurySlider
            label="Extrusion Depth"
            value={textStyle.depth3D}
            min={1}
            max={30}
            unit="px"
            onChange={(v) => setTextStyle({ depth3D: v })}
          />

          <LuxurySlider
            label="Extrusion Angle"
            value={textStyle.depth3DAngle}
            min={0}
            max={360}
            unit="°"
            onChange={(v) => setTextStyle({ depth3DAngle: v })}
          />

          {/* Angle visual compass */}
          <div className="flex items-center gap-3">
            <div className="relative w-12 h-12 shrink-0">
              <div className="absolute inset-0 rounded-full border border-slate-700 bg-slate-900" />
              <div
                className="absolute w-0.5 h-5 bg-amber-400 rounded-full origin-bottom"
                style={{
                  bottom: '50%',
                  left: 'calc(50% - 1px)',
                  transform: `rotate(${textStyle.depth3DAngle}deg)`,
                  transformOrigin: 'bottom center',
                  boxShadow: '0 0 6px #F3C63F',
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              </div>
            </div>
            <span className="text-[10px] font-mono text-slate-500">
              Extrudes toward{' '}
              <span className="text-amber-400">
                {textStyle.depth3DAngle >= 315 || textStyle.depth3DAngle < 45 ? 'top' :
                 textStyle.depth3DAngle < 135 ? 'right' :
                 textStyle.depth3DAngle < 225 ? 'bottom' : 'left'}
              </span>{' '}direction
            </span>
          </div>

          {/* Depth colour picker */}
          <div className="space-y-1.5">
            <span className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest">
              Depth Face Colour
            </span>
            <div className="flex items-center gap-2">
              <label className="relative cursor-pointer shrink-0">
                <input
                  type="color"
                  value={textStyle.depth3DColor}
                  onChange={(e) => setTextStyle({ depth3DColor: e.target.value })}
                  className="sr-only"
                />
                <div
                  className="w-9 h-9 rounded-lg border-2 border-slate-700 hover:border-slate-500 transition-colors"
                  style={{ backgroundColor: textStyle.depth3DColor }}
                />
              </label>
              <input
                type="text"
                value={textStyle.depth3DColor}
                onChange={(e) => setTextStyle({ depth3DColor: e.target.value })}
                maxLength={9}
                className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 focus:border-amber-500/50 focus:outline-none text-xs font-mono text-slate-300"
              />
              {/* Quick depth colour presets */}
              <div className="flex flex-col gap-1">
                {[
                  { label: 'Bronze', value: '#4A2800' },
                  { label: 'Iron',   value: '#1C1C1C' },
                  { label: 'Maroon', value: '#5D0000' },
                ].map((c) => (
                  <button
                    key={c.value}
                    title={c.label}
                    onClick={() => setTextStyle({ depth3DColor: c.value })}
                    className="w-5 h-5 rounded border border-slate-700 hover:border-amber-500/50 transition-colors"
                    style={{ backgroundColor: c.value }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 3: Fill & Gradient Paint ────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader icon="🎨" title="Fill & Gradient Paint" />

        {/* Gradient preset swatches */}
        <div className="space-y-1.5">
          <span className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest">
            Gradient Presets
          </span>
          <div className="grid grid-cols-3 gap-2">
            {GRADIENT_PRESETS.map((preset) => {
              const isActive = activePresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  onClick={() => handlePresetClick(preset)}
                  title={preset.name}
                  className={`group relative flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-all duration-150
                    ${isActive
                      ? 'border-amber-500/60 bg-amber-500/10 shadow-[0_0_10px_rgba(251,191,36,0.15)]'
                      : 'border-slate-800 bg-slate-900/50 hover:border-slate-700'
                    }`}
                >
                  {/* Gradient swatch */}
                  <div
                    className="w-full h-6 rounded"
                    style={{ background: preset.cssPreview }}
                  />
                  <span className={`text-[9px] font-mono text-center leading-tight ${isActive ? 'text-amber-400' : 'text-slate-500'}`}>
                    {preset.name}
                  </span>
                  {isActive && (
                    <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-amber-400" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Solid fill color picker */}
        <div className="space-y-1.5">
          <span className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest">
            Custom Solid Fill
          </span>
          <div className="flex items-center gap-2">
            <label className="relative cursor-pointer shrink-0">
              <input
                type="color"
                value={solidFillHex}
                onChange={(e) => handleSolidColor(e.target.value)}
                className="sr-only"
              />
              <div
                className="w-9 h-9 rounded-lg border-2 border-slate-700 hover:border-slate-500 transition-colors shadow-inner"
                style={{ backgroundColor: solidFillHex }}
              />
            </label>
            <input
              type="text"
              value={solidFillHex}
              onChange={(e) => handleSolidColor(e.target.value)}
              maxLength={9}
              placeholder="#RRGGBB"
              className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 focus:border-amber-500/50 focus:outline-none text-xs font-mono text-slate-300 placeholder-slate-700"
            />
            <button
              onClick={() => handleSolidColor(solidFillHex)}
              className="shrink-0 px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] font-mono text-slate-400 transition-colors"
            >
              APPLY
            </button>
          </div>
        </div>
      </section>

      {/* ── Section 4: Stroke Settings ───────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader icon="🖊" title="Stroke Outline" />

        <LuxurySlider
          label="Stroke Width"
          value={textStyle.strokeWidth}
          min={0}
          max={50}
          unit="px"
          onChange={(v) => setTextStyle({ strokeWidth: v })}
        />

        <div className="grid grid-cols-2 gap-3">
          {/* Stroke color picker */}
          <div className="space-y-1.5">
            <span className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest">
              Color
            </span>
            <div className="flex items-center gap-2">
              <label className="relative cursor-pointer">
                <input
                  type="color"
                  value={textStyle.strokeColor}
                  onChange={(e) => handleStrokeColor(e.target.value)}
                  className="sr-only"
                />
                <div
                  className="w-8 h-8 rounded border border-slate-700 hover:border-slate-500 transition-colors"
                  style={{ backgroundColor: textStyle.strokeColor }}
                />
              </label>
              <span className="text-[11px] font-mono text-slate-500">{textStyle.strokeColor}</span>
            </div>
          </div>

          {/* Line join selector */}
          <div className="space-y-1.5">
            <span className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest">
              Line Join
            </span>
            <div className="flex flex-col gap-1">
              {(['round', 'miter', 'bevel'] as const).map((join) => (
                <button
                  key={join}
                  onClick={() => setTextStyle({ strokeLineJoin: join })}
                  className={`px-2 py-1 rounded text-[10px] font-mono border text-left transition-colors
                    ${textStyle.strokeLineJoin === join
                      ? 'bg-amber-500/10 border-amber-500/40 text-amber-400'
                      : 'bg-slate-900 border-slate-800 text-slate-500 hover:border-slate-700'
                    }`}
                >
                  {join.charAt(0).toUpperCase() + join.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 5: Auric Glow & Shadows ─────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader icon="✨" title="Auric Glow & Shadow" />

        <LuxurySlider
          label="Glow Blur"
          value={textStyle.glowBlur}
          min={0}
          max={100}
          unit="px"
          onChange={(v) => setTextStyle({ glowBlur: v })}
        />

        <div className="space-y-1.5">
          <span className="block text-[10px] font-mono text-slate-500 uppercase tracking-widest">
            Glow Color
          </span>
          <div className="flex items-center gap-2">
            <label className="relative cursor-pointer shrink-0">
              <input
                type="color"
                value={textStyle.glowColor}
                onChange={(e) => handleGlowColor(e.target.value)}
                className="sr-only"
              />
              <div
                className="w-9 h-9 rounded-lg border border-slate-700 hover:border-slate-500 transition-colors"
                style={{
                  backgroundColor: textStyle.glowColor,
                  boxShadow: `0 0 12px ${textStyle.glowColor}66`,
                }}
              />
            </label>
            <input
              type="text"
              value={textStyle.glowColor}
              onChange={(e) => handleGlowColor(e.target.value)}
              maxLength={9}
              className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 focus:border-amber-500/50 focus:outline-none text-xs font-mono text-slate-300"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <LuxurySlider
            label="Shadow X"
            value={textStyle.shadowOffsetX}
            min={-40}
            max={40}
            unit="px"
            onChange={(v) => setTextStyle({ shadowOffsetX: v })}
          />
          <LuxurySlider
            label="Shadow Y"
            value={textStyle.shadowOffsetY}
            min={-40}
            max={40}
            unit="px"
            onChange={(v) => setTextStyle({ shadowOffsetY: v })}
          />
        </div>
      </section>

    </div>
  );
};

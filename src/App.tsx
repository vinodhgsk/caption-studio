import React, { useState } from 'react';
import { CanvasEditor } from './components/CanvasEditor';
import { TypographyPanel } from './components/panels/TypographyPanel';
import { ExportPanel } from './components/panels/ExportPanel';
import { useStylerStore } from './store/useStylerStore';
import { FlourishAsset, LanguageCode } from './types/styler';
import { transliterateIndic, detectIndicLanguage } from './utils/transliteration/algorithmicTransliterator';

// Fully offline vector SVG data URIs for devotional flourishes
const MOCK_FLOURISHES: FlourishAsset[] = [
  {
    id: 'gold_lotus',
    name: 'Mandala Lotus Leaf',
    leftSrc: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 5 C55 25, 75 35, 95 50 C75 65, 55 75, 50 95 C45 75, 25 65, 5 50 C25 35, 45 25, 50 5 Z" fill="%23F3C63F" stroke="%239E7810" stroke-width="2"/><circle cx="50" cy="50" r="10" fill="%23FFF5B8"/></svg>`,
    rightSrc: '', // Trigger auto-mirroring
    defaultScale: 1.2,
    defaultPadding: 30,
  },
  {
    id: 'auric_scroll',
    name: 'Royal Flourish Scroll',
    leftSrc: `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100"><path d="M20 50 C20 20, 80 10, 100 30 C120 50, 100 70, 80 50 C60 30, 40 40, 50 60 C55 70, 80 75, 90 60 C100 45, 90 35, 80 40" fill="none" stroke="%23F3C63F" stroke-width="6" stroke-linecap="round"/><circle cx="80" cy="50" r="8" fill="%239E7810"/></svg>`,
    rightSrc: '', // Trigger auto-mirroring
    defaultScale: 1.4,
    defaultPadding: 40,
  }
];

const BACKGROUND_PRESETS = [
  { name: 'Transparent Dark', value: null },
  { name: 'Solid White', value: 'white' },
  { name: 'Green Screen', value: '#00ff00' },
  { name: 'Imperial Crimson', value: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1920&q=80' },
  { name: 'Auric Dust Backdrop', value: 'https://images.unsplash.com/photo-1518531933037-91b2f5f229cc?w=1920&q=80' },
];

export const App: React.FC = () => {
  // Store selectors
  const canvasDimensions = useStylerStore((state) => state.canvas);
  const textStyle = useStylerStore((state) => state.textStyle);
  const activeFlourish = useStylerStore((state) => state.activeFlourish);
  const flourishConfig = useStylerStore((state) => state.flourishConfig);
  const backgroundImage = useStylerStore((state) => state.backgroundImage);
  const textChunks = useStylerStore((state) => state.textChunks);
  const currentChunkIndex = useStylerStore((state) => state.currentChunkIndex);

  // Store actions
  const setTextStyle = useStylerStore((state) => state.setTextStyle);
  const setCanvasPreset = useStylerStore((state) => state.setCanvasPreset);
  const setFlourish = useStylerStore((state) => state.setFlourish);
  const updateFlourishConfig = useStylerStore((state) => state.updateFlourishConfig);
  const setBackgroundImage = useStylerStore((state) => state.setBackgroundImage);
  const setTextChunks = useStylerStore((state) => state.setTextChunks);
  const setCurrentChunkIndex = useStylerStore((state) => state.setCurrentChunkIndex);
  const resetStore = useStylerStore((state) => state.resetStore);

  // Local tab state: 'style' | 'lyrics'
  const [activeTab, setActiveTab] = useState<'style' | 'lyrics'>('style');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [customBgName, setCustomBgName] = useState<string | null>(null);

  // Expose store and transliteration for E2E testing
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any)._useStylerStore = useStylerStore;
      (window as any)._transliterateIndic = transliterateIndic;
    }
  }, []);

  // Call API server for verse segmentation
  const handleProcessText = async () => {
    setIsProcessing(true);
    setProcessingError(null);
    try {
      const response = await fetch('http://localhost:3001/api/process-text', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: textStyle.content,
          language: textStyle.language,
          maxWords: 4,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Server returned an error status.');
      }

      const data = await response.json();
      setTextChunks(data.chunks);
      
      // Auto-preview the first chunk
      if (data.chunks.length > 0) {
        setTextStyle({ content: data.chunks[0] });
        setCurrentChunkIndex(0);
      }
    } catch (err) {
      console.error(err);
      setProcessingError(
        err instanceof Error
          ? err.message
          : 'Could not connect to Express API. Ensure the server is running on port 3001.'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle custom background image upload
  const handleBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setBackgroundImage(dataUrl);
      setCustomBgName(file.name);
    };
    reader.readAsDataURL(file);
    // Reset so the same file can be re-uploaded
    e.target.value = '';
  };

  // Remove custom background
  const handleRemoveCustomBg = () => {
    setBackgroundImage(null);
    setCustomBgName(null);
  };

  return (
    <div className="flex flex-col lg:flex-row w-full h-full bg-zinc-950 text-zinc-100 overflow-hidden font-sans">
      
      {/* Sidebar Controls Panel */}
      <div className="w-full lg:w-96 h-1/2 lg:h-full border-b lg:border-r border-zinc-800 bg-zinc-900/60 backdrop-blur-md flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="p-4 border-b border-zinc-800/80 flex items-center justify-between bg-zinc-950/80 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🪔</span>
            <div>
              <h1 className="text-xs font-bold tracking-wider uppercase text-amber-500 font-mono">Divya TextStyler</h1>
              <p className="text-[9px] text-zinc-500 font-mono">Devotional Typography Studio</p>
            </div>
          </div>
          <button 
            onClick={resetStore}
            className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[10px] font-mono font-semibold text-zinc-400 transition-colors"
          >
            RESET
          </button>
        </div>

        {/* Studio Tab Selection Bar */}
        <div className="flex border-b border-zinc-800/80 bg-zinc-950/40 shrink-0 select-none">
          <button
            onClick={() => setActiveTab('style')}
            className={`flex-1 py-3 text-[10px] font-mono font-bold tracking-wider uppercase border-b-2 transition-all duration-150
              ${activeTab === 'style'
                ? 'border-amber-500 text-amber-400 bg-amber-500/5'
                : 'border-transparent text-zinc-500 hover:text-zinc-400 hover:bg-zinc-900/30'
              }`}
          >
            🎨 Style Workbench
          </button>
          <button
            onClick={() => setActiveTab('lyrics')}
            className={`flex-1 py-3 text-[10px] font-mono font-bold tracking-wider uppercase border-b-2 transition-all duration-150
              ${activeTab === 'lyrics'
                ? 'border-amber-500 text-amber-400 bg-amber-500/5'
                : 'border-transparent text-zinc-500 hover:text-zinc-400 hover:bg-zinc-900/30'
              }`}
          >
            📝 Lyric Captions & Export
          </button>
        </div>

        {/* Tab Contents (Scrollable Container) */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          
          {/* TAB 1: STYLE WORKBENCH */}
          {activeTab === 'style' && (
            <div className="space-y-6">
              
              {/* Premium Typography Panel (Handles weight, 3D, gradients, glow, zip fonts) */}
              <TypographyPanel />

              <hr className="border-zinc-800/40" />

              {/* Symmetrical Ornament Flourishes */}
              <div className="space-y-4">
                <div className="flex items-center gap-2.5 pb-2 border-b border-slate-800/80">
                  <span className="text-base">⚜</span>
                  <h3 className="text-[11px] font-bold tracking-[0.18em] text-slate-300 uppercase font-mono">
                    Ornament Flourishes
                  </h3>
                </div>

                <div className="space-y-3">
                  <span className="block text-[10px] text-zinc-500 font-mono">FLOURISH DESIGN</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      onClick={() => setFlourish(null)}
                      className={`p-2 rounded text-[9px] font-mono border transition-colors ${
                        !activeFlourish 
                          ? 'bg-amber-500/10 border-amber-500/50 text-amber-400 font-bold' 
                          : 'bg-zinc-950 border-zinc-850 text-zinc-500 hover:border-zinc-700'
                      }`}
                    >
                      NONE
                    </button>
                    {MOCK_FLOURISHES.map((fl) => (
                      <button
                        key={fl.id}
                        onClick={() => setFlourish(fl)}
                        className={`p-2 rounded text-[9px] font-mono border transition-colors ${
                          activeFlourish?.id === fl.id 
                            ? 'bg-amber-500/10 border-amber-500/50 text-amber-400 font-bold' 
                            : 'bg-zinc-950 border-zinc-850 text-zinc-500 hover:border-zinc-700'
                        }`}
                      >
                        {fl.id === 'gold_lotus' ? 'LOTUS' : 'SCROLL'}
                      </button>
                    ))}
                  </div>
                </div>

                {activeFlourish && (
                  <div className="space-y-4 pt-1">
                    {/* Flourish Scale Slider */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[10px] font-mono">
                        <span className="text-zinc-500">SCALE MULTIPLIER</span>
                        <span className="text-amber-500">{flourishConfig.scale.toFixed(1)}x</span>
                      </div>
                      <input
                        type="range"
                        min="0.4"
                        max="2.5"
                        step="0.1"
                        value={flourishConfig.scale}
                        onChange={(e) => updateFlourishConfig({ scale: parseFloat(e.target.value) })}
                        className="w-full accent-amber-500 cursor-ew-resize bg-zinc-950 h-1 rounded"
                      />
                    </div>

                    {/* Flourish Padding Slider */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[10px] font-mono">
                        <span className="text-zinc-500">GAP FROM TEXT BOUNDS</span>
                        <span className="text-amber-500">{flourishConfig.paddingX}px</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="150"
                        value={flourishConfig.paddingX}
                        onChange={(e) => updateFlourishConfig({ paddingX: parseInt(e.target.value) })}
                        className="w-full accent-amber-500 cursor-ew-resize bg-zinc-950 h-1 rounded"
                      />
                    </div>

                    {/* Flourish Offset Y Slider */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[10px] font-mono">
                        <span className="text-zinc-500">VERTICAL ALIGN OFFSET</span>
                        <span className="text-amber-500">{flourishConfig.offsetY}px</span>
                      </div>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        value={flourishConfig.offsetY}
                        onChange={(e) => updateFlourishConfig({ offsetY: parseInt(e.target.value) })}
                        className="w-full accent-amber-500 cursor-ew-resize bg-zinc-950 h-1 rounded"
                      />
                    </div>
                  </div>
                )}
              </div>

              <hr className="border-zinc-800/40" />

              {/* Canvas Workspace Sizing & Theme */}
              <div className="space-y-5">
                <div className="flex items-center gap-2.5 pb-2 border-b border-slate-800/80">
                  <span className="text-base">🖥</span>
                  <h3 className="text-[11px] font-bold tracking-[0.18em] text-slate-300 uppercase font-mono">
                    Workspace Setup
                  </h3>
                </div>

                {/* Preset aspect ratios */}
                <div className="space-y-2">
                  <span className="block text-[10px] text-zinc-500 font-mono">ASPECT RATIO PRESET</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['16:9', '9:16', '4:5'] as const).map((pr) => (
                      <button
                        key={pr}
                        onClick={() => setCanvasPreset(pr)}
                        className={`p-2 rounded text-[9px] font-mono border transition-colors ${
                          canvasDimensions.aspectPreset === pr 
                            ? 'bg-amber-500/10 border-amber-500/50 text-amber-400 font-bold' 
                            : 'bg-zinc-950 border-zinc-850 text-zinc-550 hover:border-zinc-700'
                        }`}
                      >
                        {pr}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Background presets */}
                <div className="space-y-2">
                  <span className="block text-[10px] text-zinc-500 font-mono">BACKGROUND THEME</span>
                  <div className="grid grid-cols-1 gap-1.5">
                    {BACKGROUND_PRESETS.map((bg) => (
                      <button
                        key={bg.name}
                        onClick={() => { setBackgroundImage(bg.value); setCustomBgName(null); }}
                        className={`p-2 px-3 rounded text-xs text-left border transition-colors flex items-center justify-between ${
                          backgroundImage === bg.value && !customBgName
                            ? 'bg-amber-500/10 border-amber-500/50 text-amber-400 font-semibold' 
                            : 'bg-zinc-950 border-zinc-850 text-zinc-400 hover:border-zinc-700'
                        }`}
                      >
                        <span>{bg.name}</span>
                        <span className="text-[9px] opacity-40 font-mono">
                          {bg.value ? 'IMAGE' : 'SOLID'}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Custom Background Upload */}
                  <div className="pt-2 space-y-2">
                    <span className="block text-[10px] text-zinc-500 font-mono">CUSTOM BACKGROUND</span>

                    {/* Upload area */}
                    <label
                      className={`flex flex-col items-center justify-center gap-1.5 p-4 rounded-lg border-2 border-dashed cursor-pointer transition-all duration-200 ${
                        customBgName
                          ? 'border-amber-500/40 bg-amber-500/5'
                          : 'border-zinc-700 bg-zinc-950 hover:border-amber-500/30 hover:bg-amber-500/5'
                      }`}
                    >
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
                        onChange={handleBgUpload}
                        className="hidden"
                      />
                      {!customBgName ? (
                        <>
                          <span className="text-xl">🖼️</span>
                          <span className="text-[10px] text-zinc-400 font-mono text-center">
                            Click to upload background image
                          </span>
                          <span className="text-[9px] text-zinc-600 font-mono">
                            PNG · JPEG · WEBP · GIF
                          </span>
                        </>
                      ) : (
                        <>
                          {/* Thumbnail preview */}
                          {backgroundImage && (
                            <img
                              src={backgroundImage}
                              alt="Custom background"
                              className="w-full h-20 object-cover rounded border border-zinc-700"
                            />
                          )}
                          <span className="text-[10px] text-amber-400 font-mono truncate max-w-full">
                            ✅ {customBgName}
                          </span>
                          <span className="text-[9px] text-zinc-500 font-mono">
                            Click to replace
                          </span>
                        </>
                      )}
                    </label>

                    {/* Remove button */}
                    {customBgName && (
                      <button
                        onClick={handleRemoveCustomBg}
                        className="w-full p-2 rounded text-[10px] font-mono font-semibold text-red-400 border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 transition-colors flex items-center justify-center gap-1.5"
                      >
                        <span>✕</span> REMOVE CUSTOM BACKGROUND
                      </button>
                    )}
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* TAB 2: CAPTION SPLITTING & EXPORT */}
          {activeTab === 'lyrics' && (
            <div className="space-y-6">
              
              {/* Lyrics Processor Block */}
              <div className="space-y-4">
                <div className="flex items-center gap-2.5 pb-2 border-b border-slate-800/80">
                  <span className="text-base">📝</span>
                  <h3 className="text-[11px] font-bold tracking-[0.18em] text-slate-300 uppercase font-mono">
                    Lyric Segmentation
                  </h3>
                </div>

                <div className="space-y-3">
                  <span className="block text-[10px] text-zinc-500 font-mono">
                    PASTE POETRIC VERSE BLOCK
                  </span>
                  <textarea
                    value={textStyle.content}
                    onChange={(e) => {
                      const newText = e.target.value;
                      const detectedLang = detectIndicLanguage(newText);
                      setTextStyle({ 
                        content: newText,
                        language: detectedLang || textStyle.language 
                      });
                    }}
                    className="w-full min-h-[140px] p-3 rounded-lg bg-zinc-950 border border-zinc-850 focus:border-amber-600/70 focus:outline-none text-xs text-zinc-200 resize-none font-medium leading-relaxed font-mono"
                    placeholder="உதாரணம்:&#10;அன்பே சிவம் என்று நம்பும் உலகம்&#10;அவனே இறைவன் என்பார்..."
                  />

                  {/* Language hint selection */}
                  <div className="space-y-1.5">
                    <span className="block text-[10px] text-zinc-500 font-mono">LANGUAGE HINT</span>
                    <select
                      value={textStyle.language}
                      onChange={(e) => {
                        const newLang = e.target.value as LanguageCode;
                        const transliterated = transliterateIndic(textStyle.content, textStyle.language, newLang);
                        setTextStyle({ 
                          language: newLang,
                          content: transliterated
                        });
                      }}
                      className="w-full p-2 rounded bg-zinc-950 border border-zinc-850 text-xs text-zinc-300 focus:outline-none font-mono"
                    >
                      <option value="ta">Tamil (தமிழ்)</option>
                      <option value="hi">Hindi (हिन्दी)</option>
                      <option value="te">Telugu (తెలుగు)</option>
                      <option value="ml">Malayalam (മലയാളം)</option>
                      <option value="en">English (EN)</option>
                    </select>
                  </div>

                  {/* Parse error feedback */}
                  {processingError && (
                    <div className="p-3 rounded bg-red-500/10 border border-red-500/25 text-[10px] font-mono text-red-400">
                      ⚠ {processingError}
                    </div>
                  )}

                  {/* Process Action Button */}
                  <button
                    onClick={handleProcessText}
                    disabled={isProcessing}
                    className={`w-full py-2.5 rounded-lg text-xs font-mono font-bold tracking-wider transition-all duration-200 flex items-center justify-center gap-2
                      ${isProcessing
                        ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                        : 'bg-amber-500 hover:bg-amber-400 text-black hover:shadow-[0_0_15px_rgba(251,191,36,0.3)] active:scale-[0.98]'
                      }`}
                  >
                    {isProcessing ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-slate-600 border-t-slate-400 rounded-full animate-spin" />
                        SEGMENTING VERSE BLOCK...
                      </>
                    ) : (
                      <>
                        <span>🪔</span>
                        GENERATE CAPTION CHUNKS
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Segmented Chunks Preview */}
              {textChunks.length > 0 && (
                <div className="space-y-3">
                  <span className="block text-[10px] text-zinc-500 font-mono">
                    PARSED SEQUENTIAL LINES ({textChunks.length})
                  </span>
                  <div className="max-h-56 overflow-y-auto border border-zinc-850 rounded-lg bg-zinc-950/40 font-mono text-xs divide-y divide-zinc-900/60 custom-scrollbar">
                    {textChunks.map((chunk, index) => {
                      const isActive = index === currentChunkIndex;
                      return (
                        <button
                          key={index}
                          onClick={() => {
                            setCurrentChunkIndex(index);
                            setTextStyle({ content: chunk });
                          }}
                          className={`w-full text-left px-3 py-2 transition-colors flex items-center justify-between ${
                            isActive
                              ? 'bg-amber-500/10 text-amber-400 font-semibold'
                              : 'text-zinc-400 hover:bg-zinc-900/50'
                          }`}
                        >
                          <span className="truncate flex-1 pr-2">
                            {index + 1}. {chunk}
                          </span>
                          {isActive && (
                            <span className="text-[10px] text-amber-500/60 uppercase shrink-0">
                              Previewing
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <hr className="border-zinc-800/40" />

              {/* Sequential 4K Export Panel */}
              <ExportPanel />

            </div>
          )}

        </div>
      </div>

      {/* Main Devotional Composition Workspace */}
      <div className="flex-1 h-1/2 lg:h-full relative bg-zinc-950 flex flex-col">
        {/* Top bar info */}
        <div className="px-6 py-4 border-b border-zinc-900 bg-zinc-950 flex items-center justify-between z-10 select-none">
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 font-mono">WORKBENCH</span>
            <span className="text-xs text-zinc-400">Layer View: 0 (Background) &rarr; 1 (Text) &rarr; 2 (Flourish)</span>
          </div>
          <span className="text-[10px] font-mono text-zinc-650">NATIVE 4K RESOLUTION SAFE EXPORT (3840×2160)</span>
        </div>

        {/* Canvas Render viewport */}
        <div className="flex-1 min-h-0 relative">
          <CanvasEditor />
        </div>
      </div>

    </div>
  );
};

export default App;

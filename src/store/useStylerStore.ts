import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { ProjectState, TextStyle, FlourishAsset, CanvasDimensions, FontConfiguration } from '../types/styler';
import { MotionConfig } from '../types/transitions';

// Define the action methods interface
export interface StylerActions {
  setTextStyle: (style: Partial<TextStyle>) => void;
  setCanvasPreset: (preset: '16:9' | '9:16' | '4:5') => void;
  setFlourish: (flourish: FlourishAsset | null) => void;
  updateFlourishConfig: (config: Partial<ProjectState['flourishConfig']>) => void;
  setBackgroundImage: (src: string | null) => void;
  setTextChunks: (chunks: string[]) => void;
  setCurrentChunkIndex: (index: number) => void;
  addCustomFont: (font: FontConfiguration) => void;
  setMotionConfig: (config: Partial<MotionConfig>) => void;
  setActiveLanguageTrack: (lang: import('../types/styler').LanguageCode) => void;
  updateTrackText: (blockId: string, lang: import('../types/styler').LanguageCode, newText: string) => void;
  setSubtitleBlocks: (blocks: import('../types/timeline').SubtitleBlock[]) => void;
  resetStore: () => void;
}

// Combine state and action types for the complete store type
export type StylerStore = ProjectState & StylerActions;

// Concrete default configuration values
const DEFAULT_TEXT_STYLE: TextStyle = {
  content: 'அன்பே சிவம்', // Hindi: "Hope", matching the reference image
  language: 'ta',
  fontFamily: 'Kavivanar', // Use existing default or another font if available
  fontWeight: '700',
  fontSize: 160,
  lineHeight: 1.2,
  letterSpacing: 0,
  fillColor: [
    { offset: 0, color: '#FFE67C' },
    { offset: 0.45, color: '#F1A92B' },
    { offset: 0.5, color: '#FFF8C7' },
    { offset: 0.75, color: '#D48600' },
    { offset: 1, color: '#FFC837' }
  ],
  strokeColor: '#FFE87C',
  strokeWidth: 2,
  strokeLineJoin: 'round',
  glowColor: 'rgba(0,0,0,0.6)',
  glowBlur: 20,
  shadowOffsetX: 15,
  shadowOffsetY: 15,
  opacity: 1,
  uppercase: false,
  // Gold 3D defaults
  enable3D: true,
  depth3D: 25,
  depth3DColor: '#180D01',
  depth3DAngle: 105,
};

const DEFAULT_CANVAS: CanvasDimensions = {
  width: 3840, // 4K resolution width
  height: 2160, // 4K resolution height
  scaleFactor: 1.0,
  aspectPreset: '16:9',
};

const INITIAL_STATE: ProjectState = {
  canvas: DEFAULT_CANVAS,
  textStyle: DEFAULT_TEXT_STYLE,
  activeFlourish: null,
  flourishConfig: {
    scale: 1.0,
    paddingX: 20,
    offsetY: 0,
    syncLeftRight: true,
  },
  backgroundImage: '#1B1E36', // Dark blue/slate background
  currentChunkIndex: 0,
  textChunks: [],
  isLoading: false,
  customFonts: [],
  activeMotionConfig: {
    inDuration: 1500,
    outDuration: 1500,
    type: 'KARAOKE_FILL',
    karaokeActiveColor: '#FFDF7A',
    karaokeInactiveColor: '#88888880',
  },
  activeLanguageTrack: 'ta',
  subtitleBlocks: [],
};

// Map presets to their corresponding 4K-class aspect ratio dimensions
const getPresetDimensions = (preset: '16:9' | '9:16' | '4:5'): { width: number; height: number } => {
  switch (preset) {
    case '16:9':
      return { width: 3840, height: 2160 };
    case '9:16':
      return { width: 2160, height: 3840 };
    case '4:5':
      return { width: 2160, height: 2700 }; // 4:5 aspect ratio based on a 2160px width base
    default:
      return { width: 3840, height: 2160 };
  }
};

export const useStylerStore = create<StylerStore>()(
  devtools(
    (set) => ({
      ...INITIAL_STATE,

      setTextStyle: (style) =>
        set(
          (state) => ({
            textStyle: {
              ...state.textStyle,
              ...style,
            },
          }),
          false,
          'setTextStyle'
        ),

      setCanvasPreset: (preset) =>
        set(
          (state) => {
            const { width, height } = getPresetDimensions(preset);
            return {
              canvas: {
                ...state.canvas,
                width,
                height,
                aspectPreset: preset,
              },
            };
          },
          false,
          'setCanvasPreset'
        ),

      setFlourish: (flourish) =>
        set(
          {
            activeFlourish: flourish,
          },
          false,
          'setFlourish'
        ),

      updateFlourishConfig: (config) =>
        set(
          (state) => ({
            flourishConfig: {
              ...state.flourishConfig,
              ...config,
            },
          }),
          false,
          'updateFlourishConfig'
        ),

      setBackgroundImage: (src) =>
        set(
          {
            backgroundImage: src,
          },
          false,
          'setBackgroundImage'
        ),

      setTextChunks: (chunks) =>
        set(
          {
            textChunks: chunks,
          },
          false,
          'setTextChunks'
        ),

      setCurrentChunkIndex: (index) =>
        set(
          {
            currentChunkIndex: index,
          },
          false,
          'setCurrentChunkIndex'
        ),

      addCustomFont: (font) =>
        set(
          (state) => ({
            customFonts: [...state.customFonts, font],
          }),
          false,
          'addCustomFont'
        ),

      setMotionConfig: (config) =>
        set(
          (state) => ({
            activeMotionConfig: {
              ...state.activeMotionConfig,
              ...config,
            },
          }),
          false,
          'setMotionConfig'
        ),

      setActiveLanguageTrack: (lang) =>
        set(
          { activeLanguageTrack: lang },
          false,
          'setActiveLanguageTrack'
        ),

      setSubtitleBlocks: (blocks) =>
        set(
          { subtitleBlocks: blocks },
          false,
          'setSubtitleBlocks'
        ),

      updateTrackText: (blockId, lang, newText) =>
        set(
          (state) => {
            const blocks = state.subtitleBlocks.map((block) => {
              if (block.id !== blockId) return block;
              
              const existingTrack = block.tracks[lang] || { wordTimings: [] };
              return {
                ...block,
                tracks: {
                  ...block.tracks,
                  [lang]: {
                    ...existingTrack,
                    text: newText,
                  },
                },
              };
            });
            return { subtitleBlocks: blocks };
          },
          false,
          'updateTrackText'
        ),

      resetStore: () =>
        set(
          {
            ...INITIAL_STATE,
          },
          false,
          'resetStore'
        ),
    }),
    { name: 'DivyaTextStylerStore' }
  )
);

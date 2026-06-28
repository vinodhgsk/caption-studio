import { MotionConfig } from './transitions';
import { SubtitleBlock } from './timeline';

export type LanguageCode = 'en' | 'ta' | 'te' | 'ml' | 'hi';

export interface FontConfiguration {
  family: string;
  displayName: string;
  category: 'calligraphic' | 'traditional' | 'serif';
  source: 'google' | 'local' | 'uploaded';
  url?: string;
  encoding?: 'unicode' | 'bamini' | 'tab' | 'tam';
}

export interface GradientStop {
  offset: number;
  color: string;
}

export interface TextStyle {
  content: string;
  language: LanguageCode;
  fontFamily: string;
  fontWeight: string;           // '400' | '600' | '700' | '800' | '900'
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  fillColor: string | GradientStop[];
  strokeColor: string;
  strokeWidth: number;
  strokeLineJoin: 'round' | 'miter' | 'bevel';
  glowColor: string;
  glowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  opacity: number;
  uppercase: boolean;
  // ── 3D Extrusion ────────────────────────────────────────────────────
  enable3D: boolean;
  depth3D: number;              // extrusion depth in canvas-space pixels (1–30)
  depth3DColor: string;         // colour of the extruded depth face
  depth3DAngle: number;         // extrusion direction in degrees (0–360)
}

export interface FlourishAsset {
  id: string;
  name: string;
  leftSrc: string;
  rightSrc: string;
  defaultScale: number;
  defaultPadding: number;
}

export interface CanvasDimensions {
  width: number;
  height: number;
  scaleFactor: number;
  aspectPreset: '16:9' | '9:16' | '4:5';
}

export interface ProjectState {
  canvas: CanvasDimensions;
  textStyle: TextStyle;
  activeFlourish: FlourishAsset | null;
  flourishConfig: {
    scale: number;
    paddingX: number;
    offsetY: number;
    syncLeftRight: boolean;
  };
  backgroundImage: string | null;
  currentChunkIndex: number;
  textChunks: string[];
  isLoading: boolean;
  customFonts: FontConfiguration[];
  activeMotionConfig: MotionConfig;
  
  // Multi-Track Subtitle System
  activeLanguageTrack: LanguageCode;
  subtitleBlocks: SubtitleBlock[];
}

import { LanguageCode } from './styler';

export interface WordTiming {
  word: string;
  startIndex: number;
  endIndex: number;
  timestampMs: number;
}

export interface SubtitleBlock {
  id: string;
  startTime: number;
  endTime: number;
  tracks: Partial<Record<LanguageCode, { text: string; wordTimings: WordTiming[] }>>;
}

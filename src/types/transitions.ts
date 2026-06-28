export type TransitionType = 'TEMPLE_REVEAL' | 'ETHEREAL_BLUR' | 'KARAOKE_FILL';

export interface MotionConfig {
  inDuration: number;
  outDuration: number;
  type: TransitionType;
  karaokeActiveColor: string;
  karaokeInactiveColor: string;
}

import type { UserRequirements } from '@/lib/types/generation';

export interface ComicPanelSpec {
  index: number;
  title: string;
  prompt: string;
  caption?: string;
  dialogue?: string;
  aspectRatio?: string;
}

export interface ComicGeneratedPage {
  pageIndex: number;
  title: string;
  panels: ComicPanelSpec[];
  imageUrl?: string;
  ttsText?: string;
  ttsAudioUrl?: string;
  ttsSegments?: ComicTTSSegment[];
  error?: string;
}

export interface ComicTTSSegment {
  panelIndex: number;
  speaker: string;
  text: string;
  voice?: string;
  audioUrl?: string;
}

export interface ComicSessionState {
  sessionId: string;
  requirements: UserRequirements;
  pages: ComicGeneratedPage[] | null;
  currentStep: 'generating' | 'complete';
  agents?: Array<{ id: string; name: string; role: string; persona?: string }>;
}

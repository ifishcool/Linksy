'use client';

import { useRef, useState } from 'react';
import { Loader2, Mic, MicOff, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAudioRecorder } from '@/lib/hooks/use-audio-recorder';
import { useI18n } from '@/lib/hooks/use-i18n';
import { toast } from 'sonner';
import { useSettingsStore } from '@/lib/store/settings';
import type { DiscussionAction } from '@/lib/types/action';
import type { EngineMode, PlaybackView } from '@/lib/playback';
import type { Participant } from '@/lib/types/roundtable';

export interface DiscussionRequest {
  topic: string;
  prompt?: string;
  agentId?: string;
}

interface RoundtableProps {
  readonly mode?: 'playback' | 'autonomous';
  readonly initialParticipants?: Participant[];
  readonly playbackView?: PlaybackView;
  readonly currentSpeech?: string | null;
  readonly lectureSpeech?: string | null;
  readonly idleText?: string | null;
  readonly playbackCompleted?: boolean;
  readonly discussionRequest?: DiscussionAction | null;
  readonly engineMode?: EngineMode;
  readonly isStreaming?: boolean;
  readonly sessionType?: 'qa' | 'discussion';
  readonly speakingAgentId?: string | null;
  readonly speechProgress?: number | null;
  readonly showEndFlash?: boolean;
  readonly endFlashSessionType?: 'qa' | 'discussion';
  readonly thinkingState?: { stage: string; agentId?: string } | null;
  readonly isCueUser?: boolean;
  readonly isTopicPending?: boolean;
  readonly onMessageSend?: (message: string) => void;
  readonly onDiscussionStart?: (request: DiscussionAction) => void;
  readonly onDiscussionSkip?: () => void;
  readonly onStopDiscussion?: () => void;
  readonly onInputActivate?: () => void;
  readonly onResumeTopic?: () => void;
  readonly onPlayPause?: () => void;
  readonly isDiscussionPaused?: boolean;
  readonly onDiscussionPause?: () => void;
  readonly onDiscussionResume?: () => void;
  readonly totalActions?: number;
  readonly currentActionIndex?: number;
  readonly currentSceneIndex?: number;
  readonly scenesCount?: number;
  readonly whiteboardOpen?: boolean;
  readonly sidebarCollapsed?: boolean;
  readonly chatCollapsed?: boolean;
  readonly onToggleSidebar?: () => void;
  readonly onToggleChat?: () => void;
  readonly onPrevSlide?: () => void;
  readonly onNextSlide?: () => void;
  readonly onWhiteboardClose?: () => void;
}

export function Roundtable({
  onMessageSend,
  onInputActivate,
  mode: _mode,
  initialParticipants: _initialParticipants,
  playbackView: _playbackView,
  currentSpeech: _currentSpeech,
  lectureSpeech: _lectureSpeech,
  idleText: _idleText,
  playbackCompleted: _playbackCompleted,
  discussionRequest: _discussionRequest,
  engineMode: _engineMode,
  isStreaming: _isStreaming,
  sessionType: _sessionType,
  speakingAgentId: _speakingAgentId,
  speechProgress: _speechProgress,
  showEndFlash: _showEndFlash,
  endFlashSessionType: _endFlashSessionType,
  thinkingState: _thinkingState,
  isCueUser,
  isTopicPending: _isTopicPending,
  onDiscussionStart: _onDiscussionStart,
  onDiscussionSkip: _onDiscussionSkip,
  onStopDiscussion: _onStopDiscussion,
  onResumeTopic: _onResumeTopic,
  onPlayPause: _onPlayPause,
  isDiscussionPaused: _isDiscussionPaused,
  onDiscussionPause: _onDiscussionPause,
  onDiscussionResume: _onDiscussionResume,
  totalActions: _totalActions,
  currentActionIndex: _currentActionIndex,
  currentSceneIndex: _currentSceneIndex,
  scenesCount: _scenesCount,
  whiteboardOpen: _whiteboardOpen,
  sidebarCollapsed: _sidebarCollapsed,
  chatCollapsed: _chatCollapsed,
  onToggleSidebar: _onToggleSidebar,
  onToggleChat: _onToggleChat,
  onPrevSlide: _onPrevSlide,
  onNextSlide: _onNextSlide,
  onWhiteboardClose: _onWhiteboardClose,
}: RoundtableProps) {
  const { t } = useI18n();
  const asrEnabled = useSettingsStore((state) => state.asrEnabled);

  const [inputValue, setInputValue] = useState('');
  const [isVoiceOpen, setIsVoiceOpen] = useState(false);
  const [isSendCooldown, setIsSendCooldown] = useState(false);
  const isSendCooldownRef = useRef(false);

  const { isRecording, isProcessing, startRecording, stopRecording } = useAudioRecorder({
    onTranscription: (text) => {
      if (!text.trim()) {
        toast.info(t('roundtable.noSpeechDetected'));
        setIsVoiceOpen(false);
        return;
      }
      if (isSendCooldownRef.current) {
        setIsVoiceOpen(false);
        return;
      }
      onMessageSend?.(text);
      setIsSendCooldown(true);
      isSendCooldownRef.current = true;
      setIsVoiceOpen(false);
      setTimeout(() => {
        setIsSendCooldown(false);
        isSendCooldownRef.current = false;
      }, 1200);
    },
    onError: (error) => {
      toast.error(error);
    },
  });

  const handleSendMessage = () => {
    if (!inputValue.trim() || isSendCooldown) return;
    onMessageSend?.(inputValue.trim());
    setInputValue('');
    setIsSendCooldown(true);
    isSendCooldownRef.current = true;
    setTimeout(() => {
      setIsSendCooldown(false);
      isSendCooldownRef.current = false;
    }, 1200);
  };

  const handleToggleVoice = () => {
    if (isVoiceOpen) {
      if (isRecording) stopRecording();
      setIsVoiceOpen(false);
      return;
    }
    if (isSendCooldown || !asrEnabled) return;
    onInputActivate?.();
    setIsVoiceOpen(true);
    startRecording();
  };

  return (
    <div className="h-[80px] w-full relative z-10 border-t-[5px] border-slate-900/90 bg-[#ffd449]">
      <div className="h-full px-3.5 flex items-center gap-2.5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleToggleVoice();
          }}
          disabled={!asrEnabled || isSendCooldown}
          className={cn(
            'shrink-0 w-10 h-10 rounded-xl border-[5px] border-slate-900/85 flex items-center justify-center transition-all active:scale-95',
            !asrEnabled || isSendCooldown
              ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
              : isVoiceOpen
                ? 'bg-orange-500 text-white'
                : 'bg-white text-slate-700 hover:bg-orange-50 hover:text-orange-600',
          )}
        >
          {asrEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
        </button>

        <div
          className={cn(
            'flex-1 rounded-xl border-[5px] px-3.5 py-1.5 flex items-center transition-colors',
            isCueUser
              ? 'border-emerald-500 bg-emerald-50/80 ring-2 ring-emerald-300/70'
              : 'border-slate-900/85 bg-white',
          )}
        >
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onFocus={() => onInputActivate?.()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder={t('roundtable.inputPlaceholder')}
            rows={1}
            className={cn(
              'w-full resize-none bg-transparent border-none focus:ring-0 focus:outline-none outline-none shadow-none ring-0 text-sm h-6 min-h-0 leading-6',
              isCueUser
                ? 'text-emerald-700 placeholder:text-emerald-500/80'
                : 'text-slate-700 placeholder:text-slate-400',
            )}
          />
        </div>

        <button
          onClick={handleSendMessage}
          disabled={!inputValue.trim() || isSendCooldown}
          className={cn(
            'shrink-0 h-10 px-4.5 text-white rounded-xl transition border-[5px] border-slate-900/85 font-black active:scale-95',
            !inputValue.trim() || isSendCooldown
              ? 'bg-slate-400 cursor-not-allowed'
              : 'bg-[#ff7f3f] hover:brightness-95',
          )}
        >
          {isSendCooldown ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>

      {isVoiceOpen && (
        <div className="absolute right-3.5 -top-7 rounded-full border-[4px] border-slate-900/75 bg-white px-2.5 py-1 text-[11px] font-bold text-orange-600">
          {isProcessing ? t('roundtable.processing') : t('roundtable.listening')}
        </div>
      )}
    </div>
  );
}

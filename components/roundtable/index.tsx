'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, MessageSquare, Mic, MicOff, Send, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAudioRecorder } from '@/lib/hooks/use-audio-recorder';
import { useI18n } from '@/lib/hooks/use-i18n';
import { toast } from 'sonner';
import { useSettingsStore } from '@/lib/store/settings';
import type { DiscussionAction } from '@/lib/types/action';
import type { EngineMode, PlaybackView } from '@/lib/playback';
import type { Participant } from '@/lib/types/roundtable';
import { AvatarDisplay } from '@/components/ui/avatar-display';

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
  const [activePanel, setActivePanel] = useState<'text' | 'voice' | null>(null);
  const [isVoiceOpen, setIsVoiceOpen] = useState(false);
  const [isSendCooldown, setIsSendCooldown] = useState(false);
  const isSendCooldownRef = useRef(false);
  const userAvatar =
    _initialParticipants?.find((participant) => participant.role === 'user')?.avatar ||
    '/avatars/user.png';

  const { isRecording, isProcessing, recordingTime, startRecording, stopRecording, cancelRecording } =
    useAudioRecorder({
      onTranscription: (text) => {
        if (!text.trim()) {
          toast.info(t('roundtable.noSpeechDetected'));
          setIsVoiceOpen(false);
          setActivePanel(null);
          return;
        }
        if (isSendCooldownRef.current) {
          setIsVoiceOpen(false);
          setActivePanel(null);
          return;
        }
        onInputActivate?.();
        onMessageSend?.(text);
        setIsSendCooldown(true);
        isSendCooldownRef.current = true;
        setIsVoiceOpen(false);
        setActivePanel(null);
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
    onInputActivate?.();
    onMessageSend?.(inputValue.trim());
    setInputValue('');
    setActivePanel(null);
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
      setActivePanel(null);
      return;
    }
    if (isSendCooldown || !asrEnabled) return;
    setActivePanel('voice');
    setIsVoiceOpen(true);
    startRecording();
  };

  const openTextPanel = () => {
    if (isVoiceOpen && isRecording) {
      stopRecording();
      setIsVoiceOpen(false);
    }
    setActivePanel('text');
  };

  const closeActivePanel = () => {
    if (activePanel === 'voice' && isVoiceOpen) {
      if (isRecording) {
        cancelRecording();
      }
      setIsVoiceOpen(false);
      setActivePanel(null);
      return;
    }
    if (activePanel === 'voice' && isProcessing) {
      return;
    }
    setIsVoiceOpen(false);
    setActivePanel(null);
  };

  const prevRecordingRef = useRef(false);
  const prevCueUserRef = useRef(false);

  const playRecordingCue = (type: 'start' | 'stop') => {
    if (typeof window === 'undefined') return;
    const AudioContextClass =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.value = type === 'start' ? 860 : 540;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
    oscillator.start(now);
    oscillator.stop(now + 0.12);
    oscillator.onended = () => void ctx.close();
  };

  useEffect(() => {
    if (isRecording && !prevRecordingRef.current) {
      playRecordingCue('start');
    }
    if (!isRecording && prevRecordingRef.current) {
      playRecordingCue('stop');
    }
    prevRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    const shouldAutoStart =
      !!isCueUser &&
      !prevCueUserRef.current &&
      asrEnabled &&
      !isSendCooldownRef.current &&
      !isRecording &&
      !isProcessing;

    if (shouldAutoStart) {
      setActivePanel('voice');
      setIsVoiceOpen(true);
      startRecording();
    }

    prevCueUserRef.current = !!isCueUser;
  }, [asrEnabled, isCueUser, isProcessing, isRecording, startRecording]);

  const recordingTimeLabel = `${Math.floor(recordingTime / 60)
    .toString()
    .padStart(2, '0')}:${(recordingTime % 60).toString().padStart(2, '0')}`;

  return (
    <div className="h-0 w-full relative z-20 pointer-events-none">
      <div className="absolute right-3 bottom-3 flex justify-end px-1">
        <div
          className={cn(
            'pointer-events-auto flex items-center gap-2 rounded-full border-[4px] border-slate-900/85 bg-[#fff8db] px-3 py-2 shadow-[0_4px_0_rgba(15,23,42,0.18)] transition-all',
            activePanel ? 'w-[min(520px,calc(100vw-1.5rem))] justify-between' : 'w-auto',
            isCueUser && 'bg-emerald-100',
          )}
        >
          {!activePanel ? (
            <>
              <button
                type="button"
                onClick={handleToggleVoice}
                disabled={!asrEnabled || isSendCooldown}
                className={cn(
                  'relative inline-flex h-10 w-10 items-center justify-center rounded-full transition-all',
                  !asrEnabled || isSendCooldown
                    ? 'text-slate-300 cursor-not-allowed'
                    : 'text-slate-700 hover:bg-orange-100 hover:text-orange-600 active:scale-95',
                )}
              >
                {asrEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
              </button>

              <div className="h-6 w-px bg-slate-900/15" />

              <button
                type="button"
                onClick={openTextPanel}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-700 transition-all hover:bg-sky-100 hover:text-sky-700 active:scale-95"
              >
                <MessageSquare className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={openTextPanel}
                className="ml-1 inline-flex h-11 w-11 items-center justify-center rounded-full border-[3px] border-slate-900/85 bg-white shadow-[0_2px_0_rgba(15,23,42,0.12)] transition-transform hover:scale-[1.03]"
              >
                <span className="h-8 w-8 overflow-hidden rounded-full border-2 border-sky-300/80 bg-white">
                  <AvatarDisplay src={userAvatar} alt={t('roundtable.you')} />
                </span>
              </button>
            </>
          ) : (
            <>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {activePanel === 'text' ? (
                  <div
                    className={cn(
                      'flex min-w-0 flex-1 items-center rounded-full border px-3 py-2 transition-colors',
                      isCueUser
                        ? 'border-emerald-400 bg-emerald-50/90'
                        : 'border-slate-200 bg-slate-50/90',
                    )}
                  >
                    <textarea
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
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
                ) : (
                  <>
                    <div className="min-w-0 flex-1 rounded-full border border-orange-200 bg-orange-50/90 px-3 py-2">
                      <div className="flex items-center gap-3 text-sm font-semibold text-orange-700">
                        <div className="flex h-6 items-end gap-1">
                          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                            <span
                              key={i}
                              className={cn(
                                'w-1 rounded-full',
                                isProcessing ? 'bg-slate-300' : 'bg-orange-400',
                              )}
                              style={{
                                height: isProcessing ? '8px' : '6px',
                                animation: isProcessing
                                  ? 'none'
                                  : `recording-wave ${0.55 + (i % 3) * 0.18}s ease-in-out ${i * 0.08}s infinite alternate`,
                              }}
                            />
                          ))}
                        </div>
                        <span className="tabular-nums text-[13px]">{recordingTimeLabel}</span>
                        <span className="truncate rounded-full bg-white/75 px-2 py-0.5 text-[12px] font-black text-orange-600">
                          {isProcessing ? t('roundtable.processing') : t('roundtable.listening')}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {activePanel === 'text' ? (
                <button
                  onClick={handleSendMessage}
                  disabled={!inputValue.trim() || isSendCooldown}
                  className={cn(
                    'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition active:scale-95',
                    !inputValue.trim() || isSendCooldown
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed border-[3px] border-slate-300'
                      : 'bg-[#ff7f3f] text-white hover:brightness-95 border-[3px] border-slate-900/85',
                  )}
                >
                  {isSendCooldown ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleToggleVoice}
                  disabled={!asrEnabled || isSendCooldown}
                  className={cn(
                    'inline-flex h-10 shrink-0 items-center justify-center rounded-full px-4 text-sm font-black transition active:scale-95',
                    !asrEnabled || isSendCooldown
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed border-[3px] border-slate-300'
                      : isVoiceOpen
                        ? 'bg-orange-500 text-white border-[3px] border-slate-900/85'
                        : 'bg-orange-100 text-orange-700 hover:bg-orange-200 border-[3px] border-slate-900/85',
                  )}
                >
                  {isVoiceOpen ? t('roundtable.stopRecording') : t('roundtable.startRecording')}
                </button>
              )}

              <button
                type="button"
                onClick={closeActivePanel}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-200/70 hover:text-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {(isRecording || isProcessing) && (
        <div className="fixed inset-0 z-[220] pointer-events-none flex items-center justify-center">
          <div className="relative rounded-2xl border-[5px] border-slate-900/85 bg-white/95 px-6 py-4 shadow-[0_10px_0_rgba(15,23,42,0.2)]">
            {isRecording && (
              <>
                <span className="absolute inset-[-10px] rounded-[22px] border-2 border-orange-400/40 animate-ping" />
                <span
                  className="absolute inset-[-16px] rounded-[26px] border-2 border-orange-400/30"
                  style={{ animation: 'recording-ripple 1.8s ease-out infinite' }}
                />
              </>
            )}
            <div className="relative z-10 flex items-center gap-3 text-slate-800">
              <span
                className={cn(
                  'h-3 w-3 rounded-full',
                  isRecording ? 'bg-orange-500 animate-pulse' : 'bg-slate-400',
                )}
              />
              <span className="tabular-nums text-2xl font-black tracking-wide text-orange-600">
                {recordingTimeLabel}
              </span>
              <span className="text-base font-bold">
                {isProcessing ? t('roundtable.processing') : t('roundtable.listening')}
              </span>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes recording-ripple {
          0% {
            opacity: 0.65;
            transform: scale(1);
          }
          100% {
            opacity: 0;
            transform: scale(1.16);
          }
        }

        @keyframes recording-wave {
          0% {
            height: 6px;
            opacity: 0.5;
          }
          100% {
            height: 20px;
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}

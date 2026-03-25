'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  PencilLine,
  LayoutList,
  MessageSquare,
  Volume1,
  Volume2,
  VolumeX,
  Repeat,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStageStore } from '@/lib/store';
import { useI18n } from '@/lib/hooks/use-i18n';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export interface CanvasToolbarProps {
  readonly currentSceneIndex: number;
  readonly scenesCount: number;
  readonly engineState: 'idle' | 'playing' | 'paused';
  readonly isLiveSession?: boolean;
  readonly whiteboardOpen: boolean;
  readonly sidebarCollapsed?: boolean;
  readonly chatCollapsed?: boolean;
  readonly onToggleSidebar?: () => void;
  readonly onToggleChat?: () => void;
  readonly onPrevSlide: () => void;
  readonly onNextSlide: () => void;
  readonly onPlayPause: () => void;
  readonly onWhiteboardClose: () => void;
  readonly showStopDiscussion?: boolean;
  readonly onStopDiscussion?: () => void;
  readonly isPresenting?: boolean;
  readonly onTogglePresentation?: () => void;
  readonly className?: string;
  // Audio/playback controls
  readonly ttsEnabled?: boolean;
  readonly ttsMuted?: boolean;
  readonly ttsVolume?: number;
  readonly onToggleMute?: () => void;
  readonly onVolumeChange?: (volume: number) => void;
  readonly autoPlayLecture?: boolean;
  readonly onToggleAutoPlay?: () => void;
  readonly playbackSpeed?: number;
  readonly onCycleSpeed?: () => void;
}

/* Compact control button */
const ctrlBtn = cn(
  'relative w-7 h-7 rounded-xl border-2 border-slate-900/80 bg-white flex items-center justify-center',
  'transition-all duration-150 outline-none cursor-pointer',
  'hover:brightness-95 active:scale-90',
);

/* Subtle separator */
function CtrlDivider() {
  return <div className="w-px h-4 bg-slate-900/25 mx-0.5 shrink-0" />;
}

/* Volume icon based on level */
function VolumeIcon({
  muted,
  volume,
  disabled,
}: {
  muted: boolean;
  volume: number;
  disabled: boolean;
}) {
  const cls = 'w-3.5 h-3.5';
  if (disabled || muted || volume === 0) return <VolumeX className={cls} />;
  if (volume < 0.5) return <Volume1 className={cls} />;
  return <Volume2 className={cls} />;
}

export function CanvasToolbar({
  currentSceneIndex,
  scenesCount,
  engineState,
  isLiveSession,
  whiteboardOpen,
  sidebarCollapsed,
  chatCollapsed,
  onToggleSidebar,
  onToggleChat,
  onPrevSlide,
  onNextSlide,
  onPlayPause,
  onWhiteboardClose,
  showStopDiscussion,
  onStopDiscussion,
  isPresenting,
  onTogglePresentation,
  className,
  ttsEnabled,
  ttsMuted,
  ttsVolume = 1,
  onToggleMute,
  onVolumeChange,
  autoPlayLecture,
  onToggleAutoPlay,
  playbackSpeed = 1,
  onCycleSpeed,
}: CanvasToolbarProps) {
  const { t } = useI18n();
  const canGoPrev = currentSceneIndex > 0;
  const canGoNext = currentSceneIndex < scenesCount - 1;
  const showPlayPause = !isLiveSession;

  const whiteboardElementCount = useStageStore(
    (s) => s.stage?.whiteboard?.[0]?.elements?.length || 0,
  );

  // Volume slider hover state
  const [volumeHover, setVolumeHover] = useState(false);
  const volumeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const volumeContainerRef = useRef<HTMLDivElement>(null);

  const handleVolumeEnter = useCallback(() => {
    clearTimeout(volumeTimerRef.current);
    setVolumeHover(true);
  }, []);

  const handleVolumeLeave = useCallback(() => {
    volumeTimerRef.current = setTimeout(() => setVolumeHover(false), 300);
  }, []);

  // Cleanup volume hover timer on unmount
  useEffect(() => () => clearTimeout(volumeTimerRef.current), []);

  // Effective volume for display
  const effectiveVolume = ttsMuted ? 0 : ttsVolume;
  const presentationLabel = isPresenting ? t('stage.exitFullscreen') : t('stage.fullscreen');

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* ── Left: sidebar toggle + page indicator ── */}
      <div className="flex items-center gap-1 shrink-0 pl-1">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className={cn(
              ctrlBtn,
              'w-6 h-6',
              sidebarCollapsed ? 'text-slate-400' : 'text-slate-600',
            )}
            aria-label="Toggle sidebar"
          >
            <LayoutList className="w-3.5 h-3.5" />
          </button>
        )}
        <span className="text-[11px] text-slate-700 tabular-nums select-none font-bold">
          {currentSceneIndex + 1}
          <span className="opacity-35 mx-px">/</span>
          {scenesCount}
        </span>
      </div>

      <CtrlDivider />

      {/* ── Center: unified playback controls ── */}
      <div className="flex-1 flex items-center justify-center min-w-0">
        <div className={cn('inline-flex items-center gap-0.5 px-1 h-7')}>
          {/* Volume with vertical popover slider */}
          {onToggleMute && (
            <div
              ref={volumeContainerRef}
              className="relative flex items-center"
              onMouseEnter={handleVolumeEnter}
              onMouseLeave={handleVolumeLeave}
            >
              <button
                onClick={onToggleMute}
                disabled={!ttsEnabled}
                className={cn(
                  ctrlBtn,
                  'w-7 h-7',
                  !ttsEnabled
                    ? 'text-slate-300 cursor-not-allowed'
                    : ttsMuted
                      ? 'text-red-500'
                      : 'text-slate-500',
                )}
                aria-label={ttsMuted ? 'Unmute' : 'Mute'}
              >
                <VolumeIcon muted={!!ttsMuted} volume={ttsVolume} disabled={!ttsEnabled} />
              </button>

              {/* Volume slider (left popout) */}
              <div
                className={cn(
                  'absolute right-full top-1/2 -translate-y-1/2 mr-1.5 flex items-center z-[100]',
                  'transition-all duration-200 ease-out pointer-events-none opacity-0',
                  volumeHover && ttsEnabled && 'pointer-events-auto opacity-100',
                )}
              >
                <div className="bg-white border-2 border-slate-900/70 rounded-xl px-2.5 py-1.5 flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={effectiveVolume}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      onVolumeChange?.(v);
                      if (v > 0 && ttsMuted) onToggleMute?.();
                    }}
                    className={cn(
                      'appearance-none cursor-pointer',
                      'h-1 w-16 rounded-full',
                      'bg-sky-200',
                      '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3',
                      '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-sky-500',
                      '[&::-webkit-slider-thumb]:cursor-pointer',
                      '[&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3',
                      '[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-sky-500 [&::-moz-range-thumb]:border-0',
                    )}
                  />
                  <span className="text-[10px] text-slate-500 tabular-nums font-bold select-none w-7 text-right">
                    {Math.round(effectiveVolume * 100)}
                  </span>
                </div>
                {/* Arrow pointing right */}
                <div className="w-2 h-2 bg-white border-t border-r border-slate-900/30 rotate-45 -ml-[5px]" />
              </div>
            </div>
          )}

          {/* Speed */}
          {onCycleSpeed && (
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onCycleSpeed}
                    className={cn(
                      'w-9 h-6 rounded-lg border border-slate-900/70 flex items-center justify-center',
                      'transition-all duration-150 outline-none cursor-pointer',
                      'text-[11px] font-bold tabular-nums leading-none',
                      'active:scale-90',
                      playbackSpeed !== 1
                        ? 'text-slate-900 bg-sky-200/70 border-slate-900/70'
                        : 'text-slate-600 hover:text-slate-700 bg-white/80 hover:border-slate-900/85',
                    )}
                    aria-label="Playback speed"
                  >
                    {playbackSpeed === 1.5 ? '1.5x' : `${playbackSpeed}x`}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {t('roundtable.speed')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          <CtrlDivider />

          {/* Prev scene */}
          {scenesCount > 1 && (
            <button
              onClick={onPrevSlide}
              disabled={!canGoPrev}
              className={cn(
                ctrlBtn,
                'w-7 h-7 text-slate-600 disabled:opacity-20 disabled:pointer-events-none',
              )}
              aria-label="Previous scene"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Play / Pause / Stop Discussion */}
          {showStopDiscussion && onStopDiscussion ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStopDiscussion();
              }}
              className={cn(
                'flex items-center gap-1.5 h-7 px-3 rounded-xl border-2 border-slate-900/80',
                'bg-[#ff8e8e] text-slate-900',
                'text-[11px] font-black whitespace-nowrap',
                'hover:brightness-95 active:scale-95 transition-all cursor-pointer',
              )}
              title={t('roundtable.stopDiscussion')}
            >
              <span className="relative flex h-1.5 w-1.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" />
              </span>
              {t('roundtable.stopDiscussion')}
            </button>
          ) : showPlayPause ? (
            <button
              onClick={onPlayPause}
              className={cn(
                ctrlBtn,
                'w-7 h-7',
                engineState === 'playing' ? 'text-sky-700 bg-sky-100' : 'text-slate-600',
              )}
              aria-label={engineState === 'playing' ? 'Pause' : 'Play'}
            >
              {engineState === 'playing' ? (
                <Pause className="w-3.5 h-3.5" />
              ) : (
                <Play className="w-3.5 h-3.5 ml-px" />
              )}
            </button>
          ) : null}

          {/* Next scene */}
          {scenesCount > 1 && (
            <button
              onClick={onNextSlide}
              disabled={!canGoNext}
              className={cn(
                ctrlBtn,
                'w-7 h-7 text-slate-500 disabled:opacity-20 disabled:pointer-events-none',
              )}
              aria-label="Next scene"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}

          <CtrlDivider />

          {/* Auto-play */}
          {onToggleAutoPlay && (
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onToggleAutoPlay}
                    className={cn(
                      ctrlBtn,
                      'w-8 h-7',
                      autoPlayLecture ? 'text-sky-700 bg-sky-100' : 'text-slate-600',
                    )}
                    aria-label="Auto-play"
                  >
                    <Repeat className="w-3.5 h-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {autoPlayLecture ? t('roundtable.autoPlayOff') : t('roundtable.autoPlay')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Whiteboard */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onWhiteboardClose();
            }}
            className={cn(
              ctrlBtn,
              'w-7 h-7',
              whiteboardOpen ? 'text-sky-700 bg-sky-100' : 'text-slate-600',
            )}
            title={whiteboardOpen ? t('whiteboard.minimize') : t('whiteboard.open')}
          >
            <PencilLine className="w-3.5 h-3.5" />
            {!whiteboardOpen && whiteboardElementCount > 0 && (
              <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-sky-500 rounded-full" />
            )}
          </button>
        </div>
      </div>

      {/* ── Right: fullscreen + chat toggle ── */}
      <div className="flex items-center justify-end gap-px shrink-0 pr-1">
        <CtrlDivider />
        {onTogglePresentation && (
          <button
            onClick={onTogglePresentation}
            className={cn(
              ctrlBtn,
              'w-7 h-7',
              isPresenting
                ? 'text-violet-600 dark:text-violet-400'
                : 'text-gray-500 dark:text-gray-400',
            )}
            aria-label={presentationLabel}
            title={presentationLabel}
          >
            {isPresenting ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>
        )}
        {onToggleChat && (
          <button
            onClick={onToggleChat}
            className={cn(ctrlBtn, 'w-7 h-7', chatCollapsed ? 'text-slate-400' : 'text-slate-600')}
            aria-label="Toggle chat"
          >
            <MessageSquare className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

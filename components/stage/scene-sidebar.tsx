'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  PanelLeftClose,
  PieChart,
  Cpu,
  MousePointer2,
  BookOpen,
  Globe,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThumbnailSlide } from '@/components/slide-renderer/components/ThumbnailSlide';
import { useStageStore, useCanvasStore } from '@/lib/store';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { SceneType, SlideContent } from '@/lib/types/stage';
import { PENDING_SCENE_ID } from '@/lib/store/stage';

interface SceneSidebarProps {
  readonly collapsed: boolean;
  readonly onCollapseChange: (collapsed: boolean) => void;
  readonly onSceneSelect?: (sceneId: string) => void;
  readonly onRetryOutline?: (outlineId: string) => Promise<void>;
}

const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 210;
const MAX_WIDTH = 420;

export function SceneSidebar({
  collapsed,
  onCollapseChange,
  onSceneSelect,
  onRetryOutline,
}: SceneSidebarProps) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { scenes, currentSceneId, setCurrentSceneId, generatingOutlines, generationStatus } =
    useStageStore();
  const failedOutlines = useStageStore.use.failedOutlines();
  const viewportSize = useCanvasStore.use.viewportSize();
  const viewportRatio = useCanvasStore.use.viewportRatio();

  const [retryingOutlineId, setRetryingOutlineId] = useState<string | null>(null);

  const handleRetryOutline = async (outlineId: string) => {
    if (!onRetryOutline) return;
    setRetryingOutlineId(outlineId);
    try {
      await onRetryOutline(outlineId);
    } finally {
      setRetryingOutlineId(null);
    }
  };

  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const isDraggingRef = useRef(false);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      const startX = e.clientX;
      const startWidth = sidebarWidth;

      const handleMouseMove = (me: MouseEvent) => {
        const delta = me.clientX - startX;
        const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
        setSidebarWidth(newWidth);
      };

      const handleMouseUp = () => {
        isDraggingRef.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [sidebarWidth],
  );

  const getSceneTypeIcon = (type: SceneType) => {
    const icons = {
      slide: BookOpen,
      quiz: PieChart,
      interactive: MousePointer2,
      pbl: Cpu,
    };
    return icons[type] || BookOpen;
  };

  const displayWidth = collapsed ? 0 : sidebarWidth;

  return (
    <div
      style={{
        width: displayWidth,
        transition: isDraggingRef.current ? 'none' : 'width 0.3s ease',
      }}
      className="bg-sky-200 border-r-[4px] border-r-slate-900/90 flex flex-col shrink-0 z-20 relative overflow-visible"
    >
      {/* Drag handle */}
      {!collapsed && (
        <div
          onMouseDown={handleDragStart}
          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize z-50 group hover:bg-sky-300/40 active:bg-sky-400/40 transition-colors"
        >
          <div className="absolute right-0.5 top-1/2 -translate-y-1/2 w-0.5 h-8 rounded-full bg-sky-200 group-hover:bg-sky-400 transition-colors" />
        </div>
      )}

      <div className={cn('flex flex-col w-full h-full overflow-hidden', collapsed && 'hidden')}>
        {/* Logo Header */}
        <div className="h-12 flex items-center justify-between shrink-0 relative mt-3 mb-2 px-3.5">
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-2 cursor-pointer rounded-2xl px-2 -mx-2 py-1.5 -my-1.5 hover:bg-white/50 active:scale-[0.97] transition-all duration-150"
            title={t('generation.backToHome')}
          >
            <img
              src={locale === 'zh-CN' ? '/logo_t.png' : '/logo_t_e.png'}
              alt="Linksy"
              className="h-11"
            />
          </button>
          <button
            onClick={() => onCollapseChange(true)}
            className="w-9 h-9 shrink-0 rounded-2xl flex items-center justify-center bg-white text-sky-600 border-[4px] border-slate-900/80 hover:bg-sky-50 hover:text-sky-700 active:scale-90 transition-all duration-200"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>

        {/* Scenes List */}
        <div
          data-testid="scene-list"
          className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-2 scrollbar-hide pt-1"
        >
          {scenes.map((scene, index) => {
            const isActive = currentSceneId === scene.id;
            const Icon = getSceneTypeIcon(scene.type);
            const isSlide = scene.type === 'slide';
            const slideContent = isSlide ? (scene.content as SlideContent) : null;

            return (
              <div
                key={scene.id}
                data-testid="scene-item"
                onClick={() => {
                  if (onSceneSelect) {
                    onSceneSelect(scene.id);
                  } else {
                    setCurrentSceneId(scene.id);
                  }
                }}
                className={cn(
                  'group relative rounded-[18px] transition-all duration-200 cursor-pointer flex flex-col gap-2 p-2 border-[4px] border-slate-900/75',
                  isActive
                    ? 'bg-white/95 ring-2 ring-orange-400/70'
                    : index % 2 === 0
                      ? 'bg-white/85 hover:bg-white/95'
                      : 'bg-sky-50/85 hover:bg-white/95',
                )}
              >
                {/* Scene Header */}
                <div className="flex justify-between items-center px-2 pt-0.5">
                  <div className="flex items-center gap-1.5 max-w-full">
                    <span
                      className={cn(
                        'text-[10px] font-black w-4.5 h-4.5 rounded-full flex items-center justify-center shrink-0',
                        isActive ? 'bg-sky-500 text-white' : 'bg-sky-100 text-sky-600',
                      )}
                    >
                      {index + 1}
                    </span>
                    <span
                      data-testid="scene-title"
                      className={cn(
                        'text-[13px] font-bold truncate transition-colors',
                        isActive ? 'text-sky-700' : 'text-slate-700 group-hover:text-sky-700',
                      )}
                    >
                      {scene.title}
                    </span>
                  </div>
                </div>

                {/* Thumbnail */}
                <div className="relative aspect-video w-full rounded-lg overflow-hidden bg-sky-50 border border-sky-200/70">
                  <div className="absolute inset-0 flex items-center justify-center">
                    {isSlide && slideContent ? (
                      <ThumbnailSlide
                        slide={slideContent.canvas}
                        viewportSize={viewportSize}
                        viewportRatio={viewportRatio}
                        size={Math.max(108, sidebarWidth - 40)}
                      />
                    ) : scene.type === 'quiz' ? (
                      /* Quiz: question bar + 2x2 option grid */
                      <div className="w-full h-full bg-gradient-to-br from-orange-50 to-amber-50 p-2 flex flex-col">
                        <div className="h-1.5 w-4/5 bg-orange-200/70 rounded-full mb-1.5" />
                        <div className="flex-1 grid grid-cols-2 gap-1">
                          {[0, 1, 2, 3].map((i) => (
                            <div
                              key={i}
                              className={cn(
                                'rounded flex items-center gap-1 px-1',
                                i === 1
                                  ? 'bg-orange-400/20 border border-orange-300/50'
                                  : 'bg-white/60 border border-orange-100/60',
                              )}
                            >
                              <div
                                className={cn(
                                  'w-1.5 h-1.5 rounded-full shrink-0',
                                  i === 1 ? 'bg-orange-400' : 'bg-orange-200',
                                )}
                              />
                              <div
                                className={cn(
                                  'h-1 rounded-full flex-1',
                                  i === 1 ? 'bg-orange-300/60' : 'bg-orange-100/80',
                                )}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : scene.type === 'interactive' ? (
                      /* Interactive: browser window with chrome + content */
                      <div className="w-full h-full bg-gradient-to-br from-emerald-50 to-teal-50 p-1.5 flex flex-col">
                        <div className="flex items-center gap-1 mb-1 pb-1 border-b border-emerald-200/40">
                          <div className="flex gap-0.5">
                            <div className="w-1 h-1 rounded-full bg-red-300" />
                            <div className="w-1 h-1 rounded-full bg-amber-300" />
                            <div className="w-1 h-1 rounded-full bg-green-300" />
                          </div>
                          <div className="h-1.5 flex-1 bg-emerald-200/40 rounded-full ml-0.5" />
                        </div>
                        <div className="flex-1 flex gap-1">
                          <div className="w-1/4 space-y-1 pt-0.5">
                            {[1, 2, 3].map((i) => (
                              <div
                                key={i}
                                className="h-0.5 w-full bg-emerald-200/60 rounded-full"
                              />
                            ))}
                          </div>
                          <div className="flex-1 bg-emerald-100/40 rounded flex items-center justify-center border border-emerald-200/40">
                            <Globe className="w-4 h-4 text-emerald-300/80" />
                          </div>
                        </div>
                      </div>
                    ) : scene.type === 'pbl' ? (
                      /* PBL: kanban board with 3 columns */
                      <div className="w-full h-full bg-gradient-to-br from-blue-50 to-indigo-50 p-1.5 flex flex-col">
                        <div className="flex items-center gap-1 mb-1.5">
                          <div className="w-1.5 h-1.5 rounded bg-blue-300" />
                          <div className="h-1 w-8 bg-blue-200/60 rounded-full" />
                        </div>
                        <div className="flex-1 flex gap-1 overflow-hidden">
                          {[0, 1, 2].map((col) => (
                            <div
                              key={col}
                              className="flex-1 bg-white/50 rounded p-0.5 flex flex-col gap-0.5"
                            >
                              <div
                                className={cn(
                                  'h-0.5 w-3 rounded-full mb-0.5',
                                  col === 0
                                    ? 'bg-blue-300/70'
                                    : col === 1
                                      ? 'bg-amber-300/70'
                                      : 'bg-green-300/70',
                                )}
                              />
                              {Array.from({
                                length: col === 0 ? 3 : col === 1 ? 2 : 1,
                              }).map((_, i) => (
                                <div
                                  key={i}
                                  className="h-2 w-full bg-blue-100/60 rounded border border-blue-200/30"
                                />
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      /* Fallback */
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-sky-50 text-sky-300">
                        <Icon className="w-4 h-4" />
                        <span className="text-[9px] font-bold uppercase tracking-wider opacity-80">
                          {scene.type}
                        </span>
                      </div>
                    )}

                    {isSlide && (
                      <div
                        className={cn(
                          'absolute inset-0 bg-sky-500/0 transition-colors',
                          isActive ? 'bg-sky-500/0' : 'group-hover:bg-sky-500/8',
                        )}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Single placeholder for the next generating page (clickable) */}
          {generatingOutlines.length > 0 &&
            (() => {
              const outline = generatingOutlines[0];
              const isFailed = failedOutlines.some((f) => f.id === outline.id);
              const isRetrying = retryingOutlineId === outline.id;
              const isPaused = generationStatus === 'paused';
              const isActive = currentSceneId === PENDING_SCENE_ID;

              return (
                <div
                  key={`generating-${outline.id}`}
                  onClick={() => {
                    if (isFailed) return;
                    if (onSceneSelect) {
                      onSceneSelect(PENDING_SCENE_ID);
                    } else {
                      setCurrentSceneId(PENDING_SCENE_ID);
                    }
                  }}
                  className={cn(
                    'group relative rounded-[18px] flex flex-col gap-2 p-2 transition-all duration-200 border-[4px] border-slate-900/75',
                    isFailed
                      ? 'opacity-100 cursor-default bg-white/85'
                      : 'cursor-pointer bg-white/90 hover:bg-white/95',
                    !isFailed && !isActive && 'opacity-60',
                    isActive && !isFailed && 'bg-white/95 ring-2 ring-orange-400/70 opacity-100',
                  )}
                >
                  {/* Scene Header */}
                  <div className="flex justify-between items-center px-2 pt-0.5">
                    <div className="flex items-center gap-1.5 max-w-full">
                      <span
                        className={cn(
                          'text-[10px] font-black w-4.5 h-4.5 rounded-full flex items-center justify-center shrink-0',
                          isActive && !isFailed
                            ? 'bg-sky-500 text-white'
                            : 'bg-sky-100 text-sky-400',
                        )}
                      >
                        {scenes.length + 1}
                      </span>
                      <span
                        className={cn(
                          'text-[13px] font-bold truncate transition-colors',
                          isActive && !isFailed
                            ? 'text-sky-700'
                            : isFailed
                              ? 'text-slate-700'
                              : 'text-slate-400',
                        )}
                      >
                        {outline.title}
                      </span>
                    </div>
                  </div>

                  {/* Skeleton Thumbnail */}
                  <div
                    className={cn(
                      'relative aspect-video w-full rounded-md overflow-hidden ring-1',
                      isFailed ? 'bg-red-50/30 ring-red-100' : 'bg-sky-50 ring-sky-100',
                    )}
                  >
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
                      {isFailed ? (
                        <div className="flex items-center gap-1 text-xs font-medium text-red-500/90">
                          {onRetryOutline ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRetryOutline(outline.id);
                              }}
                              disabled={isRetrying}
                              className="p-1 -ml-1 rounded-md hover:bg-red-100 transition-colors active:scale-95 disabled:opacity-50 disabled:active:scale-100"
                              title={t('generation.retryScene')}
                            >
                              <RefreshCw
                                className={cn('w-3.5 h-3.5', isRetrying && 'animate-spin')}
                              />
                            </button>
                          ) : (
                            <AlertCircle className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {isRetrying
                              ? t('generation.retryingScene')
                              : t('stage.generationFailed')}
                          </span>
                        </div>
                      ) : (
                        <>
                          <div
                            className={cn(
                              'h-2 w-3/5 bg-sky-200 rounded',
                              !isPaused && 'animate-pulse',
                            )}
                          />
                          <div
                            className={cn(
                              'h-1.5 w-2/5 bg-sky-200 rounded',
                              !isPaused && 'animate-pulse',
                            )}
                          />
                          <span className="text-[9px] font-medium text-slate-400 mt-0.5">
                            {isPaused ? t('stage.paused') : t('stage.generating')}
                          </span>
                        </>
                      )}
                    </div>
                    {!isFailed && !isPaused && (
                      <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/50 to-transparent" />
                    )}
                  </div>
                </div>
              );
            })()}
        </div>

        {/* Spacer to push toggle button area */}
        <div className="mt-auto" />
      </div>
    </div>
  );
}

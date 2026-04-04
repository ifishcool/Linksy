'use client';

import { useEffect, useRef } from 'react';
import { BookOpen, MessageSquare, Flashlight, MousePointer2, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { LectureNoteEntry } from '@/lib/types/chat';

const ACTION_ICON_ONLY: Record<string, { Icon: typeof Flashlight; style: string }> = {
  spotlight: {
    Icon: Flashlight,
    style: 'bg-yellow-50 border-yellow-300/50 text-yellow-700',
  },
  laser: {
    Icon: MousePointer2,
    style: 'bg-red-50 border-red-300/50 text-red-600',
  },
  play_video: {
    Icon: Play,
    style: 'bg-yellow-50 border-yellow-300/50 text-yellow-700',
  },
};

interface LectureNotesViewProps {
  notes: LectureNoteEntry[];
  currentSceneId?: string | null;
}

export function LectureNotesView({ notes, currentSceneId }: LectureNotesViewProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the current scene note
  useEffect(() => {
    if (!currentSceneId || !containerRef.current) return;
    const el = containerRef.current.querySelector(`[data-scene-id="${currentSceneId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentSceneId]);

  // Empty state
  if (notes.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-6">
        <div className="w-12 h-12 bg-sky-100 rounded-2xl flex items-center justify-center mb-3 text-sky-500 ring-1 ring-sky-200/70">
          <BookOpen className="w-6 h-6" />
        </div>
        <p className="text-xs font-semibold text-slate-600">{t('chat.lectureNotes.empty')}</p>
        <p className="text-[10px] text-slate-400 mt-1">{t('chat.lectureNotes.emptyHint')}</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 scrollbar-hide bg-[#fff8db]"
    >
      {notes.map((note, index) => {
        const isCurrent = note.sceneId === currentSceneId;
        const pageNum = index + 1;
        const pageLabel = t('chat.lectureNotes.pageLabel', { n: pageNum });

        return (
          <div
            key={note.sceneId}
            data-scene-id={note.sceneId}
            className={cn(
              'relative mb-3 last:mb-0 rounded-2xl px-3 py-2.5 transition-colors duration-200 border-[3px]',
              isCurrent
                ? 'bg-white border-slate-900/80 ring-1 ring-sky-200/70'
                : 'bg-white/78 border-slate-900/60',
            )}
          >
            <div
              className={cn(
                'absolute left-2 top-3 bottom-3 w-1 rounded-full',
                isCurrent ? 'bg-sky-300/90' : 'bg-slate-200/90',
              )}
            />

            {/* Page label row */}
            <div className="flex items-center gap-2 mb-1.5 pl-3.5">
              {/* Timeline dot */}
              <div
                className={cn(
                  'w-2 h-2 rounded-full shrink-0',
                  isCurrent ? 'bg-sky-500 shadow-sm shadow-sky-400/40' : 'bg-slate-300',
                )}
              />
              <span
                className={cn(
                  'text-[10px] font-semibold tracking-wide',
                  isCurrent ? 'text-sky-600' : 'text-slate-400',
                )}
              >
                {pageLabel}
              </span>
              {isCurrent && (
                <span className="text-[9px] font-bold px-1.5 py-px rounded-full bg-sky-100 text-sky-700 border border-sky-200/80">
                  {t('chat.lectureNotes.currentPage')}
                </span>
              )}
            </div>

            {/* Scene title */}
            <h4 className="text-[13px] font-black text-slate-800 mb-1.5 leading-snug pl-3.5">
              {note.sceneTitle}
            </h4>

            {/* Ordered items: spotlight/laser inline at sentence start, discussion as card */}
            <div className="pl-3.5 space-y-1">
              {(() => {
                // Build render rows: group inline actions (spotlight/laser) with next speech,
                // but render discussion as its own block
                type Row =
                  | { kind: 'speech'; inlineActions: string[]; text: string }
                  | { kind: 'discussion'; label?: string }
                  | { kind: 'trailing'; inlineActions: string[] };
                const rows: Row[] = [];
                let pendingInline: string[] = [];
                for (const item of note.items) {
                  if (item.kind === 'action' && item.type === 'discussion') {
                    // Flush pending inline actions as trailing if any
                    if (pendingInline.length > 0) {
                      rows.push({
                        kind: 'trailing',
                        inlineActions: pendingInline,
                      });
                      pendingInline = [];
                    }
                    rows.push({ kind: 'discussion', label: item.label });
                  } else if (item.kind === 'action') {
                    pendingInline.push(item.type);
                  } else {
                    rows.push({
                      kind: 'speech',
                      inlineActions: pendingInline,
                      text: item.text,
                    });
                    pendingInline = [];
                  }
                }
                if (pendingInline.length > 0) {
                  rows.push({ kind: 'trailing', inlineActions: pendingInline });
                }
                return rows.map((row, i) => {
                  if (row.kind === 'discussion') {
                    return (
                      <div
                        key={i}
                        className="my-1.5 flex items-start gap-1.5 rounded-lg border-[3px] border-slate-900/60 bg-amber-50/70 px-2 py-1.5"
                      >
                        <MessageSquare className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                        <span className="text-[11px] leading-snug text-amber-800">{row.label}</span>
                      </div>
                    );
                  }
                  const actions = row.kind === 'trailing' ? row.inlineActions : row.inlineActions;
                  return (
                    <p key={i} className="text-[12px] leading-[1.8] text-slate-700">
                      {actions.map((a, j) => {
                        const cfg = ACTION_ICON_ONLY[a];
                        if (!cfg) return null;
                        const { Icon, style } = cfg;
                        return (
                          <span
                            key={j}
                            className={cn(
                              'inline-flex items-center justify-center w-4 h-4 rounded-full border align-middle mr-0.5',
                              style,
                            )}
                          >
                            <Icon className="w-2.5 h-2.5" />
                          </span>
                        );
                      })}
                      {row.kind === 'speech' ? row.text : null}
                    </p>
                  );
                });
              })()}
            </div>
          </div>
        );
      })}
    </div>
  );
}

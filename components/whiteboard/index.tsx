'use client';

import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Eraser, History, Minimize2, PencilLine } from 'lucide-react';
import { WhiteboardCanvas } from './whiteboard-canvas';
import { WhiteboardHistory } from './whiteboard-history';
import { useStageStore } from '@/lib/store';
import { useCanvasStore } from '@/lib/store/canvas';
import { useWhiteboardHistoryStore } from '@/lib/store/whiteboard-history';
import { createStageAPI } from '@/lib/api/stage-api';
import { toast } from 'sonner';
import { useI18n } from '@/lib/hooks/use-i18n';

interface WhiteboardProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

/**
 * Whiteboard component
 */
export function Whiteboard({ isOpen, onClose }: WhiteboardProps) {
  const { t } = useI18n();
  const stage = useStageStore.use.stage();
  const isClearing = useCanvasStore.use.whiteboardClearing();
  const clearingRef = useRef(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const snapshotCount = useWhiteboardHistoryStore((s) => s.snapshots.length);

  // Get element count for indicator
  const whiteboard = stage?.whiteboard?.[0];
  const elementCount = whiteboard?.elements?.length || 0;

  const stageAPI = createStageAPI(useStageStore);

  const handleClear = async () => {
    if (!whiteboard || elementCount === 0 || clearingRef.current) return;
    clearingRef.current = true;

    // Save snapshot before clearing
    if (whiteboard.elements && whiteboard.elements.length > 0) {
      useWhiteboardHistoryStore
        .getState()
        .pushSnapshot(whiteboard.elements, t('whiteboard.beforeClear'));
    }

    // Trigger cascade exit animation
    useCanvasStore.getState().setWhiteboardClearing(true);

    // Wait for cascade: base 380ms + 55ms per element, capped at 1400ms
    const animMs = Math.min(380 + elementCount * 55, 1400);
    await new Promise((resolve) => setTimeout(resolve, animMs));

    // Actually remove elements
    const result = stageAPI.whiteboard.delete(whiteboard.id);
    useCanvasStore.getState().setWhiteboardClearing(false);
    clearingRef.current = false;

    if (result.success) {
      toast.success(t('whiteboard.clearSuccess'));
    } else {
      toast.error(t('whiteboard.clearError') + result.error);
    }
  };

  return (
    <>
      {/* Main Whiteboard Overlay */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 30 }}
            animate={{
              opacity: 1,
              scale: 1,
              y: 0,
              transition: {
                type: 'spring',
                stiffness: 120,
                damping: 18,
                mass: 1.2,
              },
            }}
            exit={{
              opacity: 0,
              scale: 0.95,
              y: 16,
              transition: { duration: 0.5, ease: [0.4, 0, 0.2, 1] },
            }}
            className="absolute inset-0 pointer-events-auto rounded-[20px] backdrop-blur-sm border-sky-200/70 flex flex-col overflow-hidden z-[120]"
          >
            {/* Header */}
            <div className="h-14 px-6 border-b border-sky-100 flex items-center justify-between shrink-0 bg-white/60">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-sky-100 flex items-center justify-center text-sky-700">
                  <PencilLine className="w-4 h-4" />
                </div>
                <span className="font-bold text-slate-800 tracking-tight">
                  {t('whiteboard.title')}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <motion.button
                  type="button"
                  onClick={handleClear}
                  disabled={isClearing || elementCount === 0}
                  whileTap={{ scale: 0.9 }}
                  className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  title={t('whiteboard.clear')}
                >
                  <motion.div
                    animate={isClearing ? { rotate: [0, -15, 15, -10, 10, 0] } : { rotate: 0 }}
                    transition={
                      isClearing ? { duration: 0.5, ease: 'easeInOut' } : { duration: 0.2 }
                    }
                  >
                    <Eraser className="w-4 h-4" />
                  </motion.div>
                </motion.button>
                <motion.button
                  type="button"
                  onClick={() => setHistoryOpen(!historyOpen)}
                  whileTap={{ scale: 0.9 }}
                  className="relative p-2 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors"
                  title={t('whiteboard.history')}
                >
                  <History className="w-4 h-4" />
                  {snapshotCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-sky-600 text-white text-[10px] font-bold flex items-center justify-center">
                      {snapshotCount}
                    </span>
                  )}
                </motion.button>
                <div className="w-px h-4 bg-sky-200 mx-1" />
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
                  title={t('whiteboard.minimize')}
                >
                  <Minimize2 className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Whiteboard Content Area */}
            <div className="flex-1 relative bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:24px_24px] overflow-hidden">
              <WhiteboardCanvas />

              {/* History panel */}
              <WhiteboardHistory isOpen={historyOpen} onClose={() => setHistoryOpen(false)} />

              {/* Test panel */}
              {/* <WhiteboardTestPanel /> */}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

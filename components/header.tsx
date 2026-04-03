'use client';

import { Loader2, Download, FileDown, Maximize2, Minimize2, Package } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useStageStore } from '@/lib/store/stage';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { useExportPPTX } from '@/lib/export/use-export-pptx';

interface HeaderProps {
  readonly currentSceneTitle: string;
  readonly isPresenting?: boolean;
  readonly onTogglePresentation?: () => void;
}

export function Header({
  currentSceneTitle,
  isPresenting = false,
  onTogglePresentation,
}: HeaderProps) {
  const { t } = useI18n();

  // Export
  const { exporting: isExporting, exportPPTX, exportResourcePack } = useExportPPTX();
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const scenes = useStageStore((s) => s.scenes);
  const generatingOutlines = useStageStore((s) => s.generatingOutlines);
  const failedOutlines = useStageStore((s) => s.failedOutlines);
  const mediaTasks = useMediaGenerationStore((s) => s.tasks);

  const canExport =
    scenes.length > 0 &&
    generatingOutlines.length === 0 &&
    failedOutlines.length === 0 &&
    Object.values(mediaTasks).every((task) => task.status === 'done' || task.status === 'failed');

  // Close dropdown when clicking outside
  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      if (exportMenuOpen && exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    },
    [exportMenuOpen],
  );

  useEffect(() => {
    if (exportMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [exportMenuOpen, handleClickOutside]);

  return (
    <>
      <header className="h-20 px-6 flex items-center justify-between z-10 bg-transparent gap-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="flex flex-col min-w-0">
            <h1
              className="text-[44px] leading-[1.08] pb-0.5 font-black text-white tracking-tight truncate [text-shadow:_2px_2px_0_rgb(15_23_42)]"
              suppressHydrationWarning
            >
              {currentSceneTitle || t('common.loading')}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2 px-1 py-1 shrink-0">
          {onTogglePresentation && (
            <button
              onClick={onTogglePresentation}
              className="h-10 w-10 rounded-full border-[4px] border-slate-900 bg-white text-slate-700 hover:bg-sky-50 hover:text-sky-700 transition-all flex items-center justify-center shrink-0"
              aria-label={isPresenting ? t('stage.exitFullscreen') : t('stage.fullscreen')}
              title={isPresenting ? t('stage.exitFullscreen') : t('stage.fullscreen')}
            >
              {isPresenting ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          )}
        </div>

        {/* Export Dropdown */}
        <div className="relative" ref={exportRef}>
          <button
            onClick={() => {
              if (canExport && !isExporting) setExportMenuOpen(!exportMenuOpen);
            }}
            disabled={!canExport || isExporting}
            title={
              canExport
                ? isExporting
                  ? t('export.exporting')
                  : t('export.pptx')
                : t('share.notReady')
            }
            className={cn(
              'shrink-0 h-10 w-10 rounded-full border-[4px] border-slate-900 transition-all flex items-center justify-center bg-white',
              canExport && !isExporting
                ? 'text-slate-600 hover:bg-sky-50 hover:text-sky-700'
                : 'text-slate-300 cursor-not-allowed opacity-50 bg-slate-100',
            )}
          >
            {isExporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
          </button>
          {exportMenuOpen && (
            <div className="absolute top-full mt-2 right-0 bg-white border border-sky-200 rounded-lg overflow-hidden z-50 min-w-[200px]">
              <button
                onClick={() => {
                  setExportMenuOpen(false);
                  exportPPTX();
                }}
                className="w-full px-4 py-2.5 text-left text-sm hover:bg-sky-50 transition-colors flex items-center gap-2.5"
              >
                <FileDown className="w-4 h-4 text-slate-400 shrink-0" />
                <span>{t('export.pptx')}</span>
              </button>
              <button
                onClick={() => {
                  setExportMenuOpen(false);
                  exportResourcePack();
                }}
                className="w-full px-4 py-2.5 text-left text-sm hover:bg-sky-50 transition-colors flex items-center gap-2.5"
              >
                <Package className="w-4 h-4 text-slate-400 shrink-0" />
                <div>
                  <div>{t('export.resourcePack')}</div>
                  <div className="text-[11px] text-slate-400">{t('export.resourcePackDesc')}</div>
                </div>
              </button>
            </div>
          )}
        </div>
      </header>
    </>
  );
}

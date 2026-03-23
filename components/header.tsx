'use client';

import { Settings, ArrowLeft, Loader2, Download, FileDown, Package } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { SettingsDialog } from './settings';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/lib/store/settings';
import { useStageStore } from '@/lib/store/stage';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { useExportPPTX } from '@/lib/export/use-export-pptx';

interface HeaderProps {
  readonly currentSceneTitle: string;
}

export function Header({ currentSceneTitle }: HeaderProps) {
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);

  // Model setup state
  const currentModelId = useSettingsStore((s) => s.modelId);
  const needsSetup = !currentModelId;

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

  const languageRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      if (languageOpen && languageRef.current && !languageRef.current.contains(e.target as Node)) {
        setLanguageOpen(false);
      }
      if (exportMenuOpen && exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    },
    [languageOpen, exportMenuOpen],
  );

  useEffect(() => {
    if (languageOpen || exportMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [languageOpen, exportMenuOpen, handleClickOutside]);

  return (
    <>
      <header className="h-20 px-6 flex items-center justify-between z-10 bg-transparent gap-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            onClick={() => router.push('/')}
            className="shrink-0 p-2 rounded-lg text-slate-400 hover:bg-sky-50 hover:text-sky-700 transition-colors"
            title={t('generation.backToHome')}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] uppercase tracking-widest font-bold text-sky-500 mb-0.5">
              {t('stage.currentScene')}
            </span>
            <h1
              className="text-xl font-bold text-slate-800 tracking-tight truncate"
              suppressHydrationWarning
            >
              {currentSceneTitle || t('common.loading')}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-4 bg-white/85 backdrop-blur-sm px-2 py-1.5 rounded-full border border-sky-200/70 shrink-0">
          {/* Language Selector */}
          <div className="relative" ref={languageRef}>
            <button
              onClick={() => {
                setLanguageOpen(!languageOpen);
              }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold text-slate-500 hover:bg-sky-50 hover:text-sky-700 transition-all"
            >
              {locale === 'zh-CN' ? 'CN' : 'EN'}
            </button>
            {languageOpen && (
              <div className="absolute top-full mt-2 right-0 bg-white border border-sky-200 rounded-lg overflow-hidden z-50 min-w-[120px]">
                <button
                  onClick={() => {
                    setLocale('zh-CN');
                    setLanguageOpen(false);
                  }}
                  className={cn(
                    'w-full px-4 py-2 text-left text-sm hover:bg-sky-50 transition-colors',
                    locale === 'zh-CN' && 'bg-sky-100 text-sky-700',
                  )}
                >
                  简体中文
                </button>
                <button
                  onClick={() => {
                    setLocale('en-US');
                    setLanguageOpen(false);
                  }}
                  className={cn(
                    'w-full px-4 py-2 text-left text-sm hover:bg-sky-50 transition-colors',
                    locale === 'en-US' && 'bg-sky-100 text-sky-700',
                  )}
                >
                  English
                </button>
              </div>
            )}
          </div>

          <div className="w-[1px] h-4 bg-sky-200" />

          {/* Settings Button */}
          <div className="relative">
            <button
              onClick={() => setSettingsOpen(true)}
              className={cn(
                'p-2 rounded-full text-slate-400 hover:bg-sky-50 hover:text-sky-700 transition-all group',
                needsSetup && 'animate-setup-glow',
              )}
            >
              <Settings className="w-3.5 h-3.5 group-hover:rotate-90 transition-transform duration-500" />
              <span>{t('settings.title')}</span>
            </button>
            {needsSetup && (
              <>
                <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                  <span className="animate-setup-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-violet-500" />
                </span>
                <span className="animate-setup-float absolute top-full mt-2 right-0 whitespace-nowrap text-[11px] font-medium text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full pointer-events-none">
                <span className="animate-setup-float absolute top-full mt-2 right-0 whitespace-nowrap text-[11px] font-medium text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full pointer-events-none">
                  {t('settings.setupNeeded')}
                </span>
              </>
            )}
          </div>
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
              'shrink-0 h-10 px-3 rounded-full border-[3px] border-slate-900 transition-all flex items-center justify-center bg-white',
              canExport && !isExporting
                ? 'text-slate-400 hover:bg-sky-50 hover:text-sky-700'
                : 'text-slate-300 cursor-not-allowed opacity-50',
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
            <div className="absolute top-full mt-2 right-0 bg-white border border-sky-200 rounded-lg overflow-hidden z-50 min-w-[200px]">
              <button
                onClick={() => {
                  setExportMenuOpen(false);
                  exportPPTX();
                }}
                className="w-full px-4 py-2.5 text-left text-sm hover:bg-sky-50 transition-colors flex items-center gap-2.5"
                className="w-full px-4 py-2.5 text-left text-sm hover:bg-sky-50 transition-colors flex items-center gap-2.5"
              >
                <FileDown className="w-4 h-4 text-slate-400 shrink-0" />
                <FileDown className="w-4 h-4 text-slate-400 shrink-0" />
                <span>{t('export.pptx')}</span>
              </button>
              <button
                onClick={() => {
                  setExportMenuOpen(false);
                  exportResourcePack();
                }}
                className="w-full px-4 py-2.5 text-left text-sm hover:bg-sky-50 transition-colors flex items-center gap-2.5"
                className="w-full px-4 py-2.5 text-left text-sm hover:bg-sky-50 transition-colors flex items-center gap-2.5"
              >
                <Package className="w-4 h-4 text-slate-400 shrink-0" />
                <Package className="w-4 h-4 text-slate-400 shrink-0" />
                <div>
                  <div>{t('export.resourcePack')}</div>
                  <div className="text-[11px] text-slate-400">{t('export.resourcePackDesc')}</div>
                  <div className="text-[11px] text-slate-400">{t('export.resourcePackDesc')}</div>
                </div>
              </button>
            </div>
          )}
        </div>
      </header>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}

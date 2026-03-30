'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, Sparkles } from 'lucide-react';
import { TTS_PROVIDERS } from '@/lib/audio/constants';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { useAgentRegistry } from '@/lib/orchestration/registry/store';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import type {
  ComicPanelSpec,
  ComicSessionState,
  ComicGeneratedPage,
  ComicTTSSegment,
} from './types';

function buildImageHeaders() {
  const settings = useSettingsStore.getState();
  const providerConfig = settings.imageProvidersConfig?.[settings.imageProviderId];
  return {
    'Content-Type': 'application/json',
    'x-image-provider': settings.imageProviderId || '',
    'x-image-model': settings.imageModelId || '',
    'x-api-key': providerConfig?.apiKey || '',
    'x-base-url': providerConfig?.baseUrl || '',
  };
}

async function callImageApi(
  prompt: string,
  aspectRatio: string,
  style?: string,
  signal?: AbortSignal,
) {
  const res = await fetch('/api/generate/image', {
    method: 'POST',
    headers: buildImageHeaders(),
    body: JSON.stringify({ prompt, aspectRatio, style }),
    signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Image API returned ${res.status}`);
  }

  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Image generation failed');

  const url =
    data.result?.url || (data.result?.base64 ? `data:image/png;base64,${data.result.base64}` : '');
  if (!url) throw new Error('No image URL in response');
  return url as string;
}

function composeSinglePageComicPrompt(panelSpecs: ComicPanelSpec[], language: 'zh-CN' | 'en-US') {
  const frameLines = panelSpecs
    .map(
      (p, i) =>
        `${i + 1}. ${p.title}\nScene: ${p.prompt}${p.caption ? `\nCaption: ${p.caption}` : ''}${p.dialogue ? `\nDialogue: ${p.dialogue}` : ''}`,
    )
    .join('\n\n');

  return `Create ONE comic page image with ${panelSpecs.length} clearly separated manga panels.
Style direction: pure 2D cute Chinese cartoon-comic style with Japanese manga-style storytelling rhythm, colorful palette, flat/cel coloring, clean line art, expressive characters, high readability.
Character casting: students must be adorable little animals (cartoon style), NOT real human students.
Language for on-image text: ${language}.

Requirements:
- Single image only, not multiple images.
- Use dynamic, non-uniform panel layout (not rigid square grid).
- Include varied panel sizes/shapes and at least one angled or diagonal split panel.
- Keep gutters/borders clear between panels.
- Preserve story order from panel 1 to panel ${panelSpecs.length}.
- Text should be concise and readable.
- Add clear comic speech bubbles in relevant panels for dialogue.
- Pure 2D only: no photorealistic texture, no 3D rendering, no CGI look.

Panel storyboard:
${frameLines}`;
}

function buildModelHeaders() {
  const modelConfig = getCurrentModelConfig();
  return {
    'Content-Type': 'application/json',
    'x-model': modelConfig.modelString,
    'x-api-key': modelConfig.apiKey,
    'x-base-url': modelConfig.baseUrl,
  };
}

function buildComicTTSNarration(page: { title: string; panels: ComicPanelSpec[] }) {
  const lines = page.panels
    .map((panel, idx) => {
      const dialogue = panel.dialogue?.trim();
      const caption = panel.caption?.trim();
      if (!dialogue && !caption) return '';
      return `第${idx + 1}格：${dialogue || caption}`;
    })
    .filter(Boolean);

  if (lines.length === 0) return '';
  return `${page.title}。${lines.join('。')}`;
}

function buildComicTTSSegments(
  page: { title: string; panels: ComicPanelSpec[] },
  language: 'zh-CN' | 'en-US',
  speakerPool: string[],
): ComicTTSSegment[] {
  const fallbackSpeakers =
    speakerPool.length > 0
      ? speakerPool
      : language === 'zh-CN'
        ? ['小兔同学', '小猫同学', '小熊同学']
        : ['Bunny Student', 'Kitty Student', 'Bear Student'];

  const segments: ComicTTSSegment[] = [];
  let fallbackIndex = 0;

  for (let i = 0; i < page.panels.length; i++) {
    const panel = page.panels[i];
    const dialogue = panel.dialogue?.trim();
    const caption = panel.caption?.trim();

    if (dialogue) {
      const parts = dialogue
        .split(/[\n；;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const part of parts) {
        const m = part.match(/^([^:：]{1,20})[:：]\s*(.+)$/);
        if (m) {
          segments.push({ panelIndex: i + 1, speaker: m[1].trim(), text: m[2].trim() });
        } else {
          const speaker = fallbackSpeakers[fallbackIndex % fallbackSpeakers.length];
          fallbackIndex++;
          segments.push({ panelIndex: i + 1, speaker, text: part });
        }
      }
    }

    if (caption) {
      segments.push({
        panelIndex: i + 1,
        speaker: language === 'zh-CN' ? '旁白' : 'Narrator',
        text: caption,
      });
    }
  }

  return segments.filter((s) => !!s.text).slice(0, 12);
}

function assignVoicesToSegments(segments: ComicTTSSegment[]): ComicTTSSegment[] {
  const settings = useSettingsStore.getState();
  const providerVoices = TTS_PROVIDERS[settings.ttsProviderId]?.voices || [];
  const childKeywords = [
    'child',
    'kid',
    'young',
    'little',
    'xiao',
    '晓',
    '小',
    'nova',
    'shimmer',
    'jenny',
    'coral',
    'sage',
  ];

  const voices = providerVoices
    .map((v) => {
      const id = String(v.id || '');
      const name = String(v.name || '');
      const mix = `${id} ${name}`.toLowerCase();
      let score = 0;
      if (childKeywords.some((k) => mix.includes(k.toLowerCase()))) score += 3;
      if (v.gender === 'female' || v.gender === 'neutral') score += 1;
      return { id, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((v) => v.id)
    .filter(Boolean);

  if (voices.length === 0) return segments;

  const speakerVoice = new Map<string, string>();
  let cursor = 0;

  for (const seg of segments) {
    if (!speakerVoice.has(seg.speaker)) {
      speakerVoice.set(seg.speaker, voices[cursor % voices.length]);
      cursor++;
    }
  }

  return segments.map((seg) => ({
    ...seg,
    voice: speakerVoice.get(seg.speaker),
  }));
}

async function callTTSApi(
  text: string,
  audioId: string,
  signal?: AbortSignal,
  voice?: string,
  speed?: number,
) {
  const settings = useSettingsStore.getState();
  if (!settings.ttsEnabled) return null;
  if (!text.trim()) return null;
  if (settings.ttsProviderId === 'browser-native-tts') return null;

  const ttsProviderConfig = settings.ttsProvidersConfig?.[settings.ttsProviderId];
  const res = await fetch('/api/generate/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      audioId,
      ttsProviderId: settings.ttsProviderId,
      ttsVoice: voice || settings.ttsVoice,
      ttsSpeed: speed ?? settings.ttsSpeed,
      ttsApiKey: ttsProviderConfig?.apiKey || undefined,
      ttsBaseUrl: ttsProviderConfig?.baseUrl || undefined,
    }),
    signal,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success || !data.base64 || !data.format) {
    throw new Error(data.error || `TTS API returned ${res.status}`);
  }

  return `data:audio/${data.format};base64,${data.base64}` as string;
}

export default function ComicPreviewPage() {
  const router = useRouter();
  const { t } = useI18n();

  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const narratedPagesRef = useRef<Set<number>>(new Set());
  const narrationTokenRef = useRef(0);

  const [session, setSession] = useState<ComicSessionState | null>(null);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<ComicGeneratedPage[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasStopped, setHasStopped] = useState(false);

  const stopNarration = useCallback(() => {
    narrationTokenRef.current += 1;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const playNarrationForPage = useCallback(
    async (page: ComicGeneratedPage) => {
      const settings = useSettingsStore.getState();
      if (!settings.ttsEnabled) return;
      if (!page.ttsText?.trim() && (!page.ttsSegments || page.ttsSegments.length === 0)) return;

      stopNarration();
      const token = narrationTokenRef.current;

      const playAudioUrl = async (audioUrl: string) => {
        if (token !== narrationTokenRef.current) return;
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        await new Promise<void>((resolve) => {
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          audio.play().catch(() => resolve());
        });
      };

      if (page.ttsSegments && page.ttsSegments.length > 0) {
        const audioSegments = page.ttsSegments.filter((s) => !!s.audioUrl);
        if (audioSegments.length > 0) {
          let lastPanelIndex: number | null = null;
          for (const seg of audioSegments) {
            if (!seg.audioUrl) continue;
            if (lastPanelIndex != null && seg.panelIndex !== lastPanelIndex) {
              await new Promise<void>((resolve) => setTimeout(resolve, 3000));
              if (token !== narrationTokenRef.current) return;
            }
            await playAudioUrl(seg.audioUrl);
            if (token !== narrationTokenRef.current) return;
            lastPanelIndex = seg.panelIndex;
          }
          return;
        }
      }

      if (page.ttsAudioUrl) {
        await playAudioUrl(page.ttsAudioUrl);
        return;
      }

      if (
        settings.ttsProviderId === 'browser-native-tts' &&
        typeof window !== 'undefined' &&
        window.speechSynthesis
      ) {
        const segments =
          page.ttsSegments && page.ttsSegments.length > 0
            ? page.ttsSegments
            : [{ panelIndex: 1, speaker: 'Narrator', text: page.ttsText || '' }];
        const speechRate = Math.min(settings.ttsSpeed || 1, 0.72);
        const lang = session?.requirements.language === 'zh-CN' ? 'zh-CN' : 'en-US';
        const voices = window.speechSynthesis.getVoices();

        const pickBrowserVoice = (preferred?: string) => {
          const childKeys = ['child', 'kid', 'young', 'little', 'xiao', '晓', '小'];
          const direct = voices.find((v) => v.name === preferred || v.voiceURI === preferred);
          if (direct) return direct;
          const preferredLangVoices = voices.filter((v) =>
            lang === 'zh-CN' ? v.lang.includes('zh') : v.lang.includes('en'),
          );
          return (
            preferredLangVoices.find((v) =>
              childKeys.some((k) =>
                `${v.name} ${v.voiceURI}`.toLowerCase().includes(k.toLowerCase()),
              ),
            ) ||
            preferredLangVoices[0] ||
            voices[0]
          );
        };

        let lastPanelIndex: number | null = null;

        for (const seg of segments) {
          if (token !== narrationTokenRef.current) return;
          if (lastPanelIndex != null && seg.panelIndex !== lastPanelIndex) {
            await new Promise<void>((resolve) => setTimeout(resolve, 3000));
            if (token !== narrationTokenRef.current) return;
          }
          await new Promise<void>((resolve) => {
            const utterance = new SpeechSynthesisUtterance(seg.text);
            utterance.rate = speechRate;
            utterance.lang = lang;
            const voice = pickBrowserVoice(seg.voice || settings.ttsVoice);
            if (voice) utterance.voice = voice;
            utterance.onend = () => resolve();
            utterance.onerror = () => resolve();
            window.speechSynthesis.speak(utterance);
          });
          lastPanelIndex = seg.panelIndex;
        }
      }
    },
    [session?.requirements.language, stopNarration],
  );

  const canStart = useMemo(() => {
    const modelCfg = getCurrentModelConfig();
    return !!modelCfg?.modelString;
  }, []);

  useEffect(() => {
    const raw = sessionStorage.getItem('comicSession');
    if (!raw) {
      setError('Missing session');
      return;
    }
    try {
      const parsed = JSON.parse(raw) as ComicSessionState;
      setSession(parsed);
      if (Array.isArray(parsed.pages) && parsed.pages.length > 0) {
        setPages(parsed.pages);
        setCurrentPageIndex(parsed.pages.length - 1);
        setHasStopped(parsed.currentStep === 'complete');
      }
    } catch {
      setError('Invalid session');
    }
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      stopNarration();
    };
  }, [stopNarration]);

  useEffect(() => {
    const page = pages[currentPageIndex];
    if (!page) return;
    if (narratedPagesRef.current.has(page.pageIndex)) return;
    narratedPagesRef.current.add(page.pageIndex);
    void playNarrationForPage(page);
  }, [currentPageIndex, pages, playNarrationForPage]);

  useEffect(() => {
    if (!session || startedRef.current) return;
    startedRef.current = true;
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const start = async () => {
    if (!session) return;
    if (!canStart) {
      setError(t('settings.modelNotConfigured'));
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;

    setError(null);
    setPages([]);
    setCurrentPageIndex(0);
    setIsGenerating(true);
    setHasStopped(false);
    narratedPagesRef.current.clear();
    stopNarration();

    try {
      setStatus(
        session.requirements.language === 'zh-CN'
          ? '正在启动漫画生成…'
          : 'Starting comic generation…',
      );

      const settings = useSettingsStore.getState();
      const registry = useAgentRegistry.getState();
      const agentIds = (settings.selectedAgentIds || []).filter((id) => !!registry.getAgent(id));
      const agents = agentIds.map((id) => {
        const a = registry.getAgent(id)!;
        return { id: a.id, name: a.name, role: a.role, persona: a.persona };
      });

      const generatedPages: ComicGeneratedPage[] = [];
      const maxPages = 20;

      for (let pageIndex = 1; pageIndex <= maxPages; pageIndex++) {
        if (signal.aborted) return;

        setStatus(
          session.requirements.language === 'zh-CN'
            ? `正在规划第 ${pageIndex} 页…`
            : `Planning page ${pageIndex}…`,
        );

        const nextPageResp = await fetch('/api/generate/comic-next-page', {
          method: 'POST',
          headers: buildModelHeaders(),
          body: JSON.stringify({
            requirement: session.requirements.requirement,
            language: session.requirements.language,
            pageIndex,
            previousPages: generatedPages.map((p) => ({
              pageIndex: p.pageIndex,
              title: p.title,
              summary: p.panels.map((panel) => panel.title).join(' | '),
            })),
            agents,
          }),
          signal,
        });

        if (!nextPageResp.ok) {
          const d = await nextPageResp.json().catch(() => ({}));
          throw new Error(d.error || `Comic next-page API returned ${nextPageResp.status}`);
        }

        const nextPageData = await nextPageResp.json();
        if (!nextPageData.success) {
          throw new Error(nextPageData.error || 'Failed to generate next comic page');
        }

        if (!nextPageData.shouldContinue) {
          setHasStopped(true);
          setStatus(
            nextPageData.stopReason ||
              (session.requirements.language === 'zh-CN' ? '生成结束' : 'Generation stopped'),
          );
          break;
        }

        const page = nextPageData.page as { title: string; panels: ComicPanelSpec[] };
        if (!page?.panels || page.panels.length === 0) {
          throw new Error('No panels returned for page');
        }

        setStatus(
          session.requirements.language === 'zh-CN'
            ? `正在绘制第 ${pageIndex} 页…`
            : `Rendering page ${pageIndex}…`,
        );

        const combinedPrompt = composeSinglePageComicPrompt(
          page.panels,
          session.requirements.language,
        );
        const imageUrl = await callImageApi(combinedPrompt, '3:4', 'comic', signal);

        const ttsText = buildComicTTSNarration({
          title: page.title || `Page ${pageIndex}`,
          panels: page.panels,
        });
        const speakers = (session.agents || agents || []).map((a) => a.name).filter(Boolean);
        const baseSegments = buildComicTTSSegments(
          {
            title: page.title || `Page ${pageIndex}`,
            panels: page.panels,
          },
          session.requirements.language,
          speakers,
        );
        let ttsSegments = assignVoicesToSegments(baseSegments);
        let ttsAudioUrl: string | undefined;
        if (ttsSegments.length > 0) {
          try {
            setStatus(
              session.requirements.language === 'zh-CN'
                ? `正在生成第 ${pageIndex} 页配音…`
                : `Generating narration for page ${pageIndex}…`,
            );
            const slowSpeed = Math.min(useSettingsStore.getState().ttsSpeed || 1, 0.72);
            const withAudio: ComicTTSSegment[] = [];
            for (let i = 0; i < ttsSegments.length; i++) {
              const seg = ttsSegments[i];
              const audioDataUrl = await callTTSApi(
                seg.text,
                `comic_${session.sessionId}_page_${pageIndex}_seg_${i}`,
                signal,
                seg.voice,
                slowSpeed,
              );
              withAudio.push({
                ...seg,
                audioUrl: audioDataUrl || undefined,
              });
            }
            ttsSegments = withAudio;
            ttsAudioUrl = withAudio.find((seg) => !!seg.audioUrl)?.audioUrl;
          } catch {
            ttsSegments = ttsSegments.map((seg) => ({ ...seg, audioUrl: undefined }));
            ttsAudioUrl = undefined;
          }
        }

        const newPage: ComicGeneratedPage = {
          pageIndex,
          title: page.title || `Page ${pageIndex}`,
          panels: page.panels,
          imageUrl,
          ttsText,
          ttsAudioUrl,
          ttsSegments,
        };

        generatedPages.push(newPage);
        setPages([...generatedPages]);

        const updatedSession: ComicSessionState = {
          ...session,
          pages: [...generatedPages],
          currentStep: 'generating',
          agents,
        };
        setSession(updatedSession);
        sessionStorage.setItem('comicSession', JSON.stringify(updatedSession));
      }

      if (generatedPages.length >= maxPages) {
        setHasStopped(true);
        setStatus(
          session.requirements.language === 'zh-CN'
            ? `已达到最大页数 ${maxPages}，生成停止`
            : `Reached max pages (${maxPages}), generation stopped`,
        );
      }

      const finishedSession: ComicSessionState = {
        ...(session as ComicSessionState),
        pages: generatedPages,
        currentStep: 'complete',
        agents,
      };
      setSession(finishedSession);
      sessionStorage.setItem('comicSession', JSON.stringify(finishedSession));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatus('');
    } finally {
      setIsGenerating(false);
    }
  };

  const currentPage = pages[currentPageIndex];
  const canPrev = currentPageIndex > 0;
  const canNext = currentPageIndex < pages.length - 1;
  const showPreparing = pages.length === 0 && !error;

  return (
    <div className="relative min-h-[100dvh] w-full flex flex-col items-center justify-center p-4 text-center overflow-hidden">
      <div className="fixed inset-0 -z-10 bg-[url('/bg.png')] bg-cover bg-center bg-no-repeat pointer-events-none" />
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div
          className="absolute top-0 left-1/4 w-80 h-80 bg-sky-200/35 rounded-full blur-3xl animate-pulse"
          style={{ animationDuration: '4s' }}
        />
        <div
          className="absolute bottom-0 right-1/4 w-80 h-80 bg-orange-200/30 rounded-full blur-3xl animate-pulse"
          style={{ animationDuration: '6s' }}
        />
      </div>

      <div className="absolute top-4 left-4 z-20">
        <button
          onClick={() => router.push('/')}
          className="flex items-center gap-2 rounded-full bg-white/90 border-[3px] border-slate-900/70 px-4 py-2 text-sm font-black text-sky-700 hover:bg-sky-50"
        >
          <ArrowLeft className="size-4" />
          <span>{session?.requirements.language === 'zh-CN' ? '返回首页' : 'Back'}</span>
        </button>
      </div>

      <div className="z-10 w-full max-w-5xl space-y-5 flex flex-col items-center">
        <div className="relative w-full rounded-[34px] border-[4px] border-slate-900/80 bg-white/90 backdrop-blur-sm shadow-[0_2px_0_rgba(15,23,42,0.2)] p-5 md:p-7">
          <div className="flex justify-center gap-2 mb-5">
            {[
              status.includes('规划') || status.includes('Planning'),
              status.includes('绘制') || status.includes('Rendering'),
              status.includes('配音') || status.includes('narration'),
            ].map((active, idx) => (
              <div
                key={idx}
                className={`h-1.5 rounded-full transition-all duration-500 ${active ? 'w-8 bg-sky-500' : 'w-1.5 bg-sky-100'}`}
              />
            ))}
          </div>

          <div className="mb-5 space-y-2">
            <h2 className="text-2xl font-bold tracking-tight text-slate-800">
              {error
                ? session?.requirements.language === 'zh-CN'
                  ? '漫画生成失败'
                  : 'Comic generation failed'
                : showPreparing
                  ? session?.requirements.language === 'zh-CN'
                    ? '正在准备漫画世界'
                    : 'Preparing comic world'
                  : session?.requirements.language === 'zh-CN'
                    ? '漫画阅读'
                    : 'Comic Reader'}
            </h2>
            <p className="text-slate-500 text-sm md:text-base">
              {error
                ? error
                : status ||
                  (session?.requirements.language === 'zh-CN'
                    ? 'AI 正在编排剧情与画面…'
                    : 'AI is composing story and visuals...')}
            </p>
          </div>

          {/* <button
            onClick={() => start()}
            className="absolute right-8 top-8 rounded-full bg-orange-400 border-[3px] border-slate-900/75 px-4 py-2 text-sm font-black text-white hover:bg-orange-500"
          >
            {session?.requirements.language === 'zh-CN' ? '重新生成' : 'Regenerate'}
          </button> */}

          {error && (
            <div className="mt-3 rounded-xl border-[3px] border-slate-900/30 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {showPreparing && (
            <div className="mt-4 min-h-[320px] flex flex-col items-center justify-center gap-4">
              <div className="size-28 rounded-full bg-sky-100/70 border-[3px] border-slate-900/70 flex items-center justify-center relative">
                <Loader2 className="size-10 animate-spin text-sky-500" />
                <Sparkles className="absolute -top-1 -right-1 size-5 text-orange-500 animate-pulse" />
              </div>
              <div className="flex items-center gap-2 text-slate-500 text-sm font-semibold">
                <span className="inline-block size-2 rounded-full bg-sky-400 animate-pulse" />
                <span className="inline-block size-2 rounded-full bg-sky-300 animate-pulse [animation-delay:120ms]" />
                <span className="inline-block size-2 rounded-full bg-sky-200 animate-pulse [animation-delay:240ms]" />
              </div>
              <p className="text-sm text-slate-600">
                {session?.requirements.language === 'zh-CN'
                  ? '准备中… 小动物同学们正在入场'
                  : 'Preparing... cute animal students are entering'}
              </p>
            </div>
          )}

          {pages.length > 0 && currentPage && (
            <div className="mt-2">
              <div className="rounded-2xl border-[3px] border-slate-900/70 bg-white overflow-hidden">
                <div className="aspect-[3/4] bg-slate-50 flex items-center justify-center relative">
                  {currentPage.imageUrl ? (
                    <img
                      src={currentPage.imageUrl}
                      alt={currentPage.title}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <Loader2 className="size-6 animate-spin text-slate-400" />
                  )}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-center gap-2">
                <button
                  onClick={() => canPrev && setCurrentPageIndex((v) => Math.max(0, v - 1))}
                  disabled={!canPrev}
                  className="rounded-xl bg-white border-[3px] border-slate-900/70 px-3 py-2 text-sm font-black text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="flex items-center gap-1">
                    <ChevronLeft className="size-4" />
                    {session?.requirements.language === 'zh-CN' ? '上一页' : 'Prev'}
                  </span>
                </button>
                <div className="rounded-xl bg-white border-[3px] border-slate-900/70 px-3 py-2 text-xs font-black text-slate-700">
                  {pages.length > 0
                    ? ` ${currentPageIndex + 1} / ${pages.length}`
                    : session?.requirements.language === 'zh-CN'
                      ? '等待生成'
                      : 'Waiting'}
                </div>
                <button
                  onClick={() =>
                    canNext && setCurrentPageIndex((v) => Math.min(pages.length - 1, v + 1))
                  }
                  disabled={!canNext}
                  className="rounded-xl bg-white border-[3px] border-slate-900/70 px-3 py-2 text-sm font-black text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="flex items-center gap-1">
                    {session?.requirements.language === 'zh-CN' ? '下一页' : 'Next'}
                    <ChevronRight className="size-4" />
                  </span>
                </button>
              </div>

              <div className="mt-2 text-center text-xs text-slate-600 font-medium">
                {isGenerating
                  ? session?.requirements.language === 'zh-CN'
                    ? 'AI 正在继续生成后续页…'
                    : 'AI is generating next pages…'
                  : hasStopped
                    ? session?.requirements.language === 'zh-CN'
                      ? 'AI 已停止生成'
                      : 'AI generation stopped'
                    : null}
              </div>

              {currentPage.title && (
                <div className="mt-2 text-center text-sm font-black text-slate-800">
                  {currentPage.title}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="h-12 flex items-center justify-center w-full">
          <div className="flex items-center gap-3 text-sm text-slate-500 font-medium uppercase tracking-widest">
            <Sparkles className="size-3 animate-pulse text-orange-500" />
            {session?.requirements.language === 'zh-CN' ? 'AI 正在创作中' : 'AI IS CREATING'}
          </div>
        </div>
      </div>
    </div>
  );
}

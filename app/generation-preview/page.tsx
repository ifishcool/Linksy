'use client';

import { useCallback, useEffect, useState, Suspense, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  CheckCircle2,
  Sparkles,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Bot,
  Copy,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useStageStore } from '@/lib/store/stage';
import { useSettingsStore } from '@/lib/store/settings';
import { useAgentRegistry } from '@/lib/orchestration/registry/store';
import { getAvailableProvidersWithVoices } from '@/lib/audio/voice-resolver';
import { useI18n } from '@/lib/hooks/use-i18n';
import {
  loadImageMapping,
  loadPdfBlob,
  cleanupOldImages,
  storeImages,
} from '@/lib/utils/image-storage';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import { db } from '@/lib/utils/database';
import { MAX_PDF_CONTENT_CHARS, MAX_VISION_IMAGES } from '@/lib/constants/generation';
import { nanoid } from 'nanoid';
import type { Stage } from '@/lib/types/stage';
import type { SceneOutline, PdfImage, ImageMapping } from '@/lib/types/generation';
import { AgentRevealModal } from '@/components/agent/agent-reveal-modal';
import { createLogger } from '@/lib/logger';
import { type GenerationSessionState, ALL_STEPS, getActiveSteps } from './types';
import { StepVisualizer } from './components/visualizers';

const log = createLogger('GenerationPreview');
const PREVIEW_TTS_CONCURRENCY = 4;
const PREVIEW_QWEN_TTS_CONCURRENCY = 2;
const PREVIEW_TTS_RETRY_MAX = 2;
const PREVIEW_TTS_RETRY_BASE_MS = 1200;

function isRetryableTTSFailure(
  status: number | 'ERR',
  payload?: unknown,
  message?: string,
): boolean {
  if (status === 429 || status === 503) return true;
  const text =
    `${message || ''} ${typeof payload === 'string' ? payload : JSON.stringify(payload || {})}`.toLowerCase();
  return (
    text.includes('ratequota') ||
    text.includes('rate limit') ||
    text.includes('throttling') ||
    text.includes('too many requests') ||
    text.includes('concurrency quota')
  );
}

async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
    return;
  }

  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function GenerationPreviewContent() {
  const router = useRouter();
  const { t } = useI18n();
  const hasStartedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [session, setSession] = useState<GenerationSessionState | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isComplete] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [streamingOutlines, setStreamingOutlines] = useState<SceneOutline[] | null>(null);
  const [truncationWarnings, setTruncationWarnings] = useState<string[]>([]);
  const [generationLogs, setGenerationLogs] = useState<string[]>([]);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [webSearchSources, setWebSearchSources] = useState<Array<{ title: string; url: string }>>(
    [],
  );
  const [showAgentReveal, setShowAgentReveal] = useState(false);
  const [generatedAgents, setGeneratedAgents] = useState<
    Array<{
      id: string;
      name: string;
      role: string;
      persona: string;
      avatar: string;
      color: string;
      priority: number;
    }>
  >([]);
  const agentRevealResolveRef = useRef<(() => void) | null>(null);

  const pushGenerationLog = useCallback(
    (scope: string, message: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO') => {
      const timestamp = new Date().toISOString();
      setGenerationLogs((prev) => {
        const next = [`[${timestamp}] [${level}] [${scope}] ${message}`, ...prev];
        return next.slice(0, 150);
      });
    },
    [],
  );

  const formatDuration = useCallback((durationMs: number) => {
    if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
    return `${(durationMs / 1000).toFixed(1)}s`;
  }, []);

  const pushNextApiLine = useCallback(
    (method: 'GET' | 'POST', path: string, status: number | 'ERR', durationMs: number) => {
      const renderDuration = formatDuration(durationMs);
      setGenerationLogs((prev) => {
        const next = [
          `${method} ${path} ${status} in ${renderDuration} (compile: n/a, render: ${renderDuration})`,
          ...prev,
        ];
        return next.slice(0, 150);
      });
    },
    [formatDuration],
  );

  const stringifyErrorPayload = useCallback((payload: unknown) => {
    if (!payload) return '';
    try {
      const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
      return raw.length > 1200 ? `${raw.slice(0, 1200)}...` : raw;
    } catch {
      return String(payload);
    }
  }, []);

  const handleCopyLogs = useCallback(async () => {
    if (!generationLogs.length) return;
    try {
      await navigator.clipboard.writeText(generationLogs.join('\n'));
      setCopiedLogs(true);
      setTimeout(() => setCopiedLogs(false), 1500);
    } catch {
      setCopiedLogs(false);
    }
  }, [generationLogs]);

  const renderTokenizedText = useCallback((line: string) => {
    const tokenRegex =
      /(\b(?:200|201|204|400|401|403|404|429|500|502|503|ERR)\b|\b(?:INFO|WARN|ERROR|POST|GET|failed|error|warning)\b)/gi;

    return line.split(tokenRegex).map((chunk, idx) => {
      if (!chunk) return null;
      const token = chunk.toLowerCase();

      let cls = '';
      if (/^20\d$/.test(chunk)) cls = 'text-emerald-700 font-semibold';
      else if (/^[45]\d\d$/.test(chunk) || token === 'err') cls = 'text-red-600 font-semibold';
      else if (token === 'error' || token === 'failed') cls = 'text-red-600 font-semibold';
      else if (token === 'warn' || token === 'warning') cls = 'text-amber-600 font-semibold';
      else if (token === 'info') cls = 'text-sky-700 font-semibold';
      else if (token === 'post' || token === 'get') cls = 'text-violet-700 font-semibold';

      return (
        <span key={`${chunk}-${idx}`} className={cls}>
          {chunk}
        </span>
      );
    });
  }, []);

  const renderJsonSegment = useCallback((jsonText: string) => {
    let pretty = jsonText;
    try {
      const parsed = JSON.parse(jsonText);
      pretty = JSON.stringify(parsed, null, 2);
    } catch {
      return <span className="text-red-600">{jsonText}</span>;
    }

    const jsonTokenRegex =
      /(\"(?:\\.|[^\"])*\"(?=\s*:))|(\"(?:\\.|[^\"])*\")|\b(true|false|null)\b|\b-?\d+(?:\.\d+)?\b|([{}\[\],:])/g;
    const segments: ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let index = 0;

    while ((match = jsonTokenRegex.exec(pretty)) !== null) {
      if (match.index > lastIndex) {
        segments.push(<span key={`t-${index++}`}>{pretty.slice(lastIndex, match.index)}</span>);
      }

      const token = match[0];
      let cls = 'text-slate-700';
      if (match[1]) cls = 'text-blue-700 font-semibold';
      else if (match[2]) cls = 'text-emerald-700';
      else if (match[3]) cls = 'text-violet-700 font-semibold';
      else if (/^-?\d/.test(token)) cls = 'text-amber-700 font-semibold';
      else if (match[4]) cls = 'text-slate-500';

      segments.push(
        <span key={`m-${index++}`} className={cls}>
          {token}
        </span>,
      );
      lastIndex = jsonTokenRegex.lastIndex;
    }

    if (lastIndex < pretty.length) {
      segments.push(<span key={`t-${index++}`}>{pretty.slice(lastIndex)}</span>);
    }

    return (
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-slate-100 px-2 py-1 text-[10px] leading-4 text-slate-700">
        {segments}
      </pre>
    );
  }, []);

  const renderHighlightedLogLine = useCallback(
    (line: string) => {
      const jsonStart = line.indexOf('{');
      const jsonEnd = line.lastIndexOf('}');

      if (jsonStart === -1 || jsonEnd <= jsonStart) {
        return renderTokenizedText(line);
      }

      const prefix = line.slice(0, jsonStart);
      const jsonText = line.slice(jsonStart, jsonEnd + 1);
      const suffix = line.slice(jsonEnd + 1);

      return (
        <>
          <span>{renderTokenizedText(prefix)}</span>
          {renderJsonSegment(jsonText)}
          {suffix ? <span>{renderTokenizedText(suffix)}</span> : null}
        </>
      );
    },
    [renderJsonSegment, renderTokenizedText],
  );

  // Compute active steps based on session state
  const activeSteps = getActiveSteps(session);

  // Load session from sessionStorage
  useEffect(() => {
    cleanupOldImages(24).catch((e) => log.error(e));

    const saved = sessionStorage.getItem('generationSession');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as GenerationSessionState;
        setSession(parsed);
      } catch (e) {
        log.error('Failed to parse generation session:', e);
      }
    }
    setSessionLoaded(true);
  }, []);

  // Abort all in-flight requests on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // Get API credentials from localStorage
  const getApiHeaders = () => {
    const modelConfig = getCurrentModelConfig();
    const settings = useSettingsStore.getState();
    const imageProviderConfig = settings.imageProvidersConfig?.[settings.imageProviderId];
    const videoProviderConfig = settings.videoProvidersConfig?.[settings.videoProviderId];
    return {
      'Content-Type': 'application/json',
      'x-model': modelConfig.modelString,
      'x-api-key': modelConfig.apiKey,
      'x-base-url': modelConfig.baseUrl,
      'x-provider-type': modelConfig.providerType || '',
      'x-requires-api-key': modelConfig.requiresApiKey ? 'true' : 'false',
      // Image generation provider
      'x-image-provider': settings.imageProviderId || '',
      'x-image-model': settings.imageModelId || '',
      'x-image-api-key': imageProviderConfig?.apiKey || '',
      'x-image-base-url': imageProviderConfig?.baseUrl || '',
      // Video generation provider
      'x-video-provider': settings.videoProviderId || '',
      'x-video-model': settings.videoModelId || '',
      'x-video-api-key': videoProviderConfig?.apiKey || '',
      'x-video-base-url': videoProviderConfig?.baseUrl || '',
      // Media generation toggles
      'x-image-generation-enabled': String(settings.imageGenerationEnabled ?? false),
      'x-video-generation-enabled': String(settings.videoGenerationEnabled ?? false),
    };
  };

  // Auto-start generation when session is loaded
  useEffect(() => {
    if (session && !hasStartedRef.current) {
      hasStartedRef.current = true;
      startGeneration();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Main generation flow
  const startGeneration = async () => {
    if (!session) return;

    // Create AbortController for this generation run
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const signal = controller.signal;

    // Use a local mutable copy so we can update it after PDF parsing
    let currentSession = session;

    setError(null);
    setCurrentStepIndex(0);
    setGenerationLogs([]);
    pushGenerationLog('Generation Preview', 'Generation started');

    try {
      // Compute active steps for this session (recomputed after session mutations)
      let activeSteps = getActiveSteps(currentSession);

      // Determine if we need the PDF analysis step
      const hasPdfToAnalyze = !!currentSession.pdfStorageKey && !currentSession.pdfText;
      pushGenerationLog(
        'PDF Parse API',
        hasPdfToAnalyze ? 'Parsing PDF started' : 'Parsing PDF skipped (already parsed)',
      );
      // If no PDF to analyze, skip to the next available step
      if (!hasPdfToAnalyze) {
        const firstNonPdfIdx = activeSteps.findIndex((s) => s.id !== 'pdf-analysis');
        setCurrentStepIndex(Math.max(0, firstNonPdfIdx));
      }

      // Step 0: Parse PDF if needed
      if (hasPdfToAnalyze) {
        log.debug('=== Generation Preview: Parsing PDF ===');
        const pdfBlob = await loadPdfBlob(currentSession.pdfStorageKey!);
        if (!pdfBlob) {
          throw new Error(t('generation.pdfLoadFailed'));
        }

        // Ensure pdfBlob is a valid Blob with content
        if (!(pdfBlob instanceof Blob) || pdfBlob.size === 0) {
          log.error('Invalid PDF blob:', {
            type: typeof pdfBlob,
            size: pdfBlob instanceof Blob ? pdfBlob.size : 'N/A',
          });
          throw new Error(t('generation.pdfLoadFailed'));
        }

        // Wrap as a File to guarantee multipart/form-data with correct content-type
        const pdfFile = new File([pdfBlob], currentSession.pdfFileName || 'document.pdf', {
          type: 'application/pdf',
        });

        const parseFormData = new FormData();
        parseFormData.append('pdf', pdfFile);

        if (currentSession.pdfProviderId) {
          parseFormData.append('providerId', currentSession.pdfProviderId);
        }
        if (currentSession.pdfProviderConfig?.apiKey?.trim()) {
          parseFormData.append('apiKey', currentSession.pdfProviderConfig.apiKey);
        }
        if (currentSession.pdfProviderConfig?.baseUrl?.trim()) {
          parseFormData.append('baseUrl', currentSession.pdfProviderConfig.baseUrl);
        }

        const parseStart = performance.now();
        const parseResponse = await fetch('/api/parse-pdf', {
          method: 'POST',
          body: parseFormData,
          signal,
        });
        pushNextApiLine(
          'POST',
          '/api/parse-pdf',
          parseResponse.status,
          performance.now() - parseStart,
        );

        if (!parseResponse.ok) {
          const errorData = await parseResponse.json().catch(() => ({ error: 'Parse PDF failed' }));
          pushGenerationLog(
            'PDF Parse API',
            `PDF parse error payload: ${stringifyErrorPayload(errorData)}`,
            'ERROR',
          );
          throw new Error(errorData.error || t('generation.pdfParseFailed'));
        }

        const parseResult = await parseResponse.json();
        if (!parseResult.success || !parseResult.data) {
          throw new Error(t('generation.pdfParseFailed'));
        }

        pushGenerationLog('PDF Parse API', 'PDF parsed successfully');

        let pdfText = parseResult.data.text as string;

        // Truncate if needed
        if (pdfText.length > MAX_PDF_CONTENT_CHARS) {
          pdfText = pdfText.substring(0, MAX_PDF_CONTENT_CHARS);
        }

        // Create image metadata and store images
        // Prefer metadata.pdfImages (both parsers now return this)
        const rawPdfImages = parseResult.data.metadata?.pdfImages;
        const images = rawPdfImages
          ? rawPdfImages.map(
              (img: {
                id: string;
                src?: string;
                pageNumber?: number;
                description?: string;
                width?: number;
                height?: number;
              }) => ({
                id: img.id,
                src: img.src || '',
                pageNumber: img.pageNumber || 1,
                description: img.description,
                width: img.width,
                height: img.height,
              }),
            )
          : (parseResult.data.images as string[]).map((src: string, i: number) => ({
              id: `img_${i + 1}`,
              src,
              pageNumber: 1,
            }));

        const imageStorageIds = await storeImages(images);

        const pdfImages: PdfImage[] = images.map(
          (
            img: {
              id: string;
              src: string;
              pageNumber: number;
              description?: string;
              width?: number;
              height?: number;
            },
            i: number,
          ) => ({
            id: img.id,
            src: '',
            pageNumber: img.pageNumber,
            description: img.description,
            width: img.width,
            height: img.height,
            storageId: imageStorageIds[i],
          }),
        );

        // Update session with parsed PDF data
        const updatedSession = {
          ...currentSession,
          pdfText,
          pdfImages,
          imageStorageIds,
          pdfStorageKey: undefined, // Clear so we don't re-parse
        };
        setSession(updatedSession);
        sessionStorage.setItem('generationSession', JSON.stringify(updatedSession));

        // Truncation warnings
        const warnings: string[] = [];
        if ((parseResult.data.text as string).length > MAX_PDF_CONTENT_CHARS) {
          warnings.push(t('generation.textTruncated', { n: MAX_PDF_CONTENT_CHARS }));
        }
        if (images.length > MAX_VISION_IMAGES) {
          warnings.push(
            t('generation.imageTruncated', { total: images.length, max: MAX_VISION_IMAGES }),
          );
        }
        if (warnings.length > 0) {
          setTruncationWarnings(warnings);
          pushGenerationLog(
            'Generation Preview',
            `Truncation warnings: ${warnings.length}`,
            'WARN',
          );
        }

        // Reassign local reference for subsequent steps
        currentSession = updatedSession;
        activeSteps = getActiveSteps(currentSession);
      }

      // Step: Web Search (if enabled)
      const webSearchStepIdx = activeSteps.findIndex((s) => s.id === 'web-search');
      if (currentSession.requirements.webSearch && webSearchStepIdx >= 0) {
        pushGenerationLog('Web Search API', 'Web search started');
        setCurrentStepIndex(webSearchStepIdx);
        setWebSearchSources([]);

        const wsSettings = useSettingsStore.getState();
        const wsApiKey =
          wsSettings.webSearchProvidersConfig?.[wsSettings.webSearchProviderId]?.apiKey;
        const webSearchStart = performance.now();
        const res = await fetch('/api/web-search', {
          method: 'POST',
          headers: getApiHeaders(),
          body: JSON.stringify({
            query: currentSession.requirements.requirement,
            pdfText: currentSession.pdfText || undefined,
            apiKey: wsApiKey || undefined,
          }),
          signal,
        });
        pushNextApiLine('POST', '/api/web-search', res.status, performance.now() - webSearchStart);

        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: 'Web search failed' }));
          pushGenerationLog(
            'Web Search API',
            `Web search error payload: ${stringifyErrorPayload(data)}`,
            'ERROR',
          );
          throw new Error(data.error || t('generation.webSearchFailed'));
        }

        const searchData = await res.json();
        const sources = (searchData.sources || []).map((s: { title: string; url: string }) => ({
          title: s.title,
          url: s.url,
        }));
        setWebSearchSources(sources);
        pushGenerationLog('Web Search API', `Web search completed, sources=${sources.length}`);

        const updatedSessionWithSearch = {
          ...currentSession,
          researchContext: searchData.context || '',
          researchSources: sources,
        };
        setSession(updatedSessionWithSearch);
        sessionStorage.setItem('generationSession', JSON.stringify(updatedSessionWithSearch));
        currentSession = updatedSessionWithSearch;
        activeSteps = getActiveSteps(currentSession);
      }

      // Load imageMapping early (needed for both outline and scene generation)
      let imageMapping: ImageMapping = {};
      if (currentSession.imageStorageIds && currentSession.imageStorageIds.length > 0) {
        log.debug('Loading images from IndexedDB');
        imageMapping = await loadImageMapping(currentSession.imageStorageIds);
        pushGenerationLog(
          'Generation Preview',
          `Image mapping loaded from IndexedDB (${Object.keys(imageMapping).length})`,
        );
      } else if (
        currentSession.imageMapping &&
        Object.keys(currentSession.imageMapping).length > 0
      ) {
        log.debug('Using imageMapping from session (old format)');
        imageMapping = currentSession.imageMapping;
        pushGenerationLog(
          'Generation Preview',
          `Image mapping loaded from session (${Object.keys(imageMapping).length})`,
        );
      }

      // ── Agent generation (before outlines so persona can influence structure) ──
      const settings = useSettingsStore.getState();
      let agents: Array<{
        id: string;
        name: string;
        role: string;
        persona?: string;
      }> = [];

      // Create stage client-side (needed for agent generation stageId)
      const stageId = nanoid(10);
      const stage: Stage = {
        id: stageId,
        name: extractTopicFromRequirement(currentSession.requirements.requirement),
        description: '',
        language: currentSession.requirements.language || 'zh-CN',
        style: 'professional',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      if (settings.agentMode === 'auto') {
        pushGenerationLog(
          'Agent Profiles API',
          `Generating agent profiles for "${extractTopicFromRequirement(currentSession.requirements.requirement)}" [model=${getCurrentModelConfig().modelString}]`,
        );
        const agentStepIdx = activeSteps.findIndex((s) => s.id === 'agent-generation');
        if (agentStepIdx >= 0) setCurrentStepIndex(agentStepIdx);

        try {
          const allAvatars = [
            {
              path: '/avatars/teacher.png',
              desc: 'Male teacher with glasses, holding a book, green background',
            },
            {
              path: '/avatars/teacher-2.png',
              desc: 'Female teacher with long dark hair, blue traditional outfit, gentle expression',
            },
            {
              path: '/avatars/assist.png',
              desc: 'Young female assistant with glasses, pink background, friendly smile',
            },
            {
              path: '/avatars/assist-2.png',
              desc: 'Young female in orange top and purple overalls, cheerful and approachable',
            },
            {
              path: '/avatars/clown.png',
              desc: 'Energetic girl with glasses pointing up, green shirt, lively and fun',
            },
            {
              path: '/avatars/clown-2.png',
              desc: 'Playful girl with curly hair doing rock gesture, blue shirt, humorous vibe',
            },
            {
              path: '/avatars/curious.png',
              desc: 'Surprised boy with glasses, hand on cheek, curious expression',
            },
            {
              path: '/avatars/curious-2.png',
              desc: 'Boy with backpack holding a book and question mark bubble, inquisitive',
            },
            {
              path: '/avatars/note-taker.png',
              desc: 'Studious boy with glasses, blue shirt, calm and organized',
            },
            {
              path: '/avatars/note-taker-2.png',
              desc: 'Active boy with yellow backpack waving, blue outfit, enthusiastic learner',
            },
            {
              path: '/avatars/thinker.png',
              desc: 'Thoughtful girl with hand on chin, purple background, contemplative',
            },
            {
              path: '/avatars/thinker-2.png',
              desc: 'Girl reading a book intently, long dark hair, intellectual and focused',
            },
          ];

          const getAvailableVoicesForGeneration = () => {
            const providers = getAvailableProvidersWithVoices(settings.ttsProvidersConfig);
            return providers.flatMap((p) =>
              p.voices.map((v) => ({
                providerId: p.providerId,
                voiceId: v.id,
                voiceName: v.name,
              })),
            );
          };

          // No outlines yet — agent generation uses only stage name + description
          const agentProfilesStart = performance.now();
          const agentResp = await fetch('/api/generate/agent-profiles', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({
              stageInfo: { name: stage.name, description: stage.description },
              language: currentSession.requirements.language || 'zh-CN',
              availableAvatars: allAvatars.map((a) => a.path),
              avatarDescriptions: allAvatars.map((a) => ({ path: a.path, desc: a.desc })),
              availableVoices: getAvailableVoicesForGeneration(),
            }),
            signal,
          });
          pushNextApiLine(
            'POST',
            '/api/generate/agent-profiles',
            agentResp.status,
            performance.now() - agentProfilesStart,
          );

          if (!agentResp.ok) {
            const errData = await agentResp
              .json()
              .catch(() => ({ error: `Agent generation failed: HTTP ${agentResp.status}` }));
            pushGenerationLog(
              'Agent Profiles API',
              `Agent profiles generation error: ${stringifyErrorPayload(errData)}`,
              'ERROR',
            );
            throw new Error(errData.error || 'Agent generation failed');
          }
          const agentData = await agentResp.json();
          if (!agentData.success) throw new Error(agentData.error || 'Agent generation failed');

          // Save to IndexedDB and registry
          const { saveGeneratedAgents } = await import('@/lib/orchestration/registry/store');
          const savedIds = await saveGeneratedAgents(stage.id, agentData.agents);
          settings.setSelectedAgentIds(savedIds);
          stage.agentIds = savedIds;

          // Show card-reveal modal, continue generation once all cards are revealed
          setGeneratedAgents(agentData.agents);
          setShowAgentReveal(true);
          await new Promise<void>((resolve) => {
            agentRevealResolveRef.current = resolve;
          });

          agents = savedIds
            .map((id) => useAgentRegistry.getState().getAgent(id))
            .filter(Boolean)
            .map((a) => ({
              id: a!.id,
              name: a!.name,
              role: a!.role,
              persona: a!.persona,
            }));
          pushGenerationLog(
            'Agent Profiles API',
            `Successfully generated ${agents.length} agent profiles for "${extractTopicFromRequirement(currentSession.requirements.requirement)}"`,
          );
        } catch (err: unknown) {
          log.warn('[Generation] Agent generation failed, falling back to presets:', err);
          pushGenerationLog(
            'Agent Profiles API',
            `Auto-generation failed, fallback to presets: ${err instanceof Error ? err.message : String(err)}`,
            'WARN',
          );
          const registry = useAgentRegistry.getState();
          const fallbackIds = settings.selectedAgentIds.filter((id) => {
            const a = registry.getAgent(id);
            return a && !a.isGenerated;
          });
          const safeFallbackIds =
            fallbackIds.length > 0
              ? fallbackIds
              : ['default-1', 'default-2', 'default-3'].filter((id) => {
                  const a = registry.getAgent(id);
                  return a && !a.isGenerated;
                });
          agents = safeFallbackIds
            .map((id) => registry.getAgent(id))
            .filter(Boolean)
            .map((a) => ({
              id: a!.id,
              name: a!.name,
              role: a!.role,
              persona: a!.persona,
            }));
          stage.agentIds = safeFallbackIds;
          pushGenerationLog(
            'Generation Preview',
            `Using preset fallback agents (${agents.length})`,
            'WARN',
          );
        }
      } else {
        pushGenerationLog('Generation Preview', 'Using preset agents');
        // Preset mode — use selected agents (include persona)
        // Filter out stale generated agent IDs that may linger in settings
        const registry = useAgentRegistry.getState();
        const presetAgentIds = settings.selectedAgentIds.filter((id) => {
          const a = registry.getAgent(id);
          return a && !a.isGenerated;
        });
        const safePresetAgentIds =
          presetAgentIds.length > 0
            ? presetAgentIds
            : ['default-1', 'default-2', 'default-3'].filter((id) => {
                const a = registry.getAgent(id);
                return a && !a.isGenerated;
              });
        agents = safePresetAgentIds
          .map((id) => registry.getAgent(id))
          .filter(Boolean)
          .map((a) => ({
            id: a!.id,
            name: a!.name,
            role: a!.role,
            persona: a!.persona,
          }));
        stage.agentIds = safePresetAgentIds;
        pushGenerationLog('Generation Preview', `Preset agents loaded (${agents.length})`);
      }

      // ── Generate outlines (with agent personas for teacher context) ──
      let outlines = currentSession.sceneOutlines;

      const outlineStepIdx = activeSteps.findIndex((s) => s.id === 'outline');
      setCurrentStepIndex(outlineStepIdx >= 0 ? outlineStepIdx : 0);
      if (!outlines || outlines.length === 0) {
        pushGenerationLog(
          'Outlines Stream',
          `Generating outlines: "${extractTopicFromRequirement(currentSession.requirements.requirement)}" [model=${getCurrentModelConfig().modelString}]`,
        );
        log.debug('=== Generating outlines (SSE) ===');
        setStreamingOutlines([]);

        outlines = await new Promise<SceneOutline[]>((resolve, reject) => {
          const collected: SceneOutline[] = [];

          const outlinesStart = performance.now();
          fetch('/api/generate/scene-outlines-stream', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({
              requirements: currentSession.requirements,
              pdfText: currentSession.pdfText,
              pdfImages: currentSession.pdfImages,
              imageMapping,
              researchContext: currentSession.researchContext,
              agents,
            }),
            signal,
          })
            .then((res) => {
              pushNextApiLine(
                'POST',
                '/api/generate/scene-outlines-stream',
                res.status,
                performance.now() - outlinesStart,
              );
              if (!res.ok) {
                return res.json().then((d) => {
                  pushGenerationLog(
                    'Outlines Stream',
                    `Outlines stream error payload: ${stringifyErrorPayload(d)}`,
                    'ERROR',
                  );
                  reject(new Error(d.error || t('generation.outlineGenerateFailed')));
                });
              }

              const reader = res.body?.getReader();
              if (!reader) {
                reject(new Error(t('generation.streamNotReadable')));
                return;
              }

              const decoder = new TextDecoder();
              let sseBuffer = '';

              const pump = (): Promise<void> =>
                reader.read().then(({ done, value }) => {
                  if (value) {
                    sseBuffer += decoder.decode(value, { stream: !done });
                    const lines = sseBuffer.split('\n');
                    sseBuffer = lines.pop() || '';

                    for (const line of lines) {
                      if (!line.startsWith('data: ')) continue;
                      try {
                        const evt = JSON.parse(line.slice(6));
                        if (evt.type === 'outline') {
                          collected.push(evt.data);
                          setStreamingOutlines([...collected]);
                        } else if (evt.type === 'retry') {
                          const attempt = evt.attempt ?? evt.retryCount ?? '?';
                          const maxAttempts = evt.maxAttempts ?? evt.totalAttempts ?? '?';
                          pushGenerationLog(
                            'Outlines Stream',
                            `Empty outlines (attempt ${attempt}/${maxAttempts}), retrying...`,
                            'WARN',
                          );
                          collected.length = 0;
                          setStreamingOutlines([]);
                          setStatusMessage(t('generation.outlineRetrying'));
                        } else if (evt.type === 'done') {
                          resolve(evt.outlines || collected);
                          return;
                        } else if (evt.type === 'error') {
                          pushGenerationLog(
                            'Outlines Stream',
                            `Outline generation failed event: ${stringifyErrorPayload(evt)}`,
                            'ERROR',
                          );
                          reject(new Error(evt.error));
                          return;
                        }
                      } catch (e) {
                        log.error('Failed to parse outline SSE:', line, e);
                      }
                    }
                  }
                  if (done) {
                    if (collected.length > 0) {
                      resolve(collected);
                    } else {
                      reject(new Error(t('generation.outlineEmptyResponse')));
                    }
                    return;
                  }
                  return pump();
                });

              pump().catch(reject);
            })
            .catch(reject);
        });

        const updatedSession = { ...currentSession, sceneOutlines: outlines };
        setSession(updatedSession);
        sessionStorage.setItem('generationSession', JSON.stringify(updatedSession));
        pushGenerationLog('Outlines Stream', `Generated ${outlines.length} outlines`);

        // Outline generation succeeded — clear homepage draft cache
        try {
          localStorage.removeItem('requirementDraft');
        } catch {
          /* ignore */
        }

        // Brief pause to let user see the final outline state
        await new Promise((resolve) => setTimeout(resolve, 800));
      }

      // Move to scene generation step
      setStatusMessage('');
      if (!outlines || outlines.length === 0) {
        throw new Error(t('generation.outlineEmptyResponse'));
      }

      // Store stage and outlines
      const store = useStageStore.getState();
      store.setStage(stage);
      store.setOutlines(outlines);

      // Generate ONLY the first scene
      store.setGeneratingOutlines(outlines);
      const firstOutline = outlines[0];

      // Advance to slide-content step
      const contentStepIdx = activeSteps.findIndex((s) => s.id === 'slide-content');
      if (contentStepIdx >= 0) setCurrentStepIndex(contentStepIdx);
      pushGenerationLog(
        'Scene Content API',
        `Generating content: "${firstOutline.title}" (${firstOutline.type}) [model=${getCurrentModelConfig().modelString}]`,
      );

      // Build stageInfo and userProfile for API call
      const stageInfo = {
        name: stage.name,
        description: stage.description,
        language: stage.language,
        style: stage.style,
      };

      const userProfile =
        currentSession.requirements.userNickname || currentSession.requirements.userBio
          ? `Student: ${currentSession.requirements.userNickname || 'Unknown'}${currentSession.requirements.userBio ? ` — ${currentSession.requirements.userBio}` : ''}`
          : undefined;

      // Step 2: Generate content (currentStepIndex is already 2)
      const sceneContentStart = performance.now();
      const contentResp = await fetch('/api/generate/scene-content', {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify({
          outline: firstOutline,
          allOutlines: outlines,
          pdfImages: currentSession.pdfImages,
          imageMapping,
          stageInfo,
          stageId: stage.id,
          agents,
        }),
        signal,
      });
      pushNextApiLine(
        'POST',
        '/api/generate/scene-content',
        contentResp.status,
        performance.now() - sceneContentStart,
      );

      if (!contentResp.ok) {
        const errorData = await contentResp.json().catch(() => ({ error: 'Request failed' }));
        pushGenerationLog(
          'Scene Content API',
          `Scene content error payload: ${stringifyErrorPayload(errorData)}`,
          'ERROR',
        );
        throw new Error(errorData.error || t('generation.sceneGenerateFailed'));
      }

      const contentData = await contentResp.json();
      if (!contentData.success || !contentData.content) {
        throw new Error(contentData.error || t('generation.sceneGenerateFailed'));
      }
      pushGenerationLog(
        'Scene Content API',
        `Content generated successfully: "${contentData.effectiveOutline?.title || firstOutline.title}"`,
      );

      // Generate actions (activate actions step indicator)
      const actionsStepIdx = activeSteps.findIndex((s) => s.id === 'actions');
      setCurrentStepIndex(actionsStepIdx >= 0 ? actionsStepIdx : currentStepIndex + 1);
      pushGenerationLog(
        'Scene Actions API',
        `Generating actions: "${contentData.effectiveOutline?.title || firstOutline.title}" (${(contentData.effectiveOutline?.type || firstOutline.type) as string}) [model=${getCurrentModelConfig().modelString}]`,
      );

      const sceneActionsStart = performance.now();
      const actionsResp = await fetch('/api/generate/scene-actions', {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify({
          outline: contentData.effectiveOutline || firstOutline,
          allOutlines: outlines,
          content: contentData.content,
          stageId: stage.id,
          agents,
          previousSpeeches: [],
          userProfile,
        }),
        signal,
      });
      pushNextApiLine(
        'POST',
        '/api/generate/scene-actions',
        actionsResp.status,
        performance.now() - sceneActionsStart,
      );

      if (!actionsResp.ok) {
        const errorData = await actionsResp.json().catch(() => ({ error: 'Request failed' }));
        pushGenerationLog(
          'Scene Actions API',
          `Scene actions error payload: ${stringifyErrorPayload(errorData)}`,
          'ERROR',
        );
        throw new Error(errorData.error || t('generation.sceneGenerateFailed'));
      }

      const data = await actionsResp.json();
      if (!data.success || !data.scene) {
        throw new Error(data.error || t('generation.sceneGenerateFailed'));
      }
      const actionsCount = data.scene.actions?.length || 0;
      const sceneTitle =
        data.scene.title || contentData.effectiveOutline?.title || firstOutline.title;
      pushGenerationLog(
        'Scene Actions API',
        `Generated ${actionsCount} actions for: "${sceneTitle}"`,
      );
      pushGenerationLog(
        'Scene Actions API',
        `Scene assembled successfully: "${sceneTitle}" — ${actionsCount} actions`,
      );

      // Generate TTS for first scene (part of actions step — blocking)
      if (settings.ttsEnabled && settings.ttsProviderId !== 'browser-native-tts') {
        const ttsProviderConfig = settings.ttsProvidersConfig?.[settings.ttsProviderId];
        const speechActions = (data.scene.actions || []).filter(
          (a: { type: string; text?: string }) => a.type === 'speech' && a.text,
        );
        pushGenerationLog('TTS API', `Generating TTS for ${speechActions.length} speech actions`);

        let ttsFailCount = 0;
        const concurrencyCap =
          settings.ttsProviderId === 'qwen-tts'
            ? PREVIEW_QWEN_TTS_CONCURRENCY
            : PREVIEW_TTS_CONCURRENCY;
        const ttsConcurrency = Math.min(concurrencyCap, speechActions.length);
        let nextSpeechIndex = 0;

        const runTTSWorker = async () => {
          while (true) {
            const index = nextSpeechIndex++;
            if (index >= speechActions.length) return;

            const action = speechActions[index];
            const audioId = `tts_${action.id}`;
            action.audioId = audioId;
            try {
              let ttsData: {
                success?: boolean;
                base64?: string;
                format?: string;
                error?: string;
              } | null = null;
              let finalFailed = false;

              for (let attempt = 0; attempt <= PREVIEW_TTS_RETRY_MAX; attempt++) {
                const ttsStart = performance.now();
                const resp = await fetch('/api/generate/tts', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    text: action.text,
                    audioId,
                    ttsProviderId: settings.ttsProviderId,
                    ttsModelId: settings.ttsModelId,
                    ttsVoice: settings.ttsVoice,
                    ttsSpeed: settings.ttsSpeed,
                    ttsApiKey: ttsProviderConfig?.apiKey || undefined,
                    ttsBaseUrl: ttsProviderConfig?.baseUrl || undefined,
                  }),
                  signal,
                });
                pushNextApiLine(
                  'POST',
                  '/api/generate/tts',
                  resp.status,
                  performance.now() - ttsStart,
                );

                const payload = await resp
                  .json()
                  .catch(() => ({ error: `TTS failed: HTTP ${resp.status}` }));

                if (resp.ok && payload?.success && payload?.base64 && payload?.format) {
                  ttsData = payload;
                  break;
                }

                const retryable = isRetryableTTSFailure(
                  resp.status,
                  payload,
                  payload?.error || payload?.details,
                );
                const canRetry = retryable && attempt < PREVIEW_TTS_RETRY_MAX;

                if (canRetry) {
                  const backoff =
                    PREVIEW_TTS_RETRY_BASE_MS * Math.pow(2, attempt) +
                    Math.floor(Math.random() * 400);
                  pushGenerationLog(
                    'TTS API',
                    `Rate-limited, retrying TTS: audioId=${audioId}, wait=${backoff}ms, attempt=${attempt + 2}/${PREVIEW_TTS_RETRY_MAX + 1}`,
                    'WARN',
                  );
                  await sleepWithAbort(backoff, signal);
                  continue;
                }

                pushGenerationLog(
                  'TTS API',
                  `TTS error payload: ${stringifyErrorPayload(payload)}`,
                  'ERROR',
                );
                finalFailed = true;
                break;
              }

              if (!ttsData?.success || !ttsData.base64 || !ttsData.format) {
                if (!finalFailed) {
                  pushGenerationLog(
                    'TTS API',
                    `TTS failed after retries: audioId=${audioId}`,
                    'ERROR',
                  );
                }
                ttsFailCount++;
                continue;
              }

              const binary = atob(ttsData.base64);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
              const blob = new Blob([bytes], { type: `audio/${ttsData.format}` });
              await db.audioFiles.put({
                id: audioId,
                blob,
                format: ttsData.format,
                createdAt: Date.now(),
              });
            } catch (err) {
              log.warn(`[TTS] Failed for ${audioId}:`, err);
              pushGenerationLog(
                'TTS API',
                `TTS failed: audioId=${audioId}, reason=${err instanceof Error ? err.message : String(err)}`,
                'ERROR',
              );
              ttsFailCount++;
            }
          }
        };

        await Promise.all(Array.from({ length: ttsConcurrency }, () => runTTSWorker()));

        if (ttsFailCount > 0 && speechActions.length > 0) {
          pushGenerationLog(
            'TTS API',
            `TTS partial failure: ${ttsFailCount}/${speechActions.length} failed, continuing generation`,
            'WARN',
          );
        }
        pushGenerationLog('TTS API', 'TTS generation completed');
      }

      // Add scene to store and navigate
      store.addScene(data.scene);
      store.setCurrentSceneId(data.scene.id);

      // Set remaining outlines as skeleton placeholders
      const remaining = outlines.filter((o) => o.order !== data.scene.order);
      store.setGeneratingOutlines(remaining);

      // Store generation params for classroom to continue generation
      sessionStorage.setItem(
        'generationParams',
        JSON.stringify({
          pdfImages: currentSession.pdfImages,
          agents,
          userProfile,
        }),
      );

      sessionStorage.removeItem('generationSession');
      await store.saveToStorage();
      pushGenerationLog('Generation Preview', 'Generation completed, redirecting to classroom');
      router.push(`/classroom/${stage.id}`);
    } catch (err) {
      // AbortError is expected when navigating away — don't show as error
      if (err instanceof DOMException && err.name === 'AbortError') {
        log.info('[GenerationPreview] Generation aborted');
        pushGenerationLog('Generation Preview', 'Generation aborted', 'WARN');
        return;
      }
      sessionStorage.removeItem('generationSession');
      pushGenerationLog(
        'Generation Preview',
        `Generation failed: ${err instanceof Error ? err.message : String(err)}`,
        'ERROR',
      );
      if (err instanceof Error && err.stack) {
        pushGenerationLog('Generation Preview', err.stack, 'ERROR');
      }
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const extractTopicFromRequirement = (requirement: string): string => {
    const trimmed = requirement.trim();
    if (trimmed.length <= 500) {
      return trimmed;
    }
    return trimmed.substring(0, 500).trim() + '...';
  };

  const goBackToHome = () => {
    abortControllerRef.current?.abort();
    sessionStorage.removeItem('generationSession');
    router.push('/');
  };

  // Still loading session from sessionStorage
  if (!sessionLoaded) {
    return (
      <div className="relative min-h-[100dvh] w-full flex items-center justify-center p-4 overflow-hidden">
        <div className="fixed inset-0 -z-10 bg-[url('/bg.png')] bg-cover bg-center bg-no-repeat pointer-events-none" />
        <div className="text-center text-sky-600">
          <div className="size-8 border-2 border-current border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      </div>
    );
  }

  // No session found
  if (!session) {
    return (
      <div className="relative min-h-[100dvh] w-full flex items-center justify-center p-4 overflow-hidden">
        <div className="fixed inset-0 -z-10 bg-[url('/bg.png')] bg-cover bg-center bg-no-repeat pointer-events-none" />
        <Card className="p-8 max-w-md w-full rounded-3xl border-[3px] border-slate-900/80 bg-white/92 backdrop-blur-sm shadow-[0_2px_0_rgba(15,23,42,0.2)]">
          <div className="text-center space-y-4">
            <AlertCircle className="size-12 text-sky-500 mx-auto" />
            <h2 className="text-xl font-semibold text-slate-800">
              {t('generation.sessionNotFound')}
            </h2>
            <p className="text-sm text-slate-500">{t('generation.sessionNotFoundDesc')}</p>
            <Button
              onClick={() => router.push('/')}
              className="w-full rounded-full border-2 border-slate-900/80 bg-orange-400 text-white hover:bg-orange-500"
            >
              <ArrowLeft className="size-4 mr-2" />
              {t('generation.backToHome')}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const activeStep =
    activeSteps.length > 0
      ? activeSteps[Math.min(currentStepIndex, activeSteps.length - 1)]
      : ALL_STEPS[0];

  return (
    <div className="relative min-h-[100dvh] w-full flex flex-col items-center justify-center p-4 text-center overflow-hidden">
      <div className="fixed inset-0 -z-10 bg-[url('/bg.png')] bg-cover bg-center bg-no-repeat pointer-events-none" />
      {/* Background Decor */}
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

      {/* Back button */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="absolute top-4 left-4 z-20"
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={goBackToHome}
          className="rounded-full border-2 border-slate-900/80 bg-white/90 text-sky-700 hover:bg-sky-50"
        >
          <ArrowLeft className="size-4 mr-2" />
          {t('generation.backToHome')}
        </Button>
      </motion.div>

      <div className="z-10 w-full max-w-lg space-y-8 flex flex-col items-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full"
        >
          <Card className="relative overflow-hidden rounded-[34px] border-[3px] border-slate-900/80 bg-white/90 backdrop-blur-sm shadow-[0_2px_0_rgba(15,23,42,0.2)] min-h-[400px] flex flex-col items-center justify-center p-8 md:p-12">
            {/* Progress Dots */}
            <div className="absolute top-6 left-0 right-0 flex justify-center gap-2">
              {activeSteps.map((step, idx) => (
                <div
                  key={step.id}
                  className={cn(
                    'h-1.5 rounded-full transition-all duration-500',
                    idx < currentStepIndex
                      ? 'w-1.5 bg-sky-300'
                      : idx === currentStepIndex
                        ? 'w-8 bg-sky-500'
                        : 'w-1.5 bg-sky-100',
                  )}
                />
              ))}
            </div>

            {/* Central Content */}
            <div className="flex-1 flex flex-col items-center justify-center w-full space-y-8 mt-4">
              {/* Icon / Visualizer Container */}
              <div className="relative size-48 flex items-center justify-center">
                <AnimatePresence mode="popLayout">
                  {error ? (
                    <motion.div
                      key="error"
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="size-32 rounded-full bg-orange-100/70 flex items-center justify-center border-2 border-slate-900/75"
                    >
                      <AlertCircle className="size-16 text-orange-500" />
                    </motion.div>
                  ) : isComplete ? (
                    <motion.div
                      key="complete"
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="size-32 rounded-full bg-sky-100/70 flex items-center justify-center border-2 border-slate-900/75"
                    >
                      <CheckCircle2 className="size-16 text-sky-500" />
                    </motion.div>
                  ) : (
                    <motion.div
                      key={activeStep.id}
                      initial={{ scale: 0.8, opacity: 0, filter: 'blur(10px)' }}
                      animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
                      exit={{ scale: 1.2, opacity: 0, filter: 'blur(10px)' }}
                      transition={{ duration: 0.4 }}
                      className="absolute inset-0 flex items-center justify-center"
                    >
                      <StepVisualizer
                        stepId={activeStep.id}
                        outlines={streamingOutlines}
                        webSearchSources={webSearchSources}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Text Content */}
              <div className="space-y-3 max-w-sm mx-auto">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={error ? 'error' : isComplete ? 'done' : activeStep.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-2"
                  >
                    <h2 className="text-2xl font-bold tracking-tight text-slate-800">
                      {error
                        ? t('generation.generationFailed')
                        : isComplete
                          ? t('generation.generationComplete')
                          : t(activeStep.title)}
                    </h2>
                    <p className="text-slate-500 text-base">
                      {error
                        ? error
                        : isComplete
                          ? t('generation.classroomReady')
                          : statusMessage || t(activeStep.description)}
                    </p>
                  </motion.div>
                </AnimatePresence>

                {/* Truncation warning indicator */}
                <AnimatePresence>
                  {truncationWarnings.length > 0 && !error && !isComplete && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0 }}
                      transition={{
                        type: 'spring',
                        stiffness: 500,
                        damping: 30,
                      }}
                      className="flex justify-center"
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <motion.button
                            type="button"
                            className="relative size-7 rounded-full flex items-center justify-center cursor-default
                                       bg-orange-100/80
                                       border-2 border-slate-900/70 hover:border-slate-900/85
                                       transition-colors duration-300
                                       focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
                          >
                            <AlertTriangle className="size-3.5 text-orange-500" strokeWidth={2.5} />
                          </motion.button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" sideOffset={6}>
                          <div className="space-y-1 py-0.5">
                            {truncationWarnings.map((w, i) => (
                              <p key={i} className="text-xs leading-relaxed">
                                {w}
                              </p>
                            ))}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </Card>
        </motion.div>

        <div className="w-full max-w-lg">
          <div className="rounded-2xl border-2 border-slate-900/75 bg-white/85 p-3 text-left shadow-[0_2px_0_rgba(15,23,42,0.16)] backdrop-blur-sm">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-xs font-black uppercase tracking-wide text-slate-700">
                生成日志 / Generation Logs
              </div>
              <button
                type="button"
                onClick={handleCopyLogs}
                disabled={generationLogs.length === 0}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold transition-colors',
                  generationLogs.length === 0
                    ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                    : copiedLogs
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                )}
              >
                {copiedLogs ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copiedLogs ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="max-h-36 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/80 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-slate-600">
              {generationLogs.length > 0 ? (
                generationLogs.map((line, idx) => (
                  <div key={`${idx}-${line}`}>{renderHighlightedLogLine(line)}</div>
                ))
              ) : (
                <div className="text-slate-400">Waiting for generation to start...</div>
              )}
            </div>
          </div>
        </div>

        {/* Footer Action */}
        <div className="h-16 flex items-center justify-center w-full">
          <AnimatePresence>
            {error ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-xs"
              >
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full h-12 rounded-full border-2 border-slate-900/80 bg-white text-sky-700 hover:bg-sky-50"
                  onClick={goBackToHome}
                >
                  {t('generation.goBackAndRetry')}
                </Button>
              </motion.div>
            ) : !isComplete ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-3 text-sm text-slate-500 font-medium uppercase tracking-widest"
              >
                <Sparkles className="size-3 animate-pulse text-orange-500" />
                {t('generation.aiWorking')}
                {generatedAgents.length > 0 && !showAgentReveal && (
                  <button
                    onClick={() => setShowAgentReveal(true)}
                    className="ml-2 flex items-center gap-1.5 rounded-full border-2 border-slate-900/75 bg-sky-100 px-3 py-1 text-xs font-medium normal-case tracking-normal text-sky-700 transition-colors hover:bg-sky-200"
                  >
                    <Bot className="size-3" />
                    {t('generation.viewAgents')}
                  </button>
                )}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      {/* Agent Reveal Modal */}
      <AgentRevealModal
        agents={generatedAgents}
        open={showAgentReveal}
        onClose={() => setShowAgentReveal(false)}
        onAllRevealed={() => {
          agentRevealResolveRef.current?.();
          agentRevealResolveRef.current = null;
        }}
      />
    </div>
  );
}

export default function GenerationPreviewPage() {
  return (
    <Suspense
      fallback={
        <div className="relative min-h-[100dvh] w-full flex items-center justify-center overflow-hidden">
          <div className="fixed inset-0 -z-10 bg-[url('/bg.png')] bg-cover bg-center bg-no-repeat pointer-events-none" />
          <div className="animate-pulse space-y-4 text-center">
            <div className="h-8 w-48 bg-sky-100 rounded mx-auto" />
            <div className="h-4 w-64 bg-sky-100 rounded mx-auto" />
          </div>
        </div>
      }
    >
      <GenerationPreviewContent />
    </Suspense>
  );
}

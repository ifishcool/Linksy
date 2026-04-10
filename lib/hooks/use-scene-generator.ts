'use client';

import { useCallback, useRef } from 'react';
import { useStageStore } from '@/lib/store/stage';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import { useSettingsStore } from '@/lib/store/settings';
import { db } from '@/lib/utils/database';
import type { SceneOutline, PdfImage, ImageMapping } from '@/lib/types/generation';
import type { AgentInfo } from '@/lib/generation/generation-pipeline';
import type { Scene } from '@/lib/types/stage';
import type { SpeechAction } from '@/lib/types/action';
import { splitLongSpeechActions } from '@/lib/audio/tts-utils';
import { generateMediaForOutlines } from '@/lib/media/media-orchestrator';
import { createLogger } from '@/lib/logger';

const log = createLogger('SceneGenerator');
const CLIENT_TTS_CONCURRENCY = 4;
const QWEN_TTS_CONCURRENCY = 2;
const TTS_RETRY_MAX = 2;
const TTS_RETRY_BASE_MS = 1200;

function isRetryableTTSError(result: {
  statusCode: number | 'ERR';
  error?: string;
  errorPayload?: unknown;
}): boolean {
  if (result.statusCode === 429 || result.statusCode === 503) return true;
  const text = `${result.error || ''} ${stringifyErrorPayload(result.errorPayload)}`.toLowerCase();
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

  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

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

async function generateAndStoreTTSWithRetry(
  audioId: string,
  text: string,
  signal?: AbortSignal,
  callbacks?: {
    onLog?: (scope: string, message: string, level?: LogLevel) => void;
  },
): Promise<{
  success: boolean;
  statusCode: number | 'ERR';
  error?: string;
  errorPayload?: unknown;
}> {
  let lastResult: {
    success: boolean;
    statusCode: number | 'ERR';
    error?: string;
    errorPayload?: unknown;
  } = {
    success: false,
    statusCode: 'ERR',
    error: 'TTS request not started',
  };

  for (let attempt = 0; attempt <= TTS_RETRY_MAX; attempt++) {
    lastResult = await generateAndStoreTTS(audioId, text, signal);
    if (lastResult.success) return lastResult;

    const shouldRetry = isRetryableTTSError(lastResult) && attempt < TTS_RETRY_MAX;
    if (!shouldRetry) return lastResult;

    const backoff = TTS_RETRY_BASE_MS * Math.pow(2, attempt) + Math.floor(Math.random() * 400);
    callbacks?.onLog?.(
      'TTS API',
      `Rate-limited for ${audioId}, retrying in ${backoff}ms (attempt ${attempt + 2}/${TTS_RETRY_MAX + 1})`,
      'WARN',
    );
    await sleepWithAbort(backoff, signal);
  }

  return lastResult;
}

interface SceneContentResult {
  success: boolean;
  content?: unknown;
  effectiveOutline?: SceneOutline;
  error?: string;
  statusCode?: number;
  errorPayload?: unknown;
}

interface SceneActionsResult {
  success: boolean;
  scene?: Scene;
  previousSpeeches?: string[];
  error?: string;
  statusCode?: number;
  errorPayload?: unknown;
}

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

function stringifyErrorPayload(payload: unknown): string {
  if (!payload) return '';
  try {
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return raw.length > 1200 ? `${raw.slice(0, 1200)}...` : raw;
  } catch {
    return String(payload);
  }
}

function getApiHeaders(): HeadersInit {
  const config = getCurrentModelConfig();
  const settings = useSettingsStore.getState();
  const imageProviderConfig = settings.imageProvidersConfig?.[settings.imageProviderId];
  const videoProviderConfig = settings.videoProvidersConfig?.[settings.videoProviderId];

  return {
    'Content-Type': 'application/json',
    'x-model': config.modelString || '',
    'x-api-key': config.apiKey || '',
    'x-base-url': config.baseUrl || '',
    'x-provider-type': config.providerType || '',
    'x-requires-api-key': String(config.requiresApiKey ?? false),
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
}

/** Call POST /api/generate/scene-content (step 1) */
async function fetchSceneContent(
  params: {
    outline: SceneOutline;
    allOutlines: SceneOutline[];
    stageId: string;
    pdfImages?: PdfImage[];
    imageMapping?: ImageMapping;
    stageInfo: {
      name: string;
      description?: string;
      language?: string;
      style?: string;
    };
    agents?: AgentInfo[];
  },
  signal?: AbortSignal,
): Promise<SceneContentResult> {
  const response = await fetch('/api/generate/scene-content', {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify(params),
    signal,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: 'Request failed' }));
    return {
      success: false,
      error: data.error || `HTTP ${response.status}`,
      statusCode: response.status,
      errorPayload: data,
    };
  }

  const data = (await response.json()) as SceneContentResult;
  return { ...data, statusCode: response.status };
}

/** Call POST /api/generate/scene-actions (step 2) */
async function fetchSceneActions(
  params: {
    outline: SceneOutline;
    allOutlines: SceneOutline[];
    content: unknown;
    stageId: string;
    agents?: AgentInfo[];
    previousSpeeches?: string[];
    userProfile?: string;
  },
  signal?: AbortSignal,
): Promise<SceneActionsResult> {
  const response = await fetch('/api/generate/scene-actions', {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify(params),
    signal,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: 'Request failed' }));
    return {
      success: false,
      error: data.error || `HTTP ${response.status}`,
      statusCode: response.status,
      errorPayload: data,
    };
  }

  const data = (await response.json()) as SceneActionsResult;
  return { ...data, statusCode: response.status };
}

/** Generate TTS for one speech action and store in IndexedDB */
export async function generateAndStoreTTS(
  audioId: string,
  text: string,
  signal?: AbortSignal,
): Promise<{
  success: boolean;
  statusCode: number | 'ERR';
  error?: string;
  errorPayload?: unknown;
}> {
  const settings = useSettingsStore.getState();
  if (settings.ttsProviderId === 'browser-native-tts') {
    return { success: true, statusCode: 200 };
  }

  const ttsProviderConfig = settings.ttsProvidersConfig?.[settings.ttsProviderId];
  let response: Response;
  try {
    response = await fetch('/api/generate/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
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
  } catch (error) {
    return {
      success: false,
      statusCode: 'ERR',
      error: error instanceof Error ? error.message : 'TTS request failed',
    };
  }

  const data = await response
    .json()
    .catch(() => ({ success: false, error: response.statusText || 'Invalid TTS response' }));
  if (!response.ok || !data.success || !data.base64 || !data.format) {
    const errorMessage =
      data.details || data.error || `TTS request failed: HTTP ${response.status}`;
    log.warn('TTS failed for', audioId, ':', errorMessage);
    return {
      success: false,
      statusCode: response.status,
      error: errorMessage,
      errorPayload: data,
    };
  }

  try {
    const binary = atob(data.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: `audio/${data.format}` });
    await db.audioFiles.put({
      id: audioId,
      blob,
      format: data.format,
      createdAt: Date.now(),
    });
  } catch (error) {
    return {
      success: false,
      statusCode: response.status,
      error: error instanceof Error ? error.message : 'Failed to store generated TTS audio',
    };
  }

  return { success: true, statusCode: response.status };
}

/** Generate TTS for all speech actions in a scene. Returns result. */
async function generateTTSForScene(
  scene: Scene,
  signal?: AbortSignal,
  callbacks?: {
    onLog?: (scope: string, message: string, level?: LogLevel) => void;
    onApiTiming?: (
      method: 'GET' | 'POST',
      path: string,
      status: number | 'ERR',
      durationMs: number,
    ) => void;
  },
): Promise<{ success: boolean; failedCount: number; error?: string }> {
  const providerId = useSettingsStore.getState().ttsProviderId;
  scene.actions = splitLongSpeechActions(scene.actions || [], providerId);
  const speechActions = scene.actions.filter(
    (a): a is SpeechAction => a.type === 'speech' && !!a.text,
  );
  if (speechActions.length === 0) return { success: true, failedCount: 0 };

  let failedCount = 0;
  let lastError: string | undefined;

  const concurrencyCap = providerId === 'qwen-tts' ? QWEN_TTS_CONCURRENCY : CLIENT_TTS_CONCURRENCY;
  const concurrency = Math.min(concurrencyCap, speechActions.length);
  let nextActionIndex = 0;

  const runWorker = async () => {
    while (true) {
      const index = nextActionIndex++;
      if (index >= speechActions.length) return;

      const action = speechActions[index];
      const audioId = `tts_${action.id}`;
      action.audioId = audioId;
      const ttsStart = performance.now();
      const ttsResult = await generateAndStoreTTSWithRetry(audioId, action.text, signal, {
        onLog: callbacks?.onLog,
      });
      callbacks?.onApiTiming?.(
        'POST',
        '/api/generate/tts',
        ttsResult.statusCode,
        performance.now() - ttsStart,
      );

      if (!ttsResult.success) {
        failedCount++;
        lastError = ttsResult.error || `TTS failed for action ${action.id}`;
        if (ttsResult.errorPayload) {
          callbacks?.onLog?.(
            'TTS API',
            `TTS error payload: ${stringifyErrorPayload(ttsResult.errorPayload)}`,
            'ERROR',
          );
        }
        log.warn('TTS generation failed:', {
          providerId,
          actionId: action.id,
          textLength: action.text.length,
          error: lastError,
        });
        callbacks?.onLog?.(
          'TTS API',
          `TTS generation failed for action=${action.id}: ${lastError}`,
          'ERROR',
        );
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));

  return {
    success: failedCount === 0,
    failedCount,
    error: lastError,
  };
}

export interface UseSceneGeneratorOptions {
  onSceneGenerated?: (scene: Scene, index: number) => void;
  onSceneFailed?: (outline: SceneOutline, error: string) => void;
  onPhaseChange?: (phase: 'content' | 'actions', outline: SceneOutline) => void;
  onComplete?: () => void;
  onLog?: (scope: string, message: string, level?: LogLevel) => void;
  onApiTiming?: (
    method: 'GET' | 'POST',
    path: string,
    status: number | 'ERR',
    durationMs: number,
  ) => void;
}

export interface GenerationParams {
  pdfImages?: PdfImage[];
  imageMapping?: ImageMapping;
  stageInfo: {
    name: string;
    description?: string;
    language?: string;
    style?: string;
  };
  agents?: AgentInfo[];
  userProfile?: string;
}

export function useSceneGenerator(options: UseSceneGeneratorOptions = {}) {
  const abortRef = useRef(false);
  const generatingRef = useRef(false);
  const mediaAbortRef = useRef<AbortController | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const lastParamsRef = useRef<GenerationParams | null>(null);
  const generateRemainingRef = useRef<((params: GenerationParams) => Promise<void>) | null>(null);

  const store = useStageStore;

  const generateRemaining = useCallback(
    async (params: GenerationParams) => {
      lastParamsRef.current = params;
      if (generatingRef.current) return;
      generatingRef.current = true;
      abortRef.current = false;
      const removeGeneratingOutline = (outlineId: string) => {
        const current = store.getState().generatingOutlines;
        if (!current.some((o) => o.id === outlineId)) return;
        store.getState().setGeneratingOutlines(current.filter((o) => o.id !== outlineId));
      };

      // Create a new AbortController for this generation run
      fetchAbortRef.current = new AbortController();
      const signal = fetchAbortRef.current.signal;

      const state = store.getState();
      const { outlines, scenes, stage } = state;
      const startEpoch = state.generationEpoch;
      if (!stage || outlines.length === 0) {
        generatingRef.current = false;
        return;
      }

      store.getState().setGenerationStatus('generating');

      // Determine pending outlines
      const completedOrders = new Set(scenes.map((s) => s.order));
      const pending = outlines
        .filter((o) => !completedOrders.has(o.order))
        .sort((a, b) => a.order - b.order);

      if (pending.length === 0) {
        store.getState().setGenerationStatus('completed');
        store.getState().setGeneratingOutlines([]);
        options.onComplete?.();
        generatingRef.current = false;
        return;
      }

      store.getState().setGeneratingOutlines(pending);

      // Launch media generation in parallel — does not block content/action generation
      mediaAbortRef.current = new AbortController();
      generateMediaForOutlines(outlines, stage.id, mediaAbortRef.current.signal).catch((err) => {
        log.warn('Media generation error:', err);
      });

      // Get previousSpeeches from last completed scene
      let previousSpeeches: string[] = [];
      const sortedScenes = [...scenes].sort((a, b) => a.order - b.order);
      if (sortedScenes.length > 0) {
        const lastScene = sortedScenes[sortedScenes.length - 1];
        previousSpeeches = (lastScene.actions || [])
          .filter((a): a is SpeechAction => a.type === 'speech')
          .map((a) => a.text);
      }

      // Serial generation loop — two-step per outline
      try {
        let pausedByFailureOrAbort = false;
        for (const outline of pending) {
          if (abortRef.current || store.getState().generationEpoch !== startEpoch) {
            store.getState().setGenerationStatus('paused');
            pausedByFailureOrAbort = true;
            break;
          }

          store.getState().setCurrentGeneratingOrder(outline.order);

          // Step 1: Generate content
          options.onPhaseChange?.('content', outline);
          const contentStart = performance.now();
          const contentResult = await fetchSceneContent(
            {
              outline,
              allOutlines: outlines,
              stageId: stage.id,
              pdfImages: params.pdfImages,
              imageMapping: params.imageMapping,
              stageInfo: params.stageInfo,
              agents: params.agents,
            },
            signal,
          );
          options.onApiTiming?.(
            'POST',
            '/api/generate/scene-content',
            contentResult.statusCode ?? (contentResult.success ? 200 : 'ERR'),
            performance.now() - contentStart,
          );

          if (!contentResult.success || !contentResult.content) {
            if (contentResult.errorPayload) {
              options.onLog?.(
                'Scene Content API',
                `Scene content error payload: ${stringifyErrorPayload(contentResult.errorPayload)}`,
                'ERROR',
              );
            }
            if (abortRef.current || store.getState().generationEpoch !== startEpoch) {
              pausedByFailureOrAbort = true;
              break;
            }
            store.getState().addFailedOutline(outline);
            options.onSceneFailed?.(outline, contentResult.error || 'Content generation failed');
            store.getState().setGenerationStatus('paused');
            pausedByFailureOrAbort = true;
            break;
          }

          if (abortRef.current || store.getState().generationEpoch !== startEpoch) {
            store.getState().setGenerationStatus('paused');
            pausedByFailureOrAbort = true;
            break;
          }

          // Step 2: Generate actions + assemble scene
          options.onPhaseChange?.('actions', outline);
          const actionsStart = performance.now();
          const actionsResult = await fetchSceneActions(
            {
              outline: contentResult.effectiveOutline || outline,
              allOutlines: outlines,
              content: contentResult.content,
              stageId: stage.id,
              agents: params.agents,
              previousSpeeches,
              userProfile: params.userProfile,
            },
            signal,
          );
          options.onApiTiming?.(
            'POST',
            '/api/generate/scene-actions',
            actionsResult.statusCode ?? (actionsResult.success ? 200 : 'ERR'),
            performance.now() - actionsStart,
          );

          if (actionsResult.success && actionsResult.scene) {
            const scene = actionsResult.scene;
            const settings = useSettingsStore.getState();

            // TTS generation — partial failure should not fail the whole scene
            if (settings.ttsEnabled && settings.ttsProviderId !== 'browser-native-tts') {
              const ttsResult = await generateTTSForScene(scene, signal, {
                onLog: options.onLog,
                onApiTiming: options.onApiTiming,
              });
              if (!ttsResult.success) {
                options.onLog?.(
                  'TTS API',
                  `TTS partially failed (${ttsResult.failedCount} items), continuing scene generation: ${ttsResult.error || 'Unknown error'}`,
                  'WARN',
                );
              }
            }

            // Epoch changed — stage switched, discard this scene
            if (store.getState().generationEpoch !== startEpoch) {
              pausedByFailureOrAbort = true;
              break;
            }

            removeGeneratingOutline(outline.id);
            store.getState().addScene(scene);
            options.onSceneGenerated?.(scene, outline.order);
            previousSpeeches = actionsResult.previousSpeeches || [];
          } else {
            if (actionsResult.errorPayload) {
              options.onLog?.(
                'Scene Actions API',
                `Scene actions error payload: ${stringifyErrorPayload(actionsResult.errorPayload)}`,
                'ERROR',
              );
            }
            if (abortRef.current || store.getState().generationEpoch !== startEpoch) {
              pausedByFailureOrAbort = true;
              break;
            }
            store.getState().addFailedOutline(outline);
            options.onSceneFailed?.(outline, actionsResult.error || 'Actions generation failed');
            store.getState().setGenerationStatus('paused');
            pausedByFailureOrAbort = true;
            break;
          }
        }

        if (!abortRef.current && !pausedByFailureOrAbort) {
          store.getState().setGenerationStatus('completed');
          store.getState().setGeneratingOutlines([]);
          options.onComplete?.();
        }
      } catch (err: unknown) {
        // AbortError is expected when stop() is called — don't treat as failure
        if (err instanceof DOMException && err.name === 'AbortError') {
          log.info('Generation aborted');
          store.getState().setGenerationStatus('paused');
        } else {
          throw err;
        }
      } finally {
        generatingRef.current = false;
        fetchAbortRef.current = null;
      }
    },
    [options, store],
  );

  // Keep ref in sync so retrySingleOutline can call it
  generateRemainingRef.current = generateRemaining;

  const stop = useCallback(() => {
    abortRef.current = true;
    store.getState().bumpGenerationEpoch();
    fetchAbortRef.current?.abort();
    mediaAbortRef.current?.abort();
  }, [store]);

  const isGenerating = useCallback(() => generatingRef.current, []);

  /** Retry a single failed outline from scratch (content → actions → TTS). */
  const retrySingleOutline = useCallback(
    async (outlineId: string) => {
      const state = store.getState();
      const outline = state.failedOutlines.find((o) => o.id === outlineId);
      const params = lastParamsRef.current;
      if (!outline || !state.stage || !params) return;

      const removeGeneratingOutline = () => {
        const current = store.getState().generatingOutlines;
        if (!current.some((o) => o.id === outlineId)) return;
        store.getState().setGeneratingOutlines(current.filter((o) => o.id !== outlineId));
      };

      // Remove from failed list and mark as generating
      store.getState().retryFailedOutline(outlineId);
      store.getState().setGenerationStatus('generating');
      const currentGenerating = store.getState().generatingOutlines;
      if (!currentGenerating.some((o) => o.id === outline.id)) {
        store.getState().setGeneratingOutlines([...currentGenerating, outline]);
      }

      const abortController = new AbortController();
      const signal = abortController.signal;

      try {
        // Step 1: Content
        const contentResult = await fetchSceneContent(
          {
            outline,
            allOutlines: state.outlines,
            stageId: state.stage.id,
            pdfImages: params.pdfImages,
            imageMapping: params.imageMapping,
            stageInfo: params.stageInfo,
            agents: params.agents,
          },
          signal,
        );

        if (!contentResult.success || !contentResult.content) {
          store.getState().addFailedOutline(outline);
          return;
        }

        // Step 2: Actions
        const sortedScenes = [...store.getState().scenes].sort((a, b) => a.order - b.order);
        const lastScene = sortedScenes[sortedScenes.length - 1];
        const previousSpeeches = lastScene
          ? (lastScene.actions || [])
              .filter((a): a is SpeechAction => a.type === 'speech')
              .map((a) => a.text)
          : [];

        const actionsResult = await fetchSceneActions(
          {
            outline: contentResult.effectiveOutline || outline,
            allOutlines: state.outlines,
            content: contentResult.content,
            stageId: state.stage.id,
            agents: params.agents,
            previousSpeeches,
            userProfile: params.userProfile,
          },
          signal,
        );

        if (!actionsResult.success || !actionsResult.scene) {
          store.getState().addFailedOutline(outline);
          return;
        }

        // Step 3: TTS
        const settings = useSettingsStore.getState();
        if (settings.ttsEnabled && settings.ttsProviderId !== 'browser-native-tts') {
          const ttsResult = await generateTTSForScene(actionsResult.scene, signal);
          if (!ttsResult.success) {
            log.warn(
              `[retrySingleOutline] TTS partially failed (${ttsResult.failedCount}) but scene will still be added`,
            );
          }
        }

        removeGeneratingOutline();
        store.getState().addScene(actionsResult.scene);

        // Resume remaining generation if there are pending outlines
        if (store.getState().generatingOutlines.length > 0 && lastParamsRef.current) {
          generateRemainingRef.current?.(lastParamsRef.current);
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          store.getState().addFailedOutline(outline);
        }
      }
    },
    [store],
  );

  return { generateRemaining, retrySingleOutline, stop, isGenerating };
}

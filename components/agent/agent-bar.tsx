'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { useAgentRegistry } from '@/lib/orchestration/registry/store';
import { resolveAgentVoice, getAvailableProvidersWithVoices } from '@/lib/audio/voice-resolver';
import { playBrowserTTSPreview } from '@/lib/audio/browser-tts-preview';
import {
  Sparkles,
  ChevronDown,
  ChevronUp,
  Shuffle,
  Volume2,
  VolumeX,
  Loader2,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { AgentConfig } from '@/lib/orchestration/registry/types';
import type { TTSProviderId } from '@/lib/audio/types';
import type { ProviderWithVoices } from '@/lib/audio/voice-resolver';

function VoicePillBase({
  displayName,
  disabled,
  children,
}: {
  displayName: string;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  if (disabled) {
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className="flex items-center gap-1.5 h-7 w-[108px] rounded-full bg-slate-100 px-2.5 text-[11px] text-slate-400 shrink-0 cursor-not-allowed border border-slate-200"
      >
        <VolumeX className="size-3 shrink-0" />
        <span className="truncate flex-1 text-left">{displayName}</span>
      </div>
    );
  }

  return <>{children}</>;
}

function AgentVoicePill({
  agent,
  agentIndex,
  availableProviders,
  disabled,
}: {
  agent: AgentConfig;
  agentIndex: number;
  availableProviders: ProviderWithVoices[];
  disabled?: boolean;
}) {
  const updateAgent = useAgentRegistry((s) => s.updateAgent);
  const ttsProvidersConfig = useSettingsStore((s) => s.ttsProvidersConfig);
  const resolved = resolveAgentVoice(agent, agentIndex, availableProviders);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const previewCancelRef = useRef<(() => void) | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);

  const displayName = (() => {
    for (const provider of availableProviders) {
      if (provider.providerId !== resolved.providerId) continue;
      const voice = provider.voices.find((item) => item.id === resolved.voiceId);
      if (voice) return voice.name;
    }
    return resolved.voiceId;
  })();

  const stopPreview = useCallback(() => {
    previewCancelRef.current?.();
    previewCancelRef.current = null;
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.src = '';
      previewAudioRef.current = null;
    }
    setPreviewingId(null);
  }, []);

  const handlePreview = useCallback(
    async (providerId: TTSProviderId, voiceId: string, modelId?: string) => {
      const key = `${providerId}::${voiceId}`;
      if (previewingId === key) {
        stopPreview();
        return;
      }
      stopPreview();
      setPreviewingId(key);

      const courseLanguage =
        (typeof localStorage !== 'undefined' && localStorage.getItem('generationLanguage')) ||
        'zh-CN';
      const previewText = courseLanguage === 'en-US' ? 'Welcome to AI Classroom' : '欢迎来到AI课堂';

      if (providerId === 'browser-native-tts') {
        const { promise, cancel } = playBrowserTTSPreview({ text: previewText, voice: voiceId });
        previewCancelRef.current = cancel;
        try {
          await promise;
        } catch {
          // ignore aborted preview
        }
        setPreviewingId(null);
        return;
      }

      try {
        const controller = new AbortController();
        previewAbortRef.current = controller;
        const providerConfig = ttsProvidersConfig[providerId];
        const response = await fetch('/api/generate/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: previewText,
            audioId: 'voice-preview',
            ttsProviderId: providerId,
            ttsModelId: modelId || providerConfig?.modelId,
            ttsVoice: voiceId,
            ttsSpeed: 1,
            ttsApiKey: providerConfig?.apiKey,
            ttsBaseUrl: providerConfig?.serverBaseUrl || providerConfig?.baseUrl,
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('TTS error');
        const data = await response.json();
        if (!data.base64) throw new Error('No audio');

        const audio = new Audio(`data:audio/${data.format || 'mp3'};base64,${data.base64}`);
        previewAudioRef.current = audio;
        audio.addEventListener('ended', () => setPreviewingId(null));
        audio.addEventListener('error', () => setPreviewingId(null));
        await audio.play();
      } catch {
        setPreviewingId(null);
      }
    },
    [previewingId, stopPreview, ttsProvidersConfig],
  );

  useEffect(() => () => stopPreview(), [stopPreview]);

  return (
    <VoicePillBase displayName={displayName} disabled={disabled}>
      <Popover
        open={popoverOpen}
        onOpenChange={(open) => {
          setPopoverOpen(open);
          if (!open) stopPreview();
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="flex items-center gap-1.5 h-7 w-[140px] rounded-full bg-violet-100 hover:bg-violet-200 px-2.5 text-[11px] text-violet-700 transition-colors shrink-0 cursor-pointer border border-violet-200"
          >
            <Volume2 className="size-3 shrink-0" />
            <span className="truncate flex-1 text-left">{displayName}</span>
            <ChevronDown className="size-3 shrink-0 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="end"
          sideOffset={6}
          className="w-56 px-1 pb-1 pt-0 max-h-64 overflow-y-auto rounded-2xl border-[3px] border-slate-900/80"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {availableProviders.map((provider) =>
            provider.modelGroups.map((group) => (
              <div key={`${provider.providerId}::${group.modelId || 'default'}`}>
                <div className="text-[11px] text-slate-500 font-medium px-2 py-1 sticky top-0 bg-white">
                  {group.modelId
                    ? `${provider.providerName} · ${group.modelName}`
                    : provider.providerName}
                </div>
                {group.voices.map((voice) => {
                  const isActive =
                    resolved.providerId === provider.providerId &&
                    resolved.voiceId === voice.id &&
                    (resolved.modelId || '') === (group.modelId || '');
                  const previewKey = `${provider.providerId}::${voice.id}`;
                  const isPreviewing = previewingId === previewKey;

                  return (
                    <div
                      key={previewKey}
                      className={cn(
                        'flex items-center gap-1.5 rounded-lg transition-colors',
                        isActive ? 'bg-violet-100' : 'hover:bg-slate-50',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          updateAgent(agent.id, {
                            voiceConfig: {
                              providerId: provider.providerId,
                              modelId: group.modelId || undefined,
                              voiceId: voice.id,
                            },
                          });
                          setPopoverOpen(false);
                        }}
                        className={cn(
                          'flex-1 text-left text-[13px] px-2 py-1.5 min-w-0 truncate',
                          isActive ? 'text-violet-700 font-medium' : 'text-slate-800',
                        )}
                      >
                        {voice.name}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handlePreview(provider.providerId, voice.id, group.modelId);
                        }}
                        className={cn(
                          'shrink-0 size-6 flex items-center justify-center rounded-md transition-colors',
                          isPreviewing
                            ? 'text-violet-700'
                            : 'text-slate-400 hover:text-slate-700',
                        )}
                      >
                        {isPreviewing ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Volume2 className="size-3.5" />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )),
          )}
        </PopoverContent>
      </Popover>
    </VoicePillBase>
  );
}

function TeacherVoicePill({
  availableProviders,
  disabled,
}: {
  availableProviders: ProviderWithVoices[];
  disabled?: boolean;
}) {
  const ttsProviderId = useSettingsStore((s) => s.ttsProviderId);
  const ttsVoice = useSettingsStore((s) => s.ttsVoice);
  const setTTSProvider = useSettingsStore((s) => s.setTTSProvider);
  const setTTSVoice = useSettingsStore((s) => s.setTTSVoice);
  const setTTSProviderConfig = useSettingsStore((s) => s.setTTSProviderConfig);
  const ttsProvidersConfig = useSettingsStore((s) => s.ttsProvidersConfig);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const previewCancelRef = useRef<(() => void) | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);

  const displayName = (() => {
    for (const provider of availableProviders) {
      if (provider.providerId !== ttsProviderId) continue;
      const voice = provider.voices.find((item) => item.id === ttsVoice);
      if (voice) return voice.name;
    }
    return ttsVoice || 'default';
  })();

  const stopPreview = useCallback(() => {
    previewCancelRef.current?.();
    previewCancelRef.current = null;
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.src = '';
      previewAudioRef.current = null;
    }
    setPreviewingId(null);
  }, []);

  const handlePreview = useCallback(
    async (providerId: TTSProviderId, voiceId: string, modelId?: string) => {
      const key = `${providerId}::${voiceId}`;
      if (previewingId === key) {
        stopPreview();
        return;
      }
      stopPreview();
      setPreviewingId(key);

      const courseLanguage =
        (typeof localStorage !== 'undefined' && localStorage.getItem('generationLanguage')) ||
        'zh-CN';
      const previewText = courseLanguage === 'en-US' ? 'Welcome to AI Classroom' : '欢迎来到AI课堂';

      if (providerId === 'browser-native-tts') {
        const { promise, cancel } = playBrowserTTSPreview({ text: previewText, voice: voiceId });
        previewCancelRef.current = cancel;
        try {
          await promise;
        } catch {
          // ignore aborted preview
        }
        setPreviewingId(null);
        return;
      }

      try {
        const controller = new AbortController();
        previewAbortRef.current = controller;
        const providerConfig = ttsProvidersConfig[providerId];
        const response = await fetch('/api/generate/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: previewText,
            audioId: 'voice-preview',
            ttsProviderId: providerId,
            ttsModelId: modelId || providerConfig?.modelId,
            ttsVoice: voiceId,
            ttsSpeed: 1,
            ttsApiKey: providerConfig?.apiKey,
            ttsBaseUrl: providerConfig?.serverBaseUrl || providerConfig?.baseUrl,
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('TTS error');
        const data = await response.json();
        if (!data.base64) throw new Error('No audio');

        const audio = new Audio(`data:audio/${data.format || 'mp3'};base64,${data.base64}`);
        previewAudioRef.current = audio;
        audio.addEventListener('ended', () => setPreviewingId(null));
        audio.addEventListener('error', () => setPreviewingId(null));
        await audio.play();
      } catch {
        setPreviewingId(null);
      }
    },
    [previewingId, stopPreview, ttsProvidersConfig],
  );

  useEffect(() => () => stopPreview(), [stopPreview]);

  return (
    <VoicePillBase displayName={displayName} disabled={disabled}>
      <Popover
        open={popoverOpen}
        onOpenChange={(open) => {
          setPopoverOpen(open);
          if (!open) stopPreview();
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="flex items-center gap-1.5 h-7 w-[140px] rounded-full bg-violet-100 hover:bg-violet-200 px-2.5 text-[11px] text-violet-700 transition-colors shrink-0 cursor-pointer border border-violet-200"
          >
            <Volume2 className="size-3 shrink-0" />
            <span className="truncate flex-1 text-left">{displayName}</span>
            <ChevronDown className="size-3 shrink-0 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="end"
          sideOffset={6}
          className="w-56 px-1 pb-1 pt-0 max-h-64 overflow-y-auto rounded-2xl border-[3px] border-slate-900/80"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {availableProviders.map((provider) =>
            provider.modelGroups.map((group) => (
              <div key={`${provider.providerId}::${group.modelId || 'default'}`}>
                <div className="text-[11px] text-slate-500 font-medium px-2 py-1 sticky top-0 bg-white">
                  {group.modelId
                    ? `${provider.providerName} · ${group.modelName}`
                    : provider.providerName}
                </div>
                {group.voices.map((voice) => {
                  const currentModelId = ttsProvidersConfig[ttsProviderId]?.modelId || '';
                  const isActive =
                    ttsProviderId === provider.providerId &&
                    ttsVoice === voice.id &&
                    currentModelId === (group.modelId || '');
                  const previewKey = `${provider.providerId}::${voice.id}`;
                  const isPreviewing = previewingId === previewKey;

                  return (
                    <div
                      key={previewKey}
                      className={cn(
                        'flex items-center gap-1.5 rounded-lg transition-colors',
                        isActive ? 'bg-violet-100' : 'hover:bg-slate-50',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setTTSProvider(provider.providerId);
                          setTTSVoice(voice.id);
                          if (group.modelId) {
                            setTTSProviderConfig(provider.providerId, { modelId: group.modelId });
                          }
                          setPopoverOpen(false);
                        }}
                        className={cn(
                          'flex-1 text-left text-[13px] px-2 py-1.5 min-w-0 truncate',
                          isActive ? 'text-violet-700 font-medium' : 'text-slate-800',
                        )}
                      >
                        {voice.name}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handlePreview(provider.providerId, voice.id, group.modelId);
                        }}
                        className={cn(
                          'shrink-0 size-6 flex items-center justify-center rounded-md transition-colors',
                          isPreviewing
                            ? 'text-violet-700'
                            : 'text-slate-400 hover:text-slate-700',
                        )}
                      >
                        {isPreviewing ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Volume2 className="size-3.5" />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )),
          )}
        </PopoverContent>
      </Popover>
    </VoicePillBase>
  );
}

export function AgentBar() {
  const { t } = useI18n();
  const { listAgents } = useAgentRegistry();
  const selectedAgentIds = useSettingsStore((s) => s.selectedAgentIds);
  const setSelectedAgentIds = useSettingsStore((s) => s.setSelectedAgentIds);
  const maxTurns = useSettingsStore((s) => s.maxTurns);
  const setMaxTurns = useSettingsStore((s) => s.setMaxTurns);
  const agentMode = useSettingsStore((s) => s.agentMode);
  const setAgentMode = useSettingsStore((s) => s.setAgentMode);
  const ttsProvidersConfig = useSettingsStore((s) => s.ttsProvidersConfig);
  const ttsEnabled = useSettingsStore((s) => s.ttsEnabled);

  const [open, setOpen] = useState(false);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const loadVoices = () => setBrowserVoices(speechSynthesis.getVoices());
    loadVoices();
    speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => speechSynthesis.removeEventListener('voiceschanged', loadVoices);
  }, []);

  const allAgents = listAgents();
  const agents = allAgents.filter((a) => !a.isGenerated);
  const teacherAgent = agents.find((a) => a.role === 'teacher');
  const selectedAgents = agents.filter((a) => selectedAgentIds.includes(a.id));
  const nonTeacherSelected = selectedAgents.filter((a) => a.role !== 'teacher');

  const serverProviders = getAvailableProvidersWithVoices(ttsProvidersConfig);
  const availableProviders: ProviderWithVoices[] = [
    ...serverProviders,
    ...(browserVoices.length > 0
      ? [
          {
            providerId: 'browser-native-tts' as TTSProviderId,
            providerName: 'Browser Native',
            voices: browserVoices.map((voice) => ({ id: voice.voiceURI, name: voice.name })),
            modelGroups: [
              {
                modelId: '',
                modelName: 'Browser Native',
                voices: browserVoices.map((voice) => ({ id: voice.voiceURI, name: voice.name })),
              },
            ],
          },
        ]
      : []),
  ];
  const showVoice = availableProviders.length > 0;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current && containerRef.current.contains(target)) return;
      if ((target as Element).closest?.('[data-radix-popper-content-wrapper]')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleModeChange = (mode: 'preset' | 'auto') => {
    setAgentMode(mode);
    if (mode === 'preset') {
      const presetSafeIds = selectedAgentIds.filter((id) => agents.some((agent) => agent.id === id));
      const hasTeacherSelected = presetSafeIds.some((id) => {
        const agent = agents.find((item) => item.id === id);
        return agent?.role === 'teacher';
      });

      const nextIds =
        !hasTeacherSelected && teacherAgent ? [teacherAgent.id, ...presetSafeIds] : presetSafeIds;

      setSelectedAgentIds(nextIds);
    }
  };

  const toggleAgent = (agentId: string) => {
    const agent = agents.find((item) => item.id === agentId);
    if (agent?.role === 'teacher') return;
    if (selectedAgentIds.includes(agentId)) {
      setSelectedAgentIds(selectedAgentIds.filter((id) => id !== agentId));
    } else {
      setSelectedAgentIds([...selectedAgentIds, agentId]);
    }
  };

  const getAgentName = (agent: { id: string; name: string }) => {
    const key = `settings.agentNames.${agent.id}`;
    const translated = t(key);
    return translated !== key ? translated : agent.name;
  };

  const getAgentRole = (agent: { role: string }) => {
    const key = `settings.agentRoles.${agent.role}`;
    const translated = t(key);
    return translated !== key ? translated : agent.role;
  };

  const avatarRow = (
    <div className="flex items-center gap-1.5 shrink-0">
      {teacherAgent && (
        <div className="size-8 rounded-full overflow-hidden ring-2 ring-slate-900/30 shrink-0">
          <img
            src={teacherAgent.avatar}
            alt={getAgentName(teacherAgent)}
            className="size-full object-cover"
          />
        </div>
      )}

      {agentMode === 'auto' ? (
        <>
          <div className="flex -space-x-2">
            {agents.find((a) => a.role === 'assistant') && (
              <div className="size-8 rounded-full overflow-hidden ring-[1.5px] ring-background">
                <img
                  src={agents.find((a) => a.role === 'assistant')!.avatar}
                  alt=""
                  className="size-full object-cover"
                />
              </div>
            )}
          </div>
          <Shuffle className="size-4 text-orange-500" />
        </>
      ) : (
        <>
          {nonTeacherSelected.length > 0 && (
            <div className="flex -space-x-2">
              {nonTeacherSelected.slice(0, 4).map((agent) => (
                <div
                  key={agent.id}
                  className="size-8 rounded-full overflow-hidden ring-[1.5px] ring-background"
                >
                  <img
                    src={agent.avatar}
                    alt={getAgentName(agent)}
                    className="size-full object-cover"
                  />
                </div>
              ))}
              {nonTeacherSelected.length > 4 && (
                <div className="size-8 rounded-full bg-muted ring-[1.5px] ring-background flex items-center justify-center">
                  <span className="text-[9px] font-bold text-muted-foreground">
                    +{nonTeacherSelected.length - 4}
                  </span>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {showVoice &&
        (ttsEnabled ? (
          <Volume2 className="size-4 text-violet-500" />
        ) : (
          <VolumeX className="size-4 text-slate-300" />
        ))}
    </div>
  );

  return (
    <div ref={containerRef} className="relative w-auto max-w-full sm:w-[420px]">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className={cn(
              'group inline-flex items-center h-12 gap-2 cursor-pointer rounded-full px-2.5 py-2 transition-colors w-auto',
              'border-[3px] border-slate-900/70 bg-white/90 text-slate-700 hover:border-slate-900/85 hover:bg-sky-50',
            )}
            onClick={() => setOpen(!open)}
          >
            <span className="text-xs text-slate-600 group-hover:text-slate-800 transition-colors hidden md:block font-medium flex-1 text-left">
              {open ? t('agentBar.expandedTitle') : t('agentBar.readyToLearn')}
            </span>
            {avatarRow}
            {open ? (
              <ChevronUp className="size-3 text-slate-500 group-hover:text-slate-700 transition-colors" />
            ) : (
              <ChevronDown className="size-3 text-slate-500 group-hover:text-slate-700 transition-colors" />
            )}
          </button>
        </TooltipTrigger>
        {!open && (
          <TooltipContent side="bottom" sideOffset={4}>
            {t('agentBar.configTooltip')}
          </TooltipContent>
        )}
      </Tooltip>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="absolute left-0 top-full mt-2 z-50 w-[420px]"
          >
            <div className="rounded-2xl bg-white/96 backdrop-blur-sm border-[3px] border-slate-900/70 shadow-[0_2px_0_rgba(15,23,42,0.15)] px-2.5 py-2">
              {teacherAgent && (
                <div className="w-full flex items-center gap-3 px-3 py-2 rounded-xl bg-violet-50/80 mb-2 border border-violet-100">
                  <div className="size-10 rounded-full overflow-hidden shrink-0 ring-1 ring-slate-900/25">
                    <img
                      src={teacherAgent.avatar}
                      alt={getAgentName(teacherAgent)}
                      className="size-full object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium flex items-center gap-1.5">
                      {getAgentName(teacherAgent)}
                      <span className="text-[10px] text-muted-foreground/50 font-normal">
                        {getAgentRole(teacherAgent)}
                      </span>
                    </div>
                  </div>
                  {showVoice && (
                    <TeacherVoicePill availableProviders={availableProviders} disabled={!ttsEnabled} />
                  )}
                </div>
              )}

              <div className="flex rounded-lg border border-slate-900/25 bg-sky-50/70 p-0.5 mb-2.5">
                <button
                  onClick={() => handleModeChange('preset')}
                  className={cn(
                    'flex-1 py-1.5 text-xs font-medium rounded-md transition-all text-center',
                    agentMode === 'preset'
                      ? 'bg-white text-slate-800 border border-slate-900/25'
                      : 'text-slate-500 hover:text-slate-700',
                  )}
                >
                  {t('settings.agentModePreset')}
                </button>
                <button
                  onClick={() => handleModeChange('auto')}
                  className={cn(
                    'flex-1 py-1.5 text-xs font-medium rounded-md transition-all text-center flex items-center justify-center gap-1',
                    agentMode === 'auto'
                      ? 'bg-white text-slate-800 border border-slate-900/25'
                      : 'text-slate-500 hover:text-slate-700',
                  )}
                >
                  <Sparkles className="h-3 w-3 text-orange-500" />
                  {t('settings.agentModeAuto')}
                </button>
              </div>

              {agentMode === 'preset' ? (
                <div className="max-h-72 overflow-y-auto -mx-1">
                  {agents
                    .filter((a) => a.role !== 'teacher')
                    .map((agent, index) => {
                      const isSelected = selectedAgentIds.includes(agent.id);
                      return (
                        <div
                          key={agent.id}
                          onClick={() => toggleAgent(agent.id)}
                          className={cn(
                            'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors cursor-pointer rounded-lg',
                            isSelected ? 'bg-sky-100/80' : 'hover:bg-sky-50/60',
                          )}
                        >
                          <Checkbox checked={isSelected} className="pointer-events-none" />
                          <div
                            className={cn(
                              'size-10 rounded-full overflow-hidden shrink-0 ring-1',
                              isSelected ? 'ring-slate-900/35' : 'ring-slate-200',
                            )}
                          >
                            <img
                              src={agent.avatar}
                              alt={getAgentName(agent)}
                              className="size-full object-cover"
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium flex items-center gap-1.5">
                              {getAgentName(agent)}
                              <span className="text-[10px] text-muted-foreground/50 font-normal">
                                {getAgentRole(agent)}
                              </span>
                            </div>
                            {(() => {
                              const descKey = `settings.agentDescriptions.${agent.id}`;
                              const desc = t(descKey);
                              return desc !== descKey ? (
                                <p className="text-xs text-muted-foreground/60 mt-0.5 leading-relaxed">
                                  {desc}
                                </p>
                              ) : null;
                            })()}
                          </div>
                          {showVoice && (
                            <AgentVoicePill
                              agent={agent}
                              agentIndex={index + 1}
                              availableProviders={availableProviders}
                              disabled={!ttsEnabled}
                            />
                          )}
                        </div>
                      );
                    })}
                </div>
              ) : (
                <div className="flex flex-col items-center pt-6 pb-2 gap-8">
                  <div className="size-14 rounded-full bg-sky-100 flex items-center justify-center border border-slate-900/20">
                    <Shuffle className="size-7 text-orange-500" />
                  </div>
                  <div className="space-y-1 text-center">
                    <p className="text-xs text-slate-500">{t('settings.agentModeAutoDesc')}</p>
                    {showVoice && (
                      <p className="text-[11px] text-violet-500">{t('agentBar.voiceAutoAssign')}</p>
                    )}
                  </div>
                </div>
              )}

              <div className="pt-2.5 mt-2.5 border-t border-slate-900/15 flex items-center gap-3">
                <span className="text-xs text-slate-500 shrink-0">{t('settings.maxTurns')}</span>
                <Input
                  type="number"
                  min="1"
                  max="20"
                  value={maxTurns}
                  onChange={(e) => setMaxTurns(e.target.value)}
                  className="w-16 h-7 text-xs border-slate-900/25"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

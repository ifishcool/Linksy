'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  ImagePlus,
  LogOut,
  Pencil,
  Trash2,
  Settings,
  BotOff,
  ChevronUp,
  MoreHorizontal,
} from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { supportedLocales } from '@/lib/i18n';
import { createLogger } from '@/lib/logger';
import { Textarea as UITextarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { SettingsDialog } from '@/components/settings';
import { GenerationToolbar } from '@/components/generation/generation-toolbar';
import { AgentBar } from '@/components/agent/agent-bar';
import { nanoid } from 'nanoid';
import { storePdfBlob } from '@/lib/utils/image-storage';
import type { UserRequirements } from '@/lib/types/generation';
import { useSettingsStore } from '@/lib/store/settings';
import { useUserProfileStore, AVATAR_OPTIONS } from '@/lib/store/user-profile';
import { StageListItem, listStages, deleteStageData } from '@/lib/utils/stage-storage';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDraftCache } from '@/lib/hooks/use-draft-cache';
import { SpeechButton } from '@/components/audio/speech-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { getSupabaseClient } from '@/lib/supabase/client';
const now = Date.now();
const log = createLogger('Home');

const WEB_SEARCH_STORAGE_KEY = 'webSearchEnabled';
const LANGUAGE_STORAGE_KEY = 'generationLanguage';
const SETUP_AUTO_REFRESH_KEY = 'setupAutoRefreshed';

interface FormState {
  pdfFile: File | null;
  requirement: string;
  language: 'zh-CN' | 'en-US' | 'ja-JP';
  webSearch: boolean;
}

const initialFormState: FormState = {
  pdfFile: null,
  requirement: '',
  language: 'zh-CN',
  webSearch: false,
};

type BillingCycle = 'monthly' | 'yearly';
type AccountPlan = {
  plan: 'free' | 'pro';
  billingCycle: BillingCycle | null;
  expiresAt: string | null;
};

type BillingOrder = {
  id: string;
  stripe_session_id: string;
  product_id: string;
  product_kind: 'score_pack' | 'pro_pass';
  billing_cycle: BillingCycle | null;
  amount_paid: number;
  currency: string;
  status: string;
  entitlement_status: string;
  score_delta: number;
  subscription_plan: string | null;
  subscription_expires_at: string | null;
  paid_at: string | null;
  created_at: string;
};

function readAccountPlanFromMetadata(metadata: Record<string, unknown> | undefined): AccountPlan {
  const expiresAt =
    typeof metadata?.subscriptionExpiresAt === 'string' ? metadata.subscriptionExpiresAt : null;
  const hasActivePro =
    metadata?.subscriptionPlan === 'pro' &&
    metadata?.subscriptionStatus === 'active' &&
    !!expiresAt &&
    new Date(expiresAt) > new Date();

  return {
    plan: hasActivePro ? 'pro' : 'free',
    billingCycle:
      metadata?.subscriptionBillingCycle === 'monthly' ||
      metadata?.subscriptionBillingCycle === 'yearly'
        ? metadata.subscriptionBillingCycle
        : null,
    expiresAt: hasActivePro ? expiresAt : null,
  };
}

function formatDateTime(dateString: string | null, locale: string, fallbackText: string) {
  if (!dateString) return fallbackText;

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return fallbackText;
  }

  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getHeroLogo(locale: string) {
  const logos: Record<string, string> = {
    'zh-CN': '/logo_t.png',
    'en-US': '/logo_t_e.png',
    'ja-JP': '/logo_t_e.png',
  };
  return logos[locale] ?? '/logo_t_e.png';
}

function getSidebarLogo(locale: string) {
  const logos: Record<string, string> = {
    'zh-CN': '/logo.png',
    'en-US': '/logo_e.png',
    'ja-JP': '/logo_e.png',
  };
  return logos[locale] ?? '/logo_e.png';
}

function HomePage() {
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initialFormState);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<
    import('@/lib/types/settings').SettingsSection | undefined
  >(undefined);

  // Draft cache for requirement text
  const { cachedValue: cachedRequirement, updateCache: updateRequirementCache } =
    useDraftCache<string>({ key: 'requirementDraft' });

  // Model setup state
  const currentModelId = useSettingsStore((s) => s.modelId);
  const profileAvatar = useUserProfileStore((s) => s.avatar);
  const profileNickname = useUserProfileStore((s) => s.nickname);
  const [storeHydrated, setStoreHydrated] = useState(false);

  // Hydrate client-only state after mount (avoids SSR mismatch)
  /* eslint-disable react-hooks/set-state-in-effect -- Hydration from localStorage must happen in effect */
  useEffect(() => {
    setStoreHydrated(true);
    try {
      const savedWebSearch = localStorage.getItem(WEB_SEARCH_STORAGE_KEY);
      const savedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY);
      const updates: Partial<FormState> = {};
      if (savedWebSearch === 'true') updates.webSearch = true;
      if (savedLanguage === 'zh-CN' || savedLanguage === 'en-US' || savedLanguage === 'ja-JP') {
        updates.language = savedLanguage;
      } else {
        const navLanguage = navigator.language?.toLowerCase() ?? '';
        const detected = navLanguage.startsWith('zh')
          ? 'zh-CN'
          : navLanguage.startsWith('ja')
            ? 'ja-JP'
            : 'en-US';
        updates.language = detected;
      }
      if (Object.keys(updates).length > 0) {
        setForm((prev) => ({ ...prev, ...updates }));
      }
    } catch {
      /* localStorage unavailable */
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Restore requirement draft from cache (derived state pattern — no effect needed)
  const [prevCachedRequirement, setPrevCachedRequirement] = useState(cachedRequirement);
  if (cachedRequirement !== prevCachedRequirement) {
    setPrevCachedRequirement(cachedRequirement);
    if (cachedRequirement) {
      setForm((prev) => ({ ...prev, requirement: cachedRequirement }));
    }
  }

  const needsSetup = storeHydrated && !currentModelId;
  const [languageOpen, setLanguageOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [classrooms, setClassrooms] = useState<StageListItem[]>([]);
  const supabaseClient = useMemo(() => getSupabaseClient(), []);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [aiLearningScore, setAiLearningScore] = useState(0);
  const [accountPlan, setAccountPlan] = useState<AccountPlan>({
    plan: 'free',
    billingCycle: null,
    expiresAt: null,
  });
  const [authLoading, setAuthLoading] = useState(() => !!supabaseClient);
  const [accountPopoverOpen, setAccountPopoverOpen] = useState(false);
  const [rechargeDialogOpen, setRechargeDialogOpen] = useState(false);
  const [ordersDialogOpen, setOrdersDialogOpen] = useState(false);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [purchasingPackScore, setPurchasingPackScore] = useState<number | null>(null);
  const [startingSubscription, setStartingSubscription] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orders, setOrders] = useState<BillingOrder[]>([]);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const displayName = profileNickname || t('profile.defaultNickname');

  useEffect(() => {
    if (!supabaseClient) return;

    let active = true;

    supabaseClient.auth.getUser().then(({ data }) => {
      if (!active) return;
      setAuthEmail(data.user?.email ?? null);
      setAiLearningScore(Number(data.user?.user_metadata?.aiLearningScore ?? 0) || 0);
      setAccountPlan(readAccountPlanFromMetadata(data.user?.user_metadata));
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange(async () => {
      const {
        data: { user: latestUser },
      } = await supabaseClient.auth.getUser();

      if (!active) return;

      setAuthEmail(latestUser?.email ?? null);
      setAiLearningScore(Number(latestUser?.user_metadata?.aiLearningScore ?? 0) || 0);
      setAccountPlan(readAccountPlanFromMetadata(latestUser?.user_metadata));
      setAuthLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabaseClient]);

  useEffect(() => {
    if (typeof window === 'undefined' || !supabaseClient) return;

    const url = new URL(window.location.href);
    const checkout = url.searchParams.get('checkout');
    if (!checkout) return;

    const clearParams = () => {
      url.searchParams.delete('checkout');
      url.searchParams.delete('sessionId');
      window.history.replaceState({}, '', url.toString());
    };

    if (checkout === 'cancelled') {
      toast.message(t('checkout.cancelled'));
      clearParams();
      return;
    }

    if (checkout === 'error') {
      toast.error(t('checkout.processingFailed'));
      clearParams();
      return;
    }

    if (checkout !== 'success') return;

    const sessionId = url.searchParams.get('sessionId');

    const applyCheckoutResult = async () => {
      const {
        data: { user },
        error,
      } = await supabaseClient.auth.getUser();

      if (error || !user) {
        toast.error(t('checkout.signInRequired'));
        clearParams();
        return;
      }

      if (!sessionId) {
        clearParams();
        return;
      }

      const {
        data: { session: authSession },
      } = await supabaseClient.auth.getSession();

      const token = authSession?.access_token;
      if (!token) {
        toast.error(t('checkout.sessionExpired'));
        clearParams();
        return;
      }

      let statusResult: {
        processed: boolean;
        kind: 'score_pack' | 'pro_pass' | null;
        scoreDelta: number;
        billingCycle: BillingCycle | null;
        currentScore: number;
        subscriptionExpiresAt: string | null;
      } | null = null;

      for (let attempt = 0; attempt < 6; attempt++) {
        const response = await fetch(
          `/api/stripe/checkout/status?session_id=${encodeURIComponent(sessionId)}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );

        const data = (await response.json().catch(() => ({}))) as {
          processed?: boolean;
          kind?: 'score_pack' | 'pro_pass' | null;
          scoreDelta?: number;
          billingCycle?: BillingCycle | null;
          currentScore?: number;
          subscriptionExpiresAt?: string | null;
        };

        if (response.ok) {
          statusResult = {
            processed: !!data.processed,
            kind: data.kind ?? null,
            scoreDelta: Number(data.scoreDelta ?? 0) || 0,
            billingCycle: data.billingCycle ?? null,
            currentScore: Number(data.currentScore ?? 0) || 0,
            subscriptionExpiresAt: data.subscriptionExpiresAt ?? null,
          };

          if (statusResult.processed) break;
        }

        await new Promise((resolve) => window.setTimeout(resolve, 1200));
      }

      if (statusResult?.processed) {
        setAiLearningScore(statusResult.currentScore);
        if (statusResult.kind === 'pro_pass') {
          setAccountPlan({
            plan: 'pro',
            billingCycle: statusResult.billingCycle,
            expiresAt: statusResult.subscriptionExpiresAt,
          });
        }
        if (ordersDialogOpen) {
          void loadOrders();
        }
        if (statusResult.kind === 'score_pack') {
          toast.success(t('checkout.scoreAdded', { score: statusResult.scoreDelta }));
        } else if (statusResult.kind === 'pro_pass') {
          toast.success(
            statusResult.billingCycle === 'yearly'
              ? t('checkout.proYearlyActivated')
              : t('checkout.proMonthlyActivated'),
          );
        } else {
          toast.success(t('checkout.success'));
        }

        const {
          data: { user: latestUser },
        } = await supabaseClient.auth.getUser();
        if (latestUser) {
          setAiLearningScore(Number(latestUser.user_metadata?.aiLearningScore ?? 0) || 0);
          setAccountPlan(readAccountPlanFromMetadata(latestUser.user_metadata));
        }
      } else {
        toast.message(t('checkout.pendingBenefits'));
      }

      clearParams();
    };

    void applyCheckoutResult();
  }, [supabaseClient, t]);

  const handleSignOut = async () => {
    if (!supabaseClient) {
      return;
    }
    const { error: signOutError } = await supabaseClient.auth.signOut();
    if (signOutError) {
      toast.error(signOutError.message);
      return;
    }
    setAccountPopoverOpen(false);
    setOrders([]);
    setAccountPlan({ plan: 'free', billingCycle: null, expiresAt: null });
    toast.success(t('account.signedOut'));
  };

  const loadOrders = async () => {
    if (!supabaseClient) return;

    const {
      data: { session: authSession },
    } = await supabaseClient.auth.getSession();

    const token = authSession?.access_token;
    if (!token) {
      setOrders([]);
      return;
    }

    setOrdersLoading(true);
    try {
      const response = await fetch('/api/account/orders', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = (await response.json().catch(() => ({}))) as {
        orders?: BillingOrder[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load orders');
      }

      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } catch (error) {
      setOrders([]);
      toast.error(error instanceof Error ? error.message : t('account.loadOrdersFailed'));
    } finally {
      setOrdersLoading(false);
    }
  };

  const handleAuthEntry = () => {
    router.push('/auth');
  };

  const createCheckoutSession = async (payload: { productId: string }) => {
    if (!supabaseClient) {
      toast.error(t('checkout.authServiceMissing'));
      return null;
    }

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();
    const {
      data: { session: authSession },
    } = await supabaseClient.auth.getSession();

    if (userError || !user) {
      toast.error(t('checkout.signInBeforePurchase'));
      if (!user) router.push('/auth');
      return null;
    }

    const response = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authSession?.access_token ?? ''}`,
      },
      body: JSON.stringify(payload),
    });

    const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!response.ok || !data.url) {
      toast.error(data.error || t('checkout.createFailed'));
      return null;
    }

    window.location.href = data.url;
    return data.url;
  };

  const handleTestScorePackPurchase = async (scoreToAdd: number) => {
    setPurchasingPackScore(scoreToAdd);
    try {
      await createCheckoutSession({
        productId:
          scoreToAdd === 10
            ? 'score_pack_10_test'
            : scoreToAdd === 50
              ? 'score_pack_50'
              : 'score_pack_100',
      });
    } finally {
      setPurchasingPackScore(null);
    }
  };

  const handleStartSubscription = async () => {
    setStartingSubscription(true);
    try {
      await createCheckoutSession({
        productId: billingCycle === 'yearly' ? 'pro_year_pass' : 'pro_month_pass',
      });
    } finally {
      setStartingSubscription(false);
    }
  };

  const ensureAuthenticated = () => {
    if (authEmail) return true;
    toast.error(t('checkout.signInFirst'));
    router.push('/auth');
    return false;
  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    if (!languageOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setLanguageOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [languageOpen]);

  useEffect(() => {
    if (!ordersDialogOpen || !authEmail) return;
    void loadOrders();
  }, [ordersDialogOpen, authEmail]);
  // 无数据时，刷新界面
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!storeHydrated) return;

    if (!needsSetup) {
      try {
        sessionStorage.removeItem(SETUP_AUTO_REFRESH_KEY);
      } catch {
        /* ignore */
      }
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;

      const latestModelId = useSettingsStore.getState().modelId;
      if (latestModelId) return;

      try {
        if (sessionStorage.getItem(SETUP_AUTO_REFRESH_KEY) === '1') return;
        sessionStorage.setItem(SETUP_AUTO_REFRESH_KEY, '1');
      } catch {
        /* ignore */
      }

      window.location.reload();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [needsSetup, storeHydrated]);

  const loadClassrooms = async () => {
    try {
      const list = await listStages();
      setClassrooms(list);
    } catch (err) {
      log.error('Failed to load classrooms:', err);
    }
  };

  useEffect(() => {
    // Clear stale media store to prevent cross-course thumbnail contamination.
    // The store may hold tasks from a previously visited classroom whose elementIds
    // (gen_img_1, etc.) collide with other courses' placeholders.
    useMediaGenerationStore.getState().revokeObjectUrls();
    useMediaGenerationStore.setState({ tasks: {} });

    // eslint-disable-next-line react-hooks/set-state-in-effect -- Store hydration on mount
    loadClassrooms();
  }, []);

  const confirmDelete = async (id: string) => {
    try {
      await deleteStageData(id);
      await loadClassrooms();
    } catch (err) {
      log.error('Failed to delete classroom:', err);
      toast.error('Failed to delete classroom');
    }
  };

  const updateForm = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    try {
      if (field === 'webSearch') localStorage.setItem(WEB_SEARCH_STORAGE_KEY, String(value));
      if (field === 'language') localStorage.setItem(LANGUAGE_STORAGE_KEY, String(value));
      if (field === 'requirement') updateRequirementCache(value as string);
    } catch {
      /* ignore */
    }
  };

  const showSetupToast = (icon: React.ReactNode, title: string, desc: string) => {
    toast.custom(
      (id) => (
        <div
          className="w-[356px] rounded-xl border border-amber-200/60 bg-gradient-to-r from-amber-50 via-white to-amber-50 shadow-lg shadow-amber-500/8 p-4 flex items-start gap-3 cursor-pointer"
          onClick={() => {
            toast.dismiss(id);
            setSettingsOpen(true);
          }}
        >
          <div className="shrink-0 mt-0.5 size-9 rounded-lg bg-amber-100 flex items-center justify-center ring-1 ring-amber-200/50">
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900 leading-tight">{title}</p>
            <p className="text-xs text-amber-700/80 mt-0.5 leading-relaxed">{desc}</p>
          </div>
          <div className="shrink-0 mt-1 text-[10px] font-medium text-amber-500 tracking-wide">
            <Settings className="size-3.5 animate-[spin_3s_linear_infinite]" />
          </div>
        </div>
      ),
      { duration: 4000 },
    );
  };

  const handleGenerateComic = async () => {
    if (!ensureAuthenticated()) return;

    if (!currentModelId) {
      showSetupToast(
        <BotOff className="size-4.5 text-amber-600" />,
        t('settings.modelNotConfigured'),
        t('settings.setupNeeded'),
      );
      setSettingsOpen(true);
      return;
    }

    if (!form.requirement.trim()) {
      setError(t('upload.requirementRequired'));
      return;
    }

    setError(null);

    try {
      const userProfile = useUserProfileStore.getState();
      const requirements: UserRequirements = {
        requirement: form.requirement,
        language: form.language,
        userNickname: userProfile.nickname || undefined,
        userBio: userProfile.bio || undefined,
        webSearch: form.webSearch || undefined,
      };

      const comicSession = {
        sessionId: nanoid(),
        requirements,
        pages: null,
        currentStep: 'generating' as const,
      };

      sessionStorage.setItem('comicSession', JSON.stringify(comicSession));
      router.push('/comic-preview');
    } catch (err) {
      log.error('Error preparing comic generation:', err);
      setError(err instanceof Error ? err.message : t('upload.generateFailed'));
    }
  };

  const handleGenerate = async () => {
    if (!ensureAuthenticated()) return;

    // Validate setup before proceeding
    if (!currentModelId) {
      showSetupToast(
        <BotOff className="size-4.5 text-amber-600" />,
        t('settings.modelNotConfigured'),
        t('settings.setupNeeded'),
      );
      setSettingsOpen(true);
      return;
    }

    if (!form.requirement.trim()) {
      setError(t('upload.requirementRequired'));
      return;
    }

    setError(null);

    try {
      const userProfile = useUserProfileStore.getState();
      const requirements: UserRequirements = {
        requirement: form.requirement,
        language: form.language,
        userNickname: userProfile.nickname || undefined,
        userBio: userProfile.bio || undefined,
        webSearch: form.webSearch || undefined,
      };

      let pdfStorageKey: string | undefined;
      let pdfFileName: string | undefined;
      let pdfProviderId: string | undefined;
      let pdfProviderConfig: { apiKey?: string; baseUrl?: string } | undefined;

      if (form.pdfFile) {
        pdfStorageKey = await storePdfBlob(form.pdfFile);
        pdfFileName = form.pdfFile.name;

        const settings = useSettingsStore.getState();
        pdfProviderId = settings.pdfProviderId;
        const providerCfg = settings.pdfProvidersConfig?.[settings.pdfProviderId];
        if (providerCfg) {
          pdfProviderConfig = {
            apiKey: providerCfg.apiKey,
            baseUrl: providerCfg.baseUrl,
          };
        }
      }

      const sessionState = {
        sessionId: nanoid(),
        requirements,
        pdfText: '',
        pdfImages: [],
        imageStorageIds: [],
        pdfStorageKey,
        pdfFileName,
        pdfProviderId,
        pdfProviderConfig,
        sceneOutlines: null,
        currentStep: 'generating' as const,
      };
      sessionStorage.setItem('generationSession', JSON.stringify(sessionState));

      router.push('/generation-preview');
    } catch (err) {
      log.error('Error preparing generation:', err);
      setError(err instanceof Error ? err.message : t('upload.generateFailed'));
    }
  };

  const sidebarSections = useMemo(() => {
    const dayMs = 1000 * 60 * 60 * 24;
    const today: StageListItem[] = [];
    const yesterday: StageListItem[] = [];
    const dayBeforeYesterday: StageListItem[] = [];
    const withinSevenDays: StageListItem[] = [];
    const withinThirtyDays: StageListItem[] = [];
    const older: StageListItem[] = [];

    for (const item of classrooms) {
      const diffDays = Math.floor(Math.abs(now - item.updatedAt) / dayMs);
      if (diffDays === 0) {
        today.push(item);
      } else if (diffDays === 1) {
        yesterday.push(item);
      } else if (diffDays === 2) {
        dayBeforeYesterday.push(item);
      } else if (diffDays < 7) {
        withinSevenDays.push(item);
      } else if (diffDays < 30) {
        withinThirtyDays.push(item);
      } else {
        older.push(item);
      }
    }

    const dayBeforeYesterdayLabel = t('history.dayBeforeYesterday');
    const sevenDaysLabel = t('history.withinSevenDays');
    const thirtyDaysLabel = t('history.withinThirtyDays');
    const olderLabel = t('history.older');

    return [
      { key: 'today', label: t('classroom.today'), items: today },
      { key: 'yesterday', label: t('classroom.yesterday'), items: yesterday },
      { key: 'dayBeforeYesterday', label: dayBeforeYesterdayLabel, items: dayBeforeYesterday },
      { key: 'sevenDays', label: sevenDaysLabel, items: withinSevenDays },
      { key: 'thirtyDays', label: thirtyDaysLabel, items: withinThirtyDays },
      { key: 'older', label: olderLabel, items: older },
    ].filter((section) => section.items.length > 0);
  }, [classrooms, locale, t]);

  const canGenerate = !!form.requirement.trim();
  const isCurrentProPlan = accountPlan.plan === 'pro' && !!accountPlan.expiresAt;
  const isCurrentFreePlan = accountPlan.plan === 'free';

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (canGenerate) handleGenerate();
    }
  };

  return (
    <div className="relative min-h-[100dvh] w-full overflow-x-hidden">
      <div className="fixed inset-0 -z-10 bg-[url('/bg.png')] bg-cover bg-center bg-no-repeat pointer-events-none" />
      <HomeSidebar
        sections={sidebarSections}
        locale={locale}
        onOpenClassroom={(id) => {
          if (!ensureAuthenticated()) return;
          if (id.startsWith('comic_')) {
            router.push(`/comic-preview?historyId=${encodeURIComponent(id)}`);
            return;
          }
          router.push(`/classroom/${id}`);
        }}
        onDeleteClassroom={async (id) => {
          const confirmed = window.confirm(`${t('classroom.deleteConfirmTitle')}?`);
          if (!confirmed) return;
          await confirmDelete(id);
        }}
      />

      <div className="relative min-h-[100dvh] w-full flex flex-col items-center justify-center p-3 sm:p-4  pl-[200px] sm:pl-[220px] lg:pl-[296px] pr-3 sm:pr-6">
        {/* ═══ Top-right pill (unchanged) ═══ */}
        <div
          ref={toolbarRef}
          className="fixed top-4 right-4 z-50 flex items-center gap-0.5 bg-white/92 backdrop-blur-md px-1.5 py-1 rounded-full border-[3px] border-slate-900/70 shadow-[0_2px_0_rgba(15,23,42,0.2)] md:gap-1 md:px-2 md:py-1.5"
        >
          {/* Language Selector */}
          <div className="relative">
            <button
              onClick={() => {
                setLanguageOpen(!languageOpen);
              }}
              className="flex h-8 cursor-pointer items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold text-slate-600 hover:bg-sky-50 hover:text-sky-700 hover:shadow-sm transition-all md:h-10 md:px-3 md:py-1.5 md:text-xs"
            >
              {supportedLocales.find((item) => item.code === locale)?.shortLabel ?? locale}
            </button>
            {languageOpen && (
              <div className="absolute top-full mt-2 right-0 bg-white border-[3px] border-slate-900/80 rounded-lg shadow-lg overflow-hidden z-50 min-w-[120px]">
                {supportedLocales.map((item) => (
                  <button
                    key={item.code}
                    onClick={() => {
                      setLocale(item.code);
                      setLanguageOpen(false);
                    }}
                    className={cn(
                      'w-full px-4 py-2 text-left text-sm hover:bg-sky-50 transition-colors',
                      locale === item.code && 'bg-sky-100 text-sky-700 font-semibold',
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mx-0.5 h-4 w-px bg-black md:mx-1 md:h-4" />

          {authLoading ? (
            <div className="px-2.5 py-1 text-[11px] font-bold text-slate-500 md:px-3 md:py-1.5 md:text-xs">
              {t('common.loading')}
            </div>
          ) : authEmail ? (
            <Popover open={accountPopoverOpen} onOpenChange={setAccountPopoverOpen}>
              <PopoverTrigger asChild>
                <button className="flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-sky-50 hover:text-sky-700 hover:shadow-sm transition-all md:h-auto md:gap-2 md:px-3 md:py-1.5 md:text-xs">
                  <div className="size-5 rounded-full overflow-hidden border-2 border-slate-900/20 bg-white shrink-0 md:size-6">
                    <img src={profileAvatar} alt="" className="size-full object-cover" />
                  </div>
                  <span>{t('account.center')}</span>
                  <span className="inline-flex h-4 min-w-5 items-center justify-center rounded-full border border-sky-200 bg-sky-100 px-1 text-[10px] font-black text-sky-700 md:h-5 md:min-w-7 md:px-1.5 md:text-[11px]">
                    {aiLearningScore}
                  </span>
                  <ChevronDown className="size-3 text-slate-400 md:size-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                alignOffset={-44}
                side="bottom"
                sideOffset={18}
                className="w-[220px] rounded-[18px] border-[3px] border-slate-900/75 bg-white/98 p-0 shadow-[0_8px_0_rgba(15,23,42,0.12)] md:w-[280px] md:rounded-[24px]"
              >
                <div className="p-2.5 md:p-4">
                  <div className="flex items-center gap-2 rounded-[14px] border-[3px] border-slate-900/10 bg-sky-50/60 px-2.5 py-2 md:gap-3 md:rounded-[20px] md:px-3 md:py-3">
                    <div className="size-10 rounded-full overflow-hidden border-[3px] border-slate-900/70 bg-white shrink-0 md:size-14">
                      <img src={profileAvatar} alt="" className="size-full object-cover" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[14px] font-black text-slate-800 truncate md:text-base">
                        {displayName}
                      </div>
                      <div className="text-[10px] leading-tight text-slate-500 break-all md:text-xs">
                        {authEmail}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 rounded-[14px] border-[3px] border-slate-900/10 bg-[#fff8e6] px-2.5 py-2 text-[11px] text-slate-700 md:mt-3 md:rounded-[18px] md:px-3 md:py-3 md:text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-black text-slate-500">{t('account.currentPlan')}</span>
                      <span className="font-black text-slate-900">
                        {accountPlan.plan === 'pro'
                          ? accountPlan.billingCycle === 'yearly'
                            ? t('account.proYearly')
                            : t('account.proMonthly')
                          : t('account.freePlan')}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-3">
                      <span className="font-black text-slate-500">{t('account.expiresOn')}</span>
                      <span className="font-bold text-slate-700">
                        {accountPlan.plan === 'pro'
                          ? formatDateTime(accountPlan.expiresAt, locale, t('common.na'))
                          : t('account.noExpiration')}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setAccountPopoverOpen(false);
                      setOrdersDialogOpen(true);
                    }}
                    className="mt-2.5 flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-full border-[3px] border-slate-900/75 bg-white px-3 py-1.5 text-[13px] font-black text-slate-800 transition-all hover:bg-sky-50 md:mt-3 md:h-auto md:px-4 md:py-2.5 md:text-sm"
                  >
                    <span>{t('account.myOrders')}</span>
                  </button>

                  <button
                    onClick={() => {
                      setAccountPopoverOpen(false);
                      setRechargeDialogOpen(true);
                    }}
                    className="mt-2.5 flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-full border-[3px] border-slate-900/75 bg-sky-400 px-3 py-1.5 text-[13px] font-black text-white transition-all hover:bg-sky-500 md:mt-4 md:h-auto md:px-4 md:py-2.5 md:text-sm"
                  >
                    <span>{t('account.recharge')}</span>
                  </button>

                  <button
                    onClick={() => void handleSignOut()}
                    className="mt-2 flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-full border-[3px] border-slate-900/75 bg-orange-400 px-3 py-1.5 text-[13px] font-black text-white transition-all hover:bg-orange-500 md:mt-3 md:h-auto md:px-4 md:py-2.5 md:text-sm"
                  >
                    <LogOut className="size-4" />
                    <span>{t('account.logout')}</span>
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          ) : (
            <button
              onClick={handleAuthEntry}
              className="flex h-8 cursor-pointer items-center px-2.5 py-1 rounded-full text-[11px] font-bold text-slate-600 hover:bg-sky-50 hover:text-sky-700 hover:shadow-sm transition-all md:h-10 md:px-3 md:py-1.5 md:text-xs"
            >
              {t('account.loginRegister')}
            </button>
          )}

          {/* Settings Button */}
          <div className="relative">
            <button
              onClick={() => setSettingsOpen(true)}
              className={cn(
                'cursor-pointer p-1.5 rounded-full text-slate-500 hover:bg-sky-50 hover:text-sky-700 hover:shadow-sm transition-all group md:p-2',
                needsSetup && 'animate-setup-glow',
              )}
            >
              <Settings className="w-3.5 h-3.5 group-hover:rotate-90 transition-transform duration-500 md:w-4 md:h-4" />
            </button>
            {needsSetup && (
              <>
                <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                  <span className="animate-setup-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-violet-500" />
                </span>
                <span className="animate-setup-float absolute top-full mt-2 right-0 whitespace-nowrap text-[11px] font-medium text-violet-600 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full shadow-sm pointer-events-none">
                  {t('settings.setupNeeded')}
                </span>
              </>
            )}
          </div>
        </div>
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={(open) => {
            setSettingsOpen(open);
            if (!open) setSettingsSection(undefined);
          }}
          initialSection={settingsSection}
        />
        <Dialog open={rechargeDialogOpen} onOpenChange={setRechargeDialogOpen}>
          <DialogContent
            showCloseButton={false}
            className="w-[min(920px,calc(100vw-20px))] max-w-none rounded-[24px] border-[4px] border-slate-900/80 bg-[#fff8e6] p-0 shadow-[0_10px_0_rgba(15,23,42,0.15)] md:w-[min(920px,calc(100vw-32px))] md:rounded-[32px]"
          >
            <DialogTitle className="sr-only">{t('billing.dialogTitle')}</DialogTitle>

            <div className="relative max-h-[85vh] overflow-y-auto overflow-x-hidden rounded-[18px] p-3 md:max-h-[88vh] md:rounded-[28px] md:p-6">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(125,211,252,0.2),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(251,191,36,0.18),transparent_30%)]" />

              <div className="relative flex items-start justify-between gap-3 md:gap-4">
                <div>
                  <h3 className="mt-1 text-lg font-black text-slate-900 md:mt-3 md:text-2xl">
                    {t('billing.choosePlan')}
                  </h3>
                  <p className="mt-1 pr-2 text-[11px] text-slate-600 md:text-sm">
                    {t('billing.choosePlanDesc')}
                  </p>
                </div>

                <button
                  onClick={() => setRechargeDialogOpen(false)}
                  className="shrink-0 cursor-pointer rounded-full border-[3px] border-slate-900/70 bg-white px-2.5 py-1 text-[10px] font-black text-slate-700 transition-colors hover:bg-sky-50 md:px-3 md:py-1.5 md:text-xs"
                >
                  {t('common.close')}
                </button>
              </div>

              <div className="relative mt-3 flex w-full rounded-[20px] border-[3px] border-slate-900/70 bg-white/90 p-1 shadow-[0_3px_0_rgba(15,23,42,0.08)] md:mt-5 md:inline-flex md:w-auto md:rounded-full">
                <button
                  onClick={() => setBillingCycle('monthly')}
                  className={cn(
                    'flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-[14px] px-2.5 py-1.5 text-[11px] font-black transition-all md:flex-none md:gap-2 md:rounded-full md:px-4 md:py-2 md:text-sm',
                    billingCycle === 'monthly'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-sky-50',
                  )}
                >
                  <span>{t('billing.monthly')}</span>
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.5 text-[8px] font-black md:px-2 md:text-[10px]',
                      billingCycle === 'monthly'
                        ? 'bg-white/20 text-sky-100'
                        : 'bg-sky-100 text-sky-700',
                    )}
                  >
                    {t('billing.flexible')}
                  </span>
                </button>
                <button
                  onClick={() => setBillingCycle('yearly')}
                  className={cn(
                    'flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-[14px] px-2.5 py-1.5 text-[11px] font-black transition-all md:flex-none md:gap-2 md:rounded-full md:px-4 md:py-2 md:text-sm',
                    billingCycle === 'yearly'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-sky-50',
                  )}
                >
                  <span>{t('billing.yearly')}</span>
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.5 text-[8px] font-black md:px-2 md:text-[10px]',
                      billingCycle === 'yearly'
                        ? 'bg-white/20 text-amber-100'
                        : 'bg-amber-100 text-amber-700',
                    )}
                  >
                    {t('billing.bestValue')}
                  </span>
                </button>
              </div>

              <div className="relative mt-4 grid grid-cols-2 gap-2 md:mt-6 md:gap-4">
                <div className="rounded-[22px] border-[4px] border-slate-900/75 bg-white px-3.5 py-3.5 shadow-[0_6px_0_rgba(15,23,42,0.12)] md:rounded-[28px] md:px-5 md:py-5">
                  <div className="flex items-center gap-2">
                    <h4 className="text-base font-black text-slate-900 md:text-xl">
                      {t('billing.free')}
                    </h4>
                    <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-black text-sky-700 md:px-2 md:text-[11px]">
                      {t('billing.currentAvailable')}
                    </span>
                  </div>
                  <div className="mt-1.5 text-[11px] font-bold text-slate-600 md:text-sm">
                    {t('billing.freeDesc')}
                  </div>
                  <div className="mt-3 flex items-end gap-1.5 md:mt-5">
                    <span className="text-[32px] leading-none font-black text-slate-900 md:text-5xl">
                      0
                    </span>
                    <span className="pb-0.5 text-[11px] font-bold text-slate-500 md:pb-1 md:text-sm">
                      {billingCycle === 'yearly' ? t('billing.perYear') : t('billing.perMonth')}
                    </span>
                  </div>
                  <button
                    className={cn(
                      'mt-4 flex h-10 w-full items-center justify-center rounded-full border-[3px] text-xs font-black md:mt-6 md:h-12 md:text-sm',
                      isCurrentFreePlan
                        ? 'border-slate-900/20 bg-slate-100 text-slate-400'
                        : 'border-slate-900/15 bg-white/70 text-slate-300',
                    )}
                    disabled
                  >
                    {isCurrentFreePlan ? t('billing.currentPlan') : t('billing.basicPlan')}
                  </button>
                  <div className="mt-4 space-y-1.5 text-[11px] text-slate-700 md:mt-6 md:space-y-3 md:text-sm">
                    <div>{t('billing.freeFeature1')}</div>
                    <div>{t('billing.freeFeature2')}</div>
                    <div>{t('billing.freeFeature3')}</div>
                  </div>
                </div>

                <div className="rounded-[22px] border-[4px] border-slate-900/75 bg-[linear-gradient(180deg,#fff5d6_0%,#ffffff_100%)] px-3.5 py-3.5 shadow-[0_6px_0_rgba(15,23,42,0.12)] md:rounded-[28px] md:px-5 md:py-5">
                  <div className="flex items-center gap-2">
                    <h4 className="text-base font-black text-slate-900 md:text-xl">
                      {t('billing.pro')}
                    </h4>
                    <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-black text-orange-700 md:px-2 md:text-[11px]">
                      {t('billing.popular')}
                    </span>
                  </div>
                  <div className="mt-1.5 text-[11px] font-bold text-slate-600 md:text-sm">
                    {t('billing.proDesc')}
                  </div>
                  <div className="mt-3 flex items-end gap-1.5 md:mt-5">
                    <span className="text-[32px] leading-none font-black text-slate-900 md:text-5xl">
                      {billingCycle === 'yearly' ? '188' : '20'}
                    </span>
                    <span className="pb-0.5 text-[11px] font-bold text-slate-500 md:pb-1 md:text-sm">
                      {billingCycle === 'yearly' ? t('billing.perYear') : t('billing.perMonth')}
                    </span>
                    <span className="pb-0.5 text-[8px] font-bold text-slate-400 line-through md:pb-1 md:text-xs">
                      {billingCycle === 'yearly'
                        ? t('billing.yearlyOriginalPrice')
                        : t('billing.monthlyOriginalPrice')}
                    </span>
                  </div>
                  <button
                    onClick={() => void handleStartSubscription()}
                    disabled={startingSubscription || isCurrentProPlan}
                    className={cn(
                      'mt-4 flex h-10 w-full items-center justify-center rounded-full border-[3px] text-xs font-black transition-colors md:mt-6 md:h-12 md:text-sm',
                      isCurrentProPlan
                        ? 'border-slate-900/20 bg-slate-100 text-slate-400'
                        : 'cursor-pointer border-slate-900/75 bg-orange-400 text-white hover:bg-orange-500 disabled:cursor-wait disabled:opacity-60',
                    )}
                  >
                    {isCurrentProPlan
                      ? t('billing.currentPlan')
                      : startingSubscription
                        ? t('billing.redirecting')
                        : t('billing.upgradeNow')}
                  </button>
                  <div className="mt-4 space-y-1.5 text-[11px] text-slate-700 md:mt-6 md:space-y-3 md:text-sm">
                    <div>{t('billing.proFeature1')}</div>
                    <div>{t('billing.proFeature2')}</div>
                    <div>{t('billing.proFeature3')}</div>
                  </div>
                </div>
              </div>

              <div className="relative mt-4 rounded-[22px] border-[4px] border-slate-900/75 bg-white/90 px-3.5 py-3.5 shadow-[0_6px_0_rgba(15,23,42,0.1)] md:mt-6 md:rounded-[28px] md:px-5 md:py-5">
                <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
                  <div>
                    <h4 className="text-base font-black text-slate-900 md:text-xl">
                      {t('billing.scorePacks')}
                    </h4>
                    <p className="mt-1 text-[11px] font-bold text-slate-600 md:text-sm">
                      {t('billing.scorePacksDesc')}
                    </p>
                  </div>
                  <div className="text-[10px] font-bold text-sky-700 md:text-xs">
                    {t('billing.testingNote')}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 md:mt-5 md:gap-3">
                  {[
                    {
                      score: 10,
                      price: 4,
                      accent: 'bg-sky-50',
                      badge: t('billing.testPack'),
                    },
                    {
                      score: 50,
                      price: 5,
                      accent: 'bg-orange-50',
                      badge: t('billing.popularPack'),
                    },
                    {
                      score: 100,
                      price: 10,
                      accent: 'bg-emerald-50',
                      badge: t('billing.valuePack'),
                    },
                  ].map((pack) => (
                    <div
                      key={pack.score}
                      className={cn(
                        'rounded-[16px] border-[3px] border-slate-900/70 px-2.5 py-2.5 shadow-[0_4px_0_rgba(15,23,42,0.08)] md:rounded-[24px] md:px-4 md:py-4',
                        pack.accent,
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[12px] font-black text-slate-900 md:text-lg">
                          {pack.score}
                          {t('billing.scoreUnit')}
                        </div>
                        <span className="rounded-full bg-white px-1.5 py-0.5 text-[8px] font-black text-slate-700 md:px-2 md:text-[10px]">
                          {pack.badge}
                        </span>
                      </div>
                      <div className="mt-2 flex items-end gap-1">
                        <span className="text-lg font-black text-slate-900 md:text-3xl">
                          {pack.price}
                        </span>
                        <span className="pb-0.5 text-[9px] font-bold text-slate-500 md:pb-1 md:text-xs">
                          {t('billing.currencyUnit')}
                        </span>
                      </div>
                      <button
                        onClick={() => void handleTestScorePackPurchase(pack.score)}
                        disabled={purchasingPackScore === pack.score}
                        className="mt-3 flex h-8 w-full cursor-pointer items-center justify-center rounded-full border-[3px] border-slate-900/75 bg-white text-[10px] font-black text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 md:h-11 md:text-sm"
                      >
                        {purchasingPackScore === pack.score
                          ? t('billing.adding')
                          : t('billing.buy')}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={ordersDialogOpen} onOpenChange={setOrdersDialogOpen}>
          <DialogContent
            showCloseButton={false}
            className="w-[min(760px,calc(100vw-20px))] max-w-none rounded-[24px] border-[4px] border-slate-900/80 bg-[#fff8e6] p-0 shadow-[0_10px_0_rgba(15,23,42,0.15)] md:w-[min(760px,calc(100vw-32px))] md:rounded-[32px]"
          >
            <DialogTitle className="sr-only">{t('account.myOrders')}</DialogTitle>

            <div className="relative max-h-[82vh] overflow-y-auto overflow-x-hidden rounded-[18px] p-3 pretty-scrollbar md:max-h-[86vh] md:rounded-[28px] md:p-6">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(125,211,252,0.2),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(251,191,36,0.18),transparent_30%)]" />

              <div className="relative flex items-start justify-between gap-3">
                <div>
                  <h3 className="mt-1 text-lg font-black text-slate-900 md:text-2xl">
                    {t('account.myOrders')}
                  </h3>
                  <p className="mt-1 text-[11px] text-slate-600 md:text-sm">
                    {t('account.ordersDesc')}
                  </p>
                </div>

                <button
                  onClick={() => setOrdersDialogOpen(false)}
                  className="shrink-0 cursor-pointer rounded-full border-[3px] border-slate-900/70 bg-white px-2.5 py-1 text-[10px] font-black text-slate-700 transition-colors hover:bg-sky-50 md:px-3 md:py-1.5 md:text-xs"
                >
                  {t('common.close')}
                </button>
              </div>

              <div className="relative mt-4 rounded-[22px] border-[4px] border-slate-900/75 bg-white/90 px-3 py-3 shadow-[0_6px_0_rgba(15,23,42,0.1)] md:mt-6 md:rounded-[28px] md:px-5 md:py-5">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
                  <div className="rounded-[18px] border-[3px] border-slate-900/10 bg-sky-50/60 px-3 py-2.5">
                    <div className="text-[10px] font-black text-slate-500 md:text-xs">
                      {t('account.currentPlan')}
                    </div>
                    <div className="mt-1 text-sm font-black text-slate-900 md:text-base">
                      {accountPlan.plan === 'pro'
                        ? accountPlan.billingCycle === 'yearly'
                          ? t('account.proYearly')
                          : t('account.proMonthly')
                        : t('account.freePlan')}
                    </div>
                  </div>
                  <div className="rounded-[18px] border-[3px] border-slate-900/10 bg-orange-50/70 px-3 py-2.5">
                    <div className="text-[10px] font-black text-slate-500 md:text-xs">
                      {t('account.expiresOn')}
                    </div>
                    <div className="mt-1 text-sm font-black text-slate-900 md:text-base">
                      {accountPlan.plan === 'pro'
                        ? formatDateTime(accountPlan.expiresAt, locale, t('common.na'))
                        : t('account.noExpiration')}
                    </div>
                  </div>
                  <div className="rounded-[18px] border-[3px] border-slate-900/10 bg-emerald-50/70 px-3 py-2.5">
                    <div className="text-[10px] font-black text-slate-500 md:text-xs">
                      {t('account.aiScore')}
                    </div>
                    <div className="mt-1 text-sm font-black text-slate-900 md:text-base">
                      {aiLearningScore}
                    </div>
                  </div>
                  <div className="rounded-[18px] border-[3px] border-slate-900/10 bg-white px-3 py-2.5">
                    <div className="text-[10px] font-black text-slate-500 md:text-xs">
                      {t('account.ordersCount')}
                    </div>
                    <div className="mt-1 text-sm font-black text-slate-900 md:text-base">
                      {orders.length}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3 md:mt-5">
                  <div className="text-sm font-black text-slate-900 md:text-base">
                    {t('account.purchaseHistory')}
                  </div>
                  <button
                    onClick={() => void loadOrders()}
                    className="cursor-pointer rounded-full border-[3px] border-slate-900/70 bg-white px-3 py-1 text-[11px] font-black text-slate-700 transition-colors hover:bg-sky-50 md:px-3.5 md:py-1.5 md:text-xs"
                  >
                    {t('account.refresh')}
                  </button>
                </div>

                <div className="mt-3 space-y-2 md:space-y-3">
                  {ordersLoading ? (
                    <div className="rounded-[18px] border-[3px] border-dashed border-slate-900/25 bg-white/80 px-4 py-8 text-center text-sm font-bold text-slate-500">
                      {t('account.loadingOrders')}
                    </div>
                  ) : orders.length === 0 ? (
                    <div className="rounded-[18px] border-[3px] border-dashed border-slate-900/25 bg-white/80 px-4 py-8 text-center text-sm font-bold text-slate-500">
                      {t('account.emptyOrders')}
                    </div>
                  ) : (
                    orders.map((order) => (
                      <div
                        key={order.id}
                        className="rounded-[18px] border-[3px] border-slate-900/10 bg-white px-3 py-3 shadow-[0_3px_0_rgba(15,23,42,0.06)] md:px-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-black text-slate-900 md:text-base">
                              {order.product_kind === 'score_pack'
                                ? t('billing.scorePackLabel', { score: order.score_delta })
                                : order.billing_cycle === 'yearly'
                                  ? t('account.proYearly')
                                  : t('account.proMonthly')}
                            </div>
                            <div className="mt-1 text-[11px] text-slate-500 md:text-xs">
                              {t('account.orderedOn')}
                              {formatDateTime(
                                order.paid_at ?? order.created_at,
                                locale,
                                t('common.na'),
                              )}
                            </div>
                            <div className="mt-1 text-[11px] text-slate-500 md:text-xs">
                              Session ID: {order.stripe_session_id}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-black text-slate-900 md:text-2xl">
                              {(order.amount_paid / 100).toFixed(
                                order.amount_paid % 100 === 0 ? 0 : 2,
                              )}
                              <span className="ml-1 text-xs font-bold text-slate-500 uppercase md:text-sm">
                                {order.currency}
                              </span>
                            </div>
                            <div className="mt-1 inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700 md:text-xs">
                              {order.entitlement_status === 'applied'
                                ? t('account.applied')
                                : order.entitlement_status === 'failed'
                                  ? t('account.failed')
                                  : t('account.processing')}
                            </div>
                          </div>
                        </div>

                        {order.product_kind === 'pro_pass' && order.subscription_expires_at ? (
                          <div className="mt-2 text-[11px] font-bold text-slate-600 md:text-xs">
                            {t('account.accessUntil')}
                            {formatDateTime(order.subscription_expires_at, locale, t('common.na'))}
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* ═══ Hero section: title + input (centered, wider) ═══ */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="relative z-20 w-full flex flex-col items-center pt-16 md:pt-4"
        >
          <div className="home-scale-wrap w-full flex justify-center">
            <div className="home-scale flex flex-col items-center max-w-full">
              {/* ── Logo ── */}
              <motion.img
                src={getHeroLogo(locale)}
                alt="Linksy"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, scale: 1.8 }}
                transition={{ delay: 0.05, duration: 0.1 }}
                className="h-10 md:h-12 mb-4 mt-2 md:mb-5 md:mt-5"
              />

              {/* ── Slogan ── */}
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.12, duration: 0.2 }}
                className="text-sm text-slate-500 mb-6"
              >
                {t('home.slogan')}
              </motion.p>

              {/* ── Greeting + Agents (outside input) ── */}
              <div className="w-full flex flex-row items-center gap-2.5 justify-start mb-2">
                <div className="flex items-center justify-start shrink-0">
                  <GreetingBar />
                </div>
                <div className="flex items-center justify-start w-auto">
                  <AgentBar />
                </div>
              </div>

              {/* ── Unified input area ── */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.18, duration: 0.2 }}
                className="w-full"
              >
                <div className="w-full rounded-[34px] border-[4px] border-slate-900/80 bg-gradient-to-b from-white/95 to-sky-50/90 shadow-[0_2px_0_rgba(15,23,42,0.2)] backdrop-blur-sm transition-colors">
                  {/* Textarea */}
                  <textarea
                    ref={textareaRef}
                    placeholder={t('upload.requirementPlaceholder')}
                    className="w-full resize-none border-0 bg-transparent px-6 pt-4 pb-4 text-[16px] leading-relaxed text-slate-700 placeholder:text-slate-400 focus:outline-none min-h-[200px] max-h-[380px]"
                    value={form.requirement}
                    onChange={(e) => updateForm('requirement', e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={4}
                  />

                  {/* Toolbar row */}
                  <div className="px-5 pb-2 pt-2.5 flex items-center gap-2.5 border-t-[3px] border-slate-900/25 rounded-b-[30px]">
                    <div className="flex-1 min-w-0">
                      <GenerationToolbar
                        language={form.language}
                        onLanguageChange={(lang) => updateForm('language', lang)}
                        webSearch={form.webSearch}
                        onWebSearchChange={(v) => updateForm('webSearch', v)}
                        onSettingsOpen={(section) => {
                          setSettingsSection(section);
                          setSettingsOpen(true);
                        }}
                        pdfFile={form.pdfFile}
                        onPdfFileChange={(f) => updateForm('pdfFile', f)}
                        onPdfError={setError}
                      />
                    </div>

                    {/* Voice input */}
                    <SpeechButton
                      size="md"
                      onTranscription={(text) => {
                        setForm((prev) => {
                          const next = prev.requirement + (prev.requirement ? ' ' : '') + text;
                          updateRequirementCache(next);
                          return { ...prev, requirement: next };
                        });
                      }}
                    />

                    {/* Send button */}
                    <button
                      onClick={handleGenerate}
                      disabled={!canGenerate}
                      className={cn(
                        'shrink-0 h-11 rounded-full flex items-center justify-center gap-1.5 transition-colors px-5 border-[3px] text-sm font-black',
                        canGenerate
                          ? 'bg-orange-400 border-slate-900/70 text-white hover:bg-orange-500 cursor-pointer'
                          : 'bg-slate-200 border-slate-300 text-slate-500 cursor-not-allowed',
                      )}
                    >
                      <span>{t('toolbar.enterClassroom')}</span>
                      <ArrowUp className="size-3.5" />
                    </button>

                    <button
                      onClick={handleGenerateComic}
                      disabled={!canGenerate}
                      className={cn(
                        'shrink-0 h-11 rounded-full flex items-center justify-center gap-1.5 transition-colors px-5 border-[3px] text-sm font-black',
                        canGenerate
                          ? 'bg-white border-slate-900/70 text-slate-700 hover:bg-sky-50 cursor-pointer'
                          : 'bg-slate-200 border-slate-300 text-slate-500 cursor-not-allowed',
                      )}
                    >
                      <span>{t('toolbar.generateComic')}</span>
                      <ImagePlus className="size-3.5" />
                    </button>
                  </div>
                </div>
              </motion.div>

              {/* ── Error ── */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-3 w-full p-3 bg-destructive/10 border border-destructive/20 rounded-lg"
                  >
                    <p className="text-sm text-destructive">{error}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>

        {/* Footer — flows with content, at the very end */}
        {/* <div className="mt-8 pb-5 text-center text-xs text-muted-foreground/50">
          Linksy Kids Learning
        </div> */}
      </div>
    </div>
  );
}

function HomeSidebar({
  sections,
  locale,
  onOpenClassroom,
  onDeleteClassroom,
}: {
  sections: Array<{ key: string; label: string; items: StageListItem[] }>;
  locale: string;
  onOpenClassroom: (id: string) => void;
  onDeleteClassroom: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <aside className="fixed left-0 top-0 bottom-0 z-30 w-[180px] sm:w-[200px] lg:w-[272px] rounded-none bg-sky-200/75 border-r-[4px] border-r-slate-900/90 backdrop-blur-sm shadow-[0_2px_0_rgba(15,23,42,0.2)] flex-col overflow-hidden">
      <div className="px-4 pt-4 pb-3 border-b-[3px] border-slate-900/70 bg-sky-100/35">
        <div className="flex items-center gap-2">
          <img src={getSidebarLogo(locale)} alt="Linksy" className="h-10 sm:h-12 w-auto" />
        </div>
        {/* <p className="mt-1 text-[11px] text-slate-700/85">{t('home.slogan')}</p> */}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 scrollbar-hide">
        {sections.length === 0 ? (
          <div className="rounded-2xl border-[3px] border-dashed border-slate-900/35 bg-white/65 p-3 text-[12px] leading-relaxed text-slate-600">
            {t('history.empty')}
          </div>
        ) : (
          sections.map((section) => (
            <div key={section.key} className="space-y-1.5">
              <div className="px-1">
                <p className="text-[11px] font-black tracking-wide text-sky-700/95">
                  {section.label}
                </p>
              </div>
              <div className="space-y-1">
                {section.items.map((item, index) => (
                  <div
                    key={item.id}
                    onClick={() => onOpenClassroom(item.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onOpenClassroom(item.id);
                      }
                    }}
                    className={cn(
                      'group/item w-full rounded-[16px] border-[3px] border-slate-900/70 px-2.5 py-2 text-left transition-colors shadow-[0_2px_0_rgba(15,23,42,0.2)]',
                      index % 2 === 0 ? 'bg-white/92' : 'bg-sky-50/85',
                      'hover:bg-white hover:border-slate-900/85',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-700 group-hover/item:text-sky-700">
                        {item.name}
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="size-6 rounded-full flex items-center justify-center text-slate-400 opacity-90 transition-opacity hover:bg-white hover:text-sky-600"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal className="size-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          sideOffset={6}
                          className="min-w-24"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DropdownMenuItem
                            data-variant="destructive"
                            onSelect={(e) => {
                              e.preventDefault();
                              onDeleteClassroom(item.id);
                            }}
                          >
                            <Trash2 className="size-4" />
                            {t('classroom.delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

// ─── Greeting Bar — avatar + "Hi, Name", click to edit in-place ────
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

function isCustomAvatar(src: string) {
  return src.startsWith('data:');
}

function GreetingBar() {
  const { t } = useI18n();
  const avatar = useUserProfileStore((s) => s.avatar);
  const nickname = useUserProfileStore((s) => s.nickname);
  const bio = useUserProfileStore((s) => s.bio);
  const setAvatar = useUserProfileStore((s) => s.setAvatar);
  const setNickname = useUserProfileStore((s) => s.setNickname);
  const setBio = useUserProfileStore((s) => s.setBio);

  const [open, setOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const displayName = nickname || t('profile.defaultNickname');

  // Click-outside to collapse
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setEditingName(false);
        setAvatarPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const startEditName = () => {
    setNameDraft(nickname);
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  const commitName = () => {
    setNickname(nameDraft.trim());
    setEditingName(false);
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_AVATAR_SIZE) {
      toast.error(t('profile.fileTooLarge'));
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error(t('profile.invalidFileType'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d')!;
        const scale = Math.max(128 / img.width, 128 / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (128 - w) / 2, (128 - h) / 2, w, h);
        setAvatar(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div ref={containerRef} className="relative  w-auto">
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleAvatarUpload}
      />

      {/* ── Collapsed pill (always visible) ── */}
      <div
        className="flex items-center h-12 gap-2.5 cursor-pointer transition-colors group rounded-full px-2.5 py-1.5 border-[3px] border-slate-900/70 bg-white/90 text-slate-700 hover:border-slate-900/85 hover:bg-sky-50"
        onClick={() => setOpen(true)}
      >
        <div className="shrink-0 relative">
          <div className="size-8 rounded-full overflow-hidden ring-2 ring-slate-900/25 group-hover:ring-slate-900/40 transition-colors">
            <img src={avatar} alt="" className="size-full object-cover" />
          </div>
          <div className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-orange-100 border border-orange-200 flex items-center justify-center opacity-80 group-hover:opacity-100 transition-opacity">
            <Pencil className="size-[7px] text-orange-600" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="leading-none select-none flex items-center gap-1">
                <span>
                  <span className="text-[13px] font-semibold text-slate-800 group-hover:text-slate-900 transition-colors">
                    {t('home.greetingWithName', { name: displayName })}
                  </span>
                </span>
                <ChevronDown className="size-3 text-slate-400 group-hover:text-slate-600 transition-colors shrink-0" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              {t('profile.editTooltip')}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* ── Expanded panel (absolute, floating) ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="absolute left-0 top-full mt-2 z-50 w-72"
          >
            <div className="rounded-2xl bg-white/96 backdrop-blur-sm border-[3px] border-slate-900/70 px-3 py-2.5 shadow-[0_2px_0_rgba(15,23,42,0.15)]">
              {/* ── Row: avatar + name ── */}
              <div
                className="flex items-center gap-2.5 cursor-pointer transition-colors"
                onClick={() => {
                  setOpen(false);
                  setEditingName(false);
                  setAvatarPickerOpen(false);
                }}
              >
                {/* Avatar */}
                <div
                  className="shrink-0 relative cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAvatarPickerOpen(!avatarPickerOpen);
                  }}
                >
                  <div className="size-8 rounded-full overflow-hidden ring-2 ring-slate-900/35 transition-colors">
                    <img src={avatar} alt="" className="size-full object-cover" />
                  </div>
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-orange-100 border border-orange-200 flex items-center justify-center"
                  >
                    <ChevronDown
                      className={cn(
                        'size-2 text-orange-600 transition-transform duration-200',
                        avatarPickerOpen && 'rotate-180',
                      )}
                    />
                  </motion.div>
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  {editingName ? (
                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        ref={nameInputRef}
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitName();
                          if (e.key === 'Escape') {
                            setEditingName(false);
                          }
                        }}
                        onBlur={commitName}
                        maxLength={20}
                        placeholder={t('profile.defaultNickname')}
                        className="flex-1 min-w-0 h-6 bg-transparent border-b-[2px] border-slate-900/25 text-[13px] font-semibold text-slate-800 outline-none placeholder:text-slate-400"
                      />
                      <button
                        onClick={commitName}
                        className="shrink-0 size-5 rounded flex items-center justify-center text-slate-700 hover:bg-sky-100"
                      >
                        <Check className="size-3" />
                      </button>
                    </div>
                  ) : (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditName();
                      }}
                      className="group/name inline-flex items-center gap-1 cursor-pointer"
                    >
                      <span className="text-[13px] font-semibold text-slate-800 group-hover/name:text-slate-900 transition-colors">
                        {displayName}
                      </span>
                      <Pencil className="size-2.5 text-slate-500 opacity-0 group-hover/name:opacity-100 transition-opacity" />
                    </span>
                  )}
                </div>

                {/* Collapse arrow */}
                <motion.div
                  initial={{ opacity: 0, y: -2 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="shrink-0 size-6 rounded-full flex items-center justify-center hover:bg-sky-100 transition-colors"
                >
                  <ChevronUp className="size-3.5 text-slate-600" />
                </motion.div>
              </div>

              {/* ── Expandable content ── */}
              <div className="pt-2" onClick={(e) => e.stopPropagation()}>
                {/* Avatar picker */}
                <AnimatePresence>
                  {avatarPickerOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <div className="p-1 pb-2.5 flex items-center gap-1.5 flex-wrap">
                        {AVATAR_OPTIONS.map((url) => (
                          <button
                            key={url}
                            onClick={() => setAvatar(url)}
                            className={cn(
                              'size-7 rounded-full overflow-hidden bg-sky-50 cursor-pointer transition-all duration-150',
                              'hover:scale-110 active:scale-95',
                              avatar === url
                                ? 'ring-2 ring-violet-400 ring-offset-0'
                                : 'hover:ring-1 hover:ring-muted-foreground/30',
                            )}
                          >
                            <img src={url} alt="" className="size-full" />
                          </button>
                        ))}
                        <label
                          className={cn(
                            'size-7 rounded-full flex items-center justify-center cursor-pointer transition-all duration-150 border border-dashed',
                            'hover:scale-110 active:scale-95',
                            isCustomAvatar(avatar)
                              ? 'ring-2 ring-violet-400 ring-offset-0 border-violet-300 bg-violet-50'
                              : 'border-muted-foreground/30 text-muted-foreground/50 hover:border-muted-foreground/50',
                          )}
                          onClick={() => avatarInputRef.current?.click()}
                          title={t('profile.uploadAvatar')}
                        >
                          <ImagePlus className="size-3" />
                        </label>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Bio */}
                <UITextarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder={t('profile.bioPlaceholder')}
                  maxLength={200}
                  rows={2}
                  className="resize-none border-sky-200/80 bg-sky-50/40 min-h-[72px] !text-[13px] !leading-relaxed placeholder:!text-[11px] placeholder:!leading-relaxed focus-visible:ring-1 focus-visible:ring-sky-300"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Page() {
  return <HomePage />;
}

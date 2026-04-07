'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { useI18n } from '@/lib/hooks/use-i18n';

function getAuthLogo(locale: string) {
  const logos: Record<string, string> = {
    'zh-CN': '/logo_t.png',
    'en-US': '/logo_t_e.png',
    'ja-JP': '/logo_t_e.png',
  };
  return logos[locale] ?? '/logo_t_e.png';
}

type AuthMode = 'login' | 'register';

export default function AuthPage() {
  const router = useRouter();
  const { t, locale } = useI18n();
  const supabase = useMemo(() => getSupabaseClient(), []);

  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => undefined);

    return () => subscription.unsubscribe();
  }, [supabase]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) {
      toast.error(t('auth.toastEnvMissing'));
      return;
    }

    if (!email.trim() || !password.trim()) {
      toast.error(t('auth.toastEmailPasswordRequired'));
      return;
    }

    if (mode === 'register' && password !== confirmPassword) {
      toast.error(t('auth.toastPasswordMismatch'));
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'register') {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        toast.success(t('auth.toastRegisterSuccess'));
        setMode('login');
        setConfirmPassword('');
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        toast.success(t('auth.toastLoginSuccess'));
        router.push('/');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t('auth.toastAuthFailed');
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="relative min-h-[100dvh] w-full overflow-hidden p-4 sm:p-6">
      <div className="fixed inset-0 -z-10 bg-[url('/bg.png')] bg-cover bg-center bg-no-repeat pointer-events-none" />
      <img
        src={getAuthLogo(locale)}
        alt="Linksy"
        className="h-7 sm:h-8 mb-1"
      />
      <section className="mx-auto mt-8 sm:mt-12 w-full max-w-md rounded-3xl border-[4px] border-slate-900/80 bg-[#fff8db]/95 backdrop-blur-sm p-5 sm:p-6 shadow-[0_4px_0_rgba(15,23,42,0.18)]">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-black text-slate-900">
              {mode === 'login' ? t('auth.titleLogin') : t('auth.titleRegister')}
            </h1>
          </div>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="rounded-full border-[3px] border-slate-900/70 bg-white px-3 py-1 text-xs font-bold text-slate-700 hover:bg-sky-50"
          >
            {t('auth.backHome')}
          </button>
        </div>

        {!isSupabaseConfigured() && (
          <div className="mt-4 rounded-xl border-[3px] border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {t('auth.envMissing')}
          </div>
        )}

        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-black text-slate-700">
              {t('auth.emailLabel')}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border-[3px] border-slate-900/70 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-sky-500"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-black text-slate-700">
              {t('auth.passwordLabel')}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border-[3px] border-slate-900/70 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-sky-500"
              placeholder="••••••••"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          <div className="-mt-1 text-[11px] text-slate-500">
            {mode === 'login' ? t('auth.switchToRegister') : t('auth.switchToLogin')}
            <button
              type="button"
              onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
              className="ml-1 font-bold text-sky-700 hover:text-sky-800 underline underline-offset-2"
            >
              {mode === 'login' ? t('auth.registerTab') : t('auth.loginTab')}
            </button>
          </div>

          {mode === 'register' && (
            <div>
              <label className="mb-1 block text-xs font-black text-slate-700">
                {t('auth.confirmPasswordLabel')}
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-xl border-[3px] border-slate-900/70 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-orange-500"
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || !isSupabaseConfigured()}
            className="w-full rounded-xl border-[3px] border-slate-900/70 bg-orange-400 px-3 py-2.5 text-sm font-black text-white shadow-[0_2px_0_rgba(15,23,42,0.15)] hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting
              ? t('auth.submitting')
              : mode === 'login'
                ? t('auth.submitLogin')
                : t('auth.submitRegister')}
          </button>
        </form>
      </section>
    </main>
  );
}

'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  PieChart,
  CheckCircle2,
  XCircle,
  RotateCcw,
  ChevronRight,
  Check,
  BookOpenText,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import { createLogger } from '@/lib/logger';

const log = createLogger('QuizView');
import type { QuizQuestion } from '@/lib/types/stage';
import { useDraftCache } from '@/lib/hooks/use-draft-cache';
import { SpeechButton } from '@/components/audio/speech-button';
import { gradeChoiceQuestions, isShortAnswer, type QuestionResult } from '@/lib/quiz/grading';
import {
  clearSubmitted,
  draftKey,
  readSubmittedState,
  writeSubmittedAnswers,
  writeSubmittedResults,
  type SubmittedState,
} from '@/lib/quiz/persistence';

// ─── Types ──────────────────────────────────────────────────────────────────

type Phase = 'not_started' | 'answering' | 'grading' | 'reviewing';

interface QuizViewProps {
  readonly questions: QuizQuestion[];
  readonly sceneId: string;
}

/** Call /api/quiz-grade for a single short-answer question. */
async function gradeShortAnswerQuestion(
  q: QuizQuestion,
  userAnswer: string,
  language: string,
): Promise<QuestionResult> {
  const pts = q.points ?? 1;
  try {
    const modelConfig = getCurrentModelConfig();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-model': modelConfig.modelString,
      'x-api-key': modelConfig.apiKey,
    };
    if (modelConfig.baseUrl) headers['x-base-url'] = modelConfig.baseUrl;
    if (modelConfig.providerType) headers['x-provider-type'] = modelConfig.providerType;

    const res = await fetch('/api/quiz-grade', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        question: q.question,
        userAnswer,
        points: pts,
        commentPrompt: q.commentPrompt,
        language,
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { score: number; comment: string };
    const earned = Math.max(0, Math.min(pts, data.score));
    return {
      questionId: q.id,
      correct: earned >= pts * 0.8,
      status: earned >= pts * 0.8 ? 'correct' : 'incorrect',
      earned,
      aiComment: data.comment,
    };
  } catch (err) {
    log.error('[quiz-view] AI grading failed for', q.id, err);
    // Fallback: give half credit
    return {
      questionId: q.id,
      correct: null,
      status: 'incorrect',
      earned: Math.round(pts * 0.5),
      aiComment:
        language === 'zh-CN'
          ? '评分服务暂时不可用，已给予基础分。'
          : 'Grading service unavailable. Base score given.',
    };
  }
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function QuizCover({
  questionCount,
  totalPoints,
  onStart,
}: {
  questionCount: number;
  totalPoints: number;
  onStart: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-gradient-to-br from-[#fff7e8] via-[#fffdf7] to-[#ffeed6] px-4 py-6 sm:px-6 sm:py-8">
      {/* Background decoration */}
      <div className="absolute top-0 right-0 p-6 opacity-[0.06]">
        <PieChart className="h-52 w-52 text-sky-400" />
      </div>
      <div className="absolute bottom-0 left-0 p-6 opacity-[0.05]">
        <BookOpenText className="h-40 w-40 rotate-12 text-amber-400" />
      </div>

      <div className="relative flex w-full max-w-xl flex-col items-center gap-5 rounded-[28px] border-[4px] border-slate-900/80 bg-[#fffdf5]/95 px-5 py-8 text-center shadow-[0_10px_0_rgba(15,23,42,0.2)] backdrop-blur-[2px] sm:px-8 sm:py-10">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
          className="flex h-16 w-16 items-center justify-center rounded-2xl border-[3px] border-slate-900/60 bg-gradient-to-br from-amber-200 to-orange-100 shadow-[0_4px_0_rgba(15,23,42,0.12)]"
        >
          <PieChart className="h-8 w-8 text-amber-600" />
        </motion.div>

        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="z-10 text-center"
        >
          <h3 className="text-3xl font-black tracking-tight text-slate-900">{t('quiz.title')}</h3>
          <p className="mt-1 text-sm font-medium text-slate-500">{t('quiz.subtitle')}</p>
        </motion.div>

        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="z-10 flex flex-wrap items-center justify-center gap-3 text-sm"
        >
          <div className="flex items-center gap-2 rounded-full border-[2px] border-slate-900/15 bg-white/90 px-3 py-1.5 text-slate-600 shadow-[0_2px_0_rgba(148,163,184,0.22)]">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50">
              <BookOpenText className="h-3.5 w-3.5 text-amber-600" />
            </div>
            <span className="font-semibold">
              {questionCount} {t('quiz.questionsCount')}
            </span>
          </div>

          <div className="flex items-center gap-2 rounded-full border-[2px] border-slate-900/15 bg-white/90 px-3 py-1.5 text-slate-600 shadow-[0_2px_0_rgba(148,163,184,0.22)]">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50">
              <PieChart className="h-3.5 w-3.5 text-sky-600" />
            </div>
            <span className="font-semibold">
              {t('quiz.totalPrefix')} {totalPoints} {t('quiz.pointsSuffix')}
            </span>
          </div>
        </motion.div>

        <motion.button
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
          onClick={onStart}
          className="z-10 mt-1 inline-flex items-center gap-2 rounded-full border-[3px] border-slate-900/70 bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500 px-8 py-2.5 text-base font-black text-white shadow-[0_4px_0_rgba(15,23,42,0.16)] transition-all hover:brightness-105"
        >
          {t('quiz.startQuiz')}
          <ChevronRight className="h-4 w-4" />
        </motion.button>
      </div>
    </div>
  );
}

function SingleChoiceQuestion({
  question,
  index,
  value,
  onChange,
  disabled,
  result,
}: {
  question: QuizQuestion;
  index: number;
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  result?: QuestionResult;
}) {
  const isReview = !!result;

  return (
    <QuestionCard question={question} index={index} result={result}>
      <div className="grid gap-2">
        {question.options?.map((opt) => {
          const selected = value === opt.value;
          const isCorrectOpt = isReview && question.answer?.includes(opt.value);
          const isWrong = isReview && selected && result?.status === 'incorrect';

          return (
            <button
              key={opt.value}
              disabled={disabled}
              onClick={() => !disabled && onChange(opt.value)}
              className={cn(
                'flex items-center gap-3 rounded-2xl border-[2px] px-4 py-3 text-left text-sm transition-all',
                // Default state
                !isReview &&
                  !selected &&
                  'border-slate-900/15 bg-white/90 text-slate-700 hover:border-amber-300 hover:bg-amber-50/70',
                !isReview && selected && 'border-amber-400 bg-amber-50 ring-1 ring-amber-200',
                // Review states
                isReview && isCorrectOpt && 'border-emerald-400 bg-emerald-50',
                isReview && isWrong && !isCorrectOpt && 'border-red-300 bg-red-50',
                isReview && !isCorrectOpt && !selected && 'border-slate-900/10 opacity-60',
                disabled && !isReview && 'cursor-default',
              )}
            >
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-black transition-colors',
                  !isReview && !selected && 'bg-slate-100 text-slate-500',
                  !isReview && selected && 'bg-amber-500 text-white',
                  isReview && isCorrectOpt && 'bg-emerald-500 text-white',
                  isReview && isWrong && !isCorrectOpt && 'bg-red-400 text-white',
                  isReview && !isCorrectOpt && !selected && 'bg-slate-100 text-slate-400',
                )}
              >
                {opt.value}
              </span>
              <span
                className={cn('flex-1', isReview && !isCorrectOpt && !selected && 'text-slate-400')}
              >
                {opt.label}
              </span>
              {isReview && isCorrectOpt && (
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
              )}
              {isReview && isWrong && !isCorrectOpt && (
                <XCircle className="w-5 h-5 text-red-400 shrink-0" />
              )}
            </button>
          );
        })}
      </div>
    </QuestionCard>
  );
}

function MultipleChoiceQuestion({
  question,
  index,
  value,
  onChange,
  disabled,
  result,
}: {
  question: QuizQuestion;
  index: number;
  value?: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  result?: QuestionResult;
}) {
  const isReview = !!result;
  const selected = value ?? [];

  const toggle = (optValue: string) => {
    if (disabled) return;
    if (selected.includes(optValue)) {
      onChange(selected.filter((v) => v !== optValue));
    } else {
      onChange([...selected, optValue]);
    }
  };

  const { t } = useI18n();

  return (
    <QuestionCard question={question} index={index} result={result}>
      {!isReview && <p className="mb-2 text-xs text-slate-400">{t('quiz.multipleChoiceHint')}</p>}
      <div className="grid gap-2">
        {question.options?.map((opt) => {
          const isSelected = selected.includes(opt.value);
          const isCorrectOpt = isReview && question.answer?.includes(opt.value);
          const isWrong = isReview && isSelected && !isCorrectOpt;

          return (
            <button
              key={opt.value}
              disabled={disabled}
              onClick={() => toggle(opt.value)}
              className={cn(
                'flex items-center gap-3 rounded-2xl border-[2px] px-4 py-3 text-left text-sm transition-all',
                !isReview &&
                  !isSelected &&
                  'border-slate-900/15 bg-white/90 text-slate-700 hover:border-amber-300 hover:bg-amber-50/70',
                !isReview && isSelected && 'border-amber-400 bg-amber-50 ring-1 ring-amber-200',
                isReview && isCorrectOpt && 'border-emerald-400 bg-emerald-50',
                isReview && isWrong && 'border-red-300 bg-red-50',
                isReview && !isCorrectOpt && !isSelected && 'border-slate-900/10 opacity-60',
                disabled && !isReview && 'cursor-default',
              )}
            >
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-black transition-colors',
                  !isReview && !isSelected && 'bg-slate-100 text-slate-500',
                  !isReview && isSelected && 'bg-amber-500 text-white',
                  isReview && isCorrectOpt && 'bg-emerald-500 text-white',
                  isReview && isWrong && 'bg-red-400 text-white',
                  isReview && !isCorrectOpt && !isSelected && 'bg-slate-100 text-slate-400',
                )}
              >
                {!isReview && isSelected ? <Check className="w-3.5 h-3.5" /> : opt.value}
              </span>
              <span
                className={cn(
                  'flex-1',
                  isReview && !isCorrectOpt && !isSelected && 'text-slate-400',
                )}
              >
                {opt.label}
              </span>
              {isReview && isCorrectOpt && (
                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
              )}
              {isReview && isWrong && <XCircle className="w-5 h-5 text-red-400 shrink-0" />}
            </button>
          );
        })}
      </div>
    </QuestionCard>
  );
}

function ShortAnswerQuestion({
  question,
  index,
  value,
  onChange,
  disabled,
  result,
}: {
  question: QuizQuestion;
  index: number;
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  result?: QuestionResult;
}) {
  const isReview = !!result;
  const { t } = useI18n();
  // Ref to track latest value for voice transcription append
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  return (
    <QuestionCard question={question} index={index} result={result}>
      {!isReview ? (
        <div className="relative">
          <textarea
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            placeholder={t('quiz.inputPlaceholder')}
            className="w-full min-h-[100px] resize-none rounded-2xl border-[2px] border-slate-900/15 bg-white/90 p-3 pb-10 text-sm text-slate-700 transition-all focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
          />
          <SpeechButton
            size="sm"
            disabled={disabled}
            className="absolute bottom-3 left-3"
            onTranscription={(text) => {
              const cur = valueRef.current ?? '';
              onChange(cur + (cur ? ' ' : '') + text);
            }}
          />
          <span className="absolute bottom-3 right-3 text-xs text-slate-300">
            {(value ?? '').length} {t('quiz.charCount')}
          </span>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-2xl border-[2px] border-slate-900/10 bg-white/80 p-3 text-sm text-slate-700">
            <p className="mb-1 text-xs text-slate-400">{t('quiz.yourAnswer')}</p>
            {value || <span className="italic text-slate-400">{t('quiz.notAnswered')}</span>}
          </div>
          {result.aiComment && (
            <div className="flex items-start gap-2 rounded-xl border-[2px] border-amber-200 bg-amber-50 px-3 py-2">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div>
                <p className="mb-0.5 text-xs font-bold text-amber-700">{t('quiz.aiComment')}</p>
                <p className="text-xs text-amber-700/85">{result.aiComment}</p>
              </div>
              <span className="ml-auto shrink-0 text-xs font-black text-amber-700">
                {result.earned}/{question.points ?? 1}
                {t('quiz.pointsSuffix')}
              </span>
            </div>
          )}
        </div>
      )}
    </QuestionCard>
  );
}

function QuestionCard({
  question,
  index,
  result,
  children,
}: {
  question: QuizQuestion;
  index: number;
  result?: QuestionResult;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const isReview = !!result;
  const pts = question.points ?? 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className={cn(
        'bg-white dark:bg-gray-800 rounded-2xl border p-5 relative overflow-hidden',
        !isReview &&
          'border-[3px] border-slate-900/20 bg-white/95 shadow-[0_4px_0_rgba(148,163,184,0.25)]',
        isReview &&
          result.status === 'correct' &&
          'border-[3px] border-emerald-300 bg-emerald-50/40 shadow-[0_4px_0_rgba(110,231,183,0.28)]',
        isReview &&
          result.status === 'incorrect' &&
          'border-[3px] border-red-300 bg-red-50/40 shadow-[0_4px_0_rgba(252,165,165,0.3)]',
      )}
    >
      {/* Left accent */}
      <div
        className={cn(
          'absolute bottom-0 left-0 top-0 w-1.5 rounded-l-2xl',
          !isReview && 'bg-amber-400',
          isReview && result.status === 'correct' && 'bg-emerald-400',
          isReview && result.status === 'incorrect' && 'bg-red-400',
        )}
      />

      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-black',
              !isReview && 'bg-amber-100 text-amber-700',
              isReview && result.status === 'correct' && 'bg-emerald-100 text-emerald-700',
              isReview && result.status === 'incorrect' && 'bg-red-100 text-red-700',
            )}
          >
            {index + 1}
          </span>
          <div>
            <p className="text-sm font-semibold leading-relaxed text-slate-800">
              {question.question}
            </p>
            <p className="mt-0.5 text-xs font-medium text-slate-400">
              {question.type === 'single'
                ? t('quiz.singleChoice')
                : question.type === 'multiple'
                  ? t('quiz.multipleChoice')
                  : t('quiz.shortAnswer')}
              {' · '}
              {pts} {t('quiz.pointsSuffix')}
            </p>
          </div>
        </div>
        {isReview && (
          <div className="shrink-0 ml-2">
            {result.status === 'correct' && <CheckCircle2 className="h-6 w-6 text-emerald-500" />}
            {result.status === 'incorrect' && <XCircle className="h-6 w-6 text-red-400" />}
          </div>
        )}
      </div>

      {/* Body */}
      {children}

      {/* Analysis (review only) */}
      {isReview && question.analysis && (
        <div className="mt-3 rounded-xl border-[2px] border-sky-200 bg-sky-50/70 p-3 text-xs leading-relaxed text-sky-700">
          <span className="font-medium">{t('quiz.analysis')}</span>
          {question.analysis}
        </div>
      )}
    </motion.div>
  );
}

function ScoreBanner({
  score,
  total,
  results,
}: {
  score: number;
  total: number;
  results: QuestionResult[];
}) {
  const { t } = useI18n();
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;
  const correctCount = results.filter((r) => r.status === 'correct').length;
  const incorrectCount = results.filter((r) => r.status === 'incorrect').length;

  const color = pct >= 80 ? 'emerald' : pct >= 60 ? 'amber' : 'red';
  const colorMap = {
    emerald: {
      bg: 'from-emerald-500 to-teal-500',
      shadow: 'shadow-emerald-200/50 dark:shadow-emerald-900/50',
      ring: 'bg-emerald-400/30',
      text: t('quiz.excellent'),
    },
    amber: {
      bg: 'from-amber-500 to-yellow-500',
      shadow: 'shadow-amber-200/50 dark:shadow-amber-900/50',
      ring: 'bg-amber-400/30',
      text: t('quiz.keepGoing'),
    },
    red: {
      bg: 'from-red-500 to-rose-500',
      shadow: 'shadow-red-200/50 dark:shadow-red-900/50',
      ring: 'bg-red-400/30',
      text: t('quiz.needsReview'),
    },
  };
  const c = colorMap[color];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn('rounded-2xl p-6 bg-gradient-to-r text-white shadow-lg', c.bg, c.shadow)}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-white/80 text-sm font-medium">{c.text}</p>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-4xl font-black">{score}</span>
            <span className="text-white/60 text-lg">/ {total}</span>
          </div>
          <div className="flex gap-3 mt-3 text-xs">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> {correctCount} {t('quiz.correct')}
            </span>
            <span className="flex items-center gap-1">
              <XCircle className="w-3.5 h-3.5" /> {incorrectCount} {t('quiz.incorrect')}
            </span>
          </div>
        </div>

        {/* Percentage ring */}
        <div className="relative w-20 h-20">
          <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
            <circle
              cx="40"
              cy="40"
              r="34"
              fill="none"
              stroke="rgba(255,255,255,0.2)"
              strokeWidth="6"
            />
            <motion.circle
              cx="40"
              cy="40"
              r="34"
              fill="none"
              stroke="white"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 34}`}
              initial={{ strokeDashoffset: 2 * Math.PI * 34 }}
              animate={{ strokeDashoffset: 2 * Math.PI * 34 * (1 - pct / 100) }}
              transition={{ duration: 1, ease: 'easeOut', delay: 0.3 }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-lg font-black">{pct}%</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function QuizView({ questions, sceneId }: QuizViewProps) {
  const { t, locale } = useI18n();

  // Rehydrate submitted state from localStorage on first mount. Runs once.
  const [initialSubmitted] = useState<SubmittedState>(() => readSubmittedState(sceneId));

  const [phase, setPhase] = useState<Phase>(() => {
    if (initialSubmitted?.kind === 'reviewing') return 'reviewing';
    if (initialSubmitted?.kind === 'answering') return 'answering';
    return 'not_started';
  });
  const [answers, setAnswers] = useState<Record<string, string | string[]>>(
    () => initialSubmitted?.answers ?? {},
  );
  const [results, setResults] = useState<QuestionResult[]>(() =>
    initialSubmitted?.kind === 'reviewing' ? initialSubmitted.results : [],
  );

  // Draft cache for quiz answers, keyed by sceneId to isolate across classrooms
  const {
    cachedValue: cachedAnswers,
    updateCache: updateAnswersCache,
    clearCache: clearAnswersCache,
  } = useDraftCache<Record<string, string | string[]>>({
    key: draftKey(sceneId),
  });

  // Restore cached draft answers (only when there is no submitted state).
  const [prevCachedAnswers, setPrevCachedAnswers] = useState(cachedAnswers);
  if (cachedAnswers !== prevCachedAnswers) {
    setPrevCachedAnswers(cachedAnswers);
    if (
      !initialSubmitted &&
      cachedAnswers &&
      Object.keys(cachedAnswers).length > 0 &&
      phase === 'not_started'
    ) {
      setAnswers(cachedAnswers);
      setPhase('answering');
    }
  }

  const totalPoints = useMemo(
    () => questions.reduce((sum, q) => sum + (q.points ?? 1), 0),
    [questions],
  );

  const allAnswered = useMemo(() => {
    return questions.every((q) => {
      const a = answers[q.id];
      if (!a) return false;
      if (Array.isArray(a)) return a.length > 0;
      return (a as string).trim().length > 0;
    });
  }, [questions, answers]);

  const handleSetAnswer = useCallback(
    (questionId: string, value: string | string[]) => {
      setAnswers((prev) => {
        const next = { ...prev, [questionId]: value };
        updateAnswersCache(next);
        return next;
      });
    },
    [updateAnswersCache],
  );

  const handleSubmit = useCallback(() => {
    setPhase('grading');
    clearAnswersCache();
    writeSubmittedAnswers(sceneId, answers);
  }, [clearAnswersCache, answers, sceneId]);

  // When entering grading phase, grade choice questions locally + call API for short-answer
  useEffect(() => {
    if (phase !== 'grading') return;
    let cancelled = false;

    (async () => {
      // 1. Grade choice questions locally (instant)
      const choiceResults = gradeChoiceQuestions(questions, answers);

      // 2. Grade short-answer questions via AI API (parallel)
      const shortAnswerQs = questions.filter(isShortAnswer);
      const aiResults = await Promise.all(
        shortAnswerQs.map((q) =>
          gradeShortAnswerQuestion(q, (answers[q.id] as string) ?? '', locale),
        ),
      );

      if (cancelled) return;

      // 3. Merge results in original question order
      const allResultsMap = new Map<string, QuestionResult>();
      for (const r of [...choiceResults, ...aiResults]) {
        allResultsMap.set(r.questionId, r);
      }
      const ordered = questions.map((q) => allResultsMap.get(q.id)!).filter(Boolean);

      setResults(ordered);
      setPhase('reviewing');
      writeSubmittedResults(sceneId, ordered);
    })();

    return () => {
      cancelled = true;
    };
  }, [phase, questions, answers, locale, sceneId]);

  const handleRetry = useCallback(() => {
    setPhase('not_started');
    setAnswers({});
    setResults([]);
    clearAnswersCache();
    clearSubmitted(sceneId);
  }, [clearAnswersCache, sceneId]);

  const earnedScore = useMemo(() => results.reduce((sum, r) => sum + r.earned, 0), [results]);

  const resultMap = useMemo(() => {
    const map: Record<string, QuestionResult> = {};
    results.forEach((r) => {
      map[r.questionId] = r;
    });
    return map;
  }, [results]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-gradient-to-br from-[#fff7e8] via-[#fffdf7] to-[#ffeed6]">
      <AnimatePresence mode="wait">
        {phase === 'not_started' && (
          <motion.div
            key="cover"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex-1"
          >
            <QuizCover
              questionCount={questions.length}
              totalPoints={totalPoints}
              onStart={() => setPhase('answering')}
            />
          </motion.div>
        )}

        {phase === 'answering' && (
          <motion.div
            key="answering"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {/* Header bar */}
              <div className="flex shrink-0 items-center justify-between border-b-[3px] border-slate-900/10 bg-white/70 px-5 py-3 backdrop-blur">
                <div className="flex items-center gap-2">
                  <PieChart className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-black text-slate-700">{t('quiz.answering')}</span>
                  <span className="ml-1 text-xs font-semibold text-slate-400">
                    {
                      Object.keys(answers).filter((k) => {
                        const a = answers[k];
                        if (Array.isArray(a)) return a.length > 0;
                        return typeof a === 'string' && a.trim().length > 0;
                      }).length
                    }{' '}
                    / {questions.length}
                  </span>
                </div>
                <button
                  onClick={handleSubmit}
                  disabled={!allAnswered}
                  className={cn(
                    'rounded-xl border-[2px] px-4 py-1.5 text-xs font-black transition-all',
                    allAnswered
                      ? 'border-slate-900/70 bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500 text-white shadow-[0_3px_0_rgba(15,23,42,0.16)] hover:brightness-105 active:translate-y-[1px]'
                      : 'cursor-not-allowed border-slate-900/10 bg-slate-100 text-slate-400',
                  )}
                >
                  {t('quiz.submitAnswers')}
                </button>
              </div>

              {/* Questions */}
              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                {questions.map((q, i) => {
                  if (q.type === 'single') {
                    return (
                      <SingleChoiceQuestion
                        key={q.id}
                        question={q}
                        index={i}
                        value={answers[q.id] as string | undefined}
                        onChange={(v) => handleSetAnswer(q.id, v)}
                      />
                    );
                  }
                  if (q.type === 'multiple') {
                    return (
                      <MultipleChoiceQuestion
                        key={q.id}
                        question={q}
                        index={i}
                        value={answers[q.id] as string[] | undefined}
                        onChange={(v) => handleSetAnswer(q.id, v)}
                      />
                    );
                  }
                  return (
                    <ShortAnswerQuestion
                      key={q.id}
                      question={q}
                      index={i}
                      value={answers[q.id] as string | undefined}
                      onChange={(v) => handleSetAnswer(q.id, v)}
                    />
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}

        {phase === 'grading' && (
          <motion.div
            key="grading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col items-center justify-center gap-5"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
            >
              <Loader2 className="w-10 h-10 text-violet-500" />
            </motion.div>
            <div className="text-center">
              <p className="text-base font-semibold text-gray-700 dark:text-gray-200">
                {t('quiz.aiGrading')}
              </p>
              <p className="text-sm text-gray-400 mt-1">{t('quiz.aiGradingWait')}</p>
            </div>
            <div className="flex gap-1 mt-2">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="w-2 h-2 rounded-full bg-violet-400"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{
                    repeat: Infinity,
                    duration: 1.2,
                    delay: i * 0.2,
                  }}
                />
              ))}
            </div>
          </motion.div>
        )}

        {phase === 'reviewing' && (
          <motion.div
            key="reviewing"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {/* Header bar */}
              <div className="flex shrink-0 items-center justify-between border-b-[3px] border-slate-900/10 bg-white/70 px-5 py-3 backdrop-blur">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <span className="text-sm font-black text-slate-700">{t('quiz.quizReport')}</span>
                </div>
                <button
                  onClick={handleRetry}
                  className="flex items-center gap-1.5 rounded-xl border-[2px] border-slate-900/15 bg-white/80 px-2.5 py-1 text-xs font-bold text-slate-500 transition-colors hover:text-amber-600"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {t('quiz.retry')}
                </button>
              </div>

              {/* Results */}
              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                <ScoreBanner score={earnedScore} total={totalPoints} results={results} />

                {questions.map((q, i) => {
                  const r = resultMap[q.id];
                  if (q.type === 'single') {
                    return (
                      <SingleChoiceQuestion
                        key={q.id}
                        question={q}
                        index={i}
                        value={answers[q.id] as string | undefined}
                        onChange={() => {}}
                        disabled
                        result={r}
                      />
                    );
                  }
                  if (q.type === 'multiple') {
                    return (
                      <MultipleChoiceQuestion
                        key={q.id}
                        question={q}
                        index={i}
                        value={answers[q.id] as string[] | undefined}
                        onChange={() => {}}
                        disabled
                        result={r}
                      />
                    );
                  }
                  return (
                    <ShortAnswerQuestion
                      key={q.id}
                      question={q}
                      index={i}
                      value={answers[q.id] as string | undefined}
                      onChange={() => {}}
                      disabled
                      result={r}
                    />
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

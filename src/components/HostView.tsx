import { type FormEvent, useEffect, useState } from 'react';
import {
  getActiveTeamIds,
  getAvailableRounds,
  getTeamDisplayName,
} from '../hooks/useTriviaRealtime';
import type {
  ActionResponse,
  DifficultyLevel,
  GameState,
  HostAnswersResponse,
  HostTeamTokensResponse,
  OptionLetter,
  PowerUpType,
  QuestionItem,
} from '../types/game';
import { generateQrDataUrl } from '../utils/qr';

interface HostViewProps {
  gameState: GameState;
  questions: QuestionItem[];
  questionRemainingSec: number;
  answerRemainingSec: number;
  onAction: (action: string, payload?: Record<string, unknown>) => Promise<ActionResponse>;
  onToast: (msg: string) => void;
}

const DIFFICULTIES: DifficultyLevel[] = ['سهل', 'متوسط', 'صعب'];
const GRANT_POWERUPS: { type: PowerUpType; label: string }[] = [
  { type: 'shield', label: '🛡️ درع' },
  { type: 'ai', label: '✨ حذف' },
  { type: 'double', label: '🚀 ×2' },
  { type: 'freeze', label: '❄️ تجميد' },
  { type: 'steal', label: '🧲 سرقة' },
  { type: 'time', label: '⏳ +15ث' },
];

export function HostView({
  gameState,
  questions,
  questionRemainingSec,
  answerRemainingSec,
  onAction,
  onToast,
}: HostViewProps) {
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>('');
  const [customDeltas, setCustomDeltas] = useState<Record<string, string>>({});
  const [grantTypes, setGrantTypes] = useState<Record<string, PowerUpType>>({});
  const [qrMap, setQrMap] = useState<Record<string, string>>({});
  const [teamTokens, setTeamTokens] = useState<Record<string, string>>({});

  const [showHostAnswers, setShowHostAnswers] = useState<boolean>(false);
  const [hostAnswersMap, setHostAnswersMap] = useState<Record<number, OptionLetter>>({});
  const [unlockedAuthRevision, setUnlockedAuthRevision] = useState<number | null>(null);
  const [sessionPin, setSessionPin] = useState<string>('');
  const [pinModalOpen, setPinModalOpen] = useState<boolean>(false);
  const [pinInput, setPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');
  const [loadingAnswers, setLoadingAnswers] = useState<boolean>(false);
  const [duelOpponentId, setDuelOpponentId] = useState<string>('');

  const activeTeamIds = getActiveTeamIds(gameState);
  const nonEliminatedIds = activeTeamIds.filter((id) => !gameState.eliminatedTeams.includes(id));
  const rounds = getAvailableRounds(questions);
  const duelEligibleOpponents = nonEliminatedIds.filter((id) => id !== gameState.activeTurnTeamId);

  useEffect(() => {
    if (duelEligibleOpponents.length === 0) {
      if (duelOpponentId) setDuelOpponentId('');
      return;
    }
    if (!duelOpponentId || !duelEligibleOpponents.includes(duelOpponentId)) {
      setDuelOpponentId(duelEligibleOpponents[0]);
    }
  }, [duelEligibleOpponents.join(','), duelOpponentId]);

  const filteredQuestions = questions.filter((q) => {
    if (gameState.selectedRound === 'ALL') return true;
    return (q.round || 'الجولة 1') === gameState.selectedRound;
  });

  useEffect(() => {
    if (filteredQuestions.length === 0) {
      if (selectedQuestionId) setSelectedQuestionId('');
      return;
    }
    const stillExists = filteredQuestions.some((q) => String(q.id) === selectedQuestionId);
    if (!selectedQuestionId || !stillExists) {
      setSelectedQuestionId(String(filteredQuestions[0].id));
    }
  }, [filteredQuestions, selectedQuestionId]);

  // إبطال الجلسة المفتوحة تلقائياً عند تغيير رمز الحماية من الإعدادات
  useEffect(() => {
    if (unlockedAuthRevision !== null && gameState.hostAuthRevision !== unlockedAuthRevision) {
      setShowHostAnswers(false);
      setHostAnswersMap({});
      setUnlockedAuthRevision(null);
      setSessionPin('');
    }
  }, [gameState.hostAuthRevision, unlockedAuthRevision]);

  const fetchHostAnswers = async (pinToUse: string, openOnSuccess = true): Promise<boolean> => {
    setLoadingAnswers(true);
    try {
      const res = await fetch('/api/host/answers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinToUse }),
      });
      const data = (await res.json()) as HostAnswersResponse;
      if (res.ok && data.status === 'OK' && data.answers) {
        setHostAnswersMap(data.answers);
        setUnlockedAuthRevision(data.hostAuthRevision ?? gameState.hostAuthRevision);
        setSessionPin(pinToUse);
        if (openOnSuccess) {
          setShowHostAnswers(true);
        }
        setPinModalOpen(false);
        setPinInput('');
        setPinError('');
        return true;
      }
      setPinError(data.message || '❌ رمز حماية المذيع غير صحيح');
      if (res.status === 401) {
        setShowHostAnswers(false);
        setHostAnswersMap({});
        setUnlockedAuthRevision(null);
      }
      return false;
    } catch {
      setPinError('❌ تعذر الاتصال بالخادم لجلب الإجابات');
      return false;
    } finally {
      setLoadingAnswers(false);
    }
  };

  // تحديث قاموس إجابات المذيع تلقائياً عند إضافة أو استيراد أسئلة جديدة أثناء الجلسة المفتوحة
  useEffect(() => {
    if (unlockedAuthRevision !== null && unlockedAuthRevision === gameState.hostAuthRevision) {
      void fetchHostAnswers(sessionPin, showHostAnswers);
    }
  }, [gameState.questionsVersion]);

  const handleToggleHostAnswers = async () => {
    if (showHostAnswers) {
      setShowHostAnswers(false);
      return;
    }

    const isUnlockedForCurrentRev = unlockedAuthRevision === gameState.hostAuthRevision;
    if (isUnlockedForCurrentRev && Object.keys(hostAnswersMap).length > 0) {
      setShowHostAnswers(true);
      return;
    }

    if (!gameState.hostPinEnabled) {
      const ok = await fetchHostAnswers('');
      if (!ok) onToast('❌ تعذر جلب إجابات المذيع من الخادم');
      return;
    }

    setPinInput('');
    setPinError('');
    setPinModalOpen(true);
  };

  const handleSubmitHostPin = async (e: FormEvent) => {
    e.preventDefault();
    if (!pinInput.trim()) {
      setPinError('⚠️ أدخل رمز الحماية أولاً');
      return;
    }
    const ok = await fetchHostAnswers(pinInput.trim());
    if (ok) {
      onToast('🔓 تم فتح إجابات المذيع لهذه الجلسة');
    }
  };

  const handleLockHostSession = () => {
    setShowHostAnswers(false);
    setHostAnswersMap({});
    setUnlockedAuthRevision(null);
    setSessionPin('');
    onToast('🔒 تم قفل إجابات المذيع في هذه الجلسة');
  };

  useEffect(() => {
    let cancelled = false;
    const loadTokens = async () => {
      try {
        const res = await fetch('/api/host/team-tokens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (!res.ok) return;
        const data = (await res.json()) as HostTeamTokensResponse;
        if (!cancelled && data.status === 'OK' && data.teamTokens) {
          setTeamTokens(data.teamTokens);
        }
      } catch (err) {
        console.error('Failed to load team tokens:', err);
      }
    };
    void loadTokens();
    return () => {
      cancelled = true;
    };
  }, [gameState.teamTokensVersion]);

  useEffect(() => {
    let cancelled = false;
    const buildQrs = async () => {
      const origin = window.location.origin;
      const entries = await Promise.all(
        activeTeamIds.map(async (id) => {
          const token = teamTokens[id];
          if (!token) return [id, ''] as const;
          const teamUrl = `${origin}/?view=mobile&team=${id}&token=${encodeURIComponent(token)}`;
          const dataUrl = await generateQrDataUrl(teamUrl);
          return [id, dataUrl] as const;
        })
      );
      if (!cancelled) {
        setQrMap(Object.fromEntries(entries));
      }
    };
    void buildQrs();
    return () => {
      cancelled = true;
    };
  }, [activeTeamIds.join(','), JSON.stringify(teamTokens)]);

  const handleCopyTeamLink = async (teamId: string) => {
    const token = teamTokens[teamId];
    if (!token) return;
    const url = `${window.location.origin}/?view=mobile&team=${teamId}&token=${encodeURIComponent(token)}`;
    try {
      await navigator.clipboard.writeText(url);
      onToast(`📋 تم نسخ رابط دخول (${getTeamDisplayName(gameState, teamId)})`);
    } catch {
      onToast('⚠️ تعذر النسخ التلقائي — استخدم زر الفتح لنسخ الرابط من المتصفح');
    }
  };

  const runAction = async (action: string, payload?: Record<string, unknown>) => {
    const res = await onAction(action, payload);
    if (res.message) onToast(res.message);
  };

  // ─── ARIA Announcements for Host State Changes ──────────────────────
  useEffect(() => {
    const polite = document.getElementById('host-announcer-polite');
    const assertive = document.getElementById('host-announcer-assertive');
    if (!polite || !assertive) return;

    const state = gameState.fsmState;
    let message = '';
    let isAssertive = false;

    switch (state) {
      case 'QUESTION_ACTIVE':
        if (gameState.currentQuestion) {
          message = `سؤال جديد للمضيف: ${gameState.currentQuestion.question}. الإجابة الصحيحة: ${gameState.currentQuestion.correct}.`;
        }
        break;
      case 'BUZZER_LOCKED':
        if (gameState.lockedTeamId) {
          if (gameState.activeBomb?.status === 'TICKING') {
            message = `قنبلة موقوتة على ${getTeamDisplayName(gameState, gameState.activeBomb.targetId)}! حكم بـ صح أو خطأ.`;
          } else {
            message = `${getTeamDisplayName(gameState, gameState.lockedTeamId)} ضغط الضاغط. ${answerRemainingSec} ثوانٍ للحكم.`;
          }
          isAssertive = true;
        }
        break;
      case 'ANSWER_CORRECT':
        if (gameState.lockedTeamId) {
          message = `أحكمتم: إجابة صحيحة لـ ${getTeamDisplayName(gameState, gameState.lockedTeamId)}.`;
          isAssertive = true;
        }
        break;
      case 'ANSWER_WRONG':
        if (gameState.lockedTeamId) {
          message = `أحكمتم: إجابة خاطئة لـ ${getTeamDisplayName(gameState, gameState.lockedTeamId)}.`;
          isAssertive = true;
        }
        break;
      case 'ANSWER_TIMEOUT':
        if (gameState.timedOutTeamId) {
          message = `انتهت مهلة ${getTeamDisplayName(gameState, gameState.timedOutTeamId)}.`;
          isAssertive = true;
        }
        break;
      case 'CHOICE_REVEALED':
        if (gameState.revealedChoices) {
          message = `كشفت التصويت الجماعي. ${gameState.revealedChoices.winnersCount} إجابة صحيحة.`;
        }
        break;
      case 'FINAL_REVEALED':
        if (gameState.finalResults) {
          message = `كشفت الجولة النهائية. ${gameState.finalResults.winnersCount} إجابة صحيحة.`;
        }
        break;
      case 'CELEBRATION_PODIUM':
        message = 'انتهت المباراة. الانتقال لمنصة التتويج.';
        break;
      case 'TRAP_SETUP':
        message = `مرحلة الكمائن: ${gameState.trapSetupReadyTeams.length} فرق جاهزة من ${getActiveTeamIds(gameState).filter(id => !gameState.eliminatedTeams.includes(id)).length}.`;
        break;
      case 'FINAL_WAGER_OPEN':
        message = `المراهنة النهائية مفتوحة: ${gameState.finalWageredTeams.length} فرق راهنت.`;
        break;
      default:
        return;
    }

    if (message) {
      const target = isAssertive ? assertive : polite;
      target.textContent = message;
      setTimeout(() => { target.textContent = ''; }, 1000);
    }
  }, [gameState.fsmState, gameState.currentQuestion, gameState.lockedTeamId, gameState.timedOutTeamId,
      gameState.revealedChoices, gameState.finalResults, gameState.trapSetupReadyTeams.length,
      gameState.finalWageredTeams.length, gameState.activeBomb?.status, answerRemainingSec]);

  const categories = Object.keys(gameState.boardMatrix || {});

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5">
      {/* ARIA Live Regions for Host */}
      <div
        id="host-announcer-polite"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />
      <div
        id="host-announcer-assertive"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      />

      {/* 1. رأس غرفة التحكم ومبدل وضع الإجابة */}
      <section className="surface-card rounded-3xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-black text-primary-token">
              🎙️ غرفة تحكم المقدم واللجنة التحكيمية
            </h1>
            <p className="mt-1 text-sm font-bold text-secondary-token">
              الحالة: {gameState.fsmState} • الأسئلة المستخدمة: {gameState.usedQuestionIds.length} / {gameState.totalQuestionsCount}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void runAction('SET_ANSWER_MODE', { mode: 'BUZZER' })}
              className={`btn-token ${gameState.answerMode === 'BUZZER' ? 'btn-primary-token' : ''}`}
            >
              🔔 الضاغط السريع
            </button>
            <button
              type="button"
              onClick={() => void runAction('SET_ANSWER_MODE', { mode: 'CHOICE' })}
              className={`btn-token ${gameState.answerMode === 'CHOICE' ? 'btn-primary-token' : ''}`}
            >
              🔐 التصويت السري (A/B/C)
            </button>
          </div>
        </div>

        {/* شريط التصفير المستقل */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-subtle-token pt-4">
          <button
            type="button"
            onClick={() => void runAction('RESET_SCORES')}
            className="btn-token btn-token-sm"
          >
            0️⃣ تصفير النقاط فقط
          </button>
          <button
            type="button"
            onClick={() => void runAction('RESET_POWERUPS')}
            className="btn-token btn-token-sm"
          >
            🔋 إعادة تعبئة الأدوات
          </button>
          <button
            type="button"
            onClick={() => void runAction('RESET_USED_QUESTIONS')}
            className="btn-token btn-token-sm"
          >
            🔄 إعادة فتح الأسئلة
          </button>
          <button
            type="button"
            onClick={() => void runAction('RESET_FULL_MATCH')}
            className="btn-token btn-token-sm btn-danger-token"
          >
            🧹 تصفير شامل للمباراة
          </button>
          <button
            type="button"
            onClick={() => void runAction('START_TRAP_SETUP')}
            className={`btn-token btn-token-sm ${gameState.fsmState === 'TRAP_SETUP' ? 'btn-primary-token' : 'btn-warning-token'}`}
          >
            🕳️ مرحلة الكمائن السرية
          </button>
          <button
            type="button"
            onClick={() => void runAction('START_FINAL_WAGER')}
            className="btn-token btn-token-sm btn-primary-token"
          >
            🔥 الجولة النهائية (المراهنة)
          </button>
          <button
            type="button"
            onClick={() => void runAction('TRIGGER_CELEBRATION')}
            className="btn-token btn-token-sm btn-warning-token"
          >
            🏆 منصة التتويج والـ PDF
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="btn-token btn-token-sm"
          >
            🖨️ طباعة التقرير
          </button>
        </div>
      </section>

      {/* 2. لوحة السؤال النشط والتحكم بالضاغط / التصويت السري */}
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="surface-card flex flex-col gap-4 rounded-3xl p-5 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-black text-primary-token">
              معاينة السؤال والتحكم المباشر
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={loadingAnswers}
                onClick={() => void handleToggleHostAnswers()}
                className={`btn-token btn-token-sm whitespace-nowrap shrink-0 ${
                  showHostAnswers ? 'btn-primary-token' : ''
                }`}
              >
                {loadingAnswers
                  ? '⏳ جاري التحقق...'
                  : showHostAnswers
                    ? '🙈 إخفاء الإجابة'
                    : gameState.hostPinEnabled && unlockedAuthRevision !== gameState.hostAuthRevision
                      ? '🔒 إظهار الإجابة للمذيع'
                      : '👁️ إظهار الإجابة للمذيع'}
              </button>
              {gameState.hostPinEnabled && unlockedAuthRevision === gameState.hostAuthRevision && (
                <button
                  type="button"
                  onClick={handleLockHostSession}
                  className="btn-token btn-token-sm whitespace-nowrap shrink-0"
                >
                  🔒 قفل
                </button>
              )}
              <span className="pill-accent-token rounded-xl px-3 py-1 font-display text-xs font-black tabular-nums">
                ⏳ السؤال: {questionRemainingSec}ث
              </span>
              {gameState.fsmState === 'BUZZER_LOCKED' && (
                <span className="badge-live-token rounded-xl px-3 py-1 font-display text-xs font-black tabular-nums">
                  ⏱️ مهلة الإجابة: {answerRemainingSec}ث
                </span>
              )}
            </div>
          </div>

          {/* إدارة مرحلة زرع الكمائن السرية قبل بدء المباراة */}
          {gameState.fsmState === 'TRAP_SETUP' && (
            <div className="final-stage-token stage-pop-in flex flex-col gap-3 rounded-2xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-display text-base font-black text-accent-token">
                    🕳️ مرحلة زرع الكمائن السرية مفتوحة الآن
                  </p>
                  <p className="text-xs font-bold text-secondary-token tabular-nums">
                    الفرق الجاهزة: {gameState.trapSetupReadyTeams.length} / {nonEliminatedIds.length} • إجمالي الكمائن المزروعة: {gameState.totalActiveTrapsCount}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void runAction('FINISH_TRAP_SETUP')}
                  className="btn-token btn-success-token btn-token-sm"
                >
                  🔒 إغلاق الكمائن وبدء المباراة
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {nonEliminatedIds.map((id) => {
                  const isReady = gameState.trapSetupReadyTeams.includes(id);
                  return (
                    <span
                      key={id}
                      className={`rounded-xl px-2.5 py-1 font-display text-xs font-black ${
                        isReady ? 'surface-success' : 'surface-canvas border border-subtle-token'
                      }`}
                    >
                      {getTeamDisplayName(gameState, id)} {isReady ? '✓ جاهز' : '⏳ يزرع...'}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* لافتة انطلاق كمين سري */}
          {gameState.activeTrapTrigger && (
            <div
              className={`stage-pop-in rounded-2xl p-3.5 ${
                gameState.activeTrapTrigger.status === 'DETONATED' ? 'surface-error' : 'surface-accent'
              }`}
            >
              <p className="font-display text-sm font-black">
                {gameState.activeTrapTrigger.title}
              </p>
              <p className="mt-0.5 text-xs font-bold">
                {gameState.activeTrapTrigger.desc}
              </p>
            </div>
          )}

          {/* لافتة مفاجأة اللوحة (سعيدة أو خطيرة) */}
          {gameState.activeMysteryTwist && (
            <div
              className={`stage-pop-in rounded-2xl p-3.5 ${
                gameState.activeMysteryTwist.sentiment === 'BAD'
                  ? 'surface-error'
                  : 'surface-success'
              }`}
            >
              <p className="font-display text-sm font-black">
                {gameState.activeMysteryTwist.title}
              </p>
              <p className="mt-0.5 text-xs font-bold">
                {gameState.activeMysteryTwist.desc}
              </p>
            </div>
          )}

          {/* لافتة المبارزة الفردية 1 ضد 1 */}
          {gameState.activeDuel && (
            <div className="surface-accent stage-pop-in rounded-2xl p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-display text-sm font-black">
                  ⚔️ مبارزة 1 ضد 1: {gameState.activeDuel.challengerName} VS {gameState.activeDuel.opponentName}
                </p>
                <span className="pill-accent-token rounded-lg px-2 py-0.5 font-display text-xs font-black tabular-nums">
                  ×{gameState.activeDuel.multiplier} نقاط
                </span>
              </div>
              <p className="mt-1 text-xs font-bold">
                {gameState.activeDuel.summary || 'الضاغط محصور بين الفريقين المتبارزين فقط في هذا السؤال.'}
              </p>
            </div>
          )}

          {/* لافتة القنبلة الموقوتة */}
          {gameState.activeBomb && (
            <div
              className={`stage-pop-in rounded-2xl p-3.5 ${
                gameState.activeBomb.status === 'DEFUSED' ? 'surface-success' : 'surface-error'
              }`}
            >
              <p className="font-display text-sm font-black">
                {gameState.activeBomb.status === 'TICKING'
                  ? `💣 قنبلة موقوتة! (${gameState.activeBomb.throwerName}) مرّرها إلى (${gameState.activeBomb.targetName})`
                  : gameState.activeBomb.status === 'DEFUSED'
                    ? '✅ تم تفكيك القنبلة الموقوتة!'
                    : '💥 انفجرت القنبلة الموقوتة!'}
              </p>
              <p className="mt-0.5 text-xs font-bold">
                {gameState.activeBomb.summary || 'لدى الفريق المستهدف 10 ثوانٍ للإجابة — احكم بـ (✓) للتفكيك أو (✕) للانفجار.'}
              </p>
            </div>
          )}

          {/* لافتة صياد المتصدر (Bounty Hunter) */}
          {gameState.lastBountyClaim &&
            (Date.now() - gameState.lastBountyClaim.at < 15000 ||
              gameState.fsmState === 'ANSWER_CORRECT' ||
              gameState.fsmState === 'CHOICE_REVEALED') && (
              <div className="surface-success stage-pop-in rounded-2xl p-3.5">
                <p className="font-display text-sm font-black tabular-nums">
                  🎯 صياد المتصدر! حصد ({gameState.lastBountyClaim.hunterTeamName}) مكافأة +{gameState.lastBountyClaim.amount} نقطة!
                </p>
                <p className="mt-0.5 text-xs font-bold">
                  كسر سلسلة انتصارات ({gameState.lastBountyClaim.targetTeamName}) البالغة {gameState.lastBountyClaim.brokenStreak} إجابات متتالية.
                </p>
              </div>
            )}

          {gameState.currentQuestion ? (
            (() => {
              const activeCorrectOption =
                gameState.currentQuestion.correct ||
                (showHostAnswers ? hostAnswersMap[gameState.currentQuestion.id] : undefined);
              const answeringTeamId =
                gameState.lockedTeamId ||
                (gameState.fsmState === 'ANSWER_TIMEOUT' ? gameState.timedOutTeamId : null);
              const canEvaluateBuzzer =
                gameState.answerMode === 'BUZZER' &&
                (gameState.fsmState === 'BUZZER_LOCKED' || gameState.fsmState === 'ANSWER_TIMEOUT') &&
                Boolean(answeringTeamId);
              const isRegularBuzzerStage =
                gameState.answerMode === 'BUZZER' &&
                gameState.fsmState !== 'FINAL_QUESTION_ACTIVE' &&
                gameState.fsmState !== 'FINAL_REVEALED';

              return (
                <div className="surface-canvas rounded-2xl border-2 border-subtle-token p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-black text-secondary-token">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span>{gameState.currentQuestion.round}</span>
                      <span aria-hidden="true">·</span>
                      <span>{gameState.currentQuestion.category}</span>
                      <span aria-hidden="true">·</span>
                      <span>{gameState.currentQuestion.difficulty}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-accent-token tabular-nums">
                        {gameState.fsmState === 'FINAL_QUESTION_ACTIVE' || gameState.fsmState === 'FINAL_REVEALED'
                          ? 'رهان سري'
                          : `${gameState.currentQuestionPoints} نقطة`}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={loadingAnswers}
                      onClick={() => void handleToggleHostAnswers()}
                      className={`btn-token btn-token-sm whitespace-nowrap shrink-0 ${
                        showHostAnswers ? 'btn-primary-token' : ''
                      }`}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.2}
                        className="h-4 w-4 shrink-0"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M2.25 12s3.75-7.5 9.75-7.5S21.75 12 21.75 12s-3.75 7.5-9.75 7.5S2.25 12 2.25 12Z"
                        />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                      <span>
                        {loadingAnswers
                          ? 'جاري التحقق...'
                          : showHostAnswers
                            ? 'إخفاء الحل'
                            : 'التأكد من الإجابة الصحيحة'}
                      </span>
                    </button>
                  </div>

                  <p className="font-display text-lg font-black text-primary-token">
                    {gameState.currentQuestion.question}
                  </p>
                  {(gameState.currentQuestion.imageUrl || gameState.currentQuestion.audioUrl) && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold text-secondary-token">
                      {gameState.currentQuestion.imageUrl && (
                        <span>🖼️ مرفق صورة على الشاشة</span>
                      )}
                      {gameState.currentQuestion.audioUrl && (
                        <span>🔊 مرفق مقطع صوتي</span>
                      )}
                    </div>
                  )}

                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {(['A', 'B', 'C'] as const).map((opt) => {
                      const isCorrectOpt = activeCorrectOption === opt;
                      const isWrongOpt = Boolean(activeCorrectOption) && activeCorrectOption !== opt;
                      return (
                        <div
                          key={opt}
                          className={`surface-card flex flex-col justify-between gap-1.5 rounded-xl p-2.5 text-xs font-black ${
                            isCorrectOpt ? 'surface-success' : ''
                          }`}
                        >
                          <div>
                            <span className={isCorrectOpt ? '' : 'text-accent-token'}>{opt}: </span>
                            <span>{gameState.currentQuestion?.options[opt]}</span>
                          </div>
                          {isCorrectOpt && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-black">
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2.75}
                                className="h-3.5 w-3.5 shrink-0"
                                aria-hidden="true"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                              الإجابة الصحيحة
                            </span>
                          )}
                          {isWrongOpt && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-secondary-token">
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2.5}
                                className="h-3.5 w-3.5 shrink-0"
                                aria-hidden="true"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                              خيار غير صحيح
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {activeCorrectOption ? (
                    <p className="mt-2.5 text-xs font-black text-success-token">
                      ✅ الحل المؤكد ({activeCorrectOption}):{' '}
                      {gameState.currentQuestion.options[activeCorrectOption]}
                    </p>
                  ) : (
                    <p className="mt-2.5 text-xs font-bold text-secondary-token">
                      🛡️ الإجابة مخفية عن الجمهور والفرق — اضغط «التأكد من الإجابة الصحيحة» لمعاينتها سرياً.
                    </p>
                  )}

                  {gameState.currentQuestion.explanation && (
                    <div className="surface-accent mt-2.5 rounded-xl p-2.5 text-xs font-bold">
                      💡 معلومة إثرائية: {gameState.currentQuestion.explanation}
                    </div>
                  )}

                  {/* أيقونات تقييم المذيع الحصرية (صح / خطأ) المرتبطة ببطاقة السؤال والفريق الأسرع بالضاغط */}
                  {isRegularBuzzerStage && (
                    <div className="mt-3.5 border-t border-subtle-token pt-3">
                      {gameState.fsmState === 'ANSWER_CORRECT' ? (
                        <div className="surface-success flex flex-wrap items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-xs font-black">
                          <span>
                            ✓ تم اعتماد إجابة صحيحة لفريق ({getTeamDisplayName(gameState, gameState.lockedTeamId)})
                          </span>
                        </div>
                      ) : gameState.fsmState === 'ANSWER_WRONG' ? (
                        <div className="surface-error flex flex-wrap items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-xs font-black">
                          <span>
                            ✕ تم اعتماد إجابة خاطئة لفريق ({getTeamDisplayName(gameState, gameState.lockedTeamId)})
                          </span>
                        </div>
                      ) : (
                        <div
                          className={`flex flex-col gap-2.5 rounded-xl p-3 ${
                            gameState.fsmState === 'ANSWER_TIMEOUT'
                              ? 'surface-error'
                              : canEvaluateBuzzer
                                ? 'surface-accent'
                                : 'surface-card'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-display text-xs font-black sm:text-sm">
                              {gameState.fsmState === 'BUZZER_LOCKED' && answeringTeamId
                                ? gameState.activeBomb?.status === 'TICKING'
                                  ? `💣 القنبلة عند (${getTeamDisplayName(gameState, answeringTeamId)}) — احكم الآن`
                                  : `🚨 أسرع فريق بالضاغط: ${getTeamDisplayName(gameState, answeringTeamId)}`
                                : gameState.fsmState === 'ANSWER_TIMEOUT' && answeringTeamId
                                  ? `⌛ انتهت مهلة (${getTeamDisplayName(gameState, answeringTeamId)}) — احكم الآن أو حوّل السؤال`
                                  : '⏳ بانتظار ضغطة أسرع فريق على الضاغط لتفعيل التقييم'}
                            </p>
                            {gameState.fsmState === 'BUZZER_LOCKED' && (
                              <span className="font-display text-base font-black text-accent-token tabular-nums">
                                ⏱️ {answerRemainingSec}ث
                              </span>
                            )}
                          </div>

                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <button
                              type="button"
                              disabled={!canEvaluateBuzzer}
                              onClick={() => void runAction('EVALUATE_ANSWER', { isCorrect: true })}
                              className="btn-token btn-success-token whitespace-nowrap shrink-0"
                              aria-label={`اعتماد إجابة صحيحة لـ ${getTeamDisplayName(gameState, gameState.lockedTeamId || '')}`}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2.75}
                                className="h-4 w-4 shrink-0"
                                aria-hidden="true"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                              <span>إجابة صحيحة</span>
                            </button>
                            <button
                              type="button"
                              disabled={!canEvaluateBuzzer}
                              onClick={() => void runAction('EVALUATE_ANSWER', { isCorrect: false })}
                              className="btn-token btn-danger-token whitespace-nowrap shrink-0"
                              aria-label={`اعتماد إجابة خاطئة لـ ${getTeamDisplayName(gameState, gameState.lockedTeamId || '')}`}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2.75}
                                className="h-4 w-4 shrink-0"
                                aria-hidden="true"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                              <span>إجابة خاطئة</span>
                            </button>
                            <button
                              type="button"
                              disabled={!canEvaluateBuzzer}
                              onClick={() => void runAction('PASS_QUESTION_NEXT_TEAM')}
                              className="btn-token btn-warning-token whitespace-nowrap shrink-0"
                            >
                              ⏭️ تحويل للتالي
                            </button>
                            <button
                              type="button"
                              disabled={!canEvaluateBuzzer}
                              onClick={() => void runAction('REOPEN_BUZZER')}
                              className="btn-token whitespace-nowrap shrink-0"
                            >
                              🔓 فتح الضاغط
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()
          ) : (
            <div className="surface-canvas rounded-2xl border-2 border-dashed border-subtle-token p-6 text-center text-sm font-bold text-secondary-token">
              لا يوجد سؤال نشط حالياً — اختر من لوحة الفئات أو القائمة اليدوية أدناه.
            </div>
          )}

          {/* أزرار التصويت السري عندما يكون CHOICE نشطاً */}
          {gameState.answerMode === 'CHOICE' && gameState.fsmState === 'QUESTION_ACTIVE' && (
            <div className="surface-accent flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
              <div>
                <p className="font-display text-sm font-black">
                  🔐 التصويت السري المستلم: {gameState.votedTeams.length} / {nonEliminatedIds.length} فرق
                </p>
                <p className="text-xs font-bold text-secondary-token">
                  يُكشف تلقائياً عند انتهاء الوقت أو فوراً بالضغط على الزر المقابل.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void runAction('REVEAL_SECRET_CHOICES')}
                className="btn-token btn-success-token"
              >
                ✨ إغلاق وكشف الإجابات الآن
              </button>
            </div>
          )}

          {/* إدارة الجولة النهائية الحاسمة (المراهنة -> السؤال -> الكشف) */}
          {gameState.fsmState === 'FINAL_WAGER_OPEN' && (
            <div className="final-stage-token flex flex-col gap-3 rounded-2xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-display text-base font-black text-accent-token">
                    🔥 الجولة النهائية — بانتظار تثبيت رهانات الفرق
                  </p>
                  <p className="text-xs font-bold text-secondary-token">
                    الفئة المعلنة للجمهور: {gameState.finalCategoryLabel} • الجاهزون: {gameState.finalWageredTeams.length} / {nonEliminatedIds.length}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void runAction('LAUNCH_FINAL_QUESTION')}
                    className="btn-token btn-success-token btn-token-sm"
                  >
                    🚀 إطلاق السؤال النهائي
                  </button>
                  <button
                    type="button"
                    onClick={() => void runAction('RETURN_TO_BOARD')}
                    className="btn-token btn-token-sm"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {nonEliminatedIds.map((id) => {
                  const locked = gameState.finalWageredTeams.includes(id);
                  return (
                    <span
                      key={id}
                      className={`rounded-xl px-2.5 py-1 font-display text-xs font-black ${
                        locked ? 'surface-success' : 'surface-canvas border border-subtle-token'
                      }`}
                    >
                      {getTeamDisplayName(gameState, id)} {locked ? '🔐 راهن' : '...'}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {gameState.fsmState === 'FINAL_QUESTION_ACTIVE' && (
            <div className="final-stage-token flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
              <div>
                <p className="font-display text-sm font-black text-accent-token">
                  🔥 تصويت السؤال النهائي: {gameState.votedTeams.length} / {nonEliminatedIds.length} فرق
                </p>
                <p className="text-xs font-bold text-secondary-token">
                  تُكشف الرهانات والإجابات وتُحتسب النقاط فور انتهاء الوقت أو بالضغط على الزر.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void runAction('REVEAL_FINAL_RESULTS')}
                className="btn-token btn-success-token"
              >
                ✨ كشف الرهانات والنتائج النهائية
              </button>
            </div>
          )}

          {gameState.fsmState === 'FINAL_REVEALED' && gameState.finalResults && (
            <div className="surface-success flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
              <div>
                <p className="font-display text-sm font-black">
                  🏆 اكتمل كشف الجولة النهائية ({gameState.finalResults.winnersCount} إجابة صحيحة)
                </p>
                <p className="text-xs font-bold">
                  يمكنك التراجع عن الحكم إن لزم، أو الانتقال مباشرة لمنصة التتويج النهائية.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void runAction('TRIGGER_CELEBRATION')}
                className="btn-token btn-warning-token"
              >
                🏆 الانتقال لمنصة التتويج
              </button>
            </div>
          )}

          {/* تحكم عام بالمؤقت والسؤال */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void runAction('LAUNCH_NEXT_AUTO')}
              className="btn-token btn-primary-token"
            >
              ⚡ إطلاق السؤال التلقائي التالي
            </button>
            <button
              type="button"
              onClick={() => void runAction('TOGGLE_PAUSE_TIMER')}
              disabled={
                gameState.fsmState !== 'QUESTION_ACTIVE' &&
                gameState.fsmState !== 'BUZZER_LOCKED' &&
                gameState.fsmState !== 'FINAL_QUESTION_ACTIVE'
              }
              className="btn-token"
            >
              {gameState.isTimerPaused ? '▶️ استئناف المؤقت' : '⏸️ إيقاف مؤقت'}
            </button>
            <button
              type="button"
              onClick={() => void runAction('REPLACE_ACTIVE_QUESTION')}
              disabled={!gameState.currentQuestion}
              className="btn-token"
            >
              🔄 استبدال السؤال
            </button>
            <button
              type="button"
              onClick={() => void runAction('RETURN_TO_BOARD')}
              className="btn-token"
            >
              📋 العودة للوحة الفئات
            </button>
          </div>

          {/* اختيار يدوي لسؤال بعينه ومعاينته */}
          <div className="flex flex-col gap-3 border-t border-subtle-token pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedQuestionId}
                onChange={(e) => setSelectedQuestionId(e.target.value)}
                className="form-input-token flex-1"
                aria-label="اختر سؤالاً للإطلاق اليدوي"
              >
                {filteredQuestions.map((q) => (
                  <option key={q.id} value={q.id}>
                    #{q.id} [{q.category} - {q.difficulty}] {q.question.slice(0, 55)}
                    {gameState.usedQuestionIds.includes(q.id) ? ' (مُستخدم)' : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!selectedQuestionId}
                onClick={() =>
                  void runAction('START_QUESTION_ROUND', { questionId: Number(selectedQuestionId) })
                }
                className="btn-token btn-primary-token whitespace-nowrap shrink-0"
              >
                🚀 إطلاق المحدد
              </button>
            </div>

            {(() => {
              const selectedManualQuestion = filteredQuestions.find(
                (q) => String(q.id) === selectedQuestionId
              );
              if (!selectedManualQuestion) {
                return (
                  <div className="surface-canvas rounded-2xl border border-dashed border-subtle-token p-3.5 text-center text-xs font-bold text-secondary-token">
                    لا توجد أسئلة متاحة في الجولة المحددة للمعاينة اليدوية.
                  </div>
                );
              }
              const manualCorrectOpt = showHostAnswers
                ? hostAnswersMap[selectedManualQuestion.id]
                : undefined;
              const isAlreadyUsed = gameState.usedQuestionIds.includes(selectedManualQuestion.id);

              return (
                <div className="surface-canvas rounded-2xl border border-subtle-token p-3.5">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-secondary-token">
                    <span className="tabular-nums">
                      معاينة السؤال اليدوي · #{selectedManualQuestion.id} ·{' '}
                      {selectedManualQuestion.round} · {selectedManualQuestion.category} ·{' '}
                      {selectedManualQuestion.difficulty}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {selectedManualQuestion.imageUrl && (
                        <span className="pill-accent-token rounded-md px-2 py-0.5 text-[11px]">🖼️ صورة</span>
                      )}
                      {selectedManualQuestion.audioUrl && (
                        <span className="pill-accent-token rounded-md px-2 py-0.5 text-[11px]">🔊 صوت</span>
                      )}
                      {isAlreadyUsed && <span className="text-accent-token">مُستخدم سابقاً</span>}
                    </div>
                  </div>
                  <p className="font-display text-sm font-black text-primary-token">
                    {selectedManualQuestion.question}
                  </p>
                  <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {(['A', 'B', 'C'] as const).map((opt) => {
                      const isCorrect = manualCorrectOpt === opt;
                      return (
                        <div
                          key={opt}
                          className={`surface-card flex flex-col justify-between gap-1 rounded-xl p-2 text-xs font-bold ${
                            isCorrect ? 'surface-success' : ''
                          }`}
                        >
                          <div>
                            <span className={isCorrect ? '' : 'text-accent-token'}>{opt}: </span>
                            <span>{selectedManualQuestion.options[opt]}</span>
                          </div>
                          {isCorrect && <span className="text-[11px] font-black">✓ الصحيح</span>}
                        </div>
                      );
                    })}
                  </div>
                  {!showHostAnswers && (
                    <p className="mt-2 text-xs font-bold text-secondary-token">
                      🔒 الإجابة الصحيحة مخفية — اضغط «إظهار الإجابة للمذيع» أعلاه لمعاينة الحل قبل الإطلاق.
                    </p>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* 3. تصفية الجولات ولوحة الفئات للمقدم */}
        <div className="surface-card flex flex-col gap-4 rounded-3xl p-5 lg:col-span-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-black text-primary-token">
              لوحة الفئات والجولات
            </h2>
            <button
              type="button"
              onClick={() => void runAction('ADVANCE_TURN')}
              className="btn-token btn-token-sm"
            >
              🔁 الدور: {getTeamDisplayName(gameState, gameState.activeTurnTeamId)}
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => void runAction('SET_SELECTED_ROUND', { roundName: 'ALL' })}
                className={`btn-token btn-token-sm ${gameState.selectedRound === 'ALL' ? 'btn-primary-token' : ''}`}
              >
                جميع الجولات
              </button>
              {rounds.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => void runAction('SET_SELECTED_ROUND', { roundName: r })}
                  className={`btn-token btn-token-sm ${gameState.selectedRound === r ? 'btn-primary-token' : ''}`}
                >
                  {r}
                </button>
              ))}
            </div>
            {gameState.totalActiveTrapsCount > 0 && (
              <span className="font-display text-xs font-black text-accent-token tabular-nums">
                🕳️ كمائن مخفية: {gameState.totalActiveTrapsCount}
              </span>
            )}
          </div>

          {/* تجهيز تحدي المبارزة الفردية 1 ضد 1 قبل اختيار خانة السؤال */}
          {gameState.fsmState === 'CATEGORY_BOARD' && gameState.answerMode === 'BUZZER' && (
            <div className="surface-canvas rounded-2xl border border-subtle-token p-3">
              {gameState.armedDuel ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-display text-xs font-black text-accent-token">
                      ⚔️ مبارزة 1 ضد 1 مجهزة: {gameState.armedDuel.challengerName} VS {gameState.armedDuel.opponentName}
                    </p>
                    <p className="text-[11px] font-bold text-secondary-token">
                      اختر خانة السؤال من اللوحة أدناه لإطلاق المبارزة على ×1.5 نقاط.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void runAction('CANCEL_DUEL')}
                    className="btn-token btn-token-sm btn-danger-token"
                  >
                    إلغاء
                  </button>
                </div>
              ) : (Number(gameState.duelCredits?.[gameState.activeTurnTeamId]) || 0) > 0 &&
                duelEligibleOpponents.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-xs font-black text-primary-token">
                    ⚔️ مبارزة ({getTeamDisplayName(gameState, gameState.activeTurnTeamId)}) ضد:
                  </span>
                  <select
                    value={duelOpponentId}
                    onChange={(e) => setDuelOpponentId(e.target.value)}
                    className="form-input-token flex-1 py-1.5 text-xs"
                    aria-label="اختر الفريق الخصم للمبارزة"
                  >
                    {duelEligibleOpponents.map((id) => (
                      <option key={id} value={id}>
                        {getTeamDisplayName(gameState, id)} ({Number(gameState.scores[id]) || 0} ن)
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!duelOpponentId}
                    onClick={() =>
                      void runAction('ARM_DUEL', {
                        challengerId: gameState.activeTurnTeamId,
                        opponentId: duelOpponentId,
                      })
                    }
                    className="btn-token btn-token-sm btn-warning-token whitespace-nowrap shrink-0"
                  >
                    ⚔️ تجهيز ×1.5
                  </button>
                </div>
              ) : (
                <p className="text-xs font-bold text-secondary-token">
                  ⚔️ استنفد ({getTeamDisplayName(gameState, gameState.activeTurnTeamId)}) رصيد المبارزة الفردية لهذه المباراة.
                </p>
              )}
            </div>
          )}

          <div className="grid max-h-[380px] grid-cols-1 gap-2.5 overflow-y-auto pr-1">
            {categories.length === 0 ? (
              <p className="text-center text-sm font-bold text-secondary-token">
                لا توجد فئات متوفرة في هذه الجولة
              </p>
            ) : (
              categories.map((cat) => (
                <div key={cat} className="surface-canvas rounded-2xl border border-subtle-token p-3">
                  <p className="mb-2 font-display text-sm font-black text-primary-token">{cat}</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {DIFFICULTIES.map((diff) => {
                      const rem = Number(gameState.boardMatrix[cat]?.[diff]) || 0;
                      const isActiveSlot =
                        gameState.selectedCategory === cat && gameState.selectedDifficulty === diff;
                      return (
                        <button
                          key={diff}
                          type="button"
                          disabled={rem === 0}
                          onClick={() =>
                            void runAction('PICK_BOARD_QUESTION', { category: cat, difficulty: diff })
                          }
                          className={`btn-token btn-token-sm ${
                            rem === 0 ? 'diff-slot-empty' : isActiveSlot ? 'host-slot-active' : ''
                          }`}
                        >
                          {diff} ({rem})
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* 4. صلاحيات التحكيم المباشر والإقصاء */}
      <section className="surface-card rounded-3xl p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-black text-primary-token">
              ⚖️ اللجنة التحكيمية وإدارة الفرق المباشرة
            </h2>
            <p className="text-xs font-bold text-secondary-token">
              {gameState.canUndoEvaluation
                ? `متاح للتراجع: ${gameState.undoSummary}`
                : 'تعديل النقاط ومنح الأدوات وتصفية الإقصاء الفوري'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!gameState.canUndoEvaluation}
              onClick={() => void runAction('UNDO_EVALUATION')}
              className="btn-token btn-warning-token btn-token-sm"
            >
              ↩️ تراجع فوري عن آخر حكم
            </button>
            <button
              type="button"
              onClick={() => void runAction('ELIMINATE_LOWEST_TEAM')}
              className="btn-token btn-danger-token btn-token-sm"
            >
              🚪 إقصاء الفريق الأقل نقاطاً
            </button>
            <button
              type="button"
              disabled={gameState.eliminatedTeams.length === 0}
              onClick={() => void runAction('RESTORE_ALL_TEAMS')}
              className="btn-token btn-token-sm"
            >
              ♻️ استعادة المستبعدين ({gameState.eliminatedTeams.length})
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          {activeTeamIds.map((id) => {
            const score = Number(gameState.scores[id]) || 0;
            const isEliminated = gameState.eliminatedTeams.includes(id);
            const grantChoice = grantTypes[id] || 'shield';
            const customVal = customDeltas[id] || '';
            return (
              <div
                key={id}
                className={`surface-canvas flex flex-col gap-2.5 rounded-2xl border-2 border-subtle-token p-3.5 ${
                  isEliminated ? 'team-card-eliminated' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`team-rank-badge team-rank-${id} flex h-7 w-7 items-center justify-center rounded-lg font-display text-xs font-black`}
                    >
                      {id}
                    </span>
                    <span className="font-display text-sm font-black text-primary-token">
                      {getTeamDisplayName(gameState, id)}
                    </span>
                  </div>
                  <span className="font-display text-lg font-black text-accent-token">{score}</span>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => void runAction('ADJUST_TEAM_SCORE', { teamId: id, delta: 50 })}
                    className="btn-token btn-token-sm btn-success-token"
                  >
                    +50
                  </button>
                  <button
                    type="button"
                    onClick={() => void runAction('ADJUST_TEAM_SCORE', { teamId: id, delta: 100 })}
                    className="btn-token btn-token-sm btn-success-token"
                  >
                    +100
                  </button>
                  <button
                    type="button"
                    onClick={() => void runAction('ADJUST_TEAM_SCORE', { teamId: id, delta: -50 })}
                    className="btn-token btn-token-sm btn-danger-token"
                  >
                    -50
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    placeholder="± نقاط"
                    value={customVal}
                    onChange={(e) =>
                      setCustomDeltas((prev) => ({ ...prev, [id]: e.target.value }))
                    }
                    className="form-input-token py-1.5 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const d = Number(customVal);
                      if (!d) return;
                      void runAction('ADJUST_TEAM_SCORE', { teamId: id, delta: d });
                      setCustomDeltas((prev) => ({ ...prev, [id]: '' }));
                    }}
                    className="btn-token btn-token-sm shrink-0"
                  >
                    تطبيق
                  </button>
                </div>

                <div className="flex items-center gap-1.5 border-t border-subtle-token pt-2">
                  <select
                    value={grantChoice}
                    onChange={(e) =>
                      setGrantTypes((prev) => ({
                        ...prev,
                        [id]: e.target.value as PowerUpType,
                      }))
                    }
                    className="form-input-token py-1.5 text-xs"
                    aria-label={`منح أداة لفريق ${id}`}
                  >
                    {GRANT_POWERUPS.map((pu) => (
                      <option key={pu.type} value={pu.type}>
                        {pu.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      void runAction('GRANT_POWERUP', { teamId: id, puType: grantChoice })
                    }
                    className="btn-token btn-token-sm btn-primary-token shrink-0"
                  >
                    +1 منح
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 5. رموز الاستجابة السريعة QR لدخول شاشات الفرق المستقلة */}
      <section className="surface-card rounded-3xl p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-lg font-black text-primary-token">
              📱 رموز QR وروابط الدخول المستقلة للفرق
            </h2>
            <p className="mt-0.5 text-xs font-bold text-secondary-token">
              يحمل كل رمز توقيعاً خاصاً بالفريق؛ لا يمكن للاعب الانتقال لفرق أخرى أو فتح لوحة المقدم.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void runAction('REGENERATE_TEAM_TOKENS')}
            className="btn-token btn-token-sm whitespace-nowrap shrink-0"
          >
            🔄 تجديد رموز دخول الفرق
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {activeTeamIds.map((id) => {
            const token = teamTokens[id] || '';
            const href = token
              ? `?view=mobile&team=${id}&token=${encodeURIComponent(token)}`
              : `?view=mobile&team=${id}`;
            return (
              <div
                key={id}
                className="surface-canvas flex flex-col items-center gap-2 rounded-2xl border border-subtle-token p-3 text-center"
              >
                <span className="font-display text-sm font-black text-primary-token">
                  {getTeamDisplayName(gameState, id)}
                </span>
                {qrMap[id] ? (
                  <img
                    src={qrMap[id]}
                    alt={`QR كود فريق ${id}`}
                    className="h-28 w-28 rounded-xl border border-subtle-token"
                  />
                ) : (
                  <div className="flex h-28 w-28 items-center justify-center rounded-xl border border-subtle-token text-xs font-bold text-secondary-token">
                    ⏳ جاري التوليد...
                  </div>
                )}
                <div className="flex flex-wrap justify-center gap-1.5">
                  <button
                    type="button"
                    disabled={!token}
                    onClick={() => void handleCopyTeamLink(id)}
                    className="btn-token btn-token-sm whitespace-nowrap shrink-0"
                  >
                    📋 نسخ الرابط
                  </button>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-token btn-token-sm btn-primary-token whitespace-nowrap shrink-0 no-underline"
                  >
                    فتح ↗️
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {pinModalOpen && (
        <div
          className="modal-scrim fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="host-pin-modal-title"
        >
          <form
            onSubmit={(e) => void handleSubmitHostPin(e)}
            className="surface-card w-full max-w-md rounded-3xl p-6"
          >
            <h3 id="host-pin-modal-title" className="font-display text-lg font-black text-primary-token">
              🔐 إدخال رمز حماية إجابات المذيع
            </h3>
            <p className="mt-1 text-xs font-bold text-secondary-token">
              أدخل رمز PIN المضبوط في استوديو الإعدادات لفتح عرض الإجابات الصحيحة في هذه الجلسة.
            </p>
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              maxLength={16}
              placeholder="أدخل رمز الحماية (PIN)..."
              value={pinInput}
              onChange={(e) => {
                setPinInput(e.target.value);
                if (pinError) setPinError('');
              }}
              className="form-input-token mt-4"
            />
            {pinError && (
              <p className="surface-error mt-3 rounded-xl px-3 py-2 text-xs font-black">
                {pinError}
              </p>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPinModalOpen(false);
                  setPinInput('');
                  setPinError('');
                }}
                className="btn-token btn-token-sm"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={loadingAnswers}
                className="btn-token btn-token-sm btn-primary-token"
              >
                {loadingAnswers ? '⏳ جاري التحقق...' : '🔓 فتح الإجابات'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

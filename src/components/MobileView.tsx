import { useEffect, useMemo, useState } from 'react';
import { getActiveTeamIds, getTeamDisplayName } from '../hooks/useTriviaRealtime';
import type {
  ActionResponse,
  DifficultyLevel,
  GameState,
  OptionLetter,
  PowerUpType,
  TeamTrapPlacement,
  TeamTrapsResponse,
  TrapType,
  VerifyTeamTokenResponse,
} from '../types/game';
import { soundEngine } from '../utils/audio';

interface MobileViewProps {
  gameState: GameState;
  teamId: string;
  teamToken: string;
  questionRemainingSec: number;
  answerRemainingSec: number;
  onAction: (action: string, payload?: Record<string, unknown>) => Promise<ActionResponse>;
  onToast: (msg: string) => void;
}

const OPTION_LIST: OptionLetter[] = ['A', 'B', 'C'];
const DIFFICULTIES: DifficultyLevel[] = ['سهل', 'متوسط', 'صعب'];

const TRAP_OPTIONS: { type: TrapType; icon: string; label: string; shortDesc: string }[] = [
  { type: 'STEAL_TRAP', icon: '🕳️', label: 'كمين السلب', shortDesc: 'يأخذ نصف النقاط إذا أخطأ الخصم' },
  { type: 'HALF_TIME_TRAP', icon: '⏱️', label: 'نصف الوقت', shortDesc: 'يقلص مؤقت السؤال للنصف' },
  { type: 'SILENCE_POWERUPS_TRAP', icon: '🔇', label: 'قفل الأدوات', shortDesc: 'يمنع استخدام الأدوات التكتيكية' },
  { type: 'DOUBLE_PENALTY_TRAP', icon: '⚠️', label: 'خصم مضاعف', shortDesc: 'يخصم نصف النقاط عند الخطأ' },
];

const POWERUP_META: { type: PowerUpType; icon: string; label: string }[] = [
  { type: 'shield', icon: '🛡️', label: 'درع' },
  { type: 'ai', icon: '✨', label: 'حذف 50/50' },
  { type: 'double', icon: '🚀', label: 'مضاعفة ×2' },
  { type: 'freeze', icon: '❄️', label: 'تجميد' },
  { type: 'steal', icon: '🧲', label: 'سرقة' },
  { type: 'time', icon: '⏳', label: 'وقت +15ث' },
];

export function MobileView({
  gameState,
  teamId,
  teamToken,
  questionRemainingSec,
  answerRemainingSec,
  onAction,
  onToast,
}: MobileViewProps) {
  const [stealModalOpen, setStealModalOpen] = useState<boolean>(false);
  const [bombModalOpen, setBombModalOpen] = useState<boolean>(false);
  const [localVote, setLocalVote] = useState<{ instanceId: string; option: OptionLetter } | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [wagerInput, setWagerInput] = useState<number>(0);
  const [authStatus, setAuthStatus] = useState<'checking' | 'authorized' | 'invalid'>('checking');
  const [authError, setAuthError] = useState<string>('');
  const [myTraps, setMyTraps] = useState<TeamTrapPlacement[]>([]);
  const [selectedTrapType, setSelectedTrapType] = useState<TrapType>('STEAL_TRAP');
  const [maxTrapsAllowed, setMaxTrapsAllowed] = useState<number>(2);

  // ─── ARIA Live Regions for Mobile ───────────────────────────────────
  useEffect(() => {
    const announcer = document.getElementById('mobile-announcer');
    if (!announcer) return;

    let message = '';

    // Announce question changes
    if (gameState.currentQuestion && gameState.fsmState === 'QUESTION_ACTIVE') {
      message = `سؤال جديد: ${gameState.currentQuestion.question}. ${gameState.currentQuestion.category}. ${gameState.currentQuestion.difficulty}.`;
    }

    // Announce buzzer lock
    if (gameState.fsmState === 'BUZZER_LOCKED') {
      if (gameState.lockedTeamId === teamId) {
        if (gameState.activeBomb?.status === 'TICKING') {
          message = `قنبلة موقوتة! لديك ${answerRemainingSec} ثوانٍ للإجابة.`;
        } else {
          message = `دوركم الآن! لديك ${answerRemainingSec} ثوانٍ للإجابة.`;
        }
      } else if (gameState.lockedTeamId) {
        message = `فريق ${getTeamDisplayName(gameState, gameState.lockedTeamId)} ضغط الضاغط.`;
      }
    }

    // Announce evaluation results
    if (gameState.fsmState === 'ANSWER_CORRECT' && gameState.lockedTeamId === teamId) {
      message = `إجابة صحيحة! رصيدكم ${Number(gameState.scores[teamId]) || 0} نقطة.`;
    } else if (gameState.fsmState === 'ANSWER_WRONG' && gameState.lockedTeamId === teamId) {
      message = `إجابة خاطئة. الإجابة الصحيحة: ${gameState.currentQuestion?.correct}.`;
    }

    // Announce vote confirmation
    if (gameState.votedTeams.includes(teamId) && gameState.fsmState === 'QUESTION_ACTIVE') {
      message = 'تم تثبيت إجابتكم السرية. بانتظار النتيجة.';
    }

    // Announce final wager
    if (gameState.fsmState === 'FINAL_WAGER_OPEN' && !gameState.finalWageredTeams.includes(teamId)) {
      message = `الجولة النهائية مفتوحة. الفئة: ${gameState.finalCategoryLabel}. حددوا رهانكم.`;
    }

    if (message) {
      announcer.textContent = message;
      setTimeout(() => { announcer.textContent = ''; }, 1000);
    }
  }, [gameState.fsmState, gameState.currentQuestion, gameState.lockedTeamId, gameState.activeBomb?.status,
      gameState.votedTeams, gameState.fsmState, gameState.finalWageredTeams, answerRemainingSec, teamId]);

  useEffect(() => {
    let cancelled = false;
    const verifyAccess = async () => {
      if (!teamId || !teamToken) {
        setAuthStatus('invalid');
        setAuthError('🔒 رابط الفريق غير صالح أو غير مكتمل — يرجى مسح رمز الباركود الخاص بفريقك من شاشة المقدم.');
        return;
      }
      setAuthStatus('checking');
      try {
        const res = await fetch('/api/team/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teamId, token: teamToken }),
        });
        const data = (await res.json()) as VerifyTeamTokenResponse;
        if (cancelled) return;
        if (res.ok && data.valid) {
          setAuthStatus('authorized');
          setAuthError('');
        } else {
          setAuthStatus('invalid');
          setAuthError(
            data.message ||
              '🔒 رمز دخول الفريق غير صحيح أو تم تجديده — امسح الباركود الجديد من شاشة المقدم.'
          );
        }
      } catch {
        if (!cancelled) {
          setAuthStatus('invalid');
          setAuthError('❌ تعذر التحقق من رابط الفريق أمام الخادم.');
        }
      }
    };
    void verifyAccess();
    return () => {
      cancelled = true;
    };
  }, [teamId, teamToken, gameState.teamTokensVersion, gameState.settings.teamCount]);

  const storageKey = useMemo(
    () => `trivia_secret_vote_${teamId}_${gameState.questionInstanceId || 'none'}`,
    [teamId, gameState.questionInstanceId]
  );

  // استعادة اختيار الفريق السري عند فقدان الاتصال أو إعادة التحميل في منتصف السؤال
  useEffect(() => {
    const qInst = gameState.questionInstanceId;
    if (!qInst) {
      setLocalVote(null);
      return;
    }
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved === 'A' || saved === 'B' || saved === 'C') {
        setLocalVote({ instanceId: qInst, option: saved });
      } else {
        setLocalVote(null);
      }
    } catch {
      setLocalVote(null);
    }
  }, [gameState.questionInstanceId, storageKey]);

  // جلب كمائن الفريق السرية الخاصة به فقط من الخادم (Zero-Leak)
  useEffect(() => {
    if (authStatus !== 'authorized' || gameState.fsmState !== 'TRAP_SETUP') return;
    let cancelled = false;
    const loadTraps = async () => {
      try {
        const res = await fetch('/api/team/traps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teamId, token: teamToken }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as TeamTrapsResponse;
        if (!cancelled && data.status === 'OK') {
          setMyTraps(Array.isArray(data.traps) ? data.traps : []);
          if (typeof data.maxTraps === 'number') setMaxTrapsAllowed(data.maxTraps);
        }
      } catch {
        // ignore transient errors
      }
    };
    void loadTraps();
    return () => {
      cancelled = true;
    };
  }, [authStatus, gameState.fsmState, gameState.stateRevision, teamId, teamToken]);

  const activeTeamIds = getActiveTeamIds(gameState);
  const teamName = getTeamDisplayName(gameState, teamId);
  const score = Number(gameState.scores[teamId]) || 0;
  const maxWager = Math.max(Number(gameState.finalMinWager) || 50, score);
  const hasWageredServer = gameState.finalWageredTeams?.includes(teamId) ?? false;
  const teamStreak = Number(gameState.teamStreaks?.[teamId]) || 0;
  const teamBounty = Number(gameState.teamBounties?.[teamId]) || 0;
  const bombCredits = Number(gameState.bombCredits?.[teamId]) || 0;
  const isTrapReadyServer = gameState.trapSetupReadyTeams?.includes(teamId) ?? false;

  useEffect(() => {
    if (gameState.fsmState === 'FINAL_WAGER_OPEN' && !hasWageredServer) {
      setWagerInput(Math.floor(maxWager / 2));
    }
  }, [gameState.fsmState, maxWager, hasWageredServer]);

  const isEliminated = gameState.eliminatedTeams.includes(teamId);
  const hasAttempted = gameState.attemptedTeamsThisQuestion.includes(teamId);
  const isFrozen = Number(gameState.activeEffects.frozenTeams[teamId] || 0) > Date.now();
  const isExcludedByDuel = Boolean(
    gameState.activeDuel &&
      teamId !== gameState.activeDuel.challengerId &&
      teamId !== gameState.activeDuel.opponentId
  );
  const isLockedWinner = gameState.fsmState === 'BUZZER_LOCKED' && gameState.lockedTeamId === teamId;
  const isLockedOther =
    gameState.fsmState === 'BUZZER_LOCKED' &&
    gameState.lockedTeamId !== null &&
    gameState.lockedTeamId !== teamId;
  const hasVotedServer = gameState.votedTeams.includes(teamId);
  const pickedOption =
    localVote && localVote.instanceId === gameState.questionInstanceId ? localVote.option : null;

  const teamPowerUps = gameState.powerUps[teamId] || {
    shield: 0,
    ai: 0,
    double: 0,
    freeze: 0,
    steal: 0,
    time: 0,
  };

  const canPressBuzzer =
    !isEliminated &&
    !hasAttempted &&
    !isFrozen &&
    !isExcludedByDuel &&
    !gameState.isTimerPaused &&
    gameState.answerMode === 'BUZZER' &&
    gameState.fsmState === 'QUESTION_ACTIVE' &&
    gameState.lockedTeamId === null;

  const canThrowBomb =
    bombCredits > 0 &&
    !isEliminated &&
    !gameState.isTimerPaused &&
    !gameState.activeDuel &&
    !gameState.activeBomb &&
    !gameState.powerUpsLockedThisQuestion &&
    gameState.answerMode === 'BUZZER' &&
    gameState.fsmState === 'QUESTION_ACTIVE' &&
    gameState.lockedTeamId === null;

  const handleInvalidTokenFromServer = (res: ActionResponse): boolean => {
    if (res.reason === 'INVALID_TEAM_TOKEN' || res.status === 'INVALID_TEAM_TOKEN') {
      setAuthStatus('invalid');
      setAuthError(
        res.message ||
          '🔒 تم تجديد رمز دخول الفريق — يرجى مسح الباركود الجديد من شاشة المقدم.'
      );
      if (res.message) onToast(res.message);
      return true;
    }
    return false;
  };

  const handlePressBuzzer = async () => {
    if (!canPressBuzzer || submitting || authStatus !== 'authorized') return;
    soundEngine.unlock();
    setSubmitting(true);
    try {
      const res = await onAction('TRIGGER_BUZZER', { teamId, teamToken });
      if (handleInvalidTokenFromServer(res)) return;
      if (!res.accepted) {
        if (res.reason === 'ALREADY_LOCKED' && res.lockedBy) {
          onToast(`سبقك فريق ${getTeamDisplayName(gameState, res.lockedBy)} بالضغط!`);
        } else if (res.reason === 'FROZEN') {
          onToast('❄️ ضاغط فريقك مجمد مؤقتاً!');
        } else if (res.reason === 'NOT_IN_DUEL') {
          onToast('⚔️ هذا السؤال مبارزة فردية خاصة بين فريقين فقط');
        } else if (res.message) {
          onToast(res.message);
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleTrapSlot = async (category: string, difficulty: DifficultyLevel) => {
    if (authStatus !== 'authorized' || submitting || gameState.fsmState !== 'TRAP_SETUP') return;
    soundEngine.unlock();
    const slotKey = `${category}|||${difficulty}`;
    const existing = myTraps.find((t) => t.slotKey === slotKey);
    setSubmitting(true);
    try {
      if (existing) {
        const res = await onAction('REMOVE_TEAM_TRAP', { teamId, teamToken, slotKey });
        if (handleInvalidTokenFromServer(res)) return;
        if (res.accepted) {
          setMyTraps((prev) => prev.filter((t) => t.slotKey !== slotKey));
        }
        if (res.message) onToast(res.message);
      } else {
        const res = await onAction('PLACE_TEAM_TRAP', {
          teamId,
          teamToken,
          category,
          difficulty,
          trapType: selectedTrapType,
        });
        if (handleInvalidTokenFromServer(res)) return;
        if (res.accepted) {
          setMyTraps((prev) => [...prev, { slotKey, category, difficulty, type: selectedTrapType }]);
        }
        if (res.message) onToast(res.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmTraps = async () => {
    if (authStatus !== 'authorized' || submitting || gameState.fsmState !== 'TRAP_SETUP') return;
    soundEngine.unlock();
    setSubmitting(true);
    try {
      const res = await onAction('CONFIRM_TEAM_TRAPS', { teamId, teamToken });
      if (handleInvalidTokenFromServer(res)) return;
      if (res.message) onToast(res.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmBomb = async (targetTeamId: string) => {
    if (authStatus !== 'authorized' || submitting) return;
    setBombModalOpen(false);
    soundEngine.unlock();
    setSubmitting(true);
    try {
      const res = await onAction('THROW_BOMB', { teamId, teamToken, targetTeamId });
      if (handleInvalidTokenFromServer(res)) return;
      if (res.message) onToast(res.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitFinalWager = async () => {
    if (
      authStatus !== 'authorized' ||
      submitting ||
      isEliminated ||
      hasWageredServer ||
      gameState.fsmState !== 'FINAL_WAGER_OPEN'
    ) {
      return;
    }
    soundEngine.unlock();
    setSubmitting(true);
    try {
      const clamped = Math.min(maxWager, Math.max(0, Math.round(wagerInput)));
      const res = await onAction('SUBMIT_FINAL_WAGER', {
        teamId,
        wager: clamped,
        teamToken,
      });
      if (handleInvalidTokenFromServer(res)) return;
      if (res.accepted) {
        soundEngine.playWagerLock();
        onToast(res.message || `🔐 تم تثبيت رهانك (${clamped} نقطة)`);
      } else if (res.message) {
        onToast(res.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitChoice = async (option: OptionLetter) => {
    const isChoiceAllowed =
      gameState.fsmState === 'FINAL_QUESTION_ACTIVE' ||
      (gameState.answerMode === 'CHOICE' && gameState.fsmState === 'QUESTION_ACTIVE');
    if (
      authStatus !== 'authorized' ||
      submitting ||
      isEliminated ||
      hasVotedServer ||
      pickedOption ||
      !isChoiceAllowed ||
      gameState.isTimerPaused
    ) {
      return;
    }
    soundEngine.unlock();
    setSubmitting(true);
    try {
      const res = await onAction('SUBMIT_SECRET_CHOICE', { teamId, option, teamToken });
      if (handleInvalidTokenFromServer(res)) return;
      if (res.accepted && gameState.questionInstanceId) {
        setLocalVote({ instanceId: gameState.questionInstanceId, option });
        try {
          sessionStorage.setItem(storageKey, option);
        } catch {
          // ignore storage quota
        }
        onToast(`🔐 تم تثبيت إجابتك السرية (${option})`);
      } else if (res.message) {
        onToast(res.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handlePowerUpClick = async (type: PowerUpType) => {
    if (authStatus !== 'authorized') return;
    if (type === 'steal') {
      setStealModalOpen(true);
      return;
    }
    const res = await onAction('ACTIVATE_POWERUP', { teamId, type, teamToken });
    if (handleInvalidTokenFromServer(res)) return;
    if (res.status === 'OK') {
      onToast('✅ تم تفعيل الأداة التكتيكية بنجاح');
    } else if (res.message) {
      onToast(res.message);
    }
  };

  const handleConfirmSteal = async (targetTeamId: string) => {
    if (authStatus !== 'authorized') return;
    setStealModalOpen(false);
    const res = await onAction('ACTIVATE_POWERUP', {
      teamId,
      type: 'steal',
      targetTeamId,
      teamToken,
    });
    if (handleInvalidTokenFromServer(res)) return;
    if (res.status === 'OK') {
      onToast(`🧲 تم استهداف ${getTeamDisplayName(gameState, targetTeamId)}!`);
    } else if (res.message) {
      onToast(res.message);
    }
  };

  const stealCandidates = activeTeamIds.filter(
    (id) =>
      id !== teamId &&
      !gameState.eliminatedTeams.includes(id) &&
      (Number(gameState.scores[id]) || 0) > 0
  );

  const bombCandidates = activeTeamIds.filter(
    (id) => id !== teamId && !gameState.eliminatedTeams.includes(id)
  );

  const buzzerStateClass = isLockedWinner
    ? 'buzzer-winner'
    : isLockedOther || isFrozen || hasAttempted || isEliminated || isExcludedByDuel
    ? 'buzzer-blocked'
    : canPressBuzzer
    ? 'buzzer-ready'
    : '';

  const buzzerMainLabel = isEliminated
    ? 'فريق مستبعد'
    : isExcludedByDuel
    ? '⚔️ مبارزة خاصة بين فريقين'
    : isFrozen
    ? '❄️ مجمد مؤقتاً'
    : hasAttempted
    ? 'استنفد المحاولة'
    : isLockedWinner
    ? gameState.activeBomb?.status === 'TICKING'
      ? `💣 أجب فوراً! (${answerRemainingSec}ث)`
      : `دوركم الآن! (${answerRemainingSec}ث)`
    : isLockedOther
    ? `قفل: ${getTeamDisplayName(gameState, gameState.lockedTeamId)}`
    : gameState.isTimerPaused
    ? '⏸️ متوقف مؤقتاً'
    : canPressBuzzer
    ? 'اضغط للإجابة!'
    : 'بانتظار السؤال';

  if (authStatus === 'checking') {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-4 py-6">
        <div className="surface-card w-full rounded-3xl p-6 text-center">
          <p className="font-display text-lg font-black text-primary-token">
            ⏳ جاري التحقق من رابط دخول الفريق...
          </p>
        </div>
      </div>
    );
  }

  if (authStatus === 'invalid') {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-4 py-6">
        <div className="surface-card w-full rounded-3xl p-6 text-center">
          <p className="font-display text-xl font-black text-primary-token">
            🔒 شاشة الفريق مقفلة
          </p>
          <p className="surface-error mt-4 rounded-2xl p-4 text-sm font-black">
            {authError ||
              'رابط الفريق غير صالح أو منتهي الصلاحية — يرجى مسح رمز الباركود الخاص بفريقك من شاشة المقدم.'}
          </p>
          <p className="mt-4 text-xs font-bold text-secondary-token">
            كل شاشة مخصصة لفريق واحد فقط عبر الباركود أو الرابط الخاص به ولا يمكن الانتقال بين الفرق.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-between gap-4 px-4 py-4">
      {/* ARIA Live Region for Mobile */}
      <div
        id="mobile-announcer"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />
      {/* بطاقة الفريق والنقاط (مستقلة ومعزولة لفريق واحد فقط) */}
      <header className="surface-card rounded-2xl p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className={`team-rank-badge team-rank-${teamId} flex h-12 w-12 items-center justify-center rounded-2xl font-display text-xl font-black`}
            >
              {teamId}
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <h1 className="font-display text-lg font-black text-primary-token">{teamName}</h1>
                {teamStreak >= 2 && (
                  <span className="font-display text-xs font-black text-accent-token tabular-nums">
                    🔥 ×{teamStreak}
                  </span>
                )}
                {teamBounty > 0 && (
                  <span className="font-display text-[11px] font-black text-primary-token tabular-nums">
                    🎯 مكافأة صيد +{teamBounty}
                  </span>
                )}
              </div>
              <p className="font-display text-xs font-bold text-secondary-token">
                {gameState.fsmState === 'TRAP_SETUP'
                  ? '🕳️ مرحلة زرع الكمائن السرية'
                  : gameState.fsmState === 'FINAL_WAGER_OPEN' ||
                    gameState.fsmState === 'FINAL_QUESTION_ACTIVE' ||
                    gameState.fsmState === 'FINAL_REVEALED'
                  ? '🔥 الجولة النهائية الحاسمة'
                  : gameState.answerMode === 'CHOICE'
                  ? 'وضع التصويت السري (A/B/C)'
                  : 'وضع الضاغط الصوتي السريع'}
              </p>
            </div>
          </div>
          <div className="surface-accent rounded-2xl px-4 py-2 text-center">
            <span className="block text-xs font-bold text-secondary-token">النقاط</span>
            <span className="font-display text-2xl font-black text-accent-token tabular-nums">{score}</span>
          </div>
        </div>
      </header>

      {/* منطقة التفاعل الرئيسية (كمائن سرية / رهان نهائي / تصويت سري / ضاغط) */}
      <main className="surface-card flex flex-1 flex-col items-center justify-center rounded-3xl p-5 text-center">
        {gameState.activeTrapTrigger && (
          <div
            className={`stage-pop-in mb-3 w-full rounded-2xl p-2.5 ${
              gameState.activeTrapTrigger.status === 'DETONATED' ? 'surface-error' : 'surface-accent'
            }`}
          >
            <p className="font-display text-xs font-black">{gameState.activeTrapTrigger.title}</p>
            <p className="mt-0.5 text-[11px] font-bold">{gameState.activeTrapTrigger.desc}</p>
          </div>
        )}

        {gameState.activeMysteryTwist && (
          <div
            className={`stage-pop-in mb-3 w-full rounded-2xl p-2.5 ${
              gameState.activeMysteryTwist.sentiment === 'BAD' ? 'surface-error' : 'surface-success'
            }`}
          >
            <p className="font-display text-xs font-black">
              {gameState.activeMysteryTwist.title}
            </p>
          </div>
        )}

        {gameState.activeDuel && (
          <div className="surface-accent stage-pop-in mb-3 w-full rounded-2xl p-2.5">
            <p className="font-display text-xs font-black">
              ⚔️ مبارزة 1 ضد 1: {gameState.activeDuel.challengerName} VS {gameState.activeDuel.opponentName} (×{gameState.activeDuel.multiplier})
            </p>
          </div>
        )}

        {gameState.activeBomb && (
          <div
            className={`stage-pop-in mb-3 w-full rounded-2xl p-2.5 ${
              gameState.activeBomb.status === 'DEFUSED' ? 'surface-success' : 'surface-error'
            }`}
          >
            <p className="font-display text-xs font-black">
              {gameState.activeBomb.status === 'TICKING'
                ? gameState.activeBomb.targetId === teamId
                  ? `💣 قنبلة موجهة إليكم من (${gameState.activeBomb.throwerName})! أجب فوراً!`
                  : `💣 القنبلة عند (${gameState.activeBomb.targetName})!`
                : gameState.activeBomb.summary}
            </p>
          </div>
        )}

        {gameState.fsmState === 'TRAP_SETUP' ? (
          <div className="flex w-full flex-col gap-3 text-right">
            <div className="flex items-center justify-between gap-2">
              <p className="font-display text-sm font-black text-primary-token">
                🕳️ ازرع كمينين سريين للخصوم
              </p>
              <span className="pill-accent-token rounded-lg px-2.5 py-1 font-display text-xs font-black tabular-nums">
                {myTraps.length} / {maxTrapsAllowed}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {TRAP_OPTIONS.map((opt) => {
                const isSelected = selectedTrapType === opt.type;
                return (
                  <button
                    key={opt.type}
                    type="button"
                    onClick={() => setSelectedTrapType(opt.type)}
                    className={`btn-token min-h-[48px] flex-col items-start gap-0.5 rounded-xl px-2.5 py-2 text-right ${
                      isSelected ? 'btn-primary-token' : ''
                    }`}
                  >
                    <span className="font-display text-xs font-black">
                      {opt.icon} {opt.label}
                    </span>
                    <span className="text-[10px] font-bold opacity-85">{opt.shortDesc}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex max-h-[260px] flex-col gap-2 overflow-y-auto pr-0.5">
              {Object.keys(gameState.boardMatrix || {}).map((cat) => (
                <div key={cat} className="surface-canvas rounded-xl border border-subtle-token p-2.5">
                  <p className="mb-1.5 font-display text-xs font-black text-primary-token">{cat}</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {DIFFICULTIES.map((diff) => {
                      const rem = Number(gameState.boardMatrix[cat]?.[diff]) || 0;
                      const slotKey = `${cat}|||${diff}`;
                      const placed = myTraps.find((t) => t.slotKey === slotKey);
                      const placedMeta = placed
                        ? TRAP_OPTIONS.find((o) => o.type === placed.type)
                        : null;
                      return (
                        <button
                          key={diff}
                          type="button"
                          disabled={rem === 0 || submitting}
                          onClick={() => void handleToggleTrapSlot(cat, diff)}
                          className={`btn-token min-h-[44px] flex-col gap-0.5 rounded-xl px-1.5 py-1.5 text-center ${
                            placed
                              ? 'btn-danger-token'
                              : rem === 0
                                ? 'diff-slot-empty'
                                : ''
                          }`}
                        >
                          <span className="font-display text-xs font-black">
                            {placedMeta ? `${placedMeta.icon} ${diff}` : diff}
                          </span>
                          <span className="text-[10px] font-bold">
                            {placed ? 'اضغط للإزالة' : rem > 0 ? 'ازرع هنا' : 'فارغ'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleConfirmTraps()}
              className={`btn-token min-h-[48px] w-full ${
                isTrapReadyServer ? 'btn-success-token' : 'btn-primary-token'
              }`}
            >
              {isTrapReadyServer
                ? '✅ تم تأكيد جاهزية كمائن فريقك'
                : '✅ تأكيد جاهزية الكمائن السرية'}
            </button>
          </div>
        ) : gameState.fsmState === 'FINAL_WAGER_OPEN' ? (
          <div className="flex w-full flex-col gap-4">
            <span className="pill-accent-token mx-auto rounded-full px-3.5 py-1 font-display text-xs font-black">
              🔥 الجولة النهائية • الفئة: {gameState.finalCategoryLabel || 'ثقافة عامة'}
            </span>
            {isEliminated ? (
              <div className="surface-error rounded-2xl p-4 font-display text-sm font-black">
                فريقك مستبعد في هذه المرحلة
              </div>
            ) : hasWageredServer ? (
              <div className="surface-success stage-pop-in rounded-2xl p-5 font-display text-sm font-black">
                🔐 تم تثبيت رهانكم السري بنجاح! بانتظار إطلاق السؤال النهائي على الشاشة...
              </div>
            ) : (
              <div className="surface-canvas flex flex-col gap-4 rounded-2xl border-2 border-subtle-token p-4">
                <p className="font-display text-base font-black text-primary-token">
                  كم نقطة تراهن بها في السؤال الحاسم؟
                </p>
                <div className="font-display text-4xl font-black text-accent-token tabular-nums">
                  {wagerInput} نقطة
                </div>
                <input
                  type="range"
                  min={0}
                  max={maxWager}
                  step={10}
                  value={wagerInput}
                  onChange={(e) => setWagerInput(Number(e.target.value))}
                  className="w-full cursor-pointer"
                  aria-label="قيمة الرهان السري"
                />
                <div className="grid grid-cols-4 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setWagerInput(0)}
                    className="btn-token btn-token-sm"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    onClick={() => setWagerInput(Math.round(maxWager * 0.25))}
                    className="btn-token btn-token-sm"
                  >
                    25%
                  </button>
                  <button
                    type="button"
                    onClick={() => setWagerInput(Math.round(maxWager * 0.5))}
                    className="btn-token btn-token-sm"
                  >
                    50%
                  </button>
                  <button
                    type="button"
                    onClick={() => setWagerInput(maxWager)}
                    className="btn-token btn-token-sm btn-warning-token"
                  >
                    الكل ({maxWager})
                  </button>
                </div>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleSubmitFinalWager()}
                  className="btn-token btn-primary-token w-full"
                >
                  {submitting ? '⏳ جاري التثبيت...' : '🔐 تثبيت الرهان السري'}
                </button>
              </div>
            )}
          </div>
        ) : gameState.fsmState === 'FINAL_REVEALED' ? (
          (() => {
            const myFinalRes = gameState.finalResults?.results[teamId];
            const cardCls =
              myFinalRes?.status === 'CORRECT' ? 'surface-success' : 'surface-error';
            return (
              <div className="flex w-full flex-col gap-3">
                <p className="font-display text-lg font-black text-primary-token">
                  🏆 نتيجة الجولة النهائية
                </p>
                {myFinalRes ? (
                  <div className={`${cardCls} stage-pop-in rounded-2xl p-4`}>
                    <p className="font-display text-base font-black">
                      {myFinalRes.status === 'CORRECT'
                        ? '✅ إجابة صحيحة! ضاعفتم نقاط الرهان'
                        : myFinalRes.status === 'WRONG'
                        ? '❌ إجابة خاطئة'
                        : '⌛ لم يتم تسجيل إجابة'}
                    </p>
                    <p className="mt-2 font-display text-sm font-bold tabular-nums">
                      الرهان: {myFinalRes.wager} • التغيير:{' '}
                      {myFinalRes.delta > 0 ? `+${myFinalRes.delta}` : myFinalRes.delta} نقطة
                    </p>
                    <p className="mt-1 font-display text-2xl font-black tabular-nums">
                      الرصيد النهائي: {myFinalRes.score}
                    </p>
                  </div>
                ) : (
                  <div className="surface-canvas rounded-2xl p-4 text-sm font-bold text-secondary-token">
                    تم إعلان نتائج الجولة النهائية.
                  </div>
                )}
                {gameState.currentQuestion?.explanation && (
                  <div className="surface-accent rounded-2xl p-3 text-xs font-bold">
                    💡 {gameState.currentQuestion.explanation}
                  </div>
                )}
              </div>
            );
          })()
        ) : (
          <>
            {gameState.currentQuestion ? (
              <div className="mb-4 w-full">
                <div className="mb-2 flex items-center justify-between text-xs font-black text-secondary-token">
                  <span>{gameState.currentQuestion.category}</span>
                  <span className="tabular-nums">⏳ {questionRemainingSec}ث</span>
                </div>
                <p className="font-display text-base font-black text-primary-token">
                  {gameState.currentQuestion.question}
                </p>
              </div>
            ) : (
              <div className="mb-4 w-full">
                <p className="font-display text-base font-black text-secondary-token">
                  الجولة الحالية: {gameState.currentRoundLabel}
                </p>
              </div>
            )}

            {gameState.answerMode === 'CHOICE' || gameState.fsmState === 'FINAL_QUESTION_ACTIVE' ? (
              <div className="flex w-full flex-col gap-3">
                {isEliminated ? (
                  <div className="surface-error rounded-2xl p-4 font-display text-sm font-black">
                    فريقك مستبعد في هذه المرحلة
                  </div>
                ) : !gameState.currentQuestion || gameState.fsmState === 'CATEGORY_BOARD' || gameState.fsmState === 'WAITING_LOBBY' ? (
                  <div className="surface-canvas rounded-2xl border-2 border-subtle-token p-6 font-display text-sm font-black text-secondary-token">
                    بانتظار إطلاق السؤال للبدء بالتصويت السري...
                  </div>
                ) : (
                  <>
                    {OPTION_LIST.map((opt) => {
                      const isElimOpt = gameState.activeEffects.eliminatedOptions.includes(opt);
                      const isPicked = pickedOption === opt;
                      const revealedRes = gameState.revealedChoices?.results[teamId];
                      const isCorrectOnReveal =
                        gameState.fsmState === 'CHOICE_REVEALED' &&
                        gameState.revealedChoices?.correctOption === opt;
                      const isWrongPickedOnReveal =
                        gameState.fsmState === 'CHOICE_REVEALED' &&
                        revealedRes?.option === opt &&
                        revealedRes.status === 'WRONG';

                      const optClass = isCorrectOnReveal
                        ? 'choice-selected'
                        : isWrongPickedOnReveal
                        ? 'choice-wrong'
                        : isElimOpt
                        ? 'choice-eliminated'
                        : isPicked
                        ? 'choice-selected'
                        : '';

                      const isVotingPhase =
                        gameState.fsmState === 'QUESTION_ACTIVE' ||
                        gameState.fsmState === 'FINAL_QUESTION_ACTIVE';

                      const locked =
                        submitting ||
                        isElimOpt ||
                        hasVotedServer ||
                        Boolean(pickedOption) ||
                        !isVotingPhase ||
                        gameState.isTimerPaused;

                      return (
                        <button
                          key={opt}
                          type="button"
                          disabled={locked}
                          onClick={() => void handleSubmitChoice(opt)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              if (!locked) void handleSubmitChoice(opt);
                            }
                          }}
                          className={`choice-btn-token ${optClass} flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-right`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="pill-accent-token flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-display text-base font-black">
                              {opt}
                            </span>
                            <span className="font-display text-base font-black">
                              {gameState.currentQuestion?.options[opt]}
                            </span>
                          </div>
                          {isPicked && <span className="font-display text-xs font-black">✓ مثبت</span>}
                        </button>
                      );
                    })}
                    {(hasVotedServer || pickedOption) &&
                      (gameState.fsmState === 'QUESTION_ACTIVE' ||
                        gameState.fsmState === 'FINAL_QUESTION_ACTIVE') && (
                        <p className="mt-1 font-display text-xs font-black text-success-token">
                          🔐 تم تثبيت إجابتك سرياً — بانتظار إعلان النتيجة الجماعية
                        </p>
                      )}
                  </>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-2">
                <button
                  type="button"
                  disabled={!canPressBuzzer || submitting}
                  onClick={() => void handlePressBuzzer()}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && canPressBuzzer && !submitting) {
                      e.preventDefault();
                      void handlePressBuzzer();
                    }
                  }}
                  tabIndex={canPressBuzzer ? 0 : -1}
                  className={`buzzer-circle-btn ${buzzerStateClass} flex flex-col items-center justify-center gap-1 font-display font-black`}
                >
                  <span className="text-3xl">{isLockedWinner ? '🎤' : canPressBuzzer ? '🔔' : '🔒'}</span>
                  <span className="px-4 text-lg leading-snug">{buzzerMainLabel}</span>
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* شريط الأدوات التكتيكية + القنبلة الموقوتة */}
      {gameState.settings.powerUpsEnabled &&
        gameState.fsmState !== 'TRAP_SETUP' &&
        gameState.fsmState !== 'FINAL_WAGER_OPEN' &&
        gameState.fsmState !== 'FINAL_QUESTION_ACTIVE' &&
        gameState.fsmState !== 'FINAL_REVEALED' && (
        <section className="surface-card rounded-2xl p-3.5">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <p className="font-display text-xs font-black text-secondary-token">
              الأدوات التكتيكية المستقلة
            </p>
            {gameState.powerUpsLockedThisQuestion && (
              <span className="font-display text-[11px] font-black text-accent-token">
                🔇 مقفلة في هذا السؤال
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {POWERUP_META.map((pu) => {
              const count = Number(teamPowerUps[pu.type]) || 0;
              const unsupportedInChoice =
                gameState.answerMode === 'CHOICE' && (pu.type === 'freeze' || pu.type === 'steal');
              const canUse =
                count > 0 &&
                !isEliminated &&
                !gameState.powerUpsLockedThisQuestion &&
                !unsupportedInChoice &&
                (gameState.fsmState === 'QUESTION_ACTIVE' || gameState.fsmState === 'BUZZER_LOCKED');

              return (
                <button
                  key={pu.type}
                  type="button"
                  disabled={!canUse}
                  onClick={() => void handlePowerUpClick(pu.type)}
                  className="powerup-tile-btn flex min-h-[58px] flex-col items-center justify-center rounded-xl px-2 py-2 text-center"
                >
                  <span className="text-lg">{pu.icon}</span>
                  <span className="font-display text-xs font-black">{pu.label}</span>
                  <span className="text-xs font-bold text-accent-token tabular-nums">×{count}</span>
                </button>
              );
            })}
          </div>

          {gameState.answerMode === 'BUZZER' && (
            <button
              type="button"
              disabled={!canThrowBomb || submitting}
              onClick={() => setBombModalOpen(true)}
              className="btn-token btn-danger-token mt-2.5 min-h-[46px] w-full justify-between"
            >
              <span>💣 تمرير القنبلة الموقوتة لمنافس (10ث)</span>
              <span className="tabular-nums">×{bombCredits}</span>
            </button>
          )}
        </section>
      )}

      {/* نافذة اختيار هدف القنبلة الموقوتة */}
      {bombModalOpen && (
        <div className="modal-scrim fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="surface-card w-full max-w-sm rounded-3xl p-5">
            <h3 className="font-display text-lg font-black text-primary-token">
              💣 اختر المنافس لإلقاء القنبلة عليه
            </h3>
            <p className="mt-1 text-xs font-bold text-secondary-token">
              سيُلزم الفريق المختار بالإجابة خلال 10 ثوانٍ — إذا أخطأ تنتقل نصف نقاط السؤال إليكم، وإذا أصاب يحصل على +50 نقطة شجاعة!
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {bombCandidates.length === 0 ? (
                <p className="surface-error rounded-xl p-3 text-center font-display text-xs font-black">
                  لا يوجد فريق خصم متاح حالياً
                </p>
              ) : (
                bombCandidates.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => void handleConfirmBomb(id)}
                    className="btn-token min-h-[46px] justify-between"
                  >
                    <span>{getTeamDisplayName(gameState, id)}</span>
                    <span className="text-accent-token tabular-nums">
                      {Number(gameState.scores[id]) || 0} نقطة
                    </span>
                  </button>
                ))
              )}
            </div>
            <button
              type="button"
              onClick={() => setBombModalOpen(false)}
              className="btn-token mt-4 min-h-[44px] w-full"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      {/* نافذة اختيار هدف السرقة الموجهة (> 0) */}
      {stealModalOpen && (
        <div className="modal-scrim fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="surface-card w-full max-w-sm rounded-3xl p-5">
            <h3 className="font-display text-lg font-black text-primary-token">
              🧲 اختر الفريق المستهدف للسرقة
            </h3>
            <p className="mt-1 text-xs font-bold text-secondary-token">
              تظهر فقط الفرق النشطة التي تمتلك رصيداً أكبر من 0 نقطة.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {stealCandidates.length === 0 ? (
                <p className="surface-error rounded-xl p-3 text-center font-display text-xs font-black">
                  لا يوجد فريق خصم يمتلك نقاطاً للسرقة حالياً
                </p>
              ) : (
                stealCandidates.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => void handleConfirmSteal(id)}
                    className="btn-token justify-between"
                  >
                    <span>{getTeamDisplayName(gameState, id)}</span>
                    <span className="text-accent-token">{Number(gameState.scores[id]) || 0} نقطة</span>
                  </button>
                ))
              )}
            </div>
            <button
              type="button"
              onClick={() => setStealModalOpen(false)}
              className="btn-token mt-4 w-full"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { getActiveTeamIds, getTeamDisplayName } from '../hooks/useTriviaRealtime';
import type { ActionResponse, DifficultyLevel, GameState, OptionLetter } from '../types/game';
import { soundEngine } from '../utils/audio';

interface TVViewProps {
  gameState: GameState;
  questionRemainingSec: number;
  answerRemainingSec: number;
  onAction: (action: string, payload?: Record<string, unknown>) => Promise<ActionResponse>;
  onToast: (msg: string) => void;
}

interface ConfettiParticle {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  color: string;
  angle: number;
  spin: number;
}

const OPTION_LIST: OptionLetter[] = ['A', 'B', 'C'];
const DIFFICULTIES: DifficultyLevel[] = ['سهل', 'متوسط', 'صعب'];

export function TVView({
  gameState,
  questionRemainingSec,
  answerRemainingSec,
  onAction,
  onToast,
}: TVViewProps) {
  const [soundOn, setSoundOn] = useState<boolean>(soundEngine.isEnabled());
  const [failedImageQuestionId, setFailedImageQuestionId] = useState<number | null>(null);
  const confettiCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    setFailedImageQuestionId(null);
  }, [gameState.currentQuestion?.id]);

  const toggleSound = () => {
    const next = !soundOn;
    soundEngine.setEnabled(next);
    if (next) soundEngine.unlock();
    setSoundOn(next);
  };

  useEffect(() => {
    if (gameState.fsmState !== 'CELEBRATION_PODIUM') return;
    const canvas = confettiCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const styles = getComputedStyle(document.documentElement);
    const tokenColors = [
      styles.getPropertyValue('--icon-primary').trim(),
      styles.getPropertyValue('--team-1').trim(),
      styles.getPropertyValue('--team-2').trim(),
      styles.getPropertyValue('--team-3').trim(),
      styles.getPropertyValue('--team-4').trim(),
      styles.getPropertyValue('--state-success-border').trim(),
    ].filter(Boolean);

    const palette = tokenColors.length > 0 ? tokenColors : ['currentColor'];
    const particles: ConfettiParticle[] = Array.from({ length: 120 }, (_, i) => ({
      x: Math.random() * canvas.width,
      y: Math.random() * -canvas.height,
      w: 7 + Math.random() * 6,
      h: 4 + Math.random() * 5,
      vx: -1.5 + Math.random() * 3,
      vy: 2.2 + Math.random() * 3.5,
      color: palette[i % palette.length],
      angle: Math.random() * Math.PI * 2,
      spin: -0.08 + Math.random() * 0.16,
    }));

    let rafId = 0;
    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.angle += p.spin;
        if (p.y > canvas.height + 20) {
          p.y = -15;
          p.x = Math.random() * canvas.width;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, [gameState.fsmState]);

  // ─── ARIA Announcements for State Changes ───────────────────────────
  useEffect(() => {
    const polite = document.getElementById('tv-announcer-polite');
    const assertive = document.getElementById('tv-announcer-assertive');
    if (!polite || !assertive) return;

    const state = gameState.fsmState;
    let message = '';
    let isAssertive = false;

    switch (state) {
      case 'QUESTION_ACTIVE':
        if (gameState.currentQuestion) {
          message = `سؤال جديد: ${gameState.currentQuestion.question}. الفئة: ${gameState.currentQuestion.category}. الصعوبة: ${gameState.currentQuestion.difficulty}. النقاط: ${gameState.currentQuestionPoints}.`;
        }
        break;
      case 'BUZZER_LOCKED':
        if (gameState.lockedTeamId) {
          message = `فريق ${getTeamDisplayName(gameState, gameState.lockedTeamId)} ضغط الضاغط. مهلة الإجابة ${answerRemainingSec} ثوانٍ.`;
          isAssertive = true;
        }
        break;
      case 'ANSWER_CORRECT':
        if (gameState.lockedTeamId) {
          const pts = Number(gameState.scores[gameState.lockedTeamId]) || 0;
          message = `إجابة صحيحة من ${getTeamDisplayName(gameState, gameState.lockedTeamId)}. رصيدهم الآن ${pts} نقطة.`;
          isAssertive = true;
        }
        break;
      case 'ANSWER_WRONG':
        if (gameState.lockedTeamId) {
          message = `إجابة خاطئة من ${getTeamDisplayName(gameState, gameState.lockedTeamId)}. الإجابة الصحيحة: ${gameState.currentQuestion?.correct}.`;
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
          message = `تم كشف التصويت الجماعي. ${gameState.revealedChoices.winnersCount} إجابة صحيحة من أصل ${getActiveTeamIds(gameState).filter(id => !gameState.eliminatedTeams.includes(id)).length}.`;
        }
        break;
      case 'FINAL_REVEALED':
        if (gameState.finalResults) {
          message = `اكتملت الجولة النهائية. ${gameState.finalResults.winnersCount} إجابة صحيحة.`;
        }
        break;
      case 'CELEBRATION_PODIUM':
        if (rankedTeams[0]) {
          message = `الفائز بالمركز الأول: ${rankedTeams[0].name} برصيد ${rankedTeams[0].score} نقطة. مبروك للجميع!`;
          isAssertive = true;
        }
        break;
      case 'TRAP_SETUP':
        message = `مرحلة زرع الكمائن السرية مفتوحة. ${gameState.trapSetupReadyTeams.length} من ${nonEliminatedIds.length} فرق جاهزة.`;
        break;
      default:
        return;
    }

    if (message) {
      const target = isAssertive ? assertive : polite;
      target.textContent = message;
      // Clear after announcement to allow repeat announcements
      setTimeout(() => { target.textContent = ''; }, 1000);
    }
  }, [gameState.fsmState, gameState.currentQuestion, gameState.lockedTeamId, gameState.timedOutTeamId,
      gameState.revealedChoices, gameState.finalResults, gameState.trapSetupReadyTeams.length,
      answerRemainingSec, rankedTeams[0]?.name, rankedTeams[0]?.score]);

  const activeTeamIds = getActiveTeamIds(gameState);
  const nonEliminatedIds = activeTeamIds.filter((id) => !gameState.eliminatedTeams.includes(id));

  const rankedTeams = activeTeamIds
    .map((id) => ({
      id,
      name: getTeamDisplayName(gameState, id),
      score: Number(gameState.scores[id]) || 0,
      eliminated: gameState.eliminatedTeams.includes(id),
    }))
    .sort((a, b) => b.score - a.score);

  const currentRanks: Record<string, number> = {};
  for (const id of activeTeamIds) {
    const myScore = Number(gameState.scores[id]) || 0;
    let higher = 0;
    for (const otherId of activeTeamIds) {
      if ((Number(gameState.scores[otherId]) || 0) > myScore) {
        higher++;
      }
    }
    currentRanks[id] = higher + 1;
  }

  const playModeLabel =
    gameState.settings.playMode === 'BOARD'
      ? 'لوحة الفئات'
      : gameState.settings.playMode === 'AUTO_CATEGORY'
      ? 'تلقائي بالفئة'
      : gameState.settings.playMode === 'AUTO_ALL'
      ? 'تلقائي شامل'
      : 'تحكم يدوي';

  const getDiffPoints = (diff: DifficultyLevel): number => {
    if (diff === 'صعب') return Number(gameState.settings.pointsHard) || 300;
    if (diff === 'متوسط') return Number(gameState.settings.pointsMedium) || 200;
    return Number(gameState.settings.pointsEasy) || 100;
  };

  const handleBoardSlotClick = async (category: string, difficulty: DifficultyLevel) => {
    const res = await onAction('PICK_BOARD_QUESTION', { category, difficulty });
    if (res.message) onToast(res.message);
  };

  const renderTrapSetup = () => (
    <div className="final-stage-token stage-pop-in rounded-3xl p-6 text-center sm:p-10">
      <div className="flex flex-wrap items-center justify-center gap-3">
        <span className="pill-accent-token inline-block rounded-full px-4 py-1.5 font-display text-sm font-black">
          🕳️ مرحلة زرع الكمائن السرية قبل بدء المباراة
        </span>
        <span className="surface-canvas rounded-full border-2 border-subtle-token px-4 py-1.5 font-display text-sm font-black text-accent-token tabular-nums">
          الكمائن المخفية حتى الآن: {gameState.totalActiveTrapsCount}
        </span>
      </div>
      <h2 className="mt-4 font-display text-3xl font-black text-primary-token sm:text-5xl">
        كل فريق يزرع كمينين سريين داخل اللوحة!
      </h2>
      <p className="mx-auto mt-3 max-w-2xl text-base font-bold text-secondary-token">
        اختروا نوع الكمين (السلب، نصف الوقت، قفل الأدوات، أو الخصم المضاعف) وازرعوه من هواتفكم بسرية تامة. الكمين ينفجر على الخصوم فقط ويفشل تلقائياً إن فتحتم خانته بأنفسكم!
      </p>

      <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {nonEliminatedIds.map((id) => {
          const isReady = gameState.trapSetupReadyTeams.includes(id);
          return (
            <div
              key={id}
              className={`rounded-2xl border-2 p-4 ${
                isReady ? 'surface-success' : 'surface-canvas border-subtle-token'
              }`}
            >
              <p className="font-display text-base font-black">{getTeamDisplayName(gameState, id)}</p>
              <p className="mt-1 font-display text-xs font-bold">
                {isReady ? '✅ جاهز للمواجهة' : '⏳ يزرع الكمائن السرية...'}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderCategoryBoard = () => {
    const categories = Object.keys(gameState.boardMatrix || {});
    return (
      <div className="surface-card rounded-3xl p-5 sm:p-7">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-black text-primary-token sm:text-3xl">
              لوحة فئات التحدي
            </h2>
            <p className="mt-1 text-sm font-bold text-secondary-token">
              الدور الآن لاختيار السؤال:
              <span className="pill-accent-token mr-2 inline-block rounded-lg px-2.5 py-0.5 font-display text-sm font-black">
                {getTeamDisplayName(gameState, gameState.activeTurnTeamId)}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {gameState.totalActiveTrapsCount > 0 && (
              <span className="surface-canvas rounded-full border-2 border-subtle-token px-3.5 py-1.5 font-display text-xs font-black text-accent-token tabular-nums">
                🕳️ كمائن مخفية: {gameState.totalActiveTrapsCount}
              </span>
            )}
            <span className="pill-accent-token rounded-full px-3.5 py-1.5 font-display text-xs font-black">
              النطاق: {gameState.currentRoundLabel}
            </span>
          </div>
        </div>

        {gameState.armedDuel && (
          <div className="surface-error stage-pop-in mb-4 rounded-2xl px-5 py-3.5 text-center">
            <p className="font-display text-lg font-black">
              ⚔️ إنذار مبارزة فردية 1 ضد 1! ({gameState.armedDuel.challengerName}) يتحدى ({gameState.armedDuel.opponentName})
            </p>
            <p className="mt-0.5 text-xs font-bold">
              السؤال القادم سيكون مواجهة حصرية بينهما على ×1.5 من النقاط — اختر الخانة الآن!
            </p>
          </div>
        )}

        {gameState.boardNotice && (
          <div className="surface-accent mb-4 rounded-2xl px-4 py-3 text-center font-display text-sm font-black">
            {gameState.boardNotice}
          </div>
        )}

        {categories.length === 0 ? (
          <div className="surface-canvas rounded-2xl border-2 border-dashed border-subtle-token p-10 text-center">
            <p className="font-display text-lg font-black text-primary-token">
              لا توجد أسئلة متاحة في هذه الجولة حالياً
            </p>
            <p className="mt-2 text-sm font-bold text-secondary-token">
              افتح تبويب «الإعدادات والأسئلة» لاستيراد ملف Excel أو استعادة الأسئلة النموذجية.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {categories.map((cat) => {
              const counts = gameState.boardMatrix[cat];
              return (
                <div key={cat} className="surface-canvas rounded-2xl border-2 border-subtle-token p-4">
                  <h3 className="mb-3 text-center font-display text-lg font-black text-primary-token">
                    {cat}
                  </h3>
                  <div className="grid grid-cols-3 gap-2">
                    {DIFFICULTIES.map((diff) => {
                      const remaining = counts ? Number(counts[diff]) || 0 : 0;
                      const pts = getDiffPoints(diff);
                      return (
                        <button
                          key={diff}
                          type="button"
                          disabled={remaining === 0}
                          onClick={() => void handleBoardSlotClick(cat, diff)}
                          className={`btn-token flex-col gap-0.5 py-2.5 ${
                            remaining === 0 ? 'diff-slot-empty' : 'surface-accent'
                          }`}
                        >
                          <span className="font-display text-xs font-black">{diff}</span>
                          <span className="font-display text-base font-black text-accent-token">
                            {pts}
                          </span>
                          <span className="text-xs font-bold text-secondary-token">
                            متبقي: {remaining}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderWaitingLobby = () => (
    <div className="surface-card flex flex-col items-center justify-center rounded-3xl p-10 text-center sm:p-16">
      <div className="surface-accent mb-5 flex h-20 w-20 items-center justify-center rounded-3xl text-4xl">
        🏆
      </div>
      <h2 className="font-display text-3xl font-black text-primary-token sm:text-4xl">
        المنصة جاهزة لانطلاق الجولة
      </h2>
      <p className="mt-3 max-w-xl text-base font-bold text-secondary-token sm:text-lg">
        الفرق متصلة عبر شاشات الهواتف، وبانتظار إشارة المقدم لإطلاق السؤال التالي.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <span className="pill-accent-token rounded-xl px-4 py-2 font-display text-sm font-black">
          الوضع النشط: {gameState.answerMode === 'CHOICE' ? 'الإجابة السرية الجماعية' : 'الضاغط الصوتي السريع'}
        </span>
        <span className="pill-accent-token rounded-xl px-4 py-2 font-display text-sm font-black">
          الأسئلة الجاهزة: {Math.max(0, gameState.totalQuestionsCount - gameState.usedQuestionIds.length)} / {gameState.totalQuestionsCount}
        </span>
      </div>
    </div>
  );

  const renderFinalWagerOpen = () => (
    <div className="final-stage-token stage-pop-in rounded-3xl p-6 text-center sm:p-10">
      <span className="pill-accent-token inline-block rounded-full px-4 py-1.5 font-display text-sm font-black">
        🔥 الجولة النهائية الحاسمة — المراهنة السرية
      </span>
      <h2 className="mt-4 font-display text-3xl font-black text-primary-token sm:text-5xl">
        فئة السؤال النهائي: <span className="text-accent-token">{gameState.finalCategoryLabel || 'ثقافة عامة'}</span>
      </h2>
      <p className="mx-auto mt-3 max-w-2xl text-base font-bold text-secondary-token">
        يقوم كل فريق الآن بتحديد قيمة رهانه السري من هاتفه (من 0 وحتى رصيد نقاطه الحالي). الإجابة الصحيحة تضاعف الرهان، والخاطئة تخصمه!
      </p>

      <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {nonEliminatedIds.map((id) => {
          const locked = gameState.finalWageredTeams.includes(id);
          return (
            <div
              key={id}
              className={`rounded-2xl border-2 p-4 ${
                locked ? 'surface-success' : 'surface-canvas border-subtle-token'
              }`}
            >
              <p className="font-display text-base font-black">{getTeamDisplayName(gameState, id)}</p>
              <p className="mt-1 font-display text-xs font-bold">
                {locked ? '🔐 تم تثبيت الرهان' : '⏳ يقرر قيمة الرهان...'}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderQuestionStage = () => {
    const q = gameState.currentQuestion;
    if (!q) return renderWaitingLobby();

    const isFinalMode =
      gameState.fsmState === 'FINAL_QUESTION_ACTIVE' || gameState.fsmState === 'FINAL_REVEALED';

    const showCorrectHighlight =
      gameState.fsmState === 'ANSWER_CORRECT' ||
      gameState.fsmState === 'ANSWER_WRONG' ||
      gameState.fsmState === 'CHOICE_REVEALED' ||
      gameState.fsmState === 'FINAL_REVEALED';
    const correctOpt = q.correct;

    return (
      <div className={`${isFinalMode ? 'final-stage-token' : 'surface-card'} stage-pop-in rounded-3xl p-5 sm:p-8`}>
        {/* لافتة انطلاق كمين سري */}
        {gameState.activeTrapTrigger && (
          <div
            className={`stage-pop-in mb-4 rounded-2xl px-4 py-3 text-center ${
              gameState.activeTrapTrigger.status === 'DETONATED' ? 'surface-error' : 'surface-accent'
            }`}
          >
            <p className="font-display text-lg font-black">
              {gameState.activeTrapTrigger.title}
            </p>
            <p className="mt-0.5 text-sm font-bold">
              {gameState.activeTrapTrigger.desc}
            </p>
          </div>
        )}

        {/* شارة مفاجأة اللوحة (سعيدة أو خطيرة) */}
        {gameState.activeMysteryTwist && (
          <div
            className={`stage-pop-in mb-4 rounded-2xl px-4 py-3 text-center ${
              gameState.activeMysteryTwist.sentiment === 'BAD' ? 'surface-error' : 'surface-success'
            }`}
          >
            <p className="font-display text-lg font-black">
              {gameState.activeMysteryTwist.title}
            </p>
            <p className="mt-0.5 text-sm font-bold">
              {gameState.activeMysteryTwist.desc}
            </p>
          </div>
        )}

        {/* حلبة المبارزة الفردية 1 ضد 1 */}
        {gameState.activeDuel && (
          <div className="surface-accent stage-pop-in mb-4 rounded-2xl px-5 py-3.5 text-center">
            <p className="font-display text-xs font-black text-accent-token tabular-nums">
              ⚔️ حلبة المبارزة الفردية • نقاط ×{gameState.activeDuel.multiplier} • الضاغط حصري للمتبارزين
            </p>
            <div className="mt-1.5 flex flex-wrap items-center justify-center gap-3 font-display text-xl font-black text-primary-token sm:text-2xl">
              <span>{gameState.activeDuel.challengerName}</span>
              <span className="pill-accent-token rounded-lg px-2.5 py-0.5 text-sm">VS</span>
              <span>{gameState.activeDuel.opponentName}</span>
            </div>
            {gameState.activeDuel.summary && (
              <p className="mt-1.5 text-sm font-black text-accent-token">{gameState.activeDuel.summary}</p>
            )}
          </div>
        )}

        {/* شارة القنبلة الموقوتة */}
        {gameState.activeBomb && (
          <div
            className={`stage-pop-in mb-4 rounded-2xl px-4 py-3 text-center ${
              gameState.activeBomb.status === 'DEFUSED' ? 'surface-success' : 'surface-error'
            }`}
          >
            <p className="font-display text-lg font-black">
              {gameState.activeBomb.status === 'TICKING'
                ? `💣 القنبلة الموقوتة بيد (${gameState.activeBomb.targetName})! ألقاها (${gameState.activeBomb.throwerName})`
                : gameState.activeBomb.status === 'DEFUSED'
                  ? '✅ فُكّت القنبلة الموقوتة بشجاعة!'
                  : '💥 انفجرت القنبلة الموقوتة!'}
            </p>
            {gameState.activeBomb.summary && (
              <p className="mt-0.5 text-sm font-bold">{gameState.activeBomb.summary}</p>
            )}
          </div>
        )}

        {/* شارة صياد المتصدر (Bounty Hunter) */}
        {gameState.lastBountyClaim &&
          (Date.now() - gameState.lastBountyClaim.at < 15000 ||
            gameState.fsmState === 'ANSWER_CORRECT' ||
            gameState.fsmState === 'CHOICE_REVEALED') && (
            <div className="surface-success stage-pop-in mb-4 rounded-2xl px-4 py-3 text-center">
              <p className="font-display text-lg font-black tabular-nums">
                🎯 صياد المتصدر! حصد ({gameState.lastBountyClaim.hunterTeamName}) مكافأة +{gameState.lastBountyClaim.amount} نقطة بكسر سلسلة ({gameState.lastBountyClaim.targetTeamName})!
              </p>
            </div>
          )}

        {/* رأس السؤال */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="pill-accent-token rounded-xl px-3.5 py-1.5 font-display text-sm font-black">
              {isFinalMode ? `🔥 السؤال النهائي • ${q.category}` : `${q.round} • ${q.category}`}
            </span>
            <span className="surface-canvas rounded-xl border-2 border-subtle-token px-3 py-1.5 font-display text-xs font-black text-secondary-token">
              {q.difficulty}
            </span>
          </div>
          <span className="pill-accent-token rounded-xl px-4 py-1.5 font-display text-base font-black tabular-nums">
            {isFinalMode ? 'رهان سري' : `${gameState.currentQuestionPoints} نقطة`}
          </span>
        </div>

        {/* نص السؤال */}
        <h2 className="mb-5 text-center font-display text-2xl leading-relaxed font-black text-primary-token sm:text-4xl">
          {q.question}
        </h2>

        {/* وسائط السؤال (صورة / مقطع صوتي) */}
        {(q.imageUrl || q.audioUrl) && (
          <div className="mb-6 flex flex-col items-center gap-3">
            {q.imageUrl && (
              failedImageQuestionId === q.id ? (
                <div className="surface-canvas rounded-2xl border-2 border-dashed border-subtle-token px-5 py-3 text-xs font-bold text-secondary-token">
                  🖼️ تعذر تحميل صورة السؤال من الرابط المرفق
                </div>
              ) : (
                <img
                  src={q.imageUrl}
                  alt={q.category}
                  referrerPolicy="no-referrer"
                  onError={() => setFailedImageQuestionId(q.id)}
                  className="media-stage-frame max-w-full rounded-2xl object-contain p-1"
                />
              )
            )}
            {q.audioUrl && (
              <div className="surface-canvas flex flex-wrap items-center justify-center gap-3 rounded-2xl border-2 border-subtle-token px-4 py-2.5">
                <span className="font-display text-xs font-black text-accent-token">🔊 مقطع صوتي:</span>
                <audio controls preload="metadata" src={q.audioUrl} className="max-w-xs" />
              </div>
            )}
          </div>
        )}

        {/* الخيارات A / B / C */}
        <div className="mb-6 grid grid-cols-1 gap-3.5 md:grid-cols-3">
          {OPTION_LIST.map((letter) => {
            const isEliminated = gameState.activeEffects.eliminatedOptions.includes(letter);
            const isCorrect = showCorrectHighlight && correctOpt === letter;
            return (
              <div
                key={letter}
                className={`choice-btn-token flex items-center gap-3 rounded-2xl p-4 ${
                  isCorrect ? 'choice-selected' : isEliminated ? 'choice-eliminated' : ''
                }`}
              >
                <span className="pill-accent-token flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-display text-lg font-black">
                  {letter}
                </span>
                <span className="font-display text-lg font-extrabold">{q.options[letter]}</span>
              </div>
            );
          })}
        </div>

        {/* المعلومة الإثرائية بعد كشف الإجابة */}
        {showCorrectHighlight && q.explanation && (
          <div className="surface-accent stage-pop-in mb-4 rounded-2xl px-5 py-3.5 text-center">
            <p className="font-display text-sm font-black text-accent-token">💡 معلومة إثرائية</p>
            <p className="mt-1 text-base font-bold text-primary-token">{q.explanation}</p>
          </div>
        )}

        {/* شريط حالة التصويت السري الجماعي أو النهائي */}
        {((gameState.answerMode === 'CHOICE' && gameState.fsmState === 'QUESTION_ACTIVE') ||
          gameState.fsmState === 'FINAL_QUESTION_ACTIVE') && (
          <div className="surface-accent mb-4 rounded-2xl p-4 text-center">
            <p className="font-display text-base font-black">
              🔐 التصويت السري قيد الاستقبال من الهواتف ({gameState.votedTeams.length} / {nonEliminatedIds.length})
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {nonEliminatedIds.map((id) => {
                const hasVoted = gameState.votedTeams.includes(id);
                return (
                  <span
                    key={id}
                    className={`rounded-xl px-3 py-1 font-display text-xs font-black ${
                      hasVoted ? 'surface-success' : 'surface-card'
                    }`}
                  >
                    {getTeamDisplayName(gameState, id)} {hasVoted ? '✓ صوّت' : '...'}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* نتيجة كشف الجولة النهائية الحاسمة */}
        {gameState.fsmState === 'FINAL_REVEALED' && gameState.finalResults && (
          <div className="surface-canvas stage-pop-in rounded-2xl border-2 border-subtle-token p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-lg font-black text-primary-token">
                🏆 نتائج الجولة النهائية — الإجابة الصحيحة ({gameState.finalResults.correctOption})
              </h3>
              <span className="pill-accent-token rounded-xl px-3 py-1 font-display text-xs font-black tabular-nums">
                {gameState.finalResults.winnersCount} إجابة صحيحة
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(gameState.finalResults.results).map(([id, res]) => {
                const cardClass =
                  res.status === 'CORRECT'
                    ? 'surface-success'
                    : res.status === 'WRONG' || res.status === 'NO_VOTE'
                    ? 'surface-error'
                    : 'surface-card';
                return (
                  <div key={id} className={`${cardClass} rounded-xl p-3`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-sm font-black">
                        {getTeamDisplayName(gameState, id)}
                      </span>
                      <span className="font-display text-xs font-black tabular-nums">
                        الرهان: {res.wager}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs font-bold">
                      <span>{res.option ? `خيار (${res.option})` : 'لم يُصوّت'}</span>
                      <span className="tabular-nums">
                        {res.delta > 0 ? `+${res.delta}` : res.delta < 0 ? `${res.delta}` : '0'} نقطة
                      </span>
                    </div>
                    <p className="mt-1 font-display text-sm font-black tabular-nums">
                      الرصيد النهائي: {res.score}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* نتيجة الكشف الجماعي في وضع الإجابة السرية */}
        {gameState.fsmState === 'CHOICE_REVEALED' && gameState.revealedChoices && (
          <div className="surface-canvas rounded-2xl border-2 border-subtle-token p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-lg font-black text-primary-token">
                ✨ نتائج التصويت الجماعي — الإجابة الصحيحة ({gameState.revealedChoices.correctOption})
              </h3>
              <span className="pill-accent-token rounded-xl px-3 py-1 font-display text-xs font-black">
                {gameState.revealedChoices.winnersCount} إجابة صحيحة
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(gameState.revealedChoices.results).map(([id, res]) => {
                const cardClass =
                  res.status === 'CORRECT'
                    ? 'surface-success'
                    : res.status === 'WRONG'
                    ? 'surface-error'
                    : 'surface-card';
                return (
                  <div key={id} className={`${cardClass} rounded-xl p-3`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-sm font-black">
                        {getTeamDisplayName(gameState, id)}
                      </span>
                      <span className="font-display text-xs font-black">
                        {res.option ? `خيار (${res.option})` : 'لم يُصوّت'}
                      </span>
                    </div>
                    <p className="mt-1 font-display text-xs font-bold tabular-nums">
                      {res.delta > 0 ? `+${res.delta} نقطة` : res.delta < 0 ? `${res.delta} نقطة` : '0 نقطة'}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* لافتة قفل الضاغط ومؤقت الـ 7 ثوانٍ */}
        {gameState.fsmState === 'BUZZER_LOCKED' && gameState.lockedTeamId && (
          <div className="surface-accent flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
            <div className="flex items-center gap-3">
              <span
                className={`team-rank-badge team-rank-${gameState.lockedTeamId} flex h-11 w-11 items-center justify-center rounded-xl font-display text-lg font-black`}
              >
                {gameState.lockedTeamId}
              </span>
              <div>
                <p className="text-xs font-bold text-secondary-token">
                  {gameState.activeBomb?.status === 'TICKING'
                    ? '💣 القنبلة الموقوتة موجهة الآن إلى:'
                    : 'سبق بالضغط على الضاغط:'}
                </p>
                <p className="font-display text-xl font-black text-primary-token">
                  {gameState.activeBomb?.status === 'TICKING' ? '💣 ' : '🚨 '}
                  {getTeamDisplayName(gameState, gameState.lockedTeamId)}
                </p>
              </div>
            </div>
            <div
              className={`surface-card rounded-2xl px-5 py-2 font-display text-2xl font-black ${
                answerRemainingSec <= 3 ? 'timer-urgent-token' : 'text-accent-token'
              }`}
            >
              ⏱️ {answerRemainingSec} ث
            </div>
          </div>
        )}

        {gameState.fsmState === 'ANSWER_TIMEOUT' && (
          <div className="surface-error rounded-2xl p-4 text-center font-display text-lg font-black">
            ⌛ انتهت مهلة إجابة ({getTeamDisplayName(gameState, gameState.timedOutTeamId)})! بانتظار قرار المقدم: تحويل أم إعادة فتح الضاغط.
          </div>
        )}

        {gameState.fsmState === 'ANSWER_CORRECT' && (
          <div className="surface-success rounded-2xl p-4 text-center font-display text-lg font-black">
            ✅ إجابة صحيحة! أُضيفت النقاط إلى رصيد {getTeamDisplayName(gameState, gameState.lockedTeamId)}
            {gameState.lastStealSummary && (
              <span className="mt-1 block text-sm">
                🧲 وتمت سرقة {gameState.lastStealSummary.amount} نقطة من ({gameState.lastStealSummary.victimName})!
              </span>
            )}
          </div>
        )}

        {gameState.fsmState === 'ANSWER_WRONG' && (
          <div className="surface-error rounded-2xl p-4 text-center font-display text-lg font-black">
            ❌ إجابة غير صحيحة من ({getTeamDisplayName(gameState, gameState.lockedTeamId)}) — الإجابة الصحيحة: {q.correct}
          </div>
        )}
      </div>
    );
  };

  const renderPodium = () => (
    <div className="relative overflow-hidden rounded-3xl">
      <canvas
        ref={confettiCanvasRef}
        className="pointer-events-none fixed inset-0 z-30 h-full w-full"
        aria-hidden="true"
      />
      <div className="surface-card relative z-20 rounded-3xl p-6 text-center sm:p-10">
        <div className="mb-4 text-5xl">🏆</div>
        <h2 className="font-display text-3xl font-black text-primary-token sm:text-4xl">
          منصة التتويج الختامية للبطولة
        </h2>
        <p className="mt-2 text-base font-bold text-secondary-token">
          ألف مبارك للفرق الفائزة ولجميع المشاركين في منافسات اليوم!
        </p>

        <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {rankedTeams.slice(0, 3).map((team, idx) => (
            <div
              key={team.id}
              className={`surface-canvas podium-rank-${idx + 1} rounded-2xl border-4 p-5`}
            >
              <span className="pill-accent-token inline-block rounded-full px-3 py-1 font-display text-xs font-black">
                المركز #{idx + 1}
              </span>
              <h3 className="mt-3 font-display text-2xl font-black text-primary-token">
                {team.name}
              </h3>
              <p className="mt-2 font-display text-3xl font-black text-accent-token">
                {team.score} نقطة
              </p>
            </div>
          ))}
        </div>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => window.print()}
            className="btn-token btn-primary-token"
          >
            🖨️ طباعة تقرير النتائج PDF
          </button>
          <button
            type="button"
            onClick={() => void onAction('RETURN_TO_BOARD')}
            className="btn-token"
          >
            🔙 العودة للوحة الفئات
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:py-6">
      {/* ARIA Live Regions for dynamic announcements */}
      <div
        id="tv-announcer-polite"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />
      <div
        id="tv-announcer-assertive"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      />

      {/* الشريط العلوي لشاشة البث */}
      <header className="surface-card flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="badge-live-token rounded-full px-3 py-1 font-display text-xs font-black">
            ● بث مباشر
          </span>
          <h1 className="font-display text-lg font-black text-primary-token sm:text-xl">
            بطولة النخبة الكبرى للمسابقات
          </h1>
          <span className="pill-accent-token rounded-xl px-3 py-1 font-display text-xs font-black">
            {gameState.currentRoundLabel}
          </span>
          <span className="surface-canvas rounded-xl border border-subtle-token px-3 py-1 font-display text-xs font-black text-secondary-token">
            {playModeLabel} • {gameState.answerMode === 'CHOICE' ? 'سري A/B/C' : 'ضاغط سريع'}
          </span>
        </div>

        <button type="button" onClick={toggleSound} className="btn-token btn-token-sm">
          {soundOn ? '🔊 المؤثرات مفعلة' : '🔇 المؤثرات صامتة'}
        </button>
      </header>

      {/* التنبيهات التحكيمية والأدوات التكتيكية */}
      {gameState.refereeNotice && Date.now() - gameState.refereeNotice.at < 15000 && (
        <div className="surface-accent rounded-2xl px-4 py-3 text-center font-display text-sm font-black">
          {gameState.refereeNotice.text}
        </div>
      )}

      {gameState.activeEffects.lastPowerUpBanner && (
        <div className="surface-accent rounded-2xl px-4 py-2.5 text-center font-display text-sm font-black">
          {gameState.activeEffects.lastPowerUpBanner}
        </div>
      )}

      {/* المسرح الرئيسي */}
      <main>
        {gameState.fsmState === 'CELEBRATION_PODIUM'
          ? renderPodium()
          : gameState.fsmState === 'TRAP_SETUP'
          ? renderTrapSetup()
          : gameState.fsmState === 'CATEGORY_BOARD'
          ? renderCategoryBoard()
          : gameState.fsmState === 'WAITING_LOBBY'
          ? renderWaitingLobby()
          : gameState.fsmState === 'FINAL_WAGER_OPEN'
          ? renderFinalWagerOpen()
          : renderQuestionStage()}
      </main>

      {/* شريط النتائج والمؤقت السفلي */}
      <footer className="surface-card flex flex-col gap-3 rounded-2xl p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid flex-1 grid-cols-2 gap-2.5 sm:grid-cols-4">
          {activeTeamIds.map((id) => {
            const isTurn = gameState.activeTurnTeamId === id;
            const isEliminated = gameState.eliminatedTeams.includes(id);
            const isLocked = gameState.lockedTeamId === id;
            const frozenUntil = Number(gameState.activeEffects.frozenTeams[id] || 0);
            const isFrozen = frozenUntil > Date.now();
            const streak = Number(gameState.teamStreaks?.[id]) || 0;
            const bounty = Number(gameState.teamBounties?.[id]) || 0;
            const prevRank = gameState.previousRanks?.[id];
            const curRank = currentRanks[id];
            const movedUp = typeof prevRank === 'number' && curRank < prevRank;
            const movedDown = typeof prevRank === 'number' && curRank > prevRank;
            return (
              <div
                key={id}
                className={`surface-canvas flex items-center justify-between rounded-xl border-2 px-3 py-2 ${
                  isLocked || isTurn ? 'team-card-active-turn' : 'border-subtle-token'
                } ${isEliminated ? 'team-card-eliminated' : ''}`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`team-rank-badge team-rank-${id} flex h-7 w-7 shrink-0 items-center justify-center rounded-lg font-display text-xs font-black tabular-nums`}
                  >
                    {id}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-display text-xs font-black text-primary-token">
                      {getTeamDisplayName(gameState, id)}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-black">
                      {streak >= 2 && (
                        <span className="text-accent-token tabular-nums">
                          🔥 ×{streak}{streak >= 5 ? ' (+50%)' : streak >= 3 ? ' (+25%)' : ''}
                        </span>
                      )}
                      {bounty > 0 && (
                        <span className="text-primary-token tabular-nums" title="مكافأة صياد المتصدر">
                          🎯 +{bounty}
                        </span>
                      )}
                      {isFrozen && (
                        <span className="text-xs font-bold text-accent-token">❄️ مجمد</span>
                      )}
                      {isEliminated && (
                        <span className="text-xs font-bold text-secondary-token">مستبعد</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {movedUp && (
                    <span className="text-xs font-black text-success-token" title="تقدّم في الترتيب">
                      ▲
                    </span>
                  )}
                  {movedDown && (
                    <span className="text-xs font-black text-secondary-token" title="تراجع في الترتيب">
                      ▼
                    </span>
                  )}
                  <span className="font-display text-lg font-black text-accent-token tabular-nums">
                    {Number(gameState.scores[id]) || 0}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="surface-accent flex shrink-0 items-center justify-center gap-3 rounded-2xl px-5 py-2.5">
          <span className="font-display text-xs font-black text-secondary-token">
            {gameState.isTimerPaused ? '⏸️ متوقف' : '⏳ الوقت'}
          </span>
          <span
            className={`font-display text-3xl font-black tabular-nums ${
              questionRemainingSec <= 5 &&
              (gameState.fsmState === 'QUESTION_ACTIVE' || gameState.fsmState === 'FINAL_QUESTION_ACTIVE')
                ? 'timer-urgent-token'
                : 'text-accent-token'
            }`}
          >
            {questionRemainingSec}ث
          </span>
        </div>
      </footer>
    </div>
  );
}

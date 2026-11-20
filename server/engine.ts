import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { TriviaPersistence } from './persistence.ts';
import type {
  ActionResponse,
  ActiveBombInfo,
  ActiveDuelInfo,
  ActiveEffects,
  ActiveTrapTrigger,
  AnswerMode,
  ArmedDuelInfo,
  BoardMatrix,
  BountyClaimInfo,
  DifficultyLevel,
  FinalRevealedPayload,
  FinalWagerTeamResult,
  FontPairId,
  GameSettings,
  GameState,
  HostAnswersResponse,
  HostTeamTokensResponse,
  ImportedQuestionRow,
  MatchStats,
  MysteryTwistInfo,
  MysteryTwistType,
  OptionLetter,
  PlayMode,
  PowerUpType,
  PersistedStore,
  QuestionItem,
  RevealedChoicesPayload,
  RevealedTeamResult,
  TeamPowerUps,
  TeamTrapPlacement,
  TeamTrapsResponse,
  ThemeId,
  TrapType,
  VerifyTeamTokenResponse,
} from '../src/types/game.ts';

const MAX_TEAMS = 8;
const MAX_TRAPS_PER_TEAM = 2;
const VALID_TRAP_TYPES: TrapType[] = [
  'STEAL_TRAP',
  'HALF_TIME_TRAP',
  'SILENCE_POWERUPS_TRAP',
  'DOUBLE_PENALTY_TRAP',
];

interface SecretChoiceEntry {
  option: OptionLetter;
  ts: number;
}

interface SecretChoicesStore {
  questionInstanceId: string | null;
  choices: Record<string, SecretChoiceEntry>;
}

interface FinalWagersStore {
  questionId: number | null;
  wagers: Record<string, number>;
}

interface UndoSnapshot {
  summary: string;
  scores: Record<string, number>;
  activeTurnTeamId: string;
  teamStreaks: Record<string, number>;
  previousRanks: Record<string, number>;
  teamBounties?: Record<string, number>;
  duelCredits?: Record<string, number>;
  bombCredits?: Record<string, number>;
  lastBountyClaim?: BountyClaimInfo | null;
}

interface PersistedStore {
  state: GameState;
  questions: QuestionItem[];
  secretChoices: SecretChoicesStore;
  undoSnapshot: UndoSnapshot | null;
  hostPin?: string;
  teamTokens?: Record<string, string>;
  mysterySlots?: string[];
  mysterySlotSentiments?: Record<string, 'GOOD' | 'BAD'>;
  teamTraps?: Record<string, TeamTrapPlacement[]>;
  finalWagers?: FinalWagersStore;
}

function generateTeamTokens(): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (let i = 1; i <= MAX_TEAMS; i++) {
    // 16 bytes = 32 hex chars = 128 bits of entropy (cryptographically secure)
    tokens[String(i)] = crypto.randomBytes(16).toString('hex').toUpperCase();
  }
  return tokens;
}

type StateListener = (state: GameState, questions?: QuestionItem[]) => void;

export const SAMPLE_QUESTIONS: QuestionItem[] = [
  {
    id: 1,
    round: 'الجولة 1',
    category: 'علوم',
    difficulty: 'سهل',
    question: 'ما هو الكوكب الأقرب إلى الشمس في مجموعتنا الشمسية؟',
    options: { A: 'عطارد', B: 'الزهرة', C: 'المريخ' },
    correct: 'A',
    explanation: 'رغم أن عطارد هو الأقرب إلى الشمس، فإن كوكب الزهرة هو الأشد حرارة بسبب غلافه الجوي الكثيف!',
  },
  {
    id: 2,
    round: 'الجولة 1',
    category: 'علوم',
    difficulty: 'متوسط',
    question: 'ما هو الرمز الكيميائي لعنصر الذهب في الجدول الدوري؟',
    options: { A: 'Ag', B: 'Au', C: 'Fe' },
    correct: 'B',
    explanation: 'يعود الرمز Au إلى الكلمة اللاتينية Aurum التي تعني الفجر الساطع.',
  },
  {
    id: 3,
    round: 'الجولة 1',
    category: 'علوم',
    difficulty: 'صعب',
    question: 'كم يستغرق ضوء الشمس تقريباً للوصول إلى سطح الأرض؟',
    options: { A: '8 دقائق و20 ثانية', B: 'ثانية واحدة', C: '45 دقيقة' },
    correct: 'A',
  },
  {
    id: 4,
    round: 'الجولة 1',
    category: 'تاريخ وحضارة',
    difficulty: 'سهل',
    question: 'في أي مدينة أُسّست جامعة القرويين، أقدم جامعة مستمرة في العالم؟',
    options: { A: 'القيروان', B: 'فاس', C: 'قرطبة' },
    correct: 'B',
    explanation: 'أسستها فاطمة الفهرية عام 859م في مدينة فاس المغربية وتعد أقدم جامعة عاملة حتى اليوم.',
  },
  {
    id: 5,
    round: 'الجولة 1',
    category: 'تاريخ وحضارة',
    difficulty: 'متوسط',
    question: 'من هو العالم المسلم الذي وضع أساس علم الجبر وسمّي باسمه الخوارزميات؟',
    options: { A: 'ابن الهيثم', B: 'ابن سينا', C: 'محمد بن موسى الخوارزمي' },
    correct: 'C',
  },
  {
    id: 6,
    round: 'الجولة 1',
    category: 'تاريخ وحضارة',
    difficulty: 'صعب',
    question: 'في أي عام هجري فُتحت القسطنطينية على يد السلطان محمد الفاتح؟',
    options: { A: '857 هـ', B: '790 هـ', C: '912 هـ' },
    correct: 'A',
  },
  {
    id: 7,
    round: 'الجولة 1',
    category: 'تقنية ومعرفة',
    difficulty: 'سهل',
    question: 'ما البروتوكول المستخدم لتأمين وتشفير تصفح المواقع عبر الإنترنت؟',
    options: { A: 'FTP', B: 'HTTPS', C: 'SMTP' },
    correct: 'B',
  },
  {
    id: 8,
    round: 'الجولة 1',
    category: 'تقنية ومعرفة',
    difficulty: 'متوسط',
    question: 'كم بت (Bit) يتكوّن منها البايت الواحد (Byte) في الأنظمة الرقمية القياسية؟',
    options: { A: '4 بت', B: '8 بت', C: '16 بت' },
    correct: 'B',
  },
  {
    id: 9,
    round: 'الجولة 1',
    category: 'تقنية ومعرفة',
    difficulty: 'صعب',
    question: 'ما اسم بنية الاتصال ثنائية الاتجاه الفورية التي تتيح مزامنة الخادم والعميل دون استطلاع متكرر؟',
    options: { A: 'WebSockets', B: 'Cookies', C: 'CronJob' },
    correct: 'A',
  },
  {
    id: 10,
    round: 'الجولة 2',
    category: 'علوم',
    difficulty: 'سهل',
    question: 'ما الغاز الأكثر وفرةً في الغلاف الجوي لكوكب الأرض؟',
    options: { A: 'الأكسجين', B: 'النيتروجين', C: 'ثاني أكسيد الكربون' },
    correct: 'B',
  },
  {
    id: 11,
    round: 'الجولة 2',
    category: 'علوم',
    difficulty: 'متوسط',
    question: 'أي عضو في جسم الإنسان يستهلك النسبة الأعلى من الأكسجين والطاقة مقارنةً بوزنه؟',
    options: { A: 'الدماغ', B: 'الكبد', C: 'القلب' },
    correct: 'A',
  },
  {
    id: 12,
    round: 'الجولة 2',
    category: 'علوم',
    difficulty: 'صعب',
    question: 'ما الوحدة الدولية لقياس شدة التيار الكهربائي؟',
    options: { A: 'الفولت', B: 'الأوم', C: 'الأمبير' },
    correct: 'C',
  },
  {
    id: 13,
    round: 'الجولة 2',
    category: 'تاريخ وحضارة',
    difficulty: 'سهل',
    question: 'أيّ دولة عربية تُلقّب بأرض الكنانة؟',
    options: { A: 'العراق', B: 'مصر', C: 'اليمن' },
    correct: 'B',
  },
  {
    id: 14,
    round: 'الجولة 2',
    category: 'تاريخ وحضارة',
    difficulty: 'متوسط',
    question: 'من هو مؤسس علم الاجتماع ومؤلف كتاب المقدمة الشهير؟',
    options: { A: 'ابن خلدون', B: 'ابن رشد', C: 'الفارابي' },
    correct: 'A',
  },
  {
    id: 15,
    round: 'الجولة 2',
    category: 'تاريخ وحضارة',
    difficulty: 'صعب',
    question: 'ما اسم المرصد الفلكي الشهير الذي بناه المأمون في بغداد ودمشق لقياس محيط الأرض؟',
    options: { A: 'دار الحكمة', B: 'مرصد الشماسية', C: 'مرصد سمرقند' },
    correct: 'B',
  },
  {
    id: 16,
    round: 'الجولة 2',
    category: 'تقنية ومعرفة',
    difficulty: 'سهل',
    question: 'ما اللغة الأساسية المسؤولة عن تنسيق الألوان والخطوط وتخطيط صفحات الويب؟',
    options: { A: 'CSS', B: 'SQL', C: 'Python' },
    correct: 'A',
  },
  {
    id: 17,
    round: 'الجولة 2',
    category: 'تقنية ومعرفة',
    difficulty: 'متوسط',
    question: 'ما المصطلح الذي يشير إلى ذاكرة الوصول العشوائي المؤقتة السريعة في الحاسوب؟',
    options: { A: 'SSD', B: 'RAM', C: 'BIOS' },
    correct: 'B',
  },
  {
    id: 18,
    round: 'الجولة 2',
    category: 'تقنية ومعرفة',
    difficulty: 'صعب',
    question: 'في علم التشفير، ماذا تعني خوارزمية الهاش (Hash Function)؟',
    options: {
      A: 'ضغط الصور دون فقدان جودة',
      B: 'تحويل بيانات بأي طول إلى بصمة رقمية ثابتة الطول',
      C: 'تسريع معالجات الرسوميات ثلاثية الأبعاد',
    },
    correct: 'B',
  },
];

function cleanArabicLabel(value: unknown, fallback = ''): string {
  const cleaned = String(value ?? '')
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function normalizeDifficulty(rawDiff: unknown): DifficultyLevel {
  const d = cleanArabicLabel(rawDiff, '').toLowerCase();
  if (d === 'صعب' || d === 'صعبة' || d === 'hard' || d === '3') return 'صعب';
  if (d === 'متوسط' || d === 'متوسطة' || d === 'medium' || d === '2') return 'متوسط';
  return 'سهل';
}

function normalizeOption(rawOpt: unknown): OptionLetter {
  const o = cleanArabicLabel(rawOpt, 'A').toUpperCase();
  if (o === 'B' || o === 'C') return o;
  return 'A';
}

function sanitizeMediaUrl(raw: unknown): string | undefined {
  const val = String(raw ?? '').trim();
  if (!val) return undefined;
  if (/^https?:\/\//i.test(val)) return val;
  if (val.startsWith('/') && !val.startsWith('//')) return val;
  return undefined;
}

function buildDefaultStreaks(): Record<string, number> {
  const streaks: Record<string, number> = {};
  for (let i = 1; i <= MAX_TEAMS; i++) {
    streaks[String(i)] = 0;
  }
  return streaks;
}

function buildDefaultCredits(initialValue = 1): Record<string, number> {
  const credits: Record<string, number> = {};
  for (let i = 1; i <= MAX_TEAMS; i++) {
    credits[String(i)] = initialValue;
  }
  return credits;
}

function computeBountyForStreak(streak: number): number {
  if (streak >= 5) return 150;
  if (streak >= 3) return 100;
  return 0;
}

function computeStreakMultiplier(streak: number): number {
  if (streak >= 5) return 1.5;
  if (streak >= 3) return 1.25;
  return 1;
}

function syncTeamBounties(streaks: Record<string, number>): Record<string, number> {
  const bounties: Record<string, number> = {};
  for (let i = 1; i <= MAX_TEAMS; i++) {
    const id = String(i);
    bounties[id] = computeBountyForStreak(Number(streaks[id]) || 0);
  }
  return bounties;
}

function countTotalTraps(teamTraps?: Record<string, TeamTrapPlacement[]>): number {
  if (!teamTraps || typeof teamTraps !== 'object') return 0;
  let total = 0;
  for (const list of Object.values(teamTraps)) {
    if (Array.isArray(list)) total += list.length;
  }
  return total;
}

function getTrapMeta(
  type: TrapType,
  ownerName: string,
  triggeredByName: string,
  status: 'DETONATED' | 'DISARMED_SELF'
): { title: string; desc: string } {
  if (status === 'DISARMED_SELF') {
    return {
      title: '🛡️ كمين مُبطل — وقعتم في كمينكم الخاص!',
      desc: `فتح فريق (${triggeredByName}) خانة كمينه السري فتلاشى الكمين دون أي ضرر.`,
    };
  }
  if (type === 'STEAL_TRAP') {
    return {
      title: '🕳️ كمين السلب انطلق!',
      desc: `زرعه فريق (${ownerName})! إذا أخطأ المنافس ينتقل نصف نقاط السؤال لصاحب الكمين.`,
    };
  }
  if (type === 'HALF_TIME_TRAP') {
    return {
      title: '⏱️ كمين نصف الوقت انطلق!',
      desc: `زرعه فريق (${ownerName})! تم تقليص مؤقت هذا السؤال إلى النصف فوراً.`,
    };
  }
  if (type === 'SILENCE_POWERUPS_TRAP') {
    return {
      title: '🔇 كمين قفل الأدوات انطلق!',
      desc: `زرعه فريق (${ownerName})! جميع الأدوات التكتيكية مقفلة في هذا السؤال.`,
    };
  }
  return {
    title: '⚠️ كمين الخصم المضاعف انطلق!',
    desc: `زرعه فريق (${ownerName})! الإجابة الخاطئة ستخصم نصف نقاط السؤال أو ضعف الغرامة.`,
  };
}

function captureRanks(scores: Record<string, number>, teamCount: number): Record<string, number> {
  const count = Math.min(MAX_TEAMS, Math.max(2, Number(teamCount) || 4));
  const ranks: Record<string, number> = {};
  for (let i = 1; i <= count; i++) {
    const id = String(i);
    const myScore = Number(scores[id]) || 0;
    let higherCount = 0;
    for (let j = 1; j <= count; j++) {
      if ((Number(scores[String(j)]) || 0) > myScore) {
        higherCount++;
      }
    }
    ranks[id] = higherCount + 1;
  }
  return ranks;
}

function buildBalancedMysterySlots(
  questions: QuestionItem[],
  selectedRound = 'ALL'
): { slots: string[]; sentiments: Record<string, 'GOOD' | 'BAD'> } {
  const roundFilter = cleanArabicLabel(selectedRound, 'ALL');
  const slotSet = new Set<string>();
  for (const q of questions) {
    const qRound = cleanArabicLabel(q.round, 'الجولة 1');
    if (roundFilter !== 'ALL' && qRound !== roundFilter) continue;
    const cat = cleanArabicLabel(q.category, 'عام');
    const diff = normalizeDifficulty(q.difficulty);
    slotSet.add(`${cat}|||${diff}`);
  }
  const slots = Array.from(slotSet);
  if (slots.length === 0) return { slots: [], sentiments: {} };
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  const targetCount =
    slots.length >= 8 ? 6 : slots.length >= 4 ? 4 : slots.length >= 2 ? 2 : slots.length;
  const chosen = slots.slice(0, targetCount);
  const sentimentList: Array<'GOOD' | 'BAD'> = [];
  for (let i = 0; i < chosen.length; i++) {
    sentimentList.push(i % 2 === 0 ? 'GOOD' : 'BAD');
  }
  for (let i = sentimentList.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [sentimentList[i], sentimentList[j]] = [sentimentList[j], sentimentList[i]];
  }
  const sentiments: Record<string, 'GOOD' | 'BAD'> = {};
  chosen.forEach((slotKey, idx) => {
    sentiments[slotKey] = sentimentList[idx];
  });
  return { slots: chosen, sentiments };
}

export function getDefaultSettings(): GameSettings {
  return {
    playMode: 'BOARD',
    defaultAnswerMode: 'BUZZER',
    teamCount: 4,
    team1Name: 'فرسان المعرفة',
    team2Name: 'صقور التحدي',
    team3Name: 'رواد الفضاء',
    team4Name: 'نجوم القمة',
    team5Name: 'أبطال النخبة',
    team6Name: 'صناع المجد',
    team7Name: 'عباقرة العصر',
    team8Name: 'نسور الميدان',
    timerSeconds: 25,
    answerSeconds: 7,
    pointsEasy: 100,
    pointsMedium: 200,
    pointsHard: 300,
    pointsWrongPenalty: 0,
    powerUpsEnabled: true,
    puShieldCount: 1,
    puAiCount: 1,
    puDoubleCount: 1,
    puFreezeCount: 1,
    puStealCount: 1,
    puTimeCount: 1,
    fontPair: 'cairo-almarai',
  };
}

function getEmptyEffects(): ActiveEffects {
  return {
    shieldTeams: [],
    doubleTeams: [],
    stealTargets: {},
    eliminatedOptions: [],
    frozenTeams: {},
    lastPowerUpBanner: null,
  };
}

function getDefaultMatchStats(): MatchStats {
  return {
    questionsPlayed: 0,
    buzzerHits: 0,
    secretVotesTotal: 0,
    fastestTeamName: '',
    fastestMs: 0,
  };
}

function buildPowerUpsQuota(settings: GameSettings): Record<string, TeamPowerUps> {
  const powerUps: Record<string, TeamPowerUps> = {};
  for (let i = 1; i <= MAX_TEAMS; i++) {
    powerUps[String(i)] = {
      shield: Math.max(0, Number(settings.puShieldCount ?? 1)),
      ai: Math.max(0, Number(settings.puAiCount ?? 1)),
      double: Math.max(0, Number(settings.puDoubleCount ?? 1)),
      freeze: Math.max(0, Number(settings.puFreezeCount ?? 1)),
      steal: Math.max(0, Number(settings.puStealCount ?? 1)),
      time: Math.max(0, Number(settings.puTimeCount ?? 1)),
    };
  }
  return powerUps;
}

function buildBoardMatrix(
  questions: QuestionItem[],
  usedQuestionIds: number[],
  selectedRound: string
): BoardMatrix {
  const usedSet = new Set(usedQuestionIds.map(Number));
  const roundFilter = cleanArabicLabel(selectedRound, 'ALL');
  const matrix: BoardMatrix = {};

  for (const q of questions) {
    const qRound = cleanArabicLabel(q.round, 'الجولة 1');
    if (roundFilter !== 'ALL' && qRound !== roundFilter) continue;

    const cat = cleanArabicLabel(q.category, 'عام');
    const diff = normalizeDifficulty(q.difficulty);
    if (!matrix[cat]) {
      matrix[cat] = { 'سهل': 0, 'متوسط': 0, 'صعب': 0 };
    }
    if (!usedSet.has(Number(q.id))) {
      matrix[cat][diff]++;
    }
  }
  return matrix;
}

function buildFreshState(settings: GameSettings, questions: QuestionItem[]): GameState {
  const scores: Record<string, number> = {};
  for (let i = 1; i <= MAX_TEAMS; i++) {
    scores[String(i)] = 0;
  }
  const isBoardBased = settings.playMode === 'BOARD' || settings.playMode === 'AUTO_CATEGORY';
  const now = Date.now();

  return {
    stateRevision: 1,
    stateTimestamp: now,
    serverNow: now,
    fsmState: isBoardBased ? 'CATEGORY_BOARD' : 'WAITING_LOBBY',
    answerMode: settings.defaultAnswerMode === 'CHOICE' ? 'CHOICE' : 'BUZZER',
    activeTheme: 'luxury',
    customTokens: {},
    settings,
    questionsVersion: 1,
    totalQuestionsCount: questions.length,
    boardMatrix: buildBoardMatrix(questions, [], 'ALL'),
    activeTurnTeamId: '1',
    selectedRound: 'ALL',
    selectedCategory: null,
    selectedDifficulty: null,
    usedQuestionIds: [],
    currentRoundLabel: 'جميع الجولات',
    currentQuestion: null,
    questionInstanceId: null,
    questionStartedAt: null,
    currentQuestionPoints: Number(settings.pointsEasy) || 100,
    questionEndTime: null,
    answerEndTime: null,
    pausedRemaining: Number(settings.timerSeconds) || 25,
    pausedAnswerRemaining: Math.min(9, Math.max(3, Number(settings.answerSeconds) || 7)),
    isTimerPaused: false,
    autoTransitionAction: null,
    autoTransitionAt: null,
    lockedTeamId: null,
    timedOutTeamId: null,
    attemptedTeamsThisQuestion: [],
    votedTeams: [],
    revealedChoices: null,
    eliminatedTeams: [],
    lastEliminatedTeam: null,
    lastStealSummary: null,
    refereeNotice: null,
    boardNotice: null,
    scores,
    powerUps: buildPowerUpsQuota(settings),
    activeEffects: getEmptyEffects(),
    canUndoEvaluation: false,
    undoSummary: '',
    matchStats: getDefaultMatchStats(),
    hostPinEnabled: false,
    hostAuthRevision: 1,
    teamTokensVersion: 1,
    activeMysteryTwist: null,
    teamStreaks: buildDefaultStreaks(),
    previousRanks: {},
    finalCategoryLabel: null,
    finalWageredTeams: [],
    finalMinWager: 50,
    finalResults: null,
    trapSetupReadyTeams: [],
    totalActiveTrapsCount: 0,
    activeTrapTrigger: null,
    teamBounties: syncTeamBounties(buildDefaultStreaks()),
    lastBountyClaim: null,
    duelCredits: buildDefaultCredits(1),
    armedDuel: null,
    activeDuel: null,
    bombCredits: buildDefaultCredits(1),
    activeBomb: null,
    powerUpsLockedThisQuestion: false,
  };
}

export class TriviaEngine {
  private store: PersistedStore;
  private persistence: TriviaPersistence;
  private listeners = new Set<StateListener>();
  private answerTimerHandle: ReturnType<typeof setTimeout> | null = null;
  private choiceTimerHandle: ReturnType<typeof setTimeout> | null = null;
  private finalTimerHandle: ReturnType<typeof setTimeout> | null = null;
  private transitionTimerHandle: ReturnType<typeof setTimeout> | null = null;
  private commitMutex: Promise<void> = Promise.resolve();

  constructor() {
    this.persistence = new TriviaPersistence();
    this.store = this.persistence.loadFullStore();
    this.rearmTimersOnStartup();
  }

  // ─── Atomic Commit with Mutex ────────────────────────────────────────

  private async commitAndBroadcast(includeQuestions = false): Promise<void> {
    // Serialize commits to avoid race conditions
    this.commitMutex = this.commitMutex.then(() => this.doCommitAndBroadcast(includeQuestions));
    await this.commitMutex;
  }

  private doCommitAndBroadcast(includeQuestions = false): void {
    const s = this.store.state;
    const now = Date.now();
    s.stateRevision = (Number(s.stateRevision) || 0) + 1;
    s.stateTimestamp = now;
    s.serverNow = now;
    s.canUndoEvaluation = Boolean(this.store.undoSnapshot);
    s.undoSummary = this.store.undoSnapshot ? this.store.undoSnapshot.summary : '';
    s.boardMatrix = buildBoardMatrix(this.store.questions, s.usedQuestionIds, s.selectedRound);
    s.totalQuestionsCount = this.store.questions.length;
    s.totalActiveTrapsCount = countTotalTraps(this.store.teamTraps);
    s.teamBounties = syncTeamBounties(s.teamStreaks);

    // Persist to SQLite (atomic transaction)
    this.persistence.saveFullStore(this.store);

    const safeState = this.getSanitizedState();
    const safeQuestions = includeQuestions ? this.getStrippedQuestions() : undefined;
    for (const listener of this.listeners) {
      try {
        listener(safeState, safeQuestions);
      } catch (err) {
        console.error('Broadcast listener error:', err);
      }
    }
  }

  // ─── Public API for shutdown ────────────────────────────────────────

  public shutdown(): void {
    this.clearAllScheduledTimers();
    this.persistence.close();
  }

  private rearmTimersOnStartup(): void {
    const s = this.store.state;
    const now = Date.now();
    if (!s.isTimerPaused) {
      if (s.fsmState === 'BUZZER_LOCKED' && s.answerEndTime) {
        this.scheduleAnswerTimeout(Math.max(100, s.answerEndTime - now));
      } else if (s.fsmState === 'QUESTION_ACTIVE' && s.answerMode === 'CHOICE' && s.questionEndTime) {
        this.scheduleChoiceRevealTimeout(Math.max(100, s.questionEndTime - now));
      } else if (s.fsmState === 'FINAL_QUESTION_ACTIVE' && s.questionEndTime) {
        this.scheduleFinalRevealTimeout(Math.max(100, s.questionEndTime - now));
      }
    }
    if (s.autoTransitionAction && s.autoTransitionAt) {
      this.scheduleAutoTransition(Math.max(100, s.autoTransitionAt - now));
    }
  }

  private clearAllScheduledTimers(): void {
    if (this.answerTimerHandle) {
      clearTimeout(this.answerTimerHandle);
      this.answerTimerHandle = null;
    }
    if (this.choiceTimerHandle) {
      clearTimeout(this.choiceTimerHandle);
      this.choiceTimerHandle = null;
    }
    if (this.finalTimerHandle) {
      clearTimeout(this.finalTimerHandle);
      this.finalTimerHandle = null;
    }
    if (this.transitionTimerHandle) {
      clearTimeout(this.transitionTimerHandle);
      this.transitionTimerHandle = null;
    }
  }

  private scheduleAnswerTimeout(delayMs: number): void {
    if (this.answerTimerHandle) clearTimeout(this.answerTimerHandle);
    this.answerTimerHandle = setTimeout(() => {
      this.answerTimerHandle = null;
      this.triggerAnswerTimeoutInternal();
    }, Math.max(50, delayMs));
  }

  private scheduleChoiceRevealTimeout(delayMs: number): void {
    if (this.choiceTimerHandle) clearTimeout(this.choiceTimerHandle);
    this.choiceTimerHandle = setTimeout(() => {
      this.choiceTimerHandle = null;
      this.revealSecretChoicesInternal();
    }, Math.max(50, delayMs));
  }

  private scheduleFinalRevealTimeout(delayMs: number): void {
    if (this.finalTimerHandle) clearTimeout(this.finalTimerHandle);
    this.finalTimerHandle = setTimeout(() => {
      this.finalTimerHandle = null;
      this.revealFinalResultsInternal();
    }, Math.max(50, delayMs));
  }

  private scheduleAutoTransition(delayMs: number): void {
    if (this.transitionTimerHandle) clearTimeout(this.transitionTimerHandle);
    this.transitionTimerHandle = setTimeout(() => {
      this.transitionTimerHandle = null;
      this.executeScheduledTransitionInternal();
    }, Math.max(50, delayMs));
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private commitAndBroadcast(includeQuestions = false): void {
    const s = this.store.state;
    const now = Date.now();
    s.stateRevision = (Number(s.stateRevision) || 0) + 1;
    s.stateTimestamp = now;
    s.serverNow = now;
    s.canUndoEvaluation = Boolean(this.store.undoSnapshot);
    s.undoSummary = this.store.undoSnapshot ? this.store.undoSnapshot.summary : '';
    s.boardMatrix = buildBoardMatrix(this.store.questions, s.usedQuestionIds, s.selectedRound);
    s.totalQuestionsCount = this.store.questions.length;
    s.totalActiveTrapsCount = countTotalTraps(this.store.teamTraps);
    s.teamBounties = syncTeamBounties(s.teamStreaks);

    this.saveStoreToDisk();

    const safeState = this.getSanitizedState();
    const safeQuestions = includeQuestions ? this.getStrippedQuestions() : undefined;
    for (const listener of this.listeners) {
      try {
        listener(safeState, safeQuestions);
      } catch (err) {
        console.error('Broadcast listener error:', err);
      }
    }
  }

  public getSanitizedState(): GameState {
    const clone = JSON.parse(JSON.stringify(this.store.state)) as GameState;
    clone.serverNow = Date.now();

    const canRevealCorrect =
      clone.fsmState === 'ANSWER_CORRECT' ||
      clone.fsmState === 'ANSWER_WRONG' ||
      clone.fsmState === 'CHOICE_REVEALED' ||
      clone.fsmState === 'FINAL_REVEALED';

    if (clone.currentQuestion && !canRevealCorrect) {
      delete clone.currentQuestion.correct;
      delete clone.currentQuestion.explanation;
    }

    if (clone.fsmState !== 'CHOICE_REVEALED') {
      clone.revealedChoices = null;
    }

    if (clone.fsmState !== 'FINAL_REVEALED') {
      clone.finalResults = null;
    }

    clone.canUndoEvaluation = Boolean(this.store.undoSnapshot);
    clone.undoSummary = this.store.undoSnapshot ? this.store.undoSnapshot.summary : '';
    clone.hostPinEnabled = Boolean(cleanArabicLabel(this.store.hostPin, ''));
    clone.hostAuthRevision = Number(this.store.state.hostAuthRevision) || 1;
    clone.teamTokensVersion = Number(this.store.state.teamTokensVersion) || 1;
    return clone;
  }

  private isValidTeamToken(teamId: string, providedToken: unknown): boolean {
    const teamNum = Number(teamId);
    const activeCount = Math.min(MAX_TEAMS, Math.max(2, Number(this.store.state.settings.teamCount) || 4));
    if (!Number.isInteger(teamNum) || teamNum < 1 || teamNum > activeCount) {
      return false;
    }
    const tokens = this.store.teamTokens || {};
    const expected = tokens[String(teamNum)];
    if (!expected || typeof providedToken !== 'string') return false;
    return providedToken.trim().toUpperCase() === expected.toUpperCase();
  }

  public verifyTeamToken(teamId: string, providedToken: string): VerifyTeamTokenResponse {
    const cleanId = String(teamId || '').trim();
    if (!this.isValidTeamToken(cleanId, providedToken)) {
      return {
        status: 'INVALID_TOKEN',
        valid: false,
        message: '🔒 رابط الفريق غير صالح أو منتهي الصلاحية — يرجى مسح رمز الباركود الخاص بفريقك من شاشة المقدم',
      };
    }
    return {
      status: 'OK',
      valid: true,
      teamId: cleanId,
    };
  }

  public getTeamTraps(teamId: string, providedToken: string): TeamTrapsResponse {
    const cleanId = String(teamId || '').trim();
    if (!this.isValidTeamToken(cleanId, providedToken)) {
      return {
        status: 'INVALID_TOKEN',
        message: '🔒 رابط الفريق غير صالح — امسح الباركود الخاص بفريقك',
      };
    }
    const list = this.store.teamTraps?.[cleanId] || [];
    return {
      status: 'OK',
      traps: list.map((t) => ({ ...t })),
      ready: this.store.state.trapSetupReadyTeams.includes(cleanId),
      maxTraps: MAX_TRAPS_PER_TEAM,
    };
  }

  public getHostTeamTokens(): HostTeamTokensResponse {
    if (!this.store.teamTokens) {
      this.store.teamTokens = generateTeamTokens();
      this.saveStoreToDisk();
    }
    return {
      status: 'OK',
      teamTokens: { ...this.store.teamTokens },
      teamTokensVersion: Number(this.store.state.teamTokensVersion) || 1,
    };
  }

  public getHostAnswers(providedPin?: string): HostAnswersResponse {
    const requiredPin = cleanArabicLabel(this.store.hostPin, '');
    const attemptPin = cleanArabicLabel(providedPin, '');
    if (requiredPin && attemptPin !== requiredPin) {
      return {
        status: 'INVALID_PIN',
        message: '❌ رمز حماية المذيع غير صحيح',
      };
    }

    const answers: Record<number, OptionLetter> = {};
    for (const q of this.store.questions) {
      answers[Number(q.id)] = normalizeOption(q.correct);
    }

    return {
      status: 'OK',
      answers,
      hostAuthRevision: Number(this.store.state.hostAuthRevision) || 1,
    };
  }

  public getStrippedQuestions(): QuestionItem[] {
    return this.store.questions.map((q) => {
      const img = sanitizeMediaUrl(q.imageUrl);
      const aud = sanitizeMediaUrl(q.audioUrl);
      return {
        id: q.id,
        round: q.round,
        category: q.category,
        difficulty: q.difficulty,
        question: q.question,
        options: { ...q.options },
        ...(img ? { imageUrl: img } : {}),
        ...(aud ? { audioUrl: aud } : {}),
      };
    });
  }

  private getTeamName(teamId: string): string {
    const settings = this.store.state.settings as unknown as Record<string, unknown>;
    const key = `team${teamId}Name`;
    return String(settings[key] || `فريق ${teamId}`);
  }

  private getPointsForDifficulty(diff: DifficultyLevel): number {
    const s = this.store.state.settings;
    if (diff === 'صعب') return Number(s.pointsHard) || 300;
    if (diff === 'متوسط') return Number(s.pointsMedium) || 200;
    return Number(s.pointsEasy) || 100;
  }

  private computeNextTurnTeamId(): string {
    const s = this.store.state;
    const count = Number(s.settings.teamCount) || 4;
    const eliminated = s.eliminatedTeams || [];
    const current = Number(s.activeTurnTeamId) || 1;
    for (let step = 1; step <= count; step++) {
      const candidate = String(((current - 1 + step) % count) + 1);
      if (!eliminated.includes(candidate)) return candidate;
    }
    return '1';
  }

  private findLeadingTeamId(excludeTeamId: string): string | null {
    const s = this.store.state;
    const count = Number(s.settings.teamCount) || 4;
    let bestTeam: string | null = null;
    let maxScore = 0;
    for (let i = 1; i <= count; i++) {
      const id = String(i);
      if (id === excludeTeamId) continue;
      if (s.eliminatedTeams.includes(id)) continue;
      const sc = Number(s.scores[id]) || 0;
      if (sc > maxScore) {
        maxScore = sc;
        bestTeam = id;
      }
    }
    return bestTeam;
  }

  private launchQuestionInternal(
    questionObj: QuestionItem,
    twistOverride: MysteryTwistInfo | null = null,
    trapOverride: ActiveTrapTrigger | null = null,
    duelOverride: ActiveDuelInfo | null = null
  ): ActionResponse {
    this.clearAllScheduledTimers();
    const s = this.store.state;
    const now = Date.now();
    const baseDuration = Math.max(5, Number(s.settings.timerSeconds) || 25);
    const shouldHalveTime =
      (trapOverride?.status === 'DETONATED' && trapOverride.type === 'HALF_TIME_TRAP') ||
      twistOverride?.type === 'BLITZ_HALF_TIME';
    const duration = shouldHalveTime ? Math.max(7, Math.ceil(baseDuration / 2)) : baseDuration;
    const ansDefault = Math.min(9, Math.max(3, Number(s.settings.answerSeconds) || 7));
    const qId = Number(questionObj.id);
    if (!s.usedQuestionIds.includes(qId)) {
      s.usedQuestionIds.push(qId);
    }

    const normDiff = normalizeDifficulty(questionObj.difficulty);
    const instanceId = `${qId}_${now}`;
    const img = sanitizeMediaUrl(questionObj.imageUrl);
    const aud = sanitizeMediaUrl(questionObj.audioUrl);
    const expl = cleanArabicLabel(questionObj.explanation, '');

    s.fsmState = 'QUESTION_ACTIVE';
    s.currentQuestion = {
      id: qId,
      round: cleanArabicLabel(questionObj.round, 'الجولة 1'),
      category: cleanArabicLabel(questionObj.category, 'عام'),
      difficulty: normDiff,
      question: questionObj.question,
      options: { ...questionObj.options },
      correct: normalizeOption(questionObj.correct),
      ...(img ? { imageUrl: img } : {}),
      ...(aud ? { audioUrl: aud } : {}),
      ...(expl ? { explanation: expl } : {}),
    };
    s.questionInstanceId = instanceId;
    s.questionStartedAt = now;
    s.currentRoundLabel = s.currentQuestion.round;
    let pts = this.getPointsForDifficulty(normDiff);
    if (twistOverride?.type === 'DOUBLE_POINTS') {
      pts = pts * 2;
    }
    if (duelOverride) {
      pts = Math.round(pts * (Number(duelOverride.multiplier) || 1.5));
    }
    s.currentQuestionPoints = pts;
    s.activeMysteryTwist = twistOverride;
    s.activeTrapTrigger = trapOverride;
    s.activeDuel = duelOverride;
    s.armedDuel = null;
    s.activeBomb = null;
    s.powerUpsLockedThisQuestion =
      (trapOverride?.status === 'DETONATED' && trapOverride.type === 'SILENCE_POWERUPS_TRAP') ||
      twistOverride?.type === 'POWERUP_BLACKOUT';
    s.finalCategoryLabel = null;
    s.finalWageredTeams = [];
    s.finalResults = null;
    s.lockedTeamId = null;
    s.timedOutTeamId = null;
    s.attemptedTeamsThisQuestion = [];
    s.votedTeams = [];
    s.revealedChoices = null;
    s.lastStealSummary = null;
    s.boardNotice = null;
    s.autoTransitionAction = null;
    s.autoTransitionAt = null;
    s.isTimerPaused = false;
    s.pausedRemaining = duration;
    s.pausedAnswerRemaining = ansDefault;
    s.questionEndTime = now + duration * 1000;
    s.answerEndTime = null;
    s.activeEffects = getEmptyEffects();
    s.matchStats.questionsPlayed = (Number(s.matchStats.questionsPlayed) || 0) + 1;

    this.store.secretChoices = { questionInstanceId: instanceId, choices: {} };

    if (s.answerMode === 'CHOICE') {
      this.scheduleChoiceRevealTimeout(duration * 1000);
    }

    this.commitAndBroadcast();
    return { status: 'OK', state: this.getSanitizedState() };
  }

  private launchNextAutoQuestionInternal(): ActionResponse {
    const s = this.store.state;
    const allQ = this.store.questions;
    const used = new Set(s.usedQuestionIds.map(Number));
    const activeRound = cleanArabicLabel(s.selectedRound, 'ALL');
    const selCat = s.selectedCategory ? cleanArabicLabel(s.selectedCategory, '') : null;
    const selDiff = s.selectedDifficulty ? normalizeDifficulty(s.selectedDifficulty) : null;

    let nextQ: QuestionItem | undefined;

    if (selCat && selDiff) {
      nextQ = allQ.find(
        (q) =>
          !used.has(Number(q.id)) &&
          (activeRound === 'ALL' || cleanArabicLabel(q.round, 'الجولة 1') === activeRound) &&
          cleanArabicLabel(q.category, 'عام') === selCat &&
          normalizeDifficulty(q.difficulty) === selDiff
      );

      if (!nextQ) {
        this.clearAllScheduledTimers();
        s.fsmState = 'CATEGORY_BOARD';
        s.currentQuestion = null;
        s.questionInstanceId = null;
        s.lockedTeamId = null;
        s.timedOutTeamId = null;
        s.autoTransitionAction = null;
        s.autoTransitionAt = null;
        s.boardNotice = `اكتملت أسئلة (${selCat} - ${selDiff})! اختر فئة وصعوبة جديدة.`;
        s.selectedCategory = null;
        s.selectedDifficulty = null;
        this.commitAndBroadcast();
        return { status: 'SLOT_EXHAUSTED', state: this.getSanitizedState() };
      }
    } else {
      nextQ = allQ.find(
        (q) =>
          !used.has(Number(q.id)) &&
          (activeRound === 'ALL' || cleanArabicLabel(q.round, 'الجولة 1') === activeRound)
      );

      if (!nextQ) {
        this.clearAllScheduledTimers();
        if (allQ.length === 0) {
          s.fsmState = 'CATEGORY_BOARD';
          s.boardNotice = 'قاعدة الأسئلة فارغة حالياً؛ أضف أسئلة من استوديو الإعدادات.';
        } else {
          s.fsmState = 'CELEBRATION_PODIUM';
        }
        s.currentQuestion = null;
        s.autoTransitionAction = null;
        s.autoTransitionAt = null;
        this.commitAndBroadcast();
        return { status: 'FINISHED', state: this.getSanitizedState() };
      }
    }

    return this.launchQuestionInternal(nextQ);
  }

  private executeScheduledTransitionInternal(): ActionResponse {
    const s = this.store.state;
    if (!s.autoTransitionAction) {
      return { status: 'NO_ACTION', state: this.getSanitizedState() };
    }
    const action = s.autoTransitionAction;
    s.autoTransitionAction = null;
    s.autoTransitionAt = null;

    if (action === 'RETURN_TO_BOARD') {
      this.clearAllScheduledTimers();
      s.fsmState = 'CATEGORY_BOARD';
      s.currentQuestion = null;
      s.questionInstanceId = null;
      s.questionEndTime = null;
      s.answerEndTime = null;
      s.lockedTeamId = null;
      s.timedOutTeamId = null;
      s.attemptedTeamsThisQuestion = [];
      s.votedTeams = [];
      s.revealedChoices = null;
      s.selectedCategory = null;
      s.selectedDifficulty = null;
      s.isTimerPaused = false;
      s.activeEffects = getEmptyEffects();
      s.activeMysteryTwist = null;
      s.activeTrapTrigger = null;
      s.activeDuel = null;
      s.activeBomb = null;
      s.powerUpsLockedThisQuestion = false;
      this.commitAndBroadcast();
      return { status: 'OK', state: this.getSanitizedState() };
    }

    return this.launchNextAutoQuestionInternal();
  }

  private triggerAnswerTimeoutInternal(): ActionResponse {
    const s = this.store.state;
    if (s.fsmState !== 'BUZZER_LOCKED' || s.isTimerPaused) {
      return { status: 'NO_ACTION', state: this.getSanitizedState() };
    }
    const timedOutId = s.lockedTeamId;
    if (timedOutId && !s.attemptedTeamsThisQuestion.includes(timedOutId)) {
      s.attemptedTeamsThisQuestion.push(timedOutId);
    }
    s.fsmState = 'ANSWER_TIMEOUT';
    s.timedOutTeamId = timedOutId;
    s.lockedTeamId = null;
    s.answerEndTime = null;
    this.commitAndBroadcast();
    return { status: 'OK', state: this.getSanitizedState() };
  }

  private revealSecretChoicesInternal(): ActionResponse {
    const s = this.store.state;
    if (s.fsmState === 'CHOICE_REVEALED') {
      return { status: 'ALREADY_REVEALED', state: this.getSanitizedState() };
    }
    if (!s.currentQuestion || s.answerMode !== 'CHOICE' || s.fsmState !== 'QUESTION_ACTIVE') {
      return { status: 'INVALID_STATE', message: 'لا يوجد تصويت سري نشط للكشف عنه', state: this.getSanitizedState() };
    }

    if (this.choiceTimerHandle) {
      clearTimeout(this.choiceTimerHandle);
      this.choiceTimerHandle = null;
    }

    this.store.undoSnapshot = {
      summary: `التراجع عن كشف التصويت الجماعي لسؤال #${s.currentQuestion.id}`,
      scores: { ...s.scores },
      activeTurnTeamId: s.activeTurnTeamId,
      teamStreaks: { ...s.teamStreaks },
      previousRanks: { ...s.previousRanks },
      teamBounties: { ...s.teamBounties },
      duelCredits: { ...s.duelCredits },
      bombCredits: { ...s.bombCredits },
      lastBountyClaim: s.lastBountyClaim ? { ...s.lastBountyClaim } : null,
    };

    const secretMap =
      this.store.secretChoices.questionInstanceId === s.questionInstanceId
        ? this.store.secretChoices.choices
        : {};

    const correctOpt = normalizeOption(s.currentQuestion.correct);
    const basePts = Number(s.currentQuestionPoints) || Number(s.settings.pointsEasy) || 100;
    const penaltyPts = Number(s.settings.pointsWrongPenalty) || 0;
    const noPenaltyTwist = s.activeMysteryTwist?.type === 'NO_PENALTY';
    const hasHeavyTrapPenalty =
      s.activeTrapTrigger?.status === 'DETONATED' && s.activeTrapTrigger.type === 'DOUBLE_PENALTY_TRAP';
    const hasCursedPenalty = s.activeMysteryTwist?.type === 'CURSED_PENALTY';
    const teamCount = Number(s.settings.teamCount) || 4;
    s.previousRanks = captureRanks(s.scores, teamCount);

    const results: Record<string, RevealedTeamResult> = {};
    let winnersCount = 0;
    const now = Date.now();
    const winnersIds: string[] = [];

    for (let i = 1; i <= teamCount; i++) {
      const id = String(i);
      if (s.eliminatedTeams.includes(id)) continue;

      const entry = secretMap[id];
      const picked = entry ? entry.option : null;
      const currentScore = Number(s.scores[id]) || 0;

      if (!picked) {
        s.teamStreaks[id] = 0;
        results[id] = { option: null, status: 'NO_VOTE', delta: 0, score: currentScore };
        continue;
      }

      if (picked === correctOpt) {
        const nextStreak = (Number(s.teamStreaks[id]) || 0) + 1;
        const mult = s.activeEffects.doubleTeams.includes(id) ? 2 : 1;
        const streakMult = computeStreakMultiplier(nextStreak);
        const earned = Math.round(basePts * mult * streakMult);
        s.scores[id] = currentScore + earned;
        s.teamStreaks[id] = nextStreak;
        winnersCount++;
        winnersIds.push(id);
        results[id] = { option: picked, status: 'CORRECT', delta: earned, score: s.scores[id] };
      } else {
        s.teamStreaks[id] = 0;
        let delta = 0;
        if (!noPenaltyTwist && !s.activeEffects.shieldTeams.includes(id)) {
          let effPenalty = penaltyPts;
          if (hasHeavyTrapPenalty) {
            effPenalty = Math.max(penaltyPts * 2, Math.floor(basePts / 2));
          }
          if (hasCursedPenalty) {
            effPenalty = Math.max(effPenalty, Math.floor(basePts / 2));
          }
          if (effPenalty > 0) {
            const nextScore = Math.max(0, currentScore - effPenalty);
            delta = nextScore - currentScore;
            s.scores[id] = nextScore;
          }
        }
        if (
          s.activeTrapTrigger?.status === 'DETONATED' &&
          s.activeTrapTrigger.type === 'STEAL_TRAP' &&
          id === s.activeTrapTrigger.triggeredByTeamId &&
          s.activeTrapTrigger.ownerTeamId !== id
        ) {
          const ownerId = s.activeTrapTrigger.ownerTeamId;
          const transfer = Math.floor(basePts / 2);
          const victimCurr = Number(s.scores[id]) || 0;
          const stolen = Math.min(victimCurr, transfer);
          s.scores[id] = victimCurr - stolen;
          delta -= stolen;
          const gain = stolen > 0 ? stolen : Math.min(50, transfer);
          s.scores[ownerId] = (Number(s.scores[ownerId]) || 0) + gain;
          s.lastStealSummary = {
            thiefId: ownerId,
            thiefName: this.getTeamName(ownerId),
            victimId: id,
            victimName: this.getTeamName(id),
            amount: gain,
          };
        }
        results[id] = { option: picked, status: 'WRONG', delta, score: s.scores[id] };
      }
    }

    // Bounty hunter in CHOICE mode: if a bounty-holder missed and another team answered right, fastest winner claims bounty
    if (winnersIds.length > 0) {
      let bestTarget: string | null = null;
      let bestBounty = 0;
      for (let i = 1; i <= teamCount; i++) {
        const id = String(i);
        if (winnersIds.includes(id)) continue;
        const b = Number(s.teamBounties[id]) || 0;
        if (b > bestBounty) {
          bestBounty = b;
          bestTarget = id;
        }
      }
      if (bestTarget && bestBounty > 0) {
        winnersIds.sort((a, b) => (secretMap[a]?.ts || 0) - (secretMap[b]?.ts || 0));
        const hunterId = winnersIds[0];
        s.scores[hunterId] = (Number(s.scores[hunterId]) || 0) + bestBounty;
        if (results[hunterId]) {
          results[hunterId].delta += bestBounty;
          results[hunterId].score = s.scores[hunterId];
        }
        s.lastBountyClaim = {
          hunterTeamId: hunterId,
          hunterTeamName: this.getTeamName(hunterId),
          targetTeamId: bestTarget,
          targetTeamName: this.getTeamName(bestTarget),
          amount: bestBounty,
          brokenStreak: Number(this.store.undoSnapshot?.teamStreaks?.[bestTarget]) || 3,
          at: now,
        };
      }
    }

    const revealedPayload: RevealedChoicesPayload = {
      questionId: s.currentQuestion.id,
      correctOption: correctOpt,
      winnersCount,
      results,
    };

    s.fsmState = 'CHOICE_REVEALED';
    s.revealedChoices = revealedPayload;
    s.questionEndTime = null;
    s.answerEndTime = null;
    s.isTimerPaused = false;
    s.activeTurnTeamId = this.computeNextTurnTeamId();

    const mode = s.settings.playMode;
    if (mode === 'BOARD') {
      s.autoTransitionAction = 'RETURN_TO_BOARD';
      s.autoTransitionAt = Date.now() + 4500;
      this.scheduleAutoTransition(4500);
    } else if (mode === 'AUTO_CATEGORY') {
      s.autoTransitionAction = 'NEXT_IN_SLOT';
      s.autoTransitionAt = Date.now() + 4500;
      this.scheduleAutoTransition(4500);
    } else if (mode === 'AUTO_ALL') {
      s.selectedCategory = null;
      s.selectedDifficulty = null;
      s.autoTransitionAction = 'NEXT_IN_ALL';
      s.autoTransitionAt = Date.now() + 4500;
      this.scheduleAutoTransition(4500);
    } else {
      s.autoTransitionAction = null;
      s.autoTransitionAt = null;
    }

    this.commitAndBroadcast();
    return {
      status: 'OK',
      message: `✅ تم كشف الإجابات الجماعية (${winnersCount} إجابة صحيحة)`,
      state: this.getSanitizedState(),
    };
  }

  private revealFinalResultsInternal(): ActionResponse {
    const s = this.store.state;
    if (s.fsmState === 'FINAL_REVEALED') {
      return { status: 'ALREADY_REVEALED', state: this.getSanitizedState() };
    }
    if (!s.currentQuestion || s.fsmState !== 'FINAL_QUESTION_ACTIVE') {
      return {
        status: 'INVALID_STATE',
        message: 'لا يوجد سؤال جولة نهائية نشط للكشف عنه',
        state: this.getSanitizedState(),
      };
    }

    if (this.finalTimerHandle) {
      clearTimeout(this.finalTimerHandle);
      this.finalTimerHandle = null;
    }

    const teamCount = Number(s.settings.teamCount) || 4;
    this.store.undoSnapshot = {
      summary: `التراجع عن نتائج الجولة النهائية لسؤال #${s.currentQuestion.id}`,
      scores: { ...s.scores },
      activeTurnTeamId: s.activeTurnTeamId,
      teamStreaks: { ...s.teamStreaks },
      previousRanks: { ...s.previousRanks },
    };

    s.previousRanks = captureRanks(s.scores, teamCount);

    const secretMap =
      this.store.secretChoices.questionInstanceId === s.questionInstanceId
        ? this.store.secretChoices.choices
        : {};
    const wagersMap = this.store.finalWagers?.wagers || {};
    const correctOpt = normalizeOption(s.currentQuestion.correct);

    const results: Record<string, FinalWagerTeamResult> = {};
    let winnersCount = 0;

    for (let i = 1; i <= teamCount; i++) {
      const id = String(i);
      if (s.eliminatedTeams.includes(id)) continue;

      const wager = Math.max(0, Number(wagersMap[id]) || 0);
      const entry = secretMap[id];
      const picked = entry ? entry.option : null;
      const currentScore = Number(s.scores[id]) || 0;

      if (picked === correctOpt) {
        s.scores[id] = currentScore + wager;
        s.teamStreaks[id] = (Number(s.teamStreaks[id]) || 0) + 1;
        winnersCount++;
        results[id] = {
          wager,
          option: picked,
          status: 'CORRECT',
          delta: wager,
          score: s.scores[id],
        };
      } else {
        s.teamStreaks[id] = 0;
        const nextScore = Math.max(0, currentScore - wager);
        const delta = nextScore - currentScore;
        s.scores[id] = nextScore;
        results[id] = {
          wager,
          option: picked,
          status: picked ? 'WRONG' : 'NO_VOTE',
          delta,
          score: s.scores[id],
        };
      }
    }

    const payload: FinalRevealedPayload = {
      questionId: s.currentQuestion.id,
      correctOption: correctOpt,
      winnersCount,
      results,
    };

    s.fsmState = 'FINAL_REVEALED';
    s.finalResults = payload;
    s.questionEndTime = null;
    s.answerEndTime = null;
    s.isTimerPaused = false;
    s.autoTransitionAction = null;
    s.autoTransitionAt = null;

    this.commitAndBroadcast();
    return {
      status: 'OK',
      message: `🏆 تم كشف نتائج الجولة النهائية (${winnersCount} إجابة صحيحة)`,
      state: this.getSanitizedState(),
    };
  }

  public handleAction(action: string, payload: Record<string, unknown> = {}): ActionResponse {
    const s = this.store.state;
    const now = Date.now();

    switch (action) {
      case 'START_TRAP_SETUP': {
        this.clearAllScheduledTimers();
        s.fsmState = 'TRAP_SETUP';
        s.currentQuestion = null;
        s.questionInstanceId = null;
        s.questionEndTime = null;
        s.answerEndTime = null;
        s.autoTransitionAction = null;
        s.autoTransitionAt = null;
        s.lockedTeamId = null;
        s.timedOutTeamId = null;
        s.attemptedTeamsThisQuestion = [];
        s.votedTeams = [];
        s.revealedChoices = null;
        s.isTimerPaused = false;
        s.activeEffects = getEmptyEffects();
        s.activeMysteryTwist = null;
        s.activeTrapTrigger = null;
        s.armedDuel = null;
        s.activeDuel = null;
        s.activeBomb = null;
        s.powerUpsLockedThisQuestion = false;
        s.trapSetupReadyTeams = [];
        s.boardNotice = null;
        this.commitAndBroadcast();
        return {
          status: 'OK',
          message: '🕳️ فُتحت مرحلة زرع الكمائن السرية! يمكن لكل فريق زرع كمينين من جواله.',
          state: this.getSanitizedState(),
        };
      }

      case 'FINISH_TRAP_SETUP': {
        this.clearAllScheduledTimers();
        const isBoardBased = s.settings.playMode === 'BOARD' || s.settings.playMode === 'AUTO_CATEGORY';
        s.fsmState = isBoardBased ? 'CATEGORY_BOARD' : 'WAITING_LOBBY';
        const totalTraps = countTotalTraps(this.store.teamTraps);
        s.boardNotice =
          totalTraps > 0
            ? `🕳️ تم إغلاق مرحلة الكمائن — يوجد (${totalTraps}) كمين سري مخفي داخل اللوحة!`
            : '✅ تم إغلاق مرحلة الكمائن وبدء المباراة!';
        this.commitAndBroadcast();
        return {
          status: 'OK',
          message: s.boardNotice,
          state: this.getSanitizedState(),
        };
      }

      case 'PLACE_TEAM_TRAP': {
        const tId = String(payload.teamId || '').trim();
        if (!this.isValidTeamToken(tId, payload.teamToken)) {
          return {
            status: 'REJECTED',
            accepted: false,
            reason: 'INVALID_TEAM_TOKEN',
            message: '🔒 رابط الفريق غير صالح — امسح الباركود الخاص بفريقك',
            state: this.getSanitizedState(),
          };
        }
        if (s.fsmState !== 'TRAP_SETUP') {
          return {
            status: 'REJECTED',
            accepted: false,
            reason: 'INVALID_STATE',
            message: 'مرحلة زرع الكمائن غير مفتوحة حالياً',
            state: this.getSanitizedState(),
          };
        }
        if (s.eliminatedTeams.includes(tId)) {
          return { status: 'REJECTED', accepted: false, reason: 'ELIMINATED', message: 'فريقك مستبعد حالياً' };
        }
        const targetCat = cleanArabicLabel(payload.category, '');
        const targetDiff = normalizeDifficulty(payload.difficulty);
        const trapType = String(payload.trapType || '') as TrapType;
        if (!targetCat || !VALID_TRAP_TYPES.includes(trapType)) {
          return { status: 'REJECTED', accepted: false, reason: 'INVALID_TRAP', message: 'بيانات الكمين غير صالحة' };
        }
        const matrix = buildBoardMatrix(this.store.questions, s.usedQuestionIds, s.selectedRound);
        if (!matrix[targetCat] || (Number(matrix[targetCat][targetDiff]) || 0) <= 0) {
          return { status: 'REJECTED', accepted: false, reason: 'EMPTY_SLOT', message: 'لا توجد أسئلة متاحة في هذه الخانة' };
        }

        if (!this.store.teamTraps) this.store.teamTraps = {};
        const currentList = Array.isArray(this.store.teamTraps[tId]) ? [...this.store.teamTraps[tId]] : [];
        const slotKey = `${targetCat}|||${targetDiff}`;
        const existingIdx = currentList.findIndex((item) => item.slotKey === slotKey);

        if (existingIdx !== -1) {
          currentList[existingIdx] = { slotKey, category: targetCat, difficulty: targetDiff, type: trapType };
        } else {
          if (currentList.length >= MAX_TRAPS_PER_TEAM) {
            return {
              status: 'REJECTED',
              accepted: false,
              reason: 'LIMIT_REACHED',
              message: `الحد الأقصى هو كمينان (${MAX_TRAPS_PER_TEAM}) لكل فريق — احذف كميناً أولاً للاستبدال`,
              state: this.getSanitizedState(),
            };
          }
          currentList.push({ slotKey, category: targetCat, difficulty: targetDiff, type: trapType });
        }

        this.store.teamTraps[tId] = currentList;
        s.trapSetupReadyTeams = s.trapSetupReadyTeams.filter((id) => id !== tId);
        this.commitAndBroadcast();
        return {
          status: 'OK',
          accepted: true,
          message: `🕳️ تم زرع الكمين السري في (${targetCat} - ${targetDiff})`,
          state: this.getSanitizedState(),
        };
      }

      case 'REMOVE_TEAM_TRAP': {
        const tId = String(payload.teamId || '').trim();
        if (!this.isValidTeamToken(tId, payload.teamToken)) {
          return {
            status: 'REJECTED',
            accepted: false,
            reason: 'INVALID_TEAM_TOKEN',
            message: '🔒 رابط الفريق غير صالح',
            state: this.getSanitizedState(),
          };
        }
        if (s.fsmState !== 'TRAP_SETUP') {
          return { status: 'REJECTED', accepted: false, reason: 'INVALID_STATE', message: 'مرحلة الكمائن غير مفتوحة حالياً' };
        }
        const slotKey = String(payload.slotKey || '');
        if (!this.store.teamTraps) this.store.teamTraps = {};
        const list = Array.isArray(this.store.teamTraps[tId]) ? this.store.teamTraps[tId] : [];
        this.store.teamTraps[tId] = list.filter((item) => item.slotKey !== slotKey);
        s.trapSetupReadyTeams = s.trapSetupReadyTeams.filter((id) => id !== tId);
        this.commitAndBroadcast();
        return { status: 'OK', accepted: true, message: '🗑️ تم إزالة الكمين من الخانة', state: this.getSanitizedState() };
      }

      case 'CONFIRM_TEAM_TRAPS': {
        const tId = String(payload.teamId || '').trim();
        if (!this.isValidTeamToken(tId, payload.teamToken)) {
          return {
            status: 'REJECTED',
            accepted: false,
            reason: 'INVALID_TEAM_TOKEN',
            message: '🔒 رابط الفريق غير صالح',
            state: this.getSanitizedState(),
          };
        }
        if (s.fsmState !== 'TRAP_SETUP') {
          return { status: 'REJECTED', accepted: false, reason: 'INVALID_STATE', message: 'مرحلة الكمائن غير مفتوحة حالياً' };
        }
        if (!s.trapSetupReadyTeams.includes(tId)) {
          s.trapSetupReadyTeams.push(tId);
        }
        this.commitAndBroadcast();
        return { status: 'OK', accepted: true, message: '✅ تم تأكيد جاهزية كمائن فريقك!', state: this.getSanitizedState() };
      }

      case 'ARM_DUEL': {
        if (s.fsmState !== 'CATEGORY_BOARD') {
          return { status: 'INVALID_STATE', message: 'يمكن تفعيل المبارزة من لوحة الفئات قبل اختيار السؤال فقط', state: this.getSanitizedState() };
        }
        if (s.answerMode !== 'BUZZER') {
          return { status: 'UNSUPPORTED_IN_CHOICE', message: 'تحدي المبارزة الفردية متاح في وضع الضاغط السريع فقط', state: this.getSanitizedState() };
        }
        const count = Number(s.settings.teamCount) || 4;
        const challengerId = String(payload.challengerId || s.activeTurnTeamId || '1');
        const opponentId = String(payload.opponentId || '');
        const cNum = Number(challengerId);
        const oNum = Number(opponentId);
        if (
          !Number.isInteger(cNum) ||
          cNum < 1 ||
          cNum > count ||
          !Number.isInteger(oNum) ||
          oNum < 1 ||
          oNum > count ||
          challengerId === opponentId
        ) {
          return { status: 'INVALID', message: 'اختر فريقاً منافساً صالحاً للمبارزة', state: this.getSanitizedState() };
        }
        if (s.eliminatedTeams.includes(challengerId) || s.eliminatedTeams.includes(opponentId)) {
          return { status: 'ELIMINATED', message: 'لا يمكن إشراك فريق مستبعد في المبارزة', state: this.getSanitizedState() };
        }
        if ((Number(s.duelCredits[challengerId]) || 0) <= 0) {
          return { status: 'UNAVAILABLE', message: 'استنفد هذا الفريق رصيد المبارزة الفردية', state: this.getSanitizedState() };
        }
        const armed: ArmedDuelInfo = {
          challengerId,
          challengerName: this.getTeamName(challengerId),
          opponentId,
          opponentName: this.getTeamName(opponentId),
        };
        s.armedDuel = armed;
        this.commitAndBroadcast();
        return {
          status: 'OK',
          message: `⚔️ جاهز للمبارزة! (${armed.challengerName}) يتحدى (${armed.opponentName}) على ×1.5 نقاط — اختر السؤال الآن`,
          state: this.getSanitizedState(),
        };
      }

      case 'CANCEL_DUEL': {
        s.armedDuel = null;
        this.commitAndBroadcast();
        return { status: 'OK', message: 'تم إلغاء تجهيز المبارزة', state: this.getSanitizedState() };
      }

      case 'THROW_BOMB': {
        const tId = String(payload.teamId || '').trim();
        const targetId = String(payload.targetTeamId || '').trim();
        if (!this.isValidTeamToken(tId, payload.teamToken)) {
          return {
            status: 'REJECTED',
            accepted: false,
            reason: 'INVALID_TEAM_TOKEN',
            message: '🔒 رابط الفريق غير صالح — امسح الباركود الخاص بفريقك',
            state: this.getSanitizedState(),
          };
        }
        if (s.fsmState !== 'QUESTION_ACTIVE' || s.answerMode !== 'BUZZER' || s.lockedTeamId !== null) {
          return {
            status: 'REJECTED',
            accepted: false,
            reason: 'INVALID_STATE',
            message: 'يمكن رمي القنبلة الموقوتة فقط أثناء السؤال النشط بوضع الضاغط قبل أن يضغط أحد',
            state: this.getSanitizedState(),
          };
        }
        if (s.isTimerPaused) {
          return { status: 'REJECTED', accepted: false, reason: 'TIMER_PAUSED', message: 'المؤقت متوقف مؤقتاً' };
        }
        if (s.activeDuel) {
          return { status: 'REJECTED', accepted: false, reason: 'DUEL_ACTIVE', message: 'لا يمكن استخدام القنبلة أثناء مبارزة فردية' };
        }
        if (s.activeBomb) {
          return { status: 'REJECTED', accepted: false, reason: 'BOMB_ALREADY_ACTIVE', message: 'هناك قنبلة موقوتة نشطة بالفعل!' };
        }
        if (s.powerUpsLockedThisQuestion) {
          return { status: 'REJECTED', accepted: false, reason: 'POWERUPS_LOCKED', message: '🔇 الأدوات مقفلة في هذا السؤال!' };
        }
        if (s.eliminatedTeams.includes(tId)) {
          return { status: 'REJECTED', accepted: false, reason: 'ELIMINATED', message: 'فريقك مستبعد حالياً' };
        }
        const credits = Number(s.bombCredits[tId]) || 0;
        if (credits <= 0) {
          return { status: 'REJECTED', accepted: false, reason: 'UNAVAILABLE', message: 'نفد رصيد القنبلة الموقوتة لفريقك' };
        }
        const count = Number(s.settings.teamCount) || 4;
        const targetNum = Number(targetId);
        if (
          !Number.isInteger(targetNum) ||
          targetNum < 1 ||
          targetNum > count ||
          targetId === tId ||
          s.eliminatedTeams.includes(targetId)
        ) {
          return { status: 'REJECTED', accepted: false, reason: 'INVALID_TARGET', message: 'اختر فريقاً منافساً صالحاً لتمرير القنبلة إليه' };
        }

        const remaining = s.questionEndTime ? Math.max(5, Math.ceil((s.questionEndTime - now) / 1000)) : 10;
        const bombSeconds = 10;
        s.bombCredits[tId] = credits - 1;
        s.fsmState = 'BUZZER_LOCKED';
        s.lockedTeamId = targetId;
        s.timedOutTeamId = null;
        s.pausedRemaining = remaining;
        s.questionEndTime = null;
        s.pausedAnswerRemaining = bombSeconds;
        s.answerEndTime = now + bombSeconds * 1000;
        s.isTimerPaused = false;
        const activeBomb: ActiveBombInfo = {
          throwerId: tId,
          throwerName: this.getTeamName(tId),
          targetId,
          targetName: this.getTeamName(targetId),
          status: 'TICKING',
          summary: null,
        };
        s.activeBomb = activeBomb;
        s.activeEffects.lastPowerUpBanner = `💣 (${activeBomb.throwerName}) ألقى القنبلة الموقوتة على (${activeBomb.targetName})! 10 ثوانٍ للإجابة!`;

        this.scheduleAnswerTimeout(bombSeconds * 1000);
        this.commitAndBroadcast();
        return {
          status: 'OK',
          accepted: true,
          message: `💣 أُلقيت القنبلة على (${activeBomb.targetName})!`,
          state: this.getSanitizedState(),
        };
      }

      case 'PICK_BOARD_QUESTION': {
        const targetCat = cleanArabicLabel(payload.category, '');
        const targetDiff = normalizeDifficulty(payload.difficulty);
        const activeRound = cleanArabicLabel(s.selectedRound, 'ALL');
        const used = new Set(s.usedQuestionIds.map(Number));

        const candidate = this.store.questions.find(
          (q) =>
            !used.has(Number(q.id)) &&
            (activeRound === 'ALL' || cleanArabicLabel(q.round, 'الجولة 1') === activeRound) &&
            cleanArabicLabel(q.category, 'عام') === targetCat &&
            normalizeDifficulty(q.difficulty) === targetDiff
        );

        if (!candidate) {
          return { status: 'EMPTY_SLOT', message: 'نفدت أسئلة هذا المستوى في هذه الفئة', state: this.getSanitizedState() };
        }
        s.selectedCategory = targetCat;
        s.selectedDifficulty = targetDiff;

        const slotKey = `${targetCat}|||${targetDiff}`;
        const turnTeam = s.activeTurnTeamId || '1';
        const turnTeamName = this.getTeamName(turnTeam);

        // 1) Check hidden Secret Board Traps (Detonates strictly on opponents; fizzles safely on owner)
        let trapTrigger: ActiveTrapTrigger | null = null;
        const trapsMap = this.store.teamTraps || {};
        let matchedOwner: string | null = null;
        let matchedTrap: TeamTrapPlacement | null = null;

        for (const [ownerId, list] of Object.entries(trapsMap)) {
          if (ownerId === turnTeam || !Array.isArray(list)) continue;
          const found = list.find((t) => t.slotKey === slotKey);
          if (found) {
            matchedOwner = ownerId;
            matchedTrap = found;
            break;
          }
        }
        if (!matchedTrap && Array.isArray(trapsMap[turnTeam])) {
          const ownTrap = trapsMap[turnTeam].find((t) => t.slotKey === slotKey);
          if (ownTrap) {
            matchedOwner = turnTeam;
            matchedTrap = ownTrap;
          }
        }

        if (matchedOwner && matchedTrap) {
          trapsMap[matchedOwner] = (trapsMap[matchedOwner] || []).filter((t) => t.slotKey !== slotKey);
          this.store.teamTraps = trapsMap;
          const status: 'DETONATED' | 'DISARMED_SELF' =
            matchedOwner === turnTeam ? 'DISARMED_SELF' : 'DETONATED';
          const ownerName = this.getTeamName(matchedOwner);
          const meta = getTrapMeta(matchedTrap.type, ownerName, turnTeamName, status);
          trapTrigger = {
            type: matchedTrap.type,
            status,
            ownerTeamId: matchedOwner,
            ownerTeamName: ownerName,
            triggeredByTeamId: turnTeam,
            triggeredByTeamName: turnTeamName,
            title: meta.title,
            desc: meta.desc,
          };
        }

        // 2) Check Balanced 50/50 Good & Bad Mystery Surprises
        let mysteryTwist: MysteryTwistInfo | null = null;
        const mysteryList = this.store.mysterySlots || [];
        const mysteryIdx = mysteryList.indexOf(slotKey);
        if (mysteryIdx !== -1) {
          mysteryList.splice(mysteryIdx, 1);
          this.store.mysterySlots = mysteryList;
          const sentiment: 'GOOD' | 'BAD' = this.store.mysterySlotSentiments?.[slotKey] || 'GOOD';
          if (this.store.mysterySlotSentiments) {
            delete this.store.mysterySlotSentiments[slotKey];
          }

          if (sentiment === 'GOOD') {
            const goodPool: MysteryTwistType[] = [
              'DOUBLE_POINTS',
              'FREE_POWERUP',
              'NO_PENALTY',
              'BONUS_PLUS_150',
            ];
            const chosenType = goodPool[Math.floor(Math.random() * goodPool.length)];
            if (chosenType === 'DOUBLE_POINTS') {
              mysteryTwist = {
                type: 'DOUBLE_POINTS',
                sentiment: 'GOOD',
                title: '🌟 مفاجأة سعيدة: مضاعفة النقاط ×2!',
                desc: 'نقاط هذا السؤال مضاعفة تلقائياً لجميع المتنافسين.',
                teamName: turnTeamName,
              };
            } else if (chosenType === 'FREE_POWERUP') {
              const giftPool: PowerUpType[] = ['shield', 'ai', 'double', 'time'];
              const giftType = giftPool[Math.floor(Math.random() * giftPool.length)];
              const giftLabels: Record<string, string> = {
                shield: '🛡️ درع الحماية',
                ai: '✨ حذف خيار',
                double: '🚀 مضاعفة ×2',
                time: '⏳ وقت إضافي +15ث',
              };
              if (!s.powerUps[turnTeam]) {
                s.powerUps[turnTeam] = { shield: 0, ai: 0, double: 0, freeze: 0, steal: 0, time: 0 };
              }
              s.powerUps[turnTeam][giftType] = (Number(s.powerUps[turnTeam][giftType]) || 0) + 1;
              mysteryTwist = {
                type: 'FREE_POWERUP',
                sentiment: 'GOOD',
                title: `🎁 مفاجأة سعيدة: هدية (${giftLabels[giftType]})!`,
                desc: `حصل فريق ${turnTeamName} على أداة مساعدة مجانية +1 في رصيده فوراً.`,
                teamName: turnTeamName,
              };
            } else if (chosenType === 'NO_PENALTY') {
              mysteryTwist = {
                type: 'NO_PENALTY',
                sentiment: 'GOOD',
                title: '🛡️ مفاجأة سعيدة: سؤال الأمان!',
                desc: 'بلا خصم نقاط على الإجابات الخاطئة في هذا السؤال.',
                teamName: turnTeamName,
              };
            } else {
              const teamCount = Number(s.settings.teamCount) || 4;
              s.previousRanks = captureRanks(s.scores, teamCount);
              s.scores[turnTeam] = (Number(s.scores[turnTeam]) || 0) + 150;
              mysteryTwist = {
                type: 'BONUS_PLUS_150',
                sentiment: 'GOOD',
                title: '💎 مفاجأة سعيدة: صندوق الكنز +150!',
                desc: `أُضيفت +150 نقطة فورية لرصيد فريق ${turnTeamName}!`,
                teamName: turnTeamName,
              };
            }
          } else {
            const badPool: MysteryTwistType[] = [
              'BLITZ_HALF_TIME',
              'POWERUP_BLACKOUT',
              'CURSED_PENALTY',
              'ROBIN_HOOD',
            ];
            const chosenType = badPool[Math.floor(Math.random() * badPool.length)];
            if (chosenType === 'BLITZ_HALF_TIME') {
              mysteryTwist = {
                type: 'BLITZ_HALF_TIME',
                sentiment: 'BAD',
                title: '⚡ مفاجأة خطيرة: سؤال البرق (نصف الوقت)!',
                desc: 'تم تقليص مؤقت هذا السؤال إلى النصف — السرعة هي الحسم!',
                teamName: turnTeamName,
              };
            } else if (chosenType === 'POWERUP_BLACKOUT') {
              mysteryTwist = {
                type: 'POWERUP_BLACKOUT',
                sentiment: 'BAD',
                title: '🔇 مفاجأة خطيرة: انقطاع الأدوات!',
                desc: 'جميع الأدوات التكتيكية مقفلة في هذا السؤال — لا مساعدات متاحة.',
                teamName: turnTeamName,
              };
            } else if (chosenType === 'CURSED_PENALTY') {
              mysteryTwist = {
                type: 'CURSED_PENALTY',
                sentiment: 'BAD',
                title: '💀 مفاجأة خطيرة: السؤال الملعون!',
                desc: 'أي إجابة خاطئة ستخصم نصف نقاط السؤال مباشرة (إلا بدرع الحماية).',
                teamName: turnTeamName,
              };
            } else {
              const teamCount = Number(s.settings.teamCount) || 4;
              s.previousRanks = captureRanks(s.scores, teamCount);
              let lowestId: string | null = null;
              let minScore = Number.POSITIVE_INFINITY;
              for (let i = 1; i <= teamCount; i++) {
                const id = String(i);
                if (id === turnTeam || s.eliminatedTeams.includes(id)) continue;
                const sc = Number(s.scores[id]) || 0;
                if (sc < minScore) {
                  minScore = sc;
                  lowestId = id;
                }
              }
              if (lowestId) {
                const turnScore = Number(s.scores[turnTeam]) || 0;
                const transfer = Math.min(100, turnScore);
                if (transfer > 0) {
                  s.scores[turnTeam] = turnScore - transfer;
                  s.scores[lowestId] = (Number(s.scores[lowestId]) || 0) + transfer;
                  mysteryTwist = {
                    type: 'ROBIN_HOOD',
                    sentiment: 'BAD',
                    title: '🏹 مفاجأة خطيرة: ضريبة روبن هود!',
                    desc: `انتقلت ${transfer} نقطة من (${turnTeamName}) إلى الفريق الأقل نقاطاً (${this.getTeamName(lowestId)})!`,
                    teamName: turnTeamName,
                  };
                } else {
                  s.scores[lowestId] = (Number(s.scores[lowestId]) || 0) + 50;
                  mysteryTwist = {
                    type: 'ROBIN_HOOD',
                    sentiment: 'BAD',
                    title: '🏹 مفاجأة خطيرة: دعم روبن هود!',
                    desc: `حصل الفريق الأقل نقاطاً (${this.getTeamName(lowestId)}) على +50 نقطة تعويضية فورية!`,
                    teamName: turnTeamName,
                  };
                }
              } else {
                mysteryTwist = {
                  type: 'BLITZ_HALF_TIME',
                  sentiment: 'BAD',
                  title: '⚡ مفاجأة خطيرة: سؤال البرق (نصف الوقت)!',
                  desc: 'تم تقليص مؤقت هذا السؤال إلى النصف — السرعة هي الحسم!',
                  teamName: turnTeamName,
                };
              }
            }
          }
        }

        // 3) Promote Armed 1v1 Duel if set
        let activeDuel: ActiveDuelInfo | null = null;
        if (s.armedDuel && s.answerMode === 'BUZZER') {
          const cId = s.armedDuel.challengerId;
          const avail = Number(s.duelCredits[cId]) || 0;
          if (avail > 0) {
            s.duelCredits[cId] = avail - 1;
            activeDuel = {
              challengerId: s.armedDuel.challengerId,
              challengerName: s.armedDuel.challengerName,
              opponentId: s.armedDuel.opponentId,
              opponentName: s.armedDuel.opponentName,
              multiplier: 1.5,
              winnerId: null,
              summary: null,
            };
          }
          s.armedDuel = null;
        }

        return this.launchQuestionInternal(candidate, mysteryTwist, trapTrigger, activeDuel);
      }

      case 'LAUNCH_NEXT_AUTO': {
        return this.launchNextAutoQuestionInternal();
      }

      case 'START_QUESTION_ROUND': {
        const qId = Number(payload.questionId);
        const found = this.store.questions.find((q) => Number(q.id) === qId);
        if (!found) return { status: 'NOT_FOUND', message: 'لم يتم العثور على السؤال المحدد' };
        s.selectedCategory = cleanArabicLabel(found.category, 'عام');
        s.selectedDifficulty = normalizeDifficulty(found.difficulty);
        return this.launchQuestionInternal(found);
      }

      case 'SET_SELECTED_ROUND': {
        const r = cleanArabicLabel(payload.roundName, 'ALL');
        s.selectedRound = r;
        s.currentRoundLabel = r === 'ALL' ? 'جميع الجولات' : r;
        this.commitAndBroadcast();
        return { status: 'OK', state: this.getSanitizedState() };
      }

      case 'SET_ANSWER_MODE': {
        const nextMode: AnswerMode = payload.mode === 'CHOICE' ? 'CHOICE' : 'BUZZER';
        if (s.fsmState === 'BUZZER_LOCKED' || s.fsmState === 'CHOICE_REVEALED') {
          return {
            status: 'INVALID_STATE',
            message: 'أكمل تقييم السؤال الحالي قبل تغيير نمط الإجابة',
            state: this.getSanitizedState(),
          };
        }
        if (this.choiceTimerHandle) {
          clearTimeout(this.choiceTimerHandle);
          this.choiceTimerHandle = null;
        }
        s.answerMode = nextMode;
        s.votedTeams = [];
        s.lockedTeamId = null;
        this.store.secretChoices = { questionInstanceId: s.questionInstanceId, choices: {} };
        if (nextMode === 'CHOICE' && s.fsmState === 'QUESTION_ACTIVE' && s.questionEndTime && !s.isTimerPaused) {
          this.scheduleChoiceRevealTimeout(Math.max(100, s.questionEndTime - now));
        }
        const label = nextMode === 'CHOICE' ? 'الإجابة السرية الجماعية (A/B/C)' : 'الضاغط الصوتي السريع';
        this.commitAndBroadcast();
        return { status: 'OK', message: `✅ تم تفعيل نمط: ${label}`, state: this.getSanitizedState() };
      }

      case 'ADVANCE_TURN': {
        s.activeTurnTeamId = this.computeNextTurnTeamId();
        this.commitAndBroadcast();
        return { status: 'OK', state: this.getSanitizedState() };
      }

      case 'RETURN_TO_BOARD': {
        this.clearAllScheduledTimers();
        const isBoardBased = s.settings.playMode === 'BOARD' || s.settings.playMode === 'AUTO_CATEGORY';
        s.fsmState = isBoardBased ? 'CATEGORY_BOARD' : 'WAITING_LOBBY';
        s.currentQuestion = null;
        s.questionInstanceId = null;
        s.questionEndTime = null;
        s.answerEndTime = null;
        s.autoTransitionAction = null;
        s.autoTransitionAt = null;
        s.lockedTeamId = null;
        s.timedOutTeamId = null;
        s.attemptedTeamsThisQuestion = [];
        s.votedTeams = [];
        s.revealedChoices = null;
        s.selectedCategory = null;
        s.selectedDifficulty = null;
        s.boardNotice = null;
        s.isTimerPaused = false;
        s.activeEffects = getEmptyEffects();
        s.activeMysteryTwist = null;
        s.activeTrapTrigger = null;
        s.activeDuel = null;
        s.activeBomb = null;
        s.powerUpsLockedThisQuestion = false;
        s.finalCategoryLabel = null;
        s.finalWageredTeams = [];
        s.finalResults = null;
        this.store.secretChoices = { questionInstanceId: null, choices: {} };
        this.store.finalWagers = { questionId: null, wagers: {} };
        this.commitAndBroadcast();
        return { status: 'OK', state: this.getSanitizedState() };
      }

      case 'TRIGGER_BUZZER': {
        const tId = String(payload.teamId || '');
        if (!tId) return { status: 'INVALID', accepted: false };
        if (!this.isValidTeamToken(tId, payload.teamToken)) {
          return {
            status: 'REJECTED',
            accepted: false,
            reason: 'INVALID_TEAM_TOKEN',
            message: '🔒 رابط الفريق غير صالح — امسح الباركود الخاص بفريقك',
            state: this.getSanitizedState(),
          };
        }
        if (s.answerMode === 'CHOICE') {
          return { status: 'REJECTED', accepted: false, reason: 'CHOICE_MODE_ACTIVE', state: this.getSanitizedState() };
        }
        if (s.isTimerPaused) {
          return { status: 'REJECTED', accepted: false, reason: 'TIMER_PAUSED', state: this.getSanitizedState() };
        }
        if (s.eliminatedTeams.includes(tId)) {
          return { status: 'REJECTED', accepted: false, reason: 'ELIMINATED', state: this.getSanitizedState() };
        }
        if (s.activeDuel && tId !== s.activeDuel.challengerId && tId !== s.activeDuel.opponentId) {
          return {
            status: 'REJECTED',
            accepted: false,
            reason: 'NOT_IN_DUEL',
            message: '⚔️ هذا السؤال مبارزة فردية خاصة بين فريقين فقط',
            state: this.getSanitizedState(),
          };
        }
        if (s.attemptedTeamsThisQuestion.includes(tId)) {
          return { status: 'REJECTED', accepted: false, reason: 'ALREADY_ATTEMPTED', state: this.getSanitizedState() };
        }
        const frozenUntil = Number(s.activeEffects.frozenTeams[tId] || 0);
        if (frozenUntil > now) {
          return { status: 'REJECTED', accepted: false, reason: 'FROZEN', state: this.getSanitizedState() };
        }
        if (s.fsmState !== 'QUESTION_ACTIVE' || s.lockedTeamId !== null) {
          return {
            status: 'REJECTED',
            accepted: false,
            lockedBy: s.lockedTeamId,
            reason: 'ALREADY_LOCKED',
            state: this.getSanitizedState(),
          };
        }
        if (s.questionEndTime && now > s.questionEndTime + 350) {
          return { status: 'REJECTED', accepted: false, reason: 'TIME_EXPIRED', state: this.getSanitizedState() };
        }

        const remaining = s.questionEndTime ? Math.max(5, Math.ceil((s.questionEndTime - now) / 1000)) : 10;
        const ansDuration = Math.min(9, Math.max(3, Number(s.settings.answerSeconds) || 7));
        const reactionMs = s.questionStartedAt ? Math.max(40, now - s.questionStartedAt) : 0;

        s.fsmState = 'BUZZER_LOCKED';
        s.lockedTeamId = tId;
        s.timedOutTeamId = null;
        s.pausedRemaining = remaining;
        s.questionEndTime = null;
        s.pausedAnswerRemaining = ansDuration;
        s.answerEndTime = now + ansDuration * 1000;
        s.isTimerPaused = false;
        s.matchStats.buzzerHits = (Number(s.matchStats.buzzerHits) || 0) + 1;
        if (reactionMs > 0 && (!s.matchStats.fastestMs || reactionMs < s.matchStats.fastestMs)) {
          s.matchStats.fastestMs = reactionMs;
          s.matchStats.fastestTeamName = this.getTeamName(tId);
        }

        this.scheduleAnswerTimeout(ansDuration * 1000);
        this.commitAndBroadcast();
        return { status: 'OK', accepted: true, lockedBy: tId, state: this.getSanitizedState() };
      }

      case 'SUBMIT_SECRET_CHOICE': {
        const tId = String(payload.teamId || '');
        const opt = String(payload.option || '').trim().toUpperCase() as OptionLetter;
        if (!this.isValidTeamToken(tId, payload.teamToken)) {
          return {
            status: 'REJECTED',
            accepted: false,
            reason: 'INVALID_TEAM_TOKEN',
            message: '🔒 رابط الفريق غير صالح — امسح الباركود الخاص بفريقك',
            state: this.getSanitizedState(),
          };
        }
        const isSecretChoiceOpen =
          s.fsmState === 'FINAL_QUESTION_ACTIVE' ||
          (s.answerMode === 'CHOICE' && s.fsmState === 'QUESTION_ACTIVE');
        if (!isSecretChoiceOpen) {
          return { status: 'REJECTED', accepted: false, reason: 'INVALID_STATE', message: 'التصويت السري غير مفتوح حالياً', state: this.getSanitizedState() };
        }
        if (s.isTimerPaused) {
          return { status: 'REJECTED', accepted: false, reason: 'TIMER_PAUSED', message: 'المؤقت متوقف مؤقتاً', state: this.getSanitizedState() };
        }
        if (s.eliminatedTeams.includes(tId)) {
          return { status: 'REJECTED', accepted: false, reason: 'ELIMINATED', message: 'فريقك مستبعد في هذه الجولة', state: this.getSanitizedState() };
        }
        if (!['A', 'B', 'C'].includes(opt)) {
          return { status: 'REJECTED', accepted: false, reason: 'INVALID_OPTION', message: 'خيار غير صالح' };
        }
        if (s.activeEffects.eliminatedOptions.includes(opt)) {
          return { status: 'REJECTED', accepted: false, reason: 'OPTION_ELIMINATED', message: 'هذا الخيار محذوف بالمساعد الذكي', state: this.getSanitizedState() };
        }
        if (s.questionEndTime && now > s.questionEndTime + 400) {
          return { status: 'REJECTED', accepted: false, reason: 'TIME_EXPIRED', message: 'انتهى وقت التصويت السري', state: this.getSanitizedState() };
        }

        if (this.store.secretChoices.questionInstanceId !== s.questionInstanceId) {
          this.store.secretChoices = { questionInstanceId: s.questionInstanceId, choices: {} };
        }
        if (this.store.secretChoices.choices[tId]) {
          return {
            status: 'REJECTED',
            accepted: false,
            reason: 'ALREADY_VOTED',
            message: 'تم تثبيت إجابتك السرية مسبقاً ولا يمكن تعديلها',
            state: this.getSanitizedState(),
          };
        }

        this.store.secretChoices.choices[tId] = { option: opt, ts: now };
        if (!s.votedTeams.includes(tId)) s.votedTeams.push(tId);
        s.matchStats.secretVotesTotal = (Number(s.matchStats.secretVotesTotal) || 0) + 1;

        this.commitAndBroadcast();
        return { status: 'OK', accepted: true, myChoice: opt, state: this.getSanitizedState() };
      }

      case 'REVEAL_SECRET_CHOICES': {
        return this.revealSecretChoicesInternal();
      }

      case 'REOPEN_BUZZER': {
        if (!s.currentQuestion) {
          return { status: 'NO_QUESTION', message: 'لا يوجد سؤال نشط حالياً', state: this.getSanitizedState() };
        }
        this.clearAllScheduledTimers();
        if (s.lockedTeamId && !s.attemptedTeamsThisQuestion.includes(s.lockedTeamId)) {
          s.attemptedTeamsThisQuestion.push(s.lockedTeamId);
        }
        const rem = Math.max(8, Number(s.pausedRemaining) || 12);
        s.fsmState = 'QUESTION_ACTIVE';
        s.lockedTeamId = null;
        s.timedOutTeamId = null;
        s.answerEndTime = null;
        s.autoTransitionAction = null;
        s.autoTransitionAt = null;
        s.isTimerPaused = false;
        s.questionEndTime = now + rem * 1000;
        this.commitAndBroadcast();
        return { status: 'OK', message: '🔓 تم فتح الضاغط للفرق المتبقية', state: this.getSanitizedState() };
      }

      case 'PASS_QUESTION_NEXT_TEAM': {
        if (!s.currentQuestion) {
          return { status: 'NO_QUESTION', message: 'لا يوجد سؤال نشط حالياً', state: this.getSanitizedState() };
        }
        const lastHolder = s.lockedTeamId || s.timedOutTeamId;
        if (lastHolder && !s.attemptedTeamsThisQuestion.includes(lastHolder)) {
          s.attemptedTeamsThisQuestion.push(lastHolder);
        }
        const count = Number(s.settings.teamCount) || 4;
        const startIdx = Number(lastHolder || s.activeTurnTeamId || 1);
        let nextTeam: string | null = null;
        for (let step = 1; step <= count; step++) {
          const cand = String(((startIdx - 1 + step) % count) + 1);
          if (!s.eliminatedTeams.includes(cand) && !s.attemptedTeamsThisQuestion.includes(cand)) {
            nextTeam = cand;
            break;
          }
        }
        if (!nextTeam) {
          return { status: 'NO_ELIGIBLE', message: '⚠️ استنفدت جميع الفرق محاولاتها في هذا السؤال', state: this.getSanitizedState() };
        }

        this.clearAllScheduledTimers();
        const ansDuration = Math.min(9, Math.max(3, Number(s.settings.answerSeconds) || 7));
        s.fsmState = 'BUZZER_LOCKED';
        s.lockedTeamId = nextTeam;
        s.timedOutTeamId = null;
        s.questionEndTime = null;
        s.pausedAnswerRemaining = ansDuration;
        s.answerEndTime = now + ansDuration * 1000;
        s.isTimerPaused = false;
        s.autoTransitionAction = null;
        s.autoTransitionAt = null;
        this.scheduleAnswerTimeout(ansDuration * 1000);
        this.commitAndBroadcast();
        return { status: 'OK', message: `⏭️ تم تحويل السؤال إلى: ${this.getTeamName(nextTeam)}`, state: this.getSanitizedState() };
      }

      case 'EVALUATE_ANSWER': {
        const isCorrect = Boolean(payload.isCorrect);
        if (s.fsmState === 'ANSWER_CORRECT' || s.fsmState === 'ANSWER_WRONG') {
          return { status: 'ALREADY_EVALUATED', state: this.getSanitizedState() };
        }
        const team =
          s.lockedTeamId ||
          (s.fsmState === 'ANSWER_TIMEOUT' ? s.timedOutTeamId : null);
        if (!team) return { status: 'NO_TEAM', message: 'لا يوجد فريق قافل للضاغط حالياً', state: this.getSanitizedState() };
        s.lockedTeamId = team;
        s.timedOutTeamId = null;

        this.clearAllScheduledTimers();
        const tName = this.getTeamName(team);
        const teamCount = Number(s.settings.teamCount) || 4;
        this.store.undoSnapshot = {
          summary: `${isCorrect ? 'تقييم صحيح' : 'تقييم خاطئ'} لفريق (${tName})`,
          scores: { ...s.scores },
          activeTurnTeamId: s.activeTurnTeamId,
          teamStreaks: { ...s.teamStreaks },
          previousRanks: { ...s.previousRanks },
          teamBounties: { ...s.teamBounties },
          duelCredits: { ...s.duelCredits },
          bombCredits: { ...s.bombCredits },
          lastBountyClaim: s.lastBountyClaim ? { ...s.lastBountyClaim } : null,
        };

        s.previousRanks = captureRanks(s.scores, teamCount);

        const basePts = Number(s.currentQuestionPoints) || Number(s.settings.pointsEasy) || 100;
        const penaltyPts = Number(s.settings.pointsWrongPenalty) || 0;
        const noPenaltyTwist = s.activeMysteryTwist?.type === 'NO_PENALTY';
        const hasHeavyTrapPenalty =
          s.activeTrapTrigger?.status === 'DETONATED' && s.activeTrapTrigger.type === 'DOUBLE_PENALTY_TRAP';
        const hasCursedPenalty = s.activeMysteryTwist?.type === 'CURSED_PENALTY';
        const currentScore = Number(s.scores[team]) || 0;
        const hasDouble = s.activeEffects.doubleTeams.includes(team);
        const hasShield = s.activeEffects.shieldTeams.includes(team);
        s.lastStealSummary = null;

        if (isCorrect) {
          const nextStreak = (Number(s.teamStreaks[team]) || 0) + 1;
          const streakMult = computeStreakMultiplier(nextStreak);
          let earned = Math.round(basePts * (hasDouble ? 2 : 1) * streakMult);
          const victimId = s.activeEffects.stealTargets[team];
          if (victimId && victimId !== team && (Number(s.scores[victimId]) || 0) > 0) {
            const stolen = Math.min(Number(s.scores[victimId]), Math.floor(basePts / 2));
            s.scores[victimId] = Number(s.scores[victimId]) - stolen;
            earned += stolen;
            s.lastStealSummary = {
              thiefId: team,
              thiefName: tName,
              victimId,
              victimName: this.getTeamName(victimId),
              amount: stolen,
            };
          }

          // Bounty Hunter: claim highest active opponent bounty & break their streak
          let bountyTargetId: string | null = null;
          let maxBounty = 0;
          for (let i = 1; i <= teamCount; i++) {
            const id = String(i);
            if (id === team || s.eliminatedTeams.includes(id)) continue;
            const b = Number(s.teamBounties[id]) || 0;
            if (b > maxBounty) {
              maxBounty = b;
              bountyTargetId = id;
            }
          }
          if (bountyTargetId && maxBounty > 0) {
            const brokenStreak = Number(s.teamStreaks[bountyTargetId]) || 3;
            earned += maxBounty;
            s.teamStreaks[bountyTargetId] = 0;
            s.teamBounties[bountyTargetId] = 0;
            s.lastBountyClaim = {
              hunterTeamId: team,
              hunterTeamName: tName,
              targetTeamId: bountyTargetId,
              targetTeamName: this.getTeamName(bountyTargetId),
              amount: maxBounty,
              brokenStreak,
              at: now,
            };
          }

          // Hot Potato Bomb Defused (+50 courage bonus)
          if (s.activeBomb && s.activeBomb.status === 'TICKING' && s.activeBomb.targetId === team) {
            earned += 50;
            s.activeBomb = {
              ...s.activeBomb,
              status: 'DEFUSED',
              summary: `💣 فكّ فريق (${tName}) القنبلة الموقوتة بنجاح واقتنص +50 نقطة شجاعة!`,
            };
          }

          // 1v1 Duel Winner
          if (s.activeDuel) {
            s.activeDuel = {
              ...s.activeDuel,
              winnerId: team,
              summary: `⚔️ حسم فريق (${tName}) المبارزة واقتنص +${earned} نقطة!`,
            };
          }

          s.scores[team] = currentScore + earned;
          s.teamStreaks[team] = nextStreak;
          s.fsmState = 'ANSWER_CORRECT';
        } else {
          s.teamStreaks[team] = 0;
          if (!hasShield && !noPenaltyTwist) {
            let effPenalty = penaltyPts;
            if (hasHeavyTrapPenalty) {
              effPenalty = Math.max(penaltyPts * 2, Math.floor(basePts / 2));
            }
            if (hasCursedPenalty) {
              effPenalty = Math.max(effPenalty, Math.floor(basePts / 2));
            }
            if (effPenalty > 0) {
              s.scores[team] = Math.max(0, currentScore - effPenalty);
            }
          }

          // Steal Trap execution on wrong answer
          if (
            s.activeTrapTrigger?.status === 'DETONATED' &&
            s.activeTrapTrigger.type === 'STEAL_TRAP' &&
            s.activeTrapTrigger.ownerTeamId !== team
          ) {
            const ownerId = s.activeTrapTrigger.ownerTeamId;
            const transferAmt = Math.floor(basePts / 2);
            const victimCurr = Number(s.scores[team]) || 0;
            const stolen = Math.min(victimCurr, transferAmt);
            s.scores[team] = victimCurr - stolen;
            const ownerGain = stolen > 0 ? stolen : Math.min(50, transferAmt);
            s.scores[ownerId] = (Number(s.scores[ownerId]) || 0) + ownerGain;
            s.lastStealSummary = {
              thiefId: ownerId,
              thiefName: this.getTeamName(ownerId),
              victimId: team,
              victimName: tName,
              amount: ownerGain,
            };
          }

          // Hot Potato Bomb Exploded
          if (s.activeBomb && s.activeBomb.status === 'TICKING' && s.activeBomb.targetId === team) {
            const throwerId = s.activeBomb.throwerId;
            const blastAmt = Math.floor(basePts / 2);
            const victimCurr = Number(s.scores[team]) || 0;
            const deducted = Math.min(victimCurr, blastAmt);
            s.scores[team] = victimCurr - deducted;
            const throwerGain = deducted > 0 ? deducted : Math.min(50, blastAmt);
            s.scores[throwerId] = (Number(s.scores[throwerId]) || 0) + throwerGain;
            s.activeBomb = {
              ...s.activeBomb,
              status: 'EXPLODED',
              summary: `💥 انفجرت القنبلة في فريق (${tName}) وانتقلت +${throwerGain} نقطة إلى (${this.getTeamName(throwerId)})!`,
            };
          }

          // 1v1 Duel Defense Bonus for the other duelist
          if (
            s.activeDuel &&
            (team === s.activeDuel.challengerId || team === s.activeDuel.opponentId)
          ) {
            const otherDuelist =
              team === s.activeDuel.challengerId ? s.activeDuel.opponentId : s.activeDuel.challengerId;
            const defensePts = Math.floor(basePts / 2);
            s.scores[otherDuelist] = (Number(s.scores[otherDuelist]) || 0) + defensePts;
            s.activeDuel = {
              ...s.activeDuel,
              winnerId: otherDuelist,
              summary: `⚔️ تعثر (${tName}) فحصد (${this.getTeamName(otherDuelist)}) مكافأة الدفاع +${defensePts} نقطة!`,
            };
          }

          if (!s.attemptedTeamsThisQuestion.includes(team)) {
            s.attemptedTeamsThisQuestion.push(team);
          }
          s.fsmState = 'ANSWER_WRONG';
        }

        s.answerEndTime = null;
        s.isTimerPaused = false;
        s.activeTurnTeamId = this.computeNextTurnTeamId();

        const mode = s.settings.playMode;
        if (mode === 'BOARD') {
          s.autoTransitionAction = 'RETURN_TO_BOARD';
          s.autoTransitionAt = now + 3500;
          this.scheduleAutoTransition(3500);
        } else if (mode === 'AUTO_CATEGORY') {
          s.autoTransitionAction = 'NEXT_IN_SLOT';
          s.autoTransitionAt = now + 3500;
          this.scheduleAutoTransition(3500);
        } else if (mode === 'AUTO_ALL') {
          s.selectedCategory = null;
          s.selectedDifficulty = null;
          s.autoTransitionAction = 'NEXT_IN_ALL';
          s.autoTransitionAt = now + 3500;
          this.scheduleAutoTransition(3500);
        } else {
          s.autoTransitionAction = null;
          s.autoTransitionAt = null;
        }

        this.commitAndBroadcast();
        return { status: 'OK', state: this.getSanitizedState() };
      }

      case 'UNDO_EVALUATION': {
        if (!this.store.undoSnapshot) {
          return { status: 'NO_UNDO', message: 'لا يوجد حكم حديث للتراجع عنه', state: this.getSanitizedState() };
        }
        this.clearAllScheduledTimers();
        const snap = this.store.undoSnapshot;
        s.scores = { ...snap.scores };
        s.activeTurnTeamId = snap.activeTurnTeamId;
        if (snap.teamStreaks) s.teamStreaks = { ...snap.teamStreaks };
        if (snap.previousRanks) s.previousRanks = { ...snap.previousRanks };
        if (snap.teamBounties) s.teamBounties = { ...snap.teamBounties };
        if (snap.duelCredits) s.duelCredits = { ...snap.duelCredits };
        if (snap.bombCredits) s.bombCredits = { ...snap.bombCredits };
        s.lastBountyClaim = snap.lastBountyClaim ?? null;
        s.autoTransitionAction = null;
        s.autoTransitionAt = null;
        s.lastStealSummary = null;
        const isBoardBased = s.settings.playMode === 'BOARD' || s.settings.playMode === 'AUTO_CATEGORY';
        s.fsmState = isBoardBased ? 'CATEGORY_BOARD' : 'WAITING_LOBBY';
        s.currentQuestion = null;
        s.questionInstanceId = null;
        s.lockedTeamId = null;
        s.revealedChoices = null;
        s.finalResults = null;
        s.finalCategoryLabel = null;
        s.finalWageredTeams = [];
        s.activeMysteryTwist = null;
        s.activeTrapTrigger = null;
        s.activeDuel = null;
        s.activeBomb = null;
        s.powerUpsLockedThisQuestion = false;
        s.refereeNotice = {
          text: `⚖️ قرار تحكيمي: تم التراجع عن (${snap.summary}) وإعادة النقاط لما كانت عليه.`,
          at: now,
        };
        this.store.undoSnapshot = null;
        this.commitAndBroadcast();
        return { status: 'OK', message: '↩️ تم التراجع عن الحكم وإرجاع النقاط بنجاح', state: this.getSanitizedState() };
      }

      case 'ADJUST_TEAM_SCORE': {
        const tId = String(payload.teamId || '');
        const delta = Math.round(Number(payload.delta) || 0);
        if (!tId || !delta) return { status: 'INVALID', state: this.getSanitizedState() };
        const prev = Number(s.scores[tId]) || 0;
        s.scores[tId] = Math.max(0, prev + delta);
        const signStr = delta > 0 ? `+${delta}` : String(delta);
        s.refereeNotice = {
          text: `⚖️ تعديل تحكيمي فوري: (${signStr} نقطة) لصالح فريق ${this.getTeamName(tId)}`,
          at: now,
        };
        this.commitAndBroadcast();
        return { status: 'OK', state: this.getSanitizedState() };
      }

      case 'GRANT_POWERUP': {
        const tId = String(payload.teamId || '');
        const puType = String(payload.puType || '') as PowerUpType;
        const validTypes: PowerUpType[] = ['shield', 'ai', 'double', 'freeze', 'steal', 'time'];
        if (!tId || !validTypes.includes(puType)) return { status: 'INVALID' };
        if (!s.powerUps[tId]) {
          s.powerUps[tId] = { shield: 0, ai: 0, double: 0, freeze: 0, steal: 0, time: 0 };
        }
        s.powerUps[tId][puType] = (Number(s.powerUps[tId][puType]) || 0) + 1;
        const labels: Record<PowerUpType, string> = {
          shield: '🛡️ درع الحماية',
          ai: '✨ حذف إجابة',
          double: '🚀 مضاعفة ×2',
          freeze: '❄️ تجميد المتصدر',
          steal: '🧲 سرقة نقاط',
          time: '⏳ وقت +15ث',
        };
        s.refereeNotice = {
          text: `🎁 منحة تحكيمية: فريق (${this.getTeamName(tId)}) حصل على أداة (${labels[puType]}) +1`,
          at: now,
        };
        this.commitAndBroadcast();
        return { status: 'OK', state: this.getSanitizedState() };
      }

      case 'ACTIVATE_POWERUP': {
        const tId = String(payload.teamId || '');
        const type = String(payload.type || '') as PowerUpType;
        const targetTeamId = payload.targetTeamId ? String(payload.targetTeamId) : null;

        if (!this.isValidTeamToken(tId, payload.teamToken)) {
          return {
            status: 'INVALID_TEAM_TOKEN',
            reason: 'INVALID_TEAM_TOKEN',
            message: '🔒 رابط الفريق غير صالح — امسح الباركود الخاص بفريقك',
            state: this.getSanitizedState(),
          };
        }
        if (!s.settings.powerUpsEnabled) {
          return { status: 'DISABLED', message: 'الأدوات التكتيكية معطلة من إعدادات المسابقة' };
        }
        if (s.powerUpsLockedThisQuestion) {
          return {
            status: 'POWERUPS_LOCKED',
            message: '🔇 الأدوات التكتيكية مقفلة في هذا السؤال بسبب كمين أو مفاجأة!',
            state: this.getSanitizedState(),
          };
        }
        if (s.eliminatedTeams.includes(tId)) {
          return { status: 'ELIMINATED', message: 'فريقك مستبعد في هذه الجولة' };
        }
        const uses = (s.powerUps[tId] && Number(s.powerUps[tId][type])) || 0;
        if (uses <= 0) {
          return { status: 'UNAVAILABLE', message: 'نفد رصيد هذه الأداة لفريقك' };
        }
        if (s.fsmState !== 'QUESTION_ACTIVE' && s.fsmState !== 'BUZZER_LOCKED') {
          return { status: 'INVALID_STATE', message: 'لا يمكن تفعيل الأداة إلا أثناء عرض السؤال' };
        }
        if (s.fsmState === 'BUZZER_LOCKED') {
          if (type === 'freeze' || type === 'time') {
            return { status: 'BUZZER_ALREADY_LOCKED', message: 'تم قفل الضاغط بالفعل' };
          }
          if (s.lockedTeamId !== tId) {
            return { status: 'NOT_YOUR_TURN', message: 'فريق آخر سبقكم بالضغط على الضاغط' };
          }
        }

        const teamName = this.getTeamName(tId);
        let bannerMsg = '';

        if (type === 'shield') {
          if (s.activeEffects.shieldTeams.includes(tId)) return { status: 'ALREADY_ACTIVE', message: 'الدرع مفعّل بالفعل لفريقك' };
          s.activeEffects.shieldTeams.push(tId);
          bannerMsg = `🛡️ (${teamName}) فعّل درع الحماية ضد الخصم!`;
        } else if (type === 'double') {
          if (s.activeEffects.doubleTeams.includes(tId)) return { status: 'ALREADY_ACTIVE', message: 'المضاعفة مفعّلة بالفعل لفريقك' };
          s.activeEffects.doubleTeams.push(tId);
          bannerMsg = `🚀 (${teamName}) فعّل مضاعفة النقاط ×2!`;
        } else if (type === 'steal') {
          if (s.answerMode === 'CHOICE') {
            return { status: 'UNSUPPORTED_IN_CHOICE', message: 'السرقة متاحة في وضع الضاغط السريع فقط' };
          }
          if (s.activeEffects.stealTargets[tId]) return { status: 'ALREADY_ACTIVE', message: 'السرقة مفعّلة بالفعل لفريقك' };
          const victimId = targetTeamId || this.findLeadingTeamId(tId);
          if (!victimId || victimId === tId || s.eliminatedTeams.includes(victimId) || (Number(s.scores[victimId]) || 0) <= 0) {
            return { status: 'NO_TARGET', message: 'الهدف المختار لا يملك نقاطاً للسرقة (> 0)' };
          }
          s.activeEffects.stealTargets[tId] = victimId;
          bannerMsg = `🧲 (${teamName}) استهدف سرقة نقاط (${this.getTeamName(victimId)})!`;
        } else if (type === 'ai') {
          if (!s.currentQuestion) return { status: 'NO_QUESTION', message: 'لا يوجد سؤال نشط' };
          const correct = normalizeOption(s.currentQuestion.correct);
          const wrongOpts = (['A', 'B', 'C'] as OptionLetter[]).filter(
            (opt) => opt !== correct && !s.activeEffects.eliminatedOptions.includes(opt)
          );
          if (wrongOpts.length === 0) return { status: 'NO_MORE_WRONG', message: 'تم حذف الخيارات الخاطئة مسبقاً' };
          s.activeEffects.eliminatedOptions.push(wrongOpts[0]);
          bannerMsg = `✨ (${teamName}) استخدم المساعد الذكي وحذف خياراً خاطئاً!`;
        } else if (type === 'time') {
          if (s.fsmState === 'QUESTION_ACTIVE' && s.questionEndTime && !s.isTimerPaused) {
            s.questionEndTime += 15000;
            if (s.answerMode === 'CHOICE') {
              this.scheduleChoiceRevealTimeout(Math.max(100, s.questionEndTime - now));
            }
          } else {
            s.pausedRemaining = (Number(s.pausedRemaining) || 10) + 15;
          }
          bannerMsg = `⏳ (${teamName}) أضاف +15 ثانية إضافية للمؤقت!`;
        } else if (type === 'freeze') {
          if (s.answerMode === 'CHOICE') {
            return { status: 'UNSUPPORTED_IN_CHOICE', message: 'التجميد خاص بوضع الضاغط السريع فقط' };
          }
          const leaderId = this.findLeadingTeamId(tId);
          if (!leaderId) return { status: 'NO_TARGET', message: 'لا يوجد متصدر برصيد نقاط لتجميده حالياً' };
          if (Number(s.activeEffects.frozenTeams[leaderId] || 0) > now) {
            return { status: 'ALREADY_FROZEN', message: 'المتصدر مجمد بالفعل حالياً' };
          }
          s.activeEffects.frozenTeams[leaderId] = now + 8000;
          bannerMsg = `❄️ (${teamName}) جمّد ضاغط (${this.getTeamName(leaderId)}) لمدة 8 ثوانٍ!`;
        } else {
          return { status: 'UNKNOWN_TYPE', message: 'أداة غير معروفة' };
        }

        s.powerUps[tId][type] = uses - 1;
        s.activeEffects.lastPowerUpBanner = bannerMsg;
        this.commitAndBroadcast();
        return { status: 'OK', state: this.getSanitizedState() };
      }

      case 'TOGGLE_PAUSE_TIMER': {
        if (
          s.fsmState !== 'QUESTION_ACTIVE' &&
          s.fsmState !== 'BUZZER_LOCKED' &&
          s.fsmState !== 'FINAL_QUESTION_ACTIVE'
        ) {
          return { status: 'INVALID_STATE', message: 'لا يوجد مؤقت نشط لإيقافه', state: this.getSanitizedState() };
        }
        if (!s.isTimerPaused) {
          s.isTimerPaused = true;
          if ((s.fsmState === 'QUESTION_ACTIVE' || s.fsmState === 'FINAL_QUESTION_ACTIVE') && s.questionEndTime) {
            s.pausedRemaining = Math.max(1, Math.ceil((s.questionEndTime - now) / 1000));
            s.questionEndTime = null;
            if (this.choiceTimerHandle) {
              clearTimeout(this.choiceTimerHandle);
              this.choiceTimerHandle = null;
            }
            if (this.finalTimerHandle) {
              clearTimeout(this.finalTimerHandle);
              this.finalTimerHandle = null;
            }
          } else if (s.fsmState === 'BUZZER_LOCKED' && s.answerEndTime) {
            s.pausedAnswerRemaining = Math.max(1, Math.ceil((s.answerEndTime - now) / 1000));
            s.answerEndTime = null;
            if (this.answerTimerHandle) {
              clearTimeout(this.answerTimerHandle);
              this.answerTimerHandle = null;
            }
          }
          this.commitAndBroadcast();
          return { status: 'OK', message: '⏸️ تم إيقاف المؤقت مؤقتاً', state: this.getSanitizedState() };
        } else {
          s.isTimerPaused = false;
          if (s.fsmState === 'QUESTION_ACTIVE') {
            const rem = Math.max(2, Number(s.pausedRemaining) || 15);
            s.questionEndTime = now + rem * 1000;
            if (s.answerMode === 'CHOICE') {
              this.scheduleChoiceRevealTimeout(rem * 1000);
            }
          } else if (s.fsmState === 'FINAL_QUESTION_ACTIVE') {
            const rem = Math.max(2, Number(s.pausedRemaining) || 15);
            s.questionEndTime = now + rem * 1000;
            this.scheduleFinalRevealTimeout(rem * 1000);
          } else if (s.fsmState === 'BUZZER_LOCKED') {
            const ansRem = Math.min(9, Math.max(2, Number(s.pausedAnswerRemaining) || 5));
            s.answerEndTime = now + ansRem * 1000;
            this.scheduleAnswerTimeout(ansRem * 1000);
          }
          this.commitAndBroadcast();
          return { status: 'OK', message: '▶️ تم استئناف المؤقت', state: this.getSanitizedState() };
        }
      }

      case 'REPLACE_ACTIVE_QUESTION': {
        const used = new Set(s.usedQuestionIds.map(Number));
        const activeRound = cleanArabicLabel(s.selectedRound, 'ALL');
        const targetCat = s.selectedCategory ? cleanArabicLabel(s.selectedCategory, '') : null;
        const targetDiff = s.selectedDifficulty ? normalizeDifficulty(s.selectedDifficulty) : null;

        let replacement = this.store.questions.find(
          (q) =>
            !used.has(Number(q.id)) &&
            (activeRound === 'ALL' || cleanArabicLabel(q.round, 'الجولة 1') === activeRound) &&
            (!targetCat || cleanArabicLabel(q.category, 'عام') === targetCat) &&
            (!targetDiff || normalizeDifficulty(q.difficulty) === targetDiff)
        );
        if (!replacement) {
          replacement = this.store.questions.find(
            (q) => !used.has(Number(q.id)) && (activeRound === 'ALL' || cleanArabicLabel(q.round, 'الجولة 1') === activeRound)
          );
        }
        if (!replacement) {
          return { status: 'EMPTY', message: '⚠️ لا توجد أسئلة بديلة متاحة حالياً', state: this.getSanitizedState() };
        }
        s.refereeNotice = { text: '🔄 قرار المذيع: تم استبدال السؤال بسؤال بديل نظيف', at: now };
        return this.launchQuestionInternal(replacement);
      }

      case 'ELIMINATE_LOWEST_TEAM': {
        const count = Number(s.settings.teamCount) || 4;
        const activeIds: string[] = [];
        for (let i = 1; i <= count; i++) {
          const id = String(i);
          if (!s.eliminatedTeams.includes(id)) activeIds.push(id);
        }
        if (activeIds.length <= 2) {
          return { status: 'MIN_REACHED', message: 'يجب بقاء فريقين على الأقل في المنافسة', state: this.getSanitizedState() };
        }
        let lowestId = activeIds[0];
        let minScore = Number(s.scores[lowestId]) || 0;
        for (const id of activeIds) {
          const sc = Number(s.scores[id]) || 0;
          if (sc < minScore) {
            minScore = sc;
            lowestId = id;
          }
        }
        this.clearAllScheduledTimers();
        s.eliminatedTeams.push(lowestId);
        s.lastEliminatedTeam = lowestId;
        if (s.eliminatedTeams.includes(s.activeTurnTeamId)) {
          s.activeTurnTeamId = this.computeNextTurnTeamId();
        }
        const isBoardBased = s.settings.playMode === 'BOARD' || s.settings.playMode === 'AUTO_CATEGORY';
        s.fsmState = isBoardBased ? 'CATEGORY_BOARD' : 'WAITING_LOBBY';
        s.currentQuestion = null;
        s.questionInstanceId = null;
        s.lockedTeamId = null;
        s.timedOutTeamId = null;
        s.selectedCategory = null;
        s.selectedDifficulty = null;
        s.autoTransitionAction = null;
        s.autoTransitionAt = null;
        s.isTimerPaused = false;
        s.activeEffects = getEmptyEffects();
        this.commitAndBroadcast();
        return { status: 'OK', state: this.getSanitizedState() };
      }

      case 'RESTORE_ALL_TEAMS': {
        s.eliminatedTeams = [];
        s.lastEliminatedTeam = null;
        this.commitAndBroadcast();
        return { status: 'OK', state: this.getSanitizedState() };
      }

      case 'START_FINAL_WAGER': {
        if (this.store.questions.length === 0) {
          return {
            status: 'EMPTY',
            message: '⚠️ قاعدة الأسئلة فارغة — أضف سؤالاً أولاً لإطلاق الجولة النهائية',
            state: this.getSanitizedState(),
          };
        }
        const used = new Set(s.usedQuestionIds.map(Number));
        const activeRound = cleanArabicLabel(s.selectedRound, 'ALL');
        let finalQ = this.store.questions.find(
          (q) =>
            !used.has(Number(q.id)) &&
            normalizeDifficulty(q.difficulty) === 'صعب' &&
            (activeRound === 'ALL' || cleanArabicLabel(q.round, 'الجولة 1') === activeRound)
        );
        if (!finalQ) {
          finalQ = this.store.questions.find(
            (q) =>
              !used.has(Number(q.id)) &&
              (activeRound === 'ALL' || cleanArabicLabel(q.round, 'الجولة 1') === activeRound)
          );
        }
        if (!finalQ) {
          finalQ = this.store.questions.find((q) => !used.has(Number(q.id)));
        }
        if (!finalQ) {
          finalQ = this.store.questions[this.store.questions.length - 1];
        }

        this.clearAllScheduledTimers();
        this.store.finalWagers = { questionId: Number(finalQ.id), wagers: {} };
        this.store.secretChoices = { questionInstanceId: null, choices: {} };

        s.fsmState = 'FINAL_WAGER_OPEN';
        s.currentQuestion = null;
        s.questionInstanceId = null;
        s.questionEndTime = null;
        s.answerEndTime = null;
        s.autoTransitionAction = null;
        s.autoTransitionAt = null;
        s.lockedTeamId = null;
        s.timedOutTeamId = null;
        s.attemptedTeamsThisQuestion = [];
        s.votedTeams = [];
        s.revealedChoices = null;
        s.activeEffects = getEmptyEffects();
        s.activeMysteryTwist = null;
        s.activeTrapTrigger = null;
        s.armedDuel = null;
        s.activeDuel = null;
        s.activeBomb = null;
        s.powerUpsLockedThisQuestion = false;
        s.isTimerPaused = false;
        s.finalCategoryLabel = cleanArabicLabel(finalQ.category, 'ثقافة عامة');
        s.finalWageredTeams = [];
        s.finalMinWager = 50;
        s.finalResults = null;

        this.commitAndBroadcast();
        return {
          status: 'OK',
          message: `🔥 فُتح باب المراهنة السرية للجولة النهائية (الفئة: ${s.finalCategoryLabel})`,
          state: this.getSanitizedState(),
        };
      }

      case 'SUBMIT_FINAL_WAGER': {
        const tId = String(payload.teamId || '');
        if (!this.isValidTeamToken(tId, payload.teamToken)) {
          return {
            status: 'REJECTED',
            accepted: false,
            reason: 'INVALID_TEAM_TOKEN',
            message: '🔒 رابط الفريق غير صالح — امسح الباركود الخاص بفريقك',
            state: this.getSanitizedState(),
          };
        }
        if (s.fsmState !== 'FINAL_WAGER_OPEN') {
          return {
            status: 'REJECTED',
            accepted: false,
            reason: 'INVALID_STATE',
            message: 'باب المراهنة السرية غير مفتوح حالياً',
            state: this.getSanitizedState(),
          };
        }
        if (s.eliminatedTeams.includes(tId)) {
          return {
            status: 'REJECTED',
            accepted: false,
            reason: 'ELIMINATED',
            message: 'فريقك مستبعد في هذه الجولة',
            state: this.getSanitizedState(),
          };
        }
        if (s.finalWageredTeams.includes(tId)) {
          return {
            status: 'REJECTED',
            accepted: false,
            reason: 'ALREADY_WAGERED',
            message: 'تم تثبيت رهانك السري مسبقاً',
            state: this.getSanitizedState(),
          };
        }

        const teamScore = Math.max(0, Number(s.scores[tId]) || 0);
        const maxWager = Math.max(Number(s.finalMinWager) || 50, teamScore);
        const rawWager = Math.round(Number(payload.wager) || 0);
        const clampedWager = Math.min(maxWager, Math.max(0, rawWager));

        if (!this.store.finalWagers) {
          this.store.finalWagers = { questionId: null, wagers: {} };
        }
        this.store.finalWagers.wagers[tId] = clampedWager;
        s.finalWageredTeams.push(tId);

        this.commitAndBroadcast();
        return {
          status: 'OK',
          accepted: true,
          message: `🔐 تم تثبيت رهانكم السري (${clampedWager} نقطة)`,
          state: this.getSanitizedState(),
        };
      }

      case 'LAUNCH_FINAL_QUESTION': {
        if (s.fsmState !== 'FINAL_WAGER_OPEN') {
          return {
            status: 'INVALID_STATE',
            message: 'يجب فتح مرحلة الرهان النهائي أولاً',
            state: this.getSanitizedState(),
          };
        }
        const targetId = this.store.finalWagers?.questionId;
        const finalQ =
          this.store.questions.find((q) => Number(q.id) === Number(targetId)) ||
          this.store.questions[0];
        if (!finalQ) {
          return {
            status: 'EMPTY',
            message: 'لم يتم العثور على سؤال للجولة النهائية',
            state: this.getSanitizedState(),
          };
        }

        const teamCount = Number(s.settings.teamCount) || 4;
        if (!this.store.finalWagers) {
          this.store.finalWagers = { questionId: Number(finalQ.id), wagers: {} };
        }
        for (let i = 1; i <= teamCount; i++) {
          const id = String(i);
          if (this.store.finalWagers.wagers[id] === undefined) {
            this.store.finalWagers.wagers[id] = 0;
          }
        }

        this.clearAllScheduledTimers();
        const qId = Number(finalQ.id);
        if (!s.usedQuestionIds.includes(qId)) {
          s.usedQuestionIds.push(qId);
        }

        const duration = Math.max(15, Number(s.settings.timerSeconds) || 25);
        const instanceId = `final_${qId}_${now}`;
        const img = sanitizeMediaUrl(finalQ.imageUrl);
        const aud = sanitizeMediaUrl(finalQ.audioUrl);
        const expl = cleanArabicLabel(finalQ.explanation, '');

        s.fsmState = 'FINAL_QUESTION_ACTIVE';
        s.answerMode = 'CHOICE';
        s.currentQuestion = {
          id: qId,
          round: cleanArabicLabel(finalQ.round, 'الجولة النهائية'),
          category: cleanArabicLabel(finalQ.category, 'ثقافة عامة'),
          difficulty: normalizeDifficulty(finalQ.difficulty),
          question: finalQ.question,
          options: { ...finalQ.options },
          correct: normalizeOption(finalQ.correct),
          ...(img ? { imageUrl: img } : {}),
          ...(aud ? { audioUrl: aud } : {}),
          ...(expl ? { explanation: expl } : {}),
        };
        s.questionInstanceId = instanceId;
        s.questionStartedAt = now;
        s.currentRoundLabel = 'الجولة النهائية الحاسمة';
        s.currentQuestionPoints = 0;
        s.votedTeams = [];
        s.revealedChoices = null;
        s.finalResults = null;
        s.activeEffects = getEmptyEffects();
        s.isTimerPaused = false;
        s.pausedRemaining = duration;
        s.questionEndTime = now + duration * 1000;
        s.answerEndTime = null;
        s.matchStats.questionsPlayed = (Number(s.matchStats.questionsPlayed) || 0) + 1;

        this.store.secretChoices = { questionInstanceId: instanceId, choices: {} };
        this.scheduleFinalRevealTimeout(duration * 1000);
        this.commitAndBroadcast();

        return {
          status: 'OK',
          message: '🚀 انطلق السؤال النهائي الحاسم بالتصويت السري!',
          state: this.getSanitizedState(),
        };
      }

      case 'REVEAL_FINAL_RESULTS': {
        return this.revealFinalResultsInternal();
      }

      case 'TRIGGER_CELEBRATION': {
        this.clearAllScheduledTimers();
        s.fsmState = 'CELEBRATION_PODIUM';
        s.currentQuestion = null;
        s.questionInstanceId = null;
        s.questionEndTime = null;
        s.answerEndTime = null;
        s.autoTransitionAction = null;
        s.autoTransitionAt = null;
        s.lockedTeamId = null;
        s.timedOutTeamId = null;
        s.isTimerPaused = false;
        s.activeMysteryTwist = null;
        s.activeTrapTrigger = null;
        s.armedDuel = null;
        s.activeDuel = null;
        s.activeBomb = null;
        s.powerUpsLockedThisQuestion = false;
        this.commitAndBroadcast();
        return { status: 'OK', state: this.getSanitizedState() };
      }

      case 'RESET_SCORES': {
        for (let i = 1; i <= MAX_TEAMS; i++) s.scores[String(i)] = 0;
        s.teamStreaks = buildDefaultStreaks();
        s.teamBounties = syncTeamBounties(s.teamStreaks);
        s.lastBountyClaim = null;
        s.previousRanks = {};
        this.store.undoSnapshot = null;
        this.commitAndBroadcast();
        return { status: 'OK', message: '✅ تم تصفير نقاط جميع الفرق بنجاح', state: this.getSanitizedState() };
      }

      case 'RESET_POWERUPS': {
        s.powerUps = buildPowerUpsQuota(s.settings);
        s.duelCredits = buildDefaultCredits(1);
        s.bombCredits = buildDefaultCredits(1);
        s.activeEffects = getEmptyEffects();
        this.commitAndBroadcast();
        return { status: 'OK', message: '✅ تمت إعادة تعبئة رصيد الأدوات التكتيكية والمبارزات والقنابل', state: this.getSanitizedState() };
      }

      case 'RESET_USED_QUESTIONS': {
        this.clearAllScheduledTimers();
        const isBoardBased = s.settings.playMode === 'BOARD' || s.settings.playMode === 'AUTO_CATEGORY';
        s.usedQuestionIds = [];
        s.fsmState = isBoardBased ? 'CATEGORY_BOARD' : 'WAITING_LOBBY';
        s.currentQuestion = null;
        s.questionInstanceId = null;
        s.questionEndTime = null;
        s.answerEndTime = null;
        s.lockedTeamId = null;
        s.timedOutTeamId = null;
        s.attemptedTeamsThisQuestion = [];
        s.votedTeams = [];
        s.revealedChoices = null;
        s.selectedCategory = null;
        s.selectedDifficulty = null;
        s.boardNotice = null;
        s.autoTransitionAction = null;
        s.autoTransitionAt = null;
        s.isTimerPaused = false;
        s.activeEffects = getEmptyEffects();
        s.activeMysteryTwist = null;
        s.activeTrapTrigger = null;
        s.armedDuel = null;
        s.activeDuel = null;
        s.activeBomb = null;
        s.powerUpsLockedThisQuestion = false;
        s.finalCategoryLabel = null;
        s.finalWageredTeams = [];
        s.finalResults = null;
        s.questionsVersion = (Number(s.questionsVersion) || 1) + 1;
        this.store.secretChoices = { questionInstanceId: null, choices: {} };
        this.store.finalWagers = { questionId: null, wagers: {} };
        const rebuiltMystery = buildBalancedMysterySlots(this.store.questions, s.selectedRound);
        this.store.mysterySlots = rebuiltMystery.slots;
        this.store.mysterySlotSentiments = rebuiltMystery.sentiments;
        this.store.undoSnapshot = null;
        this.commitAndBroadcast(true);
        return {
          status: 'OK',
          message: `✅ تمت إعادة فتح جميع الأسئلة (${this.store.questions.length} سؤال)`,
          questions: this.getStrippedQuestions(),
          state: this.getSanitizedState(),
        };
      }

      case 'RESET_FULL_MATCH': {
        this.clearAllScheduledTimers();
        const fresh = buildFreshState(s.settings, this.store.questions);
        fresh.stateRevision = s.stateRevision;
        fresh.activeTheme = s.activeTheme;
        fresh.customTokens = s.customTokens;
        fresh.answerMode = s.answerMode;
        fresh.questionsVersion = (Number(s.questionsVersion) || 1) + 1;
        fresh.selectedRound = s.selectedRound || 'ALL';
        fresh.currentRoundLabel = s.currentRoundLabel || 'جميع الجولات';
        fresh.hostPinEnabled = Boolean(cleanArabicLabel(this.store.hostPin, ''));
        fresh.hostAuthRevision = Number(s.hostAuthRevision) || 1;
        this.store.teamTokens = generateTeamTokens();
        fresh.teamTokensVersion = (Number(s.teamTokensVersion) || 1) + 1;
        this.store.state = fresh;
        this.store.secretChoices = { questionInstanceId: null, choices: {} };
        this.store.finalWagers = { questionId: null, wagers: {} };
        this.store.teamTraps = {};
        const rebuiltMystery = buildBalancedMysterySlots(this.store.questions, fresh.selectedRound);
        this.store.mysterySlots = rebuiltMystery.slots;
        this.store.mysterySlotSentiments = rebuiltMystery.sentiments;
        this.store.undoSnapshot = null;
        this.commitAndBroadcast(true);
        return {
          status: 'OK',
          message: `✅ تم التصفير الشامل للمباراة وتجديد رموز الفرق (${this.store.questions.length} سؤال جاهز)`,
          questions: this.getStrippedQuestions(),
          state: this.getSanitizedState(),
        };
      }

      case 'REGENERATE_TEAM_TOKENS': {
        this.store.teamTokens = generateTeamTokens();
        s.teamTokensVersion = (Number(s.teamTokensVersion) || 1) + 1;
        this.commitAndBroadcast();
        return {
          status: 'OK',
          message: '🔄 تم توليد رموز دخول جديدة وإلغاء الروابط القديمة لجميع الفرق',
          state: this.getSanitizedState(),
        };
      }

      case 'SAVE_SETTINGS': {
        const incoming = (payload.settings || {}) as Partial<GameSettings>;
        const defaults = getDefaultSettings();
        const validModes: PlayMode[] = ['BOARD', 'AUTO_CATEGORY', 'AUTO_ALL', 'MANUAL'];
        const mode: PlayMode = validModes.includes(incoming.playMode as PlayMode)
          ? (incoming.playMode as PlayMode)
          : 'BOARD';
        const validFonts: FontPairId[] = ['cairo-almarai', 'tajawal', 'ibm'];
        const fontPair: FontPairId = validFonts.includes(incoming.fontPair as FontPairId)
          ? (incoming.fontPair as FontPairId)
          : 'cairo-almarai';

        const sanitized: GameSettings = {
          playMode: mode,
          defaultAnswerMode: incoming.defaultAnswerMode === 'CHOICE' ? 'CHOICE' : 'BUZZER',
          teamCount: Math.min(8, Math.max(2, Number(incoming.teamCount) || 4)),
          team1Name: cleanArabicLabel(incoming.team1Name, defaults.team1Name),
          team2Name: cleanArabicLabel(incoming.team2Name, defaults.team2Name),
          team3Name: cleanArabicLabel(incoming.team3Name, defaults.team3Name),
          team4Name: cleanArabicLabel(incoming.team4Name, defaults.team4Name),
          team5Name: cleanArabicLabel(incoming.team5Name, defaults.team5Name),
          team6Name: cleanArabicLabel(incoming.team6Name, defaults.team6Name),
          team7Name: cleanArabicLabel(incoming.team7Name, defaults.team7Name),
          team8Name: cleanArabicLabel(incoming.team8Name, defaults.team8Name),
          timerSeconds: Math.max(5, Number(incoming.timerSeconds) || 25),
          answerSeconds: Math.min(9, Math.max(3, Number(incoming.answerSeconds) || 7)),
          pointsEasy: Math.max(10, Number(incoming.pointsEasy) || 100),
          pointsMedium: Math.max(10, Number(incoming.pointsMedium) || 200),
          pointsHard: Math.max(10, Number(incoming.pointsHard) || 300),
          pointsWrongPenalty: Math.max(0, Number(incoming.pointsWrongPenalty) || 0),
          powerUpsEnabled: !(incoming.powerUpsEnabled === false || String(incoming.powerUpsEnabled) === 'false'),
          puShieldCount: Math.min(10, Math.max(0, Number(incoming.puShieldCount ?? 1))),
          puAiCount: Math.min(10, Math.max(0, Number(incoming.puAiCount ?? 1))),
          puDoubleCount: Math.min(10, Math.max(0, Number(incoming.puDoubleCount ?? 1))),
          puFreezeCount: Math.min(10, Math.max(0, Number(incoming.puFreezeCount ?? 1))),
          puStealCount: Math.min(10, Math.max(0, Number(incoming.puStealCount ?? 1))),
          puTimeCount: Math.min(10, Math.max(0, Number(incoming.puTimeCount ?? 1))),
          fontPair,
        };

        if (payload.clearHostPin === true) {
          this.store.hostPin = '';
          s.hostPinEnabled = false;
          s.hostAuthRevision = (Number(s.hostAuthRevision) || 1) + 1;
        } else if (typeof payload.newHostPin === 'string' && cleanArabicLabel(payload.newHostPin, '')) {
          const nextPin = cleanArabicLabel(payload.newHostPin, '').slice(0, 16);
          this.store.hostPin = nextPin;
          s.hostPinEnabled = true;
          s.hostAuthRevision = (Number(s.hostAuthRevision) || 1) + 1;
        }

        s.settings = sanitized;
        s.answerMode = sanitized.defaultAnswerMode;
        s.powerUps = buildPowerUpsQuota(sanitized);
        const isBoardBased = mode === 'BOARD' || mode === 'AUTO_CATEGORY';
        if (s.fsmState === 'WAITING_LOBBY' || s.fsmState === 'CATEGORY_BOARD') {
          s.fsmState = isBoardBased ? 'CATEGORY_BOARD' : 'WAITING_LOBBY';
          s.pausedRemaining = sanitized.timerSeconds;
        }
        this.commitAndBroadcast();
        return { status: 'OK', state: this.getSanitizedState() };
      }

      case 'UPDATE_VISUAL_THEME': {
        const validThemes: ThemeId[] = ['luxury', 'snow', 'sunrise', 'azure', 'lavender', 'classic'];
        if (payload.activeTheme && validThemes.includes(payload.activeTheme as ThemeId)) {
          s.activeTheme = payload.activeTheme as ThemeId;
        }
        if (payload.customTokens && typeof payload.customTokens === 'object') {
          s.customTokens = payload.customTokens as Record<string, string>;
        }
        this.commitAndBroadcast();
        return { status: 'OK', state: this.getSanitizedState() };
      }

      case 'ADD_QUESTION': {
        const qText = cleanArabicLabel(payload.question, '');
        if (!qText) return { status: 'INVALID', message: 'نص السؤال مطلوب' };
        const maxId = this.store.questions.reduce((max, q) => Math.max(max, Number(q.id) || 0), 0);
        const img = sanitizeMediaUrl(payload.imageUrl);
        const aud = sanitizeMediaUrl(payload.audioUrl);
        const expl = cleanArabicLabel(payload.explanation, '');
        const newItem: QuestionItem = {
          id: maxId + 1,
          round: cleanArabicLabel(payload.round, 'الجولة 1'),
          category: cleanArabicLabel(payload.category, 'عام'),
          difficulty: normalizeDifficulty(payload.difficulty),
          question: qText,
          options: {
            A: cleanArabicLabel(payload.optA, 'الخيار A'),
            B: cleanArabicLabel(payload.optB, 'الخيار B'),
            C: cleanArabicLabel(payload.optC, 'الخيار C'),
          },
          correct: normalizeOption(payload.correct),
          ...(img ? { imageUrl: img } : {}),
          ...(aud ? { audioUrl: aud } : {}),
          ...(expl ? { explanation: expl } : {}),
        };
        this.store.questions.push(newItem);
        if (!this.store.mysterySlots || this.store.mysterySlots.length === 0) {
          const rebuilt = buildBalancedMysterySlots(this.store.questions, s.selectedRound);
          this.store.mysterySlots = rebuilt.slots;
          this.store.mysterySlotSentiments = rebuilt.sentiments;
        }
        s.questionsVersion = (Number(s.questionsVersion) || 1) + 1;
        this.commitAndBroadcast(true);
        return {
          status: 'OK',
          message: '✅ تمت إضافة السؤال وحفظه تلقائياً',
          questions: this.getStrippedQuestions(),
          state: this.getSanitizedState(),
        };
      }

      case 'BULK_IMPORT_QUESTIONS': {
        const rows = Array.isArray(payload.rows) ? (payload.rows as ImportedQuestionRow[]) : [];
        if (rows.length === 0) return { status: 'EMPTY', message: 'لم يتم العثور على صفوف صالحة' };

        let nextId = this.store.questions.reduce((max, q) => Math.max(max, Number(q.id) || 0), 0);
        let added = 0;

        for (const item of rows) {
          const qText = cleanArabicLabel(item.question, '');
          if (!qText) continue;
          nextId++;
          added++;
          const img = sanitizeMediaUrl(item.imageUrl);
          const aud = sanitizeMediaUrl(item.audioUrl);
          const expl = cleanArabicLabel(item.explanation, '');
          this.store.questions.push({
            id: nextId,
            round: cleanArabicLabel(item.round, 'الجولة 1'),
            category: cleanArabicLabel(item.category, 'عام'),
            difficulty: normalizeDifficulty(item.difficulty),
            question: qText,
            options: {
              A: cleanArabicLabel(item.optA, ''),
              B: cleanArabicLabel(item.optB, ''),
              C: cleanArabicLabel(item.optC, ''),
            },
            correct: normalizeOption(item.correct),
            ...(img ? { imageUrl: img } : {}),
            ...(aud ? { audioUrl: aud } : {}),
            ...(expl ? { explanation: expl } : {}),
          });
        }

        if (added === 0) return { status: 'EMPTY', message: 'لم يتم العثور على أسئلة صالحة' };
        const rebuilt = buildBalancedMysterySlots(this.store.questions, s.selectedRound);
        this.store.mysterySlots = rebuilt.slots;
        this.store.mysterySlotSentiments = rebuilt.sentiments;
        s.questionsVersion = (Number(s.questionsVersion) || 1) + 1;
        this.commitAndBroadcast(true);
        return {
          status: 'OK',
          importedCount: added,
          questions: this.getStrippedQuestions(),
          state: this.getSanitizedState(),
        };
      }

      case 'WIPE_QUESTIONS': {
        this.clearAllScheduledTimers();
        this.store.questions = [];
        const fresh = buildFreshState(s.settings, []);
        fresh.stateRevision = s.stateRevision;
        fresh.activeTheme = s.activeTheme;
        fresh.customTokens = s.customTokens;
        fresh.questionsVersion = (Number(s.questionsVersion) || 1) + 1;
        fresh.hostPinEnabled = Boolean(cleanArabicLabel(this.store.hostPin, ''));
        fresh.hostAuthRevision = Number(s.hostAuthRevision) || 1;
        fresh.teamTokensVersion = Number(s.teamTokensVersion) || 1;
        this.store.state = fresh;
        this.store.secretChoices = { questionInstanceId: null, choices: {} };
        this.store.finalWagers = { questionId: null, wagers: {} };
        this.store.teamTraps = {};
        this.store.mysterySlots = [];
        this.store.mysterySlotSentiments = {};
        this.store.undoSnapshot = null;
        this.commitAndBroadcast(true);
        return {
          status: 'OK',
          message: '🗑️ تم حذف جميع الأسئلة وبناء قاعدة نظيفة فارغة',
          questions: [],
          state: this.getSanitizedState(),
        };
      }

      case 'LOAD_SAMPLE_QUESTIONS': {
        this.clearAllScheduledTimers();
        this.store.questions = SAMPLE_QUESTIONS.map((q) => ({ ...q, options: { ...q.options } }));
        const fresh = buildFreshState(s.settings, this.store.questions);
        fresh.stateRevision = s.stateRevision;
        fresh.activeTheme = s.activeTheme;
        fresh.customTokens = s.customTokens;
        fresh.questionsVersion = (Number(s.questionsVersion) || 1) + 1;
        fresh.hostPinEnabled = Boolean(cleanArabicLabel(this.store.hostPin, ''));
        fresh.hostAuthRevision = Number(s.hostAuthRevision) || 1;
        fresh.teamTokensVersion = Number(s.teamTokensVersion) || 1;
        this.store.state = fresh;
        this.store.secretChoices = { questionInstanceId: null, choices: {} };
        this.store.finalWagers = { questionId: null, wagers: {} };
        this.store.teamTraps = {};
        const rebuilt = buildBalancedMysterySlots(this.store.questions, fresh.selectedRound);
        this.store.mysterySlots = rebuilt.slots;
        this.store.mysterySlotSentiments = rebuilt.sentiments;
        this.store.undoSnapshot = null;
        this.commitAndBroadcast(true);
        return {
          status: 'OK',
          message: `✅ تم استعادة (${this.store.questions.length}) سؤالاً نموذجياً بنجاح`,
          questions: this.getStrippedQuestions(),
          state: this.getSanitizedState(),
        };
      }

      default:
        return { status: 'UNKNOWN_ACTION', message: 'أمر غير معروف' };
    }
  }
}

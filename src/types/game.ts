export type ScreenView = 'host' | 'tv' | 'mobile' | 'settings';
export type PlayMode = 'BOARD' | 'AUTO_CATEGORY' | 'AUTO_ALL' | 'MANUAL';
export type AnswerMode = 'BUZZER' | 'CHOICE';
export type ThemeId = 'luxury' | 'snow' | 'sunrise' | 'azure' | 'lavender' | 'classic';
export type FontPairId = 'cairo-almarai' | 'tajawal' | 'ibm';
export type PowerUpType = 'shield' | 'ai' | 'double' | 'freeze' | 'steal' | 'time';
export type OptionLetter = 'A' | 'B' | 'C';
export type DifficultyLevel = 'سهل' | 'متوسط' | 'صعب';

export type FsmState =
  | 'TRAP_SETUP'
  | 'CATEGORY_BOARD'
  | 'WAITING_LOBBY'
  | 'QUESTION_ACTIVE'
  | 'BUZZER_LOCKED'
  | 'ANSWER_TIMEOUT'
  | 'ANSWER_CORRECT'
  | 'ANSWER_WRONG'
  | 'CHOICE_REVEALED'
  | 'FINAL_WAGER_OPEN'
  | 'FINAL_QUESTION_ACTIVE'
  | 'FINAL_REVEALED'
  | 'CELEBRATION_PODIUM';

export type MysteryTwistType =
  | 'DOUBLE_POINTS'
  | 'FREE_POWERUP'
  | 'NO_PENALTY'
  | 'BONUS_PLUS_150'
  | 'BLITZ_HALF_TIME'
  | 'POWERUP_BLACKOUT'
  | 'CURSED_PENALTY'
  | 'ROBIN_HOOD';

export interface MysteryTwistInfo {
  type: MysteryTwistType;
  sentiment: 'GOOD' | 'BAD';
  title: string;
  desc: string;
  teamName: string;
}

export type TrapType =
  | 'STEAL_TRAP'
  | 'HALF_TIME_TRAP'
  | 'SILENCE_POWERUPS_TRAP'
  | 'DOUBLE_PENALTY_TRAP';

export interface TeamTrapPlacement {
  slotKey: string;
  category: string;
  difficulty: DifficultyLevel;
  type: TrapType;
}

export interface ActiveTrapTrigger {
  type: TrapType;
  status: 'DETONATED' | 'DISARMED_SELF';
  ownerTeamId: string;
  ownerTeamName: string;
  triggeredByTeamId: string;
  triggeredByTeamName: string;
  title: string;
  desc: string;
}

export interface BountyClaimInfo {
  hunterTeamId: string;
  hunterTeamName: string;
  targetTeamId: string;
  targetTeamName: string;
  amount: number;
  brokenStreak: number;
  at: number;
}

export interface ArmedDuelInfo {
  challengerId: string;
  challengerName: string;
  opponentId: string;
  opponentName: string;
}

export interface ActiveDuelInfo {
  challengerId: string;
  challengerName: string;
  opponentId: string;
  opponentName: string;
  multiplier: number;
  winnerId?: string | null;
  summary?: string | null;
}

export interface ActiveBombInfo {
  throwerId: string;
  throwerName: string;
  targetId: string;
  targetName: string;
  status: 'TICKING' | 'DEFUSED' | 'EXPLODED';
  summary?: string | null;
}

export interface TeamTrapsResponse {
  status: 'OK' | 'INVALID_TOKEN';
  traps?: TeamTrapPlacement[];
  ready?: boolean;
  maxTraps?: number;
  message?: string;
}

export interface QuestionItem {
  id: number;
  round: string;
  category: string;
  difficulty: DifficultyLevel;
  question: string;
  options: {
    A: string;
    B: string;
    C: string;
  };
  correct?: OptionLetter;
  imageUrl?: string;
  audioUrl?: string;
  explanation?: string;
}

export interface ImportedQuestionRow {
  round: string;
  category: string;
  difficulty: string;
  question: string;
  optA: string;
  optB: string;
  optC: string;
  correct: string;
  imageUrl?: string;
  audioUrl?: string;
  explanation?: string;
}

export interface TeamPowerUps {
  shield: number;
  ai: number;
  double: number;
  freeze: number;
  steal: number;
  time: number;
}

export interface ActiveEffects {
  shieldTeams: string[];
  doubleTeams: string[];
  stealTargets: Record<string, string>;
  eliminatedOptions: OptionLetter[];
  frozenTeams: Record<string, number>;
  lastPowerUpBanner: string | null;
}

export interface GameSettings {
  playMode: PlayMode;
  defaultAnswerMode: AnswerMode;
  teamCount: number;
  team1Name: string;
  team2Name: string;
  team3Name: string;
  team4Name: string;
  team5Name: string;
  team6Name: string;
  team7Name: string;
  team8Name: string;
  timerSeconds: number;
  answerSeconds: number;
  pointsEasy: number;
  pointsMedium: number;
  pointsHard: number;
  pointsWrongPenalty: number;
  powerUpsEnabled: boolean;
  puShieldCount: number;
  puAiCount: number;
  puDoubleCount: number;
  puFreezeCount: number;
  puStealCount: number;
  puTimeCount: number;
  fontPair: FontPairId;
}

export interface RevealedTeamResult {
  option: OptionLetter | null;
  status: 'CORRECT' | 'WRONG' | 'NO_VOTE';
  delta: number;
  score: number;
}

export interface RevealedChoicesPayload {
  questionId: number;
  correctOption: OptionLetter;
  winnersCount: number;
  results: Record<string, RevealedTeamResult>;
}

export interface FinalWagerTeamResult {
  wager: number;
  option: OptionLetter | null;
  status: 'CORRECT' | 'WRONG' | 'NO_VOTE';
  delta: number;
  score: number;
}

export interface FinalRevealedPayload {
  questionId: number;
  correctOption: OptionLetter;
  winnersCount: number;
  results: Record<string, FinalWagerTeamResult>;
}

export interface StealSummary {
  thiefId: string;
  thiefName: string;
  victimId: string;
  victimName: string;
  amount: number;
}

export interface RefereeNotice {
  text: string;
  at: number;
}

export interface MatchStats {
  questionsPlayed: number;
  buzzerHits: number;
  secretVotesTotal: number;
  fastestTeamName: string;
  fastestMs: number;
}

export type BoardMatrix = Record<string, Record<DifficultyLevel, number>>;

export interface GameState {
  stateRevision: number;
  stateTimestamp: number;
  serverNow: number;
  fsmState: FsmState;
  answerMode: AnswerMode;
  activeTheme: ThemeId;
  customTokens: Record<string, string>;
  settings: GameSettings;
  questionsVersion: number;
  totalQuestionsCount: number;
  boardMatrix: BoardMatrix;
  activeTurnTeamId: string;
  selectedRound: string;
  selectedCategory: string | null;
  selectedDifficulty: DifficultyLevel | null;
  usedQuestionIds: number[];
  currentRoundLabel: string;
  currentQuestion: QuestionItem | null;
  questionInstanceId: string | null;
  questionStartedAt: number | null;
  currentQuestionPoints: number;
  questionEndTime: number | null;
  answerEndTime: number | null;
  pausedRemaining: number;
  pausedAnswerRemaining: number;
  isTimerPaused: boolean;
  autoTransitionAction: 'RETURN_TO_BOARD' | 'NEXT_IN_SLOT' | 'NEXT_IN_ALL' | null;
  autoTransitionAt: number | null;
  lockedTeamId: string | null;
  timedOutTeamId: string | null;
  attemptedTeamsThisQuestion: string[];
  votedTeams: string[];
  revealedChoices: RevealedChoicesPayload | null;
  eliminatedTeams: string[];
  lastEliminatedTeam: string | null;
  lastStealSummary: StealSummary | null;
  refereeNotice: RefereeNotice | null;
  boardNotice: string | null;
  scores: Record<string, number>;
  powerUps: Record<string, TeamPowerUps>;
  activeEffects: ActiveEffects;
  canUndoEvaluation: boolean;
  undoSummary: string;
  matchStats: MatchStats;
  hostPinEnabled: boolean;
  hostAuthRevision: number;
  teamTokensVersion: number;
  activeMysteryTwist: MysteryTwistInfo | null;
  teamStreaks: Record<string, number>;
  previousRanks: Record<string, number>;
  finalCategoryLabel: string | null;
  finalWageredTeams: string[];
  finalMinWager: number;
  finalResults: FinalRevealedPayload | null;
  trapSetupReadyTeams: string[];
  totalActiveTrapsCount: number;
  activeTrapTrigger: ActiveTrapTrigger | null;
  teamBounties: Record<string, number>;
  lastBountyClaim: BountyClaimInfo | null;
  duelCredits: Record<string, number>;
  armedDuel: ArmedDuelInfo | null;
  activeDuel: ActiveDuelInfo | null;
  bombCredits: Record<string, number>;
  activeBomb: ActiveBombInfo | null;
  powerUpsLockedThisQuestion: boolean;
}

export interface HostAnswersResponse {
  status: 'OK' | 'INVALID_PIN' | 'ERROR';
  answers?: Record<number, OptionLetter>;
  hostAuthRevision?: number;
  message?: string;
}

export interface HostTeamTokensResponse {
  status: 'OK' | 'ERROR';
  teamTokens?: Record<string, string>;
  teamTokensVersion?: number;
  message?: string;
}

export interface VerifyTeamTokenResponse {
  status: 'OK' | 'INVALID_TOKEN';
  valid: boolean;
  teamId?: string;
  message?: string;
}

export interface ActionResponse {
  status: string;
  accepted?: boolean;
  reason?: string;
  message?: string;
  lockedBy?: string | null;
  myChoice?: OptionLetter;
  importedCount?: number;
  state?: GameState;
  questions?: QuestionItem[];
}

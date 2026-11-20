import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  PersistedStore,
  QuestionItem,
  GameState,
  GameSettings,
  TeamTrapPlacement,
  TeamPowerUps,
  ActiveEffects,
  MysteryTwistInfo,
  ActiveTrapTrigger,
  BountyClaimInfo,
  ArmedDuelInfo,
  ActiveDuelInfo,
  ActiveBombInfo,
  MatchStats,
  SecretChoicesStore,
  UndoSnapshot,
  FinalWagersStore,
} from '../src/types/game.ts';
import { SAMPLE_QUESTIONS } from './engine.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'trivia.sqlite');

function getDatabasePath(): string {
  // Cloud Run with Cloud SQL provides INSTANCE_CONNECTION_NAME env var
  // Unix socket path: /cloudsql/<INSTANCE_CONNECTION_NAME>/<DB_NAME>
  if (process.env.INSTANCE_CONNECTION_NAME) {
    const dbName = process.env.DB_NAME || 'trivia';
    return `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}/${dbName}.sqlite`;
  }
  // Local development or Cloud Run without Cloud SQL
  return DB_FILE;
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function createDatabase(): Database.Database {
  ensureDataDir();
  const dbPath = getDatabasePath();
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrency and durability
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY,
      round TEXT NOT NULL,
      category TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      question TEXT NOT NULL,
      opt_a TEXT NOT NULL,
      opt_b TEXT NOT NULL,
      opt_c TEXT NOT NULL,
      correct TEXT NOT NULL,
      image_url TEXT,
      audio_url TEXT,
      explanation TEXT
    );

    CREATE TABLE IF NOT EXISTS team_tokens (
      team_id TEXT PRIMARY KEY,
      token TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS team_traps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id TEXT NOT NULL,
      slot_key TEXT NOT NULL,
      category TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      type TEXT NOT NULL,
      UNIQUE(team_id, slot_key)
    );

    CREATE TABLE IF NOT EXISTS mystery_slots (
      slot_key TEXT PRIMARY KEY,
      sentiment TEXT NOT NULL CHECK (sentiment IN ('GOOD', 'BAD'))
    );

    CREATE TABLE IF NOT EXISTS secret_choices (
      question_instance_id TEXT PRIMARY KEY,
      choices TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS final_wagers (
      question_id INTEGER PRIMARY KEY,
      wagers TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS undo_snapshot (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      summary TEXT NOT NULL,
      scores TEXT NOT NULL,
      active_turn_team_id TEXT NOT NULL,
      team_streaks TEXT NOT NULL,
      previous_ranks TEXT NOT NULL,
      team_bounties TEXT,
      duel_credits TEXT,
      bomb_credits TEXT,
      last_bounty_claim TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_team_traps_team ON team_traps(team_id);
    CREATE INDEX IF NOT EXISTS idx_team_traps_slot ON team_traps(slot_key);
  `);

  return db;
}

// ─── Serialization Helpers ─────────────────────────────────────────────

function serializeGameState(state: GameState): string {
  return JSON.stringify(state);
}

function deserializeGameState(json: string): GameState {
  return JSON.parse(json);
}

function serializeQuestions(questions: QuestionItem[]): string {
  return JSON.stringify(questions);
}

function deserializeQuestions(json: string): QuestionItem[] {
  return JSON.parse(json);
}

function serializeTeamTraps(traps: Record<string, TeamTrapPlacement[]>): string {
  return JSON.stringify(traps);
}

function deserializeTeamTraps(json: string): Record<string, TeamTrapPlacement[]> {
  return JSON.parse(json);
}

function serializeMysterySlots(slots: string[], sentiments: Record<string, 'GOOD' | 'BAD'>): void {
  // Handled via individual inserts
}

function serializeSecretChoices(choices: SecretChoicesStore): string {
  return JSON.stringify(choices);
}

function deserializeSecretChoices(json: string): SecretChoicesStore {
  return JSON.parse(json);
}

function serializeFinalWagers(wagers: FinalWagersStore): string {
  return JSON.stringify(wagers);
}

function deserializeFinalWagers(json: string): FinalWagersStore {
  return JSON.parse(json);
}

function serializeUndoSnapshot(snap: UndoSnapshot | null): string | null {
  return snap ? JSON.stringify(snap) : null;
}

function deserializeUndoSnapshot(json: string | null): UndoSnapshot | null {
  return json ? JSON.parse(json) : null;
}

function generateTeamTokens(): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (let i = 1; i <= 8; i++) {
    tokens[String(i)] = crypto.randomBytes(16).toString('hex').toUpperCase();
  }
  return tokens;
}

// ─── Persistence Class ─────────────────────────────────────────────────

export class TriviaPersistence {
  private db: Database.Database;
  private saveStmt: Database.Statement;
  private loadStmt: Database.Statement;

  constructor(db: Database.Database = createDatabase()) {
    this.db = db;
    this.saveStmt = db.prepare('INSERT OR REPLACE INTO game_state (key, value, updated_at) VALUES (?, ?, ?)');
    this.loadStmt = db.prepare('SELECT value FROM game_state WHERE key = ?');
  }

  // ─── Game State ──────────────────────────────────────────────────────

  saveGameState(state: GameState): void {
    const now = Date.now();
    this.saveStmt.run('state', serializeGameState(state), now);
  }

  loadGameState(): GameState | null {
    const row = this.loadStmt.get('state') as { value: string } | undefined;
    return row ? deserializeGameState(row.value) : null;
  }

  // ─── Questions ───────────────────────────────────────────────────────

  saveQuestions(questions: QuestionItem[]): void {
    const deleteStmt = this.db.prepare('DELETE FROM questions');
    const insertStmt = this.db.prepare(`
      INSERT INTO questions (id, round, category, difficulty, question, opt_a, opt_b, opt_c, correct, image_url, audio_url, explanation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((qs: QuestionItem[]) => {
      deleteStmt.run();
      for (const q of qs) {
        insertStmt.run(
          q.id,
          q.round,
          q.category,
          q.difficulty,
          q.question,
          q.options.A,
          q.options.B,
          q.options.C,
          q.correct,
          q.imageUrl ?? null,
          q.audioUrl ?? null,
          q.explanation ?? null
        );
      }
    });
    transaction(questions);
  }

  loadQuestions(): QuestionItem[] {
    const rows = this.db.prepare('SELECT * FROM questions ORDER BY id').all() as Array<{
      id: number;
      round: string;
      category: string;
      difficulty: string;
      question: string;
      opt_a: string;
      opt_b: string;
      opt_c: string;
      correct: string;
      image_url: string | null;
      audio_url: string | null;
      explanation: string | null;
    }>;

    return rows.map((r) => ({
      id: r.id,
      round: r.round,
      category: r.category,
      difficulty: r.difficulty as any,
      question: r.question,
      options: { A: r.opt_a, B: r.opt_b, C: r.opt_c },
      correct: r.correct as any,
      ...(r.image_url ? { imageUrl: r.image_url } : {}),
      ...(r.audio_url ? { audioUrl: r.audio_url } : {}),
      ...(r.explanation ? { explanation: r.explanation } : {}),
    }));
  }

  // ─── Team Tokens ─────────────────────────────────────────────────────

  saveTeamTokens(tokens: Record<string, string>): void {
    const deleteStmt = this.db.prepare('DELETE FROM team_tokens');
    const insertStmt = this.db.prepare('INSERT INTO team_tokens (team_id, token) VALUES (?, ?)');

    const transaction = this.db.transaction((tks: Record<string, string>) => {
      deleteStmt.run();
      for (const [teamId, token] of Object.entries(tks)) {
        insertStmt.run(teamId, token);
      }
    });
    transaction(tokens);
  }

  loadTeamTokens(): Record<string, string> {
    const rows = this.db.prepare('SELECT team_id, token FROM team_tokens').all() as Array<{ team_id: string; token: string }>;
    const tokens: Record<string, string> = {};
    for (const r of rows) {
      tokens[r.team_id] = r.token;
    }
    return tokens;
  }

  // ─── Team Traps ──────────────────────────────────────────────────────

  saveTeamTraps(traps: Record<string, TeamTrapPlacement[]>): void {
    const deleteStmt = this.db.prepare('DELETE FROM team_traps');
    const insertStmt = this.db.prepare(`
      INSERT INTO team_traps (team_id, slot_key, category, difficulty, type)
      VALUES (?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((trps: Record<string, TeamTrapPlacement[]>) => {
      deleteStmt.run();
      for (const [teamId, list] of Object.entries(trps)) {
        for (const t of list) {
          insertStmt.run(teamId, t.slotKey, t.category, t.difficulty, t.type);
        }
      }
    });
    transaction(traps);
  }

  loadTeamTraps(): Record<string, TeamTrapPlacement[]> {
    const rows = this.db.prepare('SELECT * FROM team_traps').all() as Array<{
      team_id: string;
      slot_key: string;
      category: string;
      difficulty: string;
      type: string;
    }>;
    const traps: Record<string, TeamTrapPlacement[]> = {};
    for (const r of rows) {
      if (!traps[r.team_id]) traps[r.team_id] = [];
      traps[r.team_id].push({
        slotKey: r.slot_key,
        category: r.category,
        difficulty: r.difficulty as any,
        type: r.type as any,
      });
    }
    return traps;
  }

  // ─── Mystery Slots ───────────────────────────────────────────────────

  saveMysterySlots(slots: string[], sentiments: Record<string, 'GOOD' | 'BAD'>): void {
    const deleteStmt = this.db.prepare('DELETE FROM mystery_slots');
    const insertStmt = this.db.prepare('INSERT INTO mystery_slots (slot_key, sentiment) VALUES (?, ?)');

    const transaction = this.db.transaction(() => {
      deleteStmt.run();
      for (const slot of slots) {
        insertStmt.run(slot, sentiments[slot] || 'GOOD');
      }
    });
    transaction();
  }

  loadMysterySlots(): { slots: string[]; sentiments: Record<string, 'GOOD' | 'BAD'> } {
    const rows = this.db.prepare('SELECT slot_key, sentiment FROM mystery_slots').all() as Array<{
      slot_key: string;
      sentiment: 'GOOD' | 'BAD';
    }>;
    const slots: string[] = [];
    const sentiments: Record<string, 'GOOD' | 'BAD'> = {};
    for (const r of rows) {
      slots.push(r.slot_key);
      sentiments[r.slot_key] = r.sentiment;
    }
    return { slots, sentiments };
  }

  // ─── Secret Choices ──────────────────────────────────────────────────

  saveSecretChoices(choices: SecretChoicesStore): void {
    this.db.prepare('INSERT OR REPLACE INTO secret_choices (question_instance_id, choices) VALUES (?, ?)')
      .run(choices.questionInstanceId, serializeSecretChoices(choices));
  }

  loadSecretChoices(): SecretChoicesStore {
    const row = this.db.prepare('SELECT choices FROM secret_choices ORDER BY ROWID DESC LIMIT 1').get() as { choices: string } | undefined;
    return row ? deserializeSecretChoices(row.choices) : { questionInstanceId: null, choices: {} };
  }

  // ─── Final Wagers ────────────────────────────────────────────────────

  saveFinalWagers(wagers: FinalWagersStore): void {
    this.db.prepare('INSERT OR REPLACE INTO final_wagers (question_id, wagers) VALUES (?, ?)')
      .run(wagers.questionId, serializeFinalWagers(wagers));
  }

  loadFinalWagers(): FinalWagersStore {
    const row = this.db.prepare('SELECT wagers FROM final_wagers ORDER BY ROWID DESC LIMIT 1').get() as { wagers: string } | undefined;
    return row ? deserializeFinalWagers(row.wagers) : { questionId: null, wagers: {} };
  }

  // ─── Undo Snapshot ───────────────────────────────────────────────────

  saveUndoSnapshot(snap: UndoSnapshot | null): void {
    if (!snap) {
      this.db.prepare('DELETE FROM undo_snapshot').run();
      return;
    }
    this.db.prepare(`
      INSERT OR REPLACE INTO undo_snapshot (id, summary, scores, active_turn_team_id, team_streaks, previous_ranks, team_bounties, duel_credits, bomb_credits, last_bounty_claim)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      snap.summary,
      JSON.stringify(snap.scores),
      snap.activeTurnTeamId,
      JSON.stringify(snap.teamStreaks),
      JSON.stringify(snap.previousRanks),
      snap.teamBounties ? JSON.stringify(snap.teamBounties) : null,
      snap.duelCredits ? JSON.stringify(snap.duelCredits) : null,
      snap.bombCredits ? JSON.stringify(snap.bombCredits) : null,
      snap.lastBountyClaim ? JSON.stringify(snap.lastBountyClaim) : null
    );
  }

  loadUndoSnapshot(): UndoSnapshot | null {
    const row = this.db.prepare('SELECT * FROM undo_snapshot WHERE id = 1').get() as {
      summary: string;
      scores: string;
      active_turn_team_id: string;
      team_streaks: string;
      previous_ranks: string;
      team_bounties: string | null;
      duel_credits: string | null;
      bomb_credits: string | null;
      last_bounty_claim: string | null;
    } | undefined;

    if (!row) return null;

    return {
      summary: row.summary,
      scores: JSON.parse(row.scores),
      activeTurnTeamId: row.active_turn_team_id,
      teamStreaks: JSON.parse(row.team_streaks),
      previousRanks: JSON.parse(row.previous_ranks),
      teamBounties: row.team_bounties ? JSON.parse(row.team_bounties) : undefined,
      duelCredits: row.duel_credits ? JSON.parse(row.duel_credits) : undefined,
      bombCredits: row.bomb_credits ? JSON.parse(row.bomb_credits) : undefined,
      lastBountyClaim: row.last_bounty_claim ? JSON.parse(row.last_bounty_claim) : undefined,
    };
  }

  // ─── Full Store Load/Save ────────────────────────────────────────────

  loadFullStore(): PersistedStore {
    const state = this.loadGameState();
    const questions = this.loadQuestions();
    const teamTokens = this.loadTeamTokens();
    const teamTraps = this.loadTeamTraps();
    const { slots: mysterySlots, sentiments: mysterySlotSentiments } = this.loadMysterySlots();
    const secretChoices = this.loadSecretChoices();
    const finalWagers = this.loadFinalWagers();
    const undoSnapshot = this.loadUndoSnapshot();

    // If no state exists, create fresh
    if (!state || questions.length === 0) {
      return this.createFreshStore();
    }

    // Merge existing tokens with generated ones (for new teams)
    const mergedTokens = generateTeamTokens();
    for (let i = 1; i <= 8; i++) {
      const k = String(i);
      const existing = teamTokens[k];
      if (existing && existing.length >= 6) {
        mergedTokens[k] = existing;
      }
    }

    return {
      state,
      questions,
      secretChoices,
      undoSnapshot,
      hostPin: '', // Not persisted for security
      teamTokens: mergedTokens,
      mysterySlots,
      mysterySlotSentiments,
      teamTraps,
      finalWagers,
    };
  }

  saveFullStore(store: PersistedStore): void {
    const transaction = this.db.transaction(() => {
      this.saveGameState(store.state);
      this.saveQuestions(store.questions);
      this.saveTeamTokens(store.teamTokens);
      this.saveTeamTraps(store.teamTraps);
      this.saveMysterySlots(store.mysterySlots, store.mysterySlotSentiments);
      this.saveSecretChoices(store.secretChoices);
      this.saveFinalWagers(store.finalWagers);
      this.saveUndoSnapshot(store.undoSnapshot);
    });
    transaction();
  }

  private createFreshStore(): PersistedStore {
    const defaultQuestions = SAMPLE_QUESTIONS.map((q) => ({ ...q, options: { ...q.options } }));
    const { slots, sentiments } = buildBalancedMysterySlots(defaultQuestions, 'ALL');
    const teamTokens = generateTeamTokens();

    const state: GameState = {
      stateRevision: 1,
      stateTimestamp: Date.now(),
      serverNow: Date.now(),
      fsmState: 'CATEGORY_BOARD',
      answerMode: 'BUZZER',
      activeTheme: 'luxury',
      customTokens: {},
      settings: getDefaultSettings(),
      questionsVersion: 1,
      totalQuestionsCount: defaultQuestions.length,
      boardMatrix: {},
      activeTurnTeamId: '1',
      selectedRound: 'ALL',
      selectedCategory: null,
      selectedDifficulty: null,
      usedQuestionIds: [],
      currentRoundLabel: 'جميع الجولات',
      currentQuestion: null,
      questionInstanceId: null,
      questionStartedAt: null,
      currentQuestionPoints: 100,
      questionEndTime: null,
      answerEndTime: null,
      pausedRemaining: 25,
      pausedAnswerRemaining: 7,
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
      scores: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0, '8': 0 },
      powerUps: {},
      activeEffects: {
        shieldTeams: [],
        doubleTeams: [],
        stealTargets: {},
        eliminatedOptions: [],
        frozenTeams: {},
        lastPowerUpBanner: null,
      },
      canUndoEvaluation: false,
      undoSummary: '',
      matchStats: { questionsPlayed: 0, buzzerHits: 0, secretVotesTotal: 0, fastestTeamName: '', fastestMs: 0 },
      hostPinEnabled: false,
      hostAuthRevision: 1,
      teamTokensVersion: 1,
      activeMysteryTwist: null,
      teamStreaks: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0, '8': 0 },
      previousRanks: {},
      finalCategoryLabel: null,
      finalWageredTeams: [],
      finalMinWager: 50,
      finalResults: null,
      trapSetupReadyTeams: [],
      totalActiveTrapsCount: 0,
      activeTrapTrigger: null,
      teamBounties: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0, '8': 0 },
      lastBountyClaim: null,
      duelCredits: { '1': 1, '2': 1, '3': 1, '4': 1, '5': 1, '6': 1, '7': 1, '8': 1 },
      armedDuel: null,
      activeDuel: null,
      bombCredits: { '1': 1, '2': 1, '3': 1, '4': 1, '5': 1, '6': 1, '7': 1, '8': 1 },
      activeBomb: null,
      powerUpsLockedThisQuestion: false,
    };

    return {
      state,
      questions: defaultQuestions,
      secretChoices: { questionInstanceId: null, choices: {} },
      undoSnapshot: null,
      hostPin: '',
      teamTokens,
      mysterySlots: slots,
      mysterySlotSentiments: sentiments,
      teamTraps: {},
      finalWagers: { questionId: null, wagers: {} },
    };
  }

  close(): void {
    this.db.close();
  }
}

// ─── Import helpers from engine (avoid circular deps) ──────────────────
// These are copied here for fresh store creation

function getDefaultSettings(): GameSettings {
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

function buildBalancedMysterySlots(
  questions: QuestionItem[],
  selectedRound: string
): { slots: string[]; sentiments: Record<string, 'GOOD' | 'BAD'> } {
  const slotSet = new Set<string>();
  for (const q of questions) {
    const qRound = (q.round || 'الجولة 1').trim() || 'الجولة 1';
    if (selectedRound !== 'ALL' && qRound !== selectedRound) continue;
    const cat = (q.category || 'عام').trim() || 'عام';
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

function normalizeDifficulty(rawDiff: unknown): 'سهل' | 'متوسط' | 'صعب' {
  const d = String(rawDiff ?? '').toLowerCase();
  if (d === 'صعب' || d === 'صعبة' || d === 'hard' || d === '3') return 'صعب';
  if (d === 'متوسط' || d === 'متوسطة' || d === 'medium' || d === '2') return 'متوسط';
  return 'سهل';
}
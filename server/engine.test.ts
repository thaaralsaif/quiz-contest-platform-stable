import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TriviaEngine } from './engine.ts';
import type { GameState, GameSettings, QuestionItem, DifficultyLevel, OptionLetter } from '../src/types/game.ts';

// ─── Test Helpers ──────────────────────────────────────────────────────

function createTestQuestions(): QuestionItem[] {
  return [
    {
      id: 1,
      round: 'الجولة 1',
      category: 'علوم',
      difficulty: 'سهل',
      question: 'ما هو الكوكب الأقرب للشمس؟',
      options: { A: 'عطارد', B: 'الزهرة', C: 'المريخ' },
      correct: 'A',
      explanation: 'عطارد هو الأقرب',
    },
    {
      id: 2,
      round: 'الجولة 1',
      category: 'علوم',
      difficulty: 'متوسط',
      question: 'رمز الذهب؟',
      options: { A: 'Ag', B: 'Au', C: 'Fe' },
      correct: 'B',
      explanation: 'Au من Aurum',
    },
    {
      id: 3,
      round: 'الجولة 1',
      category: 'علوم',
      difficulty: 'صعب',
      question: 'وقت وصول ضوء الشمس؟',
      options: { A: '8 د و20 ث', B: 'ثانية', C: '45 دقيقة' },
      correct: 'A',
    },
    {
      id: 4,
      round: 'الجولة 1',
      category: 'تاريخ',
      difficulty: 'سهل',
      question: 'أين جامعة القرويين؟',
      options: { A: 'القيروان', B: 'فاس', C: 'قرطبة' },
      correct: 'B',
    },
    {
      id: 5,
      round: 'الجولة 2',
      category: 'تقنية',
      difficulty: 'سهل',
      question: 'بروتوكول التشفير؟',
      options: { A: 'FTP', B: 'HTTPS', C: 'SMTP' },
      correct: 'B',
    },
  ];
}

function createTestSettings(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    playMode: 'BOARD',
    defaultAnswerMode: 'BUZZER',
    teamCount: 4,
    team1Name: 'فريق 1',
    team2Name: 'فريق 2',
    team3Name: 'فريق 3',
    team4Name: 'فريق 4',
    team5Name: 'فريق 5',
    team6Name: 'فريق 6',
    team7Name: 'فريق 7',
    team8Name: 'فريق 8',
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
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('TriviaEngine - Core Scoring', () => {
  let engine: TriviaEngine;

  beforeEach(() => {
    engine = new TriviaEngine();
    // Replace questions with test questions
    (engine as any).store.questions = createTestQuestions();
    (engine as any).store.state.settings = createTestSettings();
    (engine as any).store.state.boardMatrix = (engine as any).buildBoardMatrix(
      (engine as any).store.questions,
      [],
      'ALL'
    );
    (engine as any).store.state.totalQuestionsCount = 5;
  });

  it('should initialize with correct default state', () => {
    const state = engine.getSanitizedState();
    expect(state.fsmState).toBe('CATEGORY_BOARD');
    expect(state.scores['1']).toBe(0);
    expect(state.scores['2']).toBe(0);
    expect(state.scores['3']).toBe(0);
    expect(state.scores['4']).toBe(0);
    expect(state.activeTurnTeamId).toBe('1');
  });

  it('should calculate points correctly for each difficulty', () => {
    const settings = createTestSettings();
    expect(settings.pointsEasy).toBe(100);
    expect(settings.pointsMedium).toBe(200);
    expect(settings.pointsHard).toBe(300);
  });

  it('should apply streak multiplier correctly', () => {
    const engine2 = new TriviaEngine();
    const state = engine2.getSanitizedState();

    // Simulate streak of 3 -> 1.25x multiplier
    state.teamStreaks['1'] = 3;
    const mult3 = (engine2 as any).computeStreakMultiplier(3);
    expect(mult3).toBe(1.25);

    // Simulate streak of 5 -> 1.5x multiplier
    const mult5 = (engine2 as any).computeStreakMultiplier(5);
    expect(mult5).toBe(1.5);

    // No streak -> 1x
    const mult0 = (engine2 as any).computeStreakMultiplier(0);
    expect(mult0).toBe(1);
  });

  it('should compute bounty for streaks', () => {
    const engine2 = new TriviaEngine();
    const state = engine2.getSanitizedState();

    state.teamStreaks['1'] = 2;
    let bounties = (engine2 as any).syncTeamBounties(state.teamStreaks);
    expect(bounties['1']).toBe(0);

    state.teamStreaks['1'] = 3;
    bounties = (engine2 as any).syncTeamBounties(state.teamStreaks);
    expect(bounties['1']).toBe(100);

    state.teamStreaks['1'] = 5;
    bounties = (engine2 as any).syncTeamBounties(state.teamStreaks);
    expect(bounties['1']).toBe(150);
  });
});

describe('TriviaEngine - FSM Transitions', () => {
  let engine: TriviaEngine;

  beforeEach(() => {
    engine = new TriviaEngine();
    (engine as any).store.questions = createTestQuestions();
    (engine as any).store.state.settings = createTestSettings();
    (engine as any).store.state.boardMatrix = (engine as any).buildBoardMatrix(
      (engine as any).store.questions,
      [],
      'ALL'
    );
    (engine as any).store.state.totalQuestionsCount = 5;
  });

  it('should transition from CATEGORY_BOARD to QUESTION_ACTIVE on PICK_BOARD_QUESTION', async () => {
    const result = await engine.handleAction('PICK_BOARD_QUESTION', {
      category: 'علوم',
      difficulty: 'سهل',
    });

    expect(result.status).toBe('OK');
    const state = engine.getSanitizedState();
    expect(state.fsmState).toBe('QUESTION_ACTIVE');
    expect(state.currentQuestion).not.toBeNull();
    expect(state.currentQuestion?.category).toBe('علوم');
    expect(state.currentQuestion?.difficulty).toBe('سهل');
  });

  it('should transition to BUZZER_LOCKED on TRIGGER_BUZZER', async () => {
    // First pick a question
    await engine.handleAction('PICK_BOARD_QUESTION', {
      category: 'علوم',
      difficulty: 'سهل',
    });

    // Simulate team 1 buzzing (need valid token)
    const tokens = engine.getHostTeamTokens();
    const token = tokens.teamTokens['1'];

    const result = await engine.handleAction('TRIGGER_BUZZER', {
      teamId: '1',
      teamToken: token,
    });

    expect(result.accepted).toBe(true);
    const state = engine.getSanitizedState();
    expect(state.fsmState).toBe('BUZZER_LOCKED');
    expect(state.lockedTeamId).toBe('1');
  });

  it('should transition to ANSWER_CORRECT on EVALUATE_ANSWER with isCorrect=true', async () => {
    await engine.handleAction('PICK_BOARD_QUESTION', { category: 'علوم', difficulty: 'سهل' });
    const tokens = engine.getHostTeamTokens();

    await engine.handleAction('TRIGGER_BUZZER', { teamId: '1', teamToken: tokens.teamTokens['1'] });

    const result = await engine.handleAction('EVALUATE_ANSWER', { isCorrect: true });
    expect(result.status).toBe('OK');

    const state = engine.getSanitizedState();
    expect(state.fsmState).toBe('ANSWER_CORRECT');
    expect(state.scores['1']).toBeGreaterThan(0);
  });

  it('should transition to ANSWER_WRONG on EVALUATE_ANSWER with isCorrect=false', async () => {
    await engine.handleAction('PICK_BOARD_QUESTION', { category: 'علوم', difficulty: 'سهل' });
    const tokens = engine.getHostTeamTokens();

    await engine.handleAction('TRIGGER_BUZZER', { teamId: '1', teamToken: tokens.teamTokens['1'] });

    const result = await engine.handleAction('EVALUATE_ANSWER', { isCorrect: false });
    expect(result.status).toBe('OK');

    const state = engine.getSanitizedState();
    expect(state.fsmState).toBe('ANSWER_WRONG');
    expect(state.scores['1']).toBe(0); // no penalty by default
  });

  it('should support CHOICE mode flow', async () => {
    await engine.handleAction('SET_ANSWER_MODE', { mode: 'CHOICE' });
    await engine.handleAction('PICK_BOARD_QUESTION', { category: 'علوم', difficulty: 'سهل' });

    const state1 = engine.getSanitizedState();
    expect(state1.answerMode).toBe('CHOICE');
    expect(state1.fsmState).toBe('QUESTION_ACTIVE');

    const tokens = engine.getHostTeamTokens();

    // Team 1 votes
    await engine.handleAction('SUBMIT_SECRET_CHOICE', {
      teamId: '1',
      teamToken: tokens.teamTokens['1'],
      option: 'A',
    });

    // Team 2 votes
    await engine.handleAction('SUBMIT_SECRET_CHOICE', {
      teamId: '2',
      teamToken: tokens.teamTokens['2'],
      option: 'B',
    });

    const state2 = engine.getSanitizedState();
    expect(state2.votedTeams.length).toBe(2);

    // Reveal
    const revealResult = await engine.handleAction('REVEAL_SECRET_CHOICES', {});
    expect(revealResult.status).toBe('OK');

    const state3 = engine.getSanitizedState();
    expect(state3.fsmState).toBe('CHOICE_REVEALED');
    expect(state3.revealedChoices).not.toBeNull();
  });
});

describe('TriviaEngine - PowerUps', () => {
  let engine: TriviaEngine;

  beforeEach(() => {
    engine = new TriviaEngine();
    (engine as any).store.questions = createTestQuestions();
    (engine as any).store.state.settings = createTestSettings({ powerUpsEnabled: true });
    (engine as any).store.state.boardMatrix = (engine as any).buildBoardMatrix(
      (engine as any).store.questions,
      [],
      'ALL'
    );
    (engine as any).store.state.totalQuestionsCount = 5;
  });

  it('should allow shield activation', async () => {
    await engine.handleAction('PICK_BOARD_QUESTION', { category: 'علوم', difficulty: 'سهل' });
    const tokens = engine.getHostTeamTokens();

    const result = await engine.handleAction('ACTIVATE_POWERUP', {
      teamId: '1',
      teamToken: tokens.teamTokens['1'],
      type: 'shield',
    });

    expect(result.status).toBe('OK');
    const state = engine.getSanitizedState();
    expect(state.activeEffects.shieldTeams).toContain('1');
  });

  it('should allow double points activation', async () => {
    await engine.handleAction('PICK_BOARD_QUESTION', { category: 'علوم', difficulty: 'سهل' });
    const tokens = engine.getHostTeamTokens();

    const result = await engine.handleAction('ACTIVATE_POWERUP', {
      teamId: '1',
      teamToken: tokens.teamTokens['1'],
      type: 'double',
    });

    expect(result.status).toBe('OK');
    const state = engine.getSanitizedState();
    expect(state.activeEffects.doubleTeams).toContain('1');
  });

  it('should allow freeze on leading team', async () => {
    await engine.handleAction('PICK_BOARD_QUESTION', { category: 'علوم', difficulty: 'سهل' });
    const tokens = engine.getHostTeamTokens();

    // First give team 1 some points so they're leading
    (engine as any).store.state.scores['1'] = 500;

    const result = await engine.handleAction('ACTIVATE_POWERUP', {
      teamId: '2',
      teamToken: tokens.teamTokens['2'],
      type: 'freeze',
    });

    expect(result.status).toBe('OK');
    const state = engine.getSanitizedState();
    expect(state.activeEffects.frozenTeams['1']).toBeGreaterThan(Date.now());
  });

  it('should not allow freeze in CHOICE mode', async () => {
    await engine.handleAction('SET_ANSWER_MODE', { mode: 'CHOICE' });
    await engine.handleAction('PICK_BOARD_QUESTION', { category: 'علوم', difficulty: 'سهل' });
    const tokens = engine.getHostTeamTokens();

    const result = await engine.handleAction('ACTIVATE_POWERUP', {
      teamId: '1',
      teamToken: tokens.teamTokens['1'],
      type: 'freeze',
    });

    expect(result.status).toBe('UNSUPPORTED_IN_CHOICE');
  });
});

describe('TriviaEngine - Traps & Mysteries', () => {
  let engine: TriviaEngine;

  beforeEach(() => {
    engine = new TriviaEngine();
    (engine as any).store.questions = createTestQuestions();
    (engine as any).store.state.settings = createTestSettings();
    (engine as any).store.state.boardMatrix = (engine as any).buildBoardMatrix(
      (engine as any).store.questions,
      [],
      'ALL'
    );
    (engine as any).store.state.totalQuestionsCount = 5;
  });

  it('should allow trap setup phase', async () => {
    const result = await engine.handleAction('START_TRAP_SETUP', {});
    expect(result.status).toBe('OK');

    const state = engine.getSanitizedState();
    expect(state.fsmState).toBe('TRAP_SETUP');
  });

  it('should allow placing a trap', async () => {
    await engine.handleAction('START_TRAP_SETUP', {});
    const tokens = engine.getHostTeamTokens();

    const result = await engine.handleAction('PLACE_TEAM_TRAP', {
      teamId: '1',
      teamToken: tokens.teamTokens['1'],
      category: 'علوم',
      difficulty: 'سهل',
      trapType: 'STEAL_TRAP',
    });

    expect(result.accepted).toBe(true);
    expect(result.message).toContain('تم زرع الكمين');
  });

  it('should not allow more than 2 traps per team', async () => {
    await engine.handleAction('START_TRAP_SETUP', {});
    const tokens = engine.getHostTeamTokens();

    await engine.handleAction('PLACE_TEAM_TRAP', {
      teamId: '1',
      teamToken: tokens.teamTokens['1'],
      category: 'علوم',
      difficulty: 'سهل',
      trapType: 'STEAL_TRAP',
    });

    await engine.handleAction('PLACE_TEAM_TRAP', {
      teamId: '1',
      teamToken: tokens.teamTokens['1'],
      category: 'علوم',
      difficulty: 'متوسط',
      trapType: 'HALF_TIME_TRAP',
    });

    const result = await engine.handleAction('PLACE_TEAM_TRAP', {
      teamId: '1',
      teamToken: tokens.teamTokens['1'],
      category: 'تاريخ',
      difficulty: 'سهل',
      trapType: 'DOUBLE_PENALTY_TRAP',
    });

    expect(result.status).toBe('REJECTED');
    expect(result.reason).toBe('LIMIT_REACHED');
  });

  it('should finish trap setup and return to board', async () => {
    await engine.handleAction('START_TRAP_SETUP', {});
    await engine.handleAction('FINISH_TRAP_SETUP', {});

    const state = engine.getSanitizedState();
    expect(state.fsmState).toBe('CATEGORY_BOARD');
  });
});

describe('TriviaEngine - Duel', () => {
  let engine: TriviaEngine;

  beforeEach(() => {
    engine = new TriviaEngine();
    (engine as any).store.questions = createTestQuestions();
    (engine as any).store.state.settings = createTestSettings({ defaultAnswerMode: 'BUZZER' });
    (engine as any).store.state.boardMatrix = (engine as any).buildBoardMatrix(
      (engine as any).store.questions,
      [],
      'ALL'
    );
    (engine as any).store.state.totalQuestionsCount = 5;
  });

  it('should arm a duel', async () => {
    const result = await engine.handleAction('ARM_DUEL', {
      challengerId: '1',
      opponentId: '2',
    });

    expect(result.status).toBe('OK');
    const state = engine.getSanitizedState();
    expect(state.armedDuel).not.toBeNull();
    expect(state.armedDuel?.challengerId).toBe('1');
    expect(state.armedDuel?.opponentId).toBe('2');
  });

  it('should not allow duel in CHOICE mode', async () => {
    await engine.handleAction('SET_ANSWER_MODE', { mode: 'CHOICE' });

    const result = await engine.handleAction('ARM_DUEL', {
      challengerId: '1',
      opponentId: '2',
    });

    expect(result.status).toBe('UNSUPPORTED_IN_CHOICE');
  });

  it('should launch duel question when board slot picked', async () => {
    await engine.handleAction('ARM_DUEL', { challengerId: '1', opponentId: '2' });

    const result = await engine.handleAction('PICK_BOARD_QUESTION', {
      category: 'علوم',
      difficulty: 'سهل',
    });

    expect(result.status).toBe('OK');
    const state = engine.getSanitizedState();
    expect(state.activeDuel).not.toBeNull();
    expect(state.activeDuel?.challengerId).toBe('1');
    expect(state.activeDuel?.opponentId).toBe('2');
    expect(state.activeDuel?.multiplier).toBe(1.5);
  });
});

describe('TriviaEngine - Hot Potato Bomb', () => {
  let engine: TriviaEngine;

  beforeEach(() => {
    engine = new TriviaEngine();
    (engine as any).store.questions = createTestQuestions();
    (engine as any).store.state.settings = createTestSettings();
    (engine as any).store.state.boardMatrix = (engine as any).buildBoardMatrix(
      (engine as any).store.questions,
      [],
      'ALL'
    );
    (engine as any).store.state.totalQuestionsCount = 5;
  });

  it('should throw bomb on opponent', async () => {
    await engine.handleAction('PICK_BOARD_QUESTION', { category: 'علوم', difficulty: 'سهل' });
    const tokens = engine.getHostTeamTokens();

    const result = await engine.handleAction('THROW_BOMB', {
      teamId: '1',
      teamToken: tokens.teamTokens['1'],
      targetTeamId: '2',
    });

    expect(result.accepted).toBe(true);
    const state = engine.getSanitizedState();
    expect(state.activeBomb).not.toBeNull();
    expect(state.activeBomb?.throwerId).toBe('1');
    expect(state.activeBomb?.targetId).toBe('2');
    expect(state.activeBomb?.status).toBe('TICKING');
    expect(state.fsmState).toBe('BUZZER_LOCKED');
    expect(state.lockedTeamId).toBe('2');
  });

  it('should not allow bomb in CHOICE mode', async () => {
    await engine.handleAction('SET_ANSWER_MODE', { mode: 'CHOICE' });
    await engine.handleAction('PICK_BOARD_QUESTION', { category: 'علوم', difficulty: 'سهل' });
    const tokens = engine.getHostTeamTokens();

    const result = await engine.handleAction('THROW_BOMB', {
      teamId: '1',
      teamToken: tokens.teamTokens['1'],
      targetTeamId: '2',
    });

    expect(result.status).toBe('UNSUPPORTED_IN_CHOICE');
  });
});

describe('TriviaEngine - Final Wager Round', () => {
  let engine: TriviaEngine;

  beforeEach(() => {
    engine = new TriviaEngine();
    (engine as any).store.questions = createTestQuestions();
    (engine as any).store.state.settings = createTestSettings();
    (engine as any).store.state.boardMatrix = (engine as any).buildBoardMatrix(
      (engine as any).store.questions,
      [],
      'ALL'
    );
    (engine as any).store.state.totalQuestionsCount = 5;
  });

  it('should start final wager phase', async () => {
    const result = await engine.handleAction('START_FINAL_WAGER', {});
    expect(result.status).toBe('OK');

    const state = engine.getSanitizedState();
    expect(state.fsmState).toBe('FINAL_WAGER_OPEN');
    expect(state.finalCategoryLabel).not.toBeNull();
  });

  it('should allow teams to submit wagers', async () => {
    await engine.handleAction('START_FINAL_WAGER', {});
    const tokens = engine.getHostTeamTokens();

    const result = await engine.handleAction('SUBMIT_FINAL_WAGER', {
      teamId: '1',
      teamToken: tokens.teamTokens['1'],
      wager: 500,
    });

    expect(result.accepted).toBe(true);
    const state = engine.getSanitizedState();
    expect(state.finalWageredTeams).toContain('1');
  });

  it('should launch final question', async () => {
    await engine.handleAction('START_FINAL_WAGER', {});
    const tokens = engine.getHostTeamTokens();

    // All teams wager
    for (let i = 1; i <= 4; i++) {
      await engine.handleAction('SUBMIT_FINAL_WAGER', {
        teamId: String(i),
        teamToken: tokens.teamTokens[String(i)],
        wager: 100,
      });
    }

    const result = await engine.handleAction('LAUNCH_FINAL_QUESTION', {});
    expect(result.status).toBe('OK');

    const state = engine.getSanitizedState();
    expect(state.fsmState).toBe('FINAL_QUESTION_ACTIVE');
    expect(state.answerMode).toBe('CHOICE');
  });

  it('should reveal final results', async () => {
    await engine.handleAction('START_FINAL_WAGER', {});
    const tokens = engine.getHostTeamTokens();

    for (let i = 1; i <= 4; i++) {
      await engine.handleAction('SUBMIT_FINAL_WAGER', {
        teamId: String(i),
        teamToken: tokens.teamTokens[String(i)],
        wager: 100,
      });
    }

    await engine.handleAction('LAUNCH_FINAL_QUESTION', {});

    // Teams vote
    await engine.handleAction('SUBMIT_SECRET_CHOICE', {
      teamId: '1',
      teamToken: tokens.teamTokens['1'],
      option: 'A',
    });
    await engine.handleAction('SUBMIT_SECRET_CHOICE', {
      teamId: '2',
      teamToken: tokens.teamTokens['2'],
      option: 'B',
    });

    const result = await engine.handleAction('REVEAL_FINAL_RESULTS', {});
    expect(result.status).toBe('OK');

    const state = engine.getSanitizedState();
    expect(state.fsmState).toBe('FINAL_REVEALED');
    expect(state.finalResults).not.toBeNull();
  });
});

describe('TriviaEngine - Undo & Referee Actions', () => {
  let engine: TriviaEngine;

  beforeEach(() => {
    engine = new TriviaEngine();
    (engine as any).store.questions = createTestQuestions();
    (engine as any).store.state.settings = createTestSettings();
    (engine as any).store.state.boardMatrix = (engine as any).buildBoardMatrix(
      (engine as any).store.questions,
      [],
      'ALL'
    );
    (engine as any).store.state.totalQuestionsCount = 5;
  });

  it('should allow undo after evaluation', async () => {
    await engine.handleAction('PICK_BOARD_QUESTION', { category: 'علوم', difficulty: 'سهل' });
    const tokens = engine.getHostTeamTokens();

    await engine.handleAction('TRIGGER_BUZZER', { teamId: '1', teamToken: tokens.teamTokens['1'] });
    await engine.handleAction('EVALUATE_ANSWER', { isCorrect: true });

    const stateBeforeUndo = engine.getSanitizedState();
    expect(stateBeforeUndo.canUndoEvaluation).toBe(true);

    const undoResult = await engine.handleAction('UNDO_EVALUATION', {});
    expect(undoResult.status).toBe('OK');

    const stateAfterUndo = engine.getSanitizedState();
    expect(stateAfterUndo.scores['1']).toBe(0);
    expect(stateAfterUndo.canUndoEvaluation).toBe(false);
  });

  it('should allow score adjustment', async () => {
    const result = await engine.handleAction('ADJUST_TEAM_SCORE', {
      teamId: '1',
      delta: 50,
    });

    expect(result.status).toBe('OK');
    const state = engine.getSanitizedState();
    expect(state.scores['1']).toBe(50);
  });

  it('should allow granting powerups', async () => {
    const result = await engine.handleAction('GRANT_POWERUP', {
      teamId: '1',
      puType: 'shield',
    });

    expect(result.status).toBe('OK');
    const state = engine.getSanitizedState();
    expect(state.powerUps['1'].shield).toBe(1); // 1 default + 1 granted
  });

  it('should eliminate lowest team', async () => {
    // Set scores so team 4 is lowest
    (engine as any).store.state.scores['1'] = 1000;
    (engine as any).store.state.scores['2'] = 800;
    (engine as any).store.state.scores['3'] = 600;
    (engine as any).store.state.scores['4'] = 100;

    const result = await engine.handleAction('ELIMINATE_LOWEST_TEAM', {});
    expect(result.status).toBe('OK');

    const state = engine.getSanitizedState();
    expect(state.eliminatedTeams).toContain('4');
  });

  it('should restore eliminated teams', async () => {
    (engine as any).store.state.eliminatedTeams = ['3', '4'];

    const result = await engine.handleAction('RESTORE_ALL_TEAMS', {});
    expect(result.status).toBe('OK');

    const state = engine.getSanitizedState();
    expect(state.eliminatedTeams.length).toBe(0);
  });
});

describe('TriviaEngine - Reset Functions', () => {
  let engine: TriviaEngine;

  beforeEach(() => {
    engine = new TriviaEngine();
    (engine as any).store.questions = createTestQuestions();
    (engine as any).store.state.settings = createTestSettings();
    (engine as any).store.state.boardMatrix = (engine as any).buildBoardMatrix(
      (engine as any).store.questions,
      [],
      'ALL'
    );
    (engine as any).store.state.totalQuestionsCount = 5;
  });

  it('should reset scores only', async () => {
    (engine as any).store.state.scores['1'] = 500;
    (engine as any).store.state.scores['2'] = 300;

    await engine.handleAction('RESET_SCORES', {});

    const state = engine.getSanitizedState();
    expect(state.scores['1']).toBe(0);
    expect(state.scores['2']).toBe(0);
  });

  it('should reset powerups', async () => {
    (engine as any).store.state.powerUps['1'] = { shield: 5, ai: 5, double: 5, freeze: 5, steal: 5, time: 5 };

    await engine.handleAction('RESET_POWERUPS', {});

    const state = engine.getSanitizedState();
    expect(state.powerUps['1'].shield).toBe(1);
    expect(state.powerUps['1'].ai).toBe(1);
  });

  it('should reset used questions', async () => {
    (engine as any).store.state.usedQuestionIds = [1, 2, 3];
    (engine as any).store.state.fsmState = 'QUESTION_ACTIVE';

    await engine.handleAction('RESET_USED_QUESTIONS', {});

    const state = engine.getSanitizedState();
    expect(state.usedQuestionIds.length).toBe(0);
    expect(state.fsmState).toBe('CATEGORY_BOARD');
  });

  it('should full reset match', async () => {
    (engine as any).store.state.scores['1'] = 500;
    (engine as any).store.state.usedQuestionIds = [1, 2, 3];
    (engine as any).store.state.eliminatedTeams = ['4'];

    await engine.handleAction('RESET_FULL_MATCH', {});

    const state = engine.getSanitizedState();
    expect(state.scores['1']).toBe(0);
    expect(state.usedQuestionIds.length).toBe(0);
    expect(state.eliminatedTeams.length).toBe(0);
    expect(state.fsmState).toBe('CATEGORY_BOARD');
  });
});

describe('TriviaEngine - Settings Persistence', () => {
  let engine: TriviaEngine;

  beforeEach(() => {
    engine = new TriviaEngine();
    (engine as any).store.questions = createTestQuestions();
    (engine as any).store.state.settings = createTestSettings();
    (engine as any).store.state.boardMatrix = (engine as any).buildBoardMatrix(
      (engine as any).store.questions,
      [],
      'ALL'
    );
    (engine as any).store.state.totalQuestionsCount = 5;
  });

  it('should save settings', async () => {
    const result = await engine.handleAction('SAVE_SETTINGS', {
      settings: {
        ...createTestSettings(),
        teamCount: 6,
        timerSeconds: 30,
        pointsEasy: 150,
      },
    });

    expect(result.status).toBe('OK');
    const state = engine.getSanitizedState();
    expect(state.settings.teamCount).toBe(6);
    expect(state.settings.timerSeconds).toBe(30);
    expect(state.settings.pointsEasy).toBe(150);
  });

  it('should update visual theme', async () => {
    const result = await engine.handleAction('UPDATE_VISUAL_THEME', {
      activeTheme: 'snow',
      customTokens: {},
    });

    expect(result.status).toBe('OK');
    const state = engine.getSanitizedState();
    expect(state.activeTheme).toBe('snow');
  });

  it('should add question', async () => {
    const result = await engine.handleAction('ADD_QUESTION', {
      round: 'الجولة 3',
      category: 'جديد',
      difficulty: 'سهل',
      question: 'سؤال جديد؟',
      optA: 'خيار 1',
      optB: 'خيار 2',
      optC: 'خيار 3',
      correct: 'A',
    });

    expect(result.status).toBe('OK');
    expect(result.questions?.length).toBeGreaterThan(5);
  });
});
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionResponse, GameState, QuestionItem } from '../types/game';
import { soundEngine } from '../utils/audio';

interface PendingAck {
  resolve: (res: ActionResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function getTeamDisplayName(state: GameState, teamId: string | number | null | undefined): string {
  if (!teamId) return 'فريق';
  const idStr = String(teamId);
  const settingsMap = state.settings as unknown as Record<string, unknown>;
  const name = settingsMap[`team${idStr}Name`];
  return typeof name === 'string' && name.trim() ? name.trim() : `فريق ${idStr}`;
}

export function getActiveTeamIds(state: GameState): string[] {
  const count = Math.min(8, Math.max(2, Number(state.settings.teamCount) || 4));
  const ids: string[] = [];
  for (let i = 1; i <= count; i++) ids.push(String(i));
  return ids;
}

export function getAvailableRounds(questions: QuestionItem[]): string[] {
  const seen = new Set<string>();
  const rounds: string[] = [];
  for (const q of questions) {
    const r = (q.round || 'الجولة 1').trim() || 'الجولة 1';
    if (!seen.has(r)) {
      seen.add(r);
      rounds.push(r);
    }
  }
  return rounds.length > 0 ? rounds : ['الجولة 1'];
}

export function useTriviaRealtime() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [connected, setConnected] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [questionRemainingSec, setQuestionRemainingSec] = useState<number>(0);
  const [answerRemainingSec, setAnswerRemainingSec] = useState<number>(0);

  const wsRef = useRef<WebSocket | null>(null);
  const pendingAcksRef = useRef<Map<string, PendingAck>>(new Map());
  const clockOffsetRef = useRef<number>(0);
  const lastRevisionRef = useRef<number>(0);
  const prevStateRef = useRef<GameState | null>(null);
  const mountedRef = useRef<boolean>(true);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const lastTickRef = useRef<string>('');

  const applyServerState = useCallback((nextState: GameState, nextQuestions?: QuestionItem[]) => {
    if (!mountedRef.current || !nextState) return;

    if (typeof nextState.serverNow === 'number') {
      clockOffsetRef.current = nextState.serverNow - Date.now();
    }

    if (Array.isArray(nextQuestions)) {
      setQuestions(nextQuestions);
    }

    const rev = Number(nextState.stateRevision) || 0;
    if (rev >= lastRevisionRef.current || rev === 1) {
      lastRevisionRef.current = rev;
      soundEngine.handleStateTransition(prevStateRef.current, nextState);
      prevStateRef.current = nextState;
      setGameState(nextState);
    }
    setLoading(false);
  }, []);

  const fetchInitialState = useCallback(async () => {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { state?: GameState; questions?: QuestionItem[] };
      if (data.state) {
        applyServerState(data.state, data.questions);
      }
    } catch (err) {
      console.error('Initial state fetch failed:', err);
    }
  }, [applyServerState]);

  useEffect(() => {
    mountedRef.current = true;
    void fetchInitialState();

    const connectWebSocket = () => {
      if (!mountedRef.current) return;
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) {
          ws.close();
          return;
        }
        reconnectAttemptsRef.current = 0;
        setConnected(true);
        ws.send(JSON.stringify({ type: 'sync:request' }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as {
            type?: string;
            state?: GameState;
            questions?: QuestionItem[];
            requestId?: string;
            result?: ActionResponse;
            serverNow?: number;
          };

          // Update clock offset on EVERY message for accurate timer sync
          if (typeof msg.serverNow === 'number') {
            clockOffsetRef.current = msg.serverNow - Date.now();
          }

          if (msg.type === 'state:sync' && msg.state) {
            applyServerState(msg.state, msg.questions);
          } else if (msg.type === 'action:ack' && msg.requestId) {
            const pending = pendingAcksRef.current.get(msg.requestId);
            if (pending) {
              clearTimeout(pending.timer);
              pendingAcksRef.current.delete(msg.requestId);
              if (msg.result?.state) {
                applyServerState(msg.result.state, msg.result.questions);
              }
              pending.resolve(msg.result || { status: 'OK' });
            }
          }
        } catch (err) {
          console.error('WS message error:', err);
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setConnected(false);
        wsRef.current = null;
        const attempt = Math.min(reconnectAttemptsRef.current + 1, 6);
        reconnectAttemptsRef.current = attempt;
        const delayMs = Math.min(5000, 400 * Math.pow(1.5, attempt));
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(connectWebSocket, delayMs);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connectWebSocket();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      for (const pending of pendingAcksRef.current.values()) {
        clearTimeout(pending.timer);
      }
      pendingAcksRef.current.clear();
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [applyServerState, fetchInitialState]);

  useEffect(() => {
    if (!gameState) return;
    const syncTimers = () => {
      const alignedNow = Date.now() + clockOffsetRef.current;

      if (gameState.isTimerPaused) {
        setQuestionRemainingSec(Math.max(0, Number(gameState.pausedRemaining) || 0));
        setAnswerRemainingSec(Math.max(0, Number(gameState.pausedAnswerRemaining) || 0));
        return;
      }

      let qRem = Math.max(0, Number(gameState.pausedRemaining) || 0);
      if (
        gameState.questionEndTime &&
        (gameState.fsmState === 'QUESTION_ACTIVE' || gameState.fsmState === 'FINAL_QUESTION_ACTIVE')
      ) {
        qRem = Math.max(0, Math.ceil((gameState.questionEndTime - alignedNow) / 1000));
        setQuestionRemainingSec(qRem);
      } else {
        setQuestionRemainingSec(qRem);
      }

      let aRem = 0;
      if (gameState.answerEndTime && gameState.fsmState === 'BUZZER_LOCKED') {
        aRem = Math.max(0, Math.ceil((gameState.answerEndTime - alignedNow) / 1000));
        setAnswerRemainingSec(aRem);
      } else {
        setAnswerRemainingSec(0);
      }

      if (
        (gameState.fsmState === 'QUESTION_ACTIVE' || gameState.fsmState === 'FINAL_QUESTION_ACTIVE') &&
        gameState.questionEndTime &&
        qRem > 0 &&
        qRem <= 5
      ) {
        const tickKey = `${gameState.questionInstanceId || 'q'}_${gameState.fsmState}_${qRem}`;
        if (lastTickRef.current !== tickKey) {
          lastTickRef.current = tickKey;
          soundEngine.playTick(qRem <= 3);
        }
      } else if (
        gameState.fsmState === 'BUZZER_LOCKED' &&
        gameState.answerEndTime &&
        aRem > 0 &&
        aRem <= 3
      ) {
        const tickKey = `${gameState.questionInstanceId || 'q'}_BUZZ_${aRem}`;
        if (lastTickRef.current !== tickKey) {
          lastTickRef.current = tickKey;
          soundEngine.playTick(true);
        }
      } else if (
        gameState.fsmState !== 'QUESTION_ACTIVE' &&
        gameState.fsmState !== 'FINAL_QUESTION_ACTIVE' &&
        gameState.fsmState !== 'BUZZER_LOCKED'
      ) {
        lastTickRef.current = '';
      }
    };

    syncTimers();
    const timerId = setInterval(syncTimers, 100); // 100ms for smoother countdown
    return () => clearInterval(timerId);
  }, [gameState]);

  const sendAction = useCallback(
    async (action: string, payload: Record<string, unknown> = {}): Promise<ActionResponse> => {
      const sendViaHttp = async (): Promise<ActionResponse> => {
        const res = await fetch('/api/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, payload }),
        });
        const data = (await res.json()) as ActionResponse;
        if (data.state) {
          applyServerState(data.state, data.questions);
        }
        return data;
      };

      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        return new Promise<ActionResponse>((resolve) => {
          const timer = setTimeout(() => {
            pendingAcksRef.current.delete(requestId);
            void sendViaHttp().then(resolve).catch(() => resolve({ status: 'TIMEOUT' }));
          }, 2500);

          pendingAcksRef.current.set(requestId, { resolve, timer });
          ws.send(JSON.stringify({ type: 'action', requestId, action, payload }));
        });
      }

      return sendViaHttp();
    },
    [applyServerState]
  );

  return {
    gameState,
    questions,
    connected,
    loading,
    questionRemainingSec,
    answerRemainingSec,
    sendAction,
    refreshState: fetchInitialState,
  };
}

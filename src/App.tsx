import { useCallback, useEffect, useRef, useState } from 'react';
import { HostView } from './components/HostView';
import { MobileView } from './components/MobileView';
import { PrintableReport } from './components/PrintableReport';
import { SettingsView } from './components/SettingsView';
import { TVView } from './components/TVView';
import { ViewNavBar } from './components/ViewNavBar';
import { useTriviaRealtime } from './hooks/useTriviaRealtime';
import type { ScreenView } from './types/game';
import { soundEngine } from './utils/audio';

function readRouteFromLocation(): { view: ScreenView; teamId: string; teamToken: string } {
  const params = new URLSearchParams(window.location.search);
  const rawView = (params.get('view') || 'host').toLowerCase();
  const validView: ScreenView =
    rawView === 'tv' || rawView === 'mobile' || rawView === 'settings' ? rawView : 'host';
  const rawTeam = params.get('team');
  const parsedTeam = Number(rawTeam);
  const teamId =
    rawTeam && Number.isInteger(parsedTeam) && parsedTeam >= 1 && parsedTeam <= 8
      ? String(parsedTeam)
      : '';
  const teamToken = (params.get('token') || '').trim();
  return { view: validView, teamId, teamToken };
}

export function App() {
  const initialRoute = readRouteFromLocation();
  const [activeView, setActiveView] = useState<ScreenView>(initialRoute.view);
  const [mobileTeamId, setMobileTeamId] = useState<string>(initialRoute.teamId);
  const [mobileTeamToken, setMobileTeamToken] = useState<string>(initialRoute.teamToken);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    gameState,
    questions,
    loading,
    questionRemainingSec,
    answerRemainingSec,
    sendAction,
  } = useTriviaRealtime();

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastMsg(null);
    }, 3400);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      soundEngine.close();
    };
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const next = readRouteFromLocation();
      setActiveView(next.view);
      setMobileTeamId(next.teamId);
      setMobileTeamToken(next.teamToken);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // تطبيق السمة البصرية والخطوط والمتغيرات المخصصة لحظياً على documentElement
  useEffect(() => {
    if (!gameState) return;
    const root = document.documentElement;
    root.setAttribute('data-theme', gameState.activeTheme || 'luxury');
    root.setAttribute('data-font', gameState.settings.fontPair || 'cairo-almarai');

    const trackedTokens = [
      '--bg-canvas',
      '--bg-card',
      '--border-subtle',
      '--text-primary',
      '--text-secondary',
      '--icon-container-bg',
      '--icon-primary',
      '--buzzer-border',
    ];
    for (const key of trackedTokens) {
      const customVal = gameState.customTokens?.[key];
      if (customVal) {
        root.style.setProperty(key, customVal);
      } else {
        root.style.removeProperty(key);
      }
    }
  }, [gameState?.activeTheme, gameState?.settings.fontPair, gameState?.customTokens]);

  const navigate = useCallback((view: ScreenView, teamId?: string, teamToken?: string) => {
    const targetTeam = teamId || mobileTeamId || '';
    const targetToken = teamToken !== undefined ? teamToken : mobileTeamToken;
    setActiveView(view);
    if (teamId !== undefined) setMobileTeamId(targetTeam);
    if (teamToken !== undefined) setMobileTeamToken(targetToken);

    const url = new URL(window.location.href);
    url.searchParams.set('view', view);
    if (view === 'mobile') {
      if (targetTeam) url.searchParams.set('team', targetTeam);
      else url.searchParams.delete('team');
      if (targetToken) url.searchParams.set('token', targetToken);
      else url.searchParams.delete('token');
    } else {
      url.searchParams.delete('team');
      url.searchParams.delete('token');
    }
    window.history.pushState({}, '', url.toString());
  }, [mobileTeamId, mobileTeamToken]);

  if (loading || !gameState) {
    return (
      <div className="surface-canvas flex min-h-dvh items-center justify-center p-6">
        <div className="surface-card rounded-3xl px-8 py-6 text-center">
          <p className="font-display text-xl font-black text-primary-token">
            ⏳ جاري تهيئة منصة بطولة النخبة الكبرى...
          </p>
        </div>
      </div>
    );
  }

  const showAdminNav = activeView === 'host' || activeView === 'settings';

  return (
    <div className="surface-canvas min-h-dvh">
      {showAdminNav && (
        <ViewNavBar
          activeView={activeView}
          onNavigate={navigate}
        />
      )}

      {activeView === 'tv' && (
        <TVView
          gameState={gameState}
          questionRemainingSec={questionRemainingSec}
          answerRemainingSec={answerRemainingSec}
          onAction={sendAction}
          onToast={showToast}
        />
      )}

      {activeView === 'mobile' && (
        <MobileView
          gameState={gameState}
          teamId={mobileTeamId}
          teamToken={mobileTeamToken}
          questionRemainingSec={questionRemainingSec}
          answerRemainingSec={answerRemainingSec}
          onAction={sendAction}
          onToast={showToast}
        />
      )}

      {activeView === 'host' && (
        <HostView
          gameState={gameState}
          questions={questions}
          questionRemainingSec={questionRemainingSec}
          answerRemainingSec={answerRemainingSec}
          onAction={sendAction}
          onToast={showToast}
        />
      )}

      {activeView === 'settings' && (
        <SettingsView
          gameState={gameState}
          onAction={sendAction}
          onToast={showToast}
        />
      )}

      <PrintableReport gameState={gameState} />

      {toastMsg && (
        <div
          role="status"
          aria-live="polite"
          className="toast-token fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-2xl px-5 py-3 font-display text-sm font-black"
        >
          {toastMsg}
        </div>
      )}
    </div>
  );
}

export default App;

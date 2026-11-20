import type { ScreenView } from '../types/game';

interface ViewNavBarProps {
  activeView: ScreenView;
  onNavigate: (view: ScreenView) => void;
}

export function ViewNavBar({ activeView, onNavigate }: ViewNavBarProps) {
  return (
    <nav className="surface-card sticky top-0 z-40 rounded-none border-x-0 border-t-0 px-4 py-2.5">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="pill-accent-token rounded-lg px-2.5 py-1 font-display text-xs font-black">
            بطولة النخبة الكبرى
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onNavigate('host')}
            className={`btn-token btn-token-sm whitespace-nowrap shrink-0 ${activeView === 'host' ? 'btn-primary-token' : ''}`}
          >
            🎙️ المقدم
          </button>
          <button
            type="button"
            onClick={() => onNavigate('settings')}
            className={`btn-token btn-token-sm whitespace-nowrap shrink-0 ${activeView === 'settings' ? 'btn-primary-token' : ''}`}
          >
            ⚙️ الإعدادات والأسئلة
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <a
            href="?view=tv"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-token btn-token-sm whitespace-nowrap shrink-0 no-underline"
          >
            📺 فتح شاشة الجمهور ↗️
          </a>
        </div>
      </div>
    </nav>
  );
}

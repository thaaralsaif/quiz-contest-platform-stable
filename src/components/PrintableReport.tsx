import { getActiveTeamIds, getTeamDisplayName } from '../hooks/useTriviaRealtime';
import type { GameState } from '../types/game';

interface PrintableReportProps {
  gameState: GameState;
}

export function PrintableReport({ gameState }: PrintableReportProps) {
  const rankedTeams = getActiveTeamIds(gameState)
    .map((id) => ({
      id,
      name: getTeamDisplayName(gameState, id),
      score: Number(gameState.scores[id]) || 0,
      eliminated: gameState.eliminatedTeams.includes(id),
    }))
    .sort((a, b) => b.score - a.score);

  const todayFormatted = new Date().toLocaleDateString('ar-SA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const stats = gameState.matchStats;

  return (
    <section id="printable-report-area" aria-label="التقرير الرسمي لنتائج المسابقة">
      <div className="print-header-divider">
        <h1 className="text-2xl font-black">التقرير الرسمي لنتائج بطولة النخبة الكبرى</h1>
        <p className="print-muted-text mt-1 text-sm font-bold">
          تاريخ الإصدار: {todayFormatted} | الجولة: {gameState.currentRoundLabel} | عدد الأسئلة الملعوبة: {stats.questionsPlayed}
        </p>
      </div>

      <table className="print-table">
        <thead>
          <tr>
            <th>المركز</th>
            <th>اسم الفريق</th>
            <th>الحالة</th>
            <th>النقاط النهائية</th>
          </tr>
        </thead>
        <tbody>
          {rankedTeams.map((team, idx) => (
            <tr key={team.id}>
              <td>#{idx + 1}</td>
              <td>{team.name}</td>
              <td>{team.eliminated ? 'مستبعد (إقصاء)' : 'متأهل'}</td>
              <td>{team.score} نقطة</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-6 grid grid-cols-3 gap-4 border-t pt-4 text-sm font-bold">
        <div>
          <span className="print-muted-text block text-xs">ضغطات الضاغط السريع</span>
          <span>{stats.buzzerHits} ضغطة</span>
        </div>
        <div>
          <span className="print-muted-text block text-xs">إجمالي التصويت السري</span>
          <span>{stats.secretVotesTotal} تصويت</span>
        </div>
        <div>
          <span className="print-muted-text block text-xs">أسرع استجابة مسجلة</span>
          <span>
            {stats.fastestMs > 0
              ? `${stats.fastestTeamName} (${(stats.fastestMs / 1000).toFixed(2)} ث)`
              : 'لم تُسجّل بعد'}
          </span>
        </div>
      </div>
    </section>
  );
}

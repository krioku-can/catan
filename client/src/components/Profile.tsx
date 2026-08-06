import { useState } from 'react';
import { getStats, getHistory, clearHistory, formatDate, type ProfileStats, type GameRecord } from '../stats';

export default function Profile({ onBack }: { onBack?: () => void }) {
  const [stats, setStats] = useState<ProfileStats>(() => getStats());
  const [history, setHistory] = useState<GameRecord[]>(() => getHistory());
  const [confirmClear, setConfirmClear] = useState(false);

  const handleClear = () => {
    clearHistory();
    setStats(getStats());
    setHistory([]);
    setConfirmClear(false);
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>📊 Profile</h1>

      <div style={styles.statsCard}>
        <div style={styles.statGrid}>
          <div style={styles.stat}>
            <span style={styles.statValue}>{stats.gamesPlayed}</span>
            <span style={styles.statLabel}>Games</span>
          </div>
          <div style={styles.stat}>
            <span style={{ ...styles.statValue, color: '#2ecc71' }}>{stats.wins}</span>
            <span style={styles.statLabel}>Wins</span>
          </div>
          <div style={styles.stat}>
            <span style={{ ...styles.statValue, color: '#e74c3c' }}>{stats.losses}</span>
            <span style={styles.statLabel}>Losses</span>
          </div>
          <div style={styles.stat}>
            <span style={styles.statValue}>{stats.winRate}%</span>
            <span style={styles.statLabel}>Win Rate</span>
          </div>
          <div style={styles.stat}>
            <span style={styles.statValue}>{stats.currentStreak}</span>
            <span style={styles.statLabel}>Streak</span>
          </div>
          <div style={styles.stat}>
            <span style={styles.statValue}>{stats.bestVictoryPoints}</span>
            <span style={styles.statLabel}>Best Pts</span>
          </div>
        </div>

        {stats.longestStreak > 0 && (
          <div style={styles.streakNote}>
            🔥 Longest win streak: <strong>{stats.longestStreak}</strong>
            {stats.avgPointsPerWin > 0 && <> · Avg points per win: <strong>{stats.avgPointsPerWin}</strong></>}
          </div>
        )}
      </div>

      <div style={styles.historyHeader}>
        <h2 style={styles.h2}>Recent Games</h2>
        {history.length > 0 && (
          !confirmClear ? (
            <button style={styles.clearBtn} onClick={() => setConfirmClear(true)}>Clear</button>
          ) : (
            <div style={styles.confirmRow}>
              <span style={styles.confirmText}>Sure?</span>
              <button style={styles.confirmYes} onClick={handleClear}>Yes</button>
              <button style={styles.confirmNo} onClick={() => setConfirmClear(false)}>No</button>
            </div>
          )
        )}
      </div>

      {history.length === 0 ? (
        <div style={styles.empty}>
          <p>No games played yet.</p>
          <p style={styles.emptyHint}>Play a game and your results will show up here.</p>
        </div>
      ) : (
        <div style={styles.historyList}>
          {[...history].reverse().map(rec => (
            <div key={rec.id} style={styles.historyRow}>
              <div style={styles.historyResult}>
                <span style={{ ...styles.resultBadge, ...(rec.won ? styles.won : styles.lost) }}>
                  {rec.won ? 'W' : 'L'}
                </span>
                <span style={styles.historyDate}>{formatDate(rec.date)}</span>
              </div>
              <div style={styles.historyMeta}>
                <span style={styles.historyMode}>
                  {rec.mode === 'ai' ? 'vs AI' : 'Online'} · {rec.players} players
                </span>
                {rec.victoryPoints > 0 && (
                  <span style={styles.historyPts}>🏆 {rec.victoryPoints} pts</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {onBack && (
        <button type="button" style={styles.backBtn} onClick={onBack}>← Back</button>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100dvh',
    background: '#1a1a2e',
    color: '#e0e0e0',
    fontFamily: 'Segoe UI, sans-serif',
    padding: 20,
    maxWidth: 480,
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
  },
  title: {
    fontSize: 32,
    color: '#ffd700',
    margin: '0 0 20px',
    textAlign: 'center',
    textShadow: '0 0 20px rgba(255,215,0,0.3)',
  },
  statsCard: {
    background: '#16213e',
    borderRadius: 14,
    padding: 20,
    marginBottom: 20,
  },
  statGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 12,
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '12px 8px',
    background: '#0f3460',
    borderRadius: 10,
  },
  statValue: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  statLabel: {
    fontSize: 12,
    color: '#8890a0',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  streakNote: {
    marginTop: 16,
    fontSize: 14,
    color: '#8890a0',
    textAlign: 'center',
  },
  historyHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  h2: {
    fontSize: 18,
    margin: 0,
    color: '#ffd700',
  },
  clearBtn: {
    padding: '6px 14px',
    border: '1px solid #e74c3c',
    borderRadius: 6,
    background: 'transparent',
    color: '#e74c3c',
    cursor: 'pointer',
    fontSize: 13,
  },
  confirmRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  confirmText: {
    fontSize: 13,
    color: '#e74c3c',
  },
  confirmYes: {
    padding: '4px 10px',
    border: 'none',
    borderRadius: 6,
    background: '#e74c3c',
    color: 'white',
    cursor: 'pointer',
    fontSize: 12,
  },
  confirmNo: {
    padding: '4px 10px',
    border: '1px solid #0f3460',
    borderRadius: 6,
    background: 'transparent',
    color: '#8890a0',
    cursor: 'pointer',
    fontSize: 12,
  },
  empty: {
    textAlign: 'center',
    padding: '30px 20px',
    background: '#16213e',
    borderRadius: 14,
    color: '#8890a0',
  },
  emptyHint: {
    fontSize: 13,
    marginTop: 6,
  },
  historyList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    marginBottom: 20,
  },
  historyRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 14px',
    background: '#16213e',
    borderRadius: 10,
  },
  historyResult: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  resultBadge: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 'bold',
    fontSize: 16,
  },
  won: {
    background: '#2ecc71',
    color: '#fff',
  },
  lost: {
    background: '#e74c3c',
    color: '#fff',
  },
  historyDate: {
    fontSize: 14,
    color: '#8890a0',
  },
  historyMeta: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 2,
  },
  historyMode: {
    fontSize: 13,
    color: '#e0e0e0',
  },
  historyPts: {
    fontSize: 12,
    color: '#ffd700',
  },
  backBtn: {
    padding: '14px',
    border: '1px solid #0f3460',
    borderRadius: 10,
    background: '#0f3460',
    color: '#e0e0e0',
    cursor: 'pointer',
    fontSize: 16,
    fontWeight: 'bold',
  },
};

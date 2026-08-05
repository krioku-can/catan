import type { Player } from '../game/types';

interface PlayerHandProps {
  player: Player;
}

const RESOURCE_ICONS: Record<string, string> = {
  brick: '🧱',
  lumber: '🪵',
  wool: '🐑',
  grain: '🌾',
  ore: '⛏️',
};

export default function PlayerHand({ player }: PlayerHandProps) {
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={{ ...styles.colorDot, backgroundColor: player.color }} />
        <span style={styles.name}>{player.name}</span>
        <span style={styles.vp}>{player.victoryPoints} VP</span>
      </div>
      <div style={styles.resources}>
        {(['brick', 'lumber', 'wool', 'grain', 'ore'] as const).map(r => (
          <div key={r} style={styles.resource}>
            <span style={styles.icon}>{RESOURCE_ICONS[r]}</span>
            <span style={styles.count}>{player.resources[r]}</span>
          </div>
        ))}
      </div>
      {player.devCards.length > 0 && (
        <div style={styles.devCards}>
          <span style={styles.devLabel}>Dev Cards: {player.devCards.filter(c => !c.played).length} unplayed</span>
        </div>
      )}
      <div style={styles.pieces}>
        <span>🏘️ {player.settlementsRemaining}</span>
        <span>🏙️ {player.citiesRemaining}</span>
        <span>🛣️ {player.roadsRemaining}</span>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#0f3460',
    borderRadius: 8,
    padding: 12,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: '50%',
  },
  name: {
    fontSize: 14,
    fontWeight: 'bold',
    flex: 1,
  },
  vp: {
    fontSize: 14,
    color: '#ffd700',
    fontWeight: 'bold',
  },
  resources: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
  },
  resource: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    background: '#1a1a2e',
    borderRadius: 4,
    padding: '2px 6px',
  },
  icon: {
    fontSize: 14,
  },
  count: {
    fontSize: 13,
    fontWeight: 'bold',
    minWidth: 12,
    textAlign: 'center',
  },
  devCards: {
    marginTop: 6,
    fontSize: 12,
    color: '#8890a0',
  },
  devLabel: {
    fontSize: 12,
  },
  pieces: {
    display: 'flex',
    gap: 12,
    marginTop: 6,
    fontSize: 12,
    color: '#8890a0',
  },
};

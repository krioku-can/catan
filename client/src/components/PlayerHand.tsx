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
      <div style={styles.footer}>
        <span>🏘️ {player.settlementsRemaining}</span>
        <span>🏙️ {player.citiesRemaining}</span>
        <span>🛣️ {player.roadsRemaining}</span>
        {player.devCards.filter(c => !c.played).length > 0 && (
          <span>📜 {player.devCards.filter(c => !c.played).length}</span>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#0f3460',
    borderRadius: 8,
    padding: 10,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    flexShrink: 0,
  },
  name: {
    fontSize: 13,
    fontWeight: 'bold',
    flex: 1,
  },
  vp: {
    fontSize: 13,
    color: '#ffd700',
    fontWeight: 'bold',
  },
  resources: {
    display: 'flex',
    gap: 4,
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
    fontSize: 13,
  },
  count: {
    fontSize: 12,
    fontWeight: 'bold',
    minWidth: 10,
    textAlign: 'center',
  },
  footer: {
    display: 'flex',
    gap: 8,
    marginTop: 6,
    fontSize: 11,
    color: '#8890a0',
  },
};

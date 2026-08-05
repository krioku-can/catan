import type { Player, ResourceType } from '../game/types';

interface PlayerHandProps {
  player: Player & {
    _hidden?: boolean;
    _resourceCount?: number;
    _devCardCount?: number;
  };
  /** When true, show actual resources (your hand). When false, only card counts. */
  isMe?: boolean;
}

const RESOURCE_META: { type: ResourceType; label: string; color: string; emoji: string }[] = [
  { type: 'brick', label: 'Brick', color: '#c0392b', emoji: '🧱' },
  { type: 'lumber', label: 'Lumber', color: '#27ae60', emoji: '🪵' },
  { type: 'wool', label: 'Wool', color: '#7fba3d', emoji: '🐑' },
  { type: 'grain', label: 'Grain', color: '#f1c40f', emoji: '🌾' },
  { type: 'ore', label: 'Ore', color: '#7f8c8d', emoji: '⛏️' },
];

export default function PlayerHand({ player, isMe = false }: PlayerHandProps) {
  const hidden = player._hidden || !isMe;
  const resourceCount = hidden
    ? (player._resourceCount ?? 0)
    : RESOURCE_META.reduce((s, r) => s + (player.resources[r.type] || 0), 0);
  const devCount = hidden
    ? (player._devCardCount ?? player.devCards.filter(c => !c.played).length)
    : player.devCards.filter(c => !c.played).length;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={{ ...styles.colorDot, backgroundColor: player.color }} />
        <span style={styles.name}>
          {player.name}{player.isAI ? ' 🤖' : ''}{isMe ? ' (You)' : ''}
        </span>
        <span style={styles.vp}>{player.victoryPoints} VP</span>
      </div>

      {isMe && !hidden ? (
        <>
          <div style={styles.cardRow}>
            {RESOURCE_META.map(r => {
              const n = player.resources[r.type] || 0;
              if (n <= 0) return null;
              return (
                <div key={r.type} style={{ ...styles.card, borderColor: r.color }}>
                  <div style={{ ...styles.cardFace, background: `linear-gradient(160deg, ${r.color}cc, ${r.color})` }}>
                    <span style={styles.cardEmoji}>{r.emoji}</span>
                    <span style={styles.cardLabel}>{r.label}</span>
                    <span style={styles.cardCount}>×{n}</span>
                  </div>
                </div>
              );
            })}
            {resourceCount === 0 && (
              <span style={styles.empty}>No resource cards</span>
            )}
          </div>
          {devCount > 0 && (
            <div style={styles.devRow}>
              {player.devCards.filter(c => !c.played).map((c, i) => (
                <div key={i} style={styles.devCard}>
                  📜 {c.type.replace('_', ' ')}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div style={styles.hiddenRow}>
          {/* Face-down card backs only */}
          <div style={styles.backs}>
            {Array.from({ length: Math.min(resourceCount, 8) }).map((_, i) => (
              <div
                key={i}
                style={{
                  ...styles.cardBack,
                  marginLeft: i === 0 ? 0 : -18,
                  zIndex: i,
                }}
              />
            ))}
            {resourceCount > 8 && <span style={styles.more}>+{resourceCount - 8}</span>}
          </div>
          <div style={styles.hiddenMeta}>
            <span>🃏 {resourceCount} cards</span>
            {devCount > 0 && <span>📜 {devCount}</span>}
          </div>
        </div>
      )}

      <div style={styles.footer}>
        <span>🏘️ {player.settlementsRemaining}</span>
        <span>🏙️ {player.citiesRemaining}</span>
        <span>🛣️ {player.roadsRemaining}</span>
        {player.playedKnights > 0 && <span>⚔️ {player.playedKnights}</span>}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#0f3460',
    borderRadius: 10,
    padding: 10,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
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
  cardRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    minHeight: 56,
  },
  card: {
    borderRadius: 8,
    border: '2px solid',
    overflow: 'hidden',
    width: 52,
  },
  cardFace: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '6px 4px',
    color: 'white',
    textShadow: '0 1px 2px rgba(0,0,0,0.4)',
  },
  cardEmoji: {
    fontSize: 18,
  },
  cardLabel: {
    fontSize: 9,
    fontWeight: 'bold',
    marginTop: 2,
  },
  cardCount: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  empty: {
    fontSize: 12,
    color: '#8890a0',
    padding: 8,
  },
  devRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 6,
  },
  devCard: {
    background: '#1a1a2e',
    borderRadius: 6,
    padding: '4px 8px',
    fontSize: 11,
    textTransform: 'capitalize',
    border: '1px solid #3498db',
  },
  hiddenRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  backs: {
    display: 'flex',
    alignItems: 'center',
    height: 44,
    paddingLeft: 4,
  },
  cardBack: {
    width: 32,
    height: 44,
    borderRadius: 4,
    background: 'linear-gradient(145deg, #1a5276, #0b3d5c)',
    border: '1px solid #2980b9',
    boxShadow: '1px 1px 3px rgba(0,0,0,0.4)',
    position: 'relative',
  },
  more: {
    marginLeft: 8,
    fontSize: 12,
    color: '#8890a0',
  },
  hiddenMeta: {
    display: 'flex',
    gap: 12,
    fontSize: 12,
    color: '#b0b8c8',
  },
  footer: {
    display: 'flex',
    gap: 10,
    marginTop: 8,
    fontSize: 11,
    color: '#8890a0',
  },
};

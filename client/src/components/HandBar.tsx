import type { Player, ResourceType } from '../game/types';
import { countHeldDevCards } from '../game/rules';

interface HandBarProps {
  player: Player & { _resourceCount?: number; _devCardCount?: number };
}

const RESOURCES: { type: ResourceType; label: string; color: string; emoji: string }[] = [
  { type: 'brick', label: 'Brick', color: '#c0392b', emoji: '🧱' },
  { type: 'lumber', label: 'Lumber', color: '#27ae60', emoji: '🪵' },
  { type: 'wool', label: 'Wool', color: '#8bc34a', emoji: '🐑' },
  { type: 'grain', label: 'Grain', color: '#f1c40f', emoji: '🌾' },
  { type: 'ore', label: 'Ore', color: '#7f8c8d', emoji: '⛏️' },
];

/**
 * Always-visible compact resource strip for the current player.
 * Shows each card type with its count so the player always knows what
 * they hold without opening the Hand tab.
 */
export default function HandBar({ player }: HandBarProps) {
  // Prefer authoritative held count (includes VPs). Fall back to server stash.
  const devCount = player._devCardCount ?? countHeldDevCards(player);
  return (
    <div style={styles.bar}>
      {RESOURCES.map(r => {
        const n = player.resources[r.type] || 0;
        return (
          <div key={r.type} style={styles.res}>
            <span style={styles.emoji}>{r.emoji}</span>
            <span
              style={{
                ...styles.count,
                color: n > 0 ? r.color : '#4a4a5e',
                background: n > 0 ? 'rgba(255,255,255,0.08)' : 'transparent',
              }}
            >
              {n}
            </span>
          </div>
        );
      })}
      <div style={styles.dev}>
        <span style={styles.emoji}>📜</span>
        <span style={{ ...styles.count, color: devCount > 0 ? '#3498db' : '#4a4a5e' }}>{devCount}</span>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-around',
    gap: 4,
    padding: '6px 10px',
    background: '#0f3460',
    borderTop: '1px solid #1a1a2e',
    flexShrink: 0,
  },
  res: {
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    flex: 1,
    justifyContent: 'center',
  },
  emoji: { fontSize: 16 },
  count: {
    fontSize: 15,
    fontWeight: 'bold',
    minWidth: 22,
    textAlign: 'center',
    borderRadius: 10,
    padding: '1px 5px',
  },
  dev: {
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    borderLeft: '1px solid #1a1a2e',
    paddingLeft: 8,
    flex: 0,
  },
};

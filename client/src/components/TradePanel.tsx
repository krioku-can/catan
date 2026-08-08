import type { GameState, ResourceType, PlayerColor } from '../game/types';
import { getCurrentPlayer } from '../game/rules';
import { getPortRate } from '../game/board';
import { useState } from 'react';

interface TradePanelProps {
  gameState: GameState;
  isMyTurn: boolean;
  onTrade: (offer: { give: Partial<Record<ResourceType, number>>; want: Partial<Record<ResourceType, number>>; target: PlayerColor | 'bank' }) => void;
}

const RESOURCE_NAMES = ['brick', 'lumber', 'wool', 'grain', 'ore'] as const;
const RESOURCE_ICONS = ['🧱', '🪵', '🐑', '🌾', '⛏️'];

export default function TradePanel({ gameState, isMyTurn, onTrade }: TradePanelProps) {
  const [showTrade, setShowTrade] = useState(false);
  const [give, setGive] = useState<Partial<Record<ResourceType, number>>>({});
  const [want, setWant] = useState<Partial<Record<ResourceType, number>>>({});
  const [target, setTarget] = useState<PlayerColor | 'bank'>('bank');

  const player = getCurrentPlayer(gameState);

  const handleTrade = () => {
    if (target === 'bank') {
      const giveResource = Object.entries(give)[0];
      const wantResource = Object.entries(want)[0];
      if (giveResource && wantResource) {
        const [gRes, gAmt] = giveResource;
        const [wRes, wAmt] = wantResource;
        // Don't mutate state directly here — delegate to the parent, which
        // decides how to apply the trade (local refresh vs server action).
        // The parent also triggers the re-render that keeps the hand fresh.
        onTrade({
          give: { [gRes]: gAmt || 0 },
          want: { [wRes]: wAmt || 0 },
          target,
        });
        setGive({});
        setWant({});
      }
    } else {
      // Domestic trade: pass through to the parent (server handles it).
      const giveResource = Object.entries(give)[0];
      const wantResource = Object.entries(want)[0];
      if (giveResource && wantResource) {
        onTrade({
          give: { [giveResource[0] as ResourceType]: giveResource[1] || 0 },
          want: { [wantResource[0] as ResourceType]: wantResource[1] || 0 },
          target,
        });
        setGive({});
        setWant({});
      }
    }
  };

  if (!isMyTurn) return null;

  // Compute the player's best bank rate for the resource they're giving.
  const giveRes = Object.keys(give)[0] as ResourceType | undefined;
  const rate = giveRes ? getPortRate(player.color, giveRes, gameState.ports, gameState.intersections) : 4;

  return (
    <div style={styles.container}>
      <button
        style={styles.toggleBtn}
        onClick={() => setShowTrade(!showTrade)}
      >
        {showTrade ? '▼' : '▶'} Trade
      </button>
      {showTrade && (
        <div style={styles.panel}>
          <div style={styles.row}>
            <div style={styles.label}>Give</div>
            <div style={styles.resRow}>
              {RESOURCE_NAMES.map((r, i) => {
                const owned = player.resources[r] || 0;
                const disabled = owned <= 0;
                return (
                  <button
                    key={r}
                    style={{ ...styles.resBtn, ...(disabled ? styles.resBtnDisabled : {}) }}
                    disabled={disabled}
                    onClick={() => setGive({ [r]: (give[r] || 0) + 1 })}
                  >
                    {RESOURCE_ICONS[i]} {give[r] || 0}
                    <span style={styles.owned}>/{owned}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div style={styles.row}>
            <div style={styles.label}>Want</div>
            <div style={styles.resRow}>
              {RESOURCE_NAMES.map((r, i) => (
                <button
                  key={r}
                  style={styles.resBtn}
                  onClick={() => setWant({ [r]: (want[r] || 0) + 1 })}
                >
                  {RESOURCE_ICONS[i]} {want[r] || 0}
                </button>
              ))}
            </div>
          </div>
          <div style={styles.row}>
            <div style={styles.label}>With</div>
            <select
              style={styles.select}
              value={target}
              onChange={e => setTarget(e.target.value as PlayerColor | 'bank')}
            >
              <option value="bank">Bank ({rate}:1)</option>
              {gameState.players
                .filter(p => p.color !== player.color)
                .map(p => (
                  <option key={p.color} value={p.color}>
                    {p.name}
                  </option>
                ))}
            </select>
          </div>
          <button style={styles.tradeBtn} onClick={handleTrade}>
            Trade
          </button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#0f3460',
    borderRadius: 8,
    overflow: 'hidden',
  },
  toggleBtn: {
    width: '100%',
    padding: '10px 12px',
    border: 'none',
    background: 'transparent',
    color: '#e0e0e0',
    fontSize: 14,
    fontWeight: 'bold',
    cursor: 'pointer',
    textAlign: 'left',
  },
  panel: {
    padding: '0 12px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  row: {},
  label: {
    fontSize: 11,
    color: '#8890a0',
    marginBottom: 4,
  },
  resRow: {
    display: 'flex',
    gap: 4,
    flexWrap: 'wrap',
  },
  resBtn: {
    padding: '6px 10px',
    border: '1px solid #1a1a2e',
    borderRadius: 6,
    background: '#1a1a2e',
    color: '#e0e0e0',
    cursor: 'pointer',
    fontSize: 13,
  },
  resBtnDisabled: {
    opacity: 0.35,
    cursor: 'not-allowed',
  },
  owned: {
    fontSize: 10,
    color: '#8890a0',
    marginLeft: 2,
  },
  select: {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid #1a1a2e',
    borderRadius: 6,
    background: '#1a1a2e',
    color: '#e0e0e0',
    fontSize: 13,
  },
  tradeBtn: {
    padding: '10px 12px',
    border: 'none',
    borderRadius: 6,
    background: 'linear-gradient(135deg, #3498db, #2980b9)',
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
    cursor: 'pointer',
  },
};

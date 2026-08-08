import { useState } from 'react';
import type { GameState, ResourceType, PlayerColor } from '../game/types';
import { getCurrentPlayer } from '../game/rules';
import { getPortRate } from '../game/board';

interface TradePanelProps {
  gameState: GameState;
  isMyTurn: boolean;
  onBankTrade: (give: Partial<Record<ResourceType, number>>, want: Partial<Record<ResourceType, number>>) => void;
  onProposeTrade: (to: PlayerColor, give: Partial<Record<ResourceType, number>>, want: Partial<Record<ResourceType, number>>) => void;
}

const RESOURCES: ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];
const RESOURCE_ICONS: Record<ResourceType, string> = {
  brick: '🧱', lumber: '🪵', wool: '🐑', grain: '🌾', ore: '⛏️',
};
const RESOURCE_NAMES: Record<ResourceType, string> = {
  brick: 'Brick', lumber: 'Wood', wool: 'Sheep', grain: 'Wheat', ore: 'Ore',
};

type Tab = 'bank' | 'players';

export default function TradePanel({ gameState, isMyTurn, onBankTrade, onProposeTrade }: TradePanelProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('bank');
  const [give, setGive] = useState<Partial<Record<ResourceType, number>>>({});
  const [want, setWant] = useState<Partial<Record<ResourceType, number>>>({});
  const [target, setTarget] = useState<PlayerColor | ''>('');

  const player = getCurrentPlayer(gameState);
  if (!isMyTurn) return null;

  const giveRes = Object.keys(give)[0] as ResourceType | undefined;
  const rate = giveRes ? getPortRate(player.color, giveRes, gameState.ports, gameState.intersections) : 4;

  const totalGive = Object.values(give).reduce((s, n) => s + (n || 0), 0);
  const totalWant = Object.values(want).reduce((s, n) => s + (n || 0), 0);

  const canBankTrade = giveRes && totalGive >= rate && totalGive % rate === 0 && totalWant > 0;
  const canPropose = target && totalGive > 0 && totalWant > 0;

  const reset = () => { setGive({}); setWant({}); setTarget(''); };

  const handleBankTrade = () => {
    if (!canBankTrade) return;
    onBankTrade(give, want);
    reset();
  };

  const handlePropose = () => {
    if (!canPropose || !target) return;
    onProposeTrade(target, give, want);
    reset();
  };

  return (
    <div style={styles.container}>
      <button style={styles.toggleBtn} onClick={() => setOpen(!open)}>
        {open ? '▼' : '▶'} Trade
      </button>
      {open && (
        <div style={styles.panel}>
          <div style={styles.tabs}>
            <button
              style={{ ...styles.tab, ...(tab === 'bank' ? styles.tabActive : {}) }}
              onClick={() => setTab('bank')}
            >
              🏦 Bank
            </button>
            <button
              style={{ ...styles.tab, ...(tab === 'players' ? styles.tabActive : {}) }}
              onClick={() => setTab('players')}
            >
              👥 Players
            </button>
          </div>

          {/* Give row */}
          <div style={styles.row}>
            <div style={styles.label}>Give</div>
            <div style={styles.resRow}>
              {RESOURCES.map(r => {
                const owned = player.resources[r] || 0;
                const selected = give[r] || 0;
                const atMax = selected >= owned;
                const disabled = owned <= 0;
                return (
                  <button
                    key={r}
                    style={{ ...styles.resBtn, ...(disabled ? styles.resBtnDisabled : {}) }}
                    disabled={disabled}
                    onClick={() => {
                      // Click to add; if already at max, click again to remove.
                      setGive({ ...give, [r]: atMax ? 0 : selected + 1 });
                    }}
                  >
                    {RESOURCE_ICONS[r]} {selected}
                    <span style={styles.owned}>/{owned}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Want row */}
          <div style={styles.row}>
            <div style={styles.label}>Want</div>
            <div style={styles.resRow}>
              {RESOURCES.map(r => {
                const selected = want[r] || 0;
                return (
                  <button
                    key={r}
                    style={styles.resBtn}
                    onClick={() => {
                      // Click to add; click again to remove.
                      setWant({ ...want, [r]: selected > 0 ? 0 : selected + 1 });
                    }}
                  >
                    {RESOURCE_ICONS[r]} {selected}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Target / rate */}
          {tab === 'bank' ? (
            <div style={styles.rateRow}>
              <span style={styles.rateText}>
                {giveRes
                  ? `${rate} ${RESOURCE_NAMES[giveRes]} → 1 any`
                  : 'Select a resource to give'}
              </span>
            </div>
          ) : (
            <div style={styles.row}>
              <div style={styles.label}>Trade with</div>
              <select
                style={styles.select}
                value={target}
                onChange={e => setTarget(e.target.value as PlayerColor)}
              >
                <option value="" disabled>Choose a player…</option>
                {gameState.players
                  .filter(p => p.color !== player.color)
                  .map(p => (
                    <option key={p.color} value={p.color}>
                      {p.name} {p.isAI ? '🤖' : ''}
                    </option>
                  ))}
              </select>
            </div>
          )}

          <div style={styles.btnRow}>
            <button
              style={{ ...styles.tradeBtn, ...(!(tab === 'bank' ? canBankTrade : canPropose) ? styles.tradeBtnDisabled : {}) }}
              disabled={!(tab === 'bank' ? canBankTrade : canPropose)}
              onClick={tab === 'bank' ? handleBankTrade : handlePropose}
            >
              {tab === 'bank' ? `Trade ${rate}:1` : 'Send Offer'}
            </button>
            <button style={styles.resetBtn} onClick={reset} title="Clear selection">
              ↺ Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { background: '#0f3460', borderRadius: 8, overflow: 'hidden' },
  toggleBtn: {
    width: '100%', padding: '10px 12px', border: 'none', background: 'transparent',
    color: '#e0e0e0', fontSize: 14, fontWeight: 'bold', cursor: 'pointer', textAlign: 'left',
  },
  panel: {
    padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8,
  },
  tabs: { display: 'flex', gap: 6, marginTop: 4 },
  tab: {
    flex: 1, padding: '8px 10px', border: '1px solid #1a1a2e', borderRadius: 6,
    background: '#1a1a2e', color: '#8890a0', fontSize: 13, fontWeight: 'bold', cursor: 'pointer',
  },
  tabActive: { borderColor: '#ffd700', color: '#ffd700', background: '#16213e' },
  row: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 11, color: '#8890a0' },
  resRow: { display: 'flex', gap: 4, flexWrap: 'wrap' },
  resBtn: {
    padding: '6px 10px', border: '1px solid #1a1a2e', borderRadius: 6,
    background: '#1a1a2e', color: '#e0e0e0', cursor: 'pointer', fontSize: 13,
  },
  resBtnDisabled: { opacity: 0.35, cursor: 'not-allowed' },
  owned: { fontSize: 10, color: '#8890a0', marginLeft: 2 },
  rateRow: { padding: '8px 10px', background: '#1a1a2e', borderRadius: 6 },
  rateText: { fontSize: 12, color: '#ffd700', fontWeight: 'bold' },
  select: {
    width: '100%', padding: '8px 10px', border: '1px solid #1a1a2e', borderRadius: 6,
    background: '#1a1a2e', color: '#e0e0e0', fontSize: 13,
  },
  tradeBtn: {
    padding: '10px 12px', border: 'none', borderRadius: 6,
    background: 'linear-gradient(135deg, #3498db, #2980b9)',
    color: 'white', fontSize: 14, fontWeight: 'bold', cursor: 'pointer',
  },
  tradeBtnDisabled: { opacity: 0.4, cursor: 'not-allowed' },
  btnRow: { display: 'flex', gap: 6 },
  resetBtn: {
    padding: '10px 12px', border: '1px solid #8890a0', borderRadius: 6,
    background: 'transparent', color: '#8890a0', fontSize: 13, fontWeight: 'bold', cursor: 'pointer',
    flexShrink: 0,
  },
};

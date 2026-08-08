import { useState } from 'react';
import type { GameState, ResourceType, PlayerColor, TurnPhase } from '../game/types';
import { getCurrentPlayer } from '../game/rules';
import { getPortRate } from '../game/board';

interface TradePanelProps {
  gameState: GameState;
  isMyTurn: boolean;
  phase: TurnPhase;
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

export default function TradePanel({ gameState, isMyTurn, phase, onBankTrade, onProposeTrade }: TradePanelProps) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<Tab>('bank');
  // Bank: single give resource + amount; single want resource.
  const [bankGive, setBankGive] = useState<ResourceType | null>(null);
  const [bankGiveAmt, setBankGiveAmt] = useState(0);
  const [bankWant, setBankWant] = useState<ResourceType | null>(null);
  // Domestic: multi-resource give/want maps.
  const [give, setGive] = useState<Partial<Record<ResourceType, number>>>({});
  const [want, setWant] = useState<Partial<Record<ResourceType, number>>>({});
  const [target, setTarget] = useState<PlayerColor | ''>('');

  // Official: trade after production (trade/build), not before the roll.
  if (!isMyTurn || (phase !== 'trade' && phase !== 'build')) return null;

  const player = getCurrentPlayer(gameState);
  const rate = bankGive ? getPortRate(player.color, bankGive, gameState.ports, gameState.intersections) : 4;
  const bankReceived = bankGive && bankGiveAmt >= rate ? Math.floor(bankGiveAmt / rate) : 0;
  const canBankTrade =
    !!bankGive &&
    !!bankWant &&
    bankGive !== bankWant &&
    bankGiveAmt >= rate &&
    bankGiveAmt % rate === 0 &&
    (player.resources[bankGive] || 0) >= bankGiveAmt;

  const totalGive = Object.values(give).reduce((s, n) => s + (n || 0), 0);
  const totalWant = Object.values(want).reduce((s, n) => s + (n || 0), 0);
  const canPropose = !!target && totalGive > 0 && totalWant > 0;

  const reset = () => {
    setBankGive(null);
    setBankGiveAmt(0);
    setBankWant(null);
    setGive({});
    setWant({});
    setTarget('');
  };

  const handleBankTrade = () => {
    if (!canBankTrade || !bankGive || !bankWant) return;
    onBankTrade({ [bankGive]: bankGiveAmt }, { [bankWant]: bankReceived });
    reset();
  };

  const handlePropose = () => {
    if (!canPropose || !target) return;
    onProposeTrade(target, give, want);
    reset();
  };

  const bumpDomestic = (
    map: Partial<Record<ResourceType, number>>,
    setMap: (m: Partial<Record<ResourceType, number>>) => void,
    r: ResourceType,
    max?: number,
  ) => {
    const cur = map[r] || 0;
    if (max !== undefined) {
      if (cur >= max) {
        const next = { ...map };
        delete next[r];
        setMap(next);
        return;
      }
      setMap({ ...map, [r]: cur + 1 });
      return;
    }
    // Want side: cycle 0 → 1 → 2 → 3 → 0
    if (cur >= 3) {
      const next = { ...map };
      delete next[r];
      setMap(next);
    } else {
      setMap({ ...map, [r]: cur + 1 });
    }
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
              onClick={() => { setTab('bank'); }}
            >
              🏦 Bank
            </button>
            <button
              style={{ ...styles.tab, ...(tab === 'players' ? styles.tabActive : {}) }}
              onClick={() => { setTab('players'); }}
            >
              👥 Players
            </button>
          </div>

          {tab === 'bank' ? (
            <>
              <div style={styles.row}>
                <div style={styles.label}>Give (your resources)</div>
                <div style={styles.resRow}>
                  {RESOURCES.map(r => {
                    const owned = player.resources[r] || 0;
                    const rRate = getPortRate(player.color, r, gameState.ports, gameState.intersections);
                    const selected = bankGive === r;
                    const disabled = owned < rRate;
                    return (
                      <button
                        key={r}
                        style={{
                          ...styles.resBtn,
                          ...(selected ? styles.resBtnActive : {}),
                          ...(disabled ? styles.resBtnDisabled : {}),
                        }}
                        disabled={disabled}
                        onClick={() => {
                          if (selected) {
                            // Add another rate chunk, or clear if at max multiple.
                            const next = bankGiveAmt + rRate;
                            if (next > owned) {
                              setBankGive(null);
                              setBankGiveAmt(0);
                            } else {
                              setBankGiveAmt(next);
                            }
                          } else {
                            setBankGive(r);
                            setBankGiveAmt(rRate);
                            if (bankWant === r) setBankWant(null);
                          }
                        }}
                      >
                        {RESOURCE_ICONS[r]} {selected ? bankGiveAmt : 0}
                        <span style={styles.owned}>/{owned}</span>
                        <span style={styles.rateTag}>{rRate}:1</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={styles.row}>
                <div style={styles.label}>Want</div>
                <div style={styles.resRow}>
                  {RESOURCES.map(r => {
                    const selected = bankWant === r;
                    const disabled = bankGive === r;
                    return (
                      <button
                        key={r}
                        style={{
                          ...styles.resBtn,
                          ...(selected ? styles.resBtnActive : {}),
                          ...(disabled ? styles.resBtnDisabled : {}),
                        }}
                        disabled={disabled}
                        onClick={() => setBankWant(selected ? null : r)}
                      >
                        {RESOURCE_ICONS[r]} {selected ? bankReceived || 1 : 0}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={styles.rateRow}>
                <span style={styles.rateText}>
                  {bankGive && bankWant && bankReceived > 0
                    ? `${bankGiveAmt} ${RESOURCE_NAMES[bankGive]} → ${bankReceived} ${RESOURCE_NAMES[bankWant]} (${rate}:1)`
                    : bankGive
                      ? `Rate ${rate}:1 — pick what you want`
                      : 'Pick a resource to trade with the bank'}
                </span>
              </div>
            </>
          ) : (
            <>
              <div style={styles.row}>
                <div style={styles.label}>You give</div>
                <div style={styles.resRow}>
                  {RESOURCES.map(r => {
                    const owned = player.resources[r] || 0;
                    const selected = give[r] || 0;
                    return (
                      <button
                        key={r}
                        style={{
                          ...styles.resBtn,
                          ...(selected > 0 ? styles.resBtnActive : {}),
                          ...(owned <= 0 ? styles.resBtnDisabled : {}),
                        }}
                        disabled={owned <= 0}
                        onClick={() => bumpDomestic(give, setGive, r, owned)}
                      >
                        {RESOURCE_ICONS[r]} {selected}
                        <span style={styles.owned}>/{owned}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={styles.row}>
                <div style={styles.label}>You want</div>
                <div style={styles.resRow}>
                  {RESOURCES.map(r => {
                    const selected = want[r] || 0;
                    return (
                      <button
                        key={r}
                        style={{
                          ...styles.resBtn,
                          ...(selected > 0 ? styles.resBtnActive : {}),
                        }}
                        onClick={() => bumpDomestic(want, setWant, r)}
                      >
                        {RESOURCE_ICONS[r]} {selected}
                      </button>
                    );
                  })}
                </div>
              </div>

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
            </>
          )}

          <div style={styles.btnRow}>
            <button
              style={{
                ...styles.tradeBtn,
                ...(!(tab === 'bank' ? canBankTrade : canPropose) ? styles.tradeBtnDisabled : {}),
              }}
              disabled={!(tab === 'bank' ? canBankTrade : canPropose)}
              onClick={tab === 'bank' ? handleBankTrade : handlePropose}
            >
              {tab === 'bank'
                ? canBankTrade
                  ? `Trade ${bankGiveAmt} → ${bankReceived}`
                  : `Trade ${rate}:1`
                : 'Send Offer'}
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
    padding: '6px 8px', border: '1px solid #1a1a2e', borderRadius: 6,
    background: '#1a1a2e', color: '#e0e0e0', cursor: 'pointer', fontSize: 12,
    display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 52, gap: 1,
  },
  resBtnActive: { borderColor: '#ffd700', background: '#16213e', boxShadow: '0 0 6px rgba(255,215,0,0.25)' },
  resBtnDisabled: { opacity: 0.35, cursor: 'not-allowed' },
  owned: { fontSize: 10, color: '#8890a0' },
  rateTag: { fontSize: 9, color: '#3498db' },
  rateRow: { padding: '8px 10px', background: '#1a1a2e', borderRadius: 6 },
  rateText: { fontSize: 12, color: '#ffd700', fontWeight: 'bold' },
  select: {
    width: '100%', padding: '8px 10px', border: '1px solid #1a1a2e', borderRadius: 6,
    background: '#1a1a2e', color: '#e0e0e0', fontSize: 13,
  },
  tradeBtn: {
    flex: 1, padding: '10px 12px', border: 'none', borderRadius: 6,
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

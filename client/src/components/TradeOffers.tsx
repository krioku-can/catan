import { useState } from 'react';
import type { GameState, PlayerColor, ResourceType } from '../game/types';
import { getPlayerByColor } from '../game/rules';

const RESOURCES: ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];
const RESOURCE_ICONS: Record<string, string> = {
  brick: '🧱', lumber: '🪵', wool: '🐑', grain: '🌾', ore: '⛏️',
};

interface TradeOffersProps {
  gameState: GameState;
  myColor: PlayerColor;
  onAccept: (from: PlayerColor) => void;
  onReject: (from: PlayerColor) => void;
  onCounter: (from: PlayerColor, give: Partial<Record<ResourceType, number>>, want: Partial<Record<ResourceType, number>>) => void;
}

function fmtRes(res: Partial<Record<ResourceType, number>>): string {
  const entries = Object.entries(res || {});
  if (entries.length === 0) return 'nothing';
  return entries.map(([r, n]) => `${RESOURCE_ICONS[r] || ''}${n} ${r}`).join(', ');
}

export default function TradeOffers({ gameState, myColor, onAccept, onReject, onCounter }: TradeOffersProps) {
  const [countering, setCountering] = useState<PlayerColor | null>(null);
  const [give, setGive] = useState<Partial<Record<ResourceType, number>>>({});
  const [want, setWant] = useState<Partial<Record<ResourceType, number>>>({});

  const offers = gameState.tradeOffers.filter(o => o.to === myColor);
  if (offers.length === 0) return null;

  const myPlayer = getPlayerByColor(gameState, myColor);

  const startCounter = (from: PlayerColor) => {
    setCountering(from);
    setGive({});
    setWant({});
  };

  const sendCounter = (from: PlayerColor) => {
    if (Object.keys(give).length === 0 || Object.keys(want).length === 0) return;
    onCounter(from, give, want);
    setCountering(null);
    setGive({});
    setWant({});
  };

  return (
    <div style={styles.container}>
      {offers.map((offer, i) => {
        const from = getPlayerByColor(gameState, offer.from);
        const isCountering = countering === offer.from;
        return (
          <div key={i} style={styles.offer}>
            <div style={styles.text}>
              <strong style={{ color: from?.color }}>{from?.name}</strong> offers
              {' '}{fmtRes(offer.give)} for {fmtRes(offer.want)}
            </div>

            {!isCountering ? (
              <div style={styles.actions}>
                <button style={styles.acceptBtn} onClick={() => onAccept(offer.from)}>✓ Accept</button>
                <button style={styles.counterBtn} onClick={() => startCounter(offer.from)}>↔ Counter</button>
                <button style={styles.rejectBtn} onClick={() => onReject(offer.from)}>✕</button>
              </div>
            ) : (
              <div style={styles.counterBox}>
                <div style={styles.counterRow}>
                  <span style={styles.counterLabel}>Give</span>
                  <div style={styles.resRow}>
                    {RESOURCES.map(r => {
                      const owned = myPlayer?.resources[r] || 0;
                      const selected = give[r] || 0;
                      return (
                        <button
                          key={r}
                          style={{ ...styles.resBtn, ...(owned <= 0 ? { opacity: 0.35 } : {}) }}
                          disabled={owned <= 0}
                          onClick={() => {
                            if (selected >= owned) {
                              const next = { ...give };
                              delete next[r];
                              setGive(next);
                            } else {
                              setGive({ ...give, [r]: selected + 1 });
                            }
                          }}
                        >
                          {RESOURCE_ICONS[r]} {selected}/{owned}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div style={styles.counterRow}>
                  <span style={styles.counterLabel}>Want</span>
                  <div style={styles.resRow}>
                    {RESOURCES.map(r => {
                      const selected = want[r] || 0;
                      return (
                        <button
                          key={r}
                          style={styles.resBtn}
                          onClick={() => {
                            if (selected >= 3) {
                              const next = { ...want };
                              delete next[r];
                              setWant(next);
                            } else {
                              setWant({ ...want, [r]: selected + 1 });
                            }
                          }}
                        >
                          {RESOURCE_ICONS[r]} {selected}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div style={styles.counterActions}>
                  <button
                    style={styles.sendBtn}
                    disabled={Object.keys(give).length === 0 || Object.keys(want).length === 0}
                    onClick={() => sendCounter(offer.from)}
                  >
                    Send Counter
                  </button>
                  <button style={styles.cancelBtn} onClick={() => setCountering(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {myPlayer?.isAI && <div style={styles.aiNote}>AI is considering your offer…</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', gap: 8, background: '#0f3460', borderRadius: 8, padding: 10 },
  offer: { display: 'flex', flexDirection: 'column', gap: 8, background: '#1a1a2e', borderRadius: 8, padding: '8px 10px' },
  text: { fontSize: 13, color: '#e0e0e0', lineHeight: 1.4 },
  actions: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  acceptBtn: {
    padding: '6px 12px', border: 'none', borderRadius: 6,
    background: 'linear-gradient(135deg, #2ecc71, #27ae60)',
    color: 'white', fontSize: 12, fontWeight: 'bold', cursor: 'pointer',
  },
  counterBtn: {
    padding: '6px 12px', border: '1px solid #3498db', borderRadius: 6,
    background: 'transparent', color: '#3498db', fontSize: 12, fontWeight: 'bold', cursor: 'pointer',
  },
  rejectBtn: {
    padding: '6px 10px', border: '1px solid #e74c3c', borderRadius: 6,
    background: 'transparent', color: '#e74c3c', fontSize: 12, fontWeight: 'bold', cursor: 'pointer',
  },
  counterBox: { display: 'flex', flexDirection: 'column', gap: 6, background: '#16213e', borderRadius: 6, padding: 8 },
  counterRow: { display: 'flex', flexDirection: 'column', gap: 4 },
  counterLabel: { fontSize: 11, color: '#8890a0' },
  resRow: { display: 'flex', gap: 4, flexWrap: 'wrap' },
  resBtn: {
    padding: '5px 8px', border: '1px solid #1a1a2e', borderRadius: 5,
    background: '#1a1a2e', color: '#e0e0e0', cursor: 'pointer', fontSize: 12,
  },
  counterActions: { display: 'flex', gap: 6 },
  sendBtn: {
    flex: 1, padding: '8px 10px', border: 'none', borderRadius: 6,
    background: 'linear-gradient(135deg, #3498db, #2980b9)',
    color: 'white', fontSize: 12, fontWeight: 'bold', cursor: 'pointer',
  },
  cancelBtn: {
    padding: '8px 12px', border: '1px solid #8890a0', borderRadius: 6,
    background: 'transparent', color: '#8890a0', fontSize: 12, cursor: 'pointer',
  },
  aiNote: { fontSize: 11, color: '#8890a0', textAlign: 'center' },
};

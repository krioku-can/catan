import type { GameState, PlayerColor } from '../game/types';
import { getCurrentPlayer } from '../game/rules';

const RESOURCE_ICONS: Record<string, string> = {
  brick: '🧱', lumber: '🪵', wool: '🐑', grain: '🌾', ore: '⛏️',
};

interface TradeOffersProps {
  gameState: GameState;
  myColor: PlayerColor;
  onAccept: () => void;
  onReject: () => void;
}

/**
 * Shows pending domestic trade offers directed at the current player, with
 * Accept / Reject buttons. Only the target of an offer can act on it.
 */
export default function TradeOffers({ gameState, myColor, onAccept, onReject }: TradeOffersProps) {
  const offers = gameState.tradeOffers.filter(o => o.to === myColor);
  if (offers.length === 0) return null;

  const player = getCurrentPlayer(gameState);

  return (
    <div style={styles.container}>
      {offers.map((offer, i) => {
        const from = gameState.players.find(p => p.color === offer.from);
        const giveStr = Object.entries(offer.give || {})
          .map(([r, n]) => `${RESOURCE_ICONS[r] || ''}${n} ${r}`).join(', ');
        const wantStr = Object.entries(offer.want || {})
          .map(([r, n]) => `${RESOURCE_ICONS[r] || ''}${n} ${r}`).join(', ');
        return (
          <div key={i} style={styles.offer}>
            <div style={styles.text}>
              <strong style={{ color: from?.color }}>{from?.name}</strong> offers
              {' '}{giveStr || 'nothing'} for {wantStr || 'nothing'}
            </div>
            <div style={styles.actions}>
              <button style={styles.acceptBtn} onClick={onAccept}>✓ Accept</button>
              <button style={styles.rejectBtn} onClick={onReject}>✕</button>
            </div>
          </div>
        );
      })}
      {player.isAI && <div style={styles.aiNote}>AI is considering your offer…</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex', flexDirection: 'column', gap: 8,
    background: '#0f3460', borderRadius: 8, padding: 10,
  },
  offer: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: '#1a1a2e', borderRadius: 8, padding: '8px 10px',
  },
  text: { flex: 1, fontSize: 13, color: '#e0e0e0', lineHeight: 1.4 },
  actions: { display: 'flex', gap: 6, flexShrink: 0 },
  acceptBtn: {
    padding: '6px 12px', border: 'none', borderRadius: 6,
    background: 'linear-gradient(135deg, #2ecc71, #27ae60)',
    color: 'white', fontSize: 12, fontWeight: 'bold', cursor: 'pointer',
  },
  rejectBtn: {
    padding: '6px 10px', border: '1px solid #e74c3c', borderRadius: 6,
    background: 'transparent', color: '#e74c3c', fontSize: 12, fontWeight: 'bold', cursor: 'pointer',
  },
  aiNote: { fontSize: 11, color: '#8890a0', textAlign: 'center' },
};

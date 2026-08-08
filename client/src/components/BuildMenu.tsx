import type { Player, TurnPhase } from '../game/types';

interface BuildMenuProps {
  player: Player;
  phase: TurnPhase;
  isMyTurn: boolean;
  selectedAction: string | null;
  onSelectAction: (action: string | null) => void;
  onBuyDevCard: () => void;
  onPlayKnight: () => void;
  onEndTurn: () => void;
  hasKnight: boolean;
  pendingFreeRoads?: number;
}

const BUILD_OPTIONS = [
  { id: 'road', label: '🛣️', name: 'Road', cost: '🪵🧱' },
  { id: 'settlement', label: '🏘️', name: 'Settlement', cost: '🪵🧱🐑🌾' },
  { id: 'city', label: '🏙️', name: 'City', cost: '🌾🌾⛏️⛏️⛏️' },
  { id: 'devcard', label: '📜', name: 'Dev Card', cost: '🐑🌾⛏️' },
];

export default function BuildMenu({
  player,
  phase,
  isMyTurn,
  selectedAction,
  onSelectAction,
  onBuyDevCard,
  onPlayKnight,
  onEndTurn,
  hasKnight,
  pendingFreeRoads = 0,
}: BuildMenuProps) {
  // Show during active turn phases. Before roll: only knight shortcut + wait message.
  if (phase !== 'roll' && phase !== 'build' && phase !== 'trade') return null;

  const canBuild = phase === 'build' || phase === 'trade';
  const playableKnight = hasKnight && player.devCards.some(c => c.type === 'knight' && !c.played && !c.boughtThisTurn)
    && player.devCardsPlayedThisTurn < 1;

  return (
    <div style={styles.container}>
      {phase === 'roll' && isMyTurn && (
        <div style={styles.preRollNote}>
          Roll the dice to collect resources. You can play a development card first.
          {pendingFreeRoads > 0 && (
            <div style={styles.freeRoadNote}>
              🛣️ Place {pendingFreeRoads} free road{pendingFreeRoads > 1 ? 's' : ''} (tap edges)
            </div>
          )}
        </div>
      )}

      {pendingFreeRoads > 0 && phase !== 'roll' && (
        <div style={styles.freeRoadNote}>
          🛣️ Place {pendingFreeRoads} free road{pendingFreeRoads > 1 ? 's' : ''} from Road Building
        </div>
      )}

      {canBuild && (
        <div style={styles.grid}>
          {BUILD_OPTIONS.map(opt => {
            const isSelected = selectedAction === opt.id;
            const isDevCard = opt.id === 'devcard';
            return (
              <button
                key={opt.id}
                style={{
                  ...styles.buildBtn,
                  ...(isSelected ? styles.buildBtnSelected : {}),
                  ...(!isMyTurn ? styles.buildBtnDisabled : {}),
                }}
                onClick={() => {
                  if (!isMyTurn) return;
                  if (isDevCard) {
                    onBuyDevCard();
                  } else {
                    onSelectAction(isSelected ? null : opt.id);
                  }
                }}
                disabled={!isMyTurn}
              >
                <div style={styles.btnIcon}>{opt.label}</div>
                <div style={styles.btnName}>{opt.name}</div>
                <div style={styles.btnCost}>{opt.cost}</div>
              </button>
            );
          })}
        </div>
      )}

      <div style={styles.actions}>
        {playableKnight && isMyTurn && (
          <button style={styles.knightBtn} onClick={onPlayKnight}>
            ⚔️ Knight ({player.playedKnights})
          </button>
        )}
        {canBuild && (
          <button
            style={styles.endTurnBtn}
            onClick={onEndTurn}
            disabled={!isMyTurn}
          >
            End Turn
          </button>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  preRollNote: {
    fontSize: 12,
    color: '#ffd700',
    background: 'rgba(0,0,0,0.25)',
    borderRadius: 8,
    padding: '8px 10px',
    lineHeight: 1.4,
  },
  freeRoadNote: {
    fontSize: 12,
    color: '#e67e22',
    fontWeight: 'bold',
    marginTop: 4,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 6,
  },
  buildBtn: {
    padding: '10px 6px',
    border: '1px solid #1a1a2e',
    borderRadius: 8,
    background: '#1a1a2e',
    color: '#e0e0e0',
    cursor: 'pointer',
    textAlign: 'center',
    transition: 'all 0.15s',
  },
  buildBtnSelected: {
    borderColor: '#ffd700',
    background: '#16213e',
    boxShadow: '0 0 8px rgba(255,215,0,0.3)',
  },
  buildBtnDisabled: {
    opacity: 0.3,
    cursor: 'not-allowed',
  },
  btnIcon: {
    fontSize: 22,
    marginBottom: 2,
  },
  btnName: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  btnCost: {
    fontSize: 10,
    color: '#8890a0',
    marginTop: 2,
  },
  actions: {
    display: 'flex',
    gap: 6,
  },
  knightBtn: {
    flex: 1,
    padding: '10px 12px',
    border: '1px solid #e67e22',
    borderRadius: 8,
    background: '#1a1a2e',
    color: '#e67e22',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 'bold',
  },
  endTurnBtn: {
    flex: 2,
    padding: '10px 16px',
    border: 'none',
    borderRadius: 8,
    background: 'linear-gradient(135deg, #2ecc71, #27ae60)',
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
    cursor: 'pointer',
  },
};

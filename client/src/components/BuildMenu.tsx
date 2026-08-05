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
}

const BUILD_OPTIONS = [
  { id: 'road', label: '🛣️ Road', cost: '1🪵 1🧱' },
  { id: 'settlement', label: '🏘️ Settlement', cost: '1🪵 1🧱 1🐑 1🌾' },
  { id: 'city', label: '🏙️ City', cost: '2🌾 3⛏️' },
  { id: 'devcard', label: '📜 Dev Card', cost: '1🐑 1🌾 1⛏️' },
];

export default function BuildMenu({ player, phase, isMyTurn, selectedAction, onSelectAction, onBuyDevCard, onPlayKnight, onEndTurn, hasKnight }: BuildMenuProps) {
  if (phase !== 'build' && phase !== 'trade') return null;

  return (
    <div style={styles.container}>
      <div style={styles.header}>Build</div>
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
              <div style={styles.btnLabel}>{opt.label}</div>
              <div style={styles.btnCost}>{opt.cost}</div>
            </button>
          );
        })}
      </div>
      {hasKnight && isMyTurn && (
        <button style={styles.knightBtn} onClick={onPlayKnight}>
          ⚔️ Play Knight ({player.playedKnights} played)
        </button>
      )}
      <button
        style={styles.endTurnBtn}
        onClick={onEndTurn}
        disabled={!isMyTurn}
      >
        End Turn
      </button>
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
    fontSize: 13,
    color: '#8890a0',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 6,
  },
  buildBtn: {
    padding: '8px 6px',
    border: '1px solid #1a1a2e',
    borderRadius: 6,
    background: '#1a1a2e',
    color: '#e0e0e0',
    cursor: 'pointer',
    textAlign: 'center',
    transition: 'all 0.15s',
  },
  buildBtnSelected: {
    borderColor: '#ffd700',
    background: '#16213e',
  },
  buildBtnDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  btnLabel: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  btnCost: {
    fontSize: 11,
    color: '#8890a0',
    marginTop: 2,
  },
  knightBtn: {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid #e67e22',
    borderRadius: 6,
    background: '#1a1a2e',
    color: '#e67e22',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 'bold',
    marginTop: 6,
  },
  endTurnBtn: {
    width: '100%',
    padding: '10px 16px',
    border: 'none',
    borderRadius: 6,
    background: 'linear-gradient(135deg, #2ecc71, #27ae60)',
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
    cursor: 'pointer',
    marginTop: 8,
  },
};

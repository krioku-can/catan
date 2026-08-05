interface DiceRollerProps {
  onRoll: () => void;
  rolling: boolean;
  disabled: boolean;
  result: [number, number] | null;
}

export default function DiceRoller({ onRoll, rolling, disabled, result }: DiceRollerProps) {
  return (
    <div style={styles.container}>
      <div style={styles.diceArea}>
        {result ? (
          <div style={styles.result}>
            <span style={styles.die}>⚀⚁⚂⚃⚄⚅[{(result[0] + result[1])}]</span>
            <span style={styles.total}> = {result[0] + result[1]}</span>
          </div>
        ) : (
          <div style={styles.placeholder}>
            {rolling ? '🎲 Rolling...' : '🎲 Ready to roll'}
          </div>
        )}
      </div>
      <button
        style={{ ...styles.rollBtn, ...(disabled ? styles.rollBtnDisabled : {}) }}
        onClick={onRoll}
        disabled={disabled || rolling}
      >
        {rolling ? '🎲 ...' : '🎲 Roll Dice'}
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#0f3460',
    borderRadius: 8,
    padding: 12,
    textAlign: 'center',
  },
  diceArea: {
    marginBottom: 8,
  },
  result: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  die: {
    fontSize: 28,
  },
  total: {
    fontSize: 18,
    color: '#ffd700',
  },
  placeholder: {
    fontSize: 16,
    color: '#8890a0',
  },
  rollBtn: {
    width: '100%',
    padding: '10px 16px',
    border: 'none',
    borderRadius: 6,
    background: 'linear-gradient(135deg, #e94560, #c23152)',
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  rollBtnDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
};

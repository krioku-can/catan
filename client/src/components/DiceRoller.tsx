interface DiceRollerProps {
  onRoll: () => void;
  rolling: boolean;
  disabled: boolean;
  result: [number, number] | null;
}

export default function DiceRoller({ onRoll, rolling, disabled, result }: DiceRollerProps) {
  return (
    <div style={styles.container}>
      <button
        style={{ ...styles.rollBtn, ...(disabled ? styles.rollBtnDisabled : {}) }}
        onClick={onRoll}
        disabled={disabled || rolling}
      >
        {result ? (
          <span style={styles.result}>
            🎲 {result[0]} + {result[1]} = <strong>{result[0] + result[1]}</strong>
          </span>
        ) : (
          <span>{rolling ? '🎲 Rolling...' : '🎲 Roll Dice'}</span>
        )}
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {},
  rollBtn: {
    width: '100%',
    padding: '12px 16px',
    border: 'none',
    borderRadius: 8,
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
  result: {
    fontSize: 16,
  },
};

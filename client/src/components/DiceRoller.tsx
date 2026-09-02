interface DiceRollerProps {
  onRoll: () => void;
  rolling: boolean;
  disabled: boolean;
  result: [number, number] | null;
}

export default function DiceRoller({ onRoll, rolling, disabled, result }: DiceRollerProps) {
  const live = !disabled && !rolling;
  return (
    <div style={styles.container}>
      <button
        type="button"
        className={live ? 'dice-roll-live' : undefined}
        style={{ ...styles.rollBtn, ...(disabled ? styles.rollBtnDisabled : {}) }}
        onClick={onRoll}
        disabled={disabled || rolling}
      >
        {result && disabled ? (
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
    padding: '14px 16px',
    border: 'none',
    borderRadius: 10,
    background: 'linear-gradient(135deg, #e94560, #c23152)',
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    cursor: 'pointer',
    minHeight: 48,
  },
  rollBtnDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  result: {
    fontSize: 16,
  },
};

import { useEffect } from 'react';

interface DiceFlashProps {
  /** Total rolled value, or null when not showing */
  total: number | null;
  /** Dice faces [d1, d2] */
  faces: [number, number] | null;
  onDone: () => void;
}

/**
 * Full-board flash showing the rolled number in huge text. Auto-dismisses
 * after ~1.6s so the player always sees what was rolled even if they were
 * looking at the board, not the buttons.
 */
export default function DiceFlash({ total, faces, onDone }: DiceFlashProps) {
  useEffect(() => {
    if (total === null) return;
    const t = setTimeout(onDone, 1600);
    return () => clearTimeout(t);
  }, [total, onDone]);

  if (total === null) return null;

  const is7 = total === 7;

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <div style={styles.dice}>
          {faces && faces.map((f, i) => (
            <div key={i} style={styles.face}>{f}</div>
          ))}
        </div>
        <div style={styles.total}>{total}</div>
        {is7 && <div style={styles.sub}>⚔️ 7 rolled — Robber time!</div>}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    zIndex: 50,
  },
  card: {
    textAlign: 'center',
    background: 'rgba(0,0,0,0.78)',
    borderRadius: 20,
    padding: '28px 44px',
    animation: 'dicePop 0.35s ease-out',
  },
  dice: {
    display: 'flex',
    gap: 16,
    justifyContent: 'center',
    marginBottom: 8,
  },
  face: {
    width: 56, height: 56,
    borderRadius: 12,
    background: 'white',
    color: '#1a1a2e',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 30,
    fontWeight: 'bold',
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
  },
  total: {
    fontSize: 72,
    fontWeight: 'bold',
    color: '#ffd700',
    lineHeight: 1,
    textShadow: '0 0 24px rgba(255,215,0,0.5)',
  },
  sub: {
    marginTop: 10,
    fontSize: 16,
    color: '#e74c3c',
    fontWeight: 'bold',
  },
};

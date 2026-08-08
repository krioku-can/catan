import { useState } from 'react';
import type { ResourceType, Player } from '../game/types';

const RESOURCES: { type: ResourceType; label: string; emoji: string }[] = [
  { type: 'brick', label: 'Brick', emoji: '🧱' },
  { type: 'lumber', label: 'Lumber', emoji: '🪵' },
  { type: 'wool', label: 'Wool', emoji: '🐑' },
  { type: 'grain', label: 'Grain', emoji: '🌾' },
  { type: 'ore', label: 'Ore', emoji: '⛏️' },
];

interface DiscardModalProps {
  player: Player;
  mustDiscard: number;
  onDiscard: (discard: Partial<Record<ResourceType, number>>) => void;
}

/**
 * Modal shown after a 7 is rolled when the player has >7 cards and must
 * discard half (rounded down) of their hand.
 */
export default function DiscardModal({ player, mustDiscard, onDiscard }: DiscardModalProps) {
  const [selection, setSelection] = useState<Partial<Record<ResourceType, number>>>({});
  const selected = RESOURCES.reduce((s, r) => s + (selection[r.type] || 0), 0);

  const toggle = (type: ResourceType, delta: number) => {
    setSelection(prev => {
      const cur = prev[type] || 0;
      const next = Math.max(0, Math.min(player.resources[type] || 0, cur + delta));
      return { ...prev, [type]: next };
    });
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <h2 style={styles.title}>🎲 7 Rolled!</h2>
        <p style={styles.sub}>
          You have too many cards. Discard exactly <strong>{mustDiscard}</strong>.
        </p>
        <div style={styles.resList}>
          {RESOURCES.map(r => {
            const n = player.resources[r.type] || 0;
            if (n <= 0) return null;
            const sel = selection[r.type] || 0;
            return (
              <div key={r.type} style={styles.resRow}>
                <span style={styles.resLabel}>{r.emoji} {r.label}</span>
                <div style={styles.stepper}>
                  <button style={styles.stepBtn} onClick={() => toggle(r.type, -1)} disabled={sel <= 0}>−</button>
                  <span style={styles.stepVal}>{sel}</span>
                  <button style={styles.stepBtn} onClick={() => toggle(r.type, 1)} disabled={sel >= n}>+</button>
                </div>
                <span style={styles.resOwned}>/{n}</span>
              </div>
            );
          })}
        </div>
        <div style={styles.footer}>
          <span style={styles.counter}>{selected} / {mustDiscard}</span>
          <button
            style={{ ...styles.discardBtn, ...(selected === mustDiscard ? {} : styles.discardBtnDisabled) }}
            disabled={selected !== mustDiscard}
            onClick={() => onDiscard(selection)}
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 200,
    background: 'rgba(0,0,0,0.75)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 20,
  },
  modal: {
    background: '#16213e', borderRadius: 12, padding: 20,
    maxWidth: 360, width: '100%', border: '1px solid #0f3460',
  },
  title: { fontSize: 20, color: '#ffd700', margin: '0 0 4px' },
  sub: { fontSize: 14, color: '#b0b8c8', margin: '0 0 16px' },
  resList: { display: 'flex', flexDirection: 'column', gap: 8 },
  resRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: '#1a1a2e', borderRadius: 8, padding: '8px 10px',
  },
  resLabel: { flex: 1, fontSize: 14, color: '#e0e0e0' },
  stepper: { display: 'flex', alignItems: 'center', gap: 6 },
  stepBtn: {
    width: 28, height: 28, borderRadius: 6, border: '1px solid #0f3460',
    background: '#0f3460', color: '#e0e0e0', fontSize: 16, fontWeight: 'bold',
    cursor: 'pointer', lineHeight: 1,
  },
  stepVal: { minWidth: 20, textAlign: 'center', fontSize: 15, fontWeight: 'bold', color: '#ffd700' },
  resOwned: { fontSize: 12, color: '#8890a0', minWidth: 24, textAlign: 'right' },
  footer: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  counter: { fontSize: 14, color: '#b0b8c8', fontWeight: 'bold' },
  discardBtn: {
    padding: '10px 20px', border: 'none', borderRadius: 8,
    background: 'linear-gradient(135deg, #e94560, #c23152)',
    color: 'white', fontSize: 14, fontWeight: 'bold', cursor: 'pointer',
  },
  discardBtnDisabled: { opacity: 0.4, cursor: 'not-allowed' },
};

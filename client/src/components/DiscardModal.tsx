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
  othersDiscarding?: string[];
}

/** Dump extras from the types you hold most of — keeps scarce resources. */
export function suggestDiscard(
  player: Player,
  mustDiscard: number,
): Partial<Record<ResourceType, number>> {
  const counts = RESOURCES.map(r => ({ type: r.type, n: player.resources[r.type] || 0 }))
    .filter(r => r.n > 0)
    .sort((a, b) => b.n - a.n);
  const out: Partial<Record<ResourceType, number>> = {};
  let left = mustDiscard;
  for (const row of counts) {
    if (left <= 0) break;
    // Keep 1 of a type if you have 2+ and still have other cards to dump.
    const keep = row.n >= 2 && counts.length > 1 ? 1 : 0;
    const take = Math.min(left, Math.max(0, row.n - keep));
    if (take > 0) {
      out[row.type] = take;
      left -= take;
    }
  }
  if (left > 0) {
    for (const row of counts) {
      if (left <= 0) break;
      const already = out[row.type] || 0;
      const extra = Math.min(left, row.n - already);
      if (extra > 0) {
        out[row.type] = already + extra;
        left -= extra;
      }
    }
  }
  return out;
}

/**
 * Modal shown after a 7 is rolled when the player has >7 cards and must
 * discard half (rounded down) of their hand.
 */
export default function DiscardModal({ player, mustDiscard, onDiscard, othersDiscarding }: DiscardModalProps) {
  const [selection, setSelection] = useState<Partial<Record<ResourceType, number>>>(() =>
    suggestDiscard(player, mustDiscard),
  );
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
        <h2 style={styles.title}>🎲 7 — discard {mustDiscard}</h2>
        <p style={styles.sub}>
          You have more than 7 cards. Discard exactly <strong>{mustDiscard}</strong>.
        </p>
        {othersDiscarding && othersDiscarding.length > 0 && (
          <p style={styles.others}>
            Also discarding: {othersDiscarding.join(', ')}
          </p>
        )}
        <div style={styles.resList}>
          {RESOURCES.map(r => {
            const n = player.resources[r.type] || 0;
            if (n <= 0) return null;
            const sel = selection[r.type] || 0;
            return (
              <div key={r.type} style={styles.resRow}>
                <span style={styles.resLabel}>{r.emoji} {r.label}</span>
                <div style={styles.stepper}>
                  <button
                    type="button"
                    style={styles.stepBtn}
                    onClick={() => toggle(r.type, -1)}
                    disabled={sel <= 0}
                    aria-label={`Remove ${r.label}`}
                  >−</button>
                  <span style={styles.stepVal}>{sel}</span>
                  <button
                    type="button"
                    style={styles.stepBtn}
                    onClick={() => toggle(r.type, 1)}
                    disabled={sel >= n}
                    aria-label={`Add ${r.label}`}
                  >+</button>
                </div>
                <span style={styles.resOwned}>of {n}</span>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          style={styles.suggestBtn}
          onClick={() => setSelection(suggestDiscard(player, mustDiscard))}
        >
          Use suggested dump (keep scarce types)
        </button>
        <div style={styles.footer}>
          <span style={styles.counter}>{selected} / {mustDiscard}</span>
          <button
            type="button"
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
    padding: 16,
  },
  modal: {
    background: '#16213e', borderRadius: 14, padding: 18,
    maxWidth: 380, width: '100%', border: '1px solid #0f3460',
  },
  title: { fontSize: 20, color: '#ffd700', margin: '0 0 4px' },
  sub: { fontSize: 14, color: '#b0b8c8', margin: '0 0 8px' },
  others: { fontSize: 13, color: '#ffcc80', margin: '0 0 12px' },
  resList: { display: 'flex', flexDirection: 'column', gap: 8 },
  resRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: '#1a1a2e', borderRadius: 10, padding: '8px 10px',
  },
  resLabel: { flex: 1, fontSize: 15, color: '#e0e0e0', fontWeight: 600 },
  stepper: { display: 'flex', alignItems: 'center', gap: 8 },
  stepBtn: {
    width: 44, height: 44, borderRadius: 10, border: '1px solid #0f3460',
    background: '#0f3460', color: '#e0e0e0', fontSize: 22, fontWeight: 'bold',
    cursor: 'pointer', lineHeight: 1,
  },
  stepVal: { minWidth: 28, textAlign: 'center', fontSize: 20, fontWeight: 'bold', color: '#ffd700' },
  resOwned: { fontSize: 13, color: '#8890a0', minWidth: 36, textAlign: 'right' },
  suggestBtn: {
    marginTop: 12, width: '100%', padding: '10px 12px',
    border: '1px solid rgba(255,215,0,0.35)', borderRadius: 8,
    background: 'transparent', color: '#ffd700', fontSize: 13, fontWeight: 600,
    cursor: 'pointer',
  },
  footer: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  counter: { fontSize: 15, color: '#b0b8c8', fontWeight: 'bold' },
  discardBtn: {
    padding: '12px 22px', border: 'none', borderRadius: 10,
    background: 'linear-gradient(135deg, #e94560, #c23152)',
    color: 'white', fontSize: 16, fontWeight: 'bold', cursor: 'pointer',
  },
  discardBtnDisabled: { opacity: 0.4, cursor: 'not-allowed' },
};

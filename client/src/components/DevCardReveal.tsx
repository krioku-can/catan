import { useEffect, type CSSProperties } from 'react';

export type DevCardKind = 'knight' | 'road_building' | 'year_of_plenty' | 'monopoly' | 'victory_point';

export const DEV_CARD_INFO: Record<DevCardKind, { name: string; emoji: string; blurb: string; accent: string }> = {
  knight: {
    name: 'Knight',
    emoji: '⚔️',
    blurb: 'Move the robber and steal 1 resource from a player on that hex.',
    accent: '#c62828',
  },
  road_building: {
    name: 'Road Building',
    emoji: '🛣️',
    blurb: 'Place 2 roads for free, immediately.',
    accent: '#f9a825',
  },
  year_of_plenty: {
    name: 'Year of Plenty',
    emoji: '🎁',
    blurb: 'Take any 2 resource cards from the bank.',
    accent: '#7cb342',
  },
  monopoly: {
    name: 'Monopoly',
    emoji: '👑',
    blurb: 'Name a resource — every other player gives you all of theirs.',
    accent: '#7b1fa2',
  },
  victory_point: {
    name: 'Victory Point',
    emoji: '🏆',
    blurb: 'Secret +1 VP. Keep this hidden until the game ends.',
    accent: '#ffd54f',
  },
};

interface DevCardRevealProps {
  type?: string | null;
  buyerName?: string;
  onDone: () => void;
}

export default function DevCardReveal({ type, buyerName, onDone }: DevCardRevealProps) {
  const info = type && type in DEV_CARD_INFO ? DEV_CARD_INFO[type as DevCardKind] : null;
  const ms = info ? 3400 : 2000;

  useEffect(() => {
    const t = window.setTimeout(onDone, ms);
    return () => window.clearTimeout(t);
  }, [onDone, ms]);

  if (!info) {
    return (
      <div style={styles.toastWrap} onClick={onDone} role="status">
        <div style={styles.toast}>
          <span style={styles.toastEmoji}>📜</span>
          <span>{buyerName || 'Someone'} bought a development card</span>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.scrim} onClick={onDone} role="dialog" aria-label={`You drew ${info.name}`}>
      <div style={{ ...styles.card, borderColor: info.accent }}>
        <div style={styles.kicker}>You drew</div>
        <div style={styles.emoji}>{info.emoji}</div>
        <div style={{ ...styles.name, color: info.accent }}>{info.name}</div>
        <p style={styles.blurb}>{info.blurb}</p>
        {type === 'victory_point' && (
          <p style={styles.secret}>Keep this secret from the table</p>
        )}
        {type !== 'victory_point' && (
          <p style={styles.hint}>Play it on a later turn — not the turn you buy it</p>
        )}
        <div style={styles.tap}>Tap to dismiss</div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  scrim: {
    position: 'absolute',
    inset: 0,
    zIndex: 90,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(8,4,2,0.62)',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 300,
    background: 'linear-gradient(180deg, #3a2412 0%, #1e1208 100%)',
    border: '2px solid #ffd54f',
    borderRadius: 16,
    padding: '22px 20px 16px',
    textAlign: 'center',
    boxShadow: '0 18px 40px rgba(0,0,0,0.45)',
  },
  kicker: {
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: '#c4b49a',
    fontWeight: 800,
  },
  emoji: { fontSize: 56, lineHeight: 1.1, margin: '10px 0 4px' },
  name: { fontSize: 24, fontWeight: 800, marginBottom: 8 },
  blurb: { fontSize: 14, color: '#f5efe4', lineHeight: 1.4, margin: '0 0 8px' },
  secret: { fontSize: 13, color: '#ffd54f', fontWeight: 700, margin: '0 0 8px' },
  hint: { fontSize: 12, color: '#8a7355', margin: '0 0 8px', lineHeight: 1.35 },
  tap: { fontSize: 11, color: '#8a7355', marginTop: 4 },
  toastWrap: {
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    zIndex: 80,
    display: 'flex',
    justifyContent: 'center',
    pointerEvents: 'none',
    padding: '0 16px',
  },
  toast: {
    pointerEvents: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'rgba(20,12,6,0.94)',
    border: '1px solid rgba(255,213,79,0.4)',
    color: '#f5efe4',
    fontWeight: 700,
    fontSize: 14,
    padding: '10px 14px',
    borderRadius: 12,
    maxWidth: 340,
  },
  toastEmoji: { fontSize: 18 },
};

import { useState } from 'react';
import type { Player, ResourceType } from '../game/types';

const RESOURCES: { type: ResourceType; label: string; emoji: string }[] = [
  { type: 'brick', label: 'Brick', emoji: '🧱' },
  { type: 'lumber', label: 'Lumber', emoji: '🪵' },
  { type: 'wool', label: 'Wool', emoji: '🐑' },
  { type: 'grain', label: 'Grain', emoji: '🌾' },
  { type: 'ore', label: 'Ore', emoji: '⛏️' },
];

interface DevCardPanelProps {
  player: Player;
  onPlayRoadBuilding: () => void;
  onPlayYearOfPlenty: (r1: ResourceType, r2: ResourceType) => void;
  onPlayMonopoly: (r: ResourceType) => void;
}

const CARD_LABELS: Record<string, string> = {
  knight: 'Knight',
  road_building: 'Road Building',
  year_of_plenty: 'Year of Plenty',
  monopoly: 'Monopoly',
  victory_point: 'Victory Point',
};

/**
 * Panel for playing development cards. Always visible when the player holds
 * any unplayed dev cards (including Knights), with a count badge on the toggle.
 */
export default function DevCardPanel({ player, onPlayRoadBuilding, onPlayYearOfPlenty, onPlayMonopoly }: DevCardPanelProps) {
  const [show, setShow] = useState(false);
  const [yopPick, setYopPick] = useState<ResourceType | null>(null);
  const [monoPick, setMonoPick] = useState<ResourceType | null>(null);

  const unplayed = player.devCards.filter(c => !c.played);
  const hasRoadBuilding = unplayed.some(c => c.type === 'road_building');
  const hasYearOfPlenty = unplayed.some(c => c.type === 'year_of_plenty');
  const hasMonopoly = unplayed.some(c => c.type === 'monopoly');
  const hasKnight = unplayed.some(c => c.type === 'knight');

  if (unplayed.length === 0) return null;

  // Count each card type for the summary row.
  const counts: Record<string, number> = {};
  unplayed.forEach(c => { counts[c.type] = (counts[c.type] || 0) + 1; });

  return (
    <div style={styles.container}>
      <button style={styles.toggle} onClick={() => setShow(!show)}>
        {show ? '▼' : '▶'} Dev Cards
        <span style={styles.badge}>{unplayed.length}</span>
      </button>
      {show && (
        <div style={styles.panel}>
          {/* Summary of all held cards */}
          <div style={styles.summary}>
            {Object.entries(counts).map(([type, n]) => (
              <span key={type} style={styles.summaryChip}>
                📜 {CARD_LABELS[type] || type} ×{n}
              </span>
            ))}
          </div>

          {hasKnight && (
            <div style={styles.knightNote}>
              ⚔️ Play Knights from the Build menu (⚔️ button) to build the largest army.
            </div>
          )}

          {hasRoadBuilding && (
            <button style={styles.actionBtn} onClick={onPlayRoadBuilding}>
              🛣️ Road Building (2 free roads)
            </button>
          )}

          {hasYearOfPlenty && (
            <div style={styles.block}>
              <div style={styles.label}>Year of Plenty — pick 2 resources:</div>
              <div style={styles.resRow}>
                {RESOURCES.map(r => (
                  <button
                    key={r.type}
                    style={{ ...styles.resBtn, ...(yopPick === r.type ? styles.resBtnActive : {}) }}
                    onClick={() => setYopPick(yopPick === r.type ? null : r.type)}
                  >
                    {r.emoji}
                  </button>
                ))}
              </div>
              <button
                style={{ ...styles.playBtn, ...(yopPick ? {} : styles.playBtnDisabled) }}
                disabled={!yopPick}
                onClick={() => { if (yopPick) { onPlayYearOfPlenty(yopPick, yopPick); setYopPick(null); } }}
              >
                Play (2× {yopPick ? RESOURCES.find(r => r.type === yopPick)?.emoji : '?'})
              </button>
            </div>
          )}

          {hasMonopoly && (
            <div style={styles.block}>
              <div style={styles.label}>Monopoly — take all of one resource:</div>
              <div style={styles.resRow}>
                {RESOURCES.map(r => (
                  <button
                    key={r.type}
                    style={{ ...styles.resBtn, ...(monoPick === r.type ? styles.resBtnActive : {}) }}
                    onClick={() => setMonoPick(monoPick === r.type ? null : r.type)}
                  >
                    {r.emoji}
                  </button>
                ))}
              </div>
              <button
                style={{ ...styles.playBtn, ...(monoPick ? {} : styles.playBtnDisabled) }}
                disabled={!monoPick}
                onClick={() => { if (monoPick) { onPlayMonopoly(monoPick); setMonoPick(null); } }}
              >
                Play Monopoly
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { background: '#0f3460', borderRadius: 8, overflow: 'hidden' },
  toggle: {
    width: '100%', padding: '10px 12px', border: 'none', background: 'transparent',
    color: '#e0e0e0', fontSize: 14, fontWeight: 'bold', cursor: 'pointer', textAlign: 'left',
    display: 'flex', alignItems: 'center', gap: 8,
  },
  badge: {
    background: '#e67e22', color: 'white', borderRadius: 10,
    padding: '1px 8px', fontSize: 12, fontWeight: 'bold',
  },
  summary: { display: 'flex', flexWrap: 'wrap', gap: 4 },
  summaryChip: {
    background: '#1a1a2e', border: '1px solid #3498db', borderRadius: 6,
    padding: '4px 8px', fontSize: 11, color: '#e0e0e0',
  },
  knightNote: {
    fontSize: 11, color: '#8890a0', background: '#1a1a2e',
    borderRadius: 6, padding: '6px 8px',
  },
  panel: { padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 },
  actionBtn: {
    padding: '10px 12px', border: '1px solid #e67e22', borderRadius: 8,
    background: '#1a1a2e', color: '#e67e22', fontSize: 13, fontWeight: 'bold', cursor: 'pointer',
  },
  block: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 11, color: '#8890a0' },
  resRow: { display: 'flex', gap: 4, flexWrap: 'wrap' },
  resBtn: {
    padding: '6px 10px', border: '1px solid #1a1a2e', borderRadius: 6,
    background: '#1a1a2e', color: '#e0e0e0', cursor: 'pointer', fontSize: 15,
  },
  resBtnActive: { borderColor: '#ffd700', background: '#16213e' },
  playBtn: {
    padding: '8px 12px', border: 'none', borderRadius: 6,
    background: 'linear-gradient(135deg, #3498db, #2980b9)',
    color: 'white', fontSize: 13, fontWeight: 'bold', cursor: 'pointer',
  },
  playBtnDisabled: { opacity: 0.4, cursor: 'not-allowed' },
};

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

/**
 * Panel for playing non-knight development cards (Road Building, Year of
 * Plenty, Monopoly). Only shows cards the player actually holds.
 */
export default function DevCardPanel({ player, onPlayRoadBuilding, onPlayYearOfPlenty, onPlayMonopoly }: DevCardPanelProps) {
  const [show, setShow] = useState(false);
  const [yopPick, setYopPick] = useState<ResourceType | null>(null);
  const [monoPick, setMonoPick] = useState<ResourceType | null>(null);

  const hasRoadBuilding = player.devCards.some(c => c.type === 'road_building' && !c.played);
  const hasYearOfPlenty = player.devCards.some(c => c.type === 'year_of_plenty' && !c.played);
  const hasMonopoly = player.devCards.some(c => c.type === 'monopoly' && !c.played);

  if (!hasRoadBuilding && !hasYearOfPlenty && !hasMonopoly) return null;

  return (
    <div style={styles.container}>
      <button style={styles.toggle} onClick={() => setShow(!show)}>
        {show ? '▼' : '▶'} Dev Cards
      </button>
      {show && (
        <div style={styles.panel}>
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

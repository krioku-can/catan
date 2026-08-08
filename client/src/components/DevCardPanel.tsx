import { useState } from 'react';
import type { Player, ResourceType, TurnPhase } from '../game/types';
import { getHeldDevCards, countHeldDevCards } from '../game/rules';

const RESOURCES: { type: ResourceType; label: string; emoji: string }[] = [
  { type: 'brick', label: 'Brick', emoji: '🧱' },
  { type: 'lumber', label: 'Lumber', emoji: '🪵' },
  { type: 'wool', label: 'Wool', emoji: '🐑' },
  { type: 'grain', label: 'Grain', emoji: '🌾' },
  { type: 'ore', label: 'Ore', emoji: '⛏️' },
];

interface DevCardPanelProps {
  player: Player;
  phase: TurnPhase;
  isMyTurn: boolean;
  onPlayKnight: () => void;
  onPlayRoadBuilding: () => void;
  onPlayYearOfPlenty: (r1: ResourceType, r2: ResourceType) => void;
  onPlayMonopoly: (r: ResourceType) => void;
}

const CARD_LABELS: Record<string, { name: string; emoji: string }> = {
  knight: { name: 'Knight', emoji: '⚔️' },
  road_building: { name: 'Road Building', emoji: '🛣️' },
  year_of_plenty: { name: 'Year of Plenty', emoji: '🎁' },
  monopoly: { name: 'Monopoly', emoji: '👑' },
  victory_point: { name: 'Victory Point', emoji: '🏆' },
};

/**
 * Lists every held development card individually and exposes play actions.
 */
export default function DevCardPanel({
  player,
  phase,
  isMyTurn,
  onPlayKnight,
  onPlayRoadBuilding,
  onPlayYearOfPlenty,
  onPlayMonopoly,
}: DevCardPanelProps) {
  const [show, setShow] = useState(true);
  const [yopPicks, setYopPicks] = useState<ResourceType[]>([]);
  const [monoPick, setMonoPick] = useState<ResourceType | null>(null);

  const held = getHeldDevCards(player);
  const heldCount = countHeldDevCards(player);

  // Always show the panel once you've ever held cards, or currently hold any.
  // If empty, still hide to save space.
  if (heldCount === 0 && player.playedKnights === 0) return null;

  const canActPhase = phase === 'roll' || phase === 'trade' || phase === 'build';
  const alreadyPlayed = player.devCardsPlayedThisTurn >= 1;
  const canPlay = isMyTurn && canActPhase && !alreadyPlayed;

  const playable = (type: string) =>
    player.devCards.some(c => c.type === type && !c.played && !c.boughtThisTurn && c.type !== 'victory_point');

  const toggleYop = (r: ResourceType) => {
    setYopPicks(prev => {
      if (prev.length >= 2) return [r];
      return [...prev, r];
    });
  };

  return (
    <div style={styles.container}>
      <button style={styles.toggle} onClick={() => setShow(!show)}>
        {show ? '▼' : '▶'} Development Cards
        <span style={styles.badge}>{heldCount}</span>
        {canPlay && held.some(c => !c.boughtThisTurn && c.type !== 'victory_point') && !alreadyPlayed && (
          <span style={styles.playHint}>playable now</span>
        )}
      </button>

      {show && (
        <div style={styles.panel}>
          {!isMyTurn && (
            <div style={styles.note}>Your cards — play them on your turn (before or after rolling).</div>
          )}
          {isMyTurn && phase === 'roll' && (
            <div style={styles.note}>You can play one card before rolling.</div>
          )}
          {alreadyPlayed && isMyTurn && (
            <div style={styles.note}>Already played a development card this turn.</div>
          )}

          {/* Every held card listed individually */}
          <div style={styles.cardList}>
            {held.length === 0 && (
              <span style={styles.empty}>No development cards in hand</span>
            )}
            {held.map((c, i) => {
              const meta = CARD_LABELS[c.type] || { name: c.type, emoji: '📜' };
              const isNew = !!c.boughtThisTurn;
              return (
                <div key={c.id || `card-${i}`} style={styles.cardItem}>
                  <span style={styles.cardEmoji}>{meta.emoji}</span>
                  <span style={styles.cardName}>{meta.name}</span>
                  {isNew && <span style={styles.newTag}>bought this turn</span>}
                  {c.type === 'victory_point' && <span style={styles.vpTag}>secret +1 VP</span>}
                </div>
              );
            })}
          </div>

          {player.playedKnights > 0 && (
            <div style={styles.armyNote}>
              ⚔️ {player.playedKnights} knight{player.playedKnights === 1 ? '' : 's'} already played (largest army)
            </div>
          )}

          {/* Actions */}
          {playable('knight') && (
            <button
              style={{ ...styles.actionBtn, ...(!canPlay ? styles.disabled : {}) }}
              disabled={!canPlay}
              onClick={onPlayKnight}
            >
              ⚔️ Play Knight — move the robber
            </button>
          )}

          {playable('road_building') && (
            <button
              style={{ ...styles.actionBtn, ...(!canPlay ? styles.disabled : {}) }}
              disabled={!canPlay}
              onClick={onPlayRoadBuilding}
            >
              🛣️ Play Road Building — 2 free roads
            </button>
          )}

          {playable('year_of_plenty') && (
            <div style={styles.block}>
              <div style={styles.label}>
                Year of Plenty — pick 2 resources
                {yopPicks.length > 0 && (
                  <span style={styles.picks}>
                    {' '}({yopPicks.map(r => RESOURCES.find(x => x.type === r)?.emoji).join('')})
                  </span>
                )}
              </div>
              <div style={styles.resRow}>
                {RESOURCES.map(r => (
                  <button
                    key={r.type}
                    style={{
                      ...styles.resBtn,
                      ...(yopPicks.includes(r.type) ? styles.resBtnActive : {}),
                      ...(!canPlay ? styles.disabled : {}),
                    }}
                    disabled={!canPlay}
                    onClick={() => toggleYop(r.type)}
                  >
                    {r.emoji}
                  </button>
                ))}
              </div>
              <div style={styles.rowBtns}>
                <button
                  style={{ ...styles.playBtn, ...(yopPicks.length === 2 && canPlay ? {} : styles.disabled) }}
                  disabled={yopPicks.length !== 2 || !canPlay}
                  onClick={() => {
                    if (yopPicks.length === 2) {
                      onPlayYearOfPlenty(yopPicks[0], yopPicks[1]);
                      setYopPicks([]);
                    }
                  }}
                >
                  Play Year of Plenty
                </button>
                {yopPicks.length > 0 && (
                  <button style={styles.clearBtn} onClick={() => setYopPicks([])}>Clear</button>
                )}
              </div>
            </div>
          )}

          {playable('monopoly') && (
            <div style={styles.block}>
              <div style={styles.label}>Monopoly — take all of one resource from everyone</div>
              <div style={styles.resRow}>
                {RESOURCES.map(r => (
                  <button
                    key={r.type}
                    style={{
                      ...styles.resBtn,
                      ...(monoPick === r.type ? styles.resBtnActive : {}),
                      ...(!canPlay ? styles.disabled : {}),
                    }}
                    disabled={!canPlay}
                    onClick={() => setMonoPick(monoPick === r.type ? null : r.type)}
                  >
                    {r.emoji}
                  </button>
                ))}
              </div>
              <button
                style={{ ...styles.playBtn, ...(monoPick && canPlay ? {} : styles.disabled) }}
                disabled={!monoPick || !canPlay}
                onClick={() => {
                  if (monoPick) {
                    onPlayMonopoly(monoPick);
                    setMonoPick(null);
                  }
                }}
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
  container: {
    background: 'linear-gradient(180deg, #1a3a5c 0%, #0f3460 100%)',
    borderRadius: 8,
    overflow: 'hidden',
    border: '1px solid #e67e22',
  },
  toggle: {
    width: '100%', padding: '10px 12px', border: 'none', background: 'transparent',
    color: '#e0e0e0', fontSize: 14, fontWeight: 'bold', cursor: 'pointer', textAlign: 'left',
    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
  },
  badge: {
    background: '#e67e22', color: 'white', borderRadius: 10,
    padding: '1px 8px', fontSize: 12, fontWeight: 'bold',
  },
  playHint: {
    fontSize: 11, color: '#2ecc71', fontWeight: 'normal', marginLeft: 'auto',
  },
  panel: { padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 },
  note: {
    fontSize: 11, color: '#ffd700', background: 'rgba(0,0,0,0.25)',
    borderRadius: 6, padding: '6px 8px',
  },
  cardList: { display: 'flex', flexDirection: 'column', gap: 4 },
  cardItem: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: '#1a1a2e', borderRadius: 6, padding: '8px 10px',
    border: '1px solid #3498db',
  },
  cardEmoji: { fontSize: 16 },
  cardName: { fontSize: 13, fontWeight: 'bold', color: '#e0e0e0', flex: 1 },
  newTag: { fontSize: 10, color: '#f39c12', fontWeight: 'bold' },
  vpTag: { fontSize: 10, color: '#ffd700' },
  empty: { fontSize: 12, color: '#8890a0', padding: 4 },
  armyNote: { fontSize: 11, color: '#e67e22' },
  actionBtn: {
    padding: '12px 12px', border: '1px solid #e67e22', borderRadius: 8,
    background: '#1a1a2e', color: '#e67e22', fontSize: 13, fontWeight: 'bold', cursor: 'pointer',
  },
  block: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 11, color: '#8890a0' },
  picks: { color: '#ffd700', fontWeight: 'bold' },
  resRow: { display: 'flex', gap: 4, flexWrap: 'wrap' },
  resBtn: {
    padding: '8px 12px', border: '1px solid #1a1a2e', borderRadius: 6,
    background: '#1a1a2e', color: '#e0e0e0', cursor: 'pointer', fontSize: 16,
  },
  resBtnActive: { borderColor: '#ffd700', background: '#16213e' },
  playBtn: {
    padding: '10px 12px', border: 'none', borderRadius: 6,
    background: 'linear-gradient(135deg, #3498db, #2980b9)',
    color: 'white', fontSize: 13, fontWeight: 'bold', cursor: 'pointer',
  },
  rowBtns: { display: 'flex', gap: 6 },
  clearBtn: {
    padding: '10px 12px', border: '1px solid #8890a0', borderRadius: 6,
    background: 'transparent', color: '#8890a0', fontSize: 12, cursor: 'pointer',
  },
  disabled: { opacity: 0.4, cursor: 'not-allowed' },
};

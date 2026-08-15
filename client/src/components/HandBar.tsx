import type { Player, ResourceType } from '../game/types';
import { countHeldDevCards } from '../game/rules';

interface HandBarProps {
  player: Player & { _resourceCount?: number; _devCardCount?: number };
}

const RESOURCES: {
  type: ResourceType;
  label: string;
  color: string;
  bg: string;
  glyph: string;
}[] = [
  { type: 'lumber', label: 'Lumber', color: '#1b5e20', bg: 'linear-gradient(160deg,#66bb6a,#2e7d32)', glyph: '🪵' },
  { type: 'brick', label: 'Brick', color: '#bf360c', bg: 'linear-gradient(160deg,#ef8a5a,#c62828)', glyph: '🧱' },
  { type: 'wool', label: 'Wool', color: '#33691e', bg: 'linear-gradient(160deg,#c5e1a5,#7cb342)', glyph: '🐑' },
  { type: 'grain', label: 'Grain', color: '#f57f17', bg: 'linear-gradient(160deg,#ffe082,#f9a825)', glyph: '🌾' },
  { type: 'ore', label: 'Ore', color: '#37474f', bg: 'linear-gradient(160deg,#b0bec5,#607d8b)', glyph: '⛰️' },
];

/**
 * Catan Universe–style always-visible resource strip.
 * Icon chips + counts; floats over the board edge.
 */
export default function HandBar({ player }: HandBarProps) {
  const devCount = player._devCardCount ?? countHeldDevCards(player);
  return (
    <div className="hand-bar cu-hand">
      {RESOURCES.map(r => {
        const n = player.resources[r.type] || 0;
        return (
          <div
            key={r.type}
            className={`hand-chip ${n > 0 ? 'hand-chip-live' : 'hand-chip-empty'}`}
            title={`${r.label}: ${n}`}
          >
            <span className="hand-icon" style={{ background: r.bg }}>{r.glyph}</span>
            <span className="hand-count" style={{ color: n > 0 ? '#fff8e7' : '#6b7280' }}>{n}</span>
          </div>
        );
      })}
      <div className={`hand-chip hand-dev ${devCount > 0 ? 'hand-chip-live' : 'hand-chip-empty'}`} title={`Dev cards: ${devCount}`}>
        <span className="hand-icon hand-icon-dev">📜</span>
        <span className="hand-count" style={{ color: devCount > 0 ? '#90caf9' : '#6b7280' }}>{devCount}</span>
      </div>
    </div>
  );
}

import type { Player, ResourceType } from '../game/types';
import { countHeldDevCards } from '../game/rules';

interface HandBarProps {
  player: Player & { _resourceCount?: number; _devCardCount?: number };
}

const RESOURCES: {
  type: ResourceType;
  label: string;
  face: string;
  edge: string;
  mark: string;
}[] = [
  { type: 'lumber', label: 'Lumber', face: '#66bb6a', edge: '#2e7d32', mark: '🌲' },
  { type: 'brick', label: 'Brick', face: '#ef8a5a', edge: '#c62828', mark: '🧱' },
  { type: 'wool', label: 'Wool', face: '#c5e1a5', edge: '#7cb342', mark: '🐑' },
  { type: 'grain', label: 'Grain', face: '#ffe082', edge: '#f9a825', mark: '🌾' },
  { type: 'ore', label: 'Ore', face: '#b0bec5', edge: '#546e7a', mark: '⛰️' },
];

/**
 * Catan Universe–style always-visible resource strip.
 * Fully opaque so board tokens never bleed through.
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
            <span
              className="hand-icon"
              style={{
                background: `linear-gradient(160deg, ${r.face}, ${r.edge})`,
                borderColor: r.edge,
              }}
            >
              <span className="hand-mark" aria-hidden>{r.mark}</span>
            </span>
            <span className="hand-count">{n}</span>
          </div>
        );
      })}
      <div
        className={`hand-chip hand-dev ${devCount > 0 ? 'hand-chip-live' : 'hand-chip-empty'}`}
        title={`Dev cards: ${devCount}`}
      >
        <span className="hand-icon hand-icon-dev">
          <span className="hand-mark" aria-hidden>📜</span>
        </span>
        <span className="hand-count hand-count-dev">{devCount}</span>
      </div>
    </div>
  );
}

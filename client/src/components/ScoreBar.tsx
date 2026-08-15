import type { ReactNode } from 'react';
import type { GameState, PlayerColor } from '../game/types';

const COLOR_HEX: Record<PlayerColor, string> = {
  red: '#d32f2f',
  blue: '#1976d2',
  white: '#eceff1',
  orange: '#f57c00',
};

interface ScoreBarProps {
  gameState: GameState;
  myColor?: PlayerColor | null;
  currentColor?: PlayerColor | null;
  dice?: [number, number] | null;
  rightActions?: ReactNode;
}

/**
 * Catan Universe–style top score strip:
 * color swatch · name · trophy + VP, with glow on current player / winner.
 */
export default function ScoreBar({
  gameState,
  myColor,
  currentColor,
  dice,
  rightActions,
}: ScoreBarProps) {
  const order = gameState.turnOrder?.length
    ? gameState.turnOrder
    : gameState.players.map(p => p.color);

  return (
    <div className="score-bar">
      <div className="score-bar-players">
        {order.map(color => {
          const p = gameState.players.find(pl => pl.color === color);
          if (!p) return null;
          const isCurrent = currentColor === color && !gameState.winner;
          const isWinner = gameState.winner === color;
          const isMe = myColor === color;
          const longest = gameState.longestRoad.color === color;
          const army = gameState.largestArmy.color === color;
          return (
            <div
              key={color}
              className={[
                'score-pill',
                isCurrent ? 'score-pill-current' : '',
                isWinner ? 'score-pill-winner' : '',
                isMe ? 'score-pill-me' : '',
              ].filter(Boolean).join(' ')}
              style={{ ['--pc' as string]: COLOR_HEX[color] }}
            >
              <span className="score-swatch" />
              <span className="score-name">
                {p.name}{p.isAI ? ' ·AI' : ''}{isMe ? ' ·you' : ''}
              </span>
              <span className="score-vp" title="Victory points">
                <span className="score-trophy">🏆</span>
                {p.victoryPoints}
              </span>
              {(longest || army) && (
                <span className="score-badges">
                  {longest && <span title="Longest Road">🛣️</span>}
                  {army && <span title="Largest Army">⚔️</span>}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="score-bar-right">
        {dice && (
          <span className="score-dice" title="Last roll">
            🎲 {dice[0]}+{dice[1]}
          </span>
        )}
        {!gameState.setupPhase && (
          <span className="score-phase">{gameState.phase}</span>
        )}
        {gameState.setupPhase && <span className="score-phase">setup</span>}
        {rightActions}
      </div>
    </div>
  );
}

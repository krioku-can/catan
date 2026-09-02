import type { TurnPhase } from '../game/types';

const ACTION_LABEL: Record<string, string> = {
  road: '🛣️ Road',
  settlement: '🏠 Settlement',
  city: '🏰 City',
};

interface TurnActionsBarProps {
  phase: TurnPhase;
  isMyTurn: boolean;
  selectedAction: string | null;
  onRoll: () => void;
  onEndTurn: () => void;
  onClearAction: () => void;
  rolling?: boolean;
  setupPhase?: boolean;
  robberMode?: boolean;
  winner?: boolean;
}

/**
 * Always-visible primary actions so a phone player doesn't have to open the
 * Actions sheet just to roll or end turn.
 */
export default function TurnActionsBar({
  phase,
  isMyTurn,
  selectedAction,
  onRoll,
  onEndTurn,
  onClearAction,
  rolling,
  setupPhase,
  robberMode,
  winner,
}: TurnActionsBarProps) {
  if (winner || setupPhase || robberMode || !isMyTurn) {
    if (selectedAction) {
      return (
        <div className="turn-cta">
          <span className="turn-cta-chip">
            {ACTION_LABEL[selectedAction] || selectedAction} — tap a highlighted spot
          </span>
          <button type="button" className="turn-cta-ghost" onClick={onClearAction}>Cancel</button>
        </div>
      );
    }
    return null;
  }

  const showRoll = phase === 'roll';
  const showEnd = phase === 'trade' || phase === 'build';
  if (!showRoll && !showEnd && !selectedAction) return null;

  return (
    <div className="turn-cta">
      {showRoll && (
        <button
          type="button"
          className="turn-cta-roll"
          onClick={onRoll}
          disabled={rolling}
        >
          {rolling ? '🎲 Rolling…' : '🎲 Roll dice'}
        </button>
      )}
      {selectedAction && (
        <>
          <span className="turn-cta-chip">
            {ACTION_LABEL[selectedAction] || selectedAction} — tap a highlighted spot
          </span>
          <button type="button" className="turn-cta-ghost" onClick={onClearAction}>Cancel</button>
        </>
      )}
      {showEnd && (
        <button type="button" className="turn-cta-end" onClick={onEndTurn}>
          End turn
        </button>
      )}
    </div>
  );
}

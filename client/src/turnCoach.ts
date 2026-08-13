import type { GameState, Player, PlayerColor } from './game/types';
import { getCurrentPlayer } from './game/rules';

/** One-line coach copy for the always-visible turn banner. */
export function getTurnCoach(
  gs: GameState,
  me: Player | undefined | null,
  opts?: {
    robberMode?: boolean;
    pendingSteal?: boolean;
    selectedAction?: string | null;
  },
): string {
  if (gs.winner) {
    const w = gs.players.find(p => p.color === gs.winner);
    return w ? `🏆 ${w.name} wins with ${w.victoryPoints} VP!` : '🏆 Game over!';
  }

  const current = getCurrentPlayer(gs);
  const isMe = !!me && current.color === me.color;
  const who = isMe ? 'Your turn' : `${current.name}'s turn`;

  if (opts?.pendingSteal && isMe) {
    return '🦹 Choose a player to steal from';
  }
  if (opts?.robberMode && isMe) {
    return '🦹 Tap a hex to move the robber (not the current hex)';
  }

  if (gs.phase === 'discard') {
    if (me && gs.discardQueue.includes(me.color)) {
      const total = (['brick', 'lumber', 'wool', 'grain', 'ore'] as const)
        .reduce((s, r) => s + (me.resources[r] || 0), 0);
      const n = Math.floor(total / 2);
      return `📦 Discard ${n} card${n === 1 ? '' : 's'} (you have more than 7)`;
    }
    const waiting = gs.discardQueue
      .map(c => gs.players.find(p => p.color === c)?.name || c)
      .filter(Boolean);
    return waiting.length
      ? `⏳ Waiting for discard: ${waiting.join(', ')}`
      : '⏳ Resolving discards…';
  }

  if (gs.setupPhase) {
    if (!isMe) return `⏳ ${current.name} is placing (${gs.phase === 'setup_road' ? 'road' : 'settlement'})`;
    if (gs.phase === 'setup_settlement') return '🏠 Tap a corner to place a settlement';
    if (gs.phase === 'setup_road') return '🛣️ Tap an edge next to your settlement for a road';
    return 'Setup phase';
  }

  if (gs.phase === 'turn_order') {
    return isMe ? '🎲 Roll to decide who goes first' : `⏳ ${current.name} is rolling turn order`;
  }

  if (gs.pendingDevAction === 'road_building' && (gs.pendingDevRoads || 0) > 0 && isMe) {
    return `🛣️ Road Building: place ${gs.pendingDevRoads} free road${gs.pendingDevRoads === 1 ? '' : 's'}`;
  }

  if (opts?.selectedAction && isMe) {
    const map: Record<string, string> = {
      road: '🛣️ Tap an edge to build a road',
      settlement: '🏠 Tap a corner to build a settlement',
      city: '🏰 Tap one of your settlements to upgrade to a city',
    };
    if (map[opts.selectedAction]) return map[opts.selectedAction];
  }

  if (gs.phase === 'roll') {
    return isMe ? '🎲 Roll the dice' : `⏳ Waiting for ${current.name} to roll`;
  }

  if (gs.phase === 'trade') {
    // Robber still needs moving after a 7 if not yet moved this turn
    if (isMe && gs.dice && gs.dice[0] + gs.dice[1] === 7 && !gs.robberMovedThisTurn) {
      return '🦹 Move the robber — tap a hex, then steal';
    }
    return isMe
      ? '💱 Trade with bank or players, build, or End Turn when ready'
      : `⏳ ${current.name} is trading / building`;
  }

  if (gs.phase === 'build') {
    return isMe
      ? '🔨 Build roads, settlements, cities, or buy a dev card — then End Turn'
      : `⏳ ${current.name} is building`;
  }

  return who;
}

export function isMyTurnColor(gs: GameState, color: PlayerColor | undefined | null): boolean {
  if (!color) return false;
  return getCurrentPlayer(gs).color === color;
}

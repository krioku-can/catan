import type { GameState, PlayerColor } from './game/types';
import { canPlaceSettlement } from './game/board';
import { cityCandidates, roadCandidates, settlementCandidates } from './game/rules';

export function legalHighlights(
  gs: GameState,
  color: PlayerColor | undefined | null,
  selectedAction: string | null,
  isMyTurn: boolean,
): { intersections: string[]; edges: string[] } {
  const empty = { intersections: [] as string[], edges: [] as string[] };
  if (!color || !isMyTurn || gs.winner) return empty;

  if (gs.setupPhase) {
    if (gs.phase === 'setup_settlement') {
      return {
        intersections: Object.values(gs.intersections)
          .filter(i => canPlaceSettlement(i.key, gs.intersections, gs.edges))
          .map(i => i.key),
        edges: [],
      };
    }
    if (gs.phase === 'setup_road') {
      let just = gs.lastSetupSettlement;
      if (!just) {
        const mine = Object.values(gs.intersections).filter(i => i.owner === color && i.building);
        const roadCountAt = (key: string) =>
          Object.values(gs.edges).filter(
            e => e.road === color && (e.from === key || e.to === key),
          ).length;
        just = mine.find(s => roadCountAt(s.key) === 0)?.key;
      }
      return {
        intersections: [],
        edges: Object.values(gs.edges)
          .filter(e => !e.road && just && (e.from === just || e.to === just))
          .map(e => e.key),
      };
    }
    return empty;
  }

  const freeRoads = gs.pendingDevAction === 'road_building' && (gs.pendingDevRoads || 0) > 0;
  if (freeRoads) {
    return { intersections: [], edges: roadCandidates(gs, color).map(e => e.key) };
  }

  if (selectedAction === 'settlement') {
    return { intersections: settlementCandidates(gs, color).map(i => i.key), edges: [] };
  }
  if (selectedAction === 'city') {
    return { intersections: cityCandidates(gs, color).map(i => i.key), edges: [] };
  }
  if (selectedAction === 'road') {
    return { intersections: [], edges: roadCandidates(gs, color).map(e => e.key) };
  }
  return empty;
}

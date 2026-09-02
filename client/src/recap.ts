import type { GameState, PlayerColor, ResourceType } from './game/types';
import { getHexCorners } from './game/board';

export type Standing = { name: string; color: string; vp: number };

export interface GameRecap {
  myVp: number;
  won: boolean;
  winnerName: string;
  winnerVp: number;
  scores: Standing[];
  longestRoad?: string;
  largestArmy?: string;
  tip: string;
  cities: number;
  settlements: number;
  roads: number;
  knights: number;
}

function pipDots(n?: number): number {
  if (!n || n === 7) return 0;
  return Math.max(0, 6 - Math.abs(7 - n));
}

function countPieces(gs: GameState, color: PlayerColor) {
  let settlements = 0;
  let cities = 0;
  let roads = 0;
  for (const inter of Object.values(gs.intersections)) {
    if (inter.owner !== color) continue;
    if (inter.building === 'city') cities += 1;
    else if (inter.building === 'settlement') settlements += 1;
  }
  for (const edge of Object.values(gs.edges)) {
    if (edge.road === color) roads += 1;
  }
  return { settlements, cities, roads };
}

function pipMap(gs: GameState, color: PlayerColor): Record<ResourceType, number> {
  const pips: Record<ResourceType, number> = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
  for (const inter of Object.values(gs.intersections)) {
    if (inter.owner !== color || !inter.building) continue;
    const mult = inter.building === 'city' ? 2 : 1;
    for (const tile of gs.board) {
      if (!getHexCorners(tile.q, tile.r).includes(inter.key)) continue;
      if (tile.type === 'desert' || tile.type === 'water') continue;
      pips[tile.type as ResourceType] += pipDots(tile.number) * mult;
    }
  }
  return pips;
}

function pickTip(
  gs: GameState,
  recap: GameRecap,
  pips: Record<ResourceType, number>,
  myColor?: PlayerColor,
): string {
  const winner = gs.players.find(p => p.color === gs.winner);
  const winnerPieces = winner ? countPieces(gs, winner.color) : { settlements: 0, cities: 0, roads: 0 };
  const gap = recap.winnerVp - recap.myVp;
  const ore = pips.ore || 0;
  const brickLumber = (pips.brick || 0) + (pips.lumber || 0);

  if (!recap.won && recap.cities === 0 && winnerPieces.cities > 0) {
    return `You finished with 0 cities; ${recap.winnerName} had ${winnerPieces.cities}. Bank-trade for ore/grain — a city is 2 VP and doubles production.`;
  }
  if (!recap.won && gs.longestRoad.color && gs.longestRoad.color !== myColor && recap.roads < (gs.longestRoad.length || 5)) {
    return `${recap.longestRoad} took Longest Road (${gs.longestRoad.length} long, 2 VP). You had ${recap.roads} roads — keep a 5+ chain in mind once two settlements are down.`;
  }
  if (!recap.won && gs.largestArmy.color && gs.largestArmy.color !== myColor && recap.knights === 0) {
    return `Largest Army went to ${recap.largestArmy} (2 VP). You never played a knight — ore/wool/grain into three knights is a cheap 2 VP.`;
  }
  if (!recap.won && ore < 3 && recap.cities <= 1) {
    return `Your spots only produced ${ore} ore pips. Next setup, grab an ore hex so cities aren't a dead end.`;
  }
  if (!recap.won && brickLumber < 4 && recap.settlements <= 2) {
    return `You were light on brick/lumber (${brickLumber} pips) so expansion stalled at ${recap.settlements} settlements. Seed wood+brick on the second placement.`;
  }
  if (!recap.won && gap <= 2 && gap >= 0) {
    return `You were only ${gap} VP behind (${recap.myVp}–${recap.winnerVp}). Spend the last turn on a piece instead of sitting on cards.`;
  }
  if (recap.won && recap.cities >= 2) {
    return `Cities carried you (${recap.cities} for ${recap.cities * 2} building VP). Keep that ore/grain pipeline.`;
  }
  if (recap.won && gs.longestRoad.color === myColor) {
    return `Longest Road sealed it (${gs.longestRoad.length} long). Next time, watch for someone cutting the chain.`;
  }
  if (recap.won) {
    return `You closed at ${recap.myVp} VP. Convert leftover brick/wood into a road the turn before you think you've won.`;
  }
  return `Final: ${recap.scores.map(s => `${s.name} ${s.vp}`).join(', ')}. Next setup, make the second settlement cover a resource you don't have.`;
}

export function buildRecap(gs: GameState, myColor?: PlayerColor | null): GameRecap {
  const me = (myColor && gs.players.find(p => p.color === myColor)) || gs.players.find(p => !p.isAI);
  const winner = gs.players.find(p => p.color === gs.winner);
  const scores: Standing[] = gs.players
    .map(p => ({ name: p.name, color: p.color, vp: p.victoryPoints || 0 }))
    .sort((a, b) => b.vp - a.vp);
  const pieces = me ? countPieces(gs, me.color) : { settlements: 0, cities: 0, roads: 0 };
  const pips = me ? pipMap(gs, me.color) : { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
  const recap: GameRecap = {
    myVp: me?.victoryPoints || 0,
    won: !!me && me.color === gs.winner,
    winnerName: winner?.name || 'Someone',
    winnerVp: winner?.victoryPoints || 0,
    scores,
    longestRoad: gs.longestRoad.color
      ? gs.players.find(p => p.color === gs.longestRoad.color)?.name
      : undefined,
    largestArmy: gs.largestArmy.color
      ? gs.players.find(p => p.color === gs.largestArmy.color)?.name
      : undefined,
    tip: '',
    cities: pieces.cities,
    settlements: pieces.settlements,
    roads: pieces.roads,
    knights: me?.playedKnights || 0,
  };
  recap.tip = pickTip(gs, recap, pips, me?.color);
  return recap;
}

// Core game rules and state management

import type { GameState, GameConfig, Player, PlayerColor, ResourceType, DevelopmentCard, HexTile, Edge } from './types.js';
import { generateBoard, canPlaceSettlement, canPlaceRoad, getResourceProduction, getAdjacentIntersections, getEdgesForIntersection, getHexCorners, getPortRate } from './board.js';
import { getTraits, loadStats, COLOR_PERSONALITY, type TraitWeights } from './personality.js';

const RESOURCES: ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];

const BUILDING_COSTS: Record<string, Partial<Record<ResourceType, number>>> = {
  road: { lumber: 1, brick: 1 },
  settlement: { lumber: 1, brick: 1, wool: 1, grain: 1 },
  city: { grain: 2, ore: 3 },
  devCard: { ore: 1, wool: 1, grain: 1 },
};

const INITIAL_PIECES = {
  roads: 15,
  settlements: 5,
  cities: 4,
};

/** Official base-set development deck (25 cards). */
export const FULL_DEV_DECK: DevelopmentCard['type'][] = [
  ...Array(14).fill('knight'),
  ...Array(5).fill('victory_point'),
  ...Array(2).fill('road_building'),
  ...Array(2).fill('year_of_plenty'),
  ...Array(2).fill('monopoly'),
] as DevelopmentCard['type'][];

function shuffleDeck<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let _devCardSeq = 0;
function nextDevCardId(): string {
  _devCardSeq += 1;
  return `dev_${Date.now().toString(36)}_${_devCardSeq}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Cards still in hand (not face-up action cards). VPs always count as held. */
export function getHeldDevCards(player: Player): DevelopmentCard[] {
  return (player.devCards || []).filter(c => {
    if (c.type === 'victory_point') return true;
    return !c.played;
  });
}

export function countHeldDevCards(player: Player): number {
  return getHeldDevCards(player).length;
}

/** Normalize legacy cards (missing id, VPs incorrectly marked played). */
export function normalizePlayerDevCards(player: Player): void {
  for (const c of player.devCards || []) {
    if (!c.id) c.id = nextDevCardId();
    // VPs are never "played" as an action — keep them in hand.
    if (c.type === 'victory_point' && c.played) {
      c.played = false;
    }
  }
}

export function createInitialState(config: GameConfig): GameState {
  const boardMode = config.boardMode === 'balanced' ? 'balanced' : 'random';
  const { tiles, ports, intersections, edges } = generateBoard(boardMode);
  
  const colors: PlayerColor[] = ['red', 'blue', 'white', 'orange'];
  const players: Player[] = [];
  
  for (let i = 0; i < config.numPlayers; i++) {
    players.push({
      color: colors[i],
      name: config.playerNames[i] || `Player ${i + 1}`,
      resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 },
      devCards: [],
      playedKnights: 0,
      roadsRemaining: INITIAL_PIECES.roads,
      settlementsRemaining: INITIAL_PIECES.settlements,
      citiesRemaining: INITIAL_PIECES.cities,
      victoryPoints: 0,
      isAI: config.aiPlayers.includes(i),
      aiLevel: config.aiLevel || 'normal',
      personalityId: config.aiPlayers.includes(i)
        ? (config.aiPersonalities?.[i] || COLOR_PERSONALITY[colors[i]] || 'builder')
        : undefined,
      devCardsPlayedThisTurn: 0,
      boughtDevCardThisTurn: false,
    });
  }

  const robberTile = tiles.find(t => t.hasRobber)!;
  const vpToWin = config.victoryPointsToWin === 12 ? 12 : 10;

  return {
    id: Math.random().toString(36).substring(2, 8).toUpperCase(),
    players,
    board: tiles,
    ports,
    intersections,
    edges,
    turnOrder: colors.slice(0, config.numPlayers),
    currentTurn: 0,
    phase: 'turn_order',
    round: 0,
    dice: null,
    robberHex: `${robberTile.q},${robberTile.r}`,
    robberMovedThisTurn: false,
    pendingRobberMove: false,
    longestRoad: { length: 0 },
    largestArmy: { size: 0 },
    tradeOffers: [],
    setupPhase: true,
    setupRound: 0,
    lastSetupSettlement: undefined,
    discardQueue: [],
    pendingDevAction: null,
    pendingDevRoads: 0,
    devDeck: shuffleDeck(FULL_DEV_DECK),
    victoryPointsToWin: vpToWin,
    friendlyRobber: !!config.friendlyRobber,
    boardMode,
  };
}

export function getCurrentPlayer(state: GameState): Player {
  const color = state.turnOrder[state.currentTurn];
  return state.players.find(p => p.color === color)!;
}

export function getPlayerByColor(state: GameState, color: PlayerColor): Player {
  return state.players.find(p => p.color === color)!;
}

// Execute a domestic trade between two players. `give` moves from `from` to
// `to`; `want` moves from `to` to `from`. Returns an error string or null.
export function executeTrade(
  state: GameState,
  from: PlayerColor,
  to: PlayerColor,
  give: Partial<Record<ResourceType, number>>,
  want: Partial<Record<ResourceType, number>>,
): string | null {
  const giver = getPlayerByColor(state, from);
  const taker = getPlayerByColor(state, to);
  if (!giver || !taker) return 'Invalid player';
  // Validate both sides have the resources.
  for (const [r, n] of Object.entries(give || {})) {
    if ((giver.resources[r as ResourceType] || 0) < (Number(n) || 0)) return 'Not enough resources';
  }
  for (const [r, n] of Object.entries(want || {})) {
    if ((taker.resources[r as ResourceType] || 0) < (Number(n) || 0)) return 'Not enough resources';
  }
  // Execute.
  for (const [r, n] of Object.entries(give || {})) {
    const amt = Number(n) || 0;
    giver.resources[r as ResourceType] -= amt;
    taker.resources[r as ResourceType] = (taker.resources[r as ResourceType] || 0) + amt;
  }
  for (const [r, n] of Object.entries(want || {})) {
    const amt = Number(n) || 0;
    taker.resources[r as ResourceType] -= amt;
    giver.resources[r as ResourceType] = (giver.resources[r as ResourceType] || 0) + amt;
  }
  return null;
}

/** Post a public table offer. Anyone can accept; proposer later picks a partner. */
export function proposePublicTrade(
  state: GameState,
  give: Partial<Record<ResourceType, number>>,
  want: Partial<Record<ResourceType, number>>,
): string | null {
  const player = getCurrentPlayer(state);
  if (state.phase !== 'trade' && state.phase !== 'build') return 'Not trade phase';
  const giveTotal = Object.values(give || {}).reduce((s, n) => s + (Number(n) || 0), 0);
  const wantTotal = Object.values(want || {}).reduce((s, n) => s + (Number(n) || 0), 0);
  if (giveTotal <= 0 || wantTotal <= 0) return 'Offer must give and want something';
  for (const [r, n] of Object.entries(give || {})) {
    if ((player.resources[r as ResourceType] || 0) < (Number(n) || 0)) return 'Not enough resources';
  }
  state.tradeOffers = state.tradeOffers.filter(o => o.from !== player.color);
  state.tradeOffers.push({
    from: player.color,
    give,
    want,
    acceptedBy: [],
    rejectedBy: [],
  });
  return null;
}

/**
 * Respond to an offer.
 * Public offer: registers interest (does NOT execute).
 * Directed offer (counter): Accept executes immediately.
 */
export function respondToTrade(
  state: GameState,
  responder: PlayerColor,
  from: PlayerColor,
  accept: boolean,
): string | null {
  const offer = state.tradeOffers.find(
    o => o.from === from && (o.to === undefined || o.to === responder),
  );
  if (!offer) return 'No offer';
  if (offer.from === responder) return 'Cannot respond to your own offer';

  if (offer.to === responder) {
    if (!accept) {
      state.tradeOffers = state.tradeOffers.filter(o => o !== offer);
      return null;
    }
    const err = executeTrade(state, offer.from, responder, offer.give, offer.want);
    if (err) return err;
    state.tradeOffers = state.tradeOffers.filter(o => o !== offer);
    return null;
  }

  const other = getPlayerByColor(state, responder);
  if (!other) return 'Invalid player';
  offer.acceptedBy = (offer.acceptedBy || []).filter(c => c !== responder);
  offer.rejectedBy = (offer.rejectedBy || []).filter(c => c !== responder);
  if (accept) {
    for (const [r, n] of Object.entries(offer.want || {})) {
      if ((other.resources[r as ResourceType] || 0) < (Number(n) || 0)) {
        return 'Not enough resources';
      }
    }
    offer.acceptedBy.push(responder);
  } else {
    offer.rejectedBy.push(responder);
  }
  return null;
}

/** Proposer completes a public offer with one player who accepted. */
export function completeTradeWith(state: GameState, partner: PlayerColor): string | null {
  const player = getCurrentPlayer(state);
  const offer = state.tradeOffers.find(o => o.from === player.color && o.to === undefined);
  if (!offer) return 'No open offer';
  if (!(offer.acceptedBy || []).includes(partner)) return 'That player has not accepted';
  const err = executeTrade(state, offer.from, partner, offer.give, offer.want);
  if (err) return err;
  state.tradeOffers = state.tradeOffers.filter(o => o !== offer);
  return null;
}

export function cancelTradeOffer(state: GameState, color?: PlayerColor): void {
  const who = color || getCurrentPlayer(state).color;
  state.tradeOffers = state.tradeOffers.filter(o => o.from !== who);
}

/** AI players register accept/reject on unanswered public offers. Returns true if anyone responded. */
export function aiRespondToPublicOffers(state: GameState): boolean {
  let changed = false;
  for (const offer of state.tradeOffers) {
    if (offer.to !== undefined) continue;
    for (const p of state.players) {
      if (!p.isAI || p.color === offer.from) continue;
      if ((offer.acceptedBy || []).includes(p.color)) continue;
      if ((offer.rejectedBy || []).includes(p.color)) continue;
      const giveTotal = Object.values(offer.give || {}).reduce((s, n) => s + (Number(n) || 0), 0);
      const wantTotal = Object.values(offer.want || {}).reduce((s, n) => s + (Number(n) || 0), 0);
      const surplus = RESOURCES.filter(r => (p.resources[r] || 0) >= 3);
      const scarce = RESOURCES.filter(r => (p.resources[r] || 0) <= 1);
      const givesSurplus = Object.keys(offer.want || {}).every(r => surplus.includes(r as ResourceType));
      const getsScarce = Object.keys(offer.give || {}).some(r => scarce.includes(r as ResourceType));
      let canPay = true;
      for (const [r, n] of Object.entries(offer.want || {})) {
        if ((p.resources[r as ResourceType] || 0) < (Number(n) || 0)) canPay = false;
      }
      const favorable = canPay && (wantTotal >= giveTotal || (givesSurplus && getsScarce));
      respondToTrade(state, p.color, offer.from, favorable);
      changed = true;
    }
  }
  return changed;
}

// Check if player can afford something
export function canAfford(player: Player, cost: Partial<Record<ResourceType, number>>): boolean {
  for (const [resource, amount] of Object.entries(cost)) {
    if ((player.resources[resource as ResourceType] || 0) < (amount || 0)) return false;
  }
  return true;
}

// Deduct resources from player
export function deductResources(player: Player, cost: Partial<Record<ResourceType, number>>): void {
  for (const [resource, amount] of Object.entries(cost)) {
    player.resources[resource as ResourceType] -= amount || 0;
  }
}

// Add resources to player
export function addResources(player: Player, resources: Partial<Record<ResourceType, number>>): void {
  for (const [resource, amount] of Object.entries(resources)) {
    player.resources[resource as ResourceType] = (player.resources[resource as ResourceType] || 0) + (amount || 0);
  }
}

// Place a settlement during setup
export function placeSetupSettlement(state: GameState, intersectionKey: string): string | null {
  const player = getCurrentPlayer(state);
  const inter = state.intersections[intersectionKey];
  if (!inter) return 'Invalid intersection';
  if (inter.building) return 'Already occupied';

  // Official distance rule: never place adjacent to another settlement/city.
  // (First placement of the game auto-passes because the board is empty.)
  const adjacent = getAdjacentIntersections(intersectionKey, state.edges);
  for (const adjKey of adjacent) {
    const adj = state.intersections[adjKey];
    if (adj?.building) return 'Too close to another settlement';
  }

  inter.building = 'settlement';
  inter.owner = player.color;
  player.settlementsRemaining--;
  player.victoryPoints += 1;
  state.lastSetupSettlement = intersectionKey;

  // Official / Catan Universe: ONLY the second settlement grants starting
  // resources — 1 of each resource from every adjacent land hex.
  // First-round setup is setupRound < numPlayers*2; second round is >= that.
  const isSecondSettlement = state.setupRound >= state.players.length * 2;
  if (isSecondSettlement) {
    const hexes = getAdjacentHexes(intersectionKey, state.board);
    hexes.forEach(hex => {
      if (hex.type !== 'desert' && hex.type !== 'water') {
        addResources(player, { [hex.type]: 1 });
      }
    });
  }

  return null; // success
}

/** The settlement the current setup road must attach to (the one just placed). */
function getJustPlacedSetupSettlement(state: GameState, color: PlayerColor): string | null {
  const tagged = state.lastSetupSettlement;
  if (tagged && state.intersections[tagged]?.owner === color) return tagged;

  // Fallback for older saves that lack lastSetupSettlement: the player's
  // settlement that currently has no road attached is the one just placed.
  const mine = Object.values(state.intersections).filter(i => i.owner === color && i.building);
  const roadCountAt = (key: string) =>
    Object.values(state.edges).filter(
      e => e.road === color && (e.from === key || e.to === key),
    ).length;
  return mine.find(s => roadCountAt(s.key) === 0)?.key ?? null;
}

// Place a road during setup
export function placeSetupRoad(state: GameState, edgeKey: string): string | null {
  const player = getCurrentPlayer(state);
  const edge = state.edges[edgeKey];
  if (!edge) return 'Invalid edge';
  if (edge.road) return 'Already has a road';

  // Official: each setup road must connect to the settlement just placed —
  // not to an earlier one you already own.
  const justPlaced = getJustPlacedSetupSettlement(state, player.color);
  if (!justPlaced) return 'Must connect to the settlement you just placed';
  if (edge.from !== justPlaced && edge.to !== justPlaced) {
    return 'Must connect to the settlement you just placed';
  }

  edge.road = player.color;
  player.roadsRemaining--;
  return null;
}

// Roll for starting turn order. Each player rolls 2 dice; highest total
// goes first, then descending. Official: tied opening rolls re-roll until
// every player has a unique total.
function roll2d6(): number {
  return Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6) + 1;
}

export function rollTurnOrder(state: GameState): { order: PlayerColor[]; rolls: Record<string, number> } {
  const players = state.players;
  const rolls: Record<string, number> = {};
  for (const p of players) rolls[p.color] = roll2d6();

  let guard = 0;
  while (guard++ < 80) {
    const byScore = new Map<number, PlayerColor[]>();
    for (const p of players) {
      const s = rolls[p.color];
      const list = byScore.get(s) || [];
      list.push(p.color);
      byScore.set(s, list);
    }
    const tied = [...byScore.values()].filter(g => g.length > 1);
    if (tied.length === 0) break;
    for (const group of tied) {
      for (const color of group) rolls[color] = roll2d6();
    }
  }

  const ordered = [...players].sort((a, b) => {
    const diff = (rolls[b.color] || 0) - (rolls[a.color] || 0);
    if (diff !== 0) return diff;
    // Only reachable if the re-roll loop hit the guard (extremely rare).
    return players.indexOf(a) - players.indexOf(b);
  });
  state.turnOrder = ordered.map(p => p.color);
  state.currentTurn = 0;
  return { order: state.turnOrder, rolls };
}

// Roll dice
export function rollDice(state: GameState): [number, number] {
  const d1 = Math.floor(Math.random() * 6) + 1;
  const d2 = Math.floor(Math.random() * 6) + 1;
  state.dice = [d1, d2];

  const total = d1 + d2;
  
  // Distribute resources
  if (total !== 7) {
    state.phase = 'trade';
    const production = getResourceProduction(total, state.board, state.intersections);
    for (const [color, resources] of Object.entries(production)) {
      const player = getPlayerByColor(state, color as PlayerColor);
      addResources(player, resources);
    }
  } else {
    // 7 rolled: anyone with >7 cards must discard half. Enter discard phase.
    state.discardQueue = state.players
      .filter(p => totalResourceCount(p) > 7)
      .map(p => p.color);
    // Robber MUST be moved after a 7 (once discards finish).
    state.pendingRobberMove = true;
    state.robberMovedThisTurn = false;
    // If nobody needs to discard, skip straight to the robber/trade phase.
    state.phase = state.discardQueue.length > 0 ? 'discard' : 'trade';
  }

  return [d1, d2];
}

function totalResourceCount(p: Player): number {
  return RESOURCES.reduce((sum, r) => sum + (p.resources[r] || 0), 0);
}

// Discard a specific set of resources (used after a 7). Returns error string or null.
export function discardResources(state: GameState, color: PlayerColor, toDiscard: Partial<Record<ResourceType, number>>): string | null {
  const player = getPlayerByColor(state, color);
  if (!state.discardQueue.includes(color)) return 'You do not need to discard';

  // Validate the discard is exactly half (rounded down) of the hand.
  const total = totalResourceCount(player);
  const mustDiscard = Math.floor(total / 2);
  const discarding = RESOURCES.reduce((sum, r) => sum + (toDiscard[r] || 0), 0);
  if (discarding !== mustDiscard) return `Must discard exactly ${mustDiscard} cards`;

  // Validate the player actually has what they're discarding.
  for (const r of RESOURCES) {
    if ((toDiscard[r] || 0) > (player.resources[r] || 0)) return 'You do not have those cards';
  }

  deductResources(player, toDiscard);
  state.discardQueue = state.discardQueue.filter(c => c !== color);

  // Once everyone has discarded, move to the robber phase (trade phase, robber UI).
  if (state.discardQueue.length === 0) {
    state.phase = 'trade';
  }

  return null;
}

// Move robber
export function moveRobber(state: GameState, targetHexQ: number, targetHexR: number, stealFrom?: PlayerColor): string | null {
  const [rq, rr] = state.robberHex.split(',').map(Number);
  const oldTile = state.board.find(t => t.q === rq && t.r === rr);
  const newTile = state.board.find(t => t.q === targetHexQ && t.r === targetHexR);
  
  if (!newTile) return 'Invalid hex';
  if (newTile.type === 'water') return 'Cannot place robber on water';
  // Official rule: the robber must be moved to a different hex.
  if (newTile.q === rq && newTile.r === rr) return 'Robber must move to a different hex';
  
  if (oldTile) oldTile.hasRobber = false;
  newTile.hasRobber = true;
  state.robberHex = `${targetHexQ},${targetHexR}`;
  state.robberMovedThisTurn = true;
  state.pendingRobberMove = false;
  // One source of truth — never leave a stray hasRobber flag on another tile.
  for (const t of state.board) {
    t.hasRobber = t.q === targetHexQ && t.r === targetHexR;
  }

  // Steal a random resource from a player with settlements on this hex
  if (stealFrom) {
    const target = getPlayerByColor(state, stealFrom);
    if (state.friendlyRobber && (target.victoryPoints || 0) <= 2) {
      // Friendly Robber: skip steal silently if target is protected
    } else {
      const hasResources = RESOURCES.some((r: ResourceType) => (target.resources[r] || 0) > 0);
      if (hasResources) {
        const available = RESOURCES.filter((r: ResourceType) => (target.resources[r] || 0) > 0);
        const stolen = available[Math.floor(Math.random() * available.length)];
        target.resources[stolen]--;
        getCurrentPlayer(state).resources[stolen]++;
      }
    }
  }

  return null;
}

/** Pip value for robber targeting: 6/8 are the tiles you actually want to shut down. */
function robberPipWeight(n: number | undefined): number {
  if (!n) return 0;
  if (n === 6 || n === 8) return 5;
  if (n === 5 || n === 9) return 4;
  if (n === 4 || n === 10) return 3;
  if (n === 3 || n === 11) return 2;
  return 1;
}

/** Best hex to drop the robber on: high-pip enemy tiles, prefer the leader, avoid blocking yourself. */
export function pickRobberHex(state: GameState, mover: PlayerColor, aggression = 0.5): { q: number; r: number } | null {
  const [rq, rr] = (state.robberHex || '0,0').split(',').map(Number);
  const leader = [...state.players].sort((a, b) => (b.victoryPoints || 0) - (a.victoryPoints || 0))[0];
  const candidates: { q: number; r: number; score: number }[] = [];
  for (const tile of state.board) {
    if (tile.type === 'water') continue;
    if (tile.q === rq && tile.r === rr) continue;
    const corners = getHexCorners(tile.q, tile.r);
    let enemy = 0;
    let self = 0;
    let hitsLeader = false;
    for (const cKey of corners) {
      const inter = state.intersections[cKey];
      if (!inter?.owner) continue;
      const w = inter.building === 'city' ? 2 : 1;
      if (inter.owner === mover) self += w;
      else {
        enemy += w;
        if (leader && inter.owner === leader.color && leader.color !== mover) hitsLeader = true;
      }
    }
    if (enemy === 0) continue;
    const pips = robberPipWeight(tile.number);
    let score = enemy * pips * 10 + pips;
    if (hitsLeader) score += 8 + aggression * 6; // warlords press the leader harder
    score -= self * pips * 12;
    if (score > 0) candidates.push({ q: tile.q, r: tile.r, score });
  }
  if (candidates.length === 0) {
    const desert = state.board.find(t => t.type === 'desert' && !(t.q === rq && t.r === rr));
    if (desert) return { q: desert.q, r: desert.r };
    const any = state.board.find(t => t.type !== 'water' && !(t.q === rq && t.r === rr));
    return any ? { q: any.q, r: any.r } : null;
  }
  candidates.sort((a, b) => b.score - a.score);
  // Peaceful AIs occasionally take a slightly-off tile rather than always the
  // hardest hit; warlords always go for the leader.
  if (aggression < 0.4 && candidates.length > 1 && Math.random() < 0.3) {
    return candidates[1];
  }
  return candidates[0];
}

// Get players who have a settlement/city on a given hex AND have resources to
// steal. Used to determine legal steal targets after moving the robber.
export function getStealTargets(
  state: GameState,
  hexQ: number,
  hexR: number,
): PlayerColor[] {
  const current = getCurrentPlayer(state).color;
  const targets: PlayerColor[] = [];
  const corners = getHexCorners(hexQ, hexR);
  corners.forEach(cKey => {
    const inter = state.intersections[cKey];
    if (!inter?.owner || inter.owner === current) return;
    const p = getPlayerByColor(state, inter.owner);
    if (!p) return;
    // Catan Universe Friendly Robber: protected until >2 VP.
    if (state.friendlyRobber && (p.victoryPoints || 0) <= 2) return;
    const hasRes = RESOURCES.some(r => (p.resources[r] || 0) > 0);
    if (hasRes && !targets.includes(inter.owner)) targets.push(inter.owner);
  });
  return targets;
}

// Steal a random resource from a target player (robber already moved).
export function stealFrom(
  state: GameState,
  target: PlayerColor,
  out?: { resource?: ResourceType },
): string | null {
  const t = getPlayerByColor(state, target);
  if (!t) return 'Invalid target';
  if (state.friendlyRobber && (t.victoryPoints || 0) <= 2) {
    return 'Friendly Robber: cannot steal from players with 2 VP or fewer';
  }
  const hasResources = RESOURCES.some(r => (t.resources[r] || 0) > 0);
  if (!hasResources) return 'Target has no resources';
  const available = RESOURCES.filter(r => (t.resources[r] || 0) > 0);
  const stolen = available[Math.floor(Math.random() * available.length)];
  t.resources[stolen]--;
  getCurrentPlayer(state).resources[stolen]++;
  if (out) out.resource = stolen;
  return null;
}

export function countVictoryPoints(state: GameState, player: Player): number {
  let vp = 0;
  for (const inter of Object.values(state.intersections)) {
    if (inter.owner !== player.color) continue;
    if (inter.building === 'settlement') vp += 1;
    else if (inter.building === 'city') vp += 2;
  }
  if (state.longestRoad.color === player.color) vp += 2;
  if (state.largestArmy.color === player.color) vp += 2;
  vp += (player.devCards || []).filter(c => c.type === 'victory_point').length;
  return vp;
}

export function syncVictoryPoints(state: GameState): void {
  for (const p of state.players) {
    p.victoryPoints = countVictoryPoints(state, p);
  }
}

export function checkVictory(state: GameState): void {
  if (state.setupPhase || state.winner) return;
  syncVictoryPoints(state);
  // Official: you win on your turn the moment you have the target VP.
  const p = getCurrentPlayer(state);
  if (p && (p.victoryPoints || 0) >= (state.victoryPointsToWin || 10)) {
    state.winner = p.color;
  }
}

export function hiddenVictoryPoints(player: Player): number {
  return (player.devCards || []).filter(c => c.type === 'victory_point' && !c.played).length;
}

// Place a road (during normal play)
export function placeRoad(state: GameState, edgeKey: string): string | null {
  const player = getCurrentPlayer(state);
  const freeRoadBuilding = state.pendingDevAction === 'road_building' && state.pendingDevRoads > 0;
  // Official: build during trade/build. Road Building free roads may be placed
  // immediately after playing the card (including before the roll).
  if (!freeRoadBuilding && state.phase !== 'build' && state.phase !== 'trade') {
    return 'Not build phase';
  }
  if (!freeRoadBuilding && !canAfford(player, BUILDING_COSTS.road)) return 'Cannot afford road';
  if (player.roadsRemaining <= 0) return 'No roads remaining';
  
  const edge = state.edges[edgeKey];
  if (!edge) return 'Invalid edge';
  if (edge.road) return 'Already has a road';
  
  if (!canPlaceRoad(edgeKey, player.color, state.edges, state.intersections)) {
    return 'Must connect to your settlement or road';
  }

  edge.road = player.color;
  player.roadsRemaining--;
  // Road Building card roads are free; otherwise deduct the normal cost.
  if (freeRoadBuilding) {
    state.pendingDevRoads--;
    if (state.pendingDevRoads <= 0) {
      state.pendingDevAction = null;
      state.pendingDevRoads = 0;
    }
  } else {
    deductResources(player, BUILDING_COSTS.road);
  }
  
  // Check longest road
  updateLongestRoad(state);
  
  return null;
}

// Place a settlement (during normal play)
export function placeSettlement(state: GameState, intersectionKey: string): string | null {
  const player = getCurrentPlayer(state);
  if (state.phase !== 'build' && state.phase !== 'trade') return 'Not build phase';
  if (!canAfford(player, BUILDING_COSTS.settlement)) return 'Cannot afford settlement';
  if (player.settlementsRemaining <= 0) return 'No settlements remaining';

  if (!canPlaceSettlement(intersectionKey, state.intersections, state.edges)) {
    return 'Invalid location';
  }

  // Must connect to your road
  const adjacentEdges = getEdgesForIntersection(intersectionKey, state.edges);
  const hasRoad = adjacentEdges.some(e => e.road === player.color);
  if (!hasRoad) return 'Must connect to your road';

  const inter = state.intersections[intersectionKey];
  inter.building = 'settlement';
  inter.owner = player.color;
  player.settlementsRemaining--;
  deductResources(player, BUILDING_COSTS.settlement);
  player.victoryPoints += 1;

  return null;
}

// Upgrade to city
export function placeCity(state: GameState, intersectionKey: string): string | null {
  const player = getCurrentPlayer(state);
  if (state.phase !== 'build' && state.phase !== 'trade') return 'Not build phase';
  if (!canAfford(player, BUILDING_COSTS.city)) return 'Cannot afford city';
  if (player.citiesRemaining <= 0) return 'No cities remaining';

  const inter = state.intersections[intersectionKey];
  if (!inter) return 'Invalid intersection';
  if (inter.building !== 'settlement') return 'Must be a settlement';
  if (inter.owner !== player.color) return 'Not your settlement';

  inter.building = 'city';
  player.citiesRemaining--;
  player.settlementsRemaining++; // city replaces settlement
  deductResources(player, BUILDING_COSTS.city);
  player.victoryPoints += 1; // settlement was 1, city is 2, so +1

  return null;
}

// Buy development card
export function buyDevCard(state: GameState): DevelopmentCard | null {
  const player = getCurrentPlayer(state);
  // Buy only after production (trade/build). Not before the roll.
  if (state.phase !== 'build' && state.phase !== 'trade') return null;
  if (!canAfford(player, BUILDING_COSTS.devCard)) return null;

  // Ensure a real deck exists (legacy states / older saves).
  if (!state.devDeck || state.devDeck.length === 0) {
    if (!state.devDeck) state.devDeck = shuffleDeck(FULL_DEV_DECK);
    if (state.devDeck.length === 0) return null; // deck exhausted
  }

  deductResources(player, BUILDING_COSTS.devCard);

  const type = state.devDeck.pop()!;
  const card: DevelopmentCard = {
    id: nextDevCardId(),
    type,
    played: false,
    boughtThisTurn: true,
  };

  player.devCards.push(card);
  player.boughtDevCardThisTurn = true;

  // Victory point cards stay private but still count toward your score.
  // Never mark them played — they remain in hand until game end.
  if (card.type === 'victory_point') {
    player.victoryPoints += 1;
  }

  return card;
}

function findPlayableDevCard(player: Player, type: DevelopmentCard['type']): DevelopmentCard | undefined {
  // Official: one card per turn; cannot play a card bought this turn;
  // may still play a *different* older card after buying.
  return player.devCards.find(c => c.type === type && !c.played && !c.boughtThisTurn);
}

// Play a knight card
export function playKnight(state: GameState): string | null {
  const player = getCurrentPlayer(state);
  // Official: may play before or after the roll (not during discard/setup).
  if (state.phase !== 'roll' && state.phase !== 'trade' && state.phase !== 'build') {
    return 'Cannot play now';
  }
  if (player.devCardsPlayedThisTurn >= 1) return 'Only one dev card per turn';
  const knight = findPlayableDevCard(player, 'knight');
  if (!knight) return 'No playable knight card';

  knight.played = true;
  player.playedKnights++;
  player.devCardsPlayedThisTurn++;

  // Check largest army
  if (player.playedKnights >= 3 && player.playedKnights > (state.largestArmy.size || 0)) {
    // Remove from previous holder
    if (state.largestArmy.color) {
      const prev = getPlayerByColor(state, state.largestArmy.color);
      prev.victoryPoints -= 2;
    }
    state.largestArmy = { color: player.color, size: player.playedKnights };
    player.victoryPoints += 2;
  }

  // Knight requires moving the robber (even if dice were not a 7).
  state.pendingRobberMove = true;
  state.robberMovedThisTurn = false;

  return null; // success, robber move follows
}

// Play a Road Building card: place 2 free roads. Returns error or null.
export function playRoadBuilding(state: GameState): string | null {
  const player = getCurrentPlayer(state);
  if (state.phase !== 'roll' && state.phase !== 'trade' && state.phase !== 'build') {
    return 'Cannot play now';
  }
  if (player.devCardsPlayedThisTurn >= 1) return 'Only one dev card per turn';
  const card = findPlayableDevCard(player, 'road_building');
  if (!card) return 'No playable Road Building card';
  if (player.roadsRemaining <= 0) return 'No roads remaining';

  card.played = true;
  player.devCardsPlayedThisTurn++;
  // Enter a special build state where the next 2 road placements are free.
  state.pendingDevAction = 'road_building';
  state.pendingDevRoads = Math.min(2, player.roadsRemaining);
  return null;
}

// Play a Year of Plenty card: take any 2 resources from the bank.
export function playYearOfPlenty(state: GameState, res1: ResourceType, res2: ResourceType): string | null {
  const player = getCurrentPlayer(state);
  if (state.phase !== 'roll' && state.phase !== 'trade' && state.phase !== 'build') {
    return 'Cannot play now';
  }
  if (player.devCardsPlayedThisTurn >= 1) return 'Only one dev card per turn';
  const card = findPlayableDevCard(player, 'year_of_plenty');
  if (!card) return 'No playable Year of Plenty card';

  card.played = true;
  player.devCardsPlayedThisTurn++;
  addResources(player, { [res1]: 1, [res2]: 1 });
  return null;
}

// Play a Monopoly card: take all of one resource from all other players.
export function playMonopoly(state: GameState, resource: ResourceType): string | null {
  const player = getCurrentPlayer(state);
  if (state.phase !== 'roll' && state.phase !== 'trade' && state.phase !== 'build') {
    return 'Cannot play now';
  }
  if (player.devCardsPlayedThisTurn >= 1) return 'Only one dev card per turn';
  const card = findPlayableDevCard(player, 'monopoly');
  if (!card) return 'No playable Monopoly card';

  card.played = true;
  player.devCardsPlayedThisTurn++;
  let total = 0;
  for (const other of state.players) {
    if (other.color === player.color) continue;
    const n = other.resources[resource] || 0;
    if (n > 0) {
      other.resources[resource] = 0;
      total += n;
    }
  }
  player.resources[resource] = (player.resources[resource] || 0) + total;
  return null;
}

/** Maritime/bank trade: give multiples of the player's best port rate for one resource, get that many of another. */
export function executeBankTrade(
  state: GameState,
  giveRes: ResourceType,
  giveAmt: number,
  wantRes: ResourceType,
): string | null {
  const player = getCurrentPlayer(state);
  if (state.phase !== 'trade' && state.phase !== 'build') return 'Not trade phase';
  if (giveRes === wantRes) return 'Must trade for a different resource';
  if (giveAmt <= 0) return 'Invalid amount';
  const rate = getPortRate(player.color, giveRes, state.ports, state.intersections);
  if (giveAmt < rate || giveAmt % rate !== 0) return `Must give multiples of ${rate}`;
  if ((player.resources[giveRes] || 0) < giveAmt) return 'Not enough resources';
  const received = Math.floor(giveAmt / rate);
  player.resources[giveRes] -= giveAmt;
  player.resources[wantRes] = (player.resources[wantRes] || 0) + received;
  return null;
}

// End turn
export function endTurn(state: GameState): void {
  // Reset per-turn dev card flags for the player who just finished.
  const ending = getCurrentPlayer(state);
  ending.devCardsPlayedThisTurn = 0;
  ending.boughtDevCardThisTurn = false;
  for (const c of ending.devCards) {
    c.boughtThisTurn = false;
  }
  state.pendingDevAction = null;
  state.pendingDevRoads = 0;
  state.tradeOffers = [];
  state.dice = null;
  state.robberMovedThisTurn = false;
  state.pendingRobberMove = false;

  checkVictory(state);
  if (state.winner) {
    state.phase = 'build';
    return;
  }

  state.currentTurn = (state.currentTurn + 1) % state.players.length;
  state.phase = 'roll';
}

// Setup phase advancement
export function advanceSetup(state: GameState): void {
  state.setupRound++;
  
  const totalSetupActions = state.players.length * 4; // 2 settlements + 2 roads per player
  
  if (state.setupRound >= totalSetupActions) {
    state.setupPhase = false;
    state.phase = 'roll';
    state.currentTurn = 0;
    state.lastSetupSettlement = undefined;
    return;
  }

  // Determine whose turn and what phase
  const playerIndex = Math.floor(state.setupRound / 2) % state.players.length;
  const actionInRound = state.setupRound % 2;
  
  // Reverse order for second settlement
  if (state.setupRound >= state.players.length * 2) {
    const reversedIndex = state.players.length - 1 - (Math.floor((state.setupRound - state.players.length * 2) / 2) % state.players.length);
    state.currentTurn = reversedIndex;
  } else {
    state.currentTurn = playerIndex;
  }

  state.phase = actionInRound === 0 ? 'setup_settlement' : 'setup_road';
}

// Calculate longest road for a player
export function calculateLongestRoad(player: PlayerColor, edges: Record<string, Edge>): number {
  // BFS from each road endpoint
  const playerEdges = Object.values(edges).filter(e => e.road === player);
  if (playerEdges.length < 5) return 0;

  let maxLength = 0;
  
  // Build adjacency map for player's roads
  const roadGraph: Record<string, string[]> = {};
  playerEdges.forEach(e => {
    if (!roadGraph[e.from]) roadGraph[e.from] = [];
    if (!roadGraph[e.to]) roadGraph[e.to] = [];
    roadGraph[e.from].push(e.to);
    roadGraph[e.to].push(e.from);
  });

  // DFS from each endpoint
  for (const start of Object.keys(roadGraph)) {
    const visited = new Set<string>();
    const stack: { node: string; length: number }[] = [{ node: start, length: 0 }];
    
    while (stack.length > 0) {
      const { node, length } = stack.pop()!;
      if (visited.has(node)) continue;
      visited.add(node);
      maxLength = Math.max(maxLength, length);
      
      for (const next of (roadGraph[node] || [])) {
        if (!visited.has(next)) {
          stack.push({ node: next, length: length + 1 });
        }
      }
    }
  }

  return maxLength;
}

function updateLongestRoad(state: GameState): void {
  let maxLength = 0;
  let maxColor: PlayerColor | undefined;
  let tie = false;
  
  for (const player of state.players) {
    const length = calculateLongestRoad(player.color, state.edges);
    if (length >= 5) {
      if (length > maxLength) {
        maxLength = length;
        maxColor = player.color;
        tie = false;
      } else if (length === maxLength) {
        // Official rule: a tie for longest road means nobody holds it.
        tie = true;
      }
    }
  }
  // If there's a tie at the max length, nobody gets the bonus.
  if (tie) maxColor = undefined;

  // Remove old longest road bonus
  if (state.longestRoad.color && state.longestRoad.color !== maxColor) {
    const prev = getPlayerByColor(state, state.longestRoad.color);
    prev.victoryPoints -= 2;
  }

  // Add new longest road bonus
  if (maxColor && maxColor !== state.longestRoad.color) {
    const current = getPlayerByColor(state, maxColor);
    current.victoryPoints += 2;
  }

  state.longestRoad = { color: maxColor, length: maxLength };
}

// Get hexes adjacent to an intersection (the 2-3 hexes that share this corner)
function getAdjacentHexes(intersectionKey: string, board: HexTile[]): HexTile[] {
  // A corner key is canonical (integer). Find all board hexes that contain
  // this corner among their 6 corners.
  return board.filter(tile => getHexCorners(tile.q, tile.r).includes(intersectionKey));
}

function pipDots(n?: number): number {
  if (!n || n === 7) return 0;
  return Math.max(0, 6 - Math.abs(7 - n));
}

const AI_TYPE_W: Record<string, number> = {
  brick: 1.45, ore: 1.4, lumber: 1.25, grain: 1.25, wool: 0.85,
};

function producedTypes(state: GameState, color: PlayerColor): Set<string> {
  const have = new Set<string>();
  for (const inter of Object.values(state.intersections)) {
    if (inter.owner !== color || !inter.building) continue;
    for (const h of getAdjacentHexes(inter.key, state.board)) {
      if (h.type !== 'desert' && h.type !== 'water') have.add(h.type);
    }
  }
  return have;
}

function portAt(state: GameState, key: string): number {
  for (const port of state.ports) {
    const spots = port.coastalIntersections || [];
    if (spots.includes(key)) return port.type === '3:1' ? 2.4 : 4.2;
  }
  return 0;
}

function scoreSpot(state: GameState, key: string, color: PlayerColor, secondSetup: boolean): number {
  const hexes = getAdjacentHexes(key, state.board);
  let pips = 0;
  const types = new Set<string>();
  let hot = 0;
  let land = 0;
  for (const h of hexes) {
    if (h.type === 'desert' || h.type === 'water') continue;
    land++;
    const d = pipDots(h.number);
    pips += d * (AI_TYPE_W[h.type] || 1);
    types.add(h.type);
    if (h.number === 6 || h.number === 8) hot++;
  }
  let score = pips * 3.2 + types.size * 2.8 + hot * 2.2 + land * 0.6 + portAt(state, key);
  if (secondSetup) {
    const have = producedTypes(state, color);
    for (const t of types) {
      if (!have.has(t)) score += 3.8;
    }
  }
  return score;
}

function pickFromRanked<T>(ranked: T[], level: Player['aiLevel']): T {
  if (ranked.length === 1) return ranked[0];
  if (level === 'hard') return ranked[0];
  if (level === 'easy') {
    const slice = ranked.slice(0, Math.max(2, Math.ceil(ranked.length * 0.5)));
    return slice[Math.floor(Math.random() * slice.length)];
  }
  const n = Math.min(3, ranked.length);
  return ranked[Math.floor(Math.random() * n)];
}

function settlementCandidates(state: GameState, color: PlayerColor) {
  return Object.values(state.intersections).filter(i => {
    if (i.building) return false;
    if (!canPlaceSettlement(i.key, state.intersections, state.edges)) return false;
    const adj = getEdgesForIntersection(i.key, state.edges);
    return adj.some(e => e.road === color);
  });
}

function cityCandidates(state: GameState, color: PlayerColor) {
  return Object.values(state.intersections).filter(
    i => i.building === 'settlement' && i.owner === color,
  );
}

function roadCandidates(state: GameState, color: PlayerColor) {
  return Object.values(state.edges).filter(
    e => !e.road && canPlaceRoad(e.key, color, state.edges, state.intersections),
  );
}

function scoreRoad(state: GameState, edge: Edge, color: PlayerColor): number {
  let score = 1;
  for (const end of [edge.from, edge.to]) {
    const inter = state.intersections[end];
    if (!inter) continue;
    if (!inter.building && canPlaceSettlement(end, state.intersections, state.edges)) {
      const connected = getEdgesForIntersection(end, state.edges).some(e => e.road === color);
      if (!connected) score += 12 + scoreSpot(state, end, color, false);
    }
    const adj = getAdjacentIntersections(end, state.edges);
    for (const n of adj) {
      const ni = state.intersections[n];
      if (ni && !ni.building && canPlaceSettlement(n, state.intersections, state.edges)) {
        score += 2 + scoreSpot(state, n, color, false) * 0.15;
      }
    }
  }
  const myLen = calculateLongestRoad(color, { ...state.edges, [edge.key]: { ...edge, road: color } });
  const held = state.longestRoad.length || 0;
  if (myLen >= 5 && myLen > held) score += 18;
  else if (state.longestRoad.color && state.longestRoad.color !== color && myLen >= held - 1) score += 8;
  return score;
}

function handTotal(p: Player): number {
  return RESOURCES.reduce((s, r) => s + (p.resources[r] || 0), 0);
}

function neededFor(player: Player, cost: Partial<Record<ResourceType, number>>): ResourceType[] {
  const miss: ResourceType[] = [];
  for (const r of RESOURCES) {
    const need = cost[r] || 0;
    const have = player.resources[r] || 0;
    for (let i = 0; i < Math.max(0, need - have); i++) miss.push(r);
  }
  return miss;
}

function tryBankFor(state: GameState, player: Player, want: ResourceType): { action: string; data?: any } | null {
  const rateGive = (r: ResourceType) => getPortRate(player.color, r, state.ports, state.intersections);
  let best: ResourceType | null = null;
  let bestSpare = -1;
  for (const r of RESOURCES) {
    if (r === want) continue;
    const rate = rateGive(r);
    const have = player.resources[r] || 0;
    if (have < rate) continue;
    const spare = have - rate;
    if (spare > bestSpare) {
      bestSpare = spare;
      best = r;
    }
  }
  if (!best) return null;
  const rate = rateGive(best);
  return { action: 'bank_trade', data: { give: best, get: want, amount: rate } };
}

function aiMoveRobber(state: GameState, player: Player): { action: string; data?: any } | null {
  const traits: TraitWeights = getTraits(player.personalityId, loadStats()[player.personalityId || '']?.learned);
  const best = pickRobberHex(state, player.color, traits.aggression);
  if (!best) {
    state.robberMovedThisTurn = true;
    state.pendingRobberMove = false;
    return null;
  }
  moveRobber(state, best.q, best.r);
  const targets = getStealTargets(state, best.q, best.r);
  let stoleFrom: PlayerColor | undefined;
  let stolen: ResourceType | undefined;
  if (targets.length > 0) {
    const ranked = [...targets].sort((a, b) => {
      const pa = getPlayerByColor(state, a);
      const pb = getPlayerByColor(state, b);
      const vp = (pb?.victoryPoints || 0) - (pa?.victoryPoints || 0);
      if (vp) return vp;
      return handTotal(pb!) - handTotal(pa!);
    });
    const target = player.aiLevel === 'easy'
      ? targets[Math.floor(Math.random() * targets.length)]
      : ranked[0];
    const out: { resource?: ResourceType } = {};
    if (!stealFrom(state, target, out)) {
      stoleFrom = target;
      stolen = out.resource;
    }
  }
  return { action: 'move_robber', data: { q: best.q, r: best.r, stoleFrom, resource: stolen } };
}

function robberOnMe(state: GameState, color: PlayerColor): boolean {
  const [q, r] = (state.robberHex || '').split(',').map(Number);
  return getHexCorners(q, r).some(k => state.intersections[k]?.owner === color);
}

export function aiTurn(state: GameState): { action: string; data?: any } | null {
  const player = getCurrentPlayer(state);
  if (!player.isAI) return null;
  const level = player.aiLevel || 'normal';
  // Personality traits for this AI (base + learned deltas from local games).
  const traits: TraitWeights = getTraits(player.personalityId, loadStats()[player.personalityId || '']?.learned);

  // Turn-order roll — AI rolls and advances to setup automatically
  if (state.phase === 'turn_order') {
    rollTurnOrder(state);
    state.phase = 'setup_settlement';
    state.setupRound = 0;
    return { action: 'roll_turn_order' };
  }

  if (state.setupPhase) {
    if (state.phase === 'setup_settlement') {
      const second = state.setupRound >= state.players.length * 2;
      const candidates: { key: string; score: number }[] = [];
      for (const inter of Object.values(state.intersections)) {
        if (inter.building) continue;
        const adjacent = getAdjacentIntersections(inter.key, state.edges);
        if (adjacent.some(a => state.intersections[a]?.building)) continue;
        candidates.push({ key: inter.key, score: scoreSpot(state, inter.key, player.color, second) });
      }
      if (candidates.length === 0) return null;
      candidates.sort((a, b) => b.score - a.score);
      // Risk trait: gamblers take the single best spot; cautious AIs pick from
      // a wider pool (they hedge). aiLevel still caps it.
      if (level === 'hard' && traits.risk > 0.6) {
        return { action: 'place_settlement', data: { key: candidates[0].key } };
      }
      const pick = pickFromRanked(candidates, level);
      return { action: 'place_settlement', data: { key: pick.key } };
    }
    if (state.phase === 'setup_road') {
      const mySettlements = Object.values(state.intersections)
        .filter(i => i.owner === player.color && i.building);
      const roadCountAt = (key: string) =>
        Object.values(state.edges).filter(
          e => e.road === player.color && (e.from === key || e.to === key),
        ).length;
      const ordered = [...mySettlements].sort((a, b) => roadCountAt(a.key) - roadCountAt(b.key));
      const fresh = ordered[0];
      if (fresh) {
        const edges = Object.values(state.edges).filter(
          e => !e.road && (e.from === fresh.key || e.to === fresh.key),
        );
        if (edges.length > 0) {
          const ranked = edges
            .map(e => ({ key: e.key, score: scoreRoad(state, e, player.color) }))
            .sort((a, b) => b.score - a.score);
          const pick = pickFromRanked(ranked, level);
          return { action: 'place_road', data: { key: pick.key } };
        }
      }
      const anyEdge = Object.values(state.edges).find(
        e => !e.road && mySettlements.some(s => s.key === e.from || s.key === e.to),
      );
      if (anyEdge) return { action: 'place_road', data: { key: anyEdge.key } };
      return null;
    }
    return null;
  }

  if (state.phase === 'roll') {
    if (level !== 'easy' && player.devCardsPlayedThisTurn < 1 && robberOnMe(state, player.color)) {
      if (findPlayableDevCard(player, 'knight')) {
        const err = playKnight(state);
        if (err === null) return { action: 'play_knight' };
      }
    }
    return { action: 'roll_dice' };
  }

  const incoming = state.tradeOffers.find(o =>
    o.from !== player.color
    && (o.to === undefined || o.to === player.color)
    && !(o.rejectedBy || []).includes(player.color)
    && !(o.acceptedBy || []).includes(player.color),
  );
  if (incoming) {
    const giveTotal = Object.values(incoming.give || {}).reduce((s, n) => s + (Number(n) || 0), 0);
    const wantTotal = Object.values(incoming.want || {}).reduce((s, n) => s + (Number(n) || 0), 0);
    let canPay = true;
    for (const [r, n] of Object.entries(incoming.want || {})) {
      if ((player.resources[r as ResourceType] || 0) < (Number(n) || 0)) canPay = false;
    }
    const fromP = getPlayerByColor(state, incoming.from);
    const leader = [...state.players].sort((a, b) => (b.victoryPoints || 0) - (a.victoryPoints || 0))[0];
    const helpingLeader = !!(fromP && leader && fromP.color === leader.color && fromP.color !== player.color && (leader.victoryPoints || 0) >= 7);
    const surplus = RESOURCES.filter(r => (player.resources[r] || 0) >= 3);
    const scarce = RESOURCES.filter(r => (player.resources[r] || 0) <= 1);
    const givesSurplus = Object.keys(incoming.want || {}).every(r => surplus.includes(r as ResourceType));
    const getsScarce = Object.keys(incoming.give || {}).some(r => scarce.includes(r as ResourceType));
    const evenOrBetter = wantTotal <= giveTotal;
    const favorable = canPay && !helpingLeader && (evenOrBetter || (givesSurplus && getsScarce));
    // Trading trait: merchants accept borderline deals; hermits hold out.
    const tradeBias = traits.trading - 0.5; // -0.5..0.5
    const accept = favorable || (tradeBias > 0 && Math.random() < tradeBias * 0.6);
    respondToTrade(state, player.color, incoming.from, accept);
    return { action: accept ? 'accept_trade' : 'reject_trade', data: { from: incoming.from } };
  }

  const myTable = state.tradeOffers.find(o => o.from === player.color && o.to === undefined);
  if (myTable && (myTable.acceptedBy || []).length > 0) {
    const partner = myTable.acceptedBy![0];
    const err = completeTradeWith(state, partner);
    if (err === null) return { action: 'complete_trade', data: { partner } };
  }

  if (state.phase === 'discard') {
    if (state.discardQueue.includes(player.color)) {
      const total = handTotal(player);
      let remaining = Math.floor(total / 2);
      const keep: Record<ResourceType, number> = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
      const cityNeed = neededFor(player, BUILDING_COSTS.city);
      const settNeed = neededFor(player, BUILDING_COSTS.settlement);
      const goal = cityNeed.length <= settNeed.length ? BUILDING_COSTS.city : BUILDING_COSTS.settlement;
      for (const r of RESOURCES) keep[r] = Math.min(player.resources[r] || 0, goal[r] || 0);
      const toDiscard: Partial<Record<ResourceType, number>> = {};
      const dumpOrder = [...RESOURCES].sort((a, b) => {
        const extraA = (player.resources[a] || 0) - keep[a];
        const extraB = (player.resources[b] || 0) - keep[b];
        return extraB - extraA;
      });
      for (const r of dumpOrder) {
        if (remaining <= 0) break;
        const extra = Math.max(0, (player.resources[r] || 0) - keep[r]);
        const take = Math.min(extra, remaining);
        if (take > 0) { toDiscard[r] = (toDiscard[r] || 0) + take; remaining -= take; }
      }
      if (remaining > 0) {
        for (const r of RESOURCES) {
          if (remaining <= 0) break;
          const left = (player.resources[r] || 0) - (toDiscard[r] || 0);
          const take = Math.min(left, remaining);
          if (take > 0) { toDiscard[r] = (toDiscard[r] || 0) + take; remaining -= take; }
        }
      }
      discardResources(state, player.color, toDiscard);
      return { action: 'discard', data: { discard: toDiscard } };
    }
    return null;
  }
  if (state.pendingRobberMove && !state.robberMovedThisTurn) {
    const moved = aiMoveRobber(state, player);
    if (moved) return moved;
  }

  const canPlayDev = player.devCardsPlayedThisTurn < 1
    && (state.phase === 'trade' || state.phase === 'build');

  if (canPlayDev && level !== 'easy') {
    const yop = findPlayableDevCard(player, 'year_of_plenty');
    if (yop) {
      const cityMiss = neededFor(player, BUILDING_COSTS.city);
      const settMiss = neededFor(player, BUILDING_COSTS.settlement);
      const miss = (cityMiss.length > 0 && cityMiss.length <= 2) ? cityMiss
        : (settMiss.length > 0 && settMiss.length <= 2) ? settMiss
        : cityMiss.length ? cityMiss : settMiss;
      if (miss.length > 0) {
        const r1 = miss[0];
        const r2 = miss[1] || miss[0];
        const err = playYearOfPlenty(state, r1, r2);
        if (err === null) return { action: 'play_year_of_plenty', data: { res1: r1, res2: r2 } };
      }
    }

    const mono = findPlayableDevCard(player, 'monopoly');
    if (mono) {
      let best: ResourceType | null = null;
      let bestN = 2;
      for (const r of RESOURCES) {
        let n = 0;
        for (const o of state.players) {
          if (o.color === player.color) continue;
          n += o.resources[r] || 0;
        }
        if (n > bestN) { bestN = n; best = r; }
      }
      if (best && bestN >= (level === 'hard' ? 3 : 4)) {
        const err = playMonopoly(state, best);
        if (err === null) return { action: 'play_monopoly', data: { resource: best } };
      }
    }

    const rb = findPlayableDevCard(player, 'road_building');
    if (rb && player.roadsRemaining > 0) {
      const roads = roadCandidates(state, player.color);
      const wouldSettle = roads.some(e => scoreRoad(state, e, player.color) >= 12);
      const myLen = calculateLongestRoad(player.color, state.edges);
      const stealRoad = myLen >= 3 && (state.longestRoad.color !== player.color);
      if (wouldSettle || stealRoad) {
        const err = playRoadBuilding(state);
        if (err === null) return { action: 'play_road_building' };
      }
    }

    const knight = findPlayableDevCard(player, 'knight');
    if (knight) {
      const leader = [...state.players].sort((a, b) => (b.victoryPoints || 0) - (a.victoryPoints || 0))[0];
      const chaseArmy = player.playedKnights >= 2
        || (player.playedKnights >= 1 && (state.largestArmy.size || 0) <= 3);
      const blockLeader = leader && leader.color !== player.color && (leader.victoryPoints || 0) >= 6;
      // Warlords + gamblers play knights more eagerly (they swing and press).
      const eager = traits.aggression + traits.devCards > 1.1;
      if (robberOnMe(state, player.color) || chaseArmy || blockLeader || level === 'hard' || eager) {
        const err = playKnight(state);
        if (err === null) return { action: 'play_knight' };
      }
    }
  }

  if (state.phase === 'trade') {
    state.phase = 'build';
    return { action: 'skip_trade' };
  }

  if (state.phase === 'build') {
    if (state.pendingDevAction === 'road_building' && state.pendingDevRoads > 0) {
      const freeSpots = roadCandidates(state, player.color)
        .map(e => ({ key: e.key, score: scoreRoad(state, e, player.color) }))
        .sort((a, b) => b.score - a.score);
      if (player.roadsRemaining > 0 && freeSpots.length > 0) {
        return { action: 'place_road', data: { key: freeSpots[0].key } };
      }
      state.pendingDevAction = null;
      state.pendingDevRoads = 0;
    }

    // Build priority is personality-driven. Expansionists push settlements +
    // roads; city-lovers upgrade; dev-card lovers buy cards; gamblers swing.
    // Score each option by traits, then build in that order.
    const cities = cityCandidates(state, player.color)
      .map(i => ({ key: i.key, score: scoreSpot(state, i.key, player.color, false) }))
      .sort((a, b) => b.score - a.score);
    const setts = settlementCandidates(state, player.color)
      .map(i => ({ key: i.key, score: scoreSpot(state, i.key, player.color, false) }))
      .sort((a, b) => b.score - a.score);
    const roads = roadCandidates(state, player.color)
      .map(e => ({ key: e.key, score: scoreRoad(state, e, player.color) }))
      .sort((a, b) => b.score - a.score);
    const deckLeft = (state.devDeck || []).length;

    const canCity = player.citiesRemaining > 0 && cities.length > 0 && canAfford(player, BUILDING_COSTS.city);
    const canSett = player.settlementsRemaining > 0 && setts.length > 0 && canAfford(player, BUILDING_COSTS.settlement);
    const canRoad = player.roadsRemaining > 0 && roads.length > 0 && canAfford(player, BUILDING_COSTS.road);
    const canDev = level !== 'easy' && deckLeft > 0 && canAfford(player, BUILDING_COSTS.devCard);

    // Score each option by personality traits.
    const wantCity = canCity ? (1 - traits.expansion) * 1.2 + traits.risk * 0.3 : 0;
    const wantSett = canSett ? traits.expansion * 1.2 + traits.risk * 0.2 : 0;
    const wantDev = canDev ? traits.devCards * 1.2 + traits.risk * 0.3 : 0;
    const wantRoad = canRoad ? traits.expansion * 0.8 : 0;

    const choices: { score: number; act: () => { action: string; data?: any } }[] = [];
    if (wantCity > 0) choices.push({ score: wantCity, act: () => ({ action: 'place_city', data: { key: pickFromRanked(cities, level).key } }) });
    if (wantSett > 0) choices.push({ score: wantSett, act: () => ({ action: 'place_settlement', data: { key: pickFromRanked(setts, level).key } }) });
    if (wantDev > 0) choices.push({ score: wantDev, act: () => ({ action: 'buy_dev_card' }) });
    if (wantRoad > 0) choices.push({ score: wantRoad, act: () => ({ action: 'place_road', data: { key: pickFromRanked(roads, level).key } }) });

    if (choices.length > 0) {
      // Weighted pick: higher score = more likely, so personalities genuinely
      // diverge instead of always following one fixed priority.
      const total = choices.reduce((s, c) => s + c.score, 0);
      let roll = Math.random() * total;
      for (const c of choices) {
        roll -= c.score;
        if (roll <= 0) return c.act();
      }
      return choices[choices.length - 1].act();
    }

    // Nothing affordable yet — try a targeted bank trade for a missing resource,
    // else buy a dev card as a fallback, else end turn.
    const blocked = setts.length === 0 && (player.citiesRemaining === 0 || cities.length === 0);
    const wantArmy = player.playedKnights >= 1 && player.playedKnights < 3;
    if (level !== 'easy' && deckLeft > 0 && canAfford(player, BUILDING_COSTS.devCard)
      && (blocked || wantArmy || traits.devCards > 0.6)) {
      return { action: 'buy_dev_card' };
    }

    for (const r of RESOURCES) {
      if ((player.resources[r] || 0) > 0) continue;
      const bank = tryBankFor(state, player, r);
      if (bank) return bank;
    }

    return { action: 'end_turn' };
  }

  return null;
}

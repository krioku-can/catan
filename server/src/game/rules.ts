// Core game rules and state management

import type { GameState, GameConfig, Player, PlayerColor, ResourceType, DevelopmentCard, HexTile, Edge } from './types.js';
import { generateBoard, canPlaceSettlement, canPlaceRoad, getResourceProduction, getAdjacentIntersections, getEdgesForIntersection, getHexCorners } from './board.js';

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

export function createInitialState(config: GameConfig): GameState {
  const { tiles, ports, intersections, edges } = generateBoard();
  
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
      devCardsPlayedThisTurn: 0,
      boughtDevCardThisTurn: false,
    });
  }

  const robberTile = tiles.find(t => t.hasRobber)!;

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
    longestRoad: { length: 0 },
    largestArmy: { size: 0 },
    tradeOffers: [],
    setupPhase: true,
    setupRound: 0,
    discardQueue: [],
    pendingDevAction: null,
    pendingDevRoads: 0,
  };
}

export function getCurrentPlayer(state: GameState): Player {
  const color = state.turnOrder[state.currentTurn];
  return state.players.find(p => p.color === color)!;
}

export function getPlayerByColor(state: GameState, color: PlayerColor): Player {
  return state.players.find(p => p.color === color)!;
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
  
  // During setup, no distance rule for first settlement
  if (state.setupRound > 0) {
    // Second settlement: check distance from first
    const adjacent = getAdjacentIntersections(intersectionKey, state.edges);
    for (const adjKey of adjacent) {
      const adj = state.intersections[adjKey];
      if (adj?.building) return 'Too close to another settlement';
    }
  }

  inter.building = 'settlement';
  inter.owner = player.color;
  player.settlementsRemaining--;
  player.victoryPoints += 1;

  // Both starting settlements provide resources: give 1 of each resource type
  // from every adjacent non-desert/non-water hex on EACH setup settlement
  // (the first and the second).
  const hexes = getAdjacentHexes(intersectionKey, state.board);
  hexes.forEach(hex => {
    if (hex.type !== 'desert' && hex.type !== 'water') {
      addResources(player, { [hex.type]: 1 });
    }
  });

  return null; // success
}

// Place a road during setup
export function placeSetupRoad(state: GameState, edgeKey: string): string | null {
  const player = getCurrentPlayer(state);
  const edge = state.edges[edgeKey];
  if (!edge) return 'Invalid edge';
  if (edge.road) return 'Already has a road';

  // Must connect to the settlement just placed
  const inter = state.intersections[edge.from];
  const inter2 = state.intersections[edge.to];
  if (inter?.owner !== player.color && inter2?.owner !== player.color) {
    return 'Must connect to your settlement';
  }

  edge.road = player.color;
  player.roadsRemaining--;
  return null;
}

// Roll for starting turn order. Each player rolls 2 dice; the player with the
// highest total goes first, then descending. Returns an ordered array of the
// resulting player colors plus their individual roll totals.
export function rollTurnOrder(state: GameState): { order: PlayerColor[]; rolls: Record<string, number> } {
  const players = state.players;
  const rolls: Record<string, number> = {};
  players.forEach(p => {
    rolls[p.color] = Math.floor(Math.random() * 6) + 1 + (Math.floor(Math.random() * 6) + 1);
  });
  // Sort descending by roll; ties broken by player index (stable-ish)
  const ordered = [...players].sort((a, b) => {
    const diff = (rolls[b.color] || 0) - (rolls[a.color] || 0);
    if (diff !== 0) return diff;
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

  // Steal a random resource from a player with settlements on this hex
  if (stealFrom) {
    const target = getPlayerByColor(state, stealFrom);
    const hasResources = RESOURCES.some((r: ResourceType) => (target.resources[r] || 0) > 0);
    if (hasResources) {
      const available = RESOURCES.filter((r: ResourceType) => (target.resources[r] || 0) > 0);
      const stolen = available[Math.floor(Math.random() * available.length)];
      target.resources[stolen]--;
      getCurrentPlayer(state).resources[stolen]++;
    }
  }

  return null;
}

// Place a road (during normal play)
export function placeRoad(state: GameState, edgeKey: string): string | null {
  const player = getCurrentPlayer(state);
  // Official rule: you may build at any point during your turn, including the
  // trade phase. So accept both 'trade' and 'build'.
  if (state.phase !== 'build' && state.phase !== 'trade') return 'Not build phase';
  if (!canAfford(player, BUILDING_COSTS.road)) return 'Cannot afford road';
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
  if (state.pendingDevAction === 'road_building') {
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
  if (state.phase !== 'build' && state.phase !== 'trade') return null;
  if (!canAfford(player, BUILDING_COSTS.devCard)) return null;

  deductResources(player, BUILDING_COSTS.devCard);

  const types: DevelopmentCard['type'][] = ['knight', 'knight', 'knight', 'knight', 'knight',
    'knight', 'knight', 'knight', 'knight', 'knight',
    'knight', 'knight', 'knight', 'knight',
    'victory_point', 'victory_point', 'victory_point', 'victory_point', 'victory_point',
    'road_building', 'road_building',
    'year_of_plenty', 'year_of_plenty',
    'monopoly', 'monopoly',
  ];
  
  const card: DevelopmentCard = {
    type: types[Math.floor(Math.random() * types.length)],
    played: false,
  };

  player.devCards.push(card);
  // Official rule: a dev card bought this turn cannot be played until the next turn.
  player.boughtDevCardThisTurn = true;
  
  // Victory point cards are auto-played
  if (card.type === 'victory_point') {
    card.played = true;
    player.victoryPoints += 1;
  }

  return card;
}

// Play a knight card
export function playKnight(state: GameState): string | null {
  const player = getCurrentPlayer(state);
  // Official rule: only one dev card may be played per turn.
  if (player.devCardsPlayedThisTurn >= 1) return 'Only one dev card per turn';
  // Official rule: a card bought this turn cannot be played until the next turn.
  if (player.boughtDevCardThisTurn) return 'Cannot play a card you just bought';
  const knight = player.devCards.find(c => c.type === 'knight' && !c.played);
  if (!knight) return 'No unplayed knight card';

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

  return null; // success, robber move follows
}

// Play a Road Building card: place 2 free roads. Returns error or null.
export function playRoadBuilding(state: GameState): string | null {
  const player = getCurrentPlayer(state);
  if (player.devCardsPlayedThisTurn >= 1) return 'Only one dev card per turn';
  if (player.boughtDevCardThisTurn) return 'Cannot play a card you just bought';
  const card = player.devCards.find(c => c.type === 'road_building' && !c.played);
  if (!card) return 'No unplayed Road Building card';
  if (player.roadsRemaining <= 0) return 'No roads remaining';

  card.played = true;
  player.devCardsPlayedThisTurn++;
  // Enter a special build state where the next 2 road placements are free.
  state.pendingDevAction = 'road_building';
  state.pendingDevRoads = 2;
  return null;
}

// Play a Year of Plenty card: take any 2 resources from the bank.
export function playYearOfPlenty(state: GameState, res1: ResourceType, res2: ResourceType): string | null {
  const player = getCurrentPlayer(state);
  if (player.devCardsPlayedThisTurn >= 1) return 'Only one dev card per turn';
  if (player.boughtDevCardThisTurn) return 'Cannot play a card you just bought';
  const card = player.devCards.find(c => c.type === 'year_of_plenty' && !c.played);
  if (!card) return 'No unplayed Year of Plenty card';

  card.played = true;
  player.devCardsPlayedThisTurn++;
  addResources(player, { [res1]: 1, [res2]: 1 });
  return null;
}

// Play a Monopoly card: take all of one resource from all other players.
export function playMonopoly(state: GameState, resource: ResourceType): string | null {
  const player = getCurrentPlayer(state);
  if (player.devCardsPlayedThisTurn >= 1) return 'Only one dev card per turn';
  if (player.boughtDevCardThisTurn) return 'Cannot play a card you just bought';
  const card = player.devCards.find(c => c.type === 'monopoly' && !c.played);
  if (!card) return 'No unplayed Monopoly card';

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

// End turn
export function endTurn(state: GameState): void {
  // Reset per-turn dev card flags for the player who just finished.
  const ending = getCurrentPlayer(state);
  ending.devCardsPlayedThisTurn = 0;
  ending.boughtDevCardThisTurn = false;
  state.pendingDevAction = null;
  state.pendingDevRoads = 0;

  state.currentTurn = (state.currentTurn + 1) % state.players.length;
  state.phase = 'roll';
  state.dice = null;
  state.tradeOffers = [];

  // Check for winner
  const current = getCurrentPlayer(state);
  if (current.victoryPoints >= 10) {
    state.winner = current.color;
    state.phase = 'build'; // keep in build phase, game over
  }
}

// Setup phase advancement
export function advanceSetup(state: GameState): void {
  state.setupRound++;
  
  const totalSetupActions = state.players.length * 4; // 2 settlements + 2 roads per player
  
  if (state.setupRound >= totalSetupActions) {
    state.setupPhase = false;
    state.phase = 'roll';
    state.currentTurn = 0;
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
function calculateLongestRoad(player: PlayerColor, edges: Record<string, Edge>): number {
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

// Simple AI: make a random valid move
export function aiTurn(state: GameState): { action: string; data?: any } | null {
  const player = getCurrentPlayer(state);
  if (!player.isAI) return null;

  // Turn-order roll — AI rolls and advances to setup automatically
  if (state.phase === 'turn_order') {
    rollTurnOrder(state);
    state.phase = 'setup_settlement';
    state.setupRound = 0;
    return { action: 'roll_turn_order' };
  }

  // During setup
  if (state.setupPhase) {
    if (state.phase === 'setup_settlement') {
      // Score each free corner by the resource value of adjacent hexes.
      // Brick & ore are the bottlenecks (brick for road/settlement, ore for
      // city/devcard) so weight them highest. This stops the AI from placing
      // both settlements on spots with zero brick/ore, which deadlocked games.
      const candidates: { key: string; score: number }[] = [];
      Object.values(state.intersections).forEach(inter => {
        if (inter.building) return;
        // On the 2nd+ setup settlement, respect the distance rule
        if (state.setupRound > 0) {
          const adjacent = getAdjacentIntersections(inter.key, state.edges);
          if (adjacent.some(a => state.intersections[a]?.building)) return;
        }
        const hexes = getAdjacentHexes(inter.key, state.board);
        let score = 0;
        hexes.forEach(h => {
          if (h.type === 'desert' || h.type === 'water') return;
          const w = h.type === 'brick' ? 3 : h.type === 'ore' ? 3 : 1;
          score += w;
        });
        candidates.push({ key: inter.key, score });
      });

      if (candidates.length > 0) {
        // Weighted random among top-scoring candidates (pick randomly from the
        // top 30% by score so it's varied but still resource-aware).
        candidates.sort((a, b) => b.score - a.score);
        const topCount = Math.max(1, Math.ceil(candidates.length * 0.3));
        const top = candidates.slice(0, topCount);
        const pick = top[Math.floor(Math.random() * top.length)];
        return { action: 'place_settlement', data: { key: pick.key } };
      }
    }
    if (state.phase === 'setup_road') {
      // The road MUST connect to the settlement the AI just placed. Pick an
      // empty edge adjacent to one of the AI's own settlements.
      const myKeys = new Set(
        Object.values(state.intersections)
          .filter(i => i.owner === player.color && i.building === 'settlement')
          .map(i => i.key)
      );
      const validEdges = Object.values(state.edges)
        .filter(e => !e.road && (myKeys.has(e.from) || myKeys.has(e.to)))
        .map(e => e.key);

      if (validEdges.length > 0) {
        const pick = validEdges[Math.floor(Math.random() * validEdges.length)];
        return { action: 'place_road', data: { key: pick } };
      }
    }
    return { action: 'advance_setup' };
  }

  // Normal play
  if (state.phase === 'roll') {
    return { action: 'roll_dice' };
  }

  // Discard phase after a 7: AI discards half its hand automatically.
  if (state.phase === 'discard') {
    if (state.discardQueue.includes(player.color)) {
      const total = RESOURCES.reduce((s, r) => s + (player.resources[r] || 0), 0);
      const mustDiscard = Math.floor(total / 2);
      const toDiscard: Partial<Record<ResourceType, number>> = {};
      let remaining = mustDiscard;
      // Discard from the most abundant resources first.
      const sorted = [...RESOURCES].sort((a, b) => (player.resources[b] || 0) - (player.resources[a] || 0));
      for (const r of sorted) {
        if (remaining <= 0) break;
        const take = Math.min(player.resources[r] || 0, remaining);
        if (take > 0) { toDiscard[r] = take; remaining -= take; }
      }
      discardResources(state, player.color, toDiscard);
      return { action: 'discard', data: { discard: toDiscard } };
    }
    // If the AI doesn't need to discard but the phase is discard, it's waiting
    // on other players — do nothing until the queue clears.
    return null;
  }

  if (state.phase === 'trade') {
    // AI skips trading and goes to build
    state.phase = 'build';
    return { action: 'skip_trade' };
  }

  if (state.phase === 'build') {
    // Try to build something
    // Priority: city > settlement > dev card > road

    // Check cities
    const citySpots = Object.values(state.intersections)
      .filter(i => i.building === 'settlement' && i.owner === player.color);
    if (player.citiesRemaining > 0 && citySpots.length > 0 && canAfford(player, { grain: 2, ore: 3 })) {
      const pick = citySpots[Math.floor(Math.random() * citySpots.length)];
      return { action: 'place_city', data: { key: pick.key } };
    }

    // Check settlements
    const settlementSpots = Object.values(state.intersections)
      .filter(i => !i.building && canPlaceSettlement(i.key, state.intersections, state.edges));
    // Filter to those connected to player's roads
    const validSettlements = settlementSpots.filter(i => {
      const adjEdges = getEdgesForIntersection(i.key, state.edges);
      return adjEdges.some(e => e.road === player.color);
    });
    
    if (player.settlementsRemaining > 0 && validSettlements.length > 0 && canAfford(player, { lumber: 1, brick: 1, wool: 1, grain: 1 })) {
      const pick = validSettlements[Math.floor(Math.random() * validSettlements.length)];
      return { action: 'place_settlement', data: { key: pick.key } };
    }

    // Check dev cards
    if (canAfford(player, { ore: 1, wool: 1, grain: 1 })) {
      return { action: 'buy_dev_card' };
    }

    // Check roads
    const roadSpots = Object.values(state.edges)
      .filter(e => !e.road && canPlaceRoad(e.key, player.color, state.edges, state.intersections));
    if (player.roadsRemaining > 0 && roadSpots.length > 0 && canAfford(player, { lumber: 1, brick: 1 })) {
      const pick = roadSpots[Math.floor(Math.random() * roadSpots.length)];
      return { action: 'place_road', data: { key: pick.key } };
    }

    // 4:1 bank trade fallback — convert surplus resources into whatever is
    // scarcest, so the AI never deadlocks on a missing resource.
    // Determine what's needed: cheapest build the player still wants.
    const canStillRoad = player.roadsRemaining > 0;
    const canStillSett = player.settlementsRemaining > 0;
    const canStillCity = player.citiesRemaining > 0;
    const canStillDev = true;

    // Figure out the scarcest resource among everything that could be built.
    const scarcity: Record<string, number> = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
    if (canStillRoad) { scarcity.lumber++; scarcity.brick++; }
    if (canStillSett) { scarcity.lumber++; scarcity.brick++; scarcity.wool++; scarcity.grain++; }
    if (canStillCity) { scarcity.grain += 2; scarcity.ore += 3; }
    if (canStillDev) { scarcity.ore++; scarcity.wool++; scarcity.grain++; }
    // Weight by how short the player is relative to need.
    let target: ResourceType | null = null;
    let targetNeed = 0;
    (Object.keys(scarcity) as ResourceType[]).forEach(res => {
      const need = scarcity[res];
      const have = player.resources[res] || 0;
      if (need > 0 && have < need && (need - have) > targetNeed) {
        targetNeed = need - have;
        target = res;
      }
    });
    if (target) {
      // Trade a surplus resource (most abundant) for the scarce target.
      let give: ResourceType | null = null;
      for (const res of RESOURCES) {
        if ((player.resources[res] || 0) >= 4 && res !== target) {
          if (!give || (player.resources[res] > (player.resources[give] || 0))) give = res;
        }
      }
      if (give) return { action: 'bank_trade', data: { give, get: target } };
    }

    // Nothing to do, end turn
    return { action: 'end_turn' };
  }

  return null;
}

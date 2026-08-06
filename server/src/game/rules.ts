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
    phase: 'setup_settlement',
    round: 0,
    dice: null,
    robberHex: `${robberTile.q},${robberTile.r}`,
    longestRoad: { length: 0 },
    largestArmy: { size: 0 },
    tradeOffers: [],
    setupPhase: true,
    setupRound: 0,
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

  // During setup, give resources for the SECOND settlement only
  if (state.setupRound >= 2) {
    // Give resources from adjacent hexes
    const hexes = getAdjacentHexes(intersectionKey, state.board);
    hexes.forEach(hex => {
      if (hex.type !== 'desert' && hex.type !== 'water') {
        addResources(player, { [hex.type]: 1 });
      }
    });
  }

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

// Roll dice
export function rollDice(state: GameState): [number, number] {
  const d1 = Math.floor(Math.random() * 6) + 1;
  const d2 = Math.floor(Math.random() * 6) + 1;
  state.dice = [d1, d2];
  state.phase = 'trade';

  const total = d1 + d2;
  
  // Distribute resources
  if (total !== 7) {
    const production = getResourceProduction(total, state.board, state.intersections);
    for (const [color, resources] of Object.entries(production)) {
      const player = getPlayerByColor(state, color as PlayerColor);
      addResources(player, resources);
    }
  }
  // If 7, robber activates (handled by UI)

  return [d1, d2];
}

// Move robber
export function moveRobber(state: GameState, targetHexQ: number, targetHexR: number, stealFrom?: PlayerColor): string | null {
  const [rq, rr] = state.robberHex.split(',').map(Number);
  const oldTile = state.board.find(t => t.q === rq && t.r === rr);
  const newTile = state.board.find(t => t.q === targetHexQ && t.r === targetHexR);
  
  if (!newTile) return 'Invalid hex';
  if (newTile.type === 'water') return 'Cannot place robber on water';
  
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
  if (state.phase !== 'build') return 'Not build phase';
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
  deductResources(player, BUILDING_COSTS.road);
  
  // Check longest road
  updateLongestRoad(state);
  
  return null;
}

// Place a settlement (during normal play)
export function placeSettlement(state: GameState, intersectionKey: string): string | null {
  const player = getCurrentPlayer(state);
  if (state.phase !== 'build') return 'Not build phase';
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
  if (state.phase !== 'build') return 'Not build phase';
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
  if (state.phase !== 'build') return null;
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
  const knight = player.devCards.find(c => c.type === 'knight' && !c.played);
  if (!knight) return 'No unplayed knight card';

  knight.played = true;
  player.playedKnights++;

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

// End turn
export function endTurn(state: GameState): void {
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
  
  for (const player of state.players) {
    const length = calculateLongestRoad(player.color, state.edges);
    if (length >= 5 && length > maxLength) {
      maxLength = length;
      maxColor = player.color;
    }
  }

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

// Get hexes adjacent to an intersection
function getAdjacentHexes(intersectionKey: string, board: HexTile[]): HexTile[] {
  // A corner key is canonical (integer). Find all board hexes that contain
  // this corner among their 6 corners.
  return board.filter(tile => getHexCorners(tile.q, tile.r).includes(intersectionKey));
}

// Simple AI: make a random valid move
export function aiTurn(state: GameState): { action: string; data?: any } | null {
  const player = getCurrentPlayer(state);
  if (!player.isAI) return null;

  // During setup
  if (state.setupPhase) {
    if (state.phase === 'setup_settlement') {
      // Find valid settlement spots
      const validKeys = Object.values(state.intersections)
        .filter(i => !i.building)
        .map(i => i.key);
      
      if (validKeys.length > 0) {
        const pick = validKeys[Math.floor(Math.random() * validKeys.length)];
        return { action: 'place_settlement', data: { key: pick } };
      }
    }
    if (state.phase === 'setup_road') {
      const validEdges = Object.values(state.edges)
        .filter(e => !e.road)
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
    if (citySpots.length > 0 && canAfford(player, { grain: 2, ore: 3 })) {
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
    
    if (validSettlements.length > 0 && canAfford(player, { lumber: 1, brick: 1, wool: 1, grain: 1 })) {
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
    if (roadSpots.length > 0 && canAfford(player, { lumber: 1, brick: 1 })) {
      const pick = roadSpots[Math.floor(Math.random() * roadSpots.length)];
      return { action: 'place_road', data: { key: pick.key } };
    }

    // Nothing to do, end turn
    return { action: 'end_turn' };
  }

  return null;
}

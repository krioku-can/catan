// Shared types for Catan

export type ResourceType = 'brick' | 'lumber' | 'wool' | 'grain' | 'ore';

export const RESOURCES: ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];

export type HexType = ResourceType | 'desert' | 'water';

export type PlayerColor = 'red' | 'blue' | 'white' | 'orange';

export const PLAYER_COLORS: PlayerColor[] = ['red', 'blue', 'white', 'orange'];

export interface HexTile {
  q: number;
  r: number;
  type: HexType;
  number?: number;
  hasRobber: boolean;
}

export interface Port {
  q: number;
  r: number;
  direction: number; // 0-5, which edge of the hex
  type: '3:1' | '2:1:brick' | '2:1:lumber' | '2:1:wool' | '2:1:grain' | '2:1:ore';
}

export interface Intersection {
  key: string; // "q,r,corner"
  q: number;
  r: number;
  corner: 0 | 1 | 2;
  building?: 'settlement' | 'city';
  owner?: PlayerColor;
}

export interface Edge {
  key: string; // "q1,r1,c1-q2,r2,c2" (sorted)
  from: string;
  to: string;
  road?: PlayerColor;
}

export interface DevelopmentCard {
  type: 'knight' | 'victory_point' | 'road_building' | 'year_of_plenty' | 'monopoly';
  played: boolean;
}

export interface Player {
  color: PlayerColor;
  name: string;
  resources: Record<ResourceType, number>;
  devCards: DevelopmentCard[];
  playedKnights: number;
  roadsRemaining: number;
  settlementsRemaining: number;
  citiesRemaining: number;
  victoryPoints: number;
  isAI: boolean;
}

export type TurnPhase = 'roll' | 'trade' | 'build' | 'setup_settlement' | 'setup_road' | 'turn_order';

export interface TradeOffer {
  from: PlayerColor;
  to: PlayerColor;
  give: Partial<Record<ResourceType, number>>;
  want: Partial<Record<ResourceType, number>>;
}

export interface GameState {
  id: string;
  players: Player[];
  board: HexTile[];
  ports: Port[];
  intersections: Record<string, Intersection>;
  edges: Record<string, Edge>;
  turnOrder: PlayerColor[];
  currentTurn: number;
  phase: TurnPhase;
  round: number; // setup rounds count
  dice: [number, number] | null;
  robberHex: string; // q,r of hex with robber
  longestRoad: { color?: PlayerColor; length: number };
  largestArmy: { color?: PlayerColor; size: number };
  tradeOffers: TradeOffer[];
  winner?: PlayerColor;
  setupPhase: boolean;
  setupRound: number; // 0 = first settlement, 1 = first road, etc.
}

export interface GameConfig {
  numPlayers: number;
  playerNames: string[];
  aiPlayers: number[]; // indices of AI players
}

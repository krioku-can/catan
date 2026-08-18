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
  /** The coastal edge key this harbor sits on (canonical "a~b"). */
  coastalEdge: string;
  /** The two coastal intersection keys that grant harbor access. */
  coastalIntersections: string[];
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
  id: string;
  type: 'knight' | 'victory_point' | 'road_building' | 'year_of_plenty' | 'monopoly';
  played: boolean;
  /** Official rule: cannot play a card on the same turn it was bought. */
  boughtThisTurn?: boolean;
}

export type AiLevel = 'easy' | 'normal' | 'hard';

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
  /** Difficulty for this AI player (defaults to 'normal'). */
  aiLevel?: AiLevel;
  /** Number of dev cards played this turn (enforces 1-per-turn rule). */
  devCardsPlayedThisTurn: number;
  /** @deprecated Prefer per-card boughtThisTurn. Kept for older state. */
  boughtDevCardThisTurn: boolean;
}

export type TurnPhase = 'roll' | 'trade' | 'build' | 'discard' | 'setup_settlement' | 'setup_road' | 'turn_order';

export interface TradeOffer {
  from: PlayerColor;
  /** Target player. When undefined, the offer is public — visible to ALL other players. */
  to?: PlayerColor;
  give: Partial<Record<ResourceType, number>>;
  want: Partial<Record<ResourceType, number>>;
  /** Players who said yes to a public offer. Proposer picks one to complete. */
  acceptedBy?: PlayerColor[];
  /** Players who declined a public offer. */
  rejectedBy?: PlayerColor[];
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
  /** True once the robber has been moved this turn (7 roll or knight). */
  robberMovedThisTurn: boolean;
  /**
   * True only when a 7 was rolled or a Knight was played and the robber
   * still needs to be relocated. Prevents moving the robber on every roll.
   */
  pendingRobberMove: boolean;
  longestRoad: { color?: PlayerColor; length: number };
  largestArmy: { color?: PlayerColor; size: number };
  tradeOffers: TradeOffer[];
  winner?: PlayerColor;
  setupPhase: boolean;
  setupRound: number; // 0 = first settlement, 1 = first road, etc.
  /** Intersection key of the settlement just placed in setup. Setup road must attach here. */
  lastSetupSettlement?: string;
  /** Players who still need to discard half their hand after a 7. */
  discardQueue: PlayerColor[];
  /** Pending dev-card action awaiting placement (road_building). */
  pendingDevAction: 'road_building' | null;
  /** Free roads remaining from a Road Building card (0-2). */
  pendingDevRoads: number;
  /** Shared development-card deck (face-down). Drawn on buy. */
  devDeck: DevelopmentCard['type'][];
  /** VP needed to win (official 10; Catan Universe often allows 12). */
  victoryPointsToWin: number;
  /**
   * Catan Universe "Friendly Robber": cannot steal from players with
   * 2 or fewer victory points.
   */
  friendlyRobber: boolean;
  boardMode: 'random' | 'balanced';
}

export interface GameConfig {
  numPlayers: number;
  playerNames: string[];
  aiPlayers: number[]; // indices of AI players
  /** Default 10 (official). Catan Universe-style custom games often use 12. */
  victoryPointsToWin?: number;
  /** Default false. When true, robber cannot steal from ≤2 VP players. */
  friendlyRobber?: boolean;
  /** random = shuffle; balanced = avoid clustered high-pips + resource clumps. */
  boardMode?: 'random' | 'balanced';
  /** Difficulty for all AI players. Defaults to 'normal'. */
  aiLevel?: AiLevel;
}

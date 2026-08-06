// Hex grid math for Catan
// Uses axial coordinates (q, r) — see https://www.redblobgames.com/grids/hexagons/

import { HexTile, HexType, Port, Intersection, Edge, ResourceType } from './types';

// Standard Catan board: radius 2 (3 hexes across center)
// Total: 1 (center) + 6 (ring 1) + 12 (ring 2) = 19 land hexes
const BOARD_RADIUS = 2;

// Hex neighbor directions (axial)
const HEX_DIRECTIONS = [
  { q: 1, r: 0 },   // east
  { q: 1, r: -1 },  // northeast
  { q: 0, r: -1 },  // northwest
  { q: -1, r: 0 },  // west
  { q: -1, r: 1 },  // southwest
  { q: 0, r: 1 },   // southeast
];

// Corner offsets within a hex (0-5, starting from east going clockwise)
// Each corner is shared by 3 hexes
const CORNER_OFFSETS = [
  { q: 1, r: 0 },    // east
  { q: 1, r: -1 },   // northeast
  { q: 0, r: -1 },   // northwest
  { q: -1, r: 0 },   // west
  { q: -1, r: 1 },   // southwest
  { q: 0, r: 1 },    // southeast
];

// Resource distribution for standard Catan
const RESOURCE_DISTRIBUTION: HexType[] = [
  'brick', 'brick', 'brick',
  'lumber', 'lumber', 'lumber', 'lumber',
  'wool', 'wool', 'wool', 'wool',
  'grain', 'grain', 'grain', 'grain',
  'ore', 'ore', 'ore',
  'desert',
];

// Number token distribution (in order of placement)
const NUMBER_DISTRIBUTION = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11];

// Port layout (edge of board, specific hex + direction)
// Pointy-top grid — 9 ports evenly distributed around the coast:
// 4 generic 3:1 + 5 specific 2:1 (one per resource), matching official Catan.
const PORT_LAYOUT: { q: number; r: number; dir: number; type: Port['type'] }[] = [
  { q: 2, r: 0, dir: 1, type: '3:1' },
  { q: 0, r: 2, dir: 4, type: '2:1:lumber' },
  { q: -2, r: 2, dir: 5, type: '3:1' },
  { q: -2, r: 2, dir: 3, type: '2:1:wool' },
  { q: -2, r: 0, dir: 3, type: '3:1' },
  { q: 0, r: -2, dir: 3, type: '2:1:grain' },
  { q: 0, r: -2, dir: 1, type: '3:1' },
  { q: 2, r: -2, dir: 2, type: '2:1:ore' },
  { q: 2, r: 0, dir: 5, type: '2:1:brick' },
];

export function getNeighbors(q: number, r: number): { q: number; r: number }[] {
  return HEX_DIRECTIONS.map(d => ({ q: q + d.q, r: r + d.r }));
}

export function hexDistance(a: { q: number; r: number }, b: { q: number; r: number }): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
}

export function hexToPixel(q: number, r: number, size: number): { x: number; y: number } {
  const x = size * (3 / 2 * q);
  const y = size * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r);
  return { x, y };
}

export function pixelToHex(x: number, y: number, size: number): { q: number; r: number } {
  const q = (2 / 3 * x) / size;
  const r = (-1 / 3 * x + Math.sqrt(3) / 3 * y) / size;
  return hexRound(q, r);
}

function hexRound(q: number, r: number): { q: number; r: number } {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

// Generate all hex coordinates within a given radius
export function getHexesInRadius(radius: number): { q: number; r: number }[] {
  const hexes: { q: number; r: number }[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (Math.abs(q + r) <= radius) {
        hexes.push({ q, r });
      }
    }
  }
  return hexes;
}

// Get the 6 corners of a hex (as intersection keys)
export function getHexCorners(q: number, r: number): string[] {
  return CORNER_OFFSETS.map((offset, i) => {
    const cq = q + offset.q;
    const cr = r + offset.r;
    // The corner index at this position depends on which hex we're looking from
    // For a given hex, corner i is at position (q + offset.q, r + offset.r)
    // and the corner index at that position is (i + 3) % 6
    const cornerIdx = ((i + 3) % 6) as 0 | 1 | 2 | 3 | 4 | 5;
    return `${cq},${cr},${cornerIdx}`;
  });
}

// Get the 6 edges of a hex (as edge keys)
export function getHexEdges(q: number, r: number): string[] {
  const corners = getHexCorners(q, r);
  const edges: string[] = [];
  for (let i = 0; i < 6; i++) {
    const next = (i + 1) % 6;
    const [a, b] = [corners[i], corners[next]].sort();
    edges.push(`${a}-${b}`);
  }
  return edges;
}

// Shuffle array in place (Fisher-Yates)
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Generate a complete Catan board
export function generateBoard(): { tiles: HexTile[]; ports: Port[]; intersections: Record<string, Intersection>; edges: Record<string, Edge> } {
  // 1. Get all hex positions
  const hexPositions = getHexesInRadius(BOARD_RADIUS);
  
  // 2. Shuffle and assign resource types
  const shuffledResources = shuffle(RESOURCE_DISTRIBUTION);
  const tiles: HexTile[] = hexPositions.map((pos, i) => ({
    q: pos.q,
    r: pos.r,
    type: shuffledResources[i],
    hasRobber: shuffledResources[i] === 'desert',
  }));

  // 3. Assign number tokens (skip desert)
  const landTiles = tiles.filter(t => t.type !== 'desert');
  const shuffledNumbers = shuffle(NUMBER_DISTRIBUTION);
  landTiles.forEach((tile, i) => {
    tile.number = shuffledNumbers[i];
  });

  // 4. Build ports
  const ports: Port[] = PORT_LAYOUT.map(p => ({
    q: p.q,
    r: p.r,
    direction: p.dir,
    type: p.type,
  }));

  // 5. Build all intersections and edges
  const intersections: Record<string, Intersection> = {};
  const edges: Record<string, Edge> = {};

  tiles.forEach(tile => {
    const corners = getHexCorners(tile.q, tile.r);
    corners.forEach((key, i) => {
      if (!intersections[key]) {
        const [cq, cr, cornerStr] = key.split(',');
        intersections[key] = {
          key,
          q: parseInt(cq),
          r: parseInt(cr),
          corner: parseInt(cornerStr) as 0 | 1 | 2,
        };
      }
    });

    const hexEdges = getHexEdges(tile.q, tile.r);
    hexEdges.forEach(key => {
      if (!edges[key]) {
        const [from, to] = key.split('-');
        edges[key] = { key, from, to };
      }
    });
  });

  return { tiles, ports, intersections, edges };
}

// Get intersections adjacent to a hex
export function getIntersectionsForHex(q: number, r: number, intersections: Record<string, Intersection>): Intersection[] {
  const cornerKeys = getHexCorners(q, r);
  return cornerKeys.map(k => intersections[k]).filter(Boolean);
}

// Get edges adjacent to a hex
export function getEdgesForHex(q: number, r: number, edges: Record<string, Edge>): Edge[] {
  const edgeKeys = getHexEdges(q, r);
  return edgeKeys.map(k => edges[k]).filter(Boolean);
}

// Get intersections adjacent to an intersection (connected by an edge)
export function getAdjacentIntersections(key: string, edges: Record<string, Edge>): string[] {
  const adjacent: string[] = [];
  Object.values(edges).forEach(edge => {
    if (edge.from === key) adjacent.push(edge.to);
    if (edge.to === key) adjacent.push(edge.from);
  });
  return adjacent;
}

// Get edges connected to an intersection
export function getEdgesForIntersection(key: string, edges: Record<string, Edge>): Edge[] {
  return Object.values(edges).filter(e => e.from === key || e.to === key);
}

// Check if a settlement placement is valid (no adjacent settlements)
export function canPlaceSettlement(
  key: string,
  intersections: Record<string, Intersection>,
  edges: Record<string, Edge>,
): boolean {
  const inter = intersections[key];
  if (!inter) return false;
  if (inter.building) return false;
  
  // Check no adjacent settlements
  const adjacent = getAdjacentIntersections(key, edges);
  for (const adjKey of adjacent) {
    const adj = intersections[adjKey];
    if (adj?.building) return false;
  }
  
  return true;
}

// Check if a road placement is valid
export function canPlaceRoad(
  edgeKey: string,
  color: string,
  edges: Record<string, Edge>,
  intersections: Record<string, Intersection>,
): boolean {
  const edge = edges[edgeKey];
  if (!edge) return false;
  if (edge.road) return false;

  // Must connect to your settlement/city or your existing road
  const from = intersections[edge.from];
  const to = intersections[edge.to];

  if (from?.owner === color || to?.owner === color) return true;

  // Check if connected to existing road
  const fromEdges = getEdgesForIntersection(edge.from, edges);
  const toEdges = getEdgesForIntersection(edge.to, edges);
  
  for (const e of fromEdges) {
    if (e.road === color && e.key !== edgeKey) return true;
  }
  for (const e of toEdges) {
    if (e.road === color && e.key !== edgeKey) return true;
  }

  return false;
}

// Get resource production for a dice roll
export function getResourceProduction(
  roll: number,
  tiles: HexTile[],
  intersections: Record<string, Intersection>,
  edges: Record<string, Edge>,
): Record<string, Partial<Record<ResourceType, number>>> {
  const production: Record<string, Partial<Record<ResourceType, number>>> = {};

  tiles.forEach(tile => {
    if (tile.number !== roll || tile.hasRobber) return;
    if (tile.type === 'desert' || tile.type === 'water') return;

    const corners = getHexCorners(tile.q, tile.r);
    corners.forEach(cornerKey => {
      const inter = intersections[cornerKey];
      if (!inter?.owner) return;

      const resource = tile.type as ResourceType;
      if (!production[inter.owner]) production[inter.owner] = {};
      const amount = inter.building === 'city' ? 2 : 1;
      production[inter.owner][resource] = (production[inter.owner][resource] || 0) + amount;
    });
  });

  return production;
}

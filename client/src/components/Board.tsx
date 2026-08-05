import { useRef, useEffect, useState, useCallback } from 'react';
import type { GameState, Intersection, Edge } from '../game/types';
import { hexToPixel, pixelToHex, getHexCorners } from '../game/board';

// Inspiration: classic Catan digital board — wood table, textured hexes, cream chips

const TERRAIN: Record<string, { base: string; mid: string; light: string; dark: string; emoji: string }> = {
  brick:  { base: '#c4784a', mid: '#d4895a', light: '#e8a87c', dark: '#8b4e2f', emoji: '' },
  lumber: { base: '#3d7a3d', mid: '#4a8f4a', light: '#6bb36b', dark: '#2a552a', emoji: '' },
  wool:   { base: '#8fbc5a', mid: '#a4d06e', light: '#c5e896', dark: '#5f8a38', emoji: '' },
  grain:  { base: '#e0b84a', mid: '#f0c95a', light: '#f5db7a', dark: '#b0892a', emoji: '' },
  ore:    { base: '#8a8f95', mid: '#a0a5ab', light: '#c0c5cb', dark: '#5a5f65', emoji: '' },
  desert: { base: '#e8d5a3', mid: '#f0e0b5', light: '#f8ecd0', dark: '#c4b07a', emoji: '' },
};

const PLAYER_COLORS: Record<string, string> = {
  red: '#d32f2f',
  blue: '#1976d2',
  white: '#f5f5f5',
  orange: '#f57c00',
};

interface BoardProps {
  gameState: GameState;
  hexSize: number;
  onHexClick: (q: number, r: number) => void;
  onIntersectionClick: (key: string) => void;
  onEdgeClick: (key: string) => void;
  robberMode: boolean;
  selectedAction: string | null;
}

function hexCorners(cx: number, cy: number, size: number) {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    pts.push({ x: cx + size * Math.cos(a), y: cy + size * Math.sin(a) });
  }
  return pts;
}

function fillHex(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < 6; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

function drawWoodBackground(ctx: CanvasRenderingContext2D, W: number, H: number) {
  // Warm table wood
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#8B5A2B');
  g.addColorStop(0.35, '#A06A35');
  g.addColorStop(0.6, '#8B5A2B');
  g.addColorStop(1, '#6F4420');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Grain lines
  ctx.save();
  ctx.globalAlpha = 0.08;
  for (let i = 0; i < 40; i++) {
    const y = (H / 40) * i + Math.sin(i * 1.7) * 3;
    ctx.strokeStyle = i % 3 === 0 ? '#3e2410' : '#c48a4a';
    ctx.lineWidth = i % 5 === 0 ? 2.5 : 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x < W; x += 20) {
      ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 4);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawWaterHex(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const pts = hexCorners(cx, cy, size);
  fillHex(ctx, pts);
  const g = ctx.createRadialGradient(cx - size * 0.2, cy - size * 0.2, size * 0.1, cx, cy, size);
  g.addColorStop(0, '#5eb3e8');
  g.addColorStop(0.5, '#3a9ad9');
  g.addColorStop(1, '#2b7fb8');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Subtle wave dots
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.ellipse(cx - size * 0.2 + i * size * 0.2, cy + Math.sin(i) * size * 0.1, size * 0.12, size * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTerrainHex(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  type: string,
  hasRobber: boolean,
) {
  const t = TERRAIN[type] || TERRAIN.desert;
  const pts = hexCorners(cx, cy, size * 0.98);

  // Shadow under hex
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  fillHex(ctx, pts);
  ctx.fillStyle = t.base;
  ctx.fill();
  ctx.restore();

  // Main fill with subtle gradient
  fillHex(ctx, pts);
  const g = ctx.createLinearGradient(cx - size, cy - size, cx + size, cy + size);
  g.addColorStop(0, t.light);
  g.addColorStop(0.45, t.mid);
  g.addColorStop(1, t.dark);
  ctx.fillStyle = g;
  ctx.fill();

  // Beveled edge
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();
  fillHex(ctx, hexCorners(cx, cy, size * 0.98));
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Terrain texture details
  ctx.save();
  if (type === 'lumber') {
    // Trees
    for (const [dx, dy, s] of [[-0.25, -0.15, 0.22], [0.15, -0.25, 0.18], [0.05, 0.2, 0.2], [-0.1, 0.05, 0.16]] as const) {
      const tx = cx + dx * size;
      const ty = cy + dy * size;
      ctx.fillStyle = '#2d5a2d';
      ctx.beginPath();
      ctx.moveTo(tx, ty - s * size);
      ctx.lineTo(tx - s * size * 0.55, ty + s * size * 0.35);
      ctx.lineTo(tx + s * size * 0.55, ty + s * size * 0.35);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#5a3a1a';
      ctx.fillRect(tx - 1.5, ty + s * size * 0.2, 3, s * size * 0.25);
    }
  } else if (type === 'grain') {
    // Wheat rows
    ctx.strokeStyle = 'rgba(160,120,30,0.45)';
    ctx.lineWidth = 1.5;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(cx - size * 0.35, cy + i * size * 0.12);
      ctx.quadraticCurveTo(cx, cy + i * size * 0.12 - 4, cx + size * 0.35, cy + i * size * 0.12);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,220,100,0.35)';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * size * 0.25, cy + Math.sin(a) * size * 0.2, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (type === 'wool') {
    // Soft pasture blobs
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    for (const [dx, dy] of [[-0.2, -0.1], [0.15, 0.1], [0, -0.25], [-0.05, 0.2]]) {
      ctx.beginPath();
      ctx.ellipse(cx + dx * size, cy + dy * size, size * 0.12, size * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Little sheep dots
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(cx + size * 0.1, cy, 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'brick') {
    // Clay / hills
    ctx.fillStyle = 'rgba(120,50,20,0.25)';
    for (let i = 0; i < 4; i++) {
      const y = cy - size * 0.25 + i * size * 0.15;
      ctx.beginPath();
      ctx.moveTo(cx - size * 0.35, y);
      ctx.quadraticCurveTo(cx, y - 6, cx + size * 0.35, y);
      ctx.lineTo(cx + size * 0.35, y + 6);
      ctx.quadraticCurveTo(cx, y, cx - size * 0.35, y + 6);
      ctx.closePath();
      ctx.fill();
    }
  } else if (type === 'ore') {
    // Rocky mountains
    ctx.fillStyle = 'rgba(60,65,70,0.5)';
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.35, cy + size * 0.25);
    ctx.lineTo(cx - size * 0.1, cy - size * 0.3);
    ctx.lineTo(cx + size * 0.05, cy + size * 0.05);
    ctx.lineTo(cx + size * 0.15, cy - size * 0.2);
    ctx.lineTo(cx + size * 0.4, cy + size * 0.25);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.1, cy - size * 0.3);
    ctx.lineTo(cx - size * 0.02, cy - size * 0.1);
    ctx.lineTo(cx - size * 0.18, cy - size * 0.05);
    ctx.closePath();
    ctx.fill();
  } else if (type === 'desert') {
    // Sand ripples
    ctx.strokeStyle = 'rgba(180,150,90,0.35)';
    ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy + i * size * 0.12, size * 0.3, 0.2, Math.PI - 0.2);
      ctx.stroke();
    }
  }
  ctx.restore();

  if (hasRobber) {
    // Dim overlay
    fillHex(ctx, pts);
    ctx.fillStyle = 'rgba(30,30,40,0.45)';
    ctx.fill();
  }
}

function drawNumberToken(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, num: number) {
  const r = size * 0.28;
  // Shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#f5f0e1';
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#f8f4e8';
  ctx.fill();
  ctx.strokeStyle = '#c9bfa0';
  ctx.lineWidth = 2;
  ctx.stroke();

  const isHot = num === 6 || num === 8;
  ctx.fillStyle = isHot ? '#c62828' : '#2c2c2c';
  ctx.font = `bold ${size * 0.32}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(num), cx, cy - r * 0.08);

  // Probability pips
  const pips = num <= 7 ? num - 1 : 13 - num;
  const pipR = Math.max(1.2, size * 0.035);
  ctx.fillStyle = isHot ? '#c62828' : '#444';
  const pipY = cy + r * 0.45;
  const spacing = pipR * 2.8;
  const startX = cx - ((pips - 1) * spacing) / 2;
  for (let p = 0; p < pips; p++) {
    ctx.beginPath();
    ctx.arc(startX + p * spacing, pipY, pipR, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRobber(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  // Classic black pawn robber
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  // Body
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.08, size * 0.16, size * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  // Head
  ctx.beginPath();
  ctx.arc(cx, cy - size * 0.12, size * 0.12, 0, Math.PI * 2);
  ctx.fill();
  // Hat brim
  ctx.fillStyle = '#0d0d0d';
  ctx.beginPath();
  ctx.ellipse(cx, cy - size * 0.18, size * 0.16, size * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSettlement(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string, size: number) {
  const s = size * 0.22;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - s, cy + s * 0.55);
  ctx.lineTo(cx - s, cy - s * 0.1);
  ctx.lineTo(cx, cy - s * 0.85);
  ctx.lineTo(cx + s, cy - s * 0.1);
  ctx.lineTo(cx + s, cy + s * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Roof highlight
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.7, cy - s * 0.05);
  ctx.lineTo(cx, cy - s * 0.7);
  ctx.lineTo(cx + s * 0.7, cy - s * 0.05);
  ctx.stroke();
  ctx.restore();
}

function drawCity(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string, size: number) {
  const s = size * 0.28;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - s, cy + s * 0.5);
  ctx.lineTo(cx - s, cy - s * 0.15);
  ctx.lineTo(cx - s * 0.45, cy - s * 0.55);
  ctx.lineTo(cx - s * 0.45, cy - s * 0.9);
  ctx.lineTo(cx, cy - s * 0.65);
  ctx.lineTo(cx + s * 0.35, cy - s * 0.9);
  ctx.lineTo(cx + s * 0.35, cy - s * 0.4);
  ctx.lineTo(cx + s, cy - s * 0.15);
  ctx.lineTo(cx + s, cy + s * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function drawRoad(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  color: string, size: number,
) {
  // Shorten so roads sit between settlements
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const inset = size * 0.18;
  const sx = x1 + (dx / len) * inset;
  const sy = y1 + (dy / len) * inset;
  const ex = x2 - (dx / len) * inset;
  const ey = y2 - (dy / len) * inset;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(6, size * 0.14);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  // Highlight edge
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = Math.max(2, size * 0.04);
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.restore();
}

function drawPortBadge(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, label: string) {
  const r = size * 0.22;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#f5f0e1';
  ctx.fill();
  ctx.strokeStyle = '#8b7355';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#333';
  ctx.font = `bold ${size * 0.16}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, cy);
}

// Build accurate intersection pixel positions from hex corners
function buildIntersectionPositions(
  board: { q: number; r: number }[],
  size: number,
): Map<string, { x: number; y: number }> {
  const map = new Map<string, { x: number; y: number }>();
  board.forEach(tile => {
    const center = hexToPixel(tile.q, tile.r, size);
    const keys = getHexCorners(tile.q, tile.r);
    keys.forEach((key, i) => {
      if (map.has(key)) return;
      const angle = (Math.PI / 3) * i - Math.PI / 6;
      map.set(key, {
        x: center.x + size * Math.cos(angle),
        y: center.y + size * Math.sin(angle),
      });
    });
  });
  return map;
}

export default function Board({
  gameState,
  hexSize,
  onHexClick,
  onIntersectionClick,
  onEdgeClick,
  robberMode,
  selectedAction,
}: BoardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const lastTouch = useRef<{ x: number; y: number } | null>(null);
  const lastPinchDist = useRef<number | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const dragPanStart = useRef<{ x: number; y: number } | null>(null);
  const didPan = useRef(false);
  const posCache = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Larger board canvas for spacing + water ring
  const CANVAS_W = hexSize * 12;
  const CANVAS_H = hexSize * 11;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // HiDPI
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = CANVAS_W * dpr;
    canvas.height = CANVAS_H * dpr;
    canvas.style.width = `${CANVAS_W}px`;
    canvas.style.height = `${CANVAS_H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const W = CANVAS_W;
    const H = CANVAS_H;
    const positions = buildIntersectionPositions(gameState.board, hexSize);
    posCache.current = positions;

    drawWoodBackground(ctx, W, H);

    // Water ring (neighbors of land that aren't land)
    const landKeys = new Set(gameState.board.map(t => `${t.q},${t.r}`));
    const waterKeys = new Set<string>();
    gameState.board.forEach(tile => {
      const dirs = [
        { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
        { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
      ];
      dirs.forEach(d => {
        const key = `${tile.q + d.q},${tile.r + d.r}`;
        if (!landKeys.has(key)) waterKeys.add(key);
      });
    });

    waterKeys.forEach(key => {
      const [q, r] = key.split(',').map(Number);
      const { x, y } = hexToPixel(q, r, hexSize);
      drawWaterHex(ctx, x + W / 2, y + H / 2, hexSize * 0.98);
    });

    // Land hexes
    gameState.board.forEach(tile => {
      const { x, y } = hexToPixel(tile.q, tile.r, hexSize);
      drawTerrainHex(ctx, x + W / 2, y + H / 2, hexSize, tile.type, !!tile.hasRobber);
    });

    // Ports
    if (gameState.ports?.length) {
      gameState.ports.forEach(port => {
        const center = hexToPixel(port.q, port.r, hexSize);
        const edgeAngle = (Math.PI / 3) * port.direction - Math.PI / 6 + Math.PI / 6;
        // midpoint of that edge, pushed slightly outward
        const a1 = (Math.PI / 3) * port.direction - Math.PI / 6;
        const a2 = (Math.PI / 3) * ((port.direction + 1) % 6) - Math.PI / 6;
        const mx = (Math.cos(a1) + Math.cos(a2)) / 2;
        const my = (Math.sin(a1) + Math.sin(a2)) / 2;
        const cx = center.x + W / 2 + mx * hexSize * 1.35;
        const cy = center.y + H / 2 + my * hexSize * 1.35;
        void edgeAngle;
        let label = '3:1';
        if (port.type.startsWith('2:1')) {
          const res = port.type.split(':')[2];
          const icons: Record<string, string> = {
            brick: '🧱', lumber: '🪵', wool: '🐑', grain: '🌾', ore: '⛏',
          };
          label = icons[res] || '2:1';
        }
        drawPortBadge(ctx, cx, cy, hexSize, label);
      });
    }

    // Roads
    Object.values(gameState.edges).forEach((edge: Edge) => {
      if (!edge.road) return;
      const a = positions.get(edge.from);
      const b = positions.get(edge.to);
      if (!a || !b) return;
      drawRoad(
        ctx,
        a.x + W / 2, a.y + H / 2,
        b.x + W / 2, b.y + H / 2,
        PLAYER_COLORS[edge.road] || '#666',
        hexSize,
      );
    });

    // Intersections / buildings
    Object.values(gameState.intersections).forEach((inter: Intersection) => {
      const pos = positions.get(inter.key);
      if (!pos) return;
      const cx = pos.x + W / 2;
      const cy = pos.y + H / 2;

      if (inter.building === 'city') {
        drawCity(ctx, cx, cy, PLAYER_COLORS[inter.owner || ''] || '#666', hexSize);
      } else if (inter.building === 'settlement') {
        drawSettlement(ctx, cx, cy, PLAYER_COLORS[inter.owner || ''] || '#666', hexSize);
      } else if (selectedAction === 'settlement' || selectedAction === 'city' || gameState.setupPhase) {
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(4, hexSize * 0.08), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    });

    // Number tokens + robber on top
    gameState.board.forEach(tile => {
      const { x, y } = hexToPixel(tile.q, tile.r, hexSize);
      const cx = x + W / 2;
      const cy = y + H / 2;
      if (tile.hasRobber) {
        drawRobber(ctx, cx, cy, hexSize);
      } else if (tile.number) {
        drawNumberToken(ctx, cx, cy + hexSize * 0.02, hexSize, tile.number);
      }
    });
  }, [gameState, hexSize, CANVAS_W, CANVAS_H, selectedAction]);

  const screenToCanvas = useCallback((screenX: number, screenY: number) => {
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    const canvasDisplayW = CANVAS_W * zoom;
    const canvasDisplayH = CANVAS_H * zoom;
    const offsetX = (rect.width - canvasDisplayW) / 2 + pan.x;
    const offsetY = (rect.height - canvasDisplayH) / 2 + pan.y;
    return {
      x: (screenX - rect.left - offsetX) / zoom,
      y: (screenY - rect.top - offsetY) / zoom,
    };
  }, [zoom, pan, CANVAS_W, CANVAS_H]);

  const handleInteraction = useCallback((clientX: number, clientY: number) => {
    const { x, y } = screenToCanvas(clientX, clientY);
    const W = CANVAS_W;
    const H = CANVAS_H;
    const clickThreshold = 14 / zoom;
    const positions = posCache.current;

    for (const inter of Object.values(gameState.intersections)) {
      const pos = positions.get(inter.key);
      if (!pos) continue;
      if (Math.hypot(x - (pos.x + W / 2), y - (pos.y + H / 2)) < clickThreshold) {
        onIntersectionClick(inter.key);
        return;
      }
    }

    for (const edge of Object.values(gameState.edges)) {
      const a = positions.get(edge.from);
      const b = positions.get(edge.to);
      if (!a || !b) continue;
      const fx = a.x + W / 2;
      const fy = a.y + H / 2;
      const tx = b.x + W / 2;
      const ty = b.y + H / 2;
      const dx = tx - fx;
      const dy = ty - fy;
      const len2 = dx * dx + dy * dy || 1;
      let t = ((x - fx) * dx + (y - fy) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      if (Math.hypot(x - (fx + t * dx), y - (fy + t * dy)) < clickThreshold) {
        onEdgeClick(edge.key);
        return;
      }
    }

    const hex = pixelToHex(x - W / 2, y - H / 2, hexSize);
    if (gameState.board.find(t => t.q === hex.q && t.r === hex.r)) {
      onHexClick(hex.q, hex.r);
    }
  }, [gameState, hexSize, CANVAS_W, CANVAS_H, screenToCanvas, onIntersectionClick, onEdgeClick, onHexClick, zoom]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragStart.current = { x: e.clientX, y: e.clientY };
    dragPanStart.current = { ...pan };
    didPan.current = false;
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragStart.current || !dragPanStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      didPan.current = true;
      setPan({ x: dragPanStart.current.x + dx, y: dragPanStart.current.y + dy });
    }
  }, []);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (!didPan.current) handleInteraction(e.clientX, e.clientY);
    dragStart.current = null;
    dragPanStart.current = null;
    didPan.current = false;
  }, [handleInteraction]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      lastTouch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      dragPanStart.current = { ...pan };
      didPan.current = false;
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist.current = Math.hypot(dx, dy);
    }
  }, [pan]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1 && lastTouch.current && dragPanStart.current) {
      const dx = e.touches[0].clientX - lastTouch.current.x;
      const dy = e.touches[0].clientY - lastTouch.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        didPan.current = true;
        setPan({
          x: dragPanStart.current.x + dx,
          y: dragPanStart.current.y + dy,
        });
      }
    } else if (e.touches.length === 2 && lastPinchDist.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const scale = dist / lastPinchDist.current;
      setZoom(z => Math.max(0.35, Math.min(2.8, z * scale)));
      lastPinchDist.current = dist;
      didPan.current = true;
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!didPan.current && e.changedTouches[0]) {
      handleInteraction(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    }
    lastTouch.current = null;
    lastPinchDist.current = null;
    didPan.current = false;
  }, [handleInteraction]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.max(0.35, Math.min(2.8, z * (e.deltaY > 0 ? 0.9 : 1.1))));
  }, []);

  return (
    <div style={styles.container}>
      <div
        ref={containerRef}
        style={{
          ...styles.viewport,
          cursor: robberMode ? 'crosshair' : selectedAction ? 'pointer' : 'grab',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { dragStart.current = null; }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onWheel={handleWheel}
      >
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
            willChange: 'transform',
          }}
        >
          <canvas ref={canvasRef} style={{ display: 'block', borderRadius: 4 }} />
        </div>
      </div>

      <div style={styles.zoomControls}>
        <button type="button" style={styles.zoomBtn} onClick={() => setZoom(z => Math.min(2.8, z * 1.25))}>+</button>
        <span style={styles.zoomLabel}>{Math.round(zoom * 100)}%</span>
        <button type="button" style={styles.zoomBtn} onClick={() => setZoom(z => Math.max(0.35, z / 1.25))}>−</button>
        <button type="button" style={styles.zoomBtn} onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>⟲</button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'relative',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    background: '#6F4420',
  },
  viewport: {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    touchAction: 'none',
  },
  zoomControls: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    background: 'rgba(40,25,10,0.85)',
    borderRadius: 12,
    padding: 6,
    zIndex: 10,
    border: '1px solid rgba(255,220,150,0.2)',
  },
  zoomBtn: {
    width: 40,
    height: 40,
    border: '1px solid rgba(255,220,150,0.25)',
    borderRadius: 10,
    background: '#3d2814',
    color: '#f5e6c8',
    fontSize: 20,
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomLabel: {
    fontSize: 10,
    color: '#c9b896',
    textAlign: 'center',
    minWidth: 36,
  },
};

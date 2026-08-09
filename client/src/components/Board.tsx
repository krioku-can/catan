import { useRef, useEffect, useState, useCallback } from 'react';
import type { GameState, Intersection, Edge } from '../game/types';
import { hexToPixel, pixelToHex, getHexCorners, getPortIntersections } from '../game/board';

const PLAYER_COLORS: Record<string, string> = {
  red: '#d32f2f',
  blue: '#1976d2',
  white: '#f5f5f5',
  orange: '#f57c00',
};

const HEX_IMAGES: Record<string, string> = {
  lumber: '/assets/hex-lumber.png',
  brick: '/assets/hex-brick.png',
  wool: '/assets/hex-wool.png',
  grain: '/assets/hex-grain.png',
  ore: '/assets/hex-ore.png',
  desert: '/assets/hex-desert.png',
};

const ROBBER_IMG = '/assets/robber.png';

const TERRAIN_FALLBACK: Record<string, string> = {
  brick: '#c4784a', lumber: '#3d7a3d', wool: '#8fbc5a',
  grain: '#e0b84a', ore: '#8a8f95', desert: '#e8d5a3',
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

function fillHexPath(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < 6; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

function drawWoodBackground(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#9C6B3C');
  g.addColorStop(0.35, '#B07E4A');
  g.addColorStop(0.6, '#9C6B3C');
  g.addColorStop(1, '#7D5528');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = 0.08;
  for (let i = 0; i < 40; i++) {
    const y = (H / 40) * i + Math.sin(i * 1.7) * 3;
    ctx.strokeStyle = i % 3 === 0 ? '#3e2410' : '#c48a4a';
    ctx.lineWidth = i % 5 === 0 ? 2.5 : 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x < W; x += 20) ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 4);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWaterHex(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const pts = hexCorners(cx, cy, size * 1.02);
  fillHexPath(ctx, pts);
  const g = ctx.createRadialGradient(cx - size * 0.2, cy - size * 0.2, size * 0.1, cx, cy, size);
  g.addColorStop(0, '#4aa9e0');
  g.addColorStop(0.55, '#2f8ecf');
  g.addColorStop(1, '#1f6fad');
  ctx.fillStyle = g;
  ctx.fill();
}

/** Continuous sea frame under the island (official board look). */
function drawSeaFrame(
  ctx: CanvasRenderingContext2D,
  _board: { q: number; r: number }[],
  size: number,
  W: number,
  H: number,
) {
  // Soft blue disc behind everything coastal
  const cx = W / 2;
  const cy = H / 2;
  // Rough radius covering outer ring + water
  const R = size * 5.2;
  const g = ctx.createRadialGradient(cx, cy, size * 2.2, cx, cy, R);
  g.addColorStop(0, 'rgba(47, 142, 207, 0)');
  g.addColorStop(0.35, '#3a9ad9');
  g.addColorStop(0.75, '#2b7fb8');
  g.addColorStop(1, '#1a5f96');
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  // Sandy coast ring (like the physical board beach)
  ctx.save();
  ctx.strokeStyle = 'rgba(232, 210, 160, 0.55)';
  ctx.lineWidth = size * 0.22;
  ctx.beginPath();
  // Approximate coast as circle through outer hex centers
  const coastR = size * 3.55;
  ctx.arc(cx, cy, coastR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawHexWithImage(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, size: number,
  img: HTMLImageElement | null,
  type: string,
  hasRobber: boolean,
) {
  // Draw terrain at full size so hexes tile flush edge-to-edge like a puzzle,
  // with only the faint stroke seam separating tiles.
  const drawSize = size;
  const pts = hexCorners(cx, cy, drawSize);
  ctx.save();
  // Subtle shadow so tiles sit flush (puzzle-fit), not floating apart.
  ctx.shadowColor = 'rgba(0,0,0,0.2)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  fillHexPath(ctx, pts);
  ctx.fillStyle = TERRAIN_FALLBACK[type] || '#888';
  ctx.fill();
  ctx.restore();

  fillHexPath(ctx, pts);
  ctx.save();
  ctx.clip();
  if (img && img.complete && img.naturalWidth > 0) {
    const s = size * 2.05;
    ctx.drawImage(img, cx - s / 2, cy - s / 2, s, s);
  } else {
    ctx.fillStyle = TERRAIN_FALLBACK[type] || '#888';
    ctx.fill();
  }
  ctx.restore();

  fillHexPath(ctx, pts);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();
  fillHexPath(ctx, pts);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (hasRobber) {
    fillHexPath(ctx, pts);
    ctx.fillStyle = 'rgba(20,20,30,0.35)';
    ctx.fill();
  }
}

function drawNumberToken(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, num: number) {
  const r = size * 0.28;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#f8f4e8';
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

function drawRobber(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, img: HTMLImageElement | null) {
  if (img && img.complete && img.naturalWidth > 0) {
    const s = size * 0.75;
    ctx.drawImage(img, cx - s / 2, cy - s / 2, s, s);
    return;
  }
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.08, size * 0.16, size * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy - size * 0.12, size * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSettlement(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string, size: number) {
  const s = size * 0.24;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - s, cy + s * 0.55);
  ctx.lineTo(cx - s, cy - s * 0.05);
  ctx.lineTo(cx, cy - s * 0.9);
  ctx.lineTo(cx + s, cy - s * 0.05);
  ctx.lineTo(cx + s, cy + s * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function drawCity(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string, size: number) {
  const s = size * 0.3;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - s, cy + s * 0.5);
  ctx.lineTo(cx - s, cy - s * 0.1);
  ctx.lineTo(cx - s * 0.4, cy - s * 0.55);
  ctx.lineTo(cx - s * 0.4, cy - s * 0.95);
  ctx.lineTo(cx, cy - s * 0.65);
  ctx.lineTo(cx + s * 0.35, cy - s * 0.95);
  ctx.lineTo(cx + s * 0.35, cy - s * 0.4);
  ctx.lineTo(cx + s, cy - s * 0.1);
  ctx.lineTo(cx + s, cy + s * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function drawRoad(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  color: string, size: number,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const inset = size * 0.18;
  const sx = x1 + (dx / len) * inset;
  const sy = y1 + (dy / len) * inset;
  const ex = x2 - (dx / len) * inset;
  const ey = y2 - (dy / len) * inset;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 3;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(7, size * 0.16);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = Math.max(2, size * 0.05);
  ctx.stroke();
  ctx.restore();
}

/**
 * Harbor visual matching official Catan digital style:
 * - Small gold plaque sitting in the BLUE water next to a coastal edge
 * - Two thin pier lines from the two harbor vertices → plaque (a clean V)
 * - Upright text: "3:1" + "?"  or  "2:1" + resource code (Br/Lu/Wo/Gr/Or)
 * Never drawn on land hex faces.
 */
function drawOfficialHarbor(
  ctx: CanvasRenderingContext2D,
  ax: number, ay: number,
  bx: number, by: number,
  centerX: number, centerY: number,
  size: number,
  portType: string,
) {
  const edgeMx = (ax + bx) / 2;
  const edgeMy = (ay + by) / 2;

  // Direction from board center outward through the edge midpoint — always
  // points into the water ring for any coastal edge.
  let ox = edgeMx - centerX;
  let oy = edgeMy - centerY;
  const olen = Math.hypot(ox, oy) || 1;
  ox /= olen;
  oy /= olen;

  // Plaque sits in the water, pushed well past the coast.
  const pierLen = size * 1.15;
  const px = edgeMx + ox * pierLen;
  const py = edgeMy + oy * pierLen;

  const isGeneric = portType === '3:1';
  let ratio = '3:1';
  let icon = '?';
  if (!isGeneric) {
    const res = portType.split(':')[2];
    const letters: Record<string, string> = {
      brick: 'Br', lumber: 'Lu', wool: 'Wo', grain: 'Gr', ore: 'Or',
    };
    icon = letters[res] || '?';
    ratio = '2:1';
  }

  ctx.save();

  // --- Clean V pier lines (gold) from the two harbor corners to the plaque ---
  ctx.strokeStyle = '#d4b56a';
  ctx.lineWidth = Math.max(2.25, size * 0.05);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(px, py);
  ctx.lineTo(bx, by);
  ctx.stroke();

  // Soft outer stroke for definition on blue water
  ctx.strokeStyle = 'rgba(90, 60, 20, 0.35)';
  ctx.lineWidth = Math.max(3.5, size * 0.07);
  ctx.globalCompositeOperation = 'destination-over';
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(px, py);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';

  // --- Upright gold plaque (NO rotation — text always readable) ---
  // Shrunk so it sits comfortably inside the water hex without touching land.
  const s = size * 0.30; // half-width of plaque
  // Rounded square
  roundRect(ctx, px - s, py - s, s * 2, s * 2, s * 0.28);
  const fill = ctx.createLinearGradient(px, py - s, px, py + s);
  fill.addColorStop(0, '#f0e0b0');
  fill.addColorStop(0.45, '#e2c87a');
  fill.addColorStop(1, '#c9a84c');
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = '#8a6a28';
  ctx.lineWidth = 1.75;
  ctx.stroke();

  // Inner rim
  roundRect(ctx, px - s + 2, py - s + 2, s * 2 - 4, s * 2 - 4, s * 0.22);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Text — always screen-upright
  ctx.fillStyle = '#3a2a10';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.max(10, size * 0.135)}px system-ui,Segoe UI,Arial`;
  ctx.fillText(ratio, px, py - s * 0.28);
  ctx.font = `bold ${Math.max(12, size * 0.17)}px system-ui,Segoe UI,Arial`;
  ctx.fillText(icon, px, py + s * 0.3);

  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
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
  const [assetsReady, setAssetsReady] = useState(0);
  const imagesRef = useRef<Record<string, HTMLImageElement | null>>({});
  const robberRef = useRef<HTMLImageElement | null>(null);
  const lastTouch = useRef<{ x: number; y: number } | null>(null);
  const lastPinchDist = useRef<number | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const dragPanStart = useRef<{ x: number; y: number } | null>(null);
  const didPan = useRef(false);
  const posCache = useRef<Map<string, { x: number; y: number }>>(new Map());

  const CANVAS_W = hexSize * 12;
  const CANVAS_H = hexSize * 11;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        Object.entries(HEX_IMAGES).map(async ([k, src]) => {
          try {
            return [k, await loadImage(src)] as const;
          } catch {
            return [k, null] as const;
          }
        }),
      );
      if (cancelled) return;
      entries.forEach(([k, img]) => { imagesRef.current[k] = img; });
      try {
        robberRef.current = await loadImage(ROBBER_IMG);
      } catch {
        robberRef.current = null;
      }
      setAssetsReady(n => n + 1);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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
    drawSeaFrame(ctx, gameState.board, hexSize, W, H);

    const landKeys = new Set(gameState.board.map(t => `${t.q},${t.r}`));
    const waterKeys = new Set<string>();
    gameState.board.forEach(tile => {
      [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]].forEach(([dq, dr]) => {
        const key = `${tile.q + dq},${tile.r + dr}`;
        if (!landKeys.has(key)) waterKeys.add(key);
      });
    });
    waterKeys.forEach(key => {
      const [q, r] = key.split(',').map(Number);
      const { x, y } = hexToPixel(q, r, hexSize);
      drawWaterHex(ctx, x + W / 2, y + H / 2, hexSize);
    });

    gameState.board.forEach(tile => {
      const { x, y } = hexToPixel(tile.q, tile.r, hexSize);
      drawHexWithImage(
        ctx, x + W / 2, y + H / 2, hexSize,
        imagesRef.current[tile.type] || null,
        tile.type,
        !!tile.hasRobber,
      );
    });

    // Official-style harbors on the sea frame (see physical Catan board).
    if (gameState.ports?.length) {
      const boardCx = W / 2;
      const boardCy = H / 2;
      gameState.ports.forEach(port => {
        const [ikA, ikB] = getPortIntersections(port);
        const pa = positions.get(ikA);
        const pb = positions.get(ikB);
        if (!pa || !pb) return;

        const ax = pa.x + boardCx;
        const ay = pa.y + boardCy;
        const bx = pb.x + boardCx;
        const by = pb.y + boardCy;

        // Plaque is placed by pushing the edge midpoint OUTWARD from the board
        // center — this always lands in the water ring, regardless of which
        // hex the edge faces (some coastal edges face land, not water).
        drawOfficialHarbor(ctx, ax, ay, bx, by, boardCx, boardCy, hexSize, port.type);
      });
    }

    Object.values(gameState.edges).forEach((edge: Edge) => {
      const a = positions.get(edge.from);
      const b = positions.get(edge.to);
      if (!a || !b) return;
      const ax = a.x + W / 2, ay = a.y + H / 2;
      const bx = b.x + W / 2, by = b.y + H / 2;
      // Highlight empty edges when a road is being placed, so they're tappable.
      const placingRoad = gameState.setupPhase
        ? gameState.phase === 'setup_road'
        : gameState.phase === 'build' && selectedAction === 'road';
      if (!edge.road && placingRoad) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = Math.max(8, hexSize * 0.18);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.restore();
      }
      if (edge.road) {
        drawRoad(ctx, ax, ay, bx, by, PLAYER_COLORS[edge.road] || '#666', hexSize);
      }
    });

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

    gameState.board.forEach(tile => {
      const { x, y } = hexToPixel(tile.q, tile.r, hexSize);
      const cx = x + W / 2;
      const cy = y + H / 2;
      if (tile.hasRobber) {
        drawRobber(ctx, cx, cy, hexSize, robberRef.current);
      } else if (tile.number) {
        drawNumberToken(ctx, cx, cy + hexSize * 0.02, hexSize, tile.number);
      }
    });
  }, [gameState, hexSize, CANVAS_W, CANVAS_H, selectedAction, assetsReady]);

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
      const fx = a.x + W / 2, fy = a.y + H / 2, tx = b.x + W / 2, ty = b.y + H / 2;
      const dx = tx - fx, dy = ty - fy;
      const len2 = dx * dx + dy * dy || 1;
      let t = ((x - fx) * dx + (y - fy) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      if (Math.hypot(x - (fx + t * dx), y - (fy + t * dy)) < clickThreshold) {
        onEdgeClick(edge.key);
        return;
      }
    }
    const hex = pixelToHex(x - W / 2, y - H / 2, hexSize);
    if (gameState.board.find(t => t.q === hex.q && t.r === hex.r)) onHexClick(hex.q, hex.r);
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
      lastPinchDist.current = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
    }
  }, [pan]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1 && lastTouch.current && dragPanStart.current) {
      const dx = e.touches[0].clientX - lastTouch.current.x;
      const dy = e.touches[0].clientY - lastTouch.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        didPan.current = true;
        setPan({ x: dragPanStart.current.x + dx, y: dragPanStart.current.y + dy });
      }
    } else if (e.touches.length === 2 && lastPinchDist.current) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      setZoom(z => Math.max(0.35, Math.min(2.8, z * (dist / lastPinchDist.current!))));
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
        style={{ ...styles.viewport, cursor: robberMode ? 'crosshair' : selectedAction ? 'pointer' : 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { dragStart.current = null; }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onWheel={handleWheel}
      >
        <div style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: 'center center', willChange: 'transform' }}>
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
  container: { position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#6F4420' },
  viewport: { width: '100%', height: '100%', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none' },
  zoomControls: {
    position: 'absolute', bottom: 12, right: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
    background: 'rgba(40,25,10,0.85)', borderRadius: 12, padding: 6, zIndex: 10, border: '1px solid rgba(255,220,150,0.2)',
  },
  zoomBtn: {
    width: 40, height: 40, border: '1px solid rgba(255,220,150,0.25)', borderRadius: 10, background: '#3d2814',
    color: '#f5e6c8', fontSize: 20, fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  zoomLabel: { fontSize: 10, color: '#c9b896', textAlign: 'center', minWidth: 36 },
};

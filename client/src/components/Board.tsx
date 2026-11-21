import { useRef, useEffect, useState, useCallback } from 'react';
import type { GameState, Intersection, Edge, ResourceType, PlayerColor } from '../game/types';
import {
  hexToPixel,
  pixelToHex,
  getHexCorners,
  getPortIntersections,
  canPlaceSettlement,
  canPlaceRoad,
  getEdgesForIntersection,
} from '../game/board';
import { getCurrentPlayer } from '../game/rules';
import { sfx } from '../audio';

export interface PendingPlacement {
  kind: 'settlement' | 'city' | 'road';
  key: string;
  label?: string;
}

const PLAYER_COLORS: Record<string, string> = {
  red: '#d32f2f',
  blue: '#1976d2',
  white: '#f5f5f5',
  orange: '#f57c00',
};

/** Cohesive 3D miniature top-down terrain textures (full-bleed, no borders). */
const HEX_IMAGES: Record<string, string> = {
  lumber: '/assets/hex-lumber.jpg',
  brick: '/assets/hex-brick.jpg',
  wool: '/assets/hex-wool.jpg',
  grain: '/assets/hex-grain.jpg',
  ore: '/assets/hex-ore.jpg',
  desert: '/assets/hex-desert.jpg',
};

const RESOURCE_EMOJI: Record<ResourceType, string> = {
  lumber: '🌲',
  brick: '🧱',
  wool: '🐑',
  grain: '🌾',
  ore: '⛰️',
};

const RESOURCE_ACCENT: Record<string, { bg: string; border: string; text: string }> = {
  lumber: { bg: '#22542b', border: '#66bb6a', text: '#e8f5e9' },
  brick:  { bg: '#8c3318', border: '#ef8a5a', text: '#fff3e0' },
  wool:   { bg: '#477624', border: '#aed581', text: '#f1f8e9' },
  grain:  { bg: '#8a6408', border: '#ffd54f', text: '#fffde7' },
  ore:    { bg: '#37474f', border: '#90a4ae', text: '#eceff1' },
  '3:1':  { bg: '#4e3418', border: '#e5be6a', text: '#fff8e1' },
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Darker / lighter variants for 3D piece faces + crisp high-contrast rim */
const PLAYER_SHADE: Record<string, { mid: string; dark: string; light: string; edge: string; rim: string }> = {
  red:    { mid: '#d83232', dark: '#8b1616', light: '#ff6659', edge: '#4a0808', rim: '#1a0606' },
  blue:   { mid: '#1e80e0', dark: '#0d47a1', light: '#64b5f6', edge: '#062454', rim: '#04122b' },
  white:  { mid: '#f2f0ea', dark: '#b8b3a8', light: '#ffffff', edge: '#4d4840', rim: '#1c1814' },
  orange: { mid: '#f57c00', dark: '#a84b00', light: '#ffb74d', edge: '#5c2400', rim: '#261000' },
};

const TERRAIN_FALLBACK: Record<string, { base: string; mid: string; deep: string; accent: string }> = {
  lumber: { base: '#2f6e33', mid: '#214f24', deep: '#163618', accent: '#589e5c' },
  brick:  { base: '#c4683b', mid: '#9c4c27', deep: '#6e3216', accent: '#e08d63' },
  wool:   { base: '#7cb342', mid: '#5c8c2c', deep: '#3e611c', accent: '#aed581' },
  grain:  { base: '#dca92a', mid: '#b58618', deep: '#7d5b0d', accent: '#f5cf6b' },
  ore:    { base: '#6b727d', mid: '#4c525c', deep: '#2e333b', accent: '#9aa2ad' },
  desert: { base: '#e2c78c', mid: '#c4a66a', deep: '#997d48', accent: '#f3dfb2' },
};

interface BoardProps {
  gameState: GameState;
  hexSize: number;
  onHexClick: (q: number, r: number) => void;
  onIntersectionClick: (key: string) => void;
  onEdgeClick: (key: string) => void;
  robberMode: boolean;
  selectedAction: string | null;
  isMyTurn?: boolean;
  pendingPlacement?: PendingPlacement | null;
  onConfirmPlacement?: () => void;
  onCancelPlacement?: () => void;
  debug?: boolean;
}

interface ProductionPop {
  x: number;
  y: number;
  resource: ResourceType;
  amount: number;
  color: PlayerColor;
}

/* ─── Geometry helpers ─────────────────────────────────────────────── */

function hexCorners(cx: number, cy: number, size: number) {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    pts.push({ x: cx + size * Math.cos(a), y: cy + size * Math.sin(a) });
  }
  return pts;
}

function flatHexCorners(cx: number, cy: number, radius: number) {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    pts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
  }
  return pts;
}

function tracePoly(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
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

function shadeHex(hex: string, amount: number): string {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + amount * 255)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function shadesFor(color: string) {
  const key = Object.keys(PLAYER_COLORS).find(k => PLAYER_COLORS[k] === color);
  if (key && PLAYER_SHADE[key]) return PLAYER_SHADE[key];
  return {
    mid: color,
    dark: shadeHex(color, -0.25),
    light: shadeHex(color, 0.2),
    edge: shadeHex(color, -0.45),
    rim: '#120d08',
  };
}

/* ─── Hexagonal Sea Frame & True Hex Coastline ─────────────────────── */

function drawHexSeaFrame(ctx: CanvasRenderingContext2D, size: number, W: number, H: number) {
  const cx = W / 2;
  const cy = H / 2;
  const outerR = size * 5.56;
  const innerR = size * 5.20;
  const outerPts = flatHexCorners(cx, cy, outerR);
  const innerPts = flatHexCorners(cx, cy, innerR);

  // Tabletop drop shadow under the wooden Catan frame
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.62)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 10;
  tracePoly(ctx, outerPts);
  ctx.fillStyle = '#3b210d';
  ctx.fill();
  ctx.restore();

  // Carved walnut & antique brass hexagonal frame
  const woodGrad = ctx.createLinearGradient(cx - outerR, cy - outerR * 0.85, cx + outerR, cy + outerR * 0.85);
  woodGrad.addColorStop(0, '#8b572a');
  woodGrad.addColorStop(0.28, '#663c1a');
  woodGrad.addColorStop(0.65, '#4c2a10');
  woodGrad.addColorStop(1, '#311a08');
  tracePoly(ctx, outerPts);
  ctx.fillStyle = woodGrad;
  ctx.fill();

  // Beveled outer brass trim
  ctx.save();
  tracePoly(ctx, outerPts);
  ctx.strokeStyle = 'rgba(235, 192, 108, 0.55)';
  ctx.lineWidth = 2.4;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Subtle top-left bevel highlight on wooden frame
  ctx.beginPath();
  ctx.moveTo(outerPts[3].x, outerPts[3].y);
  ctx.lineTo(outerPts[4].x, outerPts[4].y);
  ctx.lineTo(outerPts[5].x, outerPts[5].y);
  ctx.lineTo(outerPts[0].x, outerPts[0].y);
  ctx.strokeStyle = 'rgba(255, 228, 170, 0.25)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();

  // Inner ocean basin clipped to the inner hex frame
  ctx.save();
  tracePoly(ctx, innerPts);
  ctx.clip();

  const seaGrad = ctx.createRadialGradient(
    cx - size * 0.7, cy - size * 0.7, size * 0.5,
    cx, cy, innerR * 1.05,
  );
  seaGrad.addColorStop(0, '#5ec2e8');
  seaGrad.addColorStop(0.42, '#2889c4');
  seaGrad.addColorStop(0.76, '#155c91');
  seaGrad.addColorStop(1, '#0b3960');
  ctx.fillStyle = seaGrad;
  ctx.fillRect(cx - innerR, cy - innerR, innerR * 2, innerR * 2);

  // Subtle nautical compass/chart lines in deep water
  ctx.strokeStyle = 'rgba(220, 245, 255, 0.06)';
  ctx.lineWidth = 1.1;
  for (let i = 0; i < 12; i++) {
    const a = (Math.PI / 6) * i;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * size * 3.8, cy + Math.sin(a) * size * 3.8);
    ctx.lineTo(cx + Math.cos(a) * innerR, cy + Math.sin(a) * innerR);
    ctx.stroke();
  }
  for (const rMul of [4.15, 4.65, 5.02]) {
    ctx.beginPath();
    ctx.arc(cx, cy, size * rMul, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Soft ocean wave arcs
  ctx.strokeStyle = 'rgba(235, 250, 255, 0.14)';
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  for (let i = 0; i < 42; i++) {
    const ang = (i / 42) * Math.PI * 2 + 0.17;
    const dist = size * (4.12 + (i % 4) * 0.24);
    const wx = cx + Math.cos(ang) * dist;
    const wy = cy + Math.sin(ang) * dist * 0.92;
    ctx.beginPath();
    ctx.arc(wx, wy, size * 0.14, 0.25, Math.PI - 0.25);
    ctx.stroke();
  }

  ctx.restore();

  // Inner recessed sea-frame bevel (shadow + brass inlay)
  ctx.save();
  tracePoly(ctx, innerPts);
  ctx.strokeStyle = 'rgba(8, 22, 36, 0.65)';
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.stroke();

  tracePoly(ctx, innerPts);
  ctx.strokeStyle = 'rgba(222, 178, 96, 0.45)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();
}

/**
 * True hexagonal island coastline: draws layered shallow turquoise water,
 * white coastal surf foam, and warm golden sandy shoreline hugging the
 * exact 19-hex island silhouette (no mismatched circle!).
 */
function drawIslandCoastline(
  ctx: CanvasRenderingContext2D,
  board: { q: number; r: number }[],
  size: number,
  W: number,
  H: number,
) {
  const centers = board.map(t => {
    const p = hexToPixel(t.q, t.r, size);
    return { x: p.x + W / 2, y: p.y + H / 2 };
  });

  // 1. Shallow turquoise water halo
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.fillStyle = 'rgba(110, 214, 240, 0.34)';
  ctx.strokeStyle = 'rgba(130, 226, 248, 0.28)';
  ctx.lineWidth = size * 0.14;
  for (const c of centers) {
    const pts = hexCorners(c.x, c.y, size * 1.24);
    tracePoly(ctx, pts);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

  // 2. Soft coastal surf / foam rim
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.fillStyle = 'rgba(232, 249, 255, 0.46)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = size * 0.05;
  for (const c of centers) {
    const pts = hexCorners(c.x, c.y, size * 1.13);
    tracePoly(ctx, pts);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

  // 3. Warm golden sandy beach shelf hugging every hex edge
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(8, 35, 60, 0.35)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = '#e7cf96';
  ctx.strokeStyle = '#c8aa6d';
  ctx.lineWidth = size * 0.04;
  for (const c of centers) {
    const pts = hexCorners(c.x, c.y, size * 1.07);
    tracePoly(ctx, pts);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/* ─── Full-Bleed Miniature Terrain Hex Tiles ───────────────────────── */

function drawTerrainHex(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, size: number,
  q: number, r: number,
  type: string,
  hasRobber: boolean,
  img: HTMLImageElement | null,
) {
  const fb = TERRAIN_FALLBACK[type] || TERRAIN_FALLBACK.desert;
  const pts = hexCorners(cx, cy, size);
  const hasArt = !!(img && img.complete && img.naturalWidth > 0);

  ctx.save();
  tracePoly(ctx, pts);
  ctx.clip();

  if (hasArt) {
    // Full-bleed miniature diorama art — deterministic crop offset per (q,r)
    // keeps identical terrain tiles distinct while preserving top-left lighting!
    const hash = Math.abs(q * 31 + r * 17 + q * r * 7);
    const ox = ((hash % 5) - 2) * size * 0.06;
    const oy = ((Math.floor(hash / 5) % 5) - 2) * size * 0.06;
    const drawS = size * 2.30;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img!, cx - drawS / 2 + ox, cy - drawS / 2 + oy, drawS, drawS);

    // Subtle tabletop directional lighting overlay
    const sheen = ctx.createLinearGradient(cx - size, cy - size, cx + size * 0.7, cy + size);
    sheen.addColorStop(0, 'rgba(255, 248, 225, 0.14)');
    sheen.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
    sheen.addColorStop(1, 'rgba(15, 8, 2, 0.18)');
    tracePoly(ctx, pts);
    ctx.fillStyle = sheen;
    ctx.fill();
  } else {
    const rg = ctx.createRadialGradient(cx - size * 0.25, cy - size * 0.25, size * 0.05, cx, cy, size * 1.1);
    rg.addColorStop(0, fb.accent);
    rg.addColorStop(0.5, fb.base);
    rg.addColorStop(1, fb.deep);
    ctx.fillStyle = rg;
    ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
  }

  // Mood shadow when robber occupies this tile
  if (hasRobber) {
    const darkV = ctx.createRadialGradient(cx, cy, size * 0.15, cx, cy, size * 1.05);
    darkV.addColorStop(0, 'rgba(15, 8, 12, 0.28)');
    darkV.addColorStop(1, 'rgba(28, 6, 10, 0.56)');
    ctx.fillStyle = darkV;
    ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
  }

  ctx.restore();

  // Subtle carved tile bevel + warm wood grout seam
  ctx.save();
  for (let i = 0; i < 6; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 6];
    const isLit = (a.y + b.y) / 2 < cy || (a.x + b.x) / 2 < cx - size * 0.35;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = isLit ? 'rgba(255, 245, 220, 0.24)' : 'rgba(18, 10, 4, 0.38)';
    ctx.lineWidth = isLit ? 1.4 : 1.8;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  tracePoly(ctx, pts);
  ctx.strokeStyle = hasRobber ? 'rgba(229, 57, 53, 0.75)' : 'rgba(42, 26, 12, 0.62)';
  ctx.lineWidth = hasRobber ? 2.6 : 1.8;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

/* ─── Number Tokens (Bold 6/8 emphasis + robber-blocked style) ─────── */

function drawNumberToken(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, size: number,
  num: number,
  blocked: boolean,
) {
  const isHot = num === 6 || num === 8;
  const r = size * (isHot ? 0.335 : 0.305);

  ctx.save();
  ctx.globalAlpha = blocked ? 0.82 : 1;

  // Ground drop shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.52)';
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#e8dec2';
  ctx.fill();
  ctx.restore();

  // Warm ceramic ivory disc
  const g = ctx.createRadialGradient(cx - r * 0.32, cy - r * 0.36, r * 0.08, cx, cy, r);
  if (blocked) {
    g.addColorStop(0, '#dcd4c4');
    g.addColorStop(0.65, '#b8ae9c');
    g.addColorStop(1, '#8c8070');
  } else {
    g.addColorStop(0, '#fffef9');
    g.addColorStop(0.55, '#f5ecd4');
    g.addColorStop(0.88, '#e0d1ab');
    g.addColorStop(1, '#bfa97c');
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  // Outer rim (crimson accent for 6 & 8, dashed red if blocked)
  ctx.strokeStyle = blocked ? '#b71c1c' : isHot ? '#b71c1c' : '#7a5f38';
  ctx.lineWidth = isHot ? 2.8 : 2.2;
  ctx.stroke();

  // Inner specular highlight ring
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.52)';
  ctx.lineWidth = 1.1;
  ctx.stroke();

  // Numeral
  ctx.fillStyle = blocked ? '#4a3030' : isHot ? '#c62828' : '#1f1912';
  ctx.font = `900 ${size * (isHot ? 0.38 : 0.34)}px Georgia, 'Times New Roman', serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(num), cx, cy - r * 0.11);

  // Probability pips
  const pips = num <= 7 ? num - 1 : 13 - num;
  const pipR = Math.max(1.5, size * (isHot ? 0.043 : 0.038));
  ctx.fillStyle = blocked ? '#6d4c4c' : isHot ? '#c62828' : '#3a2f22';
  const pipY = cy + r * 0.48;
  const spacing = pipR * 2.75;
  const startX = cx - ((pips - 1) * spacing) / 2;
  for (let p = 0; p < pips; p++) {
    ctx.beginPath();
    ctx.arc(startX + p * spacing, pipY, pipR, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/* ─── Robber — Sculpted obsidian hooded meeple offset beside token ─── */

function drawRobber(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const s = size * 0.44;
  ctx.save();

  // Ground cast shadow
  ctx.fillStyle = 'rgba(0,0,0,0.52)';
  ctx.beginPath();
  ctx.ellipse(cx + 2, cy + s * 0.72, s * 0.56, s * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  // Subtle crimson pedestal ring so robber stands out on dark terrain
  ctx.beginPath();
  ctx.ellipse(cx, cy + s * 0.66, s * 0.48, s * 0.18, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#2b1214';
  ctx.fill();
  ctx.strokeStyle = 'rgba(239, 83, 80, 0.75)';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // Sculpted dark obsidian pawn body
  const bodyG = ctx.createLinearGradient(cx - s * 0.45, cy, cx + s * 0.45, cy);
  bodyG.addColorStop(0, '#0c0c10');
  bodyG.addColorStop(0.32, '#2d2e36');
  bodyG.addColorStop(0.54, '#474954');
  bodyG.addColorStop(1, '#111116');

  ctx.fillStyle = bodyG;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.40, cy + s * 0.64);
  ctx.quadraticCurveTo(cx - s * 0.38, cy + s * 0.05, cx - s * 0.26, cy - s * 0.20);
  ctx.lineTo(cx + s * 0.26, cy - s * 0.20);
  ctx.quadraticCurveTo(cx + s * 0.38, cy + s * 0.05, cx + s * 0.40, cy + s * 0.64);
  ctx.closePath();
  ctx.fill();

  // Cloak collar
  ctx.beginPath();
  ctx.ellipse(cx, cy - s * 0.18, s * 0.30, s * 0.10, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#1e1f26';
  ctx.fill();

  // Hooded head
  ctx.fillStyle = bodyG;
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.46, s * 0.30, 0, Math.PI * 2);
  ctx.fill();

  // Crisp bright rim-light for instant silhouette legibility
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx - s * 0.04, cy - s * 0.48, s * 0.25, Math.PI * 0.9, Math.PI * 1.65);
  ctx.stroke();

  // Outer silhouette edge
  ctx.strokeStyle = 'rgba(255, 230, 210, 0.22)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.40, cy + s * 0.64);
  ctx.quadraticCurveTo(cx - s * 0.38, cy + s * 0.05, cx - s * 0.26, cy - s * 0.20);
  ctx.moveTo(cx + s * 0.40, cy + s * 0.64);
  ctx.quadraticCurveTo(cx + s * 0.38, cy + s * 0.05, cx + s * 0.26, cy - s * 0.20);
  ctx.stroke();

  ctx.restore();
}

/* ─── High-Contrast 3D Settlement Cottage ──────────────────────────── */

function drawSettlement(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  color: string, size: number,
  alpha = 1,
) {
  const s = size * 0.29;
  const sh = shadesFor(color);
  const dx = s * 0.30;
  const dy = s * 0.36;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Ground shadow + dark contact pedestal so white/orange pop on every tile
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.ellipse(cx + dx * 0.28, cy + s * 0.72, s * 1.06, s * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();

  const fl = { x: cx - s * 0.70, y: cy + s * 0.08 };
  const fr = { x: cx + s * 0.70, y: cy + s * 0.08 };
  const bl = { x: cx - s * 0.70, y: cy + s * 0.68 };
  const br = { x: cx + s * 0.70, y: cy + s * 0.68 };
  const peak = { x: cx, y: cy - s * 0.80 };

  // Dark outer silhouette halo for crisp terrain separation
  ctx.save();
  ctx.strokeStyle = sh.rim;
  ctx.lineWidth = 3.4;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(bl.x, bl.y);
  ctx.lineTo(fl.x, fl.y);
  ctx.lineTo(peak.x, peak.y);
  ctx.lineTo(peak.x + dx * 0.65, peak.y + dy * 0.35);
  ctx.lineTo(fr.x + dx, fr.y + dy * 0.35);
  ctx.lineTo(br.x + dx, br.y + dy * 0.35);
  ctx.lineTo(br.x, br.y);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  // Right wall extrusion
  ctx.fillStyle = sh.dark;
  ctx.beginPath();
  ctx.moveTo(fr.x, fr.y);
  ctx.lineTo(fr.x + dx, fr.y + dy * 0.35);
  ctx.lineTo(br.x + dx, br.y + dy * 0.35);
  ctx.lineTo(br.x, br.y);
  ctx.closePath();
  ctx.fill();

  // Right roof plane
  ctx.fillStyle = shadeHex(sh.dark, 0.04);
  ctx.beginPath();
  ctx.moveTo(peak.x, peak.y);
  ctx.lineTo(peak.x + dx * 0.65, peak.y + dy * 0.35);
  ctx.lineTo(fr.x + dx, fr.y + dy * 0.35);
  ctx.lineTo(fr.x, fr.y);
  ctx.closePath();
  ctx.fill();

  // Front wall
  const wallG = ctx.createLinearGradient(fl.x, cy, fr.x, cy);
  wallG.addColorStop(0, sh.mid);
  wallG.addColorStop(0.45, sh.light);
  wallG.addColorStop(1, sh.mid);
  ctx.fillStyle = wallG;
  ctx.beginPath();
  ctx.moveTo(fl.x, fl.y);
  ctx.lineTo(fr.x, fr.y);
  ctx.lineTo(br.x, br.y);
  ctx.lineTo(bl.x, bl.y);
  ctx.closePath();
  ctx.fill();

  // Front gable roof (lit left, slightly shaded right)
  ctx.fillStyle = sh.light;
  ctx.beginPath();
  ctx.moveTo(fl.x - s * 0.08, fl.y + s * 0.04);
  ctx.lineTo(peak.x, peak.y);
  ctx.lineTo(cx, fl.y + s * 0.04);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = sh.mid;
  ctx.beginPath();
  ctx.moveTo(fr.x + s * 0.08, fr.y + s * 0.04);
  ctx.lineTo(peak.x, peak.y);
  ctx.lineTo(cx, fl.y + s * 0.04);
  ctx.closePath();
  ctx.fill();

  // Bold arched doorway
  ctx.fillStyle = 'rgba(18, 10, 4, 0.58)';
  roundRect(ctx, cx - s * 0.17, cy + s * 0.24, s * 0.34, s * 0.44, s * 0.15);
  ctx.fill();

  // Roof ridge highlight
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(fl.x, fl.y);
  ctx.lineTo(peak.x, peak.y);
  ctx.stroke();

  // Crisp inner edge outline
  ctx.strokeStyle = sh.edge;
  ctx.lineWidth = 1.2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(bl.x, bl.y);
  ctx.lineTo(fl.x, fl.y);
  ctx.lineTo(peak.x, peak.y);
  ctx.lineTo(fr.x, fr.y);
  ctx.lineTo(br.x, br.y);
  ctx.closePath();
  ctx.stroke();

  ctx.restore();
}

/* ─── High-Contrast 3D City Fortress / Crenellated Castle Keep ─────── */

function drawCity(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  color: string, size: number,
  alpha = 1,
) {
  const s = size * 0.34;
  const sh = shadesFor(color);
  const dx = s * 0.26;
  const dy = s * 0.24;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.48)';
  ctx.beginPath();
  ctx.ellipse(cx + dx * 0.4, cy + s * 0.74, s * 1.28, s * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();

  const drawCrenellatedBox = (x: number, y: number, w: number, h: number, merlons: number) => {
    const merlonH = s * 0.22;
    const step = w / (merlons * 2 - 1);

    // Dark silhouette stroke
    ctx.save();
    ctx.strokeStyle = sh.rim;
    ctx.lineWidth = 3.2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.stroke();
    ctx.restore();

    // Right 3D extruded wall
    ctx.fillStyle = sh.dark;
    ctx.beginPath();
    ctx.moveTo(x + w, y);
    ctx.lineTo(x + w + dx, y - dy * 0.5);
    ctx.lineTo(x + w + dx, y + h - dy * 0.5);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = sh.rim;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // Front wall gradient
    const g = ctx.createLinearGradient(x, y, x + w, y);
    g.addColorStop(0, sh.light);
    g.addColorStop(0.55, sh.mid);
    g.addColorStop(1, sh.dark);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);

    // Crenellations / battlements along top edge
    for (let m = 0; m < merlons; m++) {
      const mx = x + m * step * 2;
      // Top bevel of merlon
      ctx.fillStyle = sh.light;
      ctx.beginPath();
      ctx.moveTo(mx, y - merlonH);
      ctx.lineTo(mx + dx * 0.65, y - merlonH - dy * 0.45);
      ctx.lineTo(mx + step + dx * 0.65, y - merlonH - dy * 0.45);
      ctx.lineTo(mx + step, y - merlonH);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = sh.rim;
      ctx.lineWidth = 1.1;
      ctx.stroke();

      // Right side of merlon
      ctx.fillStyle = sh.dark;
      ctx.beginPath();
      ctx.moveTo(mx + step, y - merlonH);
      ctx.lineTo(mx + step + dx * 0.65, y - merlonH - dy * 0.45);
      ctx.lineTo(mx + step + dx * 0.65, y - dy * 0.45);
      ctx.lineTo(mx + step, y);
      ctx.closePath();
      ctx.fill();

      // Front of merlon
      ctx.fillStyle = sh.mid;
      ctx.fillRect(mx, y - merlonH, step, merlonH);
      ctx.strokeStyle = sh.edge;
      ctx.lineWidth = 1.1;
      ctx.strokeRect(mx, y - merlonH, step, merlonH);
    }

    // Wall outline
    ctx.strokeStyle = sh.edge;
    ctx.lineWidth = 1.3;
    ctx.strokeRect(x, y, w, h);
  };

  // Lower fortress bastion (left + full base)
  drawCrenellatedBox(cx - s * 0.92, cy - s * 0.02, s * 1.12, s * 0.72, 3);
  // Tall castle rook tower (right, higher)
  drawCrenellatedBox(cx + s * 0.02, cy - s * 0.78, s * 0.80, s * 1.48, 3);

  // Dark arched castle gate on lower hall
  ctx.fillStyle = 'rgba(14, 8, 4, 0.66)';
  roundRect(ctx, cx - s * 0.56, cy + s * 0.24, s * 0.34, s * 0.46, s * 0.16);
  ctx.fill();

  // Warm lit arrow-slit windows on keep tower
  ctx.fillStyle = 'rgba(255, 232, 150, 0.85)';
  roundRect(ctx, cx + s * 0.34, cy - s * 0.46, s * 0.15, s * 0.24, 2);
  ctx.fill();
  roundRect(ctx, cx + s * 0.34, cy - s * 0.06, s * 0.15, s * 0.24, 2);
  ctx.fill();

  // Subtle top highlight along left edge of tower
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.04, cy - s * 0.75);
  ctx.lineTo(cx + s * 0.04, cy + s * 0.68);
  ctx.stroke();

  ctx.restore();
}

/* ─── High-Contrast 3D Road Plank + Optional Longest Road Glow ─────── */

function drawRoad(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  color: string, size: number,
  isLongestRoad = false,
  alpha = 1,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;

  const inset = size * 0.19;
  const sx = x1 + ux * inset;
  const sy = y1 + uy * inset;
  const ex = x2 - ux * inset;
  const ey = y2 - uy * inset;

  const halfW = Math.max(4.8, size * 0.095);
  const depth = Math.max(3, size * 0.055);
  const sh = shadesFor(color);

  const t1x = sx + px * halfW, t1y = sy + py * halfW;
  const t2x = sx - px * halfW, t2y = sy - py * halfW;
  const t3x = ex - px * halfW, t3y = ey - py * halfW;
  const t4x = ex + px * halfW, t4y = ey + py * halfW;
  const ox = depth * 0.3;
  const oy = depth * 0.9;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Subtle golden under-glow for Longest Road holder
  if (isLongestRoad) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 215, 64, 0.55)';
    ctx.lineWidth = halfW * 3.1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.restore();
  }

  // Dark contrast drop shadow
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.beginPath();
  ctx.moveTo(t1x + 1.5, t1y + 3);
  ctx.lineTo(t2x + 1.5, t2y + 3);
  ctx.lineTo(t3x + 1.5, t3y + 3);
  ctx.lineTo(t4x + 1.5, t4y + 3);
  ctx.closePath();
  ctx.fill();

  // Extruded side face
  ctx.fillStyle = sh.dark;
  ctx.beginPath();
  ctx.moveTo(t2x, t2y);
  ctx.lineTo(t3x, t3y);
  ctx.lineTo(t3x + ox, t3y + oy);
  ctx.lineTo(t2x + ox, t2y + oy);
  ctx.closePath();
  ctx.fill();

  // Top face
  const topG = ctx.createLinearGradient(t1x, t1y, t2x, t2y);
  topG.addColorStop(0, sh.light);
  topG.addColorStop(0.5, sh.mid);
  topG.addColorStop(1, sh.dark);
  ctx.fillStyle = topG;
  ctx.beginPath();
  ctx.moveTo(t1x, t1y);
  ctx.lineTo(t2x, t2y);
  ctx.lineTo(t3x, t3y);
  ctx.lineTo(t4x, t4y);
  ctx.closePath();
  ctx.fill();

  // Highlight along lit edge
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(t1x, t1y);
  ctx.lineTo(t4x, t4y);
  ctx.stroke();

  // Crisp dark rim so White/Orange roads pop over light tiles
  ctx.strokeStyle = sh.rim;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(t1x, t1y);
  ctx.lineTo(t2x, t2y);
  ctx.lineTo(t3x, t3y);
  ctx.lineTo(t4x, t4y);
  ctx.closePath();
  ctx.stroke();

  ctx.restore();
}

/* ─── Custom Crisp Harbors (Color-coded medallions + resource icons) ─ */

function drawHarborIcon(ctx: CanvasRenderingContext2D, res: string, x: number, y: number, r: number) {
  ctx.save();
  if (res === '3:1') {
    ctx.fillStyle = '#ffe082';
    ctx.font = `900 ${r * 1.15}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', x, y + r * 0.05);
  } else if (res === 'lumber') {
    // Crisp pine tree
    ctx.fillStyle = '#a5d6a7';
    ctx.beginPath();
    ctx.moveTo(x, y - r * 0.62);
    ctx.lineTo(x + r * 0.45, y + r * 0.05);
    ctx.lineTo(x + r * 0.18, y + r * 0.05);
    ctx.lineTo(x + r * 0.50, y + r * 0.46);
    ctx.lineTo(x - r * 0.50, y + r * 0.46);
    ctx.lineTo(x - r * 0.18, y + r * 0.05);
    ctx.lineTo(x - r * 0.45, y + r * 0.05);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#d7ccc8';
    ctx.fillRect(x - r * 0.10, y + r * 0.44, r * 0.20, r * 0.22);
  } else if (res === 'brick') {
    // Stacked bricks
    ctx.fillStyle = '#ffab91';
    const bw = r * 0.44;
    const bh = r * 0.24;
    roundRect(ctx, x - bw - 1, y + r * 0.14, bw, bh, 1.5); ctx.fill();
    roundRect(ctx, x + 1, y + r * 0.14, bw, bh, 1.5); ctx.fill();
    roundRect(ctx, x - bw * 0.5, y - bh + r * 0.08, bw, bh, 1.5); ctx.fill();
    roundRect(ctx, x - bw * 0.5, y - bh * 2 + r * 0.02, bw, bh, 1.5); ctx.fill();
  } else if (res === 'wool') {
    // Fluffy sheep silhouette (larger & higher contrast for phone screens)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x - r * 0.24, y + r * 0.04, r * 0.28, 0, Math.PI * 2);
    ctx.arc(x + r * 0.02, y - r * 0.12, r * 0.30, 0, Math.PI * 2);
    ctx.arc(x + r * 0.10, y + r * 0.18, r * 0.28, 0, Math.PI * 2);
    ctx.arc(x - r * 0.12, y + r * 0.22, r * 0.26, 0, Math.PI * 2);
    ctx.fill();
    // Little dark sheep head & ears
    ctx.fillStyle = '#1c2429';
    ctx.beginPath();
    ctx.ellipse(x + r * 0.38, y + r * 0.02, r * 0.20, r * 0.16, 0.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (res === 'grain') {
    // Golden wheat sheaf
    ctx.strokeStyle = '#ffe082';
    ctx.lineWidth = Math.max(1.5, r * 0.12);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y + r * 0.55);
    ctx.lineTo(x, y - r * 0.48);
    ctx.stroke();
    ctx.fillStyle = '#ffd54f';
    for (let i = 0; i < 3; i++) {
      const yy = y + r * 0.18 - i * r * 0.24;
      ctx.beginPath();
      ctx.ellipse(x - r * 0.22, yy, r * 0.11, r * 0.20, -0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + r * 0.22, yy, r * 0.11, r * 0.20, 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (res === 'ore') {
    // Snow-capped mountain peaks
    ctx.fillStyle = '#cfd8dc';
    ctx.beginPath();
    ctx.moveTo(x - r * 0.58, y + r * 0.44);
    ctx.lineTo(x - r * 0.12, y - r * 0.52);
    ctx.lineTo(x + r * 0.26, y + r * 0.44);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#90a4ae';
    ctx.beginPath();
    ctx.moveTo(x - r * 0.04, y + r * 0.44);
    ctx.lineTo(x + r * 0.30, y - r * 0.26);
    ctx.lineTo(x + r * 0.60, y + r * 0.44);
    ctx.closePath();
    ctx.fill();
    // Snow cap
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(x - r * 0.12, y - r * 0.52);
    ctx.lineTo(x - r * 0.26, y - r * 0.18);
    ctx.lineTo(x - r * 0.02, y - r * 0.18);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

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

  let ox = edgeMx - centerX;
  let oy = edgeMy - centerY;
  const olen = Math.hypot(ox, oy) || 1;
  ox /= olen;
  oy /= olen;

  const pierLen = size * 0.80;
  const px = edgeMx + ox * pierLen;
  const py = edgeMy + oy * pierLen;

  const isGeneric = portType === '3:1';
  const resKey = isGeneric ? '3:1' : portType.split(':')[2];
  const ratio = isGeneric ? '3:1' : '2:1';
  const palette = RESOURCE_ACCENT[resKey] || RESOURCE_ACCENT['3:1'];

  ctx.save();

  // Water ripples under dock
  ctx.strokeStyle = 'rgba(230, 248, 255, 0.28)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(px, py, size * 0.42, 0, Math.PI * 2);
  ctx.stroke();

  // Twin wooden pier walkways
  ctx.strokeStyle = 'rgba(25, 14, 4, 0.48)';
  ctx.lineWidth = Math.max(5.5, size * 0.095);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(px, py);
  ctx.lineTo(bx, by);
  ctx.stroke();

  const pierG = ctx.createLinearGradient(ax, ay, px, py);
  pierG.addColorStop(0, '#d2ae6d');
  pierG.addColorStop(1, '#8c642c');
  ctx.strokeStyle = pierG;
  ctx.lineWidth = Math.max(3, size * 0.055);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(px, py);
  ctx.lineTo(bx, by);
  ctx.stroke();

  // Tiny wooden dock posts on the two coastal vertices
  for (const [vx, vy] of [[ax, ay], [bx, by]]) {
    ctx.beginPath();
    ctx.arc(vx, vy, Math.max(2.6, size * 0.045), 0, Math.PI * 2);
    ctx.fillStyle = '#c49b57';
    ctx.fill();
    ctx.strokeStyle = '#4a3010';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Harbor medallion plaque
  const s = size * 0.34;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.48)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2.5;
  ctx.beginPath();
  ctx.arc(px, py, s, 0, Math.PI * 2);
  ctx.fillStyle = palette.bg;
  ctx.fill();
  ctx.restore();

  // Wood/brass outer bezel
  ctx.beginPath();
  ctx.arc(px, py, s, 0, Math.PI * 2);
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 2.6;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(px, py, s * 0.86, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Crisp resource icon (upper-center)
  drawHarborIcon(ctx, resKey, px, py - s * 0.24, s * 0.65);

  // Ratio pill at bottom of medallion
  ctx.fillStyle = 'rgba(12, 8, 4, 0.72)';
  roundRect(ctx, px - s * 0.56, py + s * 0.22, s * 1.12, s * 0.44, s * 0.22);
  ctx.fill();
  ctx.fillStyle = palette.text;
  ctx.font = `800 ${Math.max(9, size * 0.145)}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ratio, px, py + s * 0.44);

  ctx.restore();
}

/* ─── Intersection positions helper ────────────────────────────────── */

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

/* ─── Component ────────────────────────────────────────────────────── */

export default function Board({
  gameState,
  hexSize,
  onHexClick,
  onIntersectionClick,
  onEdgeClick,
  robberMode,
  selectedAction,
  isMyTurn = true,
  pendingPlacement = null,
  onConfirmPlacement,
  onCancelPlacement,
  debug = false,
}: BoardProps) {
  const MIN_ZOOM = 0.34;
  const MAX_ZOOM = 3.0;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fxCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showPieces, setShowPieces] = useState(false);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const fitZoomRef = useRef(1);
  const userTransformedRef = useRef(false);
  const [assetsReady, setAssetsReady] = useState(0);
  const imagesRef = useRef<Record<string, HTMLImageElement | null>>({});
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const dragPanStart = useRef<{ x: number; y: number } | null>(null);
  const pinchStart = useRef<{
    dist: number;
    zoom: number;
    panX: number;
    panY: number;
    midX: number;
    midY: number;
  } | null>(null);
  const didPan = useRef(false);
  const gestureWasMultiTouch = useRef(false);
  const lastTouchTime = useRef(0);
  const posCache = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Dice-roll production glow & floating +1/+2 badges state
  const rollAnimRef = useRef<{
    startMs: number;
    rolledNumber: number;
    pops: ProductionPop[];
  } | null>(null);
  const lastRollKeyRef = useRef<string>(
    gameState.dice
      ? `${gameState.dice[0]}-${gameState.dice[1]}-${gameState.currentTurn}-${gameState.round}`
      : '',
  );
  const lastCollectSfxRef = useRef<number>(0);
  const [rollAnimTick, setRollAnimTick] = useState(0);

  // Tightly centered canvas around the hexagonal wooden sea frame (no left tray)
  const CANVAS_W = hexSize * 12.1;
  const CANVAS_H = hexSize * 10.6;

  const clampPan = useCallback((x: number, y: number, z: number) => {
    const maxPanX = Math.max(80, (CANVAS_W * z) / 2);
    const maxPanY = Math.max(80, (CANVAS_H * z) / 2);
    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, x)),
      y: Math.max(-maxPanY, Math.min(maxPanY, y)),
    };
  }, [CANVAS_W, CANVAS_H]);

  const applyTransform = useCallback((nextZoom: number, nextPan: { x: number; y: number }) => {
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
    const p = clampPan(nextPan.x, nextPan.y, z);
    zoomRef.current = z;
    panRef.current = p;
    if (stageRef.current) {
      stageRef.current.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) scale(${z})`;
    }
    setZoom(z);
    setPan(p);
  }, [clampPan]);

  const computeFitView = useCallback(() => {
    const el = containerRef.current;
    if (!el) return { z: 1, p: { x: 0, y: 0 } };
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { z: 1, p: { x: 0, y: 0 } };
    const handBarPad = 62;
    const availW = Math.max(120, rect.width - 6);
    const availH = Math.max(120, rect.height - handBarPad);
    const fit = Math.min(availW / CANVAS_W, availH / CANVAS_H);
    const z = Math.max(MIN_ZOOM, Math.min(1.2, fit));
    const yShift = rect.height > 200 ? -20 : 0;
    return { z, p: { x: 0, y: yShift } };
  }, [CANVAS_W, CANVAS_H]);

  // Fit board to viewport on mount / resize until the user manually zooms/pans
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateFit = () => {
      const { z, p } = computeFitView();
      fitZoomRef.current = z;
      if (!userTransformedRef.current) {
        applyTransform(z, p);
      }
    };
    updateFit();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateFit);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', updateFit);
    return () => window.removeEventListener('resize', updateFit);
  }, [computeFitView, applyTransform]);

  // Preload all 6 full-bleed miniature terrain textures
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
      setAssetsReady(n => n + 1);
    })();
    return () => { cancelled = true; };
  }, []);

  // Detect new non-7 dice rolls and trigger producing-hex glow + floating pops
  useEffect(() => {
    if (!gameState.dice) return;
    const key = `${gameState.dice[0]}-${gameState.dice[1]}-${gameState.currentTurn}-${gameState.round}`;
    if (key === lastRollKeyRef.current) return;
    lastRollKeyRef.current = key;
    const total = gameState.dice[0] + gameState.dice[1];
    if (total === 7) return;

    const positions = posCache.current.size > 0
      ? posCache.current
      : buildIntersectionPositions(gameState.board, hexSize);
    const pops: ProductionPop[] = [];
    const W = CANVAS_W;
    const H = CANVAS_H;

    for (const tile of gameState.board) {
      if (tile.number !== total || tile.hasRobber) continue;
      if (tile.type === 'desert' || tile.type === 'water') continue;
      const res = tile.type as ResourceType;
      for (const cKey of getHexCorners(tile.q, tile.r)) {
        const inter = gameState.intersections[cKey];
        if (!inter?.owner || !inter.building) continue;
        const pos = positions.get(cKey);
        if (!pos) continue;
        pops.push({
          x: pos.x + W / 2,
          y: pos.y + H / 2,
          resource: res,
          amount: inter.building === 'city' ? 2 : 1,
          color: inter.owner,
        });
      }
    }

    rollAnimRef.current = {
      startMs: performance.now(),
      rolledNumber: total,
      pops,
    };
    setRollAnimTick(t => t + 1);
    if (pops.length > 0) {
      const now = performance.now();
      if (now - lastCollectSfxRef.current > 380) {
        lastCollectSfxRef.current = now;
        const count = pops.length;
        window.setTimeout(() => sfx.collect(count), 220);
      }
    }
  }, [gameState, hexSize, CANVAS_W, CANVAS_H]);

  // ── Base Static Board Canvas ──
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
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const W = CANVAS_W;
    const H = CANVAS_H;
    const positions = buildIntersectionPositions(gameState.board, hexSize);
    posCache.current = positions;

    ctx.clearRect(0, 0, W, H);
    drawHexSeaFrame(ctx, hexSize, W, H);
    drawIslandCoastline(ctx, gameState.board, hexSize, W, H);

    const [robQ, robR] = (gameState.robberHex || '').split(',').map(Number);

    // 1. Land hexes
    gameState.board.forEach(tile => {
      const { x, y } = hexToPixel(tile.q, tile.r, hexSize);
      const isRobber = tile.q === robQ && tile.r === robR;
      drawTerrainHex(
        ctx, x + W / 2, y + H / 2, hexSize,
        tile.q, tile.r,
        tile.type,
        isRobber,
        imagesRef.current[tile.type] || null,
      );
    });

    // 2. Harbors
    if (gameState.ports?.length) {
      const boardCx = W / 2;
      const boardCy = H / 2;
      gameState.ports.forEach(port => {
        const [ikA, ikB] = getPortIntersections(port);
        const pa = positions.get(ikA);
        const pb = positions.get(ikB);
        if (!pa || !pb) return;
        drawOfficialHarbor(
          ctx,
          pa.x + boardCx, pa.y + boardCy,
          pb.x + boardCx, pb.y + boardCy,
          boardCx, boardCy, hexSize, port.type,
        );
      });
    }

    // 3. Roads (with subtle golden glow for Longest Road holder)
    const longestColor = gameState.longestRoad?.color;
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
        edge.road === longestColor,
      );
    });

    // 4. Number tokens + Robber (robber offset cleanly beside token!)
    gameState.board.forEach(tile => {
      const { x, y } = hexToPixel(tile.q, tile.r, hexSize);
      const cx = x + W / 2;
      const cy = y + H / 2;
      const isRobber = tile.q === robQ && tile.r === robR;
      if (tile.number) {
        drawNumberToken(ctx, cx, cy, hexSize, tile.number, isRobber);
      }
      if (isRobber) {
        const rx = tile.number ? cx + hexSize * 0.36 : cx;
        const ry = tile.number ? cy + hexSize * 0.24 : cy + hexSize * 0.04;
        drawRobber(ctx, rx, ry, hexSize);
      }
    });

    // 5. Buildings (drawn above roads & number rims so settlements/cities sit cleanly on corners)
    Object.values(gameState.intersections).forEach((inter: Intersection) => {
      if (!inter.building) return;
      const pos = positions.get(inter.key);
      if (!pos) return;
      const cx = pos.x + W / 2;
      const cy = pos.y + H / 2;
      const col = PLAYER_COLORS[inter.owner || ''] || '#666';
      if (inter.building === 'city') {
        drawCity(ctx, cx, cy, col, hexSize);
      } else {
        drawSettlement(ctx, cx, cy, col, hexSize);
      }
    });

    // 6. Debug overlay
    if (debug) {
      ctx.save();
      ctx.font = `bold ${Math.max(9, hexSize * 0.16)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      Object.values(gameState.edges).forEach((edge: Edge) => {
        const a = positions.get(edge.from);
        const b = positions.get(edge.to);
        if (!a || !b) return;
        const mx = (a.x + b.x) / 2 + W / 2;
        const my = (a.y + b.y) / 2 + H / 2;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(mx - 14, my - 7, 28, 14);
        ctx.fillStyle = '#ffd54f';
        ctx.fillText(edge.key, mx, my);
      });

      Object.values(gameState.intersections).forEach((inter: Intersection) => {
        const pos = positions.get(inter.key);
        if (!pos) return;
        const cx = pos.x + W / 2;
        const cy = pos.y + H / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(3, hexSize * 0.05), 0, Math.PI * 2);
        ctx.fillStyle = '#00e5ff';
        ctx.fill();
        ctx.fillStyle = '#00e5ff';
        ctx.fillText(inter.key, cx, cy - hexSize * 0.22);
      });

      gameState.board.forEach(tile => {
        const { x, y } = hexToPixel(tile.q, tile.r, hexSize);
        const cx = x + W / 2;
        const cy = y + H / 2;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(cx - 30, cy - 16, 60, 32);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`${tile.q},${tile.r}`, cx, cy - 4);
        ctx.fillStyle = '#ff8a65';
        ctx.fillText(tile.type, cx, cy + 12);
      });

      ctx.restore();
    }
  }, [gameState, hexSize, CANVAS_W, CANVAS_H, assetsReady, debug]);

  // ── Animated FX Overlay Canvas (pulsing legal spots, ghost piece, roll glow + pops) ──
  useEffect(() => {
    const fx = fxCanvasRef.current;
    if (!fx) return;
    const ctx = fx.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    fx.width = CANVAS_W * dpr;
    fx.height = CANVAS_H * dpr;
    fx.style.width = `${CANVAS_W}px`;
    fx.style.height = `${CANVAS_H}px`;

    const W = CANVAS_W;
    const H = CANVAS_H;
    const positions = posCache.current.size > 0
      ? posCache.current
      : buildIntersectionPositions(gameState.board, hexSize);

    const current = getCurrentPlayer(gameState);
    const activeTurn = isMyTurn && !gameState.winner;
    const isSetupRoad = activeTurn && gameState.setupPhase && gameState.phase === 'setup_road';
    const isSetupSettlement = activeTurn && gameState.setupPhase && gameState.phase === 'setup_settlement';
    const isFreeRoad = activeTurn && !gameState.setupPhase && gameState.pendingDevAction === 'road_building' && gameState.pendingDevRoads > 0;
    const canBuildPhase = gameState.phase === 'build' || gameState.phase === 'trade';
    const isPlacingRoad = isSetupRoad || isFreeRoad || (activeTurn && !gameState.setupPhase && canBuildPhase && selectedAction === 'road');
    const isPlacingSettlement = isSetupSettlement || (activeTurn && !gameState.setupPhase && canBuildPhase && selectedAction === 'settlement');
    const isPlacingCity = activeTurn && !gameState.setupPhase && canBuildPhase && selectedAction === 'city';

    let setupSettlementKey: string | null = null;
    if (isSetupRoad && current) {
      const tagged = gameState.lastSetupSettlement;
      if (tagged && gameState.intersections[tagged]?.owner === current.color) {
        setupSettlementKey = tagged;
      } else {
        const mine = Object.values(gameState.intersections).filter(i => i.owner === current.color && i.building);
        const roadCountAt = (k: string) =>
          Object.values(gameState.edges).filter(e => e.road === current.color && (e.from === k || e.to === k)).length;
        setupSettlementKey = mine.find(s => roadCountAt(s.key) === 0)?.key ?? null;
      }
    }

    const validEdges: Edge[] = [];
    if (isPlacingRoad && current) {
      for (const edge of Object.values(gameState.edges)) {
        if (edge.road) continue;
        const ok = isSetupRoad
          ? (!!setupSettlementKey && (edge.from === setupSettlementKey || edge.to === setupSettlementKey))
          : canPlaceRoad(edge.key, current.color, gameState.edges, gameState.intersections);
        if (ok) validEdges.push(edge);
      }
    }

    const validSettlements: Intersection[] = [];
    if (isPlacingSettlement && current) {
      for (const inter of Object.values(gameState.intersections)) {
        if (inter.building) continue;
        const ok = canPlaceSettlement(inter.key, gameState.intersections, gameState.edges)
          && (isSetupSettlement || getEdgesForIntersection(inter.key, gameState.edges).some(e => e.road === current.color));
        if (ok) validSettlements.push(inter);
      }
    }

    const validCities: Intersection[] = [];
    if (isPlacingCity && current) {
      for (const inter of Object.values(gameState.intersections)) {
        if (inter.building === 'settlement' && inter.owner === current.color) {
          validCities.push(inter);
        }
      }
    }

    const hasInteractiveOverlay =
      robberMode ||
      validEdges.length > 0 ||
      validSettlements.length > 0 ||
      validCities.length > 0 ||
      !!pendingPlacement;

    const ROLL_DURATION_MS = 1750;
    const [robQ, robR] = (gameState.robberHex || '').split(',').map(Number);

    let rafId = 0;

    const drawFrame = (now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const pulse = 0.5 + 0.5 * Math.sin(now / 280);

      // 1. Dice-roll producing hex shimmer + rising resource pops
      const anim = rollAnimRef.current;
      let animRunning = false;
      if (anim) {
        const elapsed = now - anim.startMs;
        if (elapsed < ROLL_DURATION_MS) {
          animRunning = true;
          const p = elapsed / ROLL_DURATION_MS;
          const glowAlpha = Math.sin(p * Math.PI) * 0.85;

          // Golden glow around every producing hex
          for (const tile of gameState.board) {
            if (tile.number !== anim.rolledNumber || tile.hasRobber) continue;
            if (tile.type === 'desert' || tile.type === 'water') continue;
            const { x, y } = hexToPixel(tile.q, tile.r, hexSize);
            const pts = hexCorners(x + W / 2, y + H / 2, hexSize * 0.96);
            ctx.save();
            tracePoly(ctx, pts);
            ctx.fillStyle = `rgba(255, 224, 102, ${glowAlpha * 0.24})`;
            ctx.fill();
            ctx.strokeStyle = `rgba(255, 215, 64, ${glowAlpha})`;
            ctx.lineWidth = 4;
            ctx.lineJoin = 'round';
            ctx.stroke();
            ctx.restore();
          }

          // Floating +1 / +2 resource badges rising from producing settlements/cities
          const popAlpha = p < 0.2 ? p / 0.2 : p > 0.72 ? Math.max(0, (1 - p) / 0.28) : 1;
          const lift = p * hexSize * 0.65;
          for (const pop of anim.pops) {
            const px = pop.x;
            const py = pop.y - hexSize * 0.35 - lift;
            const label = `+${pop.amount} ${RESOURCE_EMOJI[pop.resource]}`;
            ctx.save();
            ctx.globalAlpha = popAlpha;
            ctx.font = `800 ${Math.max(12, hexSize * 0.20)}px system-ui, -apple-system, sans-serif`;
            const tw = ctx.measureText(label).width + 14;
            const th = Math.max(20, hexSize * 0.32);
            roundRect(ctx, px - tw / 2, py - th / 2, tw, th, th / 2);
            ctx.fillStyle = 'rgba(20, 12, 6, 0.90)';
            ctx.fill();
            ctx.strokeStyle = PLAYER_COLORS[pop.color] || '#ffd54f';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = '#fff8e1';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, px, py + 0.5);
            ctx.restore();
          }
        } else {
          rollAnimRef.current = null;
        }
      }

      // 2. Robber-target pulsing hex borders
      if (robberMode) {
        for (const tile of gameState.board) {
          if (tile.type === 'water' || (tile.q === robQ && tile.r === robR)) continue;
          const { x, y } = hexToPixel(tile.q, tile.r, hexSize);
          const pts = hexCorners(x + W / 2, y + H / 2, hexSize * 0.94);
          ctx.save();
          tracePoly(ctx, pts);
          ctx.strokeStyle = `rgba(255, 213, 79, ${0.38 + pulse * 0.45})`;
          ctx.lineWidth = 2.6 + pulse * 1.2;
          ctx.lineJoin = 'round';
          ctx.stroke();
          ctx.restore();
        }
      }

      // 3. Pulsing valid road slots
      for (const edge of validEdges) {
        if (pendingPlacement?.kind === 'road' && pendingPlacement.key === edge.key) continue;
        const a = positions.get(edge.from);
        const b = positions.get(edge.to);
        if (!a || !b) continue;
        ctx.save();
        ctx.strokeStyle = `rgba(255, 224, 130, ${0.48 + pulse * 0.42})`;
        ctx.lineWidth = Math.max(8, hexSize * (0.14 + pulse * 0.04));
        ctx.lineCap = 'round';
        ctx.setLineDash([7, 6]);
        ctx.beginPath();
        ctx.moveTo(a.x + W / 2, a.y + H / 2);
        ctx.lineTo(b.x + W / 2, b.y + H / 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // 4. Pulsing valid settlement corners
      for (const inter of validSettlements) {
        if (pendingPlacement?.kind === 'settlement' && pendingPlacement.key === inter.key) continue;
        const pos = positions.get(inter.key);
        if (!pos) continue;
        const cx = pos.x + W / 2;
        const cy = pos.y + H / 2;
        const r = Math.max(6.5, hexSize * (0.115 + pulse * 0.03));
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r + 3.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 215, 64, ${0.14 + pulse * 0.22})`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 232, 145, ${0.55 + pulse * 0.35})`;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }

      // 5. Pulsing valid city-upgrade rings
      for (const inter of validCities) {
        if (pendingPlacement?.kind === 'city' && pendingPlacement.key === inter.key) continue;
        const pos = positions.get(inter.key);
        if (!pos) continue;
        const cx = pos.x + W / 2;
        const cy = pos.y + H / 2;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(15, hexSize * (0.28 + pulse * 0.05)), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 215, 64, ${0.65 + pulse * 0.35})`;
        ctx.lineWidth = 3.2;
        ctx.stroke();
        ctx.restore();
      }

      // 6. Ghost Preview Piece right on the tapped spot!
      if (pendingPlacement && current) {
        const ghostColor = PLAYER_COLORS[current.color] || '#ffd54f';
        if (pendingPlacement.kind === 'road') {
          const edge = gameState.edges[pendingPlacement.key];
          if (edge) {
            const a = positions.get(edge.from);
            const b = positions.get(edge.to);
            if (a && b) {
              const ax = a.x + W / 2, ay = a.y + H / 2;
              const bx = b.x + W / 2, by = b.y + H / 2;
              ctx.save();
              ctx.strokeStyle = `rgba(255, 224, 102, ${0.55 + pulse * 0.4})`;
              ctx.lineWidth = Math.max(15, hexSize * 0.28);
              ctx.lineCap = 'round';
              ctx.beginPath();
              ctx.moveTo(ax, ay);
              ctx.lineTo(bx, by);
              ctx.stroke();
              ctx.restore();
              drawRoad(ctx, ax, ay, bx, by, ghostColor, hexSize, false, 0.82);
            }
          }
        } else {
          const pos = positions.get(pendingPlacement.key);
          if (pos) {
            const cx = pos.x + W / 2;
            const cy = pos.y + H / 2;
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, hexSize * (0.36 + pulse * 0.06), 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 215, 64, ${0.22 + pulse * 0.18})`;
            ctx.fill();
            ctx.strokeStyle = '#ffd54f';
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.restore();
            if (pendingPlacement.kind === 'city') {
              drawCity(ctx, cx, cy, ghostColor, hexSize, 0.86);
            } else {
              drawSettlement(ctx, cx, cy, ghostColor, hexSize, 0.86);
            }
          }
        }
      }

      if (hasInteractiveOverlay || animRunning) {
        rafId = window.requestAnimationFrame(drawFrame);
      }
    };

    if (hasInteractiveOverlay || rollAnimRef.current) {
      rafId = window.requestAnimationFrame(drawFrame);
    } else {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
    }

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [gameState, hexSize, CANVAS_W, CANVAS_H, selectedAction, robberMode, isMyTurn, pendingPlacement, rollAnimTick]);

  // ── Coordinate mapping & Hit-testing ──
  const screenToCanvas = useCallback((screenX: number, screenY: number) => {
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    const z = zoomRef.current;
    const p = panRef.current;
    const canvasDisplayW = CANVAS_W * z;
    const canvasDisplayH = CANVAS_H * z;
    const offsetX = (rect.width - canvasDisplayW) / 2 + p.x;
    const offsetY = (rect.height - canvasDisplayH) / 2 + p.y;
    return {
      x: (screenX - rect.left - offsetX) / z,
      y: (screenY - rect.top - offsetY) / z,
    };
  }, [CANVAS_W, CANVAS_H]);

  const handleInteraction = useCallback((clientX: number, clientY: number) => {
    const { x, y } = screenToCanvas(clientX, clientY);
    const W = CANVAS_W;
    const H = CANVAS_H;
    const z = zoomRef.current;
    const clickThreshold = Math.min(hexSize * 0.48, Math.max(18, 24 / z));
    const positions = posCache.current;

    if (robberMode) {
      const hex = pixelToHex(x - W / 2, y - H / 2, hexSize);
      const tile = gameState.board.find(t => t.q === hex.q && t.r === hex.r);
      if (tile && tile.type !== 'water') {
        onHexClick(hex.q, hex.r);
        return;
      }
    }

    const findNearestIntersection = (): string | null => {
      let bestKey: string | null = null;
      let bestDist = clickThreshold;
      for (const inter of Object.values(gameState.intersections)) {
        const pos = positions.get(inter.key);
        if (!pos) continue;
        const d = Math.hypot(x - (pos.x + W / 2), y - (pos.y + H / 2));
        if (d < bestDist) {
          bestDist = d;
          bestKey = inter.key;
        }
      }
      return bestKey;
    };

    const findNearestEdge = (): string | null => {
      let bestKey: string | null = null;
      let bestDist = clickThreshold;
      for (const edge of Object.values(gameState.edges)) {
        const a = positions.get(edge.from);
        const b = positions.get(edge.to);
        if (!a || !b) continue;
        const fx = a.x + W / 2, fy = a.y + H / 2, tx = b.x + W / 2, ty = b.y + H / 2;
        const dx = tx - fx, dy = ty - fy;
        const len2 = dx * dx + dy * dy || 1;
        let t = ((x - fx) * dx + (y - fy) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(x - (fx + t * dx), y - (fy + t * dy));
        if (d < bestDist) {
          bestDist = d;
          bestKey = edge.key;
        }
      }
      return bestKey;
    };

    const roadMode = (gameState.setupPhase && gameState.phase === 'setup_road')
      || selectedAction === 'road'
      || (gameState.pendingDevAction === 'road_building' && gameState.pendingDevRoads > 0);

    if (roadMode) {
      const edgeKey = findNearestEdge();
      if (edgeKey) {
        onEdgeClick(edgeKey);
        return;
      }
    }

    const interKey = findNearestIntersection();
    if (interKey) {
      onIntersectionClick(interKey);
      return;
    }

    const edgeKey = findNearestEdge();
    if (edgeKey) {
      onEdgeClick(edgeKey);
      return;
    }

    const hex = pixelToHex(x - W / 2, y - H / 2, hexSize);
    if (gameState.board.find(t => t.q === hex.q && t.r === hex.r)) onHexClick(hex.q, hex.r);
  }, [gameState, hexSize, CANVAS_W, CANVAS_H, screenToCanvas, onIntersectionClick, onEdgeClick, onHexClick, robberMode, selectedAction]);

  const handleInteractionRef = useRef(handleInteraction);
  useEffect(() => {
    handleInteractionRef.current = handleInteraction;
  }, [handleInteraction]);

  // Native non-passive touch & wheel listeners (focal-point pinch zoom + pan)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const midpointRelative = (t0: Touch, t1: Touch) => {
      const rect = el.getBoundingClientRect();
      return {
        mx: (t0.clientX + t1.clientX) / 2 - (rect.left + rect.width / 2),
        my: (t0.clientY + t1.clientY) / 2 - (rect.top + rect.height / 2),
      };
    };

    const startPinch = (t0: Touch, t1: Touch) => {
      const dist = Math.max(10, Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY));
      const { mx, my } = midpointRelative(t0, t1);
      pinchStart.current = {
        dist,
        zoom: zoomRef.current,
        panX: panRef.current.x,
        panY: panRef.current.y,
        midX: mx,
        midY: my,
      };
      dragStart.current = null;
      dragPanStart.current = null;
      gestureWasMultiTouch.current = true;
      didPan.current = true;
    };

    const onTouchStart = (e: TouchEvent) => {
      lastTouchTime.current = Date.now();
      if (e.touches.length === 1) {
        dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        dragPanStart.current = { ...panRef.current };
        pinchStart.current = null;
        didPan.current = false;
        gestureWasMultiTouch.current = false;
      } else if (e.touches.length >= 2) {
        e.preventDefault();
        startPinch(e.touches[0], e.touches[1]);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      lastTouchTime.current = Date.now();
      if (e.touches.length >= 2) {
        e.preventDefault();
        if (!pinchStart.current) {
          startPinch(e.touches[0], e.touches[1]);
          return;
        }
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = Math.max(10, Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY));
        const { mx, my } = midpointRelative(t0, t1);
        const start = pinchStart.current;
        const targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, start.zoom * (dist / start.dist)));
        const ratio = targetZoom / start.zoom;
        const nextPanX = mx - (start.midX - start.panX) * ratio;
        const nextPanY = my - (start.midY - start.panY) * ratio;
        userTransformedRef.current = true;
        didPan.current = true;
        gestureWasMultiTouch.current = true;
        applyTransform(targetZoom, { x: nextPanX, y: nextPanY });
      } else if (e.touches.length === 1 && dragStart.current && dragPanStart.current) {
        const dx = e.touches[0].clientX - dragStart.current.x;
        const dy = e.touches[0].clientY - dragStart.current.y;
        if (didPan.current || Math.hypot(dx, dy) > 6) {
          e.preventDefault();
          didPan.current = true;
          userTransformedRef.current = true;
          applyTransform(zoomRef.current, {
            x: dragPanStart.current.x + dx,
            y: dragPanStart.current.y + dy,
          });
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      lastTouchTime.current = Date.now();
      if (e.touches.length >= 2) {
        startPinch(e.touches[0], e.touches[1]);
        return;
      }
      if (e.touches.length === 1) {
        pinchStart.current = null;
        dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        dragPanStart.current = { ...panRef.current };
        gestureWasMultiTouch.current = true;
        didPan.current = true;
        return;
      }
      if (!didPan.current && !gestureWasMultiTouch.current && e.changedTouches[0]) {
        e.preventDefault();
        handleInteractionRef.current(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
      }
      dragStart.current = null;
      dragPanStart.current = null;
      pinchStart.current = null;
      didPan.current = false;
      gestureWasMultiTouch.current = false;
    };

    const onTouchCancel = () => {
      dragStart.current = null;
      dragPanStart.current = null;
      pinchStart.current = null;
      didPan.current = false;
      gestureWasMultiTouch.current = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - (rect.left + rect.width / 2);
      const my = e.clientY - (rect.top + rect.height / 2);
      const curZoom = zoomRef.current;
      const curPan = panRef.current;
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, curZoom * factor));
      const ratio = targetZoom / curZoom;
      userTransformedRef.current = true;
      applyTransform(targetZoom, {
        x: mx - (mx - curPan.x) * ratio,
        y: my - (my - curPan.y) * ratio,
      });
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: false });
    el.addEventListener('touchcancel', onTouchCancel, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
      el.removeEventListener('wheel', onWheel);
    };
  }, [applyTransform]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (Date.now() - lastTouchTime.current < 500) return;
    dragStart.current = { x: e.clientX, y: e.clientY };
    dragPanStart.current = { ...panRef.current };
    didPan.current = false;
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (Date.now() - lastTouchTime.current < 500) return;
    if (!dragStart.current || !dragPanStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    if (didPan.current || Math.hypot(dx, dy) > 4) {
      didPan.current = true;
      userTransformedRef.current = true;
      applyTransform(zoomRef.current, {
        x: dragPanStart.current.x + dx,
        y: dragPanStart.current.y + dy,
      });
    }
  }, [applyTransform]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (Date.now() - lastTouchTime.current < 500) return;
    if (!didPan.current) handleInteraction(e.clientX, e.clientY);
    dragStart.current = null;
    dragPanStart.current = null;
    didPan.current = false;
  }, [handleInteraction]);

  const zoomBy = useCallback((factor: number) => {
    const curZoom = zoomRef.current;
    const curPan = panRef.current;
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, curZoom * factor));
    const ratio = nextZoom / curZoom;
    userTransformedRef.current = true;
    applyTransform(nextZoom, { x: curPan.x * ratio, y: curPan.y * ratio });
  }, [applyTransform]);

  const resetView = useCallback(() => {
    userTransformedRef.current = false;
    const { z, p } = computeFitView();
    fitZoomRef.current = z;
    applyTransform(z, p);
  }, [computeFitView, applyTransform]);

  return (
    <div style={styles.container}>
      <div
        ref={containerRef}
        style={{ ...styles.viewport, cursor: robberMode ? 'crosshair' : selectedAction ? 'pointer' : 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { dragStart.current = null; }}
      >
        <div
          ref={stageRef}
          style={{
            position: 'relative',
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
            transformOrigin: 'center center',
            willChange: 'transform',
          }}
        >
          <canvas ref={canvasRef} style={{ display: 'block', borderRadius: 6 }} />
          <canvas
            ref={fxCanvasRef}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'block',
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>

      {/* Collapsible Pieces Supply HUD (replaces permanent left canvas column) */}
      <div style={styles.piecesHud}>
        <button
          type="button"
          style={styles.piecesToggle}
          onClick={() => setShowPieces(s => !s)}
          aria-expanded={showPieces}
        >
          <span>🏰 Pieces</span>
          <span style={{ opacity: 0.7, fontSize: 10 }}>{showPieces ? '▲' : '▼'}</span>
        </button>
        {showPieces && (
          <div style={styles.piecesCard}>
            {gameState.players.map(p => (
              <div key={p.color} style={styles.piecesRow}>
                <span style={{ ...styles.piecesDot, backgroundColor: PLAYER_COLORS[p.color] || p.color }} />
                <span style={styles.piecesName}>{p.name}</span>
                <span style={styles.piecesCounts} title="Settlements · Cities · Roads">
                  🏠{p.settlementsRemaining} 🏰{p.citiesRemaining} 🛣️{p.roadsRemaining}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Inline Ghost-Piece Confirm Bar (replaces blocking window.confirm popups) */}
      {pendingPlacement && onConfirmPlacement && onCancelPlacement && (
        <div style={styles.confirmDock}>
          <button type="button" style={styles.confirmCancelBtn} onClick={onCancelPlacement}>
            ✕
          </button>
          <button type="button" style={styles.confirmOkBtn} onClick={onConfirmPlacement}>
            ✓ {pendingPlacement.label || (
              pendingPlacement.kind === 'city'
                ? 'Build City'
                : pendingPlacement.kind === 'road'
                  ? 'Place Road'
                  : 'Place Settlement'
            )}
          </button>
        </div>
      )}

      {/* Zoom Controls (elevated above HandBar) */}
      <div style={styles.zoomControls}>
        <button type="button" style={styles.zoomBtn} onClick={() => zoomBy(1.25)} aria-label="Zoom in">+</button>
        <span style={styles.zoomLabel}>{Math.round(zoom * 100)}%</span>
        <button type="button" style={styles.zoomBtn} onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">−</button>
        <button type="button" style={styles.zoomBtn} onClick={resetView} aria-label="Fit board" title="Fit board">⟲</button>
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
    backgroundColor: '#3a210d',
    backgroundImage: [
      'radial-gradient(ellipse 75% 65% at 48% 42%, rgba(160, 102, 48, 0.36) 0%, rgba(72, 40, 16, 0.16) 55%, rgba(18, 8, 2, 0.62) 100%)',
      'repeating-linear-gradient(180deg, rgba(235, 175, 105, 0.045) 0px, rgba(235, 175, 105, 0.045) 2px, transparent 2px, transparent 34px, rgba(16, 7, 2, 0.22) 34px, rgba(16, 7, 2, 0.22) 36px, rgba(16, 7, 2, 0.08) 36px, rgba(16, 7, 2, 0.08) 70px)',
    ].join(', '),
  },
  viewport: { width: '100%', height: '100%', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none', userSelect: 'none' },
  piecesHud: {
    position: 'absolute',
    top: 10,
    left: 10,
    zIndex: 12,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 6,
  },
  piecesToggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 10px',
    borderRadius: 999,
    border: '1px solid rgba(255, 220, 150, 0.28)',
    background: 'rgba(30, 18, 8, 0.86)',
    color: '#f5e6c8',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
  },
  piecesCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    padding: '8px 10px',
    borderRadius: 10,
    background: 'rgba(26, 15, 7, 0.94)',
    border: '1px solid rgba(255, 220, 150, 0.28)',
    boxShadow: '0 8px 20px rgba(0,0,0,0.45)',
    minWidth: 175,
  },
  piecesRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: '#f5efe4',
  },
  piecesDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    flexShrink: 0,
    border: '1px solid rgba(0,0,0,0.4)',
  },
  piecesName: {
    flex: 1,
    fontWeight: 700,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: 74,
  },
  piecesCounts: {
    fontSize: 11,
    color: '#dfd0b5',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  confirmDock: {
    position: 'absolute',
    left: '50%',
    bottom: 66,
    transform: 'translateX(-50%)',
    zIndex: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: 6,
    borderRadius: 999,
    background: 'rgba(24, 14, 6, 0.94)',
    border: '1.5px solid rgba(255, 215, 64, 0.65)',
    boxShadow: '0 10px 28px rgba(0,0,0,0.55)',
  },
  confirmCancelBtn: {
    width: 38,
    height: 38,
    borderRadius: '50%',
    border: '1px solid rgba(255,255,255,0.22)',
    background: 'rgba(255,255,255,0.08)',
    color: '#f5efe4',
    fontSize: 16,
    fontWeight: 800,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmOkBtn: {
    padding: '10px 18px',
    borderRadius: 999,
    border: 'none',
    background: 'linear-gradient(135deg, #2ecc71, #1e9e54)',
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    boxShadow: '0 2px 10px rgba(46, 204, 113, 0.4)',
  },
  zoomControls: {
    position: 'absolute', bottom: 68, right: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
    background: 'rgba(36,22,9,0.88)', borderRadius: 12, padding: 5, zIndex: 10, border: '1px solid rgba(255,220,150,0.24)',
  },
  zoomBtn: {
    width: 38, height: 38, border: '1px solid rgba(255,220,150,0.25)', borderRadius: 9, background: '#3d2814',
    color: '#f5e6c8', fontSize: 19, fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  zoomLabel: { fontSize: 10, color: '#c9b896', textAlign: 'center', minWidth: 36, fontVariantNumeric: 'tabular-nums' },
};

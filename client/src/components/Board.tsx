import { useRef, useEffect, useState, useCallback } from 'react';
import type { GameState, Intersection, Edge, Player } from '../game/types';
import { hexToPixel, pixelToHex, getHexCorners, getPortIntersections } from '../game/board';

const PLAYER_COLORS: Record<string, string> = {
  red: '#d32f2f',
  blue: '#1976d2',
  white: '#f5f5f5',
  orange: '#f57c00',
};

/** High-quality painted hex textures (primary terrain art).
 *  Ore intentionally omitted — the ore PNG is a cold plastic crater that
 *  fights the painted board look; procedural mountains look better.
 */
const HEX_IMAGES: Record<string, string> = {
  lumber: '/assets/hex-lumber.png',
  brick: '/assets/hex-brick.png',
  wool: '/assets/hex-wool.png',
  grain: '/assets/hex-grain.png',
  // ore: skipped on purpose
  desert: '/assets/hex-desert.png',
};

const ROBBER_IMG = '/assets/robber.png';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Darker / lighter variants for 3D piece faces */
const PLAYER_SHADE: Record<string, { mid: string; dark: string; light: string; edge: string }> = {
  red:    { mid: '#d32f2f', dark: '#8e1a1a', light: '#ef5350', edge: '#5c1010' },
  blue:   { mid: '#1976d2', dark: '#0d47a1', light: '#42a5f5', edge: '#0a306e' },
  white:  { mid: '#f0f0f0', dark: '#b0b0b0', light: '#ffffff', edge: '#6e6e6e' },
  orange: { mid: '#f57c00', dark: '#b35300', light: '#ffb74d', edge: '#7a3800' },
};

const TERRAIN: Record<string, {
  base: string; mid: string; deep: string; accent: string; rim: string; label: string;
}> = {
  lumber: { base: '#3f8a3f', mid: '#2f6b2f', deep: '#1e4a1e', accent: '#6bb86b', rim: '#1a3d1a', label: 'Forest' },
  brick:  { base: '#c4784a', mid: '#a85e38', deep: '#7a3f22', accent: '#e0a078', rim: '#5c2e18', label: 'Hills' },
  wool:   { base: '#8fbc5a', mid: '#6f9a40', deep: '#4a6e28', accent: '#c5e08a', rim: '#3a5520', label: 'Pasture' },
  grain:  { base: '#e0b84a', mid: '#c9a030', deep: '#8a6e18', accent: '#f5d878', rim: '#6a5410', label: 'Fields' },
  ore:    { base: '#7a7f88', mid: '#5c616a', deep: '#3a3f48', accent: '#a8b0ba', rim: '#2a2e34', label: 'Mountains' },
  desert: { base: '#e8d5a3', mid: '#d4bf88', deep: '#b09a68', accent: '#f5e8c8', rim: '#8a7648', label: 'Desert' },
};

interface BoardProps {
  gameState: GameState;
  hexSize: number;
  onHexClick: (q: number, r: number) => void;
  onIntersectionClick: (key: string) => void;
  onEdgeClick: (key: string) => void;
  robberMode: boolean;
  selectedAction: string | null;
  debug?: boolean;
  legalIntersections?: string[];
  legalEdges?: string[];
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

function fillHexPath(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < 6; i++) ctx.lineTo(pts[i].x, pts[i].y);
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
  // amount: -1..1 darken/lighten
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + amount * 255)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/* ─── Cached procedural terrain textures (zero network) ────────────── */

const terrainPatternCache = new Map<string, CanvasPattern | null>();

function getTerrainPattern(
  ctx: CanvasRenderingContext2D,
  type: string,
): CanvasPattern | null {
  if (terrainPatternCache.has(type)) return terrainPatternCache.get(type) ?? null;

  const t = TERRAIN[type] || TERRAIN.desert;
  const S = 128;
  const off = document.createElement('canvas');
  off.width = S;
  off.height = S;
  const o = off.getContext('2d');
  if (!o) {
    terrainPatternCache.set(type, null);
    return null;
  }

  // Base wash
  const bg = o.createLinearGradient(0, 0, S, S);
  bg.addColorStop(0, t.accent);
  bg.addColorStop(0.45, t.base);
  bg.addColorStop(1, t.mid);
  o.fillStyle = bg;
  o.fillRect(0, 0, S, S);

  // Fine grain noise (deterministic pseudo-noise via sines — cheap, no images)
  o.globalAlpha = 0.12;
  for (let y = 0; y < S; y += 2) {
    for (let x = 0; x < S; x += 2) {
      const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const v = n - Math.floor(n);
      o.fillStyle = v > 0.55 ? t.deep : t.accent;
      o.fillRect(x, y, 2, 2);
    }
  }
  o.globalAlpha = 1;

  // Terrain-specific motifs
  o.save();
  if (type === 'lumber') {
    // Soft tree crowns
    for (let i = 0; i < 14; i++) {
      const x = ((i * 47) % 100) + 14;
      const y = ((i * 73) % 100) + 14;
      o.fillStyle = i % 2 ? t.deep : t.mid;
      o.beginPath();
      o.moveTo(x, y + 18);
      o.lineTo(x - 10, y + 6);
      o.lineTo(x - 4, y + 6);
      o.lineTo(x - 12, y - 6);
      o.lineTo(x, y - 16);
      o.lineTo(x + 12, y - 6);
      o.lineTo(x + 4, y + 6);
      o.lineTo(x + 10, y + 6);
      o.closePath();
      o.globalAlpha = 0.35;
      o.fill();
    }
  } else if (type === 'brick') {
    // Layered hills / clay ridges
    o.globalAlpha = 0.28;
    for (let i = 0; i < 6; i++) {
      const y = 20 + i * 16;
      o.strokeStyle = i % 2 ? t.deep : t.accent;
      o.lineWidth = 4;
      o.beginPath();
      o.moveTo(0, y);
      for (let x = 0; x <= S; x += 8) {
        o.lineTo(x, y + Math.sin(x * 0.08 + i) * 6);
      }
      o.stroke();
    }
  } else if (type === 'wool') {
    // Soft pasture patches + tiny sheep dots
    o.globalAlpha = 0.25;
    for (let i = 0; i < 10; i++) {
      const x = ((i * 53) % 110) + 8;
      const y = ((i * 91) % 110) + 8;
      o.fillStyle = i % 3 === 0 ? t.accent : t.deep;
      o.beginPath();
      o.ellipse(x, y, 14, 9, i * 0.4, 0, Math.PI * 2);
      o.fill();
    }
    o.globalAlpha = 0.55;
    o.fillStyle = '#f2f2e8';
    for (let i = 0; i < 8; i++) {
      const x = ((i * 37) % 100) + 14;
      const y = ((i * 61) % 100) + 14;
      o.beginPath();
      o.arc(x, y, 3.2, 0, Math.PI * 2);
      o.fill();
    }
  } else if (type === 'grain') {
    // Wheat rows
    o.globalAlpha = 0.3;
    o.strokeStyle = t.deep;
    o.lineWidth = 1.5;
    for (let i = 0; i < 18; i++) {
      const x = 6 + i * 7;
      o.beginPath();
      o.moveTo(x, 10);
      for (let y = 10; y < S - 10; y += 6) {
        o.lineTo(x + Math.sin(y * 0.15 + i) * 2.5, y);
      }
      o.stroke();
    }
    o.globalAlpha = 0.4;
    o.fillStyle = t.accent;
    for (let i = 0; i < 20; i++) {
      const x = ((i * 29) % 110) + 8;
      const y = ((i * 47) % 110) + 8;
      o.beginPath();
      o.ellipse(x, y, 2.5, 5, -0.4, 0, Math.PI * 2);
      o.fill();
    }
  } else if (type === 'ore') {
    // Rocky facets
    o.globalAlpha = 0.35;
    for (let i = 0; i < 12; i++) {
      const x = ((i * 41) % 100) + 10;
      const y = ((i * 67) % 100) + 10;
      o.fillStyle = i % 2 ? t.deep : t.accent;
      o.beginPath();
      o.moveTo(x, y - 12);
      o.lineTo(x + 14, y);
      o.lineTo(x + 6, y + 14);
      o.lineTo(x - 10, y + 8);
      o.lineTo(x - 12, y - 4);
      o.closePath();
      o.fill();
    }
  } else if (type === 'desert') {
    // Dune ripples
    o.globalAlpha = 0.22;
    o.strokeStyle = t.deep;
    o.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const y = 16 + i * 14;
      o.beginPath();
      o.moveTo(0, y);
      for (let x = 0; x <= S; x += 6) {
        o.lineTo(x, y + Math.sin(x * 0.06 + i * 0.8) * 5);
      }
      o.stroke();
    }
  }
  o.restore();

  const pattern = ctx.createPattern(off, 'repeat');
  terrainPatternCache.set(type, pattern);
  return pattern;
}

/* ─── Background / sea ─────────────────────────────────────────────── */

function drawWoodBackground(ctx: CanvasRenderingContext2D, W: number, H: number) {
  // Warm walnut table — CU-style
  const base = ctx.createRadialGradient(W * 0.4, H * 0.35, W * 0.08, W * 0.5, H * 0.55, Math.max(W, H) * 0.8);
  base.addColorStop(0, '#c4894a');
  base.addColorStop(0.35, '#a06b35');
  base.addColorStop(0.7, '#7a4a22');
  base.addColorStop(1, '#4a2a12');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  // Horizontal planks
  const plankH = Math.max(18, H / 22);
  for (let i = 0; i < Math.ceil(H / plankH) + 1; i++) {
    const y = i * plankH;
    const warm = i % 2 === 0;
    ctx.fillStyle = warm ? 'rgba(180,120,60,0.12)' : 'rgba(40,20,8,0.14)';
    ctx.fillRect(0, y, W, plankH);

    // Seam
    ctx.strokeStyle = 'rgba(30,14,4,0.35)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= W; x += 20) {
      ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 1.8);
    }
    ctx.stroke();

    // Highlight seam
    ctx.strokeStyle = 'rgba(230,190,120,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y + 1.5);
    ctx.lineTo(W, y + 1.5);
    ctx.stroke();
  }

  // Knots / grain flecks
  for (let i = 0; i < 40; i++) {
    const x = ((i * 137) % W);
    const y = ((i * 89) % H);
    ctx.globalAlpha = 0.07 + (i % 5) * 0.01;
    ctx.strokeStyle = '#2a1408';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x, y, 8 + (i % 6), 3, i * 0.4, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Edge vignette
  ctx.globalAlpha = 1;
  const vig = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(20,8,0,0.45)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function drawSeaFrame(
  ctx: CanvasRenderingContext2D,
  _board: { q: number; r: number }[],
  size: number,
  W: number,
  H: number,
) {
  const cx = W / 2;
  const cy = H / 2;
  const R = size * 5.4;

  // Soft table shadow under the ocean
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 32;
  ctx.shadowOffsetY = 10;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = '#0a3050';
  ctx.fill();
  ctx.restore();

  // Deep ocean disc with rich blues
  const g = ctx.createRadialGradient(cx - size * 0.5, cy - size * 0.55, size * 0.6, cx, cy, R);
  g.addColorStop(0, '#9ad4f5');
  g.addColorStop(0.18, '#4eb0e0');
  g.addColorStop(0.42, '#2688c4');
  g.addColorStop(0.68, '#1768a0');
  g.addColorStop(0.88, '#0e4a78');
  g.addColorStop(1, '#083456');
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  // Depth bands
  ctx.save();
  for (let i = 0; i < 10; i++) {
    ctx.globalAlpha = 0.06 + (i % 3) * 0.02;
    ctx.strokeStyle = i % 2 === 0 ? '#e8f7ff' : '#0a3a60';
    ctx.lineWidth = 1.4 + (i % 2);
    ctx.beginPath();
    ctx.arc(
      cx + Math.sin(i * 0.7) * 6,
      cy + Math.cos(i * 0.5) * 5,
      size * (2.2 + i * 0.32),
      0, Math.PI * 2,
    );
    ctx.stroke();
  }
  ctx.restore();

  // Sparkle flecks on outer sea
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2 + 0.3;
    const rr = size * (3.9 + (i % 5) * 0.18);
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr * 0.92;
    ctx.globalAlpha = 0.15 + (i % 4) * 0.06;
    ctx.beginPath();
    ctx.arc(x, y, 1.2 + (i % 3) * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Foam ring near island
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = size * 0.08;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 3.62, 0, Math.PI * 2);
  ctx.stroke();
  // Sandy beach
  ctx.strokeStyle = 'rgba(236, 214, 164, 0.9)';
  ctx.lineWidth = size * 0.3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, size * 3.48, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 248, 225, 0.45)';
  ctx.lineWidth = size * 0.1;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 3.36, 0, Math.PI * 2);
  ctx.stroke();
  // Dark wet sand edge
  ctx.strokeStyle = 'rgba(90, 70, 40, 0.4)';
  ctx.lineWidth = size * 0.045;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 3.24, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawWaterHex(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const pts = hexCorners(cx, cy, size * 1.02);
  fillHexPath(ctx, pts);
  const g = ctx.createRadialGradient(cx - size * 0.3, cy - size * 0.32, size * 0.04, cx, cy, size * 1.08);
  g.addColorStop(0, '#a8dff8');
  g.addColorStop(0.28, '#55b6e4');
  g.addColorStop(0.62, '#2a8ec8');
  g.addColorStop(1, '#145a90');
  ctx.fillStyle = g;
  ctx.fill();

  ctx.save();
  fillHexPath(ctx, pts);
  ctx.clip();
  // Wave bands
  ctx.globalAlpha = 0.24;
  ctx.strokeStyle = '#eef9ff';
  ctx.lineWidth = 1.7;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(cx - size * 0.1, cy + size * (-0.05 + i * 0.15), size * (0.28 + i * 0.09), 0.12, Math.PI - 0.12);
    ctx.stroke();
  }
  // Foam crest near top edge
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy - size * 0.35, size * 0.45, 0.4, Math.PI - 0.4);
  ctx.stroke();
  // Specular sparkles
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 6; i++) {
    const sx = cx + Math.sin(i * 2.3 + 0.5) * size * 0.38;
    const sy = cy + Math.cos(i * 1.9) * size * 0.32;
    ctx.beginPath();
    ctx.arc(sx, sy, size * 0.028, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Hex rim
  fillHexPath(ctx, pts);
  ctx.strokeStyle = 'rgba(8,40,70,0.4)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // Light top edge
  ctx.beginPath();
  ctx.moveTo(pts[5].x, pts[5].y);
  ctx.lineTo(pts[0].x, pts[0].y);
  ctx.lineTo(pts[1].x, pts[1].y);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/* ─── High-quality 2D hex tiles (painted assets + procedural fallback) ── */

function drawTerrainHex(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, size: number,
  type: string,
  hasRobber: boolean,
  img: HTMLImageElement | null = null,
) {
  const t = TERRAIN[type] || TERRAIN.desert;
  const pts = hexCorners(cx, cy, size);
  const hasArt = !!(img && img.complete && img.naturalWidth > 0);

  // Soft table shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 2;
  fillHexPath(ctx, pts);
  ctx.fillStyle = t.deep;
  ctx.fill();
  ctx.restore();

  fillHexPath(ctx, pts);
  ctx.save();
  ctx.clip();

  // Prefer painted art except ore (procedural mountains look better)
  const useArt = hasArt && type !== 'ore';

  if (useArt) {
    // Painted hex texture — full bleed, crisp
    const s = size * 2.05;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img!, cx - s / 2, cy - s / 2, s, s);

    // Very light sheen so tiles read as physical pieces on the table
    const sheen = ctx.createLinearGradient(cx - size, cy - size, cx + size * 0.5, cy + size);
    sheen.addColorStop(0, 'rgba(255,255,255,0.14)');
    sheen.addColorStop(0.45, 'rgba(255,255,255,0)');
    sheen.addColorStop(1, 'rgba(0,0,0,0.08)');
    fillHexPath(ctx, pts);
    ctx.fillStyle = sheen;
    ctx.fill();
  } else {
    // Procedural terrain (always used for ore; fallback for others)
    if (type === 'ore') {
      paintOreMountains(ctx, cx, cy, size, t);
    } else {
      const rg = ctx.createRadialGradient(cx - size * 0.2, cy - size * 0.25, size * 0.05, cx, cy, size * 1.05);
      rg.addColorStop(0, t.accent);
      rg.addColorStop(0.4, t.base);
      rg.addColorStop(1, t.mid);
      ctx.fillStyle = rg;
      ctx.fill();

      const pattern = getTerrainPattern(ctx, type);
      if (pattern) {
        ctx.globalAlpha = 0.72;
        ctx.fillStyle = pattern;
        fillHexPath(ctx, pts);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.globalAlpha = 0.55;
      paintTerrainMotifs(ctx, cx, cy, size, type, t);
      ctx.globalAlpha = 1;
    }

    const sheen = ctx.createLinearGradient(cx - size, cy - size, cx + size * 0.5, cy + size);
    sheen.addColorStop(0, 'rgba(255,255,255,0.22)');
    sheen.addColorStop(0.4, 'rgba(255,255,255,0.04)');
    sheen.addColorStop(1, 'rgba(0,0,0,0.14)');
    fillHexPath(ctx, pts);
    ctx.fillStyle = sheen;
    ctx.fill();
  }

  ctx.restore();

  // Beveled edges — subtler so painted art isn't framed in harsh white
  ctx.save();
  for (let i = 0; i < 6; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 6];
    const midY = (a.y + b.y) / 2;
    const isTop = midY < cy;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = isTop ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.35)';
    ctx.lineWidth = isTop ? 1.6 : 2.0;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  fillHexPath(ctx, pts);
  ctx.strokeStyle = 'rgba(30,18,8,0.55)';
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.restore();

  if (hasRobber) {
    fillHexPath(ctx, pts);
    ctx.fillStyle = 'rgba(15,15,25,0.4)';
    ctx.fill();
  }
}

/** Classic Catan-style ore mountains — warm slate peaks, snow, rocky scree.
 *  Replaces the cold plastic crater PNG. */
function paintOreMountains(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, size: number,
  _t: { deep: string; accent: string; mid: string; base: string },
) {
  // Warm slate base (not pure grey plastic)
  const base = ctx.createRadialGradient(cx - size * 0.15, cy - size * 0.1, size * 0.1, cx, cy, size * 1.1);
  base.addColorStop(0, '#9aa3ad');
  base.addColorStop(0.35, '#6d7580');
  base.addColorStop(0.7, '#4e5560');
  base.addColorStop(1, '#353a42');
  ctx.fillStyle = base;
  fillHexPath(ctx, hexCorners(cx, cy, size));
  ctx.fill();

  // Rocky scree texture
  ctx.save();
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 48; i++) {
    const ang = (i * 2.4) % (Math.PI * 2);
    const rad = ((i * 37) % 80) / 100 * size * 0.85;
    const x = cx + Math.cos(ang) * rad * 0.9;
    const y = cy + Math.sin(ang) * rad * 0.7 + size * 0.12;
    ctx.fillStyle = i % 3 === 0 ? '#2c3138' : i % 3 === 1 ? '#8a929c' : '#5a616a';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + size * 0.04, y + size * 0.02);
    ctx.lineTo(x + size * 0.01, y + size * 0.05);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Mountain peaks (layered, warmer brown-slate)
  const peaks: [number, number, number, string, string][] = [
    [-0.38, 0.42, 0.62, '#3d4450', '#6a7380'],
    [0.05, 0.55, 0.78, '#2f3640', '#5c6570'],
    [0.36, 0.38, 0.55, '#454c58', '#7a8490'],
    [-0.12, 0.28, 0.4, '#505860', '#8a94a0'],
    [0.22, 0.3, 0.36, '#3a4048', '#6e7682'],
  ];
  for (const [ox, h, w, dark, light] of peaks) {
    const x = cx + ox * size;
    const baseY = cy + size * 0.42;
    const peakY = baseY - h * size;
    const half = w * size * 0.5;

    // Right face (dark)
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(x, peakY);
    ctx.lineTo(x + half, baseY);
    ctx.lineTo(x, baseY);
    ctx.closePath();
    ctx.fill();

    // Left face (light)
    const lg = ctx.createLinearGradient(x - half, peakY, x, baseY);
    lg.addColorStop(0, light);
    lg.addColorStop(1, dark);
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(x, peakY);
    ctx.lineTo(x - half, baseY);
    ctx.lineTo(x, baseY);
    ctx.closePath();
    ctx.fill();

    // Snow cap
    ctx.fillStyle = 'rgba(245,248,255,0.88)';
    ctx.beginPath();
    ctx.moveTo(x, peakY);
    ctx.lineTo(x - half * 0.28, peakY + h * size * 0.22);
    ctx.lineTo(x + half * 0.22, peakY + h * size * 0.18);
    ctx.closePath();
    ctx.fill();

    // Ridgeline highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, peakY);
    ctx.lineTo(x - half * 0.15, peakY + h * size * 0.35);
    ctx.stroke();
  }

  // Ore veins (subtle copper/iron glints)
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = '#c4a574';
  ctx.lineWidth = Math.max(1.2, size * 0.025);
  ctx.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const x0 = cx - size * 0.35 + i * size * 0.15;
    const y0 = cy + size * 0.05 + (i % 2) * size * 0.08;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(x0 + size * 0.08, y0 - size * 0.12, x0 + size * 0.14, y0 + size * 0.06);
    ctx.stroke();
  }
  ctx.restore();
}

/** Distinctive terrain art painted directly onto each hex. */
function paintTerrainMotifs(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, size: number,
  type: string,
  t: { deep: string; accent: string; mid: string; base: string },
) {
  ctx.save();
  if (type === 'lumber') {
    // Cluster of pines
    const trees = [
      [-0.35, 0.1, 0.34], [-0.05, 0.28, 0.28], [0.28, 0.05, 0.36],
      [0.08, -0.15, 0.22], [-0.22, -0.2, 0.2],
    ];
    for (const [ox, oy, sc] of trees) {
      const x = cx + ox * size;
      const y = cy + oy * size + size * 0.12;
      const s = size * sc;
      ctx.fillStyle = t.deep;
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s * 0.55, y + s * 0.15);
      ctx.lineTo(x + s * 0.2, y + s * 0.15);
      ctx.lineTo(x + s * 0.45, y + s * 0.55);
      ctx.lineTo(x - s * 0.45, y + s * 0.55);
      ctx.lineTo(x - s * 0.2, y + s * 0.15);
      ctx.lineTo(x - s * 0.55, y + s * 0.15);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = shadeHex(t.deep, -0.12);
      ctx.fillRect(x - s * 0.08, y + s * 0.55, s * 0.16, s * 0.28);
    }
  } else if (type === 'brick') {
    // Rolling clay hills + brick marks
    ctx.fillStyle = t.deep;
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.7, cy + size * 0.45);
    ctx.quadraticCurveTo(cx - size * 0.35, cy - size * 0.15, cx - size * 0.05, cy + size * 0.1);
    ctx.quadraticCurveTo(cx + size * 0.25, cy - size * 0.35, cx + size * 0.7, cy + size * 0.35);
    ctx.lineTo(cx + size * 0.7, cy + size * 0.55);
    ctx.lineTo(cx - size * 0.7, cy + size * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = t.accent;
    ctx.globalAlpha = 0.5;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const x = cx - size * 0.35 + col * size * 0.28 + (row % 2) * size * 0.1;
        const y = cy + size * 0.05 + row * size * 0.14;
        roundRect(ctx, x, y, size * 0.18, size * 0.08, 2);
        ctx.fill();
      }
    }
  } else if (type === 'wool') {
    // Soft pasture mounds + sheep
    ctx.fillStyle = t.deep;
    ctx.globalAlpha = 0.45;
    for (const [ox, oy, rx, ry] of [[-0.3, 0.15, 0.28, 0.14], [0.2, 0.25, 0.32, 0.12], [0.0, -0.05, 0.25, 0.1]] as const) {
      ctx.beginPath();
      ctx.ellipse(cx + ox * size, cy + oy * size, rx * size, ry * size, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#f4f1e6';
    const sheep = [[-0.2, 0.05], [0.15, 0.18], [0.0, 0.3], [0.3, -0.05]];
    for (const [ox, oy] of sheep) {
      const x = cx + ox * size;
      const y = cy + oy * size;
      ctx.beginPath();
      ctx.ellipse(x, y, size * 0.08, size * 0.06, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + size * 0.06, y - size * 0.02, size * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (type === 'grain') {
    // Wheat field rows
    ctx.strokeStyle = t.deep;
    ctx.lineWidth = Math.max(1.5, size * 0.03);
    ctx.lineCap = 'round';
    for (let i = -4; i <= 4; i++) {
      const x = cx + i * size * 0.12;
      ctx.beginPath();
      ctx.moveTo(x, cy + size * 0.45);
      ctx.quadraticCurveTo(x + size * 0.04, cy, x - size * 0.02, cy - size * 0.4);
      ctx.stroke();
      // head
      ctx.fillStyle = t.accent;
      ctx.beginPath();
      ctx.ellipse(x - size * 0.02, cy - size * 0.42, size * 0.035, size * 0.08, -0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (type === 'ore') {
    // Mountain peaks
    const peaks = [
      [-0.25, 0.55], [0.15, 0.7], [0.4, 0.4], [-0.45, 0.35],
    ];
    for (const [ox, h] of peaks) {
      const x = cx + ox * size;
      const y = cy + size * 0.35;
      const hh = h * size;
      ctx.fillStyle = t.deep;
      ctx.beginPath();
      ctx.moveTo(x - hh * 0.45, y);
      ctx.lineTo(x, y - hh);
      ctx.lineTo(x + hh * 0.45, y);
      ctx.closePath();
      ctx.fill();
      // snow cap
      ctx.fillStyle = 'rgba(245,248,255,0.75)';
      ctx.beginPath();
      ctx.moveTo(x, y - hh);
      ctx.lineTo(x - hh * 0.15, y - hh * 0.7);
      ctx.lineTo(x + hh * 0.15, y - hh * 0.7);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    // Desert dunes + sun
    ctx.strokeStyle = t.deep;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 4; i++) {
      const y = cy - size * 0.15 + i * size * 0.18;
      ctx.beginPath();
      ctx.moveTo(cx - size * 0.55, y);
      for (let x = -0.55; x <= 0.55; x += 0.08) {
        ctx.lineTo(cx + x * size, y + Math.sin(x * 8 + i) * size * 0.04);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#f0c868';
    ctx.beginPath();
    ctx.arc(cx + size * 0.15, cy - size * 0.2, size * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* ─── Number tokens ────────────────────────────────────────────────── */

function drawNumberToken(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, num: number) {
  const r = size * 0.32;

  // Token shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#f4efe0';
  ctx.fill();
  ctx.restore();

  // Ceramic disc with radial sheen
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.08, cx, cy, r);
  g.addColorStop(0, '#fffdf6');
  g.addColorStop(0.5, '#f2ead4');
  g.addColorStop(0.85, '#e0d4b4');
  g.addColorStop(1, '#c9bb95');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  // Thick outer ring (like CU tokens)
  ctx.strokeStyle = '#8a7348';
  ctx.lineWidth = 2.6;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.88, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.3;
  ctx.stroke();
  // Inner dark track
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(90,70,40,0.18)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const isHot = num === 6 || num === 8;
  ctx.font = `bold ${size * 0.42}px Georgia, 'Times New Roman', serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = Math.max(2.5, size * 0.05);
  ctx.strokeText(String(num), cx, cy - r * 0.1);
  ctx.fillStyle = isHot ? '#b71c1c' : '#111';
  ctx.fillText(String(num), cx, cy - r * 0.1);

  const pips = num <= 7 ? num - 1 : 13 - num;
  const pipR = Math.max(1.4, size * 0.04);
  ctx.fillStyle = isHot ? '#c62828' : '#333';
  const pipY = cy + r * 0.5;
  const spacing = pipR * 2.85;
  const startX = cx - ((pips - 1) * spacing) / 2;
  for (let p = 0; p < pips; p++) {
    ctx.beginPath();
    ctx.arc(startX + p * spacing, pipY, pipR, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* ─── Robber — black wooden meeple (no white JPEG box) ─────────────── */

function drawRobber(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, size: number,
  _img: HTMLImageElement | null = null,
) {
  // Always procedural: robber.png is a JPEG with opaque white bg.
  const s = size * 0.48;
  ctx.save();

  // Ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(cx + 1, cy + s * 0.78, s * 0.48, s * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();

  // Wooden body gradient (charcoal wood like CU robber)
  const bodyG = ctx.createLinearGradient(cx - s * 0.45, cy, cx + s * 0.45, cy);
  bodyG.addColorStop(0, '#0a0a0c');
  bodyG.addColorStop(0.35, '#2a2a30');
  bodyG.addColorStop(0.55, '#3d3d44');
  bodyG.addColorStop(1, '#121214');

  // Legs / base
  ctx.fillStyle = bodyG;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.38, cy + s * 0.72);
  ctx.lineTo(cx - s * 0.42, cy + s * 0.15);
  ctx.lineTo(cx + s * 0.42, cy + s * 0.15);
  ctx.lineTo(cx + s * 0.38, cy + s * 0.72);
  ctx.closePath();
  ctx.fill();
  // Leg notch
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.06, cy + s * 0.72);
  ctx.lineTo(cx, cy + s * 0.38);
  ctx.lineTo(cx + s * 0.06, cy + s * 0.72);
  ctx.closePath();
  ctx.fill();

  // Torso
  ctx.fillStyle = bodyG;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.4, cy + s * 0.2);
  ctx.lineTo(cx - s * 0.36, cy - s * 0.28);
  ctx.quadraticCurveTo(cx, cy - s * 0.38, cx + s * 0.36, cy - s * 0.28);
  ctx.lineTo(cx + s * 0.4, cy + s * 0.2);
  ctx.closePath();
  ctx.fill();

  // Hood / head
  ctx.beginPath();
  ctx.ellipse(cx, cy - s * 0.42, s * 0.34, s * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();
  // Hood peak
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.22, cy - s * 0.55);
  ctx.quadraticCurveTo(cx - s * 0.05, cy - s * 0.95, cx + s * 0.08, cy - s * 0.58);
  ctx.quadraticCurveTo(cx, cy - s * 0.7, cx - s * 0.22, cy - s * 0.55);
  ctx.fill();

  // Face hollow (dark recess)
  ctx.fillStyle = '#050506';
  ctx.beginPath();
  ctx.ellipse(cx + s * 0.02, cy - s * 0.38, s * 0.16, s * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();

  // Wood grain strokes
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.25, cy - s * 0.1 + i * s * 0.14);
    ctx.quadraticCurveTo(cx, cy - s * 0.08 + i * s * 0.14, cx + s * 0.25, cy - s * 0.12 + i * s * 0.14);
    ctx.stroke();
  }

  // Soft rim light
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.1, cy - s * 0.4, s * 0.2, s * 0.28, -0.25, -1.4, 0.6);
  ctx.stroke();

  // Outline
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.38, cy + s * 0.72);
  ctx.lineTo(cx - s * 0.42, cy + s * 0.15);
  ctx.lineTo(cx - s * 0.36, cy - s * 0.28);
  ctx.stroke();

  ctx.restore();
}

/* ─── 3D isometric Settlement ──────────────────────────────────────── */

function drawSettlement(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string, size: number) {
  const s = size * 0.28;
  const sh = shadesFor(color);
  // Depth vector (down-right) for extrusion
  const dx = s * 0.28;
  const dy = s * 0.38;

  ctx.save();

  // Ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath();
  ctx.ellipse(cx + dx * 0.3, cy + s * 0.78, s * 0.95, s * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();

  // Front body corners (house face)
  const fl = { x: cx - s * 0.72, y: cy + s * 0.15 }; // front-left eave
  const fr = { x: cx + s * 0.72, y: cy + s * 0.15 }; // front-right eave
  const bl = { x: cx - s * 0.72, y: cy + s * 0.72 }; // front-left base
  const br = { x: cx + s * 0.72, y: cy + s * 0.72 }; // front-right base
  const peak = { x: cx, y: cy - s * 0.78 };

  // Right side extrusion (darker)
  ctx.fillStyle = sh.dark;
  ctx.beginPath();
  ctx.moveTo(fr.x, fr.y);
  ctx.lineTo(fr.x + dx, fr.y + dy * 0.35);
  ctx.lineTo(br.x + dx, br.y + dy * 0.35);
  ctx.lineTo(br.x, br.y);
  ctx.closePath();
  ctx.fill();

  // Roof right plane
  ctx.beginPath();
  ctx.moveTo(peak.x, peak.y);
  ctx.lineTo(peak.x + dx * 0.6, peak.y + dy * 0.35);
  ctx.lineTo(fr.x + dx, fr.y + dy * 0.35);
  ctx.lineTo(fr.x, fr.y);
  ctx.closePath();
  ctx.fill();

  // Front wall
  const wallG = ctx.createLinearGradient(fl.x, cy, fr.x, cy);
  wallG.addColorStop(0, sh.mid);
  wallG.addColorStop(0.55, sh.light);
  wallG.addColorStop(1, sh.mid);
  ctx.fillStyle = wallG;
  ctx.beginPath();
  ctx.moveTo(fl.x, fl.y);
  ctx.lineTo(fr.x, fr.y);
  ctx.lineTo(br.x, br.y);
  ctx.lineTo(bl.x, bl.y);
  ctx.closePath();
  ctx.fill();

  // Front roof (left darker, right lighter for 3D)
  ctx.fillStyle = shadeHex(sh.dark, -0.05);
  ctx.beginPath();
  ctx.moveTo(fl.x, fl.y);
  ctx.lineTo(peak.x, peak.y);
  ctx.lineTo(cx, fl.y);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = sh.light;
  ctx.beginPath();
  ctx.moveTo(fr.x, fr.y);
  ctx.lineTo(peak.x, peak.y);
  ctx.lineTo(cx, fl.y);
  ctx.closePath();
  ctx.fill();

  // Door
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  roundRect(ctx, cx - s * 0.14, cy + s * 0.28, s * 0.28, s * 0.42, 2);
  ctx.fill();

  // Window
  ctx.fillStyle = 'rgba(255, 236, 170, 0.65)';
  roundRect(ctx, cx + s * 0.28, cy + s * 0.32, s * 0.18, s * 0.16, 1.5);
  ctx.fill();

  // Crisp outline
  ctx.strokeStyle = sh.edge;
  ctx.lineWidth = 1.4;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(bl.x, bl.y);
  ctx.lineTo(fl.x, fl.y);
  ctx.lineTo(peak.x, peak.y);
  ctx.lineTo(fr.x, fr.y);
  ctx.lineTo(br.x, br.y);
  ctx.closePath();
  ctx.stroke();

  // Roof ridge highlight
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(peak.x, peak.y);
  ctx.lineTo(cx, fl.y);
  ctx.stroke();

  ctx.restore();
}

/* ─── 3D isometric City ────────────────────────────────────────────── */

function drawCity(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string, size: number) {
  const s = size * 0.34;
  const sh = shadesFor(color);
  const dx = s * 0.26;
  const dy = s * 0.34;

  ctx.save();

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(cx + dx * 0.4, cy + s * 0.78, s * 1.2, s * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Helper: draw a house block with peak at (px,py), width w, baseY
  const block = (px: number, peakY: number, halfW: number, eaveY: number, baseY: number) => {
    // right extrusion
    ctx.fillStyle = sh.dark;
    ctx.beginPath();
    ctx.moveTo(px + halfW, eaveY);
    ctx.lineTo(px + halfW + dx, eaveY + dy * 0.4);
    ctx.lineTo(px + halfW + dx, baseY + dy * 0.4);
    ctx.lineTo(px + halfW, baseY);
    ctx.closePath();
    ctx.fill();

    // front wall
    ctx.fillStyle = sh.mid;
    ctx.beginPath();
    ctx.moveTo(px - halfW, eaveY);
    ctx.lineTo(px + halfW, eaveY);
    ctx.lineTo(px + halfW, baseY);
    ctx.lineTo(px - halfW, baseY);
    ctx.closePath();
    ctx.fill();

    // roof L/R
    ctx.fillStyle = shadeHex(sh.dark, -0.05);
    ctx.beginPath();
    ctx.moveTo(px - halfW, eaveY);
    ctx.lineTo(px, peakY);
    ctx.lineTo(px, eaveY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = sh.light;
    ctx.beginPath();
    ctx.moveTo(px + halfW, eaveY);
    ctx.lineTo(px, peakY);
    ctx.lineTo(px, eaveY);
    ctx.closePath();
    ctx.fill();

    // outline
    ctx.strokeStyle = sh.edge;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(px - halfW, baseY);
    ctx.lineTo(px - halfW, eaveY);
    ctx.lineTo(px, peakY);
    ctx.lineTo(px + halfW, eaveY);
    ctx.lineTo(px + halfW, baseY);
    ctx.closePath();
    ctx.stroke();
  };

  // Main wider hall (left)
  block(cx - s * 0.28, cy - s * 0.35, s * 0.55, cy + s * 0.08, cy + s * 0.72);
  // Tower (right, taller)
  block(cx + s * 0.42, cy - s * 0.95, s * 0.38, cy - s * 0.2, cy + s * 0.72);

  // Windows
  ctx.fillStyle = 'rgba(255, 236, 170, 0.7)';
  roundRect(ctx, cx - s * 0.5, cy + s * 0.28, s * 0.16, s * 0.14, 1.5);
  ctx.fill();
  roundRect(ctx, cx - s * 0.2, cy + s * 0.28, s * 0.16, s * 0.14, 1.5);
  ctx.fill();
  roundRect(ctx, cx + s * 0.3, cy + s * 0.05, s * 0.14, s * 0.14, 1.5);
  ctx.fill();
  roundRect(ctx, cx + s * 0.3, cy - s * 0.15, s * 0.14, s * 0.14, 1.5);
  ctx.fill();

  // Door on main hall
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  roundRect(ctx, cx - s * 0.38, cy + s * 0.4, s * 0.2, s * 0.32, 2);
  ctx.fill();

  ctx.restore();
}

/* ─── 3D Road (extruded plank) ─────────────────────────────────────── */

function drawRoad(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  color: string, size: number,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Perpendicular
  const px = -uy;
  const py = ux;

  const inset = size * 0.2;
  const sx = x1 + ux * inset;
  const sy = y1 + uy * inset;
  const ex = x2 - ux * inset;
  const ey = y2 - uy * inset;

  const halfW = Math.max(4.5, size * 0.095);
  const depth = Math.max(3, size * 0.06);

  const sh = shadesFor(color);

  // Quad corners for top face
  const t1x = sx + px * halfW, t1y = sy + py * halfW;
  const t2x = sx - px * halfW, t2y = sy - py * halfW;
  const t3x = ex - px * halfW, t3y = ey - py * halfW;
  const t4x = ex + px * halfW, t4y = ey + py * halfW;

  // Depth offset (down-ish)
  const ox = depth * 0.35;
  const oy = depth * 0.9;

  ctx.save();

  // Drop shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.moveTo(t1x + 1, t1y + 2);
  ctx.lineTo(t2x + 1, t2y + 2);
  ctx.lineTo(t3x + 1, t3y + 2);
  ctx.lineTo(t4x + 1, t4y + 2);
  ctx.closePath();
  ctx.fill();

  // Side face (extrusion)
  ctx.fillStyle = sh.dark;
  ctx.beginPath();
  ctx.moveTo(t2x, t2y);
  ctx.lineTo(t3x, t3y);
  ctx.lineTo(t3x + ox, t3y + oy);
  ctx.lineTo(t2x + ox, t2y + oy);
  ctx.closePath();
  ctx.fill();

  // End caps lightly
  ctx.fillStyle = shadeHex(sh.dark, -0.08);
  ctx.beginPath();
  ctx.moveTo(t1x, t1y);
  ctx.lineTo(t2x, t2y);
  ctx.lineTo(t2x + ox, t2y + oy);
  ctx.lineTo(t1x + ox, t1y + oy);
  ctx.closePath();
  ctx.fill();

  // Top face
  const topG = ctx.createLinearGradient(t1x, t1y, t2x, t2y);
  topG.addColorStop(0, sh.light);
  topG.addColorStop(0.45, sh.mid);
  topG.addColorStop(1, sh.dark);
  ctx.fillStyle = topG;
  ctx.beginPath();
  ctx.moveTo(t1x, t1y);
  ctx.lineTo(t2x, t2y);
  ctx.lineTo(t3x, t3y);
  ctx.lineTo(t4x, t4y);
  ctx.closePath();
  ctx.fill();

  // Center groove (plank detail)
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();

  // Top edge highlight
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(t1x, t1y);
  ctx.lineTo(t4x, t4y);
  ctx.stroke();

  // Outline
  ctx.strokeStyle = sh.edge;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(t1x, t1y);
  ctx.lineTo(t2x, t2y);
  ctx.lineTo(t3x, t3y);
  ctx.lineTo(t4x, t4y);
  ctx.closePath();
  ctx.stroke();

  ctx.restore();
}

/* ─── Harbors ──────────────────────────────────────────────────────── */

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

  // Pier posts shadow
  ctx.strokeStyle = 'rgba(40, 25, 8, 0.35)';
  ctx.lineWidth = Math.max(4, size * 0.08);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(px, py);
  ctx.lineTo(bx, by);
  ctx.stroke();

  // Pier wood
  const pierG = ctx.createLinearGradient(ax, ay, px, py);
  pierG.addColorStop(0, '#c4a05a');
  pierG.addColorStop(1, '#8a6a30');
  ctx.strokeStyle = pierG;
  ctx.lineWidth = Math.max(2.4, size * 0.055);
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(px, py);
  ctx.lineTo(bx, by);
  ctx.stroke();

  // Plaque body with soft 3D — round dock token (CU style)
  const s = size * 0.32;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.arc(px, py, s, 0, Math.PI * 2);
  const fill = ctx.createRadialGradient(px - s * 0.3, py - s * 0.35, s * 0.1, px, py, s);
  fill.addColorStop(0, '#fff6d0');
  fill.addColorStop(0.45, '#e8c86a');
  fill.addColorStop(1, '#a87828');
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(px, py, s, 0, Math.PI * 2);
  ctx.strokeStyle = '#6a4a18';
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(px, py, s * 0.82, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.fillStyle = '#2a1c08';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.max(10, size * 0.14)}px system-ui,Segoe UI,Arial`;
  ctx.fillText(ratio, px, py - s * 0.28);
  ctx.font = `bold ${Math.max(12, size * 0.18)}px system-ui,Segoe UI,Arial`;
  ctx.fillText(icon, px, py + s * 0.28);

  ctx.restore();
}

/* ─── Intersection / edge helpers ──────────────────────────────────── */

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

function shadesFor(color: string) {
  const key = Object.keys(PLAYER_COLORS).find(k => PLAYER_COLORS[k] === color);
  if (key && PLAYER_SHADE[key]) return PLAYER_SHADE[key];
  return {
    mid: color,
    dark: shadeHex(color, -0.25),
    light: shadeHex(color, 0.2),
    edge: shadeHex(color, -0.4),
  };
}

/** Catan Universe–style leftover pieces tray (left edge of board). */
function drawPieceTray(
  ctx: CanvasRenderingContext2D,
  players: Player[],
  hexSize: number,
  H: number,
) {
  const trayW = Math.max(72, hexSize * 1.15);
  const pad = 10;
  const x0 = pad;
  const y0 = pad + 8;
  const rowH = Math.min(110, (H - y0 * 2) / Math.max(players.length, 1));

  // Tray panel
  ctx.save();
  roundRect(ctx, x0 - 4, y0 - 8, trayW, H - y0, 10);
  const bg = ctx.createLinearGradient(x0, y0, x0 + trayW, H);
  bg.addColorStop(0, 'rgba(42, 26, 12, 0.88)');
  bg.addColorStop(1, 'rgba(22, 12, 6, 0.92)');
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(200, 150, 70, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 215, 120, 0.75)';
  ctx.font = `bold ${Math.max(9, hexSize * 0.12)}px system-ui,Segoe UI,sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('PIECES', x0 + trayW / 2 - 2, y0 + 6);

  players.forEach((p, i) => {
    const cy = y0 + 22 + i * rowH + rowH * 0.35;
    const color = PLAYER_COLORS[p.color] || '#888';

    // Color chip + name
    ctx.beginPath();
    ctx.arc(x0 + 14, cy - 22, 6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#f0e6d4';
    ctx.font = `bold ${Math.max(9, hexSize * 0.11)}px system-ui,Segoe UI,sans-serif`;
    ctx.textAlign = 'left';
    const label = (p.name || p.color).slice(0, 8);
    ctx.fillText(label, x0 + 24, cy - 18);

    // Mini settlement / city / road previews with counts
    const s = Math.min(16, hexSize * 0.22);
    const baseX = x0 + 16;
    const items: { kind: 'settlement' | 'city' | 'road'; n: number }[] = [
      { kind: 'settlement', n: p.settlementsRemaining },
      { kind: 'city', n: p.citiesRemaining },
      { kind: 'road', n: p.roadsRemaining },
    ];
    items.forEach((it, j) => {
      const ix = baseX + (j % 3) * (trayW / 3.2);
      const iy = cy + 6;
      if (it.kind === 'settlement') {
        drawSettlement(ctx, ix, iy, color, s * 2.2);
      } else if (it.kind === 'city') {
        drawCity(ctx, ix, iy, color, s * 2.2);
      } else {
        drawRoad(ctx, ix - s * 0.7, iy + 2, ix + s * 0.7, iy + 2, color, s * 2.4);
      }
      ctx.fillStyle = '#fff8e7';
      ctx.font = `bold ${Math.max(10, hexSize * 0.13)}px system-ui,Segoe UI,sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(String(it.n), ix, iy + s * 1.35);
    });
  });

  ctx.restore();
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
  debug = false,
  legalIntersections,
  legalEdges,
}: BoardProps) {
  const legalI = legalIntersections || [];
  const legalE = legalEdges || [];
  const legalIKey = legalI.join('|');
  const legalEKey = legalE.join('|');
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

  const CANVAS_W = hexSize * 13.2;
  const CANVAS_H = hexSize * 11;
  const BOARD_OX = hexSize * 0.55; // shift island right so piece tray sits on wood

  // Preload painted hex + robber assets once
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

    // Crisp text + shapes
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const W = CANVAS_W;
    const H = CANVAS_H;
    const positions = buildIntersectionPositions(gameState.board, hexSize);
    posCache.current = positions;

    drawWoodBackground(ctx, W, H);
    // Draw sea/board in a translated space so the piece tray has wood on the left
    ctx.save();
    ctx.translate(BOARD_OX, 0);
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

    const [robQ, robR] = (gameState.robberHex || '').split(',').map(Number);

    // Land hexes — painted assets (procedural fallback until loaded)
    gameState.board.forEach(tile => {
      const { x, y } = hexToPixel(tile.q, tile.r, hexSize);
      const isRobber = tile.q === robQ && tile.r === robR;
      drawTerrainHex(
        ctx, x + W / 2, y + H / 2, hexSize,
        tile.type,
        isRobber,
        imagesRef.current[tile.type] || null,
      );
      if (robberMode && !isRobber && tile.type !== 'water') {
        const pts = hexCorners(x + W / 2, y + H / 2, hexSize * 0.96);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < 6; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.strokeStyle = 'rgba(255, 213, 79, 0.55)';
        ctx.lineWidth = 2.4;
        ctx.stroke();
        ctx.restore();
      }
    });

    // Harbors
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

    // Roads (under buildings)
    Object.values(gameState.edges).forEach((edge: Edge) => {
      const a = positions.get(edge.from);
      const b = positions.get(edge.to);
      if (!a || !b) return;
      const ax = a.x + W / 2, ay = a.y + H / 2;
      const bx = b.x + W / 2, by = b.y + H / 2;
      const placingRoad = legalE.includes(edge.key);
      if (!edge.road && placingRoad) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = Math.max(8, hexSize * 0.18);
        ctx.lineCap = 'round';
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
      if (edge.road) {
        drawRoad(ctx, ax, ay, bx, by, PLAYER_COLORS[edge.road] || '#666', hexSize);
      }
    });

    // Buildings
    Object.values(gameState.intersections).forEach((inter: Intersection) => {
      const pos = positions.get(inter.key);
      if (!pos) return;
      const cx = pos.x + W / 2;
      const cy = pos.y + H / 2;
      if (inter.building === 'city') {
        drawCity(ctx, cx, cy, PLAYER_COLORS[inter.owner || ''] || '#666', hexSize);
      } else if (inter.building === 'settlement') {
        drawSettlement(ctx, cx, cy, PLAYER_COLORS[inter.owner || ''] || '#666', hexSize);
      } else if (legalI.includes(inter.key)) {
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(6, hexSize * 0.12), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 236, 150, 0.55)';
        ctx.fill();
        ctx.strokeStyle = '#ffd54f';
        ctx.lineWidth = 2.2;
        ctx.stroke();
      }
    });

    // Numbers + robber (on top). Number stays visible so you can see
    // which roll is blocked; robber sits slightly south of the token.
    gameState.board.forEach(tile => {
      const { x, y } = hexToPixel(tile.q, tile.r, hexSize);
      const cx = x + W / 2;
      const cy = y + H / 2;
      const isRobber = tile.q === robQ && tile.r === robR;
      if (tile.number) {
        drawNumberToken(ctx, cx, cy + hexSize * 0.02, hexSize, tile.number);
      }
      if (isRobber) {
        drawRobber(ctx, cx, cy + hexSize * 0.28, hexSize, robberRef.current);
      }
    });

    // Debug overlay
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
        ctx.strokeStyle = '#004d40';
        ctx.lineWidth = 1;
        ctx.stroke();
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

      gameState.ports.forEach(port => {
        const [ikA, ikB] = getPortIntersections(port);
        const pa = positions.get(ikA);
        const pb = positions.get(ikB);
        if (!pa || !pb) return;
        const mx = (pa.x + pb.x) / 2 + W / 2;
        const my = (pa.y + pb.y) / 2 + H / 2;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(mx - 20, my - 8, 40, 16);
        ctx.fillStyle = '#ffd54f';
        ctx.fillText(port.type, mx, my);
      });

      ctx.restore();
    }

    // End board translate — tray sits on wood to the left of the island
    ctx.restore();
    drawPieceTray(ctx, gameState.players, hexSize, H);
  }, [gameState, hexSize, CANVAS_W, CANVAS_H, BOARD_OX, selectedAction, assetsReady, debug, robberMode, legalIKey, legalEKey]);

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
    // Board content is drawn translated by BOARD_OX
    const bx = x - BOARD_OX;
    const clickThreshold = (gameState.setupPhase ? 22 : 16) / zoom;
    const positions = posCache.current;

    // Robber placement: hex wins over corners/edges so a tap on a tile
    // doesn't get eaten by a nearby settlement vertex.
    if (robberMode) {
      const hex = pixelToHex(bx - W / 2, y - H / 2, hexSize);
      const tile = gameState.board.find(t => t.q === hex.q && t.r === hex.r);
      if (tile && tile.type !== 'water') {
        onHexClick(hex.q, hex.r);
        return;
      }
    }

    for (const inter of Object.values(gameState.intersections)) {
      const pos = positions.get(inter.key);
      if (!pos) continue;
      if (Math.hypot(bx - (pos.x + W / 2), y - (pos.y + H / 2)) < clickThreshold) {
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
      let t = ((bx - fx) * dx + (y - fy) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      if (Math.hypot(bx - (fx + t * dx), y - (fy + t * dy)) < clickThreshold) {
        onEdgeClick(edge.key);
        return;
      }
    }
    const hex = pixelToHex(bx - W / 2, y - H / 2, hexSize);
    if (gameState.board.find(t => t.q === hex.q && t.r === hex.r)) onHexClick(hex.q, hex.r);
  }, [gameState, hexSize, CANVAS_W, CANVAS_H, BOARD_OX, screenToCanvas, onIntersectionClick, onEdgeClick, onHexClick, zoom, robberMode]);

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

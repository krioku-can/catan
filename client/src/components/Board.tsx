import { useRef, useEffect } from 'react';
import type { GameState, Intersection, Edge } from '../game/types';
import { hexToPixel, pixelToHex } from '../game/board';

const RESOURCE_COLORS: Record<string, string> = {
  brick: '#c0392b',
  lumber: '#27ae60',
  wool: '#7f8c3d',
  grain: '#f39c12',
  ore: '#7f8c8d',
  desert: '#d4a574',
  water: '#2980b9',
};

const RESOURCE_ICONS: Record<string, string> = {
  brick: '🧱',
  lumber: '🪵',
  wool: '🐑',
  grain: '🌾',
  ore: '⛏️',
  desert: '🏜️',
};

const NUMBER_COLORS: Record<number, string> = {
  2: '#e74c3c',
  3: '#e67e22',
  4: '#f1c40f',
  5: '#2ecc71',
  6: '#e74c3c',
  8: '#e74c3c',
  9: '#2ecc71',
  10: '#f1c40f',
  11: '#e67e22',
  12: '#e74c3c',
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

export default function Board({ gameState, hexSize, onHexClick, onIntersectionClick, onEdgeClick, robberMode, selectedAction }: BoardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = hexSize * 8;
    const H = hexSize * 7;
    canvas.width = W;
    canvas.height = H;

    // Clear
    ctx.fillStyle = '#0a1628';
    ctx.fillRect(0, 0, W, H);

    // Draw water background
    ctx.fillStyle = RESOURCE_COLORS.water;
    ctx.fillRect(0, 0, W, H);

    // Draw hexes
    gameState.board.forEach(tile => {
      const { x, y } = hexToPixel(tile.q, tile.r, hexSize);
      const cx = x + W / 2;
      const cy = y + H / 2;

      // Hex polygon
      const points: { x: number; y: number }[] = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        points.push({
          x: cx + hexSize * Math.cos(angle),
          y: cy + hexSize * Math.sin(angle),
        });
      }

      // Fill
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < 6; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.closePath();

      const color = RESOURCE_COLORS[tile.type] || '#666';
      ctx.fillStyle = tile.hasRobber ? '#2c3e50' : color;
      ctx.fill();
      ctx.strokeStyle = '#1a1a2e';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Resource icon
      ctx.font = `${hexSize * 0.4}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(RESOURCE_ICONS[tile.type] || '', cx, cy - (tile.number ? hexSize * 0.15 : 0));

      // Number token
      if (tile.number && !tile.hasRobber) {
        const numR = hexSize * 0.22;
        ctx.beginPath();
        ctx.arc(cx, cy + hexSize * 0.25, numR, 0, Math.PI * 2);
        ctx.fillStyle = '#f5deb3';
        ctx.fill();
        ctx.strokeStyle = NUMBER_COLORS[tile.number] || '#666';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.font = `bold ${hexSize * 0.25}px Arial`;
        ctx.fillStyle = '#333';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(tile.number), cx, cy + hexSize * 0.25);

        // Pip dots for probability
        const pips = tile.number <= 6 ? tile.number - 1 : 13 - tile.number;
        for (let p = 0; p < pips; p++) {
          const angle = (Math.PI * 2 * p) / pips - Math.PI / 2;
          ctx.beginPath();
          ctx.arc(
            cx + Math.cos(angle) * numR * 0.5,
            cy + hexSize * 0.25 + Math.sin(angle) * numR * 0.5,
            2,
            0,
            Math.PI * 2,
          );
          ctx.fillStyle = NUMBER_COLORS[tile.number] || '#666';
          ctx.fill();
        }
      }

      // Robber
      if (tile.hasRobber) {
        ctx.font = `${hexSize * 0.5}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🦹', cx, cy);
      }
    });

    // Draw intersections (settlements/cities)
    const intersections: Intersection[] = Object.values(gameState.intersections);
    intersections.forEach(inter => {
      const { x, y } = hexToPixel(inter.q, inter.r, hexSize);
      const cx = x + W / 2;
      const cy = y + H / 2;

      if (inter.building) {
        const color = inter.owner || '#666';
        const colorMap: Record<string, string> = {
          red: '#e74c3c',
          blue: '#3498db',
          white: '#ecf0f1',
          orange: '#e67e22',
        };

        if (inter.building === 'settlement') {
          ctx.fillStyle = colorMap[color] || '#666';
          ctx.beginPath();
          ctx.moveTo(cx - 6, cy + 4);
          ctx.lineTo(cx - 6, cy - 2);
          ctx.lineTo(cx, cy - 8);
          ctx.lineTo(cx + 6, cy - 2);
          ctx.lineTo(cx + 6, cy + 4);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#1a1a2e';
          ctx.lineWidth = 1;
          ctx.stroke();
        } else {
          ctx.fillStyle = colorMap[color] || '#666';
          ctx.beginPath();
          ctx.moveTo(cx - 8, cy + 5);
          ctx.lineTo(cx - 8, cy - 4);
          ctx.lineTo(cx - 4, cy - 8);
          ctx.lineTo(cx - 4, cy - 12);
          ctx.lineTo(cx, cy - 10);
          ctx.lineTo(cx + 4, cy - 12);
          ctx.lineTo(cx + 4, cy - 8);
          ctx.lineTo(cx + 8, cy - 4);
          ctx.lineTo(cx + 8, cy + 5);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#1a1a2e';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fill();
      }
    });

    // Draw roads
    const edges: Edge[] = Object.values(gameState.edges);
    edges.forEach(edge => {
      if (!edge.road) return;
      
      const [fromQ, fromR] = edge.from.split(',').map(Number);
      const [toQ, toR] = edge.to.split(',').map(Number);
      
      const from = hexToPixel(fromQ, fromR, hexSize);
      const to = hexToPixel(toQ, toR, hexSize);
      
      const colorMap: Record<string, string> = {
        red: '#e74c3c',
        blue: '#3498db',
        white: '#bdc3c7',
        orange: '#e67e22',
      };

      ctx.beginPath();
      ctx.moveTo(from.x + W / 2, from.y + H / 2);
      ctx.lineTo(to.x + W / 2, to.y + H / 2);
      ctx.strokeStyle = colorMap[edge.road] || '#666';
      ctx.lineWidth = 4;
      ctx.stroke();
    });

  }, [gameState, hexSize]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        cursor: robberMode ? 'crosshair' : selectedAction ? 'pointer' : 'default',
        borderRadius: 8,
        maxWidth: '100%',
        maxHeight: '100%',
      }}
      onClick={(e) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const canvasX = x * scaleX;
        const canvasY = y * scaleY;

        const W = canvas.width;
        const H = canvas.height;
        const clickThreshold = 10;

        // Check if clicked near an intersection
        const intersections: Intersection[] = Object.values(gameState.intersections);
        for (const inter of intersections) {
          const { x: ix, y: iy } = hexToPixel(inter.q, inter.r, hexSize);
          const cx = ix + W / 2;
          const cy = iy + H / 2;
          const dist = Math.sqrt((canvasX - cx) ** 2 + (canvasY - cy) ** 2);
          if (dist < clickThreshold) {
            onIntersectionClick(inter.key);
            return;
          }
        }

        // Check if clicked near an edge
        const edges: Edge[] = Object.values(gameState.edges);
        for (const edge of edges) {
          const [fromQ, fromR] = edge.from.split(',').map(Number);
          const [toQ, toR] = edge.to.split(',').map(Number);
          const from = hexToPixel(fromQ, fromR, hexSize);
          const to = hexToPixel(toQ, toR, hexSize);
          const fx = from.x + W / 2;
          const fy = from.y + H / 2;
          const tx = to.x + W / 2;
          const ty = to.y + H / 2;

          const dx = tx - fx;
          const dy = ty - fy;
          const len2 = dx * dx + dy * dy;
          let t = ((canvasX - fx) * dx + (canvasY - fy) * dy) / len2;
          t = Math.max(0, Math.min(1, t));
          const px = fx + t * dx;
          const py = fy + t * dy;
          const dist = Math.sqrt((canvasX - px) ** 2 + (canvasY - py) ** 2);
          if (dist < clickThreshold) {
            onEdgeClick(edge.key);
            return;
          }
        }

        // Check hex click
        const relX = canvasX - W / 2;
        const relY = canvasY - H / 2;
        const hex = pixelToHex(relX, relY, hexSize);
        const tile = gameState.board.find(t => t.q === hex.q && t.r === hex.r);
        if (tile) {
          onHexClick(hex.q, hex.r);
        }
      }}
    />
  );
}

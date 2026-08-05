import { useRef, useEffect, useState, useCallback } from 'react';
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const lastTouch = useRef<{ x: number; y: number } | null>(null);
  const lastPinchDist = useRef<number | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const dragPanStart = useRef<{ x: number; y: number } | null>(null);

  const CANVAS_W = hexSize * 10;
  const CANVAS_H = hexSize * 9;

  // Draw the board
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = CANVAS_W;
    const H = CANVAS_H;
    canvas.width = W;
    canvas.height = H;

    ctx.fillStyle = '#0a1628';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = RESOURCE_COLORS.water;
    ctx.fillRect(0, 0, W, H);

    gameState.board.forEach(tile => {
      const { x, y } = hexToPixel(tile.q, tile.r, hexSize);
      const cx = x + W / 2;
      const cy = y + H / 2;

      const points: { x: number; y: number }[] = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        points.push({
          x: cx + hexSize * Math.cos(angle),
          y: cy + hexSize * Math.sin(angle),
        });
      }

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

      ctx.font = `${hexSize * 0.4}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(RESOURCE_ICONS[tile.type] || '', cx, cy - (tile.number ? hexSize * 0.15 : 0));

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

      if (tile.hasRobber) {
        ctx.font = `${hexSize * 0.5}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🦹', cx, cy);
      }
    });

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
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fill();
      }
    });

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

  }, [gameState, hexSize, CANVAS_W, CANVAS_H]);

  // Convert screen coords to canvas coords accounting for zoom/pan
  const screenToCanvas = useCallback((screenX: number, screenY: number) => {
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    const x = (screenX - rect.left - pan.x) / zoom;
    const y = (screenY - rect.top - pan.y) / zoom;
    return { x, y };
  }, [zoom, pan]);

  // Handle click on canvas
  const handleInteraction = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { x, y } = screenToCanvas(clientX, clientY);
    const W = CANVAS_W;
    const H = CANVAS_H;
    const clickThreshold = 12 / zoom;

    // Check intersections
    const intersections: Intersection[] = Object.values(gameState.intersections);
    for (const inter of intersections) {
      const { x: ix, y: iy } = hexToPixel(inter.q, inter.r, hexSize);
      const cx = ix + W / 2;
      const cy = iy + H / 2;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist < clickThreshold) {
        onIntersectionClick(inter.key);
        return;
      }
    }

    // Check edges
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
      let t = ((x - fx) * dx + (y - fy) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = fx + t * dx;
      const py = fy + t * dy;
      const dist = Math.sqrt((x - px) ** 2 + (y - py) ** 2);
      if (dist < clickThreshold) {
        onEdgeClick(edge.key);
        return;
      }
    }

    // Check hex
    const relX = x - W / 2;
    const relY = y - H / 2;
    const hex = pixelToHex(relX, relY, hexSize);
    const tile = gameState.board.find(t => t.q === hex.q && t.r === hex.r);
    if (tile) {
      onHexClick(hex.q, hex.r);
    }
  }, [gameState, hexSize, CANVAS_W, CANVAS_H, screenToCanvas, onIntersectionClick, onEdgeClick, onHexClick, zoom]);

  // Mouse events
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragStart.current = { x: e.clientX, y: e.clientY };
    dragPanStart.current = { x: pan.x, y: pan.y };
    isDragging.current = false;
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      isDragging.current = true;
      setPan({
        x: dragPanStart.current!.x + dx,
        y: dragPanStart.current!.y + dy,
      });
    }
  }, []);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) {
      handleInteraction(e.clientX, e.clientY);
    }
    dragStart.current = null;
    dragPanStart.current = null;
    isDragging.current = false;
  }, [handleInteraction]);

  // Touch events
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      lastTouch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      dragPanStart.current = { x: pan.x, y: pan.y };
      isDragging.current = false;
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist.current = Math.sqrt(dx * dx + dy * dy);
    }
  }, [pan]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1 && lastTouch.current) {
      const dx = e.touches[0].clientX - lastTouch.current.x;
      const dy = e.touches[0].clientY - lastTouch.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        isDragging.current = true;
        setPan({
          x: dragPanStart.current!.x + (e.touches[0].clientX - lastTouch.current.x),
          y: dragPanStart.current!.y + (e.touches[0].clientY - lastTouch.current.y),
        });
      }
    } else if (e.touches.length === 2 && lastPinchDist.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const scale = dist / lastPinchDist.current;
      setZoom(z => Math.max(0.3, Math.min(3, z * scale)));
      lastPinchDist.current = dist;
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current && lastTouch.current && e.changedTouches.length === 1) {
      handleInteraction(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    }
    lastTouch.current = null;
    lastPinchDist.current = null;
    isDragging.current = false;
  }, [handleInteraction]);

  // Wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.max(0.3, Math.min(3, z * delta)));
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
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onWheel={handleWheel}
      >
        <canvas
          ref={canvasRef}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
            borderRadius: 8,
            pointerEvents: 'none',
          }}
        />
      </div>
      {/* Zoom controls */}
      <div style={styles.zoomControls}>
        <button style={styles.zoomBtn} onClick={() => setZoom(z => Math.min(3, z * 1.3))}>+</button>
        <span style={styles.zoomLabel}>{Math.round(zoom * 100)}%</span>
        <button style={styles.zoomBtn} onClick={() => setZoom(z => Math.max(0.3, z / 1.3))}>−</button>
        <button style={styles.zoomBtn} onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>⟲</button>
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
  },
  viewport: {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomControls: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    background: 'rgba(15,52,96,0.9)',
    borderRadius: 10,
    padding: 6,
    zIndex: 10,
  },
  zoomBtn: {
    width: 36,
    height: 36,
    border: '1px solid #0f3460',
    borderRadius: 8,
    background: '#1a1a2e',
    color: '#e0e0e0',
    fontSize: 18,
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomLabel: {
    fontSize: 10,
    color: '#8890a0',
    textAlign: 'center',
  },
};

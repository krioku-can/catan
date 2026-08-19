import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import type { GameState, GameConfig, PlayerColor, ResourceType } from './game/types.js';
import { createInitialState, getCurrentPlayer, getPlayerByColor, rollDice, rollTurnOrder, placeSetupSettlement, placeSetupRoad, advanceSetup, placeRoad, placeSettlement, placeCity, buyDevCard, endTurn, aiTurn, moveRobber, playKnight, discardResources, playRoadBuilding, playYearOfPlenty, playMonopoly, executeBankTrade, proposePublicTrade, respondToTrade, completeTradeWith, cancelTradeOffer, normalizePlayerDevCards, countHeldDevCards, getStealTargets, stealFrom, checkVictory, hiddenVictoryPoints } from './game/rules.js';
import { getPortRate } from './game/board.js';
import { dropSubscription, getVapidPublicKey, notifyPlayer, saveSubscription, shouldPush, type PushSub } from './push.js';

const PORT = parseInt(process.env.PORT || '3001');
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://catan-lac.vercel.app';
const HOST = process.env.HOST || '0.0.0.0'; // bind all interfaces so LAN devices can reach us
// Allow the LAN dev server (http://<mac>:5173) and any localhost origin.
const ALLOWED_ORIGINS = new Set<string>([
  CORS_ORIGIN,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
]);
const corsOriginFn = (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
  if (!origin) return cb(null, true); // non-browser / same-origin
  if (ALLOWED_ORIGINS.has(origin)) return cb(null, true);
  try {
    if (new URL(origin).hostname.endsWith('vercel.app')) return cb(null, true);
  } catch { /* ignore */ }
  // Allow any 192.168/10./172.1x LAN origin (phones hitting the Mac dev server).
  if (/^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(origin)) {
    return cb(null, true);
  }
  if (/grok-sandbox\.com|grok\.me/.test(origin)) {
    return cb(null, true);
  }
  cb(null, false);
};

// ── Room Management ──

interface Room {
  id: string;
  players: PlayerConnection[];
  gameState: GameState | null;
  hostId: string;
  settings: {
    victoryPointsToWin: 10 | 12;
    friendlyRobber: boolean;
    boardMode: 'random' | 'balanced';
    turnTimer: boolean;
  };
  turnDeadline: number | null;
  pausedRemaining: number | null;
  timerGen: number;
  discardGen: number;
}

interface PlayerConnection {
  socketId: string;
  playerId: string;
  name: string;
  color: PlayerColor;
  isAI: boolean;
  ready: boolean;
  visible?: boolean;
}

const rooms = new Map<string, Room>();
const socketToRoom = new Map<string, string>(); // socketId -> roomId

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const COLORS: PlayerColor[] = ['red', 'blue', 'white', 'orange'];

const TURN_MS = 70_000;
const ROBBER_BONUS_MS = 30_000;
const DISCARD_MS = 45_000;

function defaultSettings(): Room['settings'] {
  return {
    victoryPointsToWin: 10,
    friendlyRobber: false,
    boardMode: 'balanced',
    turnTimer: false,
  };
}

function nextColor(room: Room): PlayerColor {
  const used = new Set(room.players.map(p => p.color));
  return COLORS.find(c => !used.has(c)) || 'red';
}

function reclaimSeat(room: Room, player: PlayerConnection, socket: { id: string; join: (room: string) => void }, name?: string) {
  if (player.socketId && player.socketId !== socket.id) {
    socketToRoom.delete(player.socketId);
  }
  player.socketId = socket.id;
  if (name && name.trim()) player.name = name.trim();
  socketToRoom.set(socket.id, room.id);
  socket.join(room.id);
}

/** Hide other players' cards/resources — only counts are public */
function sanitizeGameStateForPlayer(gs: GameState, viewerColor: PlayerColor | null): GameState {
  // Normalize legacy VP / missing-id cards before send.
  for (const p of gs.players) {
    normalizePlayerDevCards(p);
  }
  // Don't leak the remaining deck composition to clients.
  const publicDeckCount = (gs.devDeck || []).length;

  return {
    ...gs,
    // Clients only need the count remaining, not the order/types.
    devDeck: Array(publicDeckCount).fill('knight') as GameState['devDeck'],
    players: gs.players.map(p => {
      if (viewerColor && p.color === viewerColor) {
        // Full private hand for the viewer (including VPs + played knights).
        return p;
      }
      const totalResources = (['brick', 'lumber', 'wool', 'grain', 'ore'] as ResourceType[])
        .reduce((sum, r) => sum + (p.resources[r] || 0), 0);
      const hiddenDev = countHeldDevCards(p);
      const hiddenVP = hiddenVictoryPoints(p);
      return {
        ...p,
        victoryPoints: Math.max(0, (p.victoryPoints || 0) - hiddenVP),
        resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 },
        // Face-down stubs only — count matches real held cards; types hidden.
        // VP cards stay in the hidden count so the public score doesn't leak them.
        devCards: Array.from({ length: hiddenDev }, (_, i) => ({
          id: `hidden_${p.color}_${i}`,
          type: 'knight' as const,
          played: false,
        })),
        _hidden: true,
        _resourceCount: totalResources,
        _devCardCount: hiddenDev,
      } as typeof p & { _hidden: boolean; _resourceCount: number; _devCardCount: number };
    }),
  };
}

function emitGameToRoom(room: Room, action?: string, result?: unknown) {
  if (!room.gameState) return;
  const timer = serializeTimer(room);
  for (const conn of room.players) {
    if (conn.isAI || !conn.socketId) continue;
    const payload = {
      gameState: sanitizeGameStateForPlayer(room.gameState, conn.color),
      timer,
      ...(action !== undefined ? { action, result: sanitizeActionResult(action, result, conn.color) } : {}),
    };
    io.to(conn.socketId).emit(action === undefined ? 'game_started' : 'game_update',
      action === undefined ? { gameState: payload.gameState, timer } : payload);
  }
}

function sanitizeActionResult(action: string | undefined, result: unknown, viewer: PlayerColor) {
  if (!result || typeof result !== 'object') return result;
  const r = result as { resource?: string; to?: PlayerColor };
  if (action === 'steal' && r.resource && r.to && r.to !== viewer) {
    const { resource: _hidden, ...rest } = r as Record<string, unknown>;
    return rest;
  }
  return result;
}

function serializeTimer(room: Room) {
  return {
    enabled: !!room.settings?.turnTimer,
    deadline: room.turnDeadline,
    paused: room.turnDeadline == null && room.pausedRemaining != null,
    pausedRemainingMs: room.pausedRemaining,
  };
}

function clearTurnTimer(room: Room) {
  room.timerGen++;
  room.discardGen++;
  room.turnDeadline = null;
  room.pausedRemaining = null;
}

function armTurnClock(room: Room, ms: number) {
  room.timerGen++;
  const gen = room.timerGen;
  room.pausedRemaining = null;
  room.turnDeadline = Date.now() + Math.max(0, ms);
  setTimeout(() => {
    if (room.timerGen !== gen) return;
    onTurnTimeout(room);
  }, Math.max(0, ms) + 40);
}

function pauseTurnTimer(room: Room) {
  if (room.turnDeadline == null) return;
  room.pausedRemaining = Math.max(0, room.turnDeadline - Date.now());
  room.timerGen++;
  room.turnDeadline = null;
}

function resumeTurnTimer(room: Room) {
  if (room.pausedRemaining == null) return;
  const ms = room.pausedRemaining;
  room.pausedRemaining = null;
  armTurnClock(room, ms);
}

function addRobberBonus(room: Room) {
  if (!room.settings.turnTimer) return;
  if (room.pausedRemaining != null) {
    room.pausedRemaining += ROBBER_BONUS_MS;
    return;
  }
  if (room.turnDeadline != null) {
    const left = Math.max(0, room.turnDeadline - Date.now());
    armTurnClock(room, left + ROBBER_BONUS_MS);
    return;
  }
  armTurnClock(room, ROBBER_BONUS_MS);
}

function armDiscardWatch(room: Room) {
  room.discardGen++;
  const gen = room.discardGen;
  setTimeout(() => {
    if (room.discardGen !== gen || !room.gameState) return;
    if (room.gameState.phase !== 'discard') return;
    autoDiscardHumans(room.gameState);
    autoDiscardAIs(room.gameState);
    emitGameToRoom(room, 'discard', { success: true, timedOut: true });
    afterActionTimer(room, snapshotTurn(room));
    scheduleAITurn(room, 400);
  }, DISCARD_MS);
}

function afterActionTimer(
  room: Room,
  prev: { color: PlayerColor | null; discard?: PlayerColor[]; started?: boolean },
  opts?: { rolledSeven?: boolean },
) {
  if (!room.settings?.turnTimer || !room.gameState || room.gameState.winner) {
    clearTurnTimer(room);
    return;
  }
  const gs = room.gameState;
  if (opts?.rolledSeven) addRobberBonus(room);

  if (gs.phase === 'discard') {
    if (room.turnDeadline != null) pauseTurnTimer(room);
    armDiscardWatch(room);
    emitTimerSync(room);
    return;
  }

  room.discardGen++;
  const current = getCurrentPlayer(gs);
  if (current.isAI) {
    clearTurnTimer(room);
    emitTimerSync(room);
    return;
  }

  const newTurn = !!prev.started || prev.color !== current.color;
  if (newTurn) {
    armTurnClock(room, TURN_MS);
  } else if (room.pausedRemaining != null) {
    resumeTurnTimer(room);
  }
  emitTimerSync(room);
}

function emitTimerSync(room: Room) {
  if (!room.gameState) return;
  emitGameToRoom(room, 'timer_sync', serializeTimer(room));
}

function autoDiscardHumans(gs: NonNullable<Room['gameState']>) {
  const resources: ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];
  let guard = 0;
  while (gs.phase === 'discard' && guard++ < 10) {
    const human = gs.players.find(p => !p.isAI && gs.discardQueue.includes(p.color));
    if (!human) break;
    const total = resources.reduce((s, r) => s + (human.resources[r] || 0), 0);
    const mustDiscard = Math.floor(total / 2);
    const toDiscard: Partial<Record<ResourceType, number>> = {};
    let remaining = mustDiscard;
    const sorted = [...resources].sort((a, b) => (human.resources[b] || 0) - (human.resources[a] || 0));
    for (const r of sorted) {
      if (remaining <= 0) break;
      const take = Math.min(human.resources[r] || 0, remaining);
      if (take > 0) { toDiscard[r] = take; remaining -= take; }
    }
    discardResources(gs, human.color, toDiscard);
  }
}

function announceTimeout(room: Room, name: string, detail: string) {
  io.to(room.id).emit('chat_message', {
    playerName: 'Table',
    playerColor: 'white',
    text: `Time's up — ${name}${detail}`,
  });
}

function onTurnTimeout(room: Room) {
  const gs = room.gameState;
  if (!gs || gs.winner || !room.settings.turnTimer) return;
  const current = getCurrentPlayer(gs);
  console.log(`[timer] timeout ${room.id} ${current.name} phase=${gs.phase}`);

  if (gs.phase === 'discard') {
    autoDiscardHumans(gs);
    autoDiscardAIs(gs);
    announceTimeout(room, current.name, ': leftover cards discarded');
    emitGameToRoom(room, 'discard', { success: true, timedOut: true });
    afterActionTimer(room, snapshotTurn(room));
    scheduleAITurn(room, 400);
    return;
  }

  if (gs.setupPhase) {
    const name = current.name;
    forceHumanAsAI(room, 2);
    announceTimeout(room, name, ': setup piece placed');
    afterActionTimer(room, { color: current.color, discard: [] });
    scheduleAITurn(room, 400);
    return;
  }

  if (gs.pendingRobberMove && !gs.robberMovedThisTurn) {
    const name = current.name;
    forceHumanAsAI(room, 1);
    if (gs.phase === 'trade' || gs.phase === 'build') endTurn(gs);
    announceTimeout(room, name, ': robber moved, turn ended');
    emitGameToRoom(room, 'end_turn', { success: true, timedOut: true });
    afterActionTimer(room, { color: current.color, discard: [] });
    scheduleAITurn(room, 400);
    return;
  }

  if (gs.phase === 'roll') {
    const name = current.name;
    const [d1, d2] = rollDice(gs);
    const seven = d1 + d2 === 7;
    if (seven) autoDiscardAIs(gs);
    announceTimeout(room, name, seven ? ': rolled a 7' : `: rolled ${d1 + d2}, turn ended`);
    if (seven) {
      emitGameToRoom(room, 'roll_dice', { dice: [d1, d2], total: d1 + d2, robberMode: true, timedOut: true });
      afterActionTimer(room, { color: current.color, discard: [] }, { rolledSeven: true });
      return;
    }
    endTurn(gs);
    emitGameToRoom(room, 'end_turn', { success: true, timedOut: true, dice: [d1, d2] });
    afterActionTimer(room, { color: current.color, discard: [] });
    scheduleAITurn(room, 400);
    return;
  }

  if (gs.phase === 'trade' || gs.phase === 'build') {
    const name = current.name;
    endTurn(gs);
    announceTimeout(room, name, ': turn ended');
    emitGameToRoom(room, 'end_turn', { success: true, timedOut: true });
    afterActionTimer(room, { color: current.color, discard: [] });
    scheduleAITurn(room, 400);
  }
}

/** Temporarily treat the current human as AI so existing AI move logic can finish a step. */
function forceHumanAsAI(room: Room, maxSteps: number) {
  if (!room.gameState) return;
  const player = getCurrentPlayer(room.gameState);
  const color = player.color;
  const wasAI = player.isAI;
  player.isAI = true;
  try {
    for (let i = 0; i < maxSteps; i++) {
      if (!room.gameState) break;
      const cur = getCurrentPlayer(room.gameState);
      if (cur.color !== color) break;
      cur.isAI = true;
      const action = aiTurn(room.gameState);
      if (!action) break;
      applyAiAction(room, action, cur);
    }
  } finally {
    const p = room.gameState?.players.find(x => x.color === color);
    if (p) p.isAI = wasAI;
  }
}

// ── Express Setup ──

const app = express();
app.use(cors({ origin: corsOriginFn }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: corsOriginFn, methods: ['GET', 'POST'] },
});

// Health check (root + /api/health — Render free tier wake pings)
app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'catan-server', rooms: rooms.size });
});
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', rooms: rooms.size });
});

app.get('/api/push/vapid-public-key', (_req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

app.post('/api/push/subscribe', (req, res) => {
  const playerId = String(req.body?.playerId || '');
  const subscription = req.body?.subscription as PushSub | undefined;
  if (!playerId || !subscription?.endpoint) {
    res.status(400).json({ error: 'playerId and subscription required' });
    return;
  }
  saveSubscription(playerId, subscription);
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', (req, res) => {
  const playerId = String(req.body?.playerId || '');
  const endpoint = req.body?.endpoint ? String(req.body.endpoint) : undefined;
  if (!playerId) {
    res.status(400).json({ error: 'playerId required' });
    return;
  }
  dropSubscription(playerId, endpoint);
  res.json({ ok: true });
});

function snapshotTurn(room: Room): { color: PlayerColor | null; discard: PlayerColor[] } {
  if (!room.gameState) return { color: null, discard: [] };
  return {
    color: getCurrentPlayer(room.gameState).color,
    discard: [...(room.gameState.discardQueue || [])],
  };
}

function notifyTurnChange(
  room: Room,
  prev: { color: PlayerColor | null; discard: PlayerColor[]; started?: boolean; joinedName?: string },
) {
  const url = `/?room=${room.id}`;
  if (prev.joinedName) {
    for (const p of room.players) {
      if (p.isAI || p.name === prev.joinedName) continue;
      if (!shouldPush(p)) continue;
      void notifyPlayer(p.playerId, {
        title: 'Catan',
        body: `${prev.joinedName} joined room ${room.id}`,
        tag: `catan-join-${room.id}`,
        url,
      });
    }
  }
  if (!room.gameState) return;
  if (prev.started) {
    for (const p of room.players) {
      if (!shouldPush(p)) continue;
      void notifyPlayer(p.playerId, {
        title: 'Catan',
        body: `Game started in room ${room.id}`,
        tag: `catan-start-${room.id}`,
        url,
      });
    }
  }
  const nowDiscard = room.gameState.discardQueue || [];
  for (const color of nowDiscard) {
    if (prev.discard.includes(color)) continue;
    const p = room.players.find(x => x.color === color);
    if (!p || !shouldPush(p)) continue;
    void notifyPlayer(p.playerId, {
      title: 'Catan',
      body: 'A 7 was rolled — discard half your hand',
      tag: 'catan-discard',
      url,
    });
  }
  const current = getCurrentPlayer(room.gameState);
  if (!current.isAI && current.color !== prev.color && room.gameState.phase !== 'discard') {
    const p = room.players.find(x => x.color === current.color);
    if (p && shouldPush(p)) {
      void notifyPlayer(p.playerId, {
        title: 'Catan',
        body: room.gameState.setupPhase ? 'Place your settlement or road' : "It's your turn",
        tag: 'catan-turn',
        url,
      });
    }
  }
}

// List public rooms
app.get('/api/rooms', (_req, res) => {
  const roomList = Array.from(rooms.values()).map(r => ({
    id: r.id,
    players: r.players.map(p => ({ name: p.name, color: p.color, ready: p.ready })),
    inGame: r.gameState !== null,
  }));
  res.json(roomList);
});

// ── Socket.io Events ──

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  // ── Create Room ──
  socket.on('create_room', ({ name }: { name: string }, callback) => {
    let roomCode: string;
    do { roomCode = generateRoomCode(); } while (rooms.has(roomCode));

    const playerId = uuidv4();
    const room: Room = {
      id: roomCode,
      players: [{
        socketId: socket.id,
        playerId,
        name: name || 'Host',
        color: 'red',
        isAI: false,
        ready: false,
      }],
      gameState: null,
      hostId: playerId,
      settings: defaultSettings(),
      turnDeadline: null,
      pausedRemaining: null,
      timerGen: 0,
      discardGen: 0,
    };

    rooms.set(roomCode, room);
    socketToRoom.set(socket.id, roomCode);
    socket.join(roomCode);

    console.log(`[room] Created ${roomCode} by ${name}`);
    callback({ roomCode, playerId });
    io.to(roomCode).emit('room_update', serializeRoom(room));
  });

  // ── Join Room ──
  socket.on('join_room', ({ roomCode, name, playerId: existingId }: { roomCode: string; name: string; playerId?: string }, callback) => {
    const code = (roomCode || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      callback({ error: 'Table not found — check the code' });
      return;
    }

    const trimmed = (name || '').trim() || 'Player';

    // Reclaim an existing seat by id (refresh / same device) or by name if that
    // person is parked (lost session, opened the invite again).
    const byId = existingId
      ? room.players.find(p => p.playerId === existingId && !p.isAI)
      : undefined;
    const parkedByName = room.players.find(p =>
      !p.isAI && !p.socketId && p.name.trim().toLowerCase() === trimmed.toLowerCase()
    );
    const seat = byId || parkedByName;
    if (seat) {
      reclaimSeat(room, seat, socket, trimmed);
      console.log(`[room] ${seat.name} reclaimed seat in ${code}`);
      callback({ playerId: seat.playerId, color: seat.color, rejoined: true });
      io.to(code).emit('room_update', serializeRoom(room));
      if (room.gameState) {
        const payload = {
          gameState: sanitizeGameStateForPlayer(room.gameState, seat.color),
          timer: serializeTimer(room),
        };
        socket.emit('game_started', payload);
        socket.emit('game_update', payload);
      }
      return;
    }

    if (room.gameState) {
      callback({ error: 'Game already in progress. Sit down with the same name you used before to reclaim your seat.' });
      return;
    }
    if (room.players.length >= 4) {
      callback({ error: 'This table is full' });
      return;
    }

    const playerId = uuidv4();
    const color = nextColor(room);
    room.players.push({
      socketId: socket.id,
      playerId,
      name: trimmed,
      color,
      isAI: false,
      ready: false,
    });

    socketToRoom.set(socket.id, code);
    socket.join(code);

    console.log(`[room] ${trimmed} joined ${code}`);
    callback({ playerId, color });
    io.to(code).emit('room_update', serializeRoom(room));
    notifyTurnChange(room, { color: null, discard: [], joinedName: trimmed });
  });

  // ── Rejoin after refresh / brief disconnect ──
  socket.on('rejoin_room', (
    { roomCode, playerId, name }: { roomCode: string; playerId: string; name?: string },
    callback: (res: { ok?: boolean; playerId?: string; error?: string; inGame?: boolean }) => void,
  ) => {
    const code = (roomCode || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      callback({ error: 'Room not found' });
      return;
    }
    const player = room.players.find(p => p.playerId === playerId && !p.isAI);
    if (!player) {
      callback({ error: 'Seat not found' });
      return;
    }
    // Drop any stale socket mapping for this seat
    if (player.socketId && player.socketId !== socket.id) {
      socketToRoom.delete(player.socketId);
    }
    player.socketId = socket.id;
    if (name) player.name = name;
    socketToRoom.set(socket.id, code);
    socket.join(code);
    console.log(`[room] ${player.name} rejoined ${code}`);
    callback({ ok: true, playerId: player.playerId, inGame: !!room.gameState });
    io.to(code).emit('room_update', serializeRoom(room));
    if (room.gameState) {
      const payload = {
        gameState: sanitizeGameStateForPlayer(room.gameState, player.color),
        timer: serializeTimer(room),
      };
      socket.emit('game_started', payload);
      socket.emit('game_update', payload);
    }
  });

  // ── Leave Room (explicit) ──
  socket.on('leave_room', () => {
    const roomCode = socketToRoom.get(socket.id);
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    const idx = room.players.findIndex(p => p.socketId === socket.id);
    if (idx >= 0) {
      const leaving = room.players[idx];
      room.players.splice(idx, 1);
      if (room.hostId === leaving.playerId) {
        const newHost = room.players.find(p => !p.isAI);
        if (newHost) room.hostId = newHost.playerId;
      }
    }
    socket.leave(roomCode);
    socketToRoom.delete(socket.id);
    if (room.players.filter(p => !p.isAI).length === 0) {
      rooms.delete(roomCode);
      console.log(`[room] Deleted ${roomCode} (no humans left)`);
    } else {
      io.to(roomCode).emit('room_update', serializeRoom(room));
    }
  });

  // ── Toggle Ready ──
  socket.on('toggle_ready', () => {
    const roomCode = socketToRoom.get(socket.id);
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    const player = room.players.find(p => p.socketId === socket.id);
    if (player) {
      player.ready = !player.ready;
      io.to(roomCode).emit('room_update', serializeRoom(room));
    }
  });

  // ── Add AI Player ──
  socket.on('add_ai', () => {
    const roomCode = socketToRoom.get(socket.id);
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room || room.gameState) return;
    if (room.players.length >= 4) return;

    const playerId = uuidv4();
    const color = nextColor(room);
    room.players.push({
      socketId: '',
      playerId,
      name: `AI ${room.players.filter(p => p.isAI).length + 1}`,
      color,
      isAI: true,
      ready: true,
    });

    io.to(roomCode).emit('room_update', serializeRoom(room));
  });

  // ── Remove AI Player ──
  socket.on('remove_ai', ({ playerId }: { playerId: string }) => {
    const roomCode = socketToRoom.get(socket.id);
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room || room.gameState) return;

    const idx = room.players.findIndex(p => p.playerId === playerId && p.isAI);
    if (idx >= 0) {
      room.players.splice(idx, 1);
      io.to(roomCode).emit('room_update', serializeRoom(room));
    }
  });

  // ── Start Game ──
  socket.on('start_game', () => {
    const roomCode = socketToRoom.get(socket.id);
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room || room.gameState) return;
    const starter = room.players.find(p => p.socketId === socket.id);
    if (!starter || starter.playerId !== room.hostId) return;
    if (room.players.length < 2) return;

    const config: GameConfig = {
      numPlayers: room.players.length,
      playerNames: room.players.map(p => p.name),
      aiPlayers: room.players.map((p, i) => p.isAI ? i : -1).filter(i => i >= 0),
      victoryPointsToWin: room.settings?.victoryPointsToWin ?? 10,
      friendlyRobber: room.settings?.friendlyRobber ?? false,
      boardMode: room.settings?.boardMode ?? 'balanced',
    };

    room.gameState = createInitialState(config);
    const rolled = rollTurnOrder(room.gameState);
    room.gameState.phase = 'setup_settlement';
    room.gameState.setupRound = 0;
    console.log(`[game] Started in ${roomCode} with ${room.players.length} players · ${config.victoryPointsToWin}VP · first=${room.gameState.turnOrder[0]}`);

    emitGameToRoom(room);
    emitGameToRoom(room, 'roll_turn_order', { order: rolled.order, rolls: rolled.rolls, started: true });
    notifyTurnChange(room, { color: null, discard: [], started: true });
    afterActionTimer(room, { color: null, discard: [], started: true });
    scheduleAITurn(room, 600);
  });

  // Host updates custom game settings (Catan Universe-style)
  socket.on('update_settings', (partial: Partial<Room['settings']>) => {
    const roomCode = socketToRoom.get(socket.id);
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room || room.gameState) return;
    const conn = room.players.find(p => p.socketId === socket.id);
    if (!conn || conn.playerId !== room.hostId) return;
    if (!room.settings) room.settings = defaultSettings();
    if (partial.victoryPointsToWin === 10 || partial.victoryPointsToWin === 12) {
      room.settings.victoryPointsToWin = partial.victoryPointsToWin;
    }
    if (typeof partial.friendlyRobber === 'boolean') {
      room.settings.friendlyRobber = partial.friendlyRobber;
    }
    if (partial.boardMode === 'random' || partial.boardMode === 'balanced') {
      room.settings.boardMode = partial.boardMode;
    }
    if (typeof partial.turnTimer === 'boolean') {
      room.settings.turnTimer = partial.turnTimer;
    }
    io.to(roomCode).emit('room_update', serializeRoom(room));
  });

  // ── Game Actions ──
  const handleGameAction = (action: string, data: any) => {
    const roomCode = socketToRoom.get(socket.id);
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room?.gameState) return;

    const gs = room.gameState;
    if (gs.winner) return;
    const conn = room.players.find(p => p.socketId === socket.id);
    if (!conn) return;

    const current = getCurrentPlayer(gs);
    const isCurrent = !!current && conn.color === current.color;
    const spectatorOk = ['discard', 'accept_trade', 'reject_trade', 'counter_trade'].includes(action);
    if (!isCurrent && !spectatorOk) return;

    const robberPending = !!gs.pendingRobberMove && !gs.robberMovedThisTurn && gs.phase !== 'discard';
    if (robberPending && isCurrent && !['move_robber', 'steal', 'discard'].includes(action)) {
      return;
    }
    const prev = snapshotTurn(room);
    const player = current;

    let result: any = null;

    switch (action) {
      case 'roll_turn_order': {
        // Human rolls for turn order (mirrors the AI path). Sets turnOrder,
        // currentTurn=0, and advances to the first setup settlement.
        if (gs.phase !== 'turn_order') return;
        const res = rollTurnOrder(gs);
        gs.phase = 'setup_settlement';
        gs.setupRound = 0;
        result = { order: res.order, rolls: res.rolls };
        break;
      }
      case 'roll_dice': {
        const [d1, d2] = rollDice(gs);
        result = { dice: [d1, d2], total: d1 + d2 };
        // rollDice() sets phase to 'trade' (or 'discard' on a 7). Per official
        // rules the turn is roll → trade → build, so the roller stays in the
        // trade phase and advances to build via the 'skip_trade' action.
        if (d1 + d2 === 7) {
          // Auto-discard for AI players who have >7 cards.
          autoDiscardAIs(gs);
          // Per official Catan rules, the roller MUST move the robber to a
          // new hex BEFORE stealing. Steal targets are computed by the
          // 'move_robber' case from the NEW hex — not here from the current
          // one. Just signal robberMode and let the client drive the move.
          result.robberMode = true;
        }
        break;
      }
      case 'move_robber': {
        if (!getCurrentPlayer(gs) || getCurrentPlayer(gs).color !== conn.color) return;
        if (!gs.pendingRobberMove || gs.robberMovedThisTurn) return;
        const err = moveRobber(gs, Number(data.q), Number(data.r));
        if (err) return;
        const targets = getStealTargets(gs, Number(data.q), Number(data.r));
        result = { success: true, stealTargets: targets, hex: { q: Number(data.q), r: Number(data.r) } };
        break;
      }
      case 'steal': {
        if (!isCurrent) return;
        if (!gs.robberMovedThisTurn) return;
        const [rq, rr] = (gs.robberHex || '0,0').split(',').map(Number);
        const legal = getStealTargets(gs, rq, rr);
        if (!legal.includes(data.target)) return;
        const out: { resource?: ResourceType } = {};
        const err = stealFrom(gs, data.target, out);
        if (err) return;
        result = {
          success: true,
          from: data.target,
          to: conn.color,
          resource: out.resource,
        };
        io.to(room.id).emit('chat_message', {
          playerName: conn.name,
          playerColor: conn.color,
          text: `stole a resource from ${getPlayerByColor(gs, data.target)?.name || data.target}`,
        });
        break;
      }
      case 'place_settlement': {
        if (gs.setupPhase) {
          const err = placeSetupSettlement(gs, data.key);
          if (err) return;
          advanceSetup(gs);
        } else {
          const err = placeSettlement(gs, data.key);
          if (err) return;
        }
        result = { success: true };
        break;
      }
      case 'place_road': {
        if (gs.setupPhase) {
          const err = placeSetupRoad(gs, data.key);
          if (err) return;
          advanceSetup(gs);
        } else {
          const err = placeRoad(gs, data.key);
          if (err) return;
        }
        result = { success: true };
        break;
      }
      case 'place_city': {
        const err = placeCity(gs, data.key);
        if (err) return;
        result = { success: true };
        break;
      }
      case 'buy_dev_card': {
        const card = buyDevCard(gs);
        result = { card: card ? { type: card.type } : null };
        break;
      }
      case 'play_knight': {
        const err = playKnight(gs);
        if (err) return;
        result = { success: true, robberMode: true };
        break;
      }
      case 'end_turn': {
        endTurn(gs);
        result = { success: true };
        break;
      }
      case 'skip_trade': {
        gs.phase = 'build';
        result = { success: true };
        break;
      }
      case 'bank_trade': {
        const { give, want } = data;
        const giveEntries = Object.entries(give || {});
        const wantEntries = Object.entries(want || {});
        if (giveEntries.length > 0 && wantEntries.length > 0) {
          const [gRes, gAmt] = giveEntries[0];
          const [wRes] = wantEntries[0];
          const err = executeBankTrade(gs, gRes as ResourceType, Number(gAmt) || 0, wRes as ResourceType);
          if (err) return;
        } else {
          return;
        }
        result = { success: true };
        break;
      }
      case 'discard': {
        const err = discardResources(gs, conn.color, data.discard);
        if (err) return;
        result = { success: true };
        break;
      }
      case 'play_road_building': {
        const err = playRoadBuilding(gs);
        if (err) return;
        result = { success: true };
        break;
      }
      case 'play_year_of_plenty': {
        const err = playYearOfPlenty(gs, data.res1, data.res2);
        if (err) return;
        result = { success: true };
        break;
      }
      case 'play_monopoly': {
        const err = playMonopoly(gs, data.resource);
        if (err) return;
        result = { success: true };
        break;
      }
      case 'propose_trade': {
        // Public table offer. Others register interest; proposer completes later.
        const from = conn.color;
        if (!getCurrentPlayer(gs) || getCurrentPlayer(gs).color !== from) return;
        const err = proposePublicTrade(gs, data.give, data.want);
        if (err) return;
        result = { success: true, offer: { from, give: data.give, want: data.want } };
        break;
      }
      case 'accept_trade': {
        const err = respondToTrade(gs, conn.color, data.from, true);
        if (err) return;
        result = { success: true };
        break;
      }
      case 'reject_trade': {
        const err = respondToTrade(gs, conn.color, data.from, false);
        if (err) return;
        result = { success: true };
        break;
      }
      case 'complete_trade': {
        if (!getCurrentPlayer(gs) || getCurrentPlayer(gs).color !== conn.color) return;
        const err = completeTradeWith(gs, data.partner);
        if (err) return;
        result = { success: true, partner: data.partner };
        break;
      }
      case 'cancel_trade': {
        if (!getCurrentPlayer(gs) || getCurrentPlayer(gs).color !== conn.color) return;
        cancelTradeOffer(gs, conn.color);
        result = { success: true };
        break;
      }
      case 'counter_trade': {
        // The target counters a pending offer: replace it with a new offer
        // from the target back to the original proposer.
        const offer = gs.tradeOffers.find(o => (o.to === undefined || o.to === conn.color) && o.from === data.from);
        if (!offer) return;
        const to = getPlayerByColor(gs, conn.color);
        // Validate the countering player has the resources they're offering.
        for (const [r, n] of Object.entries(data.give || {})) {
          if ((to.resources[r as ResourceType] || 0) < (Number(n) || 0)) return;
        }
        // Replace the offer with a counter-offer (direction reversed).
        gs.tradeOffers = gs.tradeOffers.filter(o => o !== offer);
        gs.tradeOffers.push({ from: conn.color, to: offer.from, give: data.give, want: data.want });
        result = { success: true };
        break;
      }
    }

    if (result !== null) {
      checkVictory(gs);
      const rolledSeven = action === 'roll_dice' && result && (result as { total?: number }).total === 7;
      emitGameToRoom(room, action, result);
      notifyTurnChange(room, prev);
      afterActionTimer(room, prev, { rolledSeven: !!rolledSeven });
      if (action === 'propose_trade' || action === 'counter_trade') {
        scheduleAITradeResponses(room);
      }
      scheduleAITurn(room, 800);
    }
  };

  socket.on('game_action', ({ action, data }: { action: string; data: any }) => {
    handleGameAction(action, data);
  });

  // ── Presence (skip push while the tab is focused) ──
  socket.on('presence', ({ visible }: { visible?: boolean }) => {
    const roomCode = socketToRoom.get(socket.id);
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    const player = room?.players.find(p => p.socketId === socket.id);
    if (player) player.visible = !!visible;
  });

  // ── Chat ──
  socket.on('chat_message', ({ text }: { text: string }) => {
    const roomCode = socketToRoom.get(socket.id);
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;

    io.to(roomCode).emit('chat_message', {
      playerName: player.name,
      playerColor: player.color,
      text,
    });
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    const roomCode = socketToRoom.get(socket.id);
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) {
      socketToRoom.delete(socket.id);
      return;
    }

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) {
      socketToRoom.delete(socket.id);
      return;
    }

    // Keep the seat (lobby or in-game) so family can lock a phone and come back.
    player.socketId = '';
    socketToRoom.delete(socket.id);
    io.to(roomCode).emit('room_update', serializeRoom(room));
    console.log(`[disconnect] ${player.name} parked in ${roomCode}${room.gameState ? ' (in-game)' : ' (lobby)'}`);
  });
});

// ── AI helpers ──
/** After a 7, every AI with >7 cards must discard half. Drain them all so the
 *  discard queue never stalls waiting on an AI that isn't the current player. */
function autoDiscardAIs(gs: NonNullable<Room['gameState']>) {
  let guard = 0;
  while (gs.phase === 'discard' && guard++ < 10) {
    const aiInQueue = gs.players.find(
      p => p.isAI && gs.discardQueue.includes(p.color)
    );
    if (!aiInQueue) break;
    const total = (['brick', 'lumber', 'wool', 'grain', 'ore'] as ResourceType[])
      .reduce((s, r) => s + (aiInQueue.resources[r] || 0), 0);
    const mustDiscard = Math.floor(total / 2);
    const toDiscard: Partial<Record<ResourceType, number>> = {};
    let remaining = mustDiscard;
    const sorted = (['brick', 'lumber', 'wool', 'grain', 'ore'] as ResourceType[])
      .sort((a, b) => (aiInQueue.resources[b] || 0) - (aiInQueue.resources[a] || 0));
    for (const r of sorted) {
      if (remaining <= 0) break;
      const take = Math.min(aiInQueue.resources[r] || 0, remaining);
      if (take > 0) { toDiscard[r] = take; remaining -= take; }
    }
    discardResources(gs, aiInQueue.color, toDiscard);
  }
}

function scheduleAITurn(room: Room, delayMs = 600) {
  setTimeout(() => {
    if (!room.gameState || room.gameState.winner) return;
    const current = getCurrentPlayer(room.gameState);
    if (current?.isAI) runAITurn(room);
  }, delayMs);
}

/** AIs answer public table offers even when it is not their turn. */
function scheduleAITradeResponses(room: Room) {
  if (!room.gameState) return;
  const ais = room.gameState.players.filter(p => p.isAI);
  if (ais.length === 0) return;
  ais.forEach((ai, i) => {
    setTimeout(() => {
      const gs = room.gameState;
      if (!gs) return;
      const offer = gs.tradeOffers.find(o => o.to === undefined);
      if (!offer || offer.from === ai.color) return;
      if ((offer.acceptedBy || []).includes(ai.color)) return;
      if ((offer.rejectedBy || []).includes(ai.color)) return;
      const giveTotal = Object.values(offer.give || {}).reduce((s, n) => s + (Number(n) || 0), 0);
      const wantTotal = Object.values(offer.want || {}).reduce((s, n) => s + (Number(n) || 0), 0);
      const resources: ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];
      const surplus = resources.filter(r => (ai.resources[r] || 0) >= 3);
      const scarce = resources.filter(r => (ai.resources[r] || 0) <= 1);
      const givesSurplus = Object.keys(offer.want || {}).every(r => surplus.includes(r as ResourceType));
      const getsScarce = Object.keys(offer.give || {}).some(r => scarce.includes(r as ResourceType));
      let canPay = true;
      for (const [r, n] of Object.entries(offer.want || {})) {
        if ((ai.resources[r as ResourceType] || 0) < (Number(n) || 0)) canPay = false;
      }
      const favorable = canPay && (wantTotal >= giveTotal || (givesSurplus && getsScarce));
      const err = respondToTrade(gs, ai.color, offer.from, favorable);
      if (err) return;
      emitGameToRoom(room, favorable ? 'accept_trade' : 'reject_trade', {
        success: true,
        from: offer.from,
        by: ai.color,
      });
      io.to(room.id).emit('chat_message', {
        playerName: ai.name,
        playerColor: ai.color,
        text: favorable ? 'accepted the table offer' : 'declined the table offer',
      });
    }, 550 + i * 450);
  });
}

// ── AI Turn Runner ──
function runAITurn(room: Room) {
  if (!room.gameState || room.gameState.winner) return;
  const gs = room.gameState;
  const prev = snapshotTurn(room);
  const current = getCurrentPlayer(gs);
  if (!current?.isAI) return;

  const action = aiTurn(gs);
  if (!action) return;
  if (!applyAiAction(room, action, current)) return;

  checkVictory(gs);
  notifyTurnChange(room, prev);
  afterActionTimer(room, prev);
  scheduleAITurn(room, 600);
}

function applyAiAction(
  room: Room,
  action: { action: string; data?: any },
  current: { name: string },
): boolean {
  const gs = room.gameState;
  if (!gs) return false;

  switch (action.action) {
    case 'roll_dice': {
      const [d1, d2] = rollDice(gs);
      if (d1 + d2 === 7) autoDiscardAIs(gs);
      emitGameToRoom(room, 'roll_dice', { dice: [d1, d2], total: d1 + d2, robberMode: d1 + d2 === 7 });
      return true;
    }
    case 'skip_trade': {
      gs.phase = 'build';
      emitGameToRoom(room, 'skip_trade', { success: true });
      return true;
    }
    case 'roll_turn_order': {
      emitGameToRoom(room, 'roll_turn_order', { order: gs.turnOrder });
      return true;
    }
    case 'discard': {
      autoDiscardAIs(gs);
      emitGameToRoom(room, 'discard', { success: true });
      return true;
    }
    case 'place_settlement': {
      const key = action.data?.key;
      if (gs.setupPhase) {
        const err = placeSetupSettlement(gs, key);
        if (err) {
          console.warn(`[ai] ${current.name} settlement failed: ${err}`);
          return false;
        }
        advanceSetup(gs);
      } else {
        const err = placeSettlement(gs, key);
        if (err) {
          console.warn(`[ai] ${current.name} settlement failed: ${err}`);
          return false;
        }
      }
      emitGameToRoom(room, 'place_settlement', { success: true, key });
      return true;
    }
    case 'place_road': {
      const key = action.data?.key;
      if (gs.setupPhase) {
        const err = placeSetupRoad(gs, key);
        if (err) {
          console.warn(`[ai] ${current.name} road failed: ${err}`);
          return false;
        }
        advanceSetup(gs);
      } else {
        const err = placeRoad(gs, key);
        if (err) {
          console.warn(`[ai] ${current.name} road failed: ${err}`);
          return false;
        }
      }
      emitGameToRoom(room, 'place_road', { success: true, key });
      return true;
    }
    case 'place_city': {
      const key = action.data?.key;
      const err = placeCity(gs, key);
      if (err) {
        console.warn(`[ai] ${current.name} city failed: ${err}`);
        return false;
      }
      emitGameToRoom(room, 'place_city', { success: true, key });
      return true;
    }
    case 'buy_dev_card': {
      const card = buyDevCard(gs);
      emitGameToRoom(room, 'buy_dev_card', { card: card ? { type: card.type } : null });
      return true;
    }
    case 'end_turn': {
      endTurn(gs);
      emitGameToRoom(room, 'end_turn', { success: true });
      return true;
    }
    case 'play_knight':
    case 'accept_trade':
    case 'reject_trade':
    case 'complete_trade':
    case 'cancel_trade': {
      emitGameToRoom(room, action.action, { success: true });
      return true;
    }
    case 'move_robber': {
      const stoleFrom = action.data?.stoleFrom as PlayerColor | undefined;
      const victim = stoleFrom ? getPlayerByColor(gs, stoleFrom) : null;
      emitGameToRoom(room, 'move_robber', {
        success: true,
        stealTargets: [],
        stoleFrom,
        hex: action.data ? { q: action.data.q, r: action.data.r } : undefined,
        alreadyStole: !!victim,
      });
      if (victim) {
        io.to(room.id).emit('chat_message', {
          playerName: current.name,
          playerColor: (current as { color?: PlayerColor }).color || 'white',
          text: `stole a resource from ${victim.name}`,
        });
      }
      return true;
    }
    case 'bank_trade': {
      const give = action.data.give as ResourceType;
      const get = action.data.get as ResourceType;
      const p = getCurrentPlayer(gs);
      const rate = getPortRate(p.color, give, gs.ports, gs.intersections);
      const err = executeBankTrade(gs, give, rate, get);
      if (!err) {
        emitGameToRoom(room, 'bank_trade', { give: { [give]: rate }, want: { [get]: 1 }, success: true });
        return true;
      }
      return false;
    }
    default:
      console.warn(`[ai] unhandled action ${action.action}`);
      return false;
  }
}

// ── Helpers ──
function serializeRoom(room: Room) {
  return {
    id: room.id,
    players: room.players.map(p => ({
      playerId: p.playerId,
      name: p.name,
      color: p.color,
      isAI: p.isAI,
      ready: p.ready,
      connected: p.isAI ? true : !!p.socketId,
    })),
    hostId: room.hostId,
    inGame: room.gameState !== null,
    settings: room.settings || defaultSettings(),
    timer: serializeTimer(room),
  };
}

// ── Start ──
server.listen(PORT, HOST, () => {
  console.log(`[server] Catan server running on ${HOST}:${PORT}`);
  console.log(`[server] CORS origin: ${CORS_ORIGIN}`);
});

import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import type { GameState, GameConfig, PlayerColor, ResourceType } from './game/types.js';
import { createInitialState, getCurrentPlayer, getPlayerByColor, rollDice, placeSetupSettlement, placeSetupRoad, advanceSetup, placeRoad, placeSettlement, placeCity, buyDevCard, endTurn, aiTurn, moveRobber, playKnight, discardResources, playRoadBuilding, playYearOfPlenty, playMonopoly, executeBankTrade, proposePublicTrade, respondToTrade, completeTradeWith, cancelTradeOffer, normalizePlayerDevCards, countHeldDevCards, getStealTargets, stealFrom } from './game/rules.js';
import { getHexCorners, getPortRate } from './game/board.js';
import { dropSubscription, getVapidPublicKey, notifyPlayer, saveSubscription, shouldPush, type PushSub } from './push.js';

const PORT = parseInt(process.env.PORT || '3001');
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://catan-lac.vercel.app';
const HOST = process.env.HOST || '0.0.0.0'; // bind all interfaces so LAN devices can reach us
// Allow the LAN dev server (http://<mac>:5173) and any localhost origin.
const ALLOWED_ORIGINS = new Set<string>([
  CORS_ORIGIN,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);
const corsOriginFn = (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
  if (!origin) return cb(null, true); // non-browser / same-origin
  if (ALLOWED_ORIGINS.has(origin)) return cb(null, true);
  // Allow any 192.168/10./172.1x LAN origin (phones hitting the Mac dev server).
  if (/^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(origin)) {
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
  };
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
      return {
        ...p,
        resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 },
        // Face-down stubs only — count matches real held cards; types hidden.
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
  for (const conn of room.players) {
    if (conn.isAI || !conn.socketId) continue;
    const payload = {
      gameState: sanitizeGameStateForPlayer(room.gameState, conn.color),
      ...(action !== undefined ? { action, result } : {}),
    };
    io.to(conn.socketId).emit(action === undefined ? 'game_started' : 'game_update',
      action === undefined ? { gameState: payload.gameState } : payload);
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
      settings: {
        victoryPointsToWin: 10,
        friendlyRobber: true,
        boardMode: 'balanced',
      },
    };

    rooms.set(roomCode, room);
    socketToRoom.set(socket.id, roomCode);
    socket.join(roomCode);

    console.log(`[room] Created ${roomCode} by ${name}`);
    callback({ roomCode, playerId });
    io.to(roomCode).emit('room_update', serializeRoom(room));
  });

  // ── Join Room ──
  socket.on('join_room', ({ roomCode, name }: { roomCode: string; name: string }, callback) => {
    const room = rooms.get(roomCode.toUpperCase());
    if (!room) {
      callback({ error: 'Room not found' });
      return;
    }
    if (room.gameState) {
      callback({ error: 'Game already in progress — ask host to restart, or rejoin if you were already in' });
      return;
    }
    if (room.players.length >= 4) {
      callback({ error: 'Room is full' });
      return;
    }

    const playerId = uuidv4();
    const color = COLORS[room.players.length];
    room.players.push({
      socketId: socket.id,
      playerId,
      name: name || `Player ${room.players.length + 1}`,
      color,
      isAI: false,
      ready: false,
    });

    socketToRoom.set(socket.id, roomCode.toUpperCase());
    socket.join(roomCode.toUpperCase());

    console.log(`[room] ${name} joined ${roomCode}`);
    callback({ playerId, color });
    io.to(roomCode.toUpperCase()).emit('room_update', serializeRoom(room));
    notifyTurnChange(room, { color: null, discard: [], joinedName: name || 'Someone' });
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
      };
      socket.emit('game_started', payload);
      // Also push as update so OnlineGame stays mounted
      socket.emit('game_update', { gameState: payload.gameState });
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
    const color = COLORS[room.players.length];
    room.players.push({
      socketId: '',
      playerId,
      name: `AI ${room.players.length + 1}`,
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
      friendlyRobber: room.settings?.friendlyRobber ?? true,
      boardMode: room.settings?.boardMode ?? 'balanced',
    };

    room.gameState = createInitialState(config);
    console.log(`[game] Started in ${roomCode} with ${room.players.length} players · ${config.victoryPointsToWin}VP`);

    emitGameToRoom(room);
    notifyTurnChange(room, { color: null, discard: [], started: true });
  });

  // Host updates custom game settings (Catan Universe-style)
  socket.on('update_settings', (partial: Partial<Room['settings']>) => {
    const roomCode = socketToRoom.get(socket.id);
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room || room.gameState) return;
    const conn = room.players.find(p => p.socketId === socket.id);
    if (!conn || conn.playerId !== room.hostId) return;
    if (!room.settings) {
      room.settings = { victoryPointsToWin: 10, friendlyRobber: true, boardMode: 'balanced' };
    }
    if (partial.victoryPointsToWin === 10 || partial.victoryPointsToWin === 12) {
      room.settings.victoryPointsToWin = partial.victoryPointsToWin;
    }
    if (typeof partial.friendlyRobber === 'boolean') {
      room.settings.friendlyRobber = partial.friendlyRobber;
    }
    if (partial.boardMode === 'random' || partial.boardMode === 'balanced') {
      room.settings.boardMode = partial.boardMode;
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
    const prev = snapshotTurn(room);
    const player = getCurrentPlayer(gs);
    const conn = room.players.find(p => p.socketId === socket.id);
    if (!conn || conn.color !== player.color) return;

    let result: any = null;

    switch (action) {
      case 'roll_dice': {
        const [d1, d2] = rollDice(gs);
        result = { dice: [d1, d2], total: d1 + d2 };
        // rollDice() sets phase to 'trade' (or 'discard' on a 7). Per official
        // rules the turn is roll → trade → build, so the roller stays in the
        // trade phase and advances to build via the 'skip_trade' action.
        if (d1 + d2 === 7) {
          // Auto-discard for AI players who have >7 cards.
          autoDiscardAIs(gs);
          // Find steal targets
          const [rq, rr] = gs.robberHex.split(',').map(Number);
          const targets: PlayerColor[] = [];
          const corners = getHexCorners(rq, rr);
          corners.forEach(cKey => {
            const inter = gs.intersections[cKey];
            if (inter?.owner && inter.owner !== player.color) {
              const p = gs.players.find(p => p.color === inter.owner);
              if (p) {
                const hasRes = (['brick', 'lumber', 'wool', 'grain', 'ore'] as ResourceType[]).some(r => (p.resources[r] || 0) > 0);
                if (hasRes) targets.push(inter.owner);
              }
            }
          });
          result.robberMode = true;
          result.stealTargets = targets;
        }
        break;
      }
      case 'move_robber': {
        const err = moveRobber(gs, data.q, data.r);
        if (err) return;
        // Return legal steal targets from the NEW hex so the client can pick.
        const targets = getStealTargets(gs, data.q, data.r);
        result = { success: true, stealTargets: targets };
        break;
      }
      case 'steal': {
        const err = stealFrom(gs, data.target);
        if (err) return;
        result = { success: true };
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
      emitGameToRoom(room, action, result);
      notifyTurnChange(room, prev);

      // Check for AI turns
      setTimeout(() => {
        if (!room.gameState) return;
        const current = getCurrentPlayer(room.gameState);
        const aiConn = room.players.find(p => p.color === current.color && p.isAI);
        if (aiConn) {
          runAITurn(room);
        }
      }, 800);
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

    // In an active game, keep the seat so the player can rejoin (don't kick mid-game).
    if (room.gameState) {
      player.socketId = '';
      socketToRoom.delete(socket.id);
      io.to(roomCode).emit('room_update', serializeRoom(room));
      console.log(`[disconnect] ${player.name} parked in ${roomCode} (in-game)`);
      return;
    }

    // Lobby: remove the player
    const idx = room.players.indexOf(player);
    if (idx >= 0) room.players.splice(idx, 1);

    if (room.hostId === player.playerId) {
      const newHost = room.players.find(p => !p.isAI);
      if (newHost) room.hostId = newHost.playerId;
    }

    if (room.players.filter(p => !p.isAI).length === 0) {
      rooms.delete(roomCode);
      console.log(`[room] Deleted ${roomCode} (empty lobby)`);
    } else {
      io.to(roomCode).emit('room_update', serializeRoom(room));
    }

    socketToRoom.delete(socket.id);
    console.log(`[disconnect] ${socket.id}`);
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

// ── AI Turn Runner ──
function runAITurn(room: Room) {
  if (!room.gameState) return;
  const gs = room.gameState;
  const prev = snapshotTurn(room);
  const action = aiTurn(gs);
  if (!action) return;

  switch (action.action) {
    case 'roll_dice': {
      const [d1, d2] = rollDice(gs);
      if (d1 + d2 === 7) {
        // Same as human roll path: drain every AI discard so the queue
        // doesn't freeze with multiple AIs waiting.
        autoDiscardAIs(gs);
      }
      emitGameToRoom(room, 'roll_dice', { dice: [d1, d2], total: d1 + d2 });
      break;
    }
    case 'skip_trade': {
      gs.phase = 'build';
      emitGameToRoom(room, 'skip_trade', { success: true });
      break;
    }
    case 'roll_turn_order': {
      // rollTurnOrder already ran inside aiTurn; just sync the room
      emitGameToRoom(room, 'roll_turn_order', { order: gs.turnOrder });
      break;
    }
    case 'discard': {
      // aiTurn already applied the current AI's discard. Drain any other AIs
      // still in the queue (multi-AI 7), matching the local Game.tsx fix.
      autoDiscardAIs(gs);
      emitGameToRoom(room, 'discard', { success: true });
      break;
    }
    case 'place_settlement':
    case 'place_road':
    case 'place_city':
    case 'buy_dev_card':
    case 'end_turn':
    case 'accept_trade':
    case 'reject_trade':
    case 'complete_trade':
    case 'cancel_trade':
    case 'move_robber': {
      // aiTurn already applied the robber move + steal; just sync the room.
      emitGameToRoom(room, action.action, { success: true });
      break;
    }
    case 'bank_trade': {
      // AI returns {give: 'res', get: 'res'} — one rate unit.
      const give = action.data.give as ResourceType;
      const get = action.data.get as ResourceType;
      const p = getCurrentPlayer(gs);
      const rate = getPortRate(p.color, give, gs.ports, gs.intersections);
      const err = executeBankTrade(gs, give, rate, get);
      if (!err) {
        emitGameToRoom(room, 'bank_trade', { give: { [give]: rate }, want: { [get]: 1 }, success: true });
      }
      break;
    }
  }

  notifyTurnChange(room, prev);

  // Chain AI turns
  setTimeout(() => {
    if (!room.gameState) return;
    const current = getCurrentPlayer(room.gameState);
    if (current.isAI) {
      runAITurn(room);
    }
  }, 600);
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
    settings: room.settings || {
      victoryPointsToWin: 10,
      friendlyRobber: true,
      boardMode: 'balanced',
    },
  };
}

// ── Start ──
server.listen(PORT, HOST, () => {
  console.log(`[server] Catan server running on ${HOST}:${PORT}`);
  console.log(`[server] CORS origin: ${CORS_ORIGIN}`);
});

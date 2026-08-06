import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import type { GameState, GameConfig, PlayerColor, ResourceType } from './game/types.js';
import { createInitialState, getCurrentPlayer, rollDice, placeSetupSettlement, placeSetupRoad, advanceSetup, placeRoad, placeSettlement, placeCity, buyDevCard, endTurn, aiTurn, moveRobber, playKnight } from './game/rules.js';
import { getHexCorners } from './game/board.js';

const PORT = parseInt(process.env.PORT || '3001');
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://catan-lac.vercel.app';

// ── Room Management ──

interface Room {
  id: string;
  players: PlayerConnection[];
  gameState: GameState | null;
  hostId: string;
}

interface PlayerConnection {
  socketId: string;
  playerId: string;
  name: string;
  color: PlayerColor;
  isAI: boolean;
  ready: boolean;
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
  return {
    ...gs,
    players: gs.players.map(p => {
      if (viewerColor && p.color === viewerColor) return p;
      const totalResources = (['brick', 'lumber', 'wool', 'grain', 'ore'] as ResourceType[])
        .reduce((sum, r) => sum + (p.resources[r] || 0), 0);
      const hiddenDev = p.devCards.filter(c => !c.played).length;
      return {
        ...p,
        resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 },
        // Encode total card count in a private field consumers already know via totalResources helper
        // We stash total in lumber as a single public count channel? No — add explicit public fields via cast
        devCards: Array.from({ length: hiddenDev }, () => ({ type: 'knight' as const, played: false })),
        // Mark hidden so client shows backs only
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
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'] },
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', rooms: rooms.size });
});

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
      callback({ error: 'Game already in progress' });
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

    socketToRoom.set(socket.id, roomCode);
    socket.join(roomCode);

    console.log(`[room] ${name} joined ${roomCode}`);
    callback({ playerId, color });
    io.to(roomCode).emit('room_update', serializeRoom(room));
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
    if (room.players[0].playerId !== room.hostId) return;
    if (room.players.length < 2) return;

    const config: GameConfig = {
      numPlayers: room.players.length,
      playerNames: room.players.map(p => p.name),
      aiPlayers: room.players.map((p, i) => p.isAI ? i : -1).filter(i => i >= 0),
    };

    room.gameState = createInitialState(config);
    console.log(`[game] Started in ${roomCode} with ${room.players.length} players`);

    emitGameToRoom(room);
  });

  // ── Game Actions ──
  const handleGameAction = (action: string, data: any) => {
    const roomCode = socketToRoom.get(socket.id);
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room?.gameState) return;

    const gs = room.gameState;
    const player = getCurrentPlayer(gs);
    const conn = room.players.find(p => p.socketId === socket.id);
    if (!conn || conn.color !== player.color) return;

    let result: any = null;

    switch (action) {
      case 'roll_dice': {
        const [d1, d2] = rollDice(gs);
        result = { dice: [d1, d2], total: d1 + d2 };
        // Advance the roller to the build phase. The AI reaches build via its
        // internal skip_trade, but a human player has no other path — without
        // this they'd be stuck in 'trade' and unable to build anything.
        if (d1 + d2 !== 7 && !getCurrentPlayer(gs).isAI) {
          gs.phase = 'build';
        }
        if (d1 + d2 === 7) {
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
        const err = moveRobber(gs, data.q, data.r, data.stealFrom);
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
        const p = getCurrentPlayer(gs);
        const giveEntries = Object.entries(give);
        const wantEntries = Object.entries(want);
        if (giveEntries.length > 0 && wantEntries.length > 0) {
          const [gRes, gAmt] = giveEntries[0];
          const [wRes, wAmt] = wantEntries[0];
          const giveAmount = Number(gAmt) || 0;
          const wantAmount = Number(wAmt) || 0;
          if ((p.resources[gRes as ResourceType] || 0) >= giveAmount) {
            p.resources[gRes as ResourceType] -= giveAmount;
            p.resources[wRes as ResourceType] = (p.resources[wRes as ResourceType] || 0) + wantAmount;
          }
        }
        result = { success: true };
        break;
      }
    }

    if (result !== null) {
      emitGameToRoom(room, action, result);

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
    if (!room) return;

    const idx = room.players.findIndex(p => p.socketId === socket.id);
    if (idx >= 0) {
      room.players.splice(idx, 1);
    }

    if (room.players.length === 0) {
      rooms.delete(roomCode);
      console.log(`[room] Deleted ${roomCode} (empty)`);
    } else {
      // Transfer host
      if (room.hostId === room.players.find(p => p.socketId === socket.id)?.playerId) {
        const newHost = room.players.find(p => !p.isAI);
        if (newHost) room.hostId = newHost.playerId;
      }
      io.to(roomCode).emit('room_update', serializeRoom(room));
    }

    socketToRoom.delete(socket.id);
    console.log(`[disconnect] ${socket.id}`);
  });
});

// ── AI Turn Runner ──
function runAITurn(room: Room) {
  if (!room.gameState) return;
  const gs = room.gameState;
  const action = aiTurn(gs);
  if (!action) return;

  switch (action.action) {
    case 'roll_dice': {
      const [d1, d2] = rollDice(gs);
      emitGameToRoom(room, 'roll_dice', { dice: [d1, d2], total: d1 + d2 });
      break;
    }
    case 'skip_trade': {
      gs.phase = 'build';
      emitGameToRoom(room, 'skip_trade', { success: true });
      break;
    }
    case 'place_settlement':
    case 'place_road':
    case 'place_city':
    case 'buy_dev_card':
    case 'end_turn': {
      emitGameToRoom(room, action.action, { success: true });
      break;
    }
    case 'bank_trade': {
      // AI returns {give: 'res', get: 'res'} (4:1 strings)
      const p = getCurrentPlayer(gs);
      const give = action.data.give as ResourceType;
      const get = action.data.get as ResourceType;
      if ((p.resources[give] || 0) >= 4) {
        p.resources[give] -= 4;
        p.resources[get] = (p.resources[get] || 0) + 1;
      }
      emitGameToRoom(room, 'bank_trade', { give: { [give]: 4 }, want: { [get]: 1 }, success: true });
      break;
    }
  }

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
    })),
    hostId: room.hostId,
    inGame: room.gameState !== null,
  };
}

// ── Start ──
server.listen(PORT, () => {
  console.log(`[server] Catan server running on port ${PORT}`);
  console.log(`[server] CORS origin: ${CORS_ORIGIN}`);
});

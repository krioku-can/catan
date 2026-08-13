import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import type { GameState, PlayerColor } from '../game/types';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
const SESSION_KEY = 'catan_online_session';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'waking';

interface RoomPlayer {
  playerId: string;
  name: string;
  color: PlayerColor;
  isAI: boolean;
  ready: boolean;
  connected?: boolean;
}

interface RoomInfo {
  id: string;
  players: RoomPlayer[];
  hostId: string;
  inGame: boolean;
}

interface SocketContextType {
  socket: Socket | null;
  connected: boolean;
  connectionStatus: ConnectionStatus;
  connectionMessage: string;
  room: RoomInfo | null;
  playerId: string | null;
  gameState: GameState | null;
  chatMessages: ChatMessage[];
  lastActionResult: { action: string; result: any } | null;
  createRoom: (name: string) => void;
  joinRoom: (roomCode: string, name: string) => void;
  toggleReady: () => void;
  addAI: () => void;
  removeAI: (playerId: string) => void;
  startGame: () => void;
  sendAction: (action: string, data?: any) => void;
  sendChat: (text: string) => void;
  leaveRoom: () => void;
  retryConnect: () => void;
}

export interface ChatMessage {
  playerName: string;
  playerColor: PlayerColor;
  text: string;
}

interface SavedSession {
  roomCode: string;
  playerId: string;
  name: string;
}

const SocketContext = createContext<SocketContextType>(null!);

function loadSession(): SavedSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SavedSession;
  } catch {
    return null;
  }
}

function saveSession(s: SavedSession | null) {
  try {
    if (!s) sessionStorage.removeItem(SESSION_KEY);
    else sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch { /* ignore */ }
}

async function wakeServer(): Promise<boolean> {
  const base = SERVER_URL.replace(/\/$/, '');
  const urls = [`${base}/api/health`, `${base}/`];
  for (const url of urls) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 25000);
      const res = await fetch(url, { signal: ctrl.signal, mode: 'cors' });
      clearTimeout(t);
      if (res.ok || res.status === 404) return true;
    } catch {
      // try next
    }
  }
  return false;
}

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('waking');
  const [connectionMessage, setConnectionMessage] = useState('Waking game server… (free tier can take ~30s)');
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [lastActionResult, setLastActionResult] = useState<{ action: string; result: any } | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const wakeAttempted = useRef(false);

  const tryRejoin = useCallback((s: Socket) => {
    const sess = loadSession();
    if (!sess) return;
    s.emit('rejoin_room', {
      roomCode: sess.roomCode,
      playerId: sess.playerId,
      name: sess.name,
    }, (res: { ok?: boolean; playerId?: string; error?: string; inGame?: boolean }) => {
      if (res?.error || !res?.ok) {
        // Stale session — clear so lobby is clean
        if (res?.error && /not found|full|started/i.test(res.error)) {
          saveSession(null);
        }
        return;
      }
      setPlayerId(res.playerId || sess.playerId);
    });
  }, []);

  const attachSocket = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    setConnectionStatus('connecting');
    setConnectionMessage('Connecting…');

    const s = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 12,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    s.on('connect', () => {
      setConnected(true);
      setConnectionStatus('connected');
      setConnectionMessage('');
      tryRejoin(s);
    });

    s.on('disconnect', () => {
      setConnected(false);
      setConnectionStatus('disconnected');
      setConnectionMessage('Disconnected — reconnecting…');
    });

    s.on('connect_error', () => {
      setConnected(false);
      setConnectionStatus('disconnected');
      setConnectionMessage('Can\'t reach server. Free hosts sleep when idle — retrying…');
    });

    s.on('room_update', (data: RoomInfo) => {
      setRoom(data);
      const sess = loadSession();
      if (sess && data.id) {
        saveSession({ ...sess, roomCode: data.id });
      }
    });

    s.on('game_started', ({ gameState: gs }: { gameState: GameState }) => {
      setGameState(gs);
    });

    s.on('game_update', ({ gameState: gs, action, result }: { gameState: GameState; action?: string; result?: any }) => {
      setGameState({ ...gs });
      if (action !== undefined) setLastActionResult({ action, result });
    });

    s.on('chat_message', (msg: ChatMessage) => {
      setChatMessages(prev => [...prev, msg]);
    });

    socketRef.current = s;
    setSocket(s);
  }, [tryRejoin]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!wakeAttempted.current) {
        wakeAttempted.current = true;
        setConnectionStatus('waking');
        setConnectionMessage('Waking game server… (free tier can take ~30s on first open)');
        await wakeServer();
      }
      if (!cancelled) attachSocket();
    })();
    return () => {
      cancelled = true;
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [attachSocket]);

  const retryConnect = useCallback(() => {
    setConnectionStatus('waking');
    setConnectionMessage('Waking game server…');
    wakeServer().finally(() => attachSocket());
  }, [attachSocket]);

  const createRoom = useCallback((name: string) => {
    socket?.emit('create_room', { name }, (res: { roomCode: string; playerId: string }) => {
      setPlayerId(res.playerId);
      saveSession({ roomCode: res.roomCode, playerId: res.playerId, name });
    });
  }, [socket]);

  const joinRoom = useCallback((roomCode: string, name: string) => {
    socket?.emit('join_room', { roomCode, name }, (res: { playerId?: string; color?: PlayerColor; error?: string }) => {
      if (res.error) {
        alert(res.error);
        return;
      }
      setPlayerId(res.playerId!);
      saveSession({ roomCode: roomCode.toUpperCase(), playerId: res.playerId!, name });
    });
  }, [socket]);

  const toggleReady = useCallback(() => {
    socket?.emit('toggle_ready');
  }, [socket]);

  const addAI = useCallback(() => {
    socket?.emit('add_ai');
  }, [socket]);

  const removeAI = useCallback((pid: string) => {
    socket?.emit('remove_ai', { playerId: pid });
  }, [socket]);

  const startGame = useCallback(() => {
    socket?.emit('start_game');
  }, [socket]);

  const sendAction = useCallback((action: string, data?: any) => {
    socket?.emit('game_action', { action, data });
  }, [socket]);

  const sendChat = useCallback((text: string) => {
    socket?.emit('chat_message', { text });
  }, [socket]);

  const leaveRoom = useCallback(() => {
    setRoom(null);
    setGameState(null);
    setPlayerId(null);
    setChatMessages([]);
    saveSession(null);
    socket?.emit('leave_room');
  }, [socket]);

  return (
    <SocketContext.Provider value={{
      socket, connected, connectionStatus, connectionMessage,
      room, playerId, gameState, chatMessages, lastActionResult,
      createRoom, joinRoom, toggleReady, addAI, removeAI, startGame,
      sendAction, sendChat, leaveRoom, retryConnect,
    }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}

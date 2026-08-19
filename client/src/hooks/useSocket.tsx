import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import type { GameState, PlayerColor } from '../game/types';
import { enableTurnPush, pushPrefOn } from '../push';
import { getServerUrl } from '../serverUrl';
import { getStored, setStored, removeStored } from '../storage';

const SESSION_KEY = 'catan_online_session';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'waking';

export interface TurnTimerState {
  enabled: boolean;
  deadline: number | null;
  paused: boolean;
  pausedRemainingMs: number | null;
}

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
  settings?: {
    victoryPointsToWin: 10 | 12;
    friendlyRobber: boolean;
    boardMode: 'random' | 'balanced';
    turnTimer?: boolean;
  };
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
  lastError: string;
  turnTimer: TurnTimerState | null;
  createRoom: (name: string) => void;
  joinRoom: (roomCode: string, name: string) => void;
  toggleReady: () => void;
  addAI: () => void;
  removeAI: (playerId: string) => void;
  startGame: () => void;
  updateSettings: (partial: NonNullable<RoomInfo['settings']> extends infer S ? Partial<S> : never) => void;
  sendAction: (action: string, data?: any) => void;
  sendChat: (text: string) => void;
  leaveRoom: () => void;
  retryConnect: () => void;
  clearError: () => void;
}

export interface ChatMessage {
  playerName: string;
  playerColor: PlayerColor;
  text: string;
}

export interface SavedSession {
  roomCode: string;
  playerId: string;
  name: string;
}

const SocketContext = createContext<SocketContextType>(null!);

export function loadSession(): SavedSession | null {
  try {
    const raw = getStored(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedSession;
    if (!parsed?.roomCode || !parsed?.playerId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveSession(s: SavedSession | null) {
  if (!s) removeStored(SESSION_KEY);
  else setStored(SESSION_KEY, JSON.stringify(s));
}

function stripRoomFromUrl() {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('room')) return;
    url.searchParams.delete('room');
    const q = url.searchParams.toString();
    window.history.replaceState({}, '', url.pathname + (q ? `?${q}` : ''));
  } catch {
    /* ignore */
  }
}

export function writeRoomToUrl(code: string) {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('room') === code) return;
    url.searchParams.set('room', code);
    window.history.replaceState({}, '', `${url.pathname}?${url.searchParams.toString()}`);
  } catch {
    /* ignore */
  }
}

async function wakeServer(): Promise<boolean> {
  const base = getServerUrl().replace(/\/$/, '');
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
  const [connectionMessage, setConnectionMessage] = useState('Waking the table…');
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [lastActionResult, setLastActionResult] = useState<{ action: string; result: any } | null>(null);
  const [lastError, setLastError] = useState('');
  const [turnTimer, setTurnTimer] = useState<TurnTimerState | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const wakeAttempted = useRef(false);

  const tryRejoin = useCallback((s: Socket) => {
    const sess = loadSession();
    if (!sess) return;
    // A fresh invite wins over a parked seat at a different table.
    if (typeof window !== 'undefined') {
      const invited = new URLSearchParams(window.location.search).get('room');
      if (invited && invited.toUpperCase() !== sess.roomCode) return;
    }
    s.emit('rejoin_room', {
      roomCode: sess.roomCode,
      playerId: sess.playerId,
      name: sess.name,
    }, (res: { ok?: boolean; playerId?: string; error?: string; inGame?: boolean }) => {
      if (res?.error || !res?.ok) {
        if (res?.error && /not found|full|started|seat/i.test(res.error)) {
          saveSession(null);
        }
        return;
      }
      setPlayerId(res.playerId || sess.playerId);
      writeRoomToUrl(sess.roomCode);
    });
  }, []);

  const attachSocket = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    setConnectionStatus('connecting');
    setConnectionMessage('Connecting to the table…');

    const s = io(getServerUrl(), {
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
      setConnectionMessage('Can\'t reach the table. Retrying…');
    });

    s.on('room_update', (data: RoomInfo) => {
      setRoom(data);
      const sess = loadSession();
      if (sess && data.id) {
        saveSession({ ...sess, roomCode: data.id });
        writeRoomToUrl(data.id);
      }
    });

    s.on('game_started', ({ gameState: gs, timer }: { gameState: GameState; timer?: TurnTimerState }) => {
      setGameState(gs);
      if (timer) setTurnTimer(timer);
    });

    s.on('game_update', ({ gameState: gs, action, result, timer }: { gameState: GameState; action?: string; result?: any; timer?: TurnTimerState }) => {
      setGameState({ ...gs });
      if (action !== undefined && action !== 'timer_sync') setLastActionResult({ action, result });
      if (timer) setTurnTimer(timer);
      if (action === 'timer_sync' && result) setTurnTimer(result as TurnTimerState);
    });

    s.on('chat_message', (msg: ChatMessage) => {
      setChatMessages(prev => [...prev, msg]);
    });

    socketRef.current = s;
    setSocket(s);
  }, [tryRejoin]);

  useEffect(() => {
    if (!socket) return;
    const send = () => socket.emit('presence', { visible: document.visibilityState === 'visible' });
    send();
    document.addEventListener('visibilitychange', send);
    window.addEventListener('focus', send);
    const blur = () => socket.emit('presence', { visible: false });
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('visibilitychange', send);
      window.removeEventListener('focus', send);
      window.removeEventListener('blur', blur);
    };
  }, [socket]);

  useEffect(() => {
    if (!playerId || !pushPrefOn()) return;
    void enableTurnPush(playerId);
  }, [playerId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!wakeAttempted.current) {
        wakeAttempted.current = true;
        setConnectionStatus('waking');
        setConnectionMessage('Waking the table… first open after idle can take a moment');
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
    setConnectionMessage('Waking the table…');
    wakeServer().finally(() => attachSocket());
  }, [attachSocket]);

  const createRoom = useCallback((name: string) => {
    setLastError('');
    socket?.emit('create_room', { name }, (res: { roomCode: string; playerId: string }) => {
      if (!res?.roomCode) {
        setLastError('Could not create a table. Try again.');
        return;
      }
      setPlayerId(res.playerId);
      saveSession({ roomCode: res.roomCode, playerId: res.playerId, name });
      writeRoomToUrl(res.roomCode);
    });
  }, [socket]);

  const joinRoom = useCallback((roomCode: string, name: string) => {
    setLastError('');
    const code = roomCode.trim().toUpperCase();
    const sess = loadSession();
    const prevId = sess && sess.roomCode === code ? sess.playerId : undefined;
    socket?.emit('join_room', { roomCode: code, name, playerId: prevId }, (res: { playerId?: string; color?: PlayerColor; error?: string }) => {
      if (res.error) {
        setLastError(res.error);
        return;
      }
      setPlayerId(res.playerId!);
      saveSession({ roomCode: code, playerId: res.playerId!, name });
      writeRoomToUrl(code);
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

  const updateSettings = useCallback((partial: { victoryPointsToWin?: 10 | 12; friendlyRobber?: boolean; boardMode?: 'random' | 'balanced'; turnTimer?: boolean }) => {
    socket?.emit('update_settings', partial);
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
    setLastError('');
    setTurnTimer(null);
    saveSession(null);
    stripRoomFromUrl();
    socket?.emit('leave_room');
  }, [socket]);

  const clearError = useCallback(() => setLastError(''), []);

  return (
    <SocketContext.Provider value={{
      socket, connected, connectionStatus, connectionMessage,
      room, playerId, gameState, chatMessages, lastActionResult, lastError, turnTimer,
      createRoom, joinRoom, toggleReady, addAI, removeAI, startGame, updateSettings,
      sendAction, sendChat, leaveRoom, retryConnect, clearError,
    }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}

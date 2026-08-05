import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import type { GameState, PlayerColor } from '../game/types';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

interface RoomPlayer {
  playerId: string;
  name: string;
  color: PlayerColor;
  isAI: boolean;
  ready: boolean;
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
  room: RoomInfo | null;
  playerId: string | null;
  gameState: GameState | null;
  chatMessages: ChatMessage[];
  createRoom: (name: string) => void;
  joinRoom: (roomCode: string, name: string) => void;
  toggleReady: () => void;
  addAI: () => void;
  removeAI: (playerId: string) => void;
  startGame: () => void;
  sendAction: (action: string, data?: any) => void;
  sendChat: (text: string) => void;
  leaveRoom: () => void;
}

export interface ChatMessage {
  playerName: string;
  playerColor: PlayerColor;
  text: string;
}

const SocketContext = createContext<SocketContextType>(null!);

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    const s = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
    });

    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));

    s.on('room_update', (data: RoomInfo) => {
      setRoom(data);
    });

    s.on('game_started', ({ gameState: gs }: { gameState: GameState }) => {
      setGameState(gs);
    });

    s.on('game_update', ({ gameState: gs }: { gameState: GameState }) => {
      setGameState({ ...gs });
    });

    s.on('chat_message', (msg: ChatMessage) => {
      setChatMessages(prev => [...prev, msg]);
    });

    setSocket(s);
    return () => { s.close(); };
  }, []);

  const createRoom = useCallback((name: string) => {
    socket?.emit('create_room', { name }, (res: { roomCode: string; playerId: string }) => {
      setPlayerId(res.playerId);
    });
  }, [socket]);

  const joinRoom = useCallback((roomCode: string, name: string) => {
    socket?.emit('join_room', { roomCode, name }, (res: { playerId?: string; color?: PlayerColor; error?: string }) => {
      if (res.error) {
        alert(res.error);
        return;
      }
      setPlayerId(res.playerId!);
    });
  }, [socket]);

  const toggleReady = useCallback(() => {
    socket?.emit('toggle_ready');
  }, [socket]);

  const addAI = useCallback(() => {
    socket?.emit('add_ai');
  }, [socket]);

  const removeAI = useCallback((playerId: string) => {
    socket?.emit('remove_ai', { playerId });
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
    socket?.emit('leave_room');
  }, [socket]);

  return (
    <SocketContext.Provider value={{
      socket, connected, room, playerId, gameState, chatMessages,
      createRoom, joinRoom, toggleReady, addAI, removeAI, startGame,
      sendAction, sendChat, leaveRoom,
    }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}

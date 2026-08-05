import { useState } from 'react';
import { useSocket } from '../hooks/useSocket';

export default function Lobby() {
  const { connected, room, playerId, createRoom, joinRoom, toggleReady, addAI, removeAI, startGame, leaveRoom } = useSocket();
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [showJoin, setShowJoin] = useState(false);

  if (!connected) {
    return (
      <div style={styles.container}>
        <h1 style={styles.title}>🏝️ CATAN</h1>
        <p style={styles.subtitle}>Connecting to server...</p>
        <div style={styles.loading}>⏳</div>
      </div>
    );
  }

  if (room) {
    const isHost = room.hostId === playerId;
    const allReady = room.players.every(p => p.ready);
    const canStart = isHost && room.players.length >= 2 && allReady;

    return (
      <div style={styles.container}>
        <h1 style={styles.title}>🏝️ CATAN</h1>
        <div style={styles.roomCard}>
          <div style={styles.roomHeader}>
            <span style={styles.roomCode}>Room: {room.id}</span>
            <button style={styles.leaveBtn} onClick={leaveRoom}>Leave</button>
          </div>
          <p style={styles.shareHint}>Share this code with your family!</p>

          <div style={styles.playerList}>
            {room.players.map(p => (
              <div key={p.playerId} style={styles.playerRow}>
                <div style={{ ...styles.colorDot, backgroundColor: p.color }} />
                <span style={styles.playerName}>
                  {p.name}
                  {p.isAI && ' 🤖'}
                  {p.playerId === room.hostId && ' 👑'}
                </span>
                <span style={p.ready ? styles.readyBadge : styles.notReadyBadge}>
                  {p.ready ? '✅ Ready' : '⏳'}
                </span>
                {isHost && p.isAI && (
                  <button style={styles.removeBtn} onClick={() => removeAI(p.playerId)}>✕</button>
                )}
              </div>
            ))}
          </div>

          <div style={styles.actions}>
            <button style={styles.readyBtn} onClick={toggleReady}>
              {room.players.find(p => p.playerId === playerId)?.ready ? 'Unready' : 'Ready'}
            </button>
            {isHost && (
              <>
                <button style={styles.aiBtn} onClick={addAI} disabled={room.players.length >= 4}>
                  + Add AI
                </button>
                <button
                  style={{ ...styles.startBtn, ...(!canStart ? styles.disabledBtn : {}) }}
                  onClick={startGame}
                  disabled={!canStart}
                >
                  Start Game
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>🏝️ CATAN</h1>
      <p style={styles.subtitle}>Settle the island with your family!</p>

      <div style={styles.card}>
        <input
          style={styles.input}
          placeholder="Your name"
          value={name}
          onChange={e => setName(e.target.value)}
          maxLength={20}
        />

        {!showJoin ? (
          <>
            <button style={styles.primaryBtn} onClick={() => createRoom(name || 'Host')}>
              Create Room
            </button>
            <button style={styles.secondaryBtn} onClick={() => setShowJoin(true)}>
              Join Room
            </button>
          </>
        ) : (
          <>
            <input
              style={styles.input}
              placeholder="Room code"
              value={roomCode}
              onChange={e => setRoomCode(e.target.value.toUpperCase())}
              maxLength={4}
            />
            <button style={styles.primaryBtn} onClick={() => joinRoom(roomCode, name || 'Player')}>
              Join
            </button>
            <button style={styles.secondaryBtn} onClick={() => setShowJoin(false)}>
              Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: '#1a1a2e',
    color: '#e0e0e0',
    fontFamily: 'Segoe UI, sans-serif',
    padding: 20,
  },
  title: {
    fontSize: 48,
    color: '#ffd700',
    margin: 0,
    textShadow: '0 0 20px rgba(255,215,0,0.3)',
  },
  subtitle: {
    fontSize: 16,
    color: '#8890a0',
    marginBottom: 30,
  },
  loading: {
    fontSize: 48,
    animation: 'float 2s ease infinite',
  },
  card: {
    background: '#16213e',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 360,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  roomCard: {
    background: '#16213e',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  roomHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  roomCode: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffd700',
    letterSpacing: 3,
  },
  shareHint: {
    fontSize: 13,
    color: '#8890a0',
    marginBottom: 16,
  },
  leaveBtn: {
    padding: '6px 12px',
    border: '1px solid #e74c3c',
    borderRadius: 6,
    background: 'transparent',
    color: '#e74c3c',
    cursor: 'pointer',
    fontSize: 12,
  },
  playerList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    marginBottom: 16,
  },
  playerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    background: '#0f3460',
    borderRadius: 8,
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: '50%',
    flexShrink: 0,
  },
  playerName: {
    flex: 1,
    fontSize: 14,
    fontWeight: 'bold',
  },
  readyBadge: {
    fontSize: 12,
    color: '#2ecc71',
  },
  notReadyBadge: {
    fontSize: 12,
    color: '#8890a0',
  },
  removeBtn: {
    padding: '2px 6px',
    border: 'none',
    borderRadius: 4,
    background: '#e74c3c',
    color: 'white',
    cursor: 'pointer',
    fontSize: 11,
  },
  actions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  readyBtn: {
    flex: 1,
    padding: '10px 16px',
    border: 'none',
    borderRadius: 6,
    background: 'linear-gradient(135deg, #3498db, #2980b9)',
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  aiBtn: {
    flex: 1,
    padding: '10px 16px',
    border: '1px solid #e67e22',
    borderRadius: 6,
    background: 'transparent',
    color: '#e67e22',
    fontSize: 14,
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  startBtn: {
    width: '100%',
    padding: '12px 16px',
    border: 'none',
    borderRadius: 6,
    background: 'linear-gradient(135deg, #2ecc71, #27ae60)',
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    cursor: 'pointer',
    marginTop: 4,
  },
  disabledBtn: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  input: {
    padding: '10px 14px',
    border: '1px solid #0f3460',
    borderRadius: 6,
    background: '#1a1a2e',
    color: '#e0e0e0',
    fontSize: 16,
    textAlign: 'center',
    letterSpacing: 1,
  },
  primaryBtn: {
    padding: '12px 20px',
    border: 'none',
    borderRadius: 6,
    background: 'linear-gradient(135deg, #e94560, #c23152)',
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  secondaryBtn: {
    padding: '10px 16px',
    border: '1px solid #0f3460',
    borderRadius: 6,
    background: 'transparent',
    color: '#8890a0',
    fontSize: 14,
    cursor: 'pointer',
  },
};

import { useState, useEffect } from 'react';
import { useSocket, fetchRooms } from '../hooks/useSocket';
import { getStored, setStored } from '../storage';
import PushToggle from './PushToggle';

export default function Lobby({ onBack, initialRoomCode }: { onBack?: () => void; initialRoomCode?: string }) {
  const { connected, connectionMessage, room, playerId, createRoom, joinRoom, toggleReady, addAI, removeAI, startGame, updateSettings, leaveRoom, retryConnect } = useSocket();
  const [name, setName] = useState(() => getStored('catan_name') || '');
  const [roomCode, setRoomCode] = useState(initialRoomCode || '');
  const [showJoin, setShowJoin] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rooms, setRooms] = useState<{ id: string; players: { name: string }[]; inGame: boolean }[]>([]);
  const [roomsLoaded, setRoomsLoaded] = useState(false);

  // Auto-join when the app is opened with a ?room=CODE share link.
  useEffect(() => {
    if (connected && initialRoomCode && !room) {
      joinRoom(initialRoomCode, name || 'Player');
    }
  }, [connected, initialRoomCode, room, joinRoom, name]);

  // Load the live room list whenever the join view opens.
  useEffect(() => {
    if (!showJoin) return;
    let cancelled = false;
    setRoomsLoaded(false);
    fetchRooms().then(r => {
      if (!cancelled) {
        setRooms(r);
        setRoomsLoaded(true);
      }
    });
    return () => { cancelled = true; };
  }, [showJoin, connected]);

  if (!connected) {
    return (
      <div style={styles.container}>
        <h1 style={styles.title}>🏝️ CATAN</h1>
        <p style={styles.subtitle}>
          {connectionMessage || 'Connecting to server…'}
        </p>
        <div style={styles.spinner}>⏳</div>
        <p style={{ color: '#8890a0', fontSize: 13, maxWidth: 320, textAlign: 'center', lineHeight: 1.4 }}>
          First open after idle can take ~30 seconds while the free server wakes up.
        </p>
        <button type="button" style={styles.primaryBtn} onClick={retryConnect}>
          Retry connection
        </button>
        {onBack && <button type="button" style={styles.secondaryBtn} onClick={onBack}>Back</button>}
      </div>
    );
  }

  if (room) {
    const isHost = room.hostId === playerId;
    const allReady = room.players.every(p => p.ready);
    const canStart = isHost && room.players.length >= 2 && allReady;

    const shareLink = `${window.location.origin}${window.location.pathname}?room=${room.id}`;

    const handleShare = async () => {
      try {
        await navigator.clipboard.writeText(shareLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Fallback: prompt with the link so the user can copy it manually.
        window.prompt('Copy this link to invite your family:', shareLink);
      }
    };

    return (
      <div style={styles.container}>
        <div style={styles.roomCard}>
          <div style={styles.roomHeader}>
            <span style={styles.roomCode}>Room: {room.id}</span>
            <button type="button" style={styles.leaveBtn} onClick={leaveRoom}>Leave</button>
          </div>
          <p style={styles.shareHint}>Share this code with your family!</p>

          <button type="button" style={styles.shareBtn} onClick={handleShare}>
            {copied ? '✅ Link Copied!' : '🔗 Share Room Link'}
          </button>

          <PushToggle playerId={playerId} />

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
                  {p.ready ? '✅' : '⏳'}
                </span>
                {isHost && p.isAI && (
                  <button type="button" style={styles.removeBtn} onClick={() => removeAI(p.playerId)}>✕</button>
                )}
              </div>
            ))}
          </div>

          {/* Catan Universe-style game settings (host editable) */}
          <div style={styles.settingsBox}>
            <div style={styles.settingsTitle}>Game settings</div>
            <div style={styles.settingsRow}>
              <span>Victory points</span>
              <div style={styles.chipRow}>
                {([10, 12] as const).map(n => (
                  <button
                    key={n}
                    type="button"
                    disabled={!isHost}
                    style={{
                      ...styles.chip,
                      ...((room.settings?.victoryPointsToWin ?? 10) === n ? styles.chipActive : {}),
                    }}
                    onClick={() => isHost && updateSettings({ victoryPointsToWin: n })}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div style={styles.settingsRow}>
              <span>Board</span>
              <div style={styles.chipRow}>
                {([
                  { id: 'balanced' as const, label: 'Balanced' },
                  { id: 'random' as const, label: 'Random' },
                ]).map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={!isHost}
                    style={{
                      ...styles.chip,
                      ...((room.settings?.boardMode ?? 'balanced') === opt.id ? styles.chipActive : {}),
                    }}
                    onClick={() => isHost && updateSettings({ boardMode: opt.id })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <label style={styles.friendlyRow}>
              <input
                type="checkbox"
                disabled={!isHost}
                checked={room.settings?.friendlyRobber ?? true}
                onChange={e => isHost && updateSettings({ friendlyRobber: e.target.checked })}
              />
              Friendly Robber (protect ≤2 VP)
            </label>
            <p style={styles.settingsNote}>
              Official setup: resources only on your <strong>second</strong> settlement.
            </p>
          </div>

          <div style={styles.actions}>
            <button type="button" style={styles.readyBtn} onClick={toggleReady}>
              {room.players.find(p => p.playerId === playerId)?.ready ? 'Not Ready' : 'Ready'}
            </button>
            {isHost && (
              <>
                <button type="button" style={styles.aiBtn} onClick={addAI} disabled={room.players.length >= 4}>
                  + AI
                </button>
                <button
                  type="button"
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
      <h1 style={styles.title}>🏝️ Online</h1>
      <p style={styles.subtitle}>Play with family over the internet</p>

      <div style={styles.card}>
        <input
          style={styles.input}
          placeholder="Your name"
          value={name}
          onChange={e => {
            setName(e.target.value);
            setStored('catan_name', e.target.value);
          }}
          maxLength={20}
        />

        {!showJoin ? (
          <>
            <button type="button" style={styles.primaryBtn} onClick={() => createRoom(name || 'Host')}>
              Create Room
            </button>
            <button type="button" style={styles.secondaryBtn} onClick={() => setShowJoin(true)}>
              Join Room
            </button>
            {onBack && (
              <button type="button" style={styles.secondaryBtn} onClick={onBack}>
                Back
              </button>
            )}
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
            <button type="button" style={styles.primaryBtn} onClick={() => joinRoom(roomCode, name || 'Player')}>
              Join
            </button>
            <div style={styles.roomsSection}>
              <div style={styles.roomsHeader}>
                <span style={styles.roomsTitle}>Open rooms</span>
                <button type="button" style={styles.refreshBtn} onClick={() => {
                  setRoomsLoaded(false);
                  fetchRooms().then(r => { setRooms(r); setRoomsLoaded(true); });
                }}>
                  ↻
                </button>
              </div>
              {!roomsLoaded ? (
                <p style={styles.roomsEmpty}>Loading…</p>
              ) : rooms.length === 0 ? (
                <p style={styles.roomsEmpty}>No open rooms right now.</p>
              ) : (
                <div style={styles.roomsList}>
                  {rooms.filter(r => !r.inGame).map(r => (
                    <button
                      key={r.id}
                      type="button"
                      style={styles.roomRow}
                      onClick={() => joinRoom(r.id, name || 'Player')}
                    >
                      <span style={styles.roomRowCode}>{r.id}</span>
                      <span style={styles.roomRowPlayers}>
                        {r.players.length}/4 {r.players.map(p => p.name).join(', ')}
                      </span>
                      <span style={styles.roomRowJoin}>Join →</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" style={styles.secondaryBtn} onClick={() => setShowJoin(false)}>
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
    justifyContent: 'flex-start',
    height: '100%',
    maxHeight: '100dvh',
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
    background: '#1a1a2e',
    color: '#e0e0e0',
    fontFamily: 'Segoe UI, sans-serif',
    padding: '20px 20px max(28px, env(safe-area-inset-bottom, 0px))',
    boxSizing: 'border-box',
  },
  title: {
    fontSize: 36,
    color: '#ffd700',
    margin: 0,
    textShadow: '0 0 20px rgba(255,215,0,0.3)',
  },
  subtitle: {
    fontSize: 15,
    color: '#8890a0',
    marginBottom: 24,
  },
  spinner: {
    fontSize: 40,
    marginBottom: 16,
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
    padding: 20,
    width: '100%',
    maxWidth: 400,
  },
  roomHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  roomCode: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#ffd700',
    letterSpacing: 4,
  },
  shareHint: {
    fontSize: 13,
    color: '#8890a0',
    marginBottom: 14,
  },
  shareBtn: {
    width: '100%',
    padding: '12px 16px',
    border: '1px solid #ffd700',
    borderRadius: 8,
    background: 'rgba(255,215,0,0.1)',
    color: '#ffd700',
    fontSize: 15,
    fontWeight: 'bold',
    cursor: 'pointer',
    marginBottom: 14,
  },
  leaveBtn: {
    padding: '6px 14px',
    border: '1px solid #e74c3c',
    borderRadius: 6,
    background: 'transparent',
    color: '#e74c3c',
    cursor: 'pointer',
    fontSize: 13,
  },
  playerList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    marginBottom: 14,
  },
  playerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
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
    fontSize: 15,
    fontWeight: 'bold',
  },
  readyBadge: {
    fontSize: 16,
  },
  notReadyBadge: {
    fontSize: 16,
    color: '#8890a0',
  },
  removeBtn: {
    padding: '2px 8px',
    border: 'none',
    borderRadius: 4,
    background: '#e74c3c',
    color: 'white',
    cursor: 'pointer',
    fontSize: 12,
  },
  actions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  readyBtn: {
    flex: 1,
    padding: '12px 16px',
    border: 'none',
    borderRadius: 8,
    background: 'linear-gradient(135deg, #3498db, #2980b9)',
    color: 'white',
    fontSize: 15,
    fontWeight: 'bold',
    cursor: 'pointer',
    minWidth: 80,
  },
  aiBtn: {
    padding: '12px 16px',
    border: '1px solid #e67e22',
    borderRadius: 8,
    background: 'transparent',
    color: '#e67e22',
    fontSize: 15,
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  startBtn: {
    width: '100%',
    padding: '14px 16px',
    border: 'none',
    borderRadius: 8,
    background: 'linear-gradient(135deg, #2ecc71, #27ae60)',
    color: 'white',
    fontSize: 17,
    fontWeight: 'bold',
    cursor: 'pointer',
    marginTop: 4,
  },
  disabledBtn: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  input: {
    padding: '12px 14px',
    border: '1px solid #0f3460',
    borderRadius: 8,
    background: '#1a1a2e',
    color: '#e0e0e0',
    fontSize: 16,
    textAlign: 'center',
    letterSpacing: 1,
  },
  primaryBtn: {
    padding: '14px 20px',
    border: 'none',
    borderRadius: 8,
    background: 'linear-gradient(135deg, #e94560, #c23152)',
    color: 'white',
    fontSize: 17,
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  secondaryBtn: {
    padding: '12px 16px',
    border: '1px solid #0f3460',
    borderRadius: 8,
    background: 'transparent',
    color: '#8890a0',
    fontSize: 15,
    cursor: 'pointer',
  },
  roomsSection: {
    borderTop: '1px solid #0f3460',
    paddingTop: 12,
    marginTop: 4,
  },
  roomsHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  roomsTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#8890a0',
    letterSpacing: 1,
  },
  refreshBtn: {
    padding: '2px 10px',
    border: '1px solid #0f3460',
    borderRadius: 6,
    background: 'transparent',
    color: '#8890a0',
    fontSize: 14,
    cursor: 'pointer',
  },
  roomsEmpty: {
    fontSize: 13,
    color: '#556080',
    textAlign: 'center',
    padding: '8px 0',
  },
  roomsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  roomRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    border: '1px solid #0f3460',
    borderRadius: 8,
    background: '#1a1a2e',
    cursor: 'pointer',
    color: '#e0e0e0',
    textAlign: 'left',
  },
  roomRowCode: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffd700',
    letterSpacing: 2,
    minWidth: 48,
  },
  roomRowPlayers: {
    flex: 1,
    fontSize: 13,
    color: '#8890a0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  roomRowJoin: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#34d399',
  },
  settingsBox: {
    marginTop: 12,
    marginBottom: 12,
    padding: 12,
    borderRadius: 10,
    background: '#1a1a2e',
    border: '1px solid #0f3460',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  settingsTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#ffd700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  settingsRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    fontSize: 13,
    color: '#e0e0e0',
  },
  chipRow: { display: 'flex', gap: 6 },
  chip: {
    padding: '6px 10px',
    border: '1px solid #0f3460',
    borderRadius: 6,
    background: '#16213e',
    color: '#e0e0e0',
    fontSize: 12,
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  chipActive: {
    borderColor: '#ffd700',
    background: 'rgba(255,215,0,0.12)',
    color: '#ffd700',
  },
  friendlyRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    color: '#e0e0e0',
    cursor: 'pointer',
  },
  settingsNote: {
    margin: 0,
    fontSize: 11,
    color: '#8890a0',
    lineHeight: 1.35,
  },
};

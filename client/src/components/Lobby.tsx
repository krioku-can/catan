import { useState, useEffect, useRef } from 'react';
import { useSocket } from '../hooks/useSocket';
import { getStored, setStored } from '../storage';
import PushToggle from './PushToggle';

function inviteUrl(roomId: string) {
  return `${window.location.origin}${window.location.pathname}?room=${roomId}`;
}

function inviteText(hostName: string) {
  const who = hostName.trim() || 'Someone';
  return `${who} invited you to Catan — tap to sit down`;
}

export default function Lobby({ onBack, initialRoomCode }: { onBack?: () => void; initialRoomCode?: string }) {
  const {
    connected, connectionMessage, room, playerId, lastError,
    createRoom, joinRoom, addAI, removeAI, startGame, updateSettings,
    leaveRoom, retryConnect, clearError,
  } = useSocket();
  const [name, setName] = useState(() => getStored('catan_name') || '');
  const [roomCode, setRoomCode] = useState(initialRoomCode || '');
  const [showJoin, setShowJoin] = useState(!!initialRoomCode);
  const [copied, setCopied] = useState<'code' | 'link' | ''>('');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const autoJoined = useRef(false);

  const saveName = (n: string) => {
    setName(n);
    setStored('catan_name', n);
  };

  // Auto-sit when opened from a share link and we already know their name.
  useEffect(() => {
    if (!connected || room || !initialRoomCode || autoJoined.current) return;
    const n = name.trim();
    if (!n) return;
    autoJoined.current = true;
    joinRoom(initialRoomCode, n);
  }, [connected, initialRoomCode, room, name, joinRoom]);

  const handleShare = async () => {
    if (!room) return;
    const url = inviteUrl(room.id);
    const text = inviteText(name || room.players.find(p => p.playerId === playerId)?.name || 'Someone');
    setShareBusy(true);
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: 'Catan', text, url });
        return;
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
    } finally {
      setShareBusy(false);
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setCopied('link');
      setTimeout(() => setCopied(''), 2000);
    } catch {
      window.prompt('Copy this invite and send it to your family:', `${text}\n${url}`);
    }
  };

  const copyCode = async () => {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.id);
      setCopied('code');
      setTimeout(() => setCopied(''), 2000);
    } catch {
      window.prompt('Copy this table code:', room.id);
    }
  };

  if (!connected) {
    return (
      <div style={styles.container}>
        <h1 style={styles.title}>CATAN</h1>
        <p style={styles.subtitle}>{connectionMessage || 'Connecting to the table…'}</p>
        <div style={styles.spinner} aria-hidden>⏳</div>
        <button type="button" style={styles.primaryBtn} onClick={retryConnect}>
          Retry
        </button>
        {onBack && (
          <button type="button" style={styles.ghostBtn} onClick={onBack}>Back</button>
        )}
      </div>
    );
  }

  if (room) {
    const isHost = room.hostId === playerId;
    const host = room.players.find(p => p.playerId === room.hostId);
    const humans = room.players.filter(p => !p.isAI);
    const canStart = isHost && room.players.length >= 2;
    const me = room.players.find(p => p.playerId === playerId);

    return (
      <div style={styles.container}>
        <div style={styles.roomCard}>
          <p style={styles.kicker}>Family table</p>
          <button type="button" style={styles.giantCode} onClick={copyCode} title="Copy code">
            {room.id}
          </button>
          <p style={styles.codeHint}>
            {copied === 'code' ? 'Code copied' : 'Tap the code to copy · or send an invite'}
          </p>

          <button type="button" style={styles.primaryBtn} onClick={handleShare} disabled={shareBusy}>
            {copied === 'link' ? 'Invite copied' : 'Send invite'}
          </button>

          <div style={styles.playerList}>
            {room.players.map(p => {
              const here = p.isAI || p.connected !== false;
              return (
                <div key={p.playerId} style={styles.playerRow}>
                  <div style={{ ...styles.colorDot, backgroundColor: p.color }} />
                  <div style={styles.playerMeta}>
                    <span style={styles.playerName}>
                      {p.name}
                      {p.playerId === playerId ? ' · you' : ''}
                      {p.isAI ? ' · AI' : ''}
                      {p.playerId === room.hostId ? ' · host' : ''}
                    </span>
                    <span style={here ? styles.hereTag : styles.awayTag}>
                      {p.isAI ? 'ready' : here ? 'here' : 'away'}
                    </span>
                  </div>
                  {isHost && p.isAI && (
                    <button type="button" style={styles.removeBtn} onClick={() => removeAI(p.playerId)}>Remove</button>
                  )}
                </div>
              );
            })}
          </div>

          <div style={styles.settingsBox}>
            <div style={styles.settingsTitle}>Table rules</div>
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
                checked={room.settings?.friendlyRobber ?? false}
                onChange={e => isHost && updateSettings({ friendlyRobber: e.currentTarget.checked })}
              />
              Friendly robber (house rule: can’t steal from 2 VP or less)
            </label>
            <label style={styles.friendlyRow}>
              <input
                type="checkbox"
                disabled={!isHost}
                checked={room.settings?.turnTimer ?? false}
                onChange={e => isHost && updateSettings({ turnTimer: e.currentTarget.checked })}
              />
              Turn clock (70s, +30s after a 7 to move the robber)
            </label>
          </div>

          <PushToggle playerId={playerId} />

          <div style={styles.actions}>
            {isHost ? (
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
                  Start game
                </button>
                {!canStart && (
                  <p style={styles.waitHint}>Invite someone or add AI — then start.</p>
                )}
              </>
            ) : (
              <p style={styles.waitHint}>
                Waiting for {host?.name || 'the host'} to start
                {humans.length < 2 ? ' · send them this invite' : ''}
              </p>
            )}
          </div>

          <button type="button" style={styles.leaveLink} onClick={() => setConfirmLeave(true)}>
            Leave table
          </button>
        </div>

        {confirmLeave && (
          <div style={styles.modalScrim} onClick={() => setConfirmLeave(false)}>
            <div style={styles.modal} onClick={e => e.stopPropagation()}>
              <h3 style={styles.modalTitle}>Leave the table?</h3>
              <p style={styles.modalBody}>
                This gives up {me?.name ? `${me.name}'s` : 'your'} seat. Closing the tab is fine — you can come back.
              </p>
              <button type="button" style={styles.primaryBtn} onClick={() => setConfirmLeave(false)}>
                Stay
              </button>
              <button
                type="button"
                style={styles.dangerBtn}
                onClick={() => {
                  leaveRoom();
                  onBack?.();
                }}
              >
                Leave table
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const invited = !!(initialRoomCode && !room);

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>CATAN</h1>
      <p style={styles.subtitle}>
        {invited ? `You've been invited to table ${initialRoomCode}` : 'Invite family — they sit down from a link'}
      </p>

      <div style={styles.card}>
        <input
          style={styles.input}
          placeholder="Your name"
          value={name}
          onChange={e => {
            saveName(e.target.value);
            if (lastError) clearError();
          }}
          maxLength={20}
          autoComplete="nickname"
        />

        {invited || showJoin ? (
          <>
            {!invited && (
              <input
                style={{ ...styles.input, ...styles.codeInput }}
                placeholder="Table code"
                value={roomCode}
                onChange={e => {
                  setRoomCode(e.target.value.toUpperCase());
                  if (lastError) clearError();
                }}
                maxLength={4}
                autoCapitalize="characters"
                autoCorrect="off"
              />
            )}
            <button
              type="button"
              style={styles.primaryBtn}
              onClick={() => joinRoom((invited ? initialRoomCode : roomCode) || '', name.trim() || 'Player')}
            >
              Sit down
            </button>
            {lastError && <p style={styles.error}>{lastError}</p>}
            <button
              type="button"
              style={styles.ghostBtn}
              onClick={() => {
                if (invited) onBack?.();
                else setShowJoin(false);
              }}
            >
              Back
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              style={styles.primaryBtn}
              onClick={() => createRoom(name.trim() || 'Host')}
            >
              Create table
            </button>
            <button type="button" style={styles.secondaryBtn} onClick={() => setShowJoin(true)}>
              I have a code
            </button>
            {lastError && <p style={styles.error}>{lastError}</p>}
            {onBack && (
              <button type="button" style={styles.ghostBtn} onClick={onBack}>
                Back
              </button>
            )}
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
    background: 'radial-gradient(ellipse at 40% 30%, #6b4226 0%, #3a2412 55%, #241608 100%)',
    color: '#f5efe4',
    fontFamily: 'Segoe UI, sans-serif',
    padding: '20px 20px max(28px, env(safe-area-inset-bottom, 0px))',
    paddingTop: 'max(20px, env(safe-area-inset-top, 0px))',
    boxSizing: 'border-box',
  },
  title: {
    fontSize: 42,
    color: '#ffd700',
    margin: 0,
    letterSpacing: 4,
    textShadow: '0 0 20px rgba(255,215,0,0.35)',
  },
  subtitle: {
    fontSize: 15,
    color: '#c4b49a',
    marginBottom: 24,
    textAlign: 'center',
    maxWidth: 320,
    lineHeight: 1.4,
  },
  spinner: { fontSize: 36, marginBottom: 16 },
  card: {
    background: 'linear-gradient(180deg, rgba(48,28,14,0.95), rgba(28,16,8,0.98))',
    borderRadius: 14,
    padding: 24,
    width: '100%',
    maxWidth: 360,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    border: '1px solid rgba(200,150,70,0.28)',
    boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
  },
  roomCard: {
    background: 'linear-gradient(180deg, rgba(48,28,14,0.95), rgba(28,16,8,0.98))',
    borderRadius: 14,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    border: '1px solid rgba(200,150,70,0.28)',
    boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  kicker: {
    margin: 0,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: '#c4b49a',
    textAlign: 'center',
  },
  giantCode: {
    margin: 0,
    padding: '8px 0 0',
    border: 'none',
    background: 'transparent',
    color: '#ffd700',
    fontSize: 52,
    fontWeight: 800,
    letterSpacing: 10,
    textAlign: 'center',
    cursor: 'pointer',
    lineHeight: 1,
    fontFamily: 'inherit',
  },
  codeHint: {
    margin: '-4px 0 4px',
    fontSize: 12,
    color: '#8a7355',
    textAlign: 'center',
  },
  playerList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  playerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    background: 'rgba(20,12,6,0.55)',
    border: '1px solid rgba(200,150,70,0.2)',
    borderRadius: 10,
  },
  colorDot: {
    width: 14,
    height: 14,
    borderRadius: '50%',
    flexShrink: 0,
    boxShadow: 'inset 0 -2px 3px rgba(0,0,0,0.35)',
  },
  playerMeta: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  playerName: {
    fontSize: 15,
    fontWeight: 700,
  },
  hereTag: {
    fontSize: 11,
    color: '#34d399',
    fontWeight: 700,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  awayTag: {
    fontSize: 11,
    color: '#e8a54b',
    fontWeight: 700,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  removeBtn: {
    padding: '6px 10px',
    border: '1px solid rgba(231,76,60,0.5)',
    borderRadius: 6,
    background: 'transparent',
    color: '#e74c3c',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 700,
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  aiBtn: {
    padding: '12px 16px',
    border: '1px solid rgba(200,150,70,0.4)',
    borderRadius: 10,
    background: 'transparent',
    color: '#f5efe4',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
  },
  startBtn: {
    width: '100%',
    padding: '14px 16px',
    border: 'none',
    borderRadius: 10,
    background: 'linear-gradient(135deg, #2ecc71, #27ae60)',
    color: 'white',
    fontSize: 17,
    fontWeight: 700,
    cursor: 'pointer',
  },
  disabledBtn: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  waitHint: {
    margin: 0,
    fontSize: 13,
    color: '#c4b49a',
    textAlign: 'center',
    lineHeight: 1.4,
  },
  leaveLink: {
    marginTop: 4,
    padding: 10,
    border: 'none',
    background: 'transparent',
    color: '#8a7355',
    fontSize: 13,
    cursor: 'pointer',
  },
  input: {
    padding: '12px 14px',
    border: '1px solid rgba(200,150,70,0.3)',
    borderRadius: 8,
    background: 'rgba(20,12,6,0.7)',
    color: '#f5efe4',
    fontSize: 16,
    textAlign: 'center',
  },
  codeInput: {
    letterSpacing: 6,
    fontWeight: 800,
    fontSize: 22,
  },
  primaryBtn: {
    padding: '14px 20px',
    border: 'none',
    borderRadius: 10,
    background: 'linear-gradient(135deg, #e94560, #c23152)',
    color: 'white',
    fontSize: 17,
    fontWeight: 700,
    cursor: 'pointer',
  },
  secondaryBtn: {
    padding: '14px 16px',
    border: '1px solid rgba(200,150,70,0.35)',
    borderRadius: 10,
    background: 'rgba(60,36,18,0.85)',
    color: '#f5efe4',
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
  },
  ghostBtn: {
    padding: '12px 16px',
    border: 'none',
    background: 'transparent',
    color: '#8a7355',
    fontSize: 15,
    cursor: 'pointer',
  },
  dangerBtn: {
    padding: '12px 16px',
    border: '1px solid #e74c3c',
    borderRadius: 10,
    background: 'transparent',
    color: '#e74c3c',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
  },
  error: {
    margin: 0,
    color: '#ff8a80',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 1.35,
  },
  settingsBox: {
    padding: 12,
    borderRadius: 10,
    background: 'rgba(20,12,6,0.45)',
    border: '1px solid rgba(200,150,70,0.2)',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  settingsTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: '#ffd700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  settingsRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    fontSize: 13,
    color: '#f5efe4',
  },
  chipRow: { display: 'flex', gap: 6 },
  chip: {
    padding: '6px 10px',
    border: '1px solid rgba(200,150,70,0.3)',
    borderRadius: 6,
    background: 'rgba(20,12,6,0.6)',
    color: '#f5efe4',
    fontSize: 12,
    fontWeight: 700,
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
    color: '#f5efe4',
    cursor: 'pointer',
  },
  modalScrim: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.65)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    zIndex: 80,
  },
  modal: {
    width: '100%',
    maxWidth: 320,
    background: 'linear-gradient(180deg, #3a2412, #241608)',
    border: '1px solid rgba(200,150,70,0.35)',
    borderRadius: 14,
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  modalTitle: {
    margin: 0,
    color: '#ffd700',
    fontSize: 18,
  },
  modalBody: {
    margin: '0 0 6px',
    color: '#c4b49a',
    fontSize: 14,
    lineHeight: 1.45,
  },
};

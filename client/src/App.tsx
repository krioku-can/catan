import { useState } from 'react';
import { SocketProvider, useSocket } from './hooks/useSocket';
import Lobby from './components/Lobby';
import OnlineGame from './components/OnlineGame';
import Game from './components/Game';
import Profile from './components/Profile';
import { getStored, setStored } from './storage';
import { APP_VERSION } from './version';

type Mode = 'home' | 'local' | 'online' | 'profile' | 'resume';

function OnlineShell({ onBack }: { onBack: () => void }) {
  const { gameState } = useSocket();
  if (gameState) return <OnlineGame />;
  // Read an optional ?room=CODE from the URL so a shared link auto-joins.
  const roomFromUrl = new URLSearchParams(window.location.search).get('room');
  return <Lobby onBack={onBack} initialRoomCode={roomFromUrl || undefined} />;
}

function Home({ onPick }: { onPick: (m: Mode) => void }) {
  const [name, setName] = useState(() => getStored('catan_name') || '');
  const hasSave = !!getStored('catan_save');

  const saveName = (n: string) => {
    setName(n);
    setStored('catan_name', n);
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>🏝️ CATAN</h1>
      <p style={styles.subtitle}>Settle the island</p>
      <div style={styles.versionBadge} title="Build version (git commit + build time)">v{APP_VERSION}</div>

      <div style={styles.card}>
        <input
          style={styles.input}
          placeholder="Your name"
          value={name}
          onChange={e => saveName(e.target.value)}
          maxLength={20}
        />

        {hasSave && (
          <button
            style={styles.resumeBtn}
            onClick={() => onPick('resume')}
          >
            ▶️ Resume Game
            <span style={styles.btnHint}>Pick up where you left off</span>
          </button>
        )}

        <button
          style={styles.primaryBtn}
          onClick={() => onPick('local')}
        >
          🤖 Play vs AI
          <span style={styles.btnHint}>Customize players, VP, board & rules</span>
        </button>

        <button
          style={styles.secondaryBtn}
          onClick={() => onPick('online')}
        >
          👨‍👩‍👧‍👦 Play with Family
          <span style={styles.btnHint}>Create or join a room online</span>
        </button>

        <button
          style={styles.profileBtn}
          onClick={() => onPick('profile')}
        >
          📊 My Stats
          <span style={styles.btnHint}>Track wins, losses, and history</span>
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState<Mode>('home');
  const playerName = getStored('catan_name') || 'You';

  if (mode === 'local') {
    return (
      <Game
        quickStart={false}
        playerName={playerName}
        onExit={() => setMode('home')}
      />
    );
  }

  if (mode === 'resume') {
    return (
      <Game
        quickStart={false}
        playerName={playerName}
        onExit={() => setMode('home')}
        resume
      />
    );
  }

  if (mode === 'online') {
    return (
      <SocketProvider>
        <OnlineShell onBack={() => setMode('home')} />
      </SocketProvider>
    );
  }

  if (mode === 'profile') {
    return <Profile onBack={() => setMode('home')} />;
  }

  return <Home onPick={setMode} />;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100dvh',
    background: '#1a1a2e',
    color: '#e0e0e0',
    fontFamily: 'Segoe UI, sans-serif',
    padding: 20,
  },
  title: {
    fontSize: 42,
    color: '#ffd700',
    margin: 0,
    textShadow: '0 0 20px rgba(255,215,0,0.3)',
  },
  subtitle: {
    fontSize: 15,
    color: '#8890a0',
    marginBottom: 28,
  },
  versionBadge: {
    fontSize: 11,
    color: '#556080',
    fontFamily: 'monospace',
    marginTop: -18,
    marginBottom: 12,
    userSelect: 'none',
  },
  card: {
    background: '#16213e',
    borderRadius: 14,
    padding: 24,
    width: '100%',
    maxWidth: 360,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  input: {
    padding: '12px 14px',
    border: '1px solid #0f3460',
    borderRadius: 8,
    background: '#1a1a2e',
    color: '#e0e0e0',
    fontSize: 16,
    textAlign: 'center',
  },
  primaryBtn: {
    padding: '16px 18px',
    border: 'none',
    borderRadius: 10,
    background: 'linear-gradient(135deg, #e94560, #c23152)',
    color: 'white',
    fontSize: 17,
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  },
  resumeBtn: {
    padding: '16px 18px',
    border: '2px solid #34d399',
    borderRadius: 10,
    background: 'rgba(52,211,153,0.12)',
    color: '#34d399',
    fontSize: 17,
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  },
  secondaryBtn: {
    padding: '16px 18px',
    border: '1px solid #0f3460',
    borderRadius: 10,
    background: '#0f3460',
    color: '#e0e0e0',
    fontSize: 17,
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  },
  btnHint: {
    fontSize: 12,
    fontWeight: 'normal',
    opacity: 0.75,
  },
  profileBtn: {
    padding: '16px 18px',
    border: '1px solid #ffd700',
    borderRadius: 10,
    background: 'transparent',
    color: '#ffd700',
    fontSize: 17,
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  },
};

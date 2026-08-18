import { useState } from 'react';
import { getServerChoice, getServerUrl, isLanServer, setServerChoice, type ServerChoice } from '../serverUrl';

export default function ServerPicker() {
  const [choice, setChoice] = useState<ServerChoice>(() => getServerChoice());
  const [url, setUrl] = useState(() => getServerUrl());

  const pick = (c: ServerChoice) => {
    setServerChoice(c);
    setChoice(c);
    setUrl(getServerUrl());
    // Reconnect against the new server (the socket reads the choice at connect).
    setTimeout(() => window.location.reload(), 60);
  };

  const labels: Record<ServerChoice, string> = {
    auto: 'Auto',
    cloud: '☁️ Cloud',
    lan: '📡 Same WiFi',
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.badge}>
        {isLanServer() ? '📡 Same WiFi' : '☁️ Cloud'}
        <span style={styles.dot} />
      </div>
      <div style={styles.row}>
        {(['auto', 'cloud', 'lan'] as ServerChoice[]).map(c => (
          <button
            key={c}
            type="button"
            style={{ ...styles.btn, ...(choice === c ? styles.btnActive : {}) }}
            onClick={() => pick(c)}
          >
            {labels[c]}
          </button>
        ))}
      </div>
      <div style={styles.hint}>
        {choice === 'lan'
          ? 'Connect over your own WiFi — no internet, most stable. Host needs to run “npm run lan” on the Mac.'
          : choice === 'cloud'
            ? 'Always use the internet server — reachable from anywhere, supports turn alerts.'
            : 'Auto: Same WiFi when you open it locally, Cloud otherwise.'}
      </div>
      {url && <div style={styles.url}>{url}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex', flexDirection: 'column', gap: 8,
    background: 'rgba(20,12,6,0.6)', border: '1px solid rgba(200,150,70,0.25)',
    borderRadius: 8, padding: 10, marginTop: 8,
  },
  badge: {
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: 12, color: '#c4b49a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  dot: { width: 8, height: 8, borderRadius: '50%', background: '#34d399' },
  row: { display: 'flex', gap: 6 },
  btn: {
    flex: 1, padding: '8px 10px', border: '1px solid rgba(200,150,70,0.3)',
    borderRadius: 6, background: 'rgba(20,12,6,0.7)', color: '#f5efe4',
    fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },
  btnActive: { borderColor: '#ffd700', color: '#ffd700', background: 'rgba(60,36,18,0.9)' },
  hint: { fontSize: 11, color: '#8a7355', lineHeight: 1.4 },
};

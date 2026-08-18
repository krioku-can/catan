import { useEffect, useState } from 'react';
import { disableTurnPush, enableTurnPush, isIOS, isStandalone, pushPrefOn, pushSupported } from '../push';

export default function PushToggle({ playerId }: { playerId: string | null }) {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');

  useEffect(() => {
    setOn(pushPrefOn() && Notification.permission === 'granted');
    if (isIOS() && !isStandalone()) {
      setHint('iPhone: Add to Home Screen first, then turn this on.');
    } else if (!pushSupported()) {
      setHint('This browser cannot receive web push.');
    }
  }, []);

  if (!playerId) return null;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setHint('');
    try {
      if (on) {
        await disableTurnPush(playerId);
        setOn(false);
      } else {
        const err = await enableTurnPush(playerId);
        if (err) setHint(err);
        else setOn(true);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={styles.wrap}>
      <button type="button" style={{ ...styles.btn, ...(on ? styles.btnOn : {}) }} onClick={toggle} disabled={busy}>
        {busy ? '…' : on ? '🔔 Turn alerts on' : '🔕 Notify me when it\'s my turn'}
      </button>
      {hint && <div style={styles.hint}>{hint}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 6 },
  btn: {
    padding: '10px 12px',
    border: '1px solid rgba(200,150,70,0.35)',
    borderRadius: 8,
    background: 'rgba(20,12,6,0.55)',
    color: '#f5efe4',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  },
  btnOn: {
    borderColor: '#34d399',
    color: '#34d399',
    background: 'rgba(52,211,153,0.12)',
  },
  hint: { fontSize: 12, color: '#c4b49a', lineHeight: 1.35 },
};

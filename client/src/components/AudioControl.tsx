import { useEffect, useState } from 'react';
import {
  getAudioSettings,
  subscribeAudioSettings,
  updateAudioSettings,
  unlockAudio,
  sfx,
  type AudioSettings,
} from '../audio';

/**
 * Compact ScoreBar audio button + floating warm-wood Audio Mixer popover.
 * Controls Master Mute, SFX volume, Island Music, Coastal Ambience, and Phone Haptics.
 */
export default function AudioControl() {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<AudioSettings>(() => getAudioSettings());

  useEffect(() => subscribeAudioSettings(setCfg), []);

  const effectivelyMuted = cfg.muted || (cfg.sfxVolume <= 0.005 && cfg.musicVolume <= 0.005 && cfg.ambienceVolume <= 0.005);

  const toggleOpen = () => {
    unlockAudio();
    setOpen(o => !o);
  };

  return (
    <>
      <button
        className={`score-icon-btn ${effectivelyMuted ? '' : 'score-icon-btn-on'}`}
        onClick={toggleOpen}
        title="Audio & Music Mixer"
        aria-label="Audio & Music Mixer"
        aria-expanded={open}
        type="button"
      >
        {effectivelyMuted ? '🔇' : '🔊'}
      </button>

      {open && (
        <>
          <div
            style={styles.backdrop}
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div style={styles.popover} role="dialog" aria-label="Audio settings">
            <div style={styles.header}>
              <span style={styles.title}>🎶 Tabletop Audio</span>
              <button
                type="button"
                style={{
                  ...styles.mutePill,
                  ...(cfg.muted ? styles.mutePillOff : styles.mutePillOn),
                }}
                onClick={() => {
                  unlockAudio();
                  const nextMuted = !cfg.muted;
                  updateAudioSettings({ muted: nextMuted });
                  if (!nextMuted) sfx.click();
                }}
              >
                {cfg.muted ? '🔇 Muted' : '🔊 On'}
              </button>
            </div>

            <div style={{ ...styles.body, opacity: cfg.muted ? 0.45 : 1 }}>
              {/* Sound Effects */}
              <div style={styles.row}>
                <div style={styles.rowLabel}>
                  <span>🎲 Sound Effects</span>
                  <div style={styles.rowRight}>
                    <span style={styles.pct}>{Math.round(cfg.sfxVolume * 100)}%</span>
                    <button
                      type="button"
                      style={styles.testBtn}
                      onClick={() => {
                        unlockAudio();
                        if (cfg.muted) updateAudioSettings({ muted: false });
                        sfx.dice();
                      }}
                      title="Preview sound effects"
                    >
                      Test
                    </button>
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(cfg.sfxVolume * 100)}
                  style={styles.slider}
                  onChange={e => {
                    unlockAudio();
                    updateAudioSettings({ muted: false, sfxVolume: Number(e.target.value) / 100 });
                  }}
                  onMouseUp={() => sfx.click()}
                  onTouchEnd={() => sfx.click()}
                />
              </div>

              {/* Island Music */}
              <div style={styles.row}>
                <div style={styles.rowLabel}>
                  <span>🪕 Island Music</span>
                  <span style={styles.pct}>{Math.round(cfg.musicVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(cfg.musicVolume * 100)}
                  style={styles.slider}
                  onChange={e => {
                    unlockAudio();
                    updateAudioSettings({ muted: false, musicVolume: Number(e.target.value) / 100 });
                  }}
                />
              </div>

              {/* Coastal Ambience */}
              <div style={styles.row}>
                <div style={styles.rowLabel}>
                  <span>🌊 Ocean Ambience</span>
                  <span style={styles.pct}>{Math.round(cfg.ambienceVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(cfg.ambienceVolume * 100)}
                  style={styles.slider}
                  onChange={e => {
                    unlockAudio();
                    updateAudioSettings({ muted: false, ambienceVolume: Number(e.target.value) / 100 });
                  }}
                />
              </div>

              {/* Haptics */}
              <div style={styles.hapticRow}>
                <span style={styles.hapticLabel}>📳 Touch Haptics</span>
                <button
                  type="button"
                  style={{
                    ...styles.toggleBtn,
                    ...(cfg.haptics ? styles.toggleOn : styles.toggleOff),
                  }}
                  onClick={() => {
                    unlockAudio();
                    const next = !cfg.haptics;
                    updateAudioSettings({ haptics: next });
                    if (next) sfx.preview();
                  }}
                >
                  {cfg.haptics ? 'On' : 'Off'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 190,
    background: 'transparent',
  },
  popover: {
    position: 'fixed',
    top: 'max(52px, calc(env(safe-area-inset-top, 0px) + 48px))',
    right: 10,
    zIndex: 200,
    width: 256,
    maxWidth: 'calc(100vw - 20px)',
    borderRadius: 14,
    padding: 12,
    background: 'linear-gradient(180deg, rgba(38, 22, 10, 0.97), rgba(24, 14, 6, 0.98))',
    border: '1px solid rgba(235, 192, 108, 0.42)',
    boxShadow: '0 14px 36px rgba(0, 0, 0, 0.62)',
    color: '#f5efe4',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingBottom: 8,
    borderBottom: '1px solid rgba(255, 220, 150, 0.14)',
  },
  title: {
    fontSize: 13,
    fontWeight: 800,
    color: '#f5e1b8',
    letterSpacing: '0.02em',
  },
  mutePill: {
    padding: '4px 10px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    border: '1px solid transparent',
  },
  mutePillOn: {
    background: 'rgba(46, 125, 50, 0.35)',
    borderColor: '#66bb6a',
    color: '#dcedc8',
  },
  mutePillOff: {
    background: 'rgba(183, 28, 28, 0.32)',
    borderColor: 'rgba(239, 154, 154, 0.5)',
    color: '#ffcdd2',
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    transition: 'opacity 150ms ease',
  },
  row: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  rowLabel: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: 12,
    fontWeight: 600,
    color: '#ebd9ba',
  },
  rowRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  pct: {
    fontSize: 11,
    color: '#c9b490',
    fontVariantNumeric: 'tabular-nums',
    minWidth: 32,
    textAlign: 'right',
  },
  testBtn: {
    padding: '2px 7px',
    borderRadius: 6,
    border: '1px solid rgba(235, 192, 108, 0.38)',
    background: 'rgba(235, 192, 108, 0.14)',
    color: '#ffe082',
    fontSize: 10,
    fontWeight: 700,
    cursor: 'pointer',
  },
  slider: {
    width: '100%',
    accentColor: '#e5b85c',
    cursor: 'pointer',
    height: 18,
    margin: 0,
  },
  hapticRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
    borderTop: '1px solid rgba(255, 220, 150, 0.12)',
  },
  hapticLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: '#ebd9ba',
  },
  toggleBtn: {
    padding: '3px 12px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    border: '1px solid transparent',
  },
  toggleOn: {
    background: 'rgba(229, 184, 92, 0.24)',
    borderColor: 'rgba(229, 184, 92, 0.6)',
    color: '#ffe082',
  },
  toggleOff: {
    background: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.18)',
    color: '#b0a090',
  },
};

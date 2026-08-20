/**
 * Lightweight Web Audio SFX — no asset downloads required.
 * Call unlockAudio() on first user gesture so mobile browsers allow playback.
 */

let ctx: AudioContext | null = null;
let muted = false;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/** Call from a click/tap so iOS unlocks audio. */
export function unlockAudio() {
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  // Tiny silent blip locks the session open on some browsers.
  try {
    const o = c.createOscillator();
    const g = c.createGain();
    g.gain.value = 0.0001;
    o.connect(g);
    g.connect(c.destination);
    o.start();
    o.stop(c.currentTime + 0.01);
  } catch { /* ignore */ }
}

export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem('catan_mute', m ? '1' : '0'); } catch { /* ignore */ }
}

export function isMuted(): boolean {
  try { return localStorage.getItem('catan_mute') === '1'; } catch { return muted; }
}

function tone(
  freq: number,
  duration: number,
  type: OscillatorType = 'sine',
  gain = 0.08,
  freqEnd?: number,
) {
  if (muted || isMuted()) return;
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + duration);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

export const sfx = {
  dice() {
    tone(180, 0.06, 'triangle', 0.07);
    setTimeout(() => tone(240, 0.05, 'triangle', 0.06), 40);
    setTimeout(() => tone(320, 0.08, 'square', 0.04), 90);
  },
  build() {
    tone(440, 0.08, 'sine', 0.07);
    setTimeout(() => tone(660, 0.1, 'sine', 0.05), 50);
  },
  road() {
    tone(300, 0.07, 'triangle', 0.06);
  },
  robber() {
    tone(120, 0.25, 'sawtooth', 0.05, 60);
  },
  discard() {
    tone(220, 0.1, 'triangle', 0.05, 140);
  },
  steal() {
    tone(520, 0.06, 'square', 0.04);
    setTimeout(() => tone(390, 0.08, 'square', 0.03), 60);
  },
  yourTurn() {
    tone(523, 0.09, 'sine', 0.06);
    setTimeout(() => tone(659, 0.12, 'sine', 0.05), 80);
  },
  win() {
    [523, 659, 784, 1046].forEach((f, i) => {
      setTimeout(() => tone(f, 0.18, 'sine', 0.07), i * 120);
    });
  },
  click() {
    tone(800, 0.03, 'square', 0.025);
  },
  devCard() {
    tone(392, 0.08, 'triangle', 0.05);
    setTimeout(() => tone(523, 0.12, 'sine', 0.06), 70);
    setTimeout(() => tone(659, 0.16, 'sine', 0.05), 150);
  },
  error() {
    tone(140, 0.12, 'sawtooth', 0.04);
  },
};

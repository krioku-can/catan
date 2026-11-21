/**
 * Catan Acoustic Tabletop Audio Engine (Web Audio API — 100% offline, zero asset bloat).
 *
 * Features:
 * - Procedural stereo wooden-hall convolution reverb + master warmth EQ & dynamics limiter
 * - Karplus-Strong physical-modeling plucked acoustic lute / Celtic harp synthesis
 * - Multi-layered acoustic foley SFX (wooden dice clatter, masonry city keep, cottage thud,
 *   domino roads, gold coins, parchment cards, medieval war-horn, marimba harvest chimes)
 * - Generative cozy D-Mixolydian medieval/maritime tabletop soundtrack (lute, cello bass, flute)
 * - Dual-LFO stereo coastal ocean surf ambience + sparse distant harbor gull
 * - Independent persistent volume channels (SFX, Music, Ambience) + optional phone haptics
 * - Automatic suspend/resume on page visibility change (Android home button / screen lock)
 */

export interface AudioSettings {
  muted: boolean;
  sfxVolume: number;      // 0..1
  musicVolume: number;    // 0..1
  ambienceVolume: number; // 0..1
  haptics: boolean;
}

export type AudioScene = 'menu' | 'game';

const STORAGE_KEY = 'catan_audio_v2';
const LEGACY_MUTE_KEY = 'catan_mute';

const DEFAULT_SETTINGS: AudioSettings = {
  muted: false,
  sfxVolume: 0.88,
  musicVolume: 0.36,
  ambienceVolume: 0.32,
  haptics: true,
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

function loadSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AudioSettings>;
      return {
        muted: Boolean(parsed.muted),
        sfxVolume: clamp01(parsed.sfxVolume ?? DEFAULT_SETTINGS.sfxVolume),
        musicVolume: clamp01(parsed.musicVolume ?? DEFAULT_SETTINGS.musicVolume),
        ambienceVolume: clamp01(parsed.ambienceVolume ?? DEFAULT_SETTINGS.ambienceVolume),
        haptics: parsed.haptics !== false,
      };
    }
    const legacyMute = localStorage.getItem(LEGACY_MUTE_KEY) === '1';
    return { ...DEFAULT_SETTINGS, muted: legacyMute };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(s: AudioSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    localStorage.setItem(LEGACY_MUTE_KEY, s.muted ? '1' : '0');
  } catch { /* ignore */ }
}

let settings: AudioSettings = loadSettings();
const listeners = new Set<(s: AudioSettings) => void>();

function notifyListeners() {
  const snap = { ...settings };
  listeners.forEach(fn => {
    try { fn(snap); } catch { /* ignore */ }
  });
}

export function getAudioSettings(): AudioSettings {
  return { ...settings };
}

export function subscribeAudioSettings(fn: (s: AudioSettings) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function updateAudioSettings(patch: Partial<AudioSettings>) {
  settings = {
    muted: patch.muted !== undefined ? Boolean(patch.muted) : settings.muted,
    sfxVolume: patch.sfxVolume !== undefined ? clamp01(patch.sfxVolume) : settings.sfxVolume,
    musicVolume: patch.musicVolume !== undefined ? clamp01(patch.musicVolume) : settings.musicVolume,
    ambienceVolume: patch.ambienceVolume !== undefined ? clamp01(patch.ambienceVolume) : settings.ambienceVolume,
    haptics: patch.haptics !== undefined ? Boolean(patch.haptics) : settings.haptics,
  };
  saveSettings(settings);
  syncBusGains(0.18);
  syncLoops();
  notifyListeners();
}

export function setMuted(m: boolean) {
  updateAudioSettings({ muted: m });
}

export function isMuted(): boolean {
  return settings.muted;
}

/* ─── AudioContext & Mastering Bus Graph ───────────────────────────── */

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let sfxBus: GainNode | null = null;
let sfxReverbSend: GainNode | null = null;
let musicBus: GainNode | null = null;
let musicDuckGain: GainNode | null = null;
let ambienceBus: GainNode | null = null;
let reverbNode: ConvolverNode | null = null;

let whiteNoiseBuf: AudioBuffer | null = null;
let pinkNoiseBuf: AudioBuffer | null = null;
const pluckCache = new Map<string, AudioBuffer>();

let unlocked = false;
let scene: AudioScene = 'menu';
let pageHidden = typeof document !== 'undefined' ? document.hidden : false;
let lifecycleBound = false;

function buildWhiteNoise(c: AudioContext, seconds = 2.0): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }
  return buf;
}

function buildPinkNoise(c: AudioContext, seconds = 4.0): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    let maxVal = 0.001;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      const sample = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
      data[i] = sample;
      const a = Math.abs(sample);
      if (a > maxVal) maxVal = a;
    }
    const scale = 0.85 / maxVal;
    for (let i = 0; i < len; i++) data[i] *= scale;
  }
  return buf;
}

/**
 * Generates a warm wooden game-room / tavern acoustic impulse response:
 * subtle early reflections + smoothly damped stereo tail.
 */
function buildRoomImpulse(c: AudioContext, seconds = 1.45): AudioBuffer {
  const sr = c.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = c.createBuffer(2, len, sr);
  const earlyTaps = [
    { ms: 13, l: 0.36, r: 0.18 },
    { ms: 22, l: 0.16, r: 0.32 },
    { ms: 34, l: 0.24, r: 0.20 },
    { ms: 49, l: 0.14, r: 0.19 },
  ];

  for (let ch = 0; ch < 2; ch++) {
    const out = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.pow(1 - t, 2.75) * Math.exp(-t * 3.1);
      const raw = (Math.random() * 2 - 1) * env;
      // Progressive HF damping so high frequencies decay naturally like wood walls
      const damp = 0.22 + 0.55 * (1 - t);
      lp += damp * (raw - lp);
      out[i] = lp * 0.32;
    }
    for (const tap of earlyTaps) {
      const idx = Math.floor((tap.ms / 1000) * sr);
      if (idx < len - 3) {
        const g = ch === 0 ? tap.l : tap.r;
        out[idx] += g * 0.45;
        out[idx + 1] += g * 0.28;
        out[idx + 2] += g * 0.14;
      }
    }
  }
  return buf;
}

/**
 * Karplus-Strong physical-modeling plucked acoustic string (nylon lute / Celtic harp).
 * Cached by pitch + brightness so repeated musical notes cost zero CPU.
 */
function getPluckBuffer(
  c: AudioContext,
  freq: number,
  duration = 2.1,
  brightness = 0.48,
): AudioBuffer {
  const key = `${Math.round(freq * 4)}_${Math.round(brightness * 10)}`;
  const cached = pluckCache.get(key);
  if (cached) return cached;

  const sr = c.sampleRate;
  const len = Math.floor(sr * duration);
  const period = Math.max(16, Math.round(sr / freq));
  const buf = c.createBuffer(1, len, sr);
  const out = buf.getChannelData(0);

  // Warm finger-pluck excitation (smoothed noise + soft triangular body)
  const ring = new Float32Array(period);
  let lp = 0;
  let mean = 0;
  for (let i = 0; i < period; i++) {
    const n = Math.random() * 2 - 1;
    lp += (0.25 + brightness * 0.5) * (n - lp);
    const tri = 1 - Math.abs((i / period) * 2 - 1);
    ring[i] = lp * 0.72 + (tri - 0.5) * 0.55;
    mean += ring[i];
  }
  mean /= period;
  for (let i = 0; i < period; i++) ring[i] -= mean;

  // Pitch-dependent natural string damping
  const decay = Math.min(0.9982, Math.max(0.992, 0.9985 - freq * 0.0000038));
  const alpha = 0.5 * (1 - brightness * 0.35);
  let idx = 0;
  let maxVal = 0.001;
  const fadeInSamples = Math.min(Math.floor(sr * 0.003), len);
  const fadeOutSamples = Math.min(Math.floor(sr * 0.05), len);

  for (let i = 0; i < len; i++) {
    const curr = ring[idx];
    const nextIdx = (idx + 1) % period;
    const next = ring[nextIdx];
    const filtered = (curr * (1 - alpha) + next * alpha) * decay;
    ring[idx] = filtered;
    idx = nextIdx;

    let env = 1;
    if (i < fadeInSamples) env = i / fadeInSamples;
    else if (i > len - fadeOutSamples) env = (len - i) / fadeOutSamples;

    const sample = curr * env;
    out[i] = sample;
    const a = Math.abs(sample);
    if (a > maxVal) maxVal = a;
  }

  const norm = 0.85 / maxVal;
  for (let i = 0; i < len; i++) out[i] *= norm;

  if (pluckCache.size > 96) {
    const firstKey = pluckCache.keys().next().value;
    if (firstKey) pluckCache.delete(firstKey);
  }
  pluckCache.set(key, buf);
  return buf;
}

function bindLifecycle() {
  if (lifecycleBound || typeof document === 'undefined') return;
  lifecycleBound = true;

  const onVisibility = () => {
    pageHidden = document.hidden;
    if (!ctx) return;
    if (pageHidden) {
      syncBusGains(0.08);
      if (ctx.state === 'running') {
        ctx.suspend().catch(() => {});
      }
    } else if (!settings.muted && unlocked) {
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      syncBusGains(0.35);
      syncLoops();
    }
  };

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', () => {
    pageHidden = true;
    if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
  });
  window.addEventListener('pageshow', () => {
    pageHidden = document.hidden;
    if (!pageHidden && ctx && !settings.muted && unlocked) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      syncBusGains(0.35);
    }
  });
}

function ensureGraph(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  bindLifecycle();

  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();

    whiteNoiseBuf = buildWhiteNoise(ctx, 2.0);
    pinkNoiseBuf = buildPinkNoise(ctx, 4.0);

    // Master warmth EQ + dynamics limiter (protects small phone speakers from clipping)
    const warmLow = ctx.createBiquadFilter();
    warmLow.type = 'lowshelf';
    warmLow.frequency.value = 180;
    warmLow.gain.value = 1.6;

    const tameHigh = ctx.createBiquadFilter();
    tameHigh.type = 'highshelf';
    tameHigh.frequency.value = 6200;
    tameHigh.gain.value = -2.6;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -13;
    comp.knee.value = 14;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.16;

    masterGain = ctx.createGain();
    masterGain.gain.value = settings.muted ? 0.0001 : 0.92;

    warmLow.connect(tameHigh);
    tameHigh.connect(comp);
    comp.connect(masterGain);
    masterGain.connect(ctx.destination);

    // Shared warm wooden-hall convolution reverb
    reverbNode = ctx.createConvolver();
    reverbNode.buffer = buildRoomImpulse(ctx, 1.45);
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.45;
    reverbNode.connect(reverbReturn);
    reverbReturn.connect(warmLow);

    // SFX Bus (dry + subtle warm room send)
    sfxBus = ctx.createGain();
    sfxBus.gain.value = settings.sfxVolume;
    sfxBus.connect(warmLow);

    sfxReverbSend = ctx.createGain();
    sfxReverbSend.gain.value = 0.24;
    sfxBus.connect(sfxReverbSend);
    sfxReverbSend.connect(reverbNode);

    // Music Bus (ducking stage -> music volume -> dry + lush hall reverb)
    musicDuckGain = ctx.createGain();
    musicDuckGain.gain.value = 1.0;

    musicBus = ctx.createGain();
    musicBus.gain.value = scene === 'game' ? settings.musicVolume * 0.72 : 0.0001;

    const musicDry = ctx.createGain();
    musicDry.gain.value = 0.78;
    const musicWet = ctx.createGain();
    musicWet.gain.value = 0.46;

    musicDuckGain.connect(musicBus);
    musicBus.connect(musicDry);
    musicDry.connect(warmLow);
    musicBus.connect(musicWet);
    musicWet.connect(reverbNode);

    // Ambience Bus (stereo surf waves + gentle breeze)
    ambienceBus = ctx.createGain();
    ambienceBus.gain.value = scene === 'game' ? settings.ambienceVolume * 0.65 : 0.0001;
    ambienceBus.connect(warmLow);
  }
  return ctx;
}

function syncBusGains(fadeSec = 0.25) {
  if (!ctx || !masterGain || !sfxBus || !musicBus || !ambienceBus) return;
  const now = ctx.currentTime;
  const audible = !settings.muted && !pageHidden;
  const inGame = scene === 'game';

  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setTargetAtTime(audible ? 0.92 : 0.0001, now, Math.max(0.02, fadeSec * 0.35));

  sfxBus.gain.cancelScheduledValues(now);
  sfxBus.gain.setTargetAtTime(Math.max(0.0001, settings.sfxVolume), now, 0.04);

  const targetMusic = audible && inGame ? Math.max(0.0001, settings.musicVolume * 0.72) : 0.0001;
  musicBus.gain.cancelScheduledValues(now);
  musicBus.gain.setTargetAtTime(targetMusic, now, Math.max(0.05, fadeSec));

  const targetAmb = audible && inGame ? Math.max(0.0001, settings.ambienceVolume * 0.65) : 0.0001;
  ambienceBus.gain.cancelScheduledValues(now);
  ambienceBus.gain.setTargetAtTime(targetAmb, now, Math.max(0.05, fadeSec));
}

function duckMusic(dipGain = 0.58, holdSec = 0.9, recoverSec = 0.8) {
  if (!ctx || !musicDuckGain) return;
  const now = ctx.currentTime;
  musicDuckGain.gain.cancelScheduledValues(now);
  musicDuckGain.gain.setTargetAtTime(dipGain, now, 0.06);
  musicDuckGain.gain.setTargetAtTime(1.0, now + holdSec, recoverSec * 0.45);
}

/** Optional phone tactile haptics (silent no-op on unsupported devices). */
function haptic(pattern: number | number[]) {
  if (settings.muted || !settings.haptics) return;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch { /* ignore */ }
}

/** Call from a click/tap so mobile browsers & Android WebView unlock audio cleanly. */
export function unlockAudio() {
  const c = ensureGraph();
  if (!c) return;
  unlocked = true;
  if (c.state === 'suspended' && !pageHidden) {
    c.resume().catch(() => {});
  }
  // Tiny silent impulse locks the audio session open on iOS Safari & Chrome WebView
  try {
    const o = c.createOscillator();
    const g = c.createGain();
    g.gain.value = 0.00001;
    o.connect(g);
    g.connect(c.destination);
    o.start();
    o.stop(c.currentTime + 0.01);
  } catch { /* ignore */ }
  syncBusGains(0.45);
  syncLoops();
}

/** Switch between 'menu' (quiet) and 'game' (island music + coastal surf). */
export function setAudioScene(next: AudioScene) {
  if (scene === next) return;
  scene = next;
  syncBusGains(next === 'game' ? 1.0 : 0.45);
  syncLoops();
}

/* ─── Stereo Panner Helper ─────────────────────────────────────────── */

function connectWithPan(c: AudioContext, src: AudioNode, dest: AudioNode, pan = 0) {
  if (typeof c.createStereoPanner === 'function' && Math.abs(pan) > 0.01) {
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(p);
    p.connect(dest);
  } else {
    src.connect(dest);
  }
}

function jitter(base: number, pct = 0.035): number {
  return base * (1 + (Math.random() * 2 - 1) * pct);
}

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/* ─── Acoustic Synthesis Primitives ────────────────────────────────── */

function readyForSfx(): AudioContext | null {
  if (settings.muted || settings.sfxVolume <= 0.005 || pageHidden) return null;
  const c = ensureGraph();
  if (!c || !sfxBus) return null;
  if (c.state === 'suspended') c.resume().catch(() => {});
  return c;
}

/** Resonant wood-on-wood tabletop knock (dice bounce, wooden pieces, UI pegs). */
function woodKnock(
  c: AudioContext,
  dest: AudioNode,
  t: number,
  bodyHz: number,
  clickHz: number,
  vol: number,
  pan = 0,
  bodyDur = 0.055,
) {
  // 1. Resonant hollow wooden body thud
  const osc = c.createOscillator();
  const og = c.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(bodyHz * 1.38, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, bodyHz), t + bodyDur * 0.45);
  og.gain.setValueAtTime(0.0001, t);
  og.gain.linearRampToValueAtTime(vol * 0.72, t + 0.003);
  og.gain.exponentialRampToValueAtTime(0.0001, t + bodyDur);
  osc.connect(og);
  connectWithPan(c, og, dest, pan);
  osc.start(t);
  osc.stop(t + bodyDur + 0.015);

  // 2. Crisp wood-grain contact transient
  if (whiteNoiseBuf) {
    const ns = c.createBufferSource();
    ns.buffer = whiteNoiseBuf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(clickHz, t);
    bp.Q.value = 3.2;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(vol * 0.95, t + 0.002);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.022);
    ns.connect(bp);
    bp.connect(ng);
    connectWithPan(c, ng, dest, pan);
    ns.start(t, Math.random() * 1.4, 0.04);
  }
}

/** Heavy stone-masonry foundation impact (castle cities & robber drop). */
function stoneThud(c: AudioContext, dest: AudioNode, t: number, vol: number, pitch = 1) {
  const sub = c.createOscillator();
  const sg = c.createGain();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(128 * pitch, t);
  sub.frequency.exponentialRampToValueAtTime(44 * pitch, t + 0.14);
  sg.gain.setValueAtTime(0.0001, t);
  sg.gain.linearRampToValueAtTime(vol * 0.95, t + 0.006);
  sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  sub.connect(sg);
  sg.connect(dest);
  sub.start(t);
  sub.stop(t + 0.2);

  if (pinkNoiseBuf) {
    const ns = c.createBufferSource();
    ns.buffer = pinkNoiseBuf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(520 * pitch, t);
    bp.frequency.exponentialRampToValueAtTime(190 * pitch, t + 0.11);
    bp.Q.value = 1.6;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(vol * 0.72, t + 0.005);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    ns.connect(bp);
    bp.connect(ng);
    ng.connect(dest);
    ns.start(t, Math.random() * 2.5, 0.16);
  }
}

/** Tactile cardstock / parchment card swoosh (draw, deal, discard, steal). */
function parchmentBrush(
  c: AudioContext,
  dest: AudioNode,
  t: number,
  dur: number,
  startHz: number,
  endHz: number,
  vol: number,
  pan = 0,
) {
  if (!pinkNoiseBuf) return;
  const ns = c.createBufferSource();
  ns.buffer = pinkNoiseBuf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(startHz, t);
  bp.frequency.exponentialRampToValueAtTime(Math.max(200, endHz), t + dur);
  bp.Q.value = 1.8;

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + dur * 0.28);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  ns.connect(bp);
  bp.connect(g);
  connectWithPan(c, g, dest, pan);
  ns.start(t, Math.random() * 2.8, dur + 0.04);
}

/** Crisp clinking gold coin (trades & Monopoly). */
function coinClink(c: AudioContext, dest: AudioNode, t: number, pitchMul: number, vol: number, pan = 0) {
  const base = 2480 * pitchMul;
  const partials = [
    { mult: 1.0, amp: 1.0, dur: 0.16 },
    { mult: 1.59, amp: 0.62, dur: 0.11 },
    { mult: 2.38, amp: 0.34, dur: 0.075 },
  ];
  for (const p of partials) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(base * p.mult, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol * p.amp * 0.34, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + p.dur);
    osc.connect(g);
    connectWithPan(c, g, dest, pan);
    osc.start(t);
    osc.stop(t + p.dur + 0.02);
  }
}

/** Warm rosewood marimba / kalimba bar (harvest chimes, your-turn, settlement lift). */
function marimbaNote(
  c: AudioContext,
  dest: AudioNode,
  t: number,
  freq: number,
  dur: number,
  vol: number,
  pan = 0,
) {
  // Fundamental warm wood bar
  const f1 = c.createOscillator();
  const g1 = c.createGain();
  f1.type = 'sine';
  f1.frequency.setValueAtTime(freq, t);
  g1.gain.setValueAtTime(0.0001, t);
  g1.gain.linearRampToValueAtTime(vol, t + 0.006);
  g1.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  f1.connect(g1);
  connectWithPan(c, g1, dest, pan);
  f1.start(t);
  f1.stop(t + dur + 0.02);

  // Rosewood 4th harmonic shimmer (decays quickly like a real struck bar)
  const f2 = c.createOscillator();
  const g2 = c.createGain();
  f2.type = 'sine';
  f2.frequency.setValueAtTime(freq * 3.98, t);
  g2.gain.setValueAtTime(0.0001, t);
  g2.gain.linearRampToValueAtTime(vol * 0.22, t + 0.003);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(0.08, dur * 0.32));
  f2.connect(g2);
  connectWithPan(c, g2, dest, pan);
  f2.start(t);
  f2.stop(t + 0.1);
}

/** Acoustic plucked lute / Celtic harp string via cached Karplus-Strong buffer. */
function pluckString(
  c: AudioContext,
  dest: AudioNode,
  t: number,
  freq: number,
  vol: number,
  pan = 0,
  brightness = 0.48,
  dur = 2.0,
) {
  const buf = getPluckBuffer(c, freq, Math.max(1.2, dur), brightness);
  const src = c.createBufferSource();
  src.buffer = buf;

  // Subtle wooden soundboard warmth
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(Math.min(5800, freq * 7.5), t);

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.004);
  g.gain.setValueAtTime(vol, t + Math.max(0.05, dur - 0.18));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  src.connect(lp);
  lp.connect(g);
  connectWithPan(c, g, dest, pan);
  src.start(t);
  src.stop(t + dur + 0.02);
}

/** Expressive medieval French horn / brass call with breath-linked filter swell. */
function warmHorn(
  c: AudioContext,
  dest: AudioNode,
  t: number,
  freq: number,
  dur: number,
  vol: number,
  freqEnd?: number,
  pan = 0,
) {
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 1.4;
  lp.frequency.setValueAtTime(freq * 1.4, t);
  lp.frequency.linearRampToValueAtTime(Math.min(2800, freq * 3.8), t + Math.min(0.14, dur * 0.35));
  lp.frequency.exponentialRampToValueAtTime(Math.max(220, freq * 1.9), t + dur);

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + Math.min(0.09, dur * 0.28));
  g.gain.setValueAtTime(vol * 0.88, t + dur * 0.68);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  lp.connect(g);
  connectWithPan(c, g, dest, pan);

  // Pair of detuned sawtooths + warm sine core
  const detunes = [-5, 5];
  for (const det of detunes) {
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.detune.value = det;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd != null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t + dur);
    }
    const subG = c.createGain();
    subG.gain.value = 0.28;
    osc.connect(subG);
    subG.connect(lp);
    osc.start(t);
    osc.stop(t + dur + 0.04);
  }

  const core = c.createOscillator();
  core.type = 'sine';
  core.frequency.setValueAtTime(freq, t);
  if (freqEnd != null) {
    core.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t + dur);
  }
  const coreG = c.createGain();
  coreG.gain.value = 0.55;
  core.connect(coreG);
  coreG.connect(lp);
  core.start(t);
  core.stop(t + dur + 0.04);
}

/** Gentle breathy wooden Celtic flute / recorder voice. */
function warmFlute(
  c: AudioContext,
  dest: AudioNode,
  t: number,
  freq: number,
  dur: number,
  vol: number,
  pan = 0,
) {
  const main = c.createOscillator();
  main.type = 'sine';
  main.frequency.setValueAtTime(freq, t);

  const over = c.createOscillator();
  over.type = 'sine';
  over.frequency.setValueAtTime(freq * 2, t);
  const overG = c.createGain();
  overG.gain.value = 0.14;

  // Delicate natural vibrato blooming after attack
  const vib = c.createOscillator();
  const vibG = c.createGain();
  vib.frequency.value = 5.1;
  vibG.gain.setValueAtTime(0, t);
  vibG.gain.linearRampToValueAtTime(freq * 0.006, t + Math.min(0.28, dur * 0.45));
  vib.connect(vibG);
  vibG.connect(main.frequency);

  const env = c.createGain();
  const atk = Math.min(0.085, dur * 0.26);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(vol, t + atk);
  env.gain.setValueAtTime(vol * 0.86, t + Math.max(atk, dur - 0.14));
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  main.connect(env);
  over.connect(overG);
  overG.connect(env);
  connectWithPan(c, env, dest, pan);

  main.start(t);
  over.start(t);
  vib.start(t);
  main.stop(t + dur + 0.03);
  over.stop(t + dur + 0.03);
  vib.stop(t + dur + 0.03);

  // Whispered wooden chiff breath transient
  if (pinkNoiseBuf) {
    const breath = c.createBufferSource();
    breath.buffer = pinkNoiseBuf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq * 2.1;
    bp.Q.value = 4.5;
    const bg = c.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.linearRampToValueAtTime(vol * 0.16, t + 0.025);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(0.18, dur * 0.45));
    breath.connect(bp);
    bp.connect(bg);
    connectWithPan(c, bg, dest, pan);
    breath.start(t, Math.random() * 2.5, Math.min(0.22, dur));
  }
}

/** Shimmering medieval castle/harbor brass bell tone. */
function bellNote(
  c: AudioContext,
  dest: AudioNode,
  t: number,
  freq: number,
  dur: number,
  vol: number,
  pan = 0,
) {
  const partials = [
    { m: 1.0, a: 1.0, d: dur },
    { m: 2.0, a: 0.42, d: dur * 0.62 },
    { m: 2.756, a: 0.22, d: dur * 0.42 },
  ];
  for (const p of partials) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * p.m, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol * p.a * 0.42, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + p.d);
    osc.connect(g);
    connectWithPan(c, g, dest, pan);
    osc.start(t);
    osc.stop(t + p.d + 0.03);
  }
}

/* ─── Bespoke Tabletop Sound Effects Library ───────────────────────── */

export const sfx = {
  /** Rattling wooden dice cup when Roll Dice is tapped. */
  diceShake() {
    const c = readyForSfx();
    if (!c || !sfxBus) return;
    const t0 = c.currentTime + 0.01;
    const offsets = [0, 0.065, 0.14, 0.22, 0.31, 0.41];
    offsets.forEach((off, i) => {
      const pan = (i % 2 === 0 ? -0.22 : 0.22) + (Math.random() - 0.5) * 0.12;
      woodKnock(
        c, sfxBus!, t0 + off,
        jitter(310 + i * 18, 0.08),
        jitter(1850 + i * 90, 0.12),
        0.16 + (i % 2) * 0.04,
        pan,
        0.032,
      );
    });
    haptic([12, 40, 12, 50, 14]);
  },

  /** Realistic pair of wooden dice tumbling and settling onto the walnut board. */
  dice() {
    const c = readyForSfx();
    if (!c || !sfxBus) return;
    const t0 = c.currentTime + 0.01;
    // Die 1 + Die 2 staggered decelerating bounces
    const bounces = [
      { dt: 0.000, body: 270, click: 1900, vol: 0.34, pan: -0.25 },
      { dt: 0.038, body: 320, click: 2250, vol: 0.29, pan: 0.22 },
      { dt: 0.095, body: 295, click: 2050, vol: 0.24, pan: -0.14 },
      { dt: 0.158, body: 355, click: 2450, vol: 0.18, pan: 0.15 },
      { dt: 0.215, body: 390, click: 2650, vol: 0.12, pan: -0.05 },
      { dt: 0.262, body: 430, click: 2800, vol: 0.08, pan: 0.06 },
    ];
    for (const b of bounces) {
      woodKnock(
        c, sfxBus, t0 + b.dt,
        jitter(b.body, 0.07),
        jitter(b.click, 0.09),
        b.vol,
        b.pan,
        0.045,
      );
    }
    haptic([14, 30, 10]);
  },

  /** Warm harvest chimes + subtle card slide when dice produce resources. */
  collect(count = 1) {
    const c = readyForSfx();
    if (!c || !sfxBus) return;
    const t0 = c.currentTime + 0.02;
    const notes = [587.33, 659.25, 739.99, 880.0, 1174.66]; // D5 E5 F#5 A5 D6
    const n = Math.max(1, Math.min(4, count));
    parchmentBrush(c, sfxBus, t0, 0.14, 900, 2100, 0.12, 0.1);
    for (let i = 0; i < n; i++) {
      marimbaNote(
        c, sfxBus, t0 + 0.04 + i * 0.068,
        jitter(notes[i], 0.008),
        0.34,
        0.19 - i * 0.018,
        -0.25 + i * 0.18,
      );
    }
  },

  /** Placing a wooden settlement cottage: walnut thump + carpenter double-tap + bright wood fifth. */
  settlement() {
    const c = readyForSfx();
    if (!c || !sfxBus) return;
    const t0 = c.currentTime + 0.01;
    // Solid wooden piece placement onto board
    woodKnock(c, sfxBus, t0, jitter(175, 0.04), jitter(1350, 0.08), 0.36, -0.05, 0.075);
    // Quick crisp carpenter tap
    woodKnock(c, sfxBus, t0 + 0.062, jitter(260, 0.04), jitter(2050, 0.08), 0.22, 0.1, 0.04);
    // Warm rising marimba fifth (D5 -> A5)
    marimbaNote(c, sfxBus, t0 + 0.03, 587.33, 0.28, 0.18, -0.1);
    marimbaNote(c, sfxBus, t0 + 0.105, 880.0, 0.38, 0.17, 0.12);
    haptic(18);
  },

  /** Alias kept for backward compatibility (maps to settlement). */
  build() {
    sfx.settlement();
  },

  /** Upgrading to a medieval castle keep: heavy stone thud + shimmering castle bell chord. */
  city() {
    const c = readyForSfx();
    if (!c || !sfxBus) return;
    const t0 = c.currentTime + 0.01;
    stoneThud(c, sfxBus, t0, 0.38, 1.0);
    woodKnock(c, sfxBus, t0 + 0.06, 210, 1600, 0.22, 0, 0.06);
    // Regal D-major castle bell chord
    bellNote(c, sfxBus, t0 + 0.045, 587.33, 0.85, 0.22, -0.22); // D5
    bellNote(c, sfxBus, t0 + 0.105, 739.99, 0.90, 0.20, 0.0);   // F#5
    bellNote(c, sfxBus, t0 + 0.165, 880.0,  1.05, 0.21, 0.22);  // A5
    bellNote(c, sfxBus, t0 + 0.235, 1174.66, 1.15, 0.18, 0.08); // D6
    haptic([24, 35, 18]);
  },

  /** Placing a wooden road plank: crisp tactile domino snap onto board. */
  road() {
    const c = readyForSfx();
    if (!c || !sfxBus) return;
    const t0 = c.currentTime + 0.01;
    woodKnock(c, sfxBus, t0, jitter(225, 0.05), jitter(1950, 0.08), 0.32, 0, 0.048);
    woodKnock(c, sfxBus, t0 + 0.036, jitter(360, 0.06), jitter(2600, 0.1), 0.16, 0.14, 0.028);
    haptic(12);
  },

  /** Delicate wooden hover tick when previewing a ghost piece on the board. */
  preview() {
    const c = readyForSfx();
    if (!c || !sfxBus) return;
    const t0 = c.currentTime + 0.005;
    woodKnock(c, sfxBus, t0, jitter(420, 0.04), jitter(2400, 0.08), 0.14, 0, 0.026);
    marimbaNote(c, sfxBus, t0 + 0.008, 659.25, 0.11, 0.08, 0);
    haptic(6);
  },

  /** Soft muffled downward wood brush when canceling a ghost preview or closing a sheet. */
  cancel() {
    const c = readyForSfx();
    if (!c || !sfxBus) return;
    const t0 = c.currentTime + 0.005;
    marimbaNote(c, sfxBus, t0, 440, 0.10, 0.09, 0);
    marimbaNote(c, sfxBus, t0 + 0.045, 329.63, 0.12, 0.08, 0);
  },

  /** Rolling a 7 or dropping the robber: ominous medieval war-horn + obsidian piece thud. */
  robber() {
    const c = readyForSfx();
    if (!c || !sfxBus) return;
    const t0 = c.currentTime + 0.01;
    duckMusic(0.55, 0.9, 0.7);
    stoneThud(c, sfxBus, t0, 0.32, 0.82);
    // Low tense medieval horn tritone glide (D3 -> Ab2)
    warmHorn(c, sfxBus, t0 + 0.03, 146.83, 0.56, 0.24, 103.83, -0.08);
    warmHorn(c, sfxBus, t0 + 0.06, 220.0,  0.48, 0.11, 155.56, 0.08);
    haptic([30, 50, 35]);
  },

  /** Stealing a resource card: swift parchment snatch + sly plucked pizzicato wink. */
  steal() {
    const c = readyForSfx();
    if (!c || !sfxBus) return;
    const t0 = c.currentTime + 0.01;
    parchmentBrush(c, sfxBus, t0, 0.14, 1100, 3400, 0.26, -0.15);
    pluckString(c, sfxBus, t0 + 0.06, 659.25, 0.20, 0.15, 0.65, 0.45);  // E5
    pluckString(c, sfxBus, t0 + 0.15, 466.16, 0.18, -0.15, 0.55, 0.55); // Bb4
    haptic([15, 25, 15]);
  },

  /** Discarding cards after a 7: layered parchment card ruffles + gentle downward flute sigh. */
  discard() {
    const c = readyForSfx();
    if (!c || !sfxBus) return;
    const t0 = c.currentTime + 0.01;
    for (let i = 0; i < 3; i++) {
      parchmentBrush(c, sfxBus, t0 + i * 0.055, 0.11, 1800 - i * 250, 750, 0.18, -0.2 + i * 0.2);
    }
    warmFlute(c, sfxBus, t0 + 0.06, 587.33, 0.20, 0.12, -0.1);
    warmFlute(c, sfxBus, t0 + 0.18, 440.0,  0.28, 0.11, 0.1);
    haptic(14);
  },

  /** Completed bank/harbor or player trade: clinking gold coins + warm major lute resolve. */
  trade() {
    const c = readyForSfx();
    if (!c || !sfxBus) return;
    const t0 = c.currentTime + 0.01;
    coinClink(c, sfxBus, t0,        1.00, 0.34, -0.22);
    coinClink(c, sfxBus, t0 + 0.06, 1.14, 0.30,  0.18);
    coinClink(c, sfxBus, t0 + 0.13, 1.26, 0.26, -0.05);
    pluckString(c, sfxBus, t0 + 0.09, 392.00, 0.16, -0.2, 0.52, 0.9); // G4
    pluckString(c, sfxBus, t0 + 0.14, 493.88, 0.16,  0.0, 0.52, 0.9); // B4
    pluckString(c, sfxBus, t0 + 0.19, 587.33, 0.18,  0.2, 0.56, 1.0); // D5
    haptic([12, 30, 12]);
  },

  /** Proposing or receiving a table trade offer: welcoming harbor bell double chime. */
  tradeOffer() {
    const c = readyForSfx();
    if (!c || !sfxBus) return;
    const t0 = c.currentTime + 0.01;
    bellNote(c, sfxBus, t0,        587.33, 0.55, 0.16, -0.15);
    bellNote(c, sfxBus, t0 + 0.11, 880.0,  0.65, 0.16,  0.15);
  },

  /** Buying a development card: tactile parchment draw + mystical Celtic harp glissando. */
  devCard() {
    const c = readyForSfx();
    if (!c || !sfxBus) return;
    const t0 = c.currentTime + 0.01;
    parchmentBrush(c, sfxBus, t0, 0.16, 850, 2600, 0.22, 0);
    const harp = [293.66, 369.99, 440.0, 587.33, 659.25]; // D4 F#4 A4 D5 E5
    harp.forEach((hz, i) => {
      pluckString(c, sfxBus!, t0 + 0.05 + i * 0.055, hz, 0.19 - i * 0.012, -0.3 + i * 0.15, 0.62, 1.3);
    });
    haptic(14);
  },

  /** Playing a Knight card: crisp metallic sword shimmer + bold medieval brass call. */
  knight() {
    const c = readyForSfx();
    if (!c || !sfxBus) return;
    const t0 = c.currentTime + 0.01;
    // Metallic unsheathe shimmer
    if (whiteNoiseBuf) {
      const ns = c.createBufferSource();
      ns.buffer = whiteNoiseBuf;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(2200, t0);
      bp.frequency.exponentialRampToValueAtTime(5400, t0 + 0.16);
      bp.Q.value = 6.5;
      const ng = c.createGain();
      ng.gain.setValueAtTime(0.0001, t0);
      ng.gain.linearRampToValueAtTime(0.18, t0 + 0.04);
      ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.20);
      ns.connect(bp);
      bp.connect(ng);
      ng.connect(sfxBus);
      ns.start(t0, Math.random() * 1.2, 0.24);
    }
    warmHorn(c, sfxBus, t0 + 0.05, 293.66, 0.24, 0.20, undefined, -0.1); // D4
    warmHorn(c, sfxBus, t0 + 0.20, 440.00, 0.44, 0.22, undefined,  0.1); // A4
    haptic([18, 35, 22]);
  },

  /** Playing Year of Plenty: bountiful shimmering Celtic harp flourish. */
  yearOfPlenty() {
    const c = readyForSfx();
    if (!c || !sfxBus) return;
    const t0 = c.currentTime + 0.01;
    const notes = [392.0, 493.88, 587.33, 739.99, 783.99, 987.77]; // G4 B4 D5 F#5 G5 B5
    notes.forEach((hz, i) => {
      pluckString(c, sfxBus!, t0 + i * 0.052, hz, 0.20, -0.35 + i * 0.14, 0.68, 1.45);
    });
    haptic(16);
  },

  /** Playing Monopoly: imperial brass swell + cascading shower of clinking coins. */
  monopoly() {
    const c = readyForSfx();
    if (!c || !sfxBus) return;
    const t0 = c.currentTime + 0.01;
    duckMusic(0.6, 0.8, 0.7);
    warmHorn(c, sfxBus, t0, 293.66, 0.48, 0.21, undefined, -0.15);
    warmHorn(c, sfxBus, t0 + 0.05, 440.0, 0.50, 0.17, undefined, 0.15);
    for (let i = 0; i < 6; i++) {
      coinClink(c, sfxBus, t0 + 0.08 + i * 0.058, 0.92 + i * 0.08, 0.26, (i % 2 === 0 ? -0.3 : 0.3));
    }
    haptic([18, 28, 18, 28, 22]);
  },

  /** Playing Road Building: double upbeat carpenter timber knock + bright brass fifth. */
  roadBuilding() {
    const c = readyForSfx();
    if (!c || !sfxBus) return;
    const t0 = c.currentTime + 0.01;
    woodKnock(c, sfxBus, t0,        220, 1850, 0.30, -0.18, 0.05);
    woodKnock(c, sfxBus, t0 + 0.10, 265, 2100, 0.30,  0.18, 0.05);
    marimbaNote(c, sfxBus, t0 + 0.16, 587.33, 0.28, 0.18, -0.1);
    marimbaNote(c, sfxBus, t0 + 0.24, 880.0,  0.38, 0.19,  0.1);
    haptic([14, 40, 14]);
  },

  /** Claiming Longest Road or Largest Army: glorious royal brass & harp fanfare! */
  award() {
    const c = readyForSfx();
    if (!c || !sfxBus) return;
    const t0 = c.currentTime + 0.01;
    duckMusic(0.45, 1.3, 0.9);
    // Regal brass triad ascent (D4 -> F#4 -> A4 -> D5)
    warmHorn(c, sfxBus, t0 + 0.00, 293.66, 0.22, 0.22, undefined, -0.18);
    warmHorn(c, sfxBus, t0 + 0.16, 369.99, 0.22, 0.22, undefined,  0.0);
    warmHorn(c, sfxBus, t0 + 0.32, 440.00, 0.24, 0.23, undefined,  0.18);
    warmHorn(c, sfxBus, t0 + 0.48, 587.33, 0.72, 0.26, undefined,  0.0);
    warmHorn(c, sfxBus, t0 + 0.48, 440.00, 0.72, 0.15, undefined, -0.22);
    // Sparkling harp sweep on top
    [587.33, 739.99, 880.0, 1174.66].forEach((hz, i) => {
      pluckString(c, sfxBus!, t0 + 0.46 + i * 0.05, hz, 0.20, -0.3 + i * 0.2, 0.7, 1.6);
    });
    haptic([20, 40, 20, 40, 45]);
  },

  /** Warm, welcoming rosewood marimba triad when your turn begins. */
  yourTurn() {
    const c = readyForSfx();
    if (!c || !sfxBus) return;
    const t0 = c.currentTime + 0.01;
    marimbaNote(c, sfxBus, t0,        587.33, 0.30, 0.18, -0.18); // D5
    marimbaNote(c, sfxBus, t0 + 0.08, 739.99, 0.32, 0.18,  0.0);  // F#5
    marimbaNote(c, sfxBus, t0 + 0.16, 880.00, 0.44, 0.20,  0.18); // A5
    haptic([12, 35, 16]);
  },

  /** Subtle warm board tap when ending your turn. */
  endTurn() {
    const c = readyForSfx();
    if (!c || !sfxBus) return;
    const t0 = c.currentTime + 0.005;
    woodKnock(c, sfxBus, t0, 210, 1200, 0.17, 0, 0.045);
    marimbaNote(c, sfxBus, t0 + 0.03, 440.0, 0.16, 0.09, 0);
  },

  /** Full celebratory medieval island victory fanfare! */
  win() {
    const c = readyForSfx();
    if (!c || !sfxBus) return;
    const t0 = c.currentTime + 0.02;
    duckMusic(0.32, 2.6, 1.2);

    // Joyful Celtic harp rising cascade
    const harpSeq = [293.66, 369.99, 440.0, 587.33, 739.99, 880.0, 1174.66];
    harpSeq.forEach((hz, i) => {
      pluckString(c, sfxBus!, t0 + i * 0.068, hz, 0.21, -0.4 + i * 0.13, 0.68, 2.0);
    });

    // Triumphant French horn fanfare melody (D4 -> A4 -> G4 -> A4 -> D5!)
    warmHorn(c, sfxBus, t0 + 0.14, 293.66, 0.24, 0.22, undefined, -0.2);
    warmHorn(c, sfxBus, t0 + 0.38, 440.00, 0.22, 0.22, undefined,  0.15);
    warmHorn(c, sfxBus, t0 + 0.60, 392.00, 0.18, 0.20, undefined, -0.1);
    warmHorn(c, sfxBus, t0 + 0.78, 440.00, 0.24, 0.23, undefined,  0.1);
    warmHorn(c, sfxBus, t0 + 1.02, 587.33, 1.15, 0.27, undefined,  0.0);
    warmHorn(c, sfxBus, t0 + 1.02, 369.99, 1.15, 0.17, undefined, -0.28);
    warmHorn(c, sfxBus, t0 + 1.02, 440.00, 1.15, 0.17, undefined,  0.28);

    // Golden bell sparkle on the final resolution chord
    bellNote(c, sfxBus, t0 + 1.02, 1174.66, 1.5, 0.20, -0.2);
    bellNote(c, sfxBus, t0 + 1.10, 1479.98, 1.5, 0.16,  0.2);
    haptic([25, 45, 25, 45, 25, 60, 75]);
  },

  /** Warm bittersweet medieval cadence when an opponent claims victory. */
  lose() {
    const c = readyForSfx();
    if (!c || !sfxBus) return;
    const t0 = c.currentTime + 0.02;
    duckMusic(0.4, 2.0, 1.1);
    const notes = [440.0, 392.0, 349.23, 293.66]; // A4 G4 F4 D4 (D minor)
    notes.forEach((hz, i) => {
      pluckString(c, sfxBus!, t0 + i * 0.22, hz, 0.20, -0.2 + i * 0.13, 0.45, 1.6);
    });
    warmHorn(c, sfxBus, t0 + 0.66, 293.66, 0.95, 0.20, undefined, 0);
    warmHorn(c, sfxBus, t0 + 0.66, 220.00, 0.95, 0.14, undefined, -0.2);
    haptic([20, 60, 40]);
  },

  /** Refined warm wooden peg click for UI buttons (no harsh square wave). */
  click() {
    const c = readyForSfx();
    if (!c || !sfxBus) return;
    woodKnock(c, sfxBus, c.currentTime + 0.004, jitter(520, 0.05), jitter(2600, 0.08), 0.15, 0, 0.022);
  },

  /** Gentle muted low wooden knock for invalid actions. */
  error() {
    const c = readyForSfx();
    if (!c || !sfxBus) return;
    const t0 = c.currentTime + 0.005;
    woodKnock(c, sfxBus, t0, 155, 650, 0.24, 0, 0.075);
    woodKnock(c, sfxBus, t0 + 0.085, 125, 520, 0.20, 0, 0.085);
    haptic([20, 30, 20]);
  },
};

/* ─── Generative Cozy Island Tabletop Music Engine ─────────────────── */

interface ChordDef {
  bass: number;      // MIDI root
  notes: number[];   // MIDI chord tones for lute arpeggio
  melody: number[];  // MIDI sweet spots for gentle flute phrasing
}

// D Mixolydian / D Major — classic warm sunlit island/medieval palette
const PROGRESSIONS: ChordDef[][] = [
  // "Harbor Morning": D - C - G - D
  [
    { bass: 50, notes: [62, 66, 69, 74], melody: [74, 76, 78, 81] },
    { bass: 48, notes: [60, 64, 67, 72], melody: [72, 74, 76, 79] },
    { bass: 43, notes: [59, 62, 67, 71], melody: [71, 74, 76, 79] },
    { bass: 50, notes: [62, 66, 69, 74], melody: [74, 78, 81, 74] },
  ],
  // "Timber & Grain": D - A - Bm - G
  [
    { bass: 50, notes: [62, 66, 69, 74], melody: [78, 76, 74, 69] },
    { bass: 45, notes: [61, 64, 69, 73], melody: [76, 73, 74, 76] },
    { bass: 47, notes: [59, 62, 66, 71], melody: [74, 71, 73, 74] },
    { bass: 43, notes: [59, 62, 67, 71], melody: [71, 74, 76, 74] },
  ],
  // "Trade Winds": G - D - C - A
  [
    { bass: 43, notes: [59, 62, 67, 71], melody: [79, 78, 76, 74] },
    { bass: 50, notes: [62, 66, 69, 74], melody: [74, 76, 78, 74] },
    { bass: 48, notes: [60, 64, 67, 72], melody: [72, 74, 76, 72] },
    { bass: 45, notes: [61, 64, 69, 73], melody: [73, 74, 76, 73] },
  ],
  // "Golden Coast": Bm - G - D - A
  [
    { bass: 47, notes: [59, 62, 66, 71], melody: [78, 74, 71, 74] },
    { bass: 43, notes: [59, 62, 67, 71], melody: [76, 74, 71, 74] },
    { bass: 50, notes: [62, 66, 69, 74], melody: [78, 81, 78, 74] },
    { bass: 45, notes: [61, 64, 69, 73], melody: [76, 74, 73, 69] },
  ],
];

const LUTE_PATTERNS: number[][] = [
  [0, 1, 2, 3, 2, 1, 2, 0],
  [0, 2, 1, 3, 0, 2, 3, 1],
  [0, 1, 2, 1, 3, 2, 1, 2],
];

const STEP_SEC = 60 / 74 / 2; // Eighth-note grid at relaxed 74 BPM (~0.405s)
let musicTimer: number | null = null;
let nextStepTime = 0;
let stepIndex = 0;
let progIndex = 0;
let patternIndex = 0;
let fluteActiveThisProg = true;

function scheduleMusicStep(c: AudioContext, dest: AudioNode, t: number, step: number) {
  const bar = Math.floor(step / 8) % 4;
  const sub = step % 8;
  const prog = PROGRESSIONS[progIndex % PROGRESSIONS.length];
  const chord = prog[bar];
  const pat = LUTE_PATTERNS[patternIndex % LUTE_PATTERNS.length];

  // Subtle human rubato (±12ms)
  const humanT = t + (Math.random() - 0.5) * 0.012;

  // 1. Warm acoustic bass pluck on beat 1 (and gentle bounce on beat 3.5 occasionally)
  if (sub === 0) {
    pluckString(c, dest, humanT, midiToHz(chord.bass), 0.26, -0.12, 0.30, 2.2);
  } else if (sub === 4 && Math.random() < 0.55) {
    pluckString(c, dest, humanT, midiToHz(chord.bass + 7), 0.16, -0.10, 0.28, 1.5);
  }

  // 2. Rolling nylon lute arpeggio (with gentle rests so it breathes)
  const playLute = sub === 0 || sub === 2 || sub === 3 || sub === 5 || (sub === 6 && Math.random() < 0.72) || (sub === 7 && Math.random() < 0.35);
  if (playLute) {
    const toneIdx = pat[sub % pat.length];
    const midi = chord.notes[toneIdx % chord.notes.length];
    const vel = sub === 0 ? 0.17 : (sub % 2 === 0 ? 0.135 : 0.105);
    const pan = -0.22 + (toneIdx / 3) * 0.44;
    pluckString(c, dest, humanT, midiToHz(midi), vel, pan, 0.44, 1.75);
  }

  // 3. Lyrical wooden Celtic flute melody (enters on ~65% of progressions, graceful phrasing)
  if (fluteActiveThisProg) {
    if (sub === 0 && (bar === 0 || bar === 2 || Math.random() < 0.65)) {
      const m = chord.melody[bar % chord.melody.length];
      warmFlute(c, dest, humanT + 0.02, midiToHz(m), STEP_SEC * 2.7, 0.11, 0.16);
    } else if (sub === 3 && Math.random() < 0.52) {
      const m = chord.melody[(bar + 1) % chord.melody.length];
      warmFlute(c, dest, humanT, midiToHz(m), STEP_SEC * 1.9, 0.095, 0.18);
    } else if (sub === 6 && bar === 3) {
      // Gentle turnaround sigh into next progression
      const m = chord.melody[0];
      warmFlute(c, dest, humanT, midiToHz(m), STEP_SEC * 1.8, 0.085, 0.14);
    }
  }
}

function startMusicLoop() {
  if (musicTimer !== null || !ctx || !musicDuckGain) return;
  nextStepTime = ctx.currentTime + 0.15;
  musicTimer = window.setInterval(() => {
    if (!ctx || !musicDuckGain || pageHidden || settings.muted || settings.musicVolume <= 0.005 || scene !== 'game') {
      return;
    }
    if (ctx.state !== 'running') return;
    // Catch up cleanly if browser throttled timers
    if (nextStepTime < ctx.currentTime - 0.5) {
      nextStepTime = ctx.currentTime + 0.08;
    }
    while (nextStepTime < ctx.currentTime + 0.55) {
      scheduleMusicStep(ctx, musicDuckGain, nextStepTime, stepIndex);
      stepIndex++;
      if (stepIndex % 32 === 0) {
        // Rotate progressions & flute breathing breaks
        progIndex = (progIndex + 1 + (Math.random() < 0.25 ? 1 : 0)) % PROGRESSIONS.length;
        patternIndex = (patternIndex + 1) % LUTE_PATTERNS.length;
        fluteActiveThisProg = Math.random() < 0.68;
      }
      nextStepTime += STEP_SEC;
    }
  }, 220);
}

function stopMusicLoop() {
  if (musicTimer !== null) {
    window.clearInterval(musicTimer);
    musicTimer = null;
  }
}

/* ─── Coastal Island Ambience (Ocean Surf + Gentle Breeze + Gull) ──── */

interface AmbienceHandles {
  nodes: AudioNode[];
  sources: AudioScheduledSourceNode[];
  gullTimer: number | null;
}

let ambience: AmbienceHandles | null = null;

function scheduleDistantGull(c: AudioContext, dest: AudioNode) {
  const t0 = c.currentTime + 0.05;
  const pan = Math.random() < 0.5 ? -0.55 : 0.55;
  const calls = Math.random() < 0.45 ? 2 : 1;
  for (let i = 0; i < calls; i++) {
    const start = t0 + i * 0.46;
    const osc = c.createOscillator();
    osc.type = 'sine';
    const base = jitter(2150, 0.08);
    osc.frequency.setValueAtTime(base * 0.88, start);
    osc.frequency.exponentialRampToValueAtTime(base, start + 0.09);
    osc.frequency.exponentialRampToValueAtTime(base * 0.68, start + 0.34);

    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = base * 0.85;
    bp.Q.value = 3.5;

    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(0.032, start + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, start + 0.36);

    osc.connect(bp);
    bp.connect(g);
    if (reverbNode) {
      connectWithPan(c, g, reverbNode, pan);
    } else {
      connectWithPan(c, g, dest, pan);
    }
    osc.start(start);
    osc.stop(start + 0.4);
  }
}

function startAmbienceLoop() {
  if (ambience || !ctx || !ambienceBus || !pinkNoiseBuf) return;

  const nodes: AudioNode[] = [];
  const sources: AudioScheduledSourceNode[] = [];

  // Two asynchronous rolling ocean surf layers (left-leaning & right-leaning)
  const waveConfigs = [
    { rateHz: 0.088, baseFreq: 310, sweepHz: 250, baseGain: 0.14, gainDepth: 0.095, pan: -0.32, offset: 0.0 },
    { rateHz: 0.122, baseFreq: 420, sweepHz: 290, baseGain: 0.10, gainDepth: 0.075, pan:  0.34, offset: 1.7 },
  ];

  for (const w of waveConfigs) {
    const src = ctx.createBufferSource();
    src.buffer = pinkNoiseBuf;
    src.loop = true;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = w.baseFreq;
    lp.Q.value = 0.7;

    const g = ctx.createGain();
    g.gain.value = w.baseGain;

    // Slow LFO sculpting both wave brightness (foam rush) and wave loudness
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = w.rateHz;

    const freqDepth = ctx.createGain();
    freqDepth.gain.value = w.sweepHz;
    lfo.connect(freqDepth);
    freqDepth.connect(lp.frequency);

    const ampDepth = ctx.createGain();
    ampDepth.gain.value = w.gainDepth;
    lfo.connect(ampDepth);
    ampDepth.connect(g.gain);

    src.connect(lp);
    lp.connect(g);
    connectWithPan(ctx, g, ambienceBus, w.pan);

    src.start(ctx.currentTime, w.offset);
    lfo.start(ctx.currentTime);

    sources.push(src, lfo);
    nodes.push(lp, g, freqDepth, ampDepth);
  }

  // Sparse distant harbor seagull (subtle coastal character every 24–44s)
  let gullTimer: number | null = null;
  const armGull = () => {
    const delayMs = 24000 + Math.random() * 20000;
    gullTimer = window.setTimeout(() => {
      if (ambience && ctx && ambienceBus && ctx.state === 'running' && !settings.muted && settings.ambienceVolume > 0.05 && scene === 'game' && !pageHidden) {
        scheduleDistantGull(ctx, ambienceBus);
      }
      if (ambience) armGull();
    }, delayMs);
    if (ambience) ambience.gullTimer = gullTimer;
  };

  ambience = { nodes, sources, gullTimer: null };
  armGull();
}

function stopAmbienceLoop() {
  if (!ambience) return;
  if (ambience.gullTimer !== null) window.clearTimeout(ambience.gullTimer);
  for (const s of ambience.sources) {
    try { s.stop(); } catch { /* ignore */ }
    try { s.disconnect(); } catch { /* ignore */ }
  }
  for (const n of ambience.nodes) {
    try { n.disconnect(); } catch { /* ignore */ }
  }
  ambience = null;
}

function syncLoops() {
  const wantMusic = unlocked && !settings.muted && !pageHidden && scene === 'game' && settings.musicVolume > 0.005;
  const wantAmb = unlocked && !settings.muted && !pageHidden && scene === 'game' && settings.ambienceVolume > 0.005;

  if (wantMusic) startMusicLoop();
  else stopMusicLoop();

  if (wantAmb) startAmbienceLoop();
  else stopAmbienceLoop();
}

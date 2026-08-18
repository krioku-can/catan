/**
 * Resolve the Catan Socket.io server URL.
 *
 * The user can choose where to connect:
 *   - auto (default): LAN when served from a LAN/localhost host, else cloud
 *   - cloud           always the public Render server
 *   - lan             always the local LAN server on this host
 *
 * Choice is persisted in localStorage so the lobby can surface it and let the
 * user switch (a reload reconnects the socket with the new server).
 */
export type ServerChoice = 'auto' | 'cloud' | 'lan';

const CHOICE_KEY = 'catan_server_choice';

function explicitUrl(): string | null {
  const explicit = import.meta.env.VITE_SERVER_URL;
  return explicit ? explicit.replace(/\/$/, '') : null;
}

function lanUrl(): string {
  const host = window.location.hostname;
  return `http://${host}:3001`;
}

function cloudUrl(): string {
  return explicitUrl() || 'https://catan-4ieq.onrender.com';
}

function isLocalHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
  );
}

export function getServerChoice(): ServerChoice {
  try {
    const c = localStorage.getItem(CHOICE_KEY);
    if (c === 'cloud' || c === 'lan') return c;
  } catch { /* ignore */ }
  return 'auto';
}

export function setServerChoice(c: ServerChoice): void {
  try { localStorage.setItem(CHOICE_KEY, c); } catch { /* ignore */ }
}

/** Resolve the server URL for the current (persisted) choice. */
export function getServerUrl(): string {
  const choice = getServerChoice();

  if (choice === 'cloud') return cloudUrl();
  if (choice === 'lan') return lanUrl();
  // auto
  return isLocalHost(window.location.hostname) ? lanUrl() : cloudUrl();
}

/** True when the resolved server is a local LAN host, not the public cloud. */
export function isLanServer(): boolean {
  const url = getServerUrl();
  return url.includes('3001') && !url.includes('onrender');
}

/** Backwards-compatible snapshot (evaluated once at import time). */
export const SERVER_URL = getServerUrl();

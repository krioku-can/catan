/**
 * Resolve the Catan Socket.io server URL.
 *
 * Precedence:
 *   1. Explicit VITE_SERVER_URL (local dev / override)
 *   2. When the app itself is served from a LAN or localhost host (i.e. the
 *      Mac's Vite dev server), talk to the Catan server on that SAME host:port
 *      3001 — this is how phones on the same WiFi reach the local server.
 *   3. Fallback to the public Render server.
 */
function resolveServerUrl(): string {
  const explicit = import.meta.env.VITE_SERVER_URL;
  if (explicit) return explicit.replace(/\/$/, '');

  const host = window.location.hostname;
  const isLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);

  if (isLocal) return `http://${host}:3001`;
  return 'https://catan-4ieq.onrender.com';
}

export const SERVER_URL = resolveServerUrl();

/** True when the client is pointed at a same-LAN server (host dev box), not the public cloud. */
export function isLanServer(): boolean {
  return SERVER_URL.includes('3001') && !SERVER_URL.includes('onrender');
}

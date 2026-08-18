const SERVER_URL = (import.meta.env.VITE_SERVER_URL || 'https://catan-4ieq.onrender.com').replace(/\/$/, '');

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

export async function registerCatanWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (err) {
    console.warn('[push] sw register failed', err);
    return null;
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function enableTurnPush(playerId: string): Promise<string | null> {
  if (!pushSupported()) return 'Notifications are not supported in this browser.';
  if (isIOS() && !isStandalone()) {
    return 'On iPhone/iPad: Share → Add to Home Screen, then open Catan from the icon and try again.';
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'Notification permission was denied.';

  const reg = await registerCatanWorker();
  if (!reg) return 'Could not register the notification worker.';

  const keyRes = await fetch(`${SERVER_URL}/api/push/vapid-public-key`);
  if (!keyRes.ok) return 'Server is not ready for notifications yet.';
  const { publicKey } = await keyRes.json() as { publicKey?: string };
  if (!publicKey) return 'Server is not ready for notifications yet.';

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  });

  const save = await fetch(`${SERVER_URL}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, subscription: sub.toJSON() }),
  });
  if (!save.ok) return 'Could not save the subscription on the server.';
  try { localStorage.setItem('catan_push', 'on'); } catch { /* ignore */ }
  return null;
}

export async function disableTurnPush(playerId: string): Promise<void> {
  try { localStorage.setItem('catan_push', 'off'); } catch { /* ignore */ }
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    const endpoint = sub?.endpoint;
    await sub?.unsubscribe();
    await fetch(`${SERVER_URL}/api/push/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, endpoint }),
    });
  } catch { /* ignore */ }
}

export function pushPrefOn(): boolean {
  try { return localStorage.getItem('catan_push') === 'on'; } catch { return false; }
}

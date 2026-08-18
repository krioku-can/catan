import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import webpush from 'web-push';

function loadLocalEnv() {
  const p = resolve(process.cwd(), '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq);
    const val = trimmed.slice(eq + 1);
    if (!process.env[key]) process.env[key] = val;
  }
}
loadLocalEnv();

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const byPlayer = new Map<string, PushSub[]>();

let publicKey = process.env.VAPID_PUBLIC_KEY || '';
let privateKey = process.env.VAPID_PRIVATE_KEY || '';

if (!publicKey || !privateKey) {
  const generated = webpush.generateVAPIDKeys();
  publicKey = generated.publicKey;
  privateKey = generated.privateKey;
  console.log('[push] ephemeral VAPID keys — set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY to persist across deploys');
}

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:chris@madebylumi.com',
  publicKey,
  privateKey,
);

export function getVapidPublicKey(): string {
  return publicKey;
}

export function saveSubscription(playerId: string, sub: PushSub): void {
  if (!playerId || !sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return;
  const next = (byPlayer.get(playerId) || []).filter(s => s.endpoint !== sub.endpoint);
  next.push(sub);
  byPlayer.set(playerId, next);
}

export function dropSubscription(playerId: string, endpoint?: string): void {
  if (!endpoint) {
    byPlayer.delete(playerId);
    return;
  }
  const next = (byPlayer.get(playerId) || []).filter(s => s.endpoint !== endpoint);
  if (next.length) byPlayer.set(playerId, next);
  else byPlayer.delete(playerId);
}

export function shouldPush(player: { isAI?: boolean; socketId?: string; visible?: boolean }): boolean {
  if (player.isAI) return false;
  if (player.visible === true) return false;
  // Connected and not marked hidden → they're looking at the game.
  if (player.socketId && player.visible !== false) return false;
  return true;
}

export async function notifyPlayer(
  playerId: string,
  payload: { title: string; body: string; tag?: string; url?: string },
): Promise<void> {
  const list = byPlayer.get(playerId) || [];
  if (!list.length) return;
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    tag: payload.tag || 'catan',
    url: payload.url || '/',
  });
  await Promise.all(list.map(async sub => {
    try {
      await webpush.sendNotification(sub, body);
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) dropSubscription(playerId, sub.endpoint);
      else console.warn('[push] send failed', status || err);
    }
  }));
}

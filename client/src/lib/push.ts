/**
 * "Tell me when it's my move" — Web Push.
 *
 * The browser gives us a subscription (an address at Google/Mozilla/Microsoft/Apple's push service);
 * we hand it to the game server, which posts to it whenever the opponent moves. The service worker
 * (public/sw.js) turns that into a system notification, even if the game is closed.
 *
 * Push only works on secure pages: https (the ngrok address) or http://localhost.
 */
import type { PushSubscriptionData } from '../../../shared/protocol';
import { SERVER_URL } from './socket';

export type PushState =
  | 'unsupported' // old browser, or a plain-http LAN address
  | 'denied' // the player blocked notifications for this site
  | 'off' // allowed or not yet asked, but not subscribed on this device
  | 'on';

export const pushSupported = (): boolean =>
  window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

/** Register /sw.js once (also makes the app installable on Android). Safe to call repeatedly. */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return Promise.resolve(null);
  registration ??= navigator.serviceWorker.register('/sw.js').catch((err: unknown) => {
    console.warn('Service worker registration failed:', err);
    return null;
  });
  return registration;
}

async function existingSubscription(): Promise<PushSubscription | null> {
  const reg = await registerServiceWorker();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  return (await existingSubscription()) ? 'on' : 'off';
}

/** The subscription to (re)send to the server, if this device already has one. Never prompts. */
export async function currentSubscription(): Promise<PushSubscriptionData | null> {
  if (!pushSupported() || Notification.permission !== 'granted') return null;
  const sub = await existingSubscription();
  return sub ? toData(sub) : null;
}

/** Ask permission (must be called from a click) and subscribe this device. */
export async function enablePush(): Promise<{ ok: true; subscription: PushSubscriptionData } | { ok: false; message: string }> {
  if (!pushSupported()) {
    return { ok: false, message: 'Notifications need the secure (https) game address and an up-to-date browser.' };
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, message: 'Notifications are blocked. Allow them in the browser\'s site settings to turn them on.' };
  }
  try {
    const reg = await registerServiceWorker();
    if (!reg) return { ok: false, message: 'This browser could not start the notification service.' };
    await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: await serverKey() }));
    return { ok: true, subscription: toData(sub) };
  } catch (err) {
    return { ok: false, message: `Couldn't turn on notifications: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Unsubscribe this device; returns the endpoint so the server can forget it too. */
export async function disablePush(): Promise<string | null> {
  const sub = await existingSubscription();
  if (!sub) return null;
  await sub.unsubscribe();
  return sub.endpoint;
}

async function serverKey(): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(`${SERVER_URL}/api/push/key`, { headers: { 'ngrok-skip-browser-warning': '1' } });
  if (!res.ok) throw new Error('the game server has notifications turned off');
  const { publicKey } = (await res.json()) as { publicKey: string };
  const raw = atob(publicKey.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function toData(sub: PushSubscription): PushSubscriptionData {
  const json = sub.toJSON();
  return { endpoint: sub.endpoint, keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' } };
}

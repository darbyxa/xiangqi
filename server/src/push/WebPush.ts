/**
 * Web Push: lets the server put a notification on a player's phone or laptop when it's their move,
 * even when the game isn't open (the browser's push service wakes our service worker, client/public/sw.js).
 *
 * The VAPID key pair identifies this server to the push services. It is generated on first run and
 * saved next to the games, so existing subscriptions keep working after a restart.
 */
import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import type { PushMessage, PushSubscriptionData } from '../../../shared/protocol';

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export class WebPush {
  readonly publicKey: string;

  /** `onGone` is told about subscriptions the push service has permanently rejected. */
  constructor(
    dataDir: string,
    subject: string,
    private onGone: (endpoint: string) => void,
  ) {
    const keys = loadOrCreateKeys(path.join(dataDir, 'vapid.json'));
    this.publicKey = keys.publicKey;
    webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  }

  send(subscriptions: PushSubscriptionData[], message: PushMessage): void {
    const payload = JSON.stringify(message);
    for (const sub of subscriptions) {
      webpush
        .sendNotification(sub, payload, { TTL: 7 * 24 * 3600, urgency: 'high', topic: topicFor(message.tag) })
        .catch((err: { statusCode?: number; body?: string }) => {
          if (err.statusCode === 404 || err.statusCode === 410) this.onGone(sub.endpoint);
          else console.warn(`[push] delivery failed (${err.statusCode ?? 'network'}): ${err.body ?? err}`);
        });
    }
  }
}

function loadOrCreateKeys(file: string): VapidKeys {
  try {
    const keys = JSON.parse(fs.readFileSync(file, 'utf8')) as VapidKeys;
    if (keys.publicKey && keys.privateKey) return keys;
  } catch {
    // first run (or unreadable) → make new keys below
  }
  const keys = webpush.generateVAPIDKeys();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(keys, null, 2));
  return keys;
}

/** Push "topics" replace an undelivered message with a newer one (max 32 URL-safe chars). */
const topicFor = (tag: string) => tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);

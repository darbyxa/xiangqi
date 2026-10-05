import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../../../shared/protocol';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Empty → same origin as the page (Vite proxies it in dev; Express serves it in production). */
export const SERVER_URL = (import.meta.env.VITE_SERVER_URL ?? '').trim().replace(/\/+$/, '');

const options = {
  autoConnect: false,
  // WebSocket first (works through ngrok without its browser-warning page), long-polling as a fallback.
  transports: ['websocket', 'polling'],
  reconnectionDelay: 500,
  reconnectionDelayMax: 4000,
  // Only used by the polling fallback: lets ngrok's free tier skip its interstitial for XHR requests.
  extraHeaders: { 'ngrok-skip-browser-warning': '1' },
};

export const socket: GameSocket = SERVER_URL ? io(SERVER_URL, options) : io(options);
